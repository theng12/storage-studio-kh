//! Storage Studio KH — menu-bar shell.
//!
//! The Tauri window is only Settings. The macOS work (mount table, SMB mounting,
//! private secret file, wake/network watching, bounded retries) lives in the bundled helper at
//! `Contents/Helpers/Storage Studio KH Helper.app`, started as this app's child and
//! stopped when the app quits. Nothing here or there copies, mirrors or syncs data.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};

/// Photograph the app's own window for the release (RELEASE-POLICY §5d), from inside the process:
/// WKWebView.takeSnapshot over the window Tauri already owns. The window is moved off the visible area
/// and ordered without activating, so nothing appears on anyone's screen and no pointer is driven.
#[cfg(target_os = "macos")]
mod capture {
    use std::path::Path;
    use std::sync::mpsc;
    use std::time::Duration;

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send, ClassType};
    use tauri::Manager;
    use objc2_app_kit::{NSBitmapImageRep, NSImage, NSView, NSWindow};
    use objc2_foundation::NSData;
    use objc2_web_kit::{WKSnapshotConfiguration, WKWebView};

    unsafe fn find_webview(view: &NSView, depth: usize) -> Option<Retained<WKWebView>> {
        if depth > 24 {
            return None;
        }
        let any: &AnyObject = &*(view as *const NSView as *const AnyObject);
        // isKindOfClass, not an equality test: Tauri's webview is a WKWebView subclass created by
        // name at runtime, so `class() == WKWebView::class()` matched nothing in the real app (0.1.28
        // every shot said "no WKWebView in the window" while a bare probe webview worked).
        let is_webview: bool = msg_send![any, isKindOfClass: WKWebView::class()];
        if is_webview {
            let ptr: *mut WKWebView = view as *const NSView as *mut WKWebView;
            return Some(Retained::retain(ptr)?);
        }
        let subviews: Option<Retained<objc2_foundation::NSArray<NSView>>> = msg_send![view, subviews];
        if let Some(subviews) = subviews {
            for index in 0..subviews.count() {
                let child = subviews.objectAtIndex(index);
                if let Some(found) = find_webview(&child, depth + 1) {
                    return Some(found);
                }
            }
        }
        None
    }

    /// One PNG of the webview's current contents. Called from a background thread; the snapshot
    /// itself is taken on the main thread, as AppKit requires, and the answer comes back here.
    pub fn snapshot(window: &tauri::WebviewWindow, path: &Path) -> Result<(), String> {
        let raw = window.ns_window().map_err(|error| error.to_string())? as usize;
        let (tx, rx) = mpsc::channel::<Result<Vec<u8>, String>>();
        window
            .app_handle()
            .run_on_main_thread(move || unsafe {
                let ns = raw as *mut NSWindow;
                let content: Option<Retained<NSView>> = msg_send![ns, contentView];
                let Some(content) = content else {
                    let _ = tx.send(Err("the window has no content view".to_string()));
                    return;
                };
                let Some(webview) = find_webview(&content, 0) else {
                    let _ = tx.send(Err("no WKWebView in the window".to_string()));
                    return;
                };
                let config: Retained<WKSnapshotConfiguration> =
                    msg_send![class!(WKSnapshotConfiguration), new];
                let block = RcBlock::new(move |image: *mut NSImage, error: *mut objc2_foundation::NSError| {
                    if image.is_null() {
                        let reason = if error.is_null() {
                            "takeSnapshot returned no image".to_string()
                        } else {
                            format!("takeSnapshot failed: {:?}", (*error).localizedDescription())
                        };
                        let _ = tx.send(Err(reason));
                        return;
                    }
                    let tiff: Option<Retained<NSData>> = msg_send![image, TIFFRepresentation];
                    let Some(tiff) = tiff else {
                        let _ = tx.send(Err("the image had no TIFF data".to_string()));
                        return;
                    };
                    let rep: Option<Retained<NSBitmapImageRep>> =
                        msg_send![class!(NSBitmapImageRep), imageRepWithData: &*tiff];
                    let Some(rep) = rep else {
                        let _ = tx.send(Err("the TIFF data did not decode".to_string()));
                        return;
                    };
                    // NSBitmapImageFileTypePNG is 4.
                    let png: Option<Retained<NSData>> = msg_send![
                        &rep,
                        representationUsingType: 4usize,
                        properties: std::ptr::null::<AnyObject>()
                    ];
                    match png {
                        Some(png) => {
                            let bytes = png.to_vec();
                            let _ = tx.send(Ok(bytes));
                        }
                        None => {
                            let _ = tx.send(Err("the bitmap did not become a PNG".to_string()));
                        }
                    }
                });
                let _: () = msg_send![
                    &webview,
                    takeSnapshotWithConfiguration: &*config,
                    completionHandler: &*block
                ];
            })
            .map_err(|error| error.to_string())?;
        let bytes = rx
            .recv_timeout(Duration::from_secs(20))
            .map_err(|_| "the snapshot did not answer within 20 s".to_string())??;
        std::fs::write(path, bytes).map_err(|error| format!("{}: {error}", path.display()))
    }
}

/// Sparkle through the shared shim (INTEGRATION.md §3A). The shim checks once per launch, draws no
/// UI, and refuses unless the hold endpoint answers `{"safe":true}`; a refusal is logged with its rc.
mod sparkle {
    use std::sync::atomic::{AtomicU8, Ordering};
    use std::sync::OnceLock;

    extern "C" {
        fn kh_sparkle_start() -> i32;
        fn kh_sparkle_last_error() -> *const std::ffi::c_char;
        fn kh_sparkle_set_state_callback(cb: extern "C" fn(i32));
    }

    static STATE: AtomicU8 = AtomicU8::new(0);
    static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

    /// 0 idle, 1 updating, 2 relaunching.
    pub fn state() -> u8 {
        STATE.load(Ordering::Relaxed)
    }

    extern "C" fn on_state(step: i32) {
        STATE.store(step.clamp(0, 2) as u8, Ordering::Relaxed);
        if let Some(app) = APP.get() {
            crate::emit_snapshot(app);
        }
    }

    /// Called once, after the tray exists. The window says an update is in progress instead of
    /// looking idle while the app is about to be replaced.
    pub fn start(app: &tauri::AppHandle) {
        let _ = APP.set(app.clone());
        unsafe {
            kh_sparkle_set_state_callback(on_state);
            let rc = kh_sparkle_start();
            if rc != 0 {
                let reason = std::ffi::CStr::from_ptr(kh_sparkle_last_error()).to_string_lossy();
                crate::log(&format!("kh-sparkle: refused to start ({rc}): {reason}"));
            }
        }
    }
}

const APP_NAME: &str = "Storage Studio KH";
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
const SUPPORT_URL: &str = "https://nowpayments.io/donation/studiokh";
const DEFAULT_RETRIES: u32 = 3;

// ---------------------------------------------------------------- settings

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct Storage {
    id: String,
    name: String,
    kind: String, // "smb" | "volume"
    target: String,
    #[serde(default)]
    mount_point: String,
    #[serde(default, rename = "volumeUUID")]
    volume_uuid: Option<String>,
    #[serde(default)]
    reconnect_at_login: bool,
    #[serde(default)]
    reconnect_after_wake: bool,
    #[serde(default)]
    username: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct General {
    notifications: bool,
    launch_at_login: bool,
    retries: u32,
}

impl Default for General {
    fn default() -> Self {
        Self { notifications: true, launch_at_login: true, retries: DEFAULT_RETRIES }
    }
}

/// One saved archive row: the channel folder (and its heavy-media folder, when it keeps one
/// elsewhere) and the archive root it is copied to. Storage never interprets what is inside.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct Archive {
    id: String,
    name: String,
    slug: String,
    #[serde(default)]
    project_id: Option<String>,
    roots: Vec<String>,
    destination: String,
    #[serde(default)]
    last: Option<ArchiveLast>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct ArchiveLast {
    at: u64,
    path: String,
    files: u64,
    bytes: u64,
}

/// What the helper reports about the one job that can run.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
struct JobView {
    #[serde(default)]
    id: String,
    #[serde(default)]
    kind: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    state: String,
    #[serde(default)]
    files_done: u64,
    #[serde(default)]
    files_total: u64,
    #[serde(default)]
    bytes_done: u64,
    #[serde(default)]
    bytes_total: u64,
    #[serde(default)]
    detail: Option<String>,
    #[serde(default)]
    path: Option<String>,
}

/// One archive found on a destination, read from its manifest alone.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct RestorableItem {
    name: String,
    slug: String,
    path: String,
    created_at: String,
    machine: String,
    files: u64,
    bytes: u64,
    roots: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
struct RestorableList {
    root: String,
    items: Vec<RestorableItem>,
    error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct Settings {
    schema: u32,
    appearance: String, // "system" | "light" | "dark"
    #[serde(default = "default_list_view")]
    list_view: String, // "cards" | "table"
    general: General,
    storages: Vec<Storage>,
    #[serde(default)]
    archives: Vec<Archive>,
}

fn default_list_view() -> String {
    "cards".into()
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            schema: 2,
            appearance: "system".into(),
            list_view: default_list_view(),
            general: General::default(),
            storages: Vec::new(),
            archives: Vec::new(),
        }
    }
}

fn data_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_default();
    PathBuf::from(home).join("Library").join("Application Support").join(APP_NAME)
}

fn settings_path() -> PathBuf {
    data_dir().join("settings.json")
}

fn log_path() -> PathBuf {
    data_dir().join("log.txt")
}

fn hold_attempt_path() -> PathBuf {
    data_dir().join("hold-attempts.jsonl")
}

/// One line per hold or resume the updater asked for: when, what it asked, what happened, why.
/// The updater keeps its own record; this is the app's side of the same handshake.
fn record_hold_attempt(kind: &str, asked_s: u64, answered_ms: u128, safe: bool, in_flight: usize, reason: Option<&str>) {
    let path = hold_attempt_path();
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let line = serde_json::json!({
        "at": unix_millis(),
        "request": kind,
        "asked_s": asked_s,
        "answered_in_ms": answered_ms,
        "safe": safe,
        "in_flight": in_flight,
        "reason": reason,
    })
    .to_string();
    // Keep it small: one night of retries is a few dozen lines; 200 is plenty to diagnose one.
    let mut text = String::new();
    if let Ok(existing) = std::fs::read_to_string(&path) {
        let keep: Vec<&str> = existing.lines().filter(|l| !l.trim().is_empty()).rev().take(199).collect();
        for l in keep.into_iter().rev() {
            text.push_str(l);
            text.push('\n');
        }
    }
    text.push_str(&line);
    text.push('\n');
    if let Err(error) = std::fs::write(&path, text) {
        log(&format!("the hold attempt could not be recorded: {error}"));
    }
}

fn log(message: &str) {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // A test run must never write the live app's log (issue 365): stderr only under test.
    if cfg!(test) {
        eprintln!("{message}");
        return;
    }
    let _ = stamp;
    let dir = data_dir();
    let _ = std::fs::create_dir_all(&dir);
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(log_path()) {
        let _ = writeln!(file, "{stamp} {message}");
    }
    eprintln!("{message}");
}

fn load_settings() -> Settings {
    let text = std::fs::read_to_string(settings_path()).unwrap_or_default();
    if text.trim().is_empty() {
        return Settings::default();
    }
    match serde_json::from_str::<Settings>(&text) {
        Ok(mut settings) => {
            // "default" was the older name for the system choice; keep it reading as System.
            if settings.appearance != "light" && settings.appearance != "dark" {
                settings.appearance = "system".into();
            }
            if settings.general.retries == 0 {
                settings.general.retries = DEFAULT_RETRIES;
            }
            settings
        }
        Err(error) => {
            // Never lose the owner's file to a parse error: keep it beside the new one.
            log(&format!("settings.json could not be read ({error}); keeping a copy"));
            let _ = std::fs::rename(settings_path(), data_dir().join("settings-unreadable.json"));
            Settings::default()
        }
    }
}

fn save_settings(settings: &Settings) -> Result<(), String> {
    log_failure(save_settings_to(&data_dir(), settings, false))
}

/// Removing the owner's last row is the one honest empty save; only the two removals skip the guard.
fn save_settings_after_removal(settings: &Settings) -> Result<(), String> {
    log_failure(save_settings_to(&data_dir(), settings, true))
}

fn log_failure(result: Result<(), String>) -> Result<(), String> {
    if let Err(message) = &result {
        log(message);
    }
    result
}

/// An empty store never replaces saved rows. A helper reply this app failed to decode once
/// left it holding defaults, and the next ordinary save wrote that empty list over the
/// owner's storages (2026-11-22, 0.1.22).
fn save_settings_to(dir: &Path, settings: &Settings, may_be_empty: bool) -> Result<(), String> {
    if !may_be_empty && settings.storages.is_empty() && settings.archives.is_empty() {
        let saved = std::fs::read_to_string(dir.join("settings.json")).unwrap_or_default();
        let has_rows = serde_json::from_str::<Settings>(&saved)
            .map(|saved| !saved.storages.is_empty() || !saved.archives.is_empty())
            .unwrap_or(false);
        if has_rows {
            return Err("Refused to save an empty list over the saved one.".into());
        }
    }
    std::fs::create_dir_all(dir).map_err(|e| format!("Could not create {APP_NAME}'s data folder: {e}"))?;
    let text = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    write_private(&dir.join("settings.json"), &text).map_err(|e| format!("Could not save settings: {e}"))
}

/// Settings name a share's user, so the file stays owner-only (0600): written to a
/// temporary beside it, made 0600, then renamed into place.
fn write_private(path: &Path, text: &str) -> std::io::Result<()> {
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    let dir = path.parent().unwrap_or(Path::new("."));
    let temporary = dir.join(format!(".{}.tmp", path.file_name().unwrap_or_default().to_string_lossy()));
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(&temporary)?;
    file.write_all(text.as_bytes())?;
    // mode() only applies when the file is created; an older temporary keeps its own.
    std::fs::set_permissions(&temporary, std::fs::Permissions::from_mode(0o600))?;
    std::fs::rename(&temporary, path)
}

/// What the helper reports about one storage.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
struct StorageState {
    #[serde(default)]
    status: String,
    #[serde(default)]
    detail: Option<String>,
    #[serde(default)]
    mounted_path: Option<String>,
    #[serde(default)]
    has_credentials: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct VolumeCandidate {
    name: String,
    path: String,
    uuid: String,
    device: String,
}

/// A share Finder already has mounted, offered as a one-click addition.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct ShareCandidate {
    name: String,
    url: String,
    user: Option<String>,
    host: String,
    mount_point: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct UpdateState {
    state: String,
    version: Option<String>,
    reason: Option<String>,
}

impl Default for UpdateState {
    fn default() -> Self {
        Self { state: "idle".into(), version: None, reason: None }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct WhatsNewEntry {
    version: String,
    date: Option<String>,
    items: Vec<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    app_name: String,
    version: String,
    appearance: String,
    list_view: String,
    general: General,
    storages: Vec<StorageView>,
    volumes: Vec<VolumeCandidate>,
    mounted_shares: Vec<ShareCandidate>,
    update: UpdateState,
    whats_new: Vec<WhatsNewEntry>,
    launch_at_login_enabled: bool,
    launch_at_login_error: Option<String>,
    engine_running: bool,
    engine_error: Option<String>,
    last_checked: Option<u64>,
    second_instance: bool,
    /// True while an update holds new work; the window says so instead of looking stuck.
    holding: bool,
    /// True while Sparkle is installing: the window says so instead of looking idle.
    updating: bool,
    /// Storages with a running attempt or a waiting retry: the rows that offer Stop trying.
    queued: Vec<String>,
    archives: Vec<Archive>,
    /// The one archive or restore job, while one is running or paused.
    job: Option<JobView>,
    /// The last discovery result, so the restore sheet can draw it from a snapshot.
    restorable: Option<RestorableList>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StorageView {
    #[serde(flatten)]
    storage: Storage,
    status: String,
    detail: Option<String>,
    mounted_path: Option<String>,
    has_credentials: bool,
}

// ---------------------------------------------------------------- app state

/// The update hold's pause. Memory only, and it expires by itself: a restart always takes work.
#[derive(Default)]
struct Hold {
    until: Option<Instant>,
    generation: u64,
}

impl Hold {
    fn paused(&self) -> bool {
        self.until.map(|until| until > Instant::now()).unwrap_or(false)
    }

    fn seconds_left(&self) -> u64 {
        match self.until {
            Some(until) if until > Instant::now() => (until - Instant::now()).as_secs() + 1,
            _ => 0,
        }
    }
}

/// What the helper last reported: running mounts, scheduled retries, and claims held for resume.
#[derive(Default, Clone)]
struct Work {
    in_flight: Vec<String>,
    /// Scheduled retries: this process will try them again, even without a reconnect setting.
    queued: Vec<String>,
    /// Claims deferred by the hold: the helper will try them again on resume.
    deferred: Vec<String>,
    /// The helper's own answer to a hold. Read, never inferred from an empty queue.
    paused: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum HoldWork {
    Settled,
    Held,
}

struct Helper {
    child: Child,
    stdin: ChildStdin,
}

struct AppState {
    settings: Mutex<Settings>,
    helper: Mutex<Option<Helper>>,
    statuses: Mutex<HashMap<String, StorageState>>,
    volumes: Mutex<Vec<VolumeCandidate>>,
    smb_mounts: Mutex<Vec<ShareCandidate>>,
    update: Mutex<UpdateState>,
    login_error: Mutex<Option<String>>,
    engine_error: Mutex<Option<String>>,
    last_checked: Mutex<Option<u64>>,
    second_instance: Mutex<bool>,
    hold: Mutex<Hold>,
    work: Mutex<Work>,
    /// Bumped when the helper processes a hold, so the reply observes its pause.
    work_revision: Mutex<u64>,
    work_version: Mutex<u64>,
    work_pending: Mutex<Option<HoldWork>>,
    work_type: Mutex<&'static str>,
    job: Mutex<Option<JobView>>,
    restorable: Mutex<Option<RestorableList>>,
}

impl AppState {
    fn new(settings: Settings) -> Self {
        Self {
            settings: Mutex::new(settings),
            helper: Mutex::new(None),
            statuses: Mutex::new(HashMap::new()),
            volumes: Mutex::new(Vec::new()),
            smb_mounts: Mutex::new(Vec::new()),
            update: Mutex::new(UpdateState::default()),
            login_error: Mutex::new(None),
            engine_error: Mutex::new(None),
            last_checked: Mutex::new(None),
            second_instance: Mutex::new(false),
            hold: Mutex::new(Hold::default()),
            work: Mutex::new(Work::default()),
            work_revision: Mutex::new(0),
            work_version: Mutex::new(0),
            work_pending: Mutex::new(None),
            work_type: Mutex::new("hold"),
            job: Mutex::new(None),
            restorable: Mutex::new(None),
        }
    }
}

fn whats_new() -> Vec<WhatsNewEntry> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        // Contents/MacOS/<exe> -> Contents/Resources/whats-new.json
        if let Some(contents) = exe.parent().and_then(|p| p.parent()) {
            candidates.push(contents.join("Resources").join("whats-new.json"));
        }
    }
    // Dev fallback only: embedding the build folder in a release binary would carry the owner's path.
    #[cfg(debug_assertions)]
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("whats-new.json"));
    for path in candidates {
        if let Ok(text) = std::fs::read_to_string(&path) {
            if let Ok(entries) = serde_json::from_str::<Vec<WhatsNewEntry>>(&text) {
                return entries;
            }
        }
    }
    Vec::new()
}

fn snapshot(app: &AppHandle) -> Snapshot {
    let state = app.state::<AppState>();
    let settings = state.settings.lock().unwrap().clone();
    let statuses = state.statuses.lock().unwrap().clone();
    let storages = settings
        .storages
        .iter()
        .map(|storage| {
            let status = statuses.get(&storage.id).cloned().unwrap_or_default();
            StorageView {
                storage: storage.clone(),
                status: if status.status.is_empty() { "not_mounted".into() } else { status.status },
                detail: status.detail,
                mounted_path: status.mounted_path,
                has_credentials: status.has_credentials,
            }
        })
        .collect();
    let engine_error = state.engine_error.lock().unwrap().clone();
    let volumes = state.volumes.lock().unwrap().clone();
    let mounted_shares = state.smb_mounts.lock().unwrap().clone();
    let update = state.update.lock().unwrap().clone();
    let second_instance = *state.second_instance.lock().unwrap();
    let launch_at_login_error = state.login_error.lock().unwrap().clone();
    let engine_running = state.helper.lock().unwrap().is_some();
    let last_checked = *state.last_checked.lock().unwrap();
    let holding = state.hold.lock().unwrap().paused();
    let updating = sparkle::state() >= 1;
    // In flight or waiting a retry: what a Stop trying can end.
    let queued: Vec<String> = {
        let work = state.work.lock().unwrap();
        let mut ids = work.in_flight.clone();
        ids.extend(work.queued.iter().cloned());
        ids.sort();
        ids.dedup();
        ids
    };
    let job = state.job.lock().unwrap().clone();
    let restorable = state.restorable.lock().unwrap().clone();
    Snapshot {
        app_name: APP_NAME.into(),
        version: APP_VERSION.into(),
        appearance: settings.appearance.clone(),
        list_view: settings.list_view.clone(),
        general: settings.general.clone(),
        storages,
        volumes,
        mounted_shares,
        update,
        whats_new: whats_new(),
        launch_at_login_enabled: login_item::is_enabled(),
        launch_at_login_error,
        engine_running,
        last_checked,
        engine_error,
        second_instance,
        holding,
        updating,
        queued,
        archives: settings.archives.clone(),
        job,
        restorable,
    }
}

fn emit_snapshot(app: &AppHandle) {
    let snap = snapshot(app);
    let _ = app.emit("snapshot", snap.clone());
    if let Some(tray) = app.tray_by_id("main") {
        if let Ok(menu) = build_tray_menu(app, &snap) {
            let _ = tray.set_menu(Some(menu));
        }
    }
}

// ---------------------------------------------------------------- tray menu

fn status_label(status: &str) -> &'static str {
    match status {
        "mounted" => "Mounted",
        "mounting" => "Mounting…",
        "retrying" => "Retrying…",
        "needs_attention" => "Needs attention",
        "unreachable" => "Unreachable",
        _ => "Not mounted",
    }
}

fn build_tray_menu(app: &AppHandle, snap: &Snapshot) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::new(app)?;
    if snap.storages.is_empty() {
        menu.append(&MenuItem::with_id(app, "no-storage", "No storage added yet", false, None::<&str>)?)?;
    } else {
        for storage in &snap.storages {
            let mut label = format!("{} — {}", storage.storage.name, status_label(&storage.status));
            if storage.status == "needs_attention" {
                if let Some(detail) = &storage.detail {
                    label = format!("{} — Needs attention: {}", storage.storage.name, detail);
                }
            }
            menu.append(&MenuItem::with_id(app, format!("storage:{}", storage.storage.id), label, false, None::<&str>)?)?;
        }
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    if snap.holding {
        // Say it, rather than leave a button that would refuse.
        menu.append(&MenuItem::with_id(app, "holding", "Holding new work for an update", false, None::<&str>)?)?;
    }
    let any_unmounted = !snap.holding && snap.storages.iter().any(|s| s.status != "mounted");
    menu.append(&MenuItem::with_id(app, "mount-all", "Mount now", any_unmounted, None::<&str>)?)?;
    let any_mounted = snap.storages.iter().any(|s| s.status == "mounted");
    menu.append(&MenuItem::with_id(app, "reveal", "Open in Finder", any_mounted, None::<&str>)?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(app, "settings", "Settings…", true, Some("CmdOrCtrl+,"))?)?;
    menu.append(&MenuItem::with_id(app, "whatsnew", "What's New…", true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "support", "Support this app…", true, None::<&str>)?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(app, "version", format!("{APP_NAME} {APP_VERSION}"), false, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "quit", "Quit Storage Studio KH", true, Some("CmdOrCtrl+Q"))?)?;
    Ok(menu)
}

// ---------------------------------------------------------------- helper

fn helper_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let contents = exe.parent()?.parent()?;
    let app = contents.join("Helpers").join("Storage Studio KH Helper.app");
    let binary = app.join("Contents").join("MacOS").join("Storage Studio KH Helper");
    if binary.is_file() {
        Some(binary)
    } else {
        None
    }
}

fn helper_config(settings: &Settings) -> serde_json::Value {
    serde_json::json!({
        "type": "configure",
        "retries": settings.general.retries,
        "storages": settings.storages,
        "archives": settings.archives,
    })
}

fn send_to_helper(state: &AppState, message: &serde_json::Value) -> Result<(), String> {
    let mut guard = state.helper.lock().unwrap();
    let helper = guard.as_mut().ok_or_else(|| "The background helper is not running.".to_string())?;
    let mut line = serde_json::to_string(message).map_err(|e| e.to_string())?;
    line.push('\n');
    helper
        .stdin
        .write_all(line.as_bytes())
        .and_then(|_| helper.stdin.flush())
        .map_err(|e| format!("The background helper did not answer: {e}"))
}

fn start_helper(app: &AppHandle) -> Result<(), String> {
    let binary = helper_path().ok_or_else(|| {
        "The bundled background helper is missing from this copy of the app.".to_string()
    })?;
    let mut child = Command::new(&binary)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Could not start the background helper: {e}"))?;
    let stdin = child.stdin.take().ok_or("The background helper has no input pipe.")?;
    let stdout = child.stdout.take().ok_or("The background helper has no output pipe.")?;
    let stderr = child.stderr.take();

    if let Some(stderr) = stderr {
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                log(&format!("helper: {line}"));
            }
        });
    }

    app.state::<AppState>().helper.lock().unwrap().replace(Helper { child, stdin });
    app.state::<AppState>().engine_error.lock().unwrap().take();

    // A helper restarted during an update hold is held first, so configuring it starts nothing.
    if app.state::<AppState>().hold.lock().unwrap().paused() {
        let _ = send_to_helper(&app.state::<AppState>(), &serde_json::json!({ "type": "hold", "ceiling": HOLD_TIMEOUT_DEFAULT_S }));
    }

    // Configure it with the saved storages straight away.
    let settings = app.state::<AppState>().settings.lock().unwrap().clone();
    let _ = send_to_helper(&app.state::<AppState>(), &helper_config(&settings));

    let app_handle = app.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            if line.trim().is_empty() {
                continue;
            }
            handle_helper_line(&app_handle, &line);
        }
        // The helper ended (crash, quit, or the app is going away).
        let state = app_handle.state::<AppState>();
        let gone = state.helper.lock().unwrap().take().is_some();
        if gone {
            *state.work.lock().unwrap() = Work::default();
            *state.work_version.lock().unwrap() += 1;
            log("The background helper stopped.");
            *state.engine_error.lock().unwrap() =
                Some("It stopped unexpectedly. Restart it here.".into());
            emit_snapshot(&app_handle);
        }
    });
    Ok(())
}

#[derive(Deserialize)]
#[serde(tag = "type")]
#[allow(dead_code)]
enum HelperEvent {
    #[serde(rename = "state")]
    State {
        items: Vec<HelperItem>,
        #[serde(default, rename = "inFlight")]
        in_flight: Vec<String>,
        #[serde(default)]
        queued: Vec<String>,
        #[serde(default)]
        deferred: Vec<String>,
        #[serde(default)]
        paused: bool,
    },
    #[serde(rename = "volumes")]
    Volumes { items: Vec<VolumeCandidate> },
    #[serde(rename = "attention")]
    Attention { id: String, name: String, reason: String },
    #[serde(rename = "recovered")]
    Recovered { id: String, name: String },
    #[serde(rename = "needs_credentials")]
    NeedsCredentials { id: String, name: String },
    #[serde(rename = "log")]
    Log { level: String, message: String },
    // The helper writes these keys in camelCase and leaves `error` out when there is none;
    // reading snake_case here made every share list decode as a fault (2026-11-22, 0.1.22).
    #[serde(rename = "shares")]
    Shares {
        host: String,
        shares: Vec<String>,
        #[serde(rename = "needsCredentials")]
        needs_credentials: bool,
        #[serde(default)]
        error: Option<String>,
    },
    #[serde(rename = "smb_mounts")]
    SmbMounts { items: Vec<ShareCandidate> },
    #[serde(rename = "archive")]
    Archive { job: JobView },
    #[serde(rename = "restorable")]
    Restorable {
        root: String,
        items: Vec<RestorableItem>,
        #[serde(default)]
        error: Option<String>,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HelperItem {
    id: String,
    #[serde(default)]
    status: String,
    #[serde(default)]
    detail: Option<String>,
    #[serde(default)]
    mounted_path: Option<String>,
    #[serde(default)]
    has_credentials: bool,
}

fn handle_helper_line(app: &AppHandle, line: &str) {
    let event: HelperEvent = match serde_json::from_str(line) {
        Ok(event) => event,
        Err(error) => {
            log(&format!("helper sent something unexpected ({error}): {line}"));
            return;
        }
    };
    let state = app.state::<AppState>();
    match event {
        HelperEvent::State { items, in_flight, queued, deferred, paused } => {
            let version = {
                let mut version = state.work_version.lock().unwrap();
                *version += 1;
                *version
            };
            *state.work.lock().unwrap() = Work { in_flight, queued, deferred, paused };
            acknowledge_hold(app, *state.work_type.lock().unwrap(), version);
            let mut statuses = state.statuses.lock().unwrap();
            statuses.clear();
            for item in items {
                statuses.insert(
                    item.id,
                    StorageState {
                        status: item.status,
                        detail: item.detail,
                        mounted_path: item.mounted_path,
                        has_credentials: item.has_credentials,
                    },
                );
            }
            drop(statuses);
            *state.last_checked.lock().unwrap() = Some(unix_millis() as u64);
            emit_snapshot(app);
        }
        HelperEvent::Volumes { items } => {
            *state.volumes.lock().unwrap() = items;
            emit_snapshot(app);
        }
        HelperEvent::Attention { name, reason, .. } => {
            log(&format!("{name} needs attention: {reason}"));
            notify(app, format!("{name} needs attention"), reason);
        }
        HelperEvent::Recovered { name, .. } => {
            log(&format!("{name} is connected again."));
            notify(app, name.clone(), format!("{name} is connected again."));
        }
        HelperEvent::NeedsCredentials { id, name } => {
            let _ = app.emit("needs-credentials", serde_json::json!({ "id": id, "name": name }));
            show_settings(app);
        }
        HelperEvent::Shares { host, shares, needs_credentials, error } => {
            let _ = app.emit(
                "shares",
                serde_json::json!({
                    "host": host,
                    "shares": shares,
                    "needsCredentials": needs_credentials,
                    "error": error,
                }),
            );
        }
        HelperEvent::SmbMounts { items } => {
            *state.smb_mounts.lock().unwrap() = items;
            emit_snapshot(app);
        }
        HelperEvent::Archive { job } => {
            log(&format!(
                "archive [{}] {}: {} of {} files",
                job.state, job.name, job.files_done, job.files_total
            ));
            if job.state == "archived" {
                let mut settings = state.settings.lock().unwrap();
                if let Some(archive) = settings.archives.iter_mut().find(|item| item.id == job.id) {
                    archive.last = Some(ArchiveLast {
                        at: unix_millis() as u64,
                        path: job.path.clone().unwrap_or_default(),
                        files: job.files_total,
                        bytes: job.bytes_total,
                    });
                    let _ = save_settings(&settings);
                }
            }
            *state.job.lock().unwrap() = Some(job);
            emit_snapshot(app);
        }
        HelperEvent::Restorable { root, items, error } => {
            *state.restorable.lock().unwrap() = Some(RestorableList { root, items, error });
            emit_snapshot(app);
        }
        HelperEvent::Log { level, message } => {
            log(&format!("helper [{level}]: {message}"));
            if message.starts_with("holding new work for an update") {
                acknowledge_hold(app, "hold", 0);
            } else if message == "resumed; new work is accepted again" {
                *app.state::<AppState>().work_pending.lock().unwrap() = Some(HoldWork::Settled);
            }
        }
    }
}

fn notify(app: &AppHandle, title: String, body: String) {
    if std::env::var("STORAGE_STUDIO_NO_NOTIFICATIONS").is_ok() {
        return;
    }
    if !app.state::<AppState>().settings.lock().unwrap().general.notifications {
        return;
    }
    use tauri_plugin_notification::{NotificationExt, PermissionState};
    // Ask only when there is something worth saying; a refused prompt stays quiet.
    if let Ok(state) = app.notification().permission_state() {
        if state != PermissionState::Granted
            && !matches!(app.notification().request_permission(), Ok(PermissionState::Granted))
        {
            return;
        }
    }
    if let Err(error) = app.notification().builder().title(title).body(body).show() {
        log(&format!("Could not show a notification: {error}"));
    }
}

// ---------------------------------------------------------------- login item

/// Only the installed copy may touch the login item. A bare `target/release` binary
/// registers under a phantom identity (owner-reported), and macOS re-points an existing
/// record at whichever .app copy registers — so a build-tree bundle takes the owner's item
/// too, not just a loose binary (issue 20261119-73).
fn is_installed_copy(exe: &std::path::Path) -> bool {
    let Some(app) = exe
        .ancestors()
        .find(|part| part.extension().is_some_and(|ext| ext == "app"))
    else {
        return false;
    };
    let Some(dir) = app.parent() else {
        return false;
    };
    dir == std::path::Path::new("/Applications")
        || std::env::var_os("HOME")
            .is_some_and(|home| std::path::Path::new(&home).join("Applications") == dir)
}

/// Registration is keyed to the app's identity: only call it when the state differs.
fn login_item_needs_change(status: i64, enabled: bool) -> bool {
    if enabled {
        status != 1
    } else {
        // 3 means "not found": there is nothing to unregister for this copy.
        status == 1 || status == 2
    }
}

#[cfg(target_os = "macos")]
mod login_item {
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};

    fn service() -> Option<Retained<AnyObject>> {
        unsafe { msg_send![class!(SMAppService), mainAppService] }
    }

    /// 0 = not registered, 1 = enabled, 2 = requires approval, 3 = not found.
    /// A copy that is not installed answers 3 without asking macOS: its own status is not
    /// the owner's record, and asking risks nothing but tells the truth less.
    pub fn status() -> i64 {
        if !can_register() {
            return 3;
        }
        match service() {
            Some(service) => unsafe { msg_send![&*service, status] },
            None => 3,
        }
    }

    pub fn is_enabled() -> bool {
        status() == 1
    }

    /// Only the copy in /Applications owns the login item. A development build (`cargo run`,
    /// a bare release binary, or a .app inside a build tree) must never register.
    pub fn can_register() -> bool {
        std::env::current_exe()
            .map(|exe| super::is_installed_copy(&exe))
            .unwrap_or(false)
    }

    pub fn set(enabled: bool) -> Result<(), String> {
        if enabled && !can_register() {
            return Err("Launch at login needs the installed app. Open Storage Studio KH from Applications.".into());
        }
        if !enabled && !can_register() {
            // Nothing to unregister for this copy, and unregistering here must never touch
            // the installed app's record.
            return Ok(());
        }
        let Some(service) = service() else {
            return Err("Login items are not available on this version of macOS.".into());
        };
        if !super::login_item_needs_change(status(), enabled) {
            return Ok(());
        }
        let mut error: *mut AnyObject = std::ptr::null_mut();
        let ok: bool = unsafe {
            if enabled {
                msg_send![&*service, registerAndReturnError: &mut error]
            } else {
                msg_send![&*service, unregisterAndReturnError: &mut error]
            }
        };
        if ok {
            Ok(())
        } else {
            Err(match status() {
                2 => "macOS is waiting for approval in System Settings > General > Login Items.".into(),
                _ => "macOS would not change the login item. Move the app to Applications and try again.".into(),
            })
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod login_item {
    pub fn status() -> i64 { 3 }
    pub fn is_enabled() -> bool { false }
    pub fn can_register() -> bool { false }
    pub fn set(_enabled: bool) -> Result<(), String> {
        Err("Launch at login is only available on macOS.".into())
    }
}

#[cfg(target_os = "macos")]
#[link(name = "ServiceManagement", kind = "framework")]
extern "C" {}

#[cfg(target_os = "macos")]
#[link(name = "AppKit", kind = "framework")]
extern "C" {}

// ---------------------------------------------------------------- windows

fn show_settings(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("settings") {
        // A window restored tiny or offscreen gets a sane frame again.
        if let Ok(size) = window.inner_size() {
            if size.width < 700 || size.height < 520 {
                let _ = window.set_size(tauri::LogicalSize::new(820.0, 640.0));
                let _ = window.center();
            }
        }
        let _ = window.show();
        let _ = window.unminimize();
        // show() is asynchronous on the main thread; focus once it has landed.
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Some(window) = handle.get_webview_window("settings") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        });
        return;
    }
    // The configured window can be gone (destroyed, or failed to create at launch). Build it on
    // demand so Settings always opens instead of doing nothing.
    if let Ok(window) = tauri::WebviewWindowBuilder::new(app, "settings", tauri::WebviewUrl::App("index.html".into()))
        .title(APP_NAME)
        .inner_size(820.0, 640.0)
        .min_inner_size(700.0, 520.0)
        .build()
    {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn hide_settings(window: &tauri::Window) {
    let _ = window.hide();
}

fn is_test_mode() -> bool {
    std::env::var("STORAGE_STUDIO_TEST_DATA_DIR").is_ok()
}

// ---------------------------------------------------------------- update hold

// `_orchestra/youtube-stack/update-hold/CONTRACT.md`: before an install the app holds new work,
// settles what is already running inside a bounded window, the update happens in that gap, and
// the app takes work again by itself. The pause lives in memory, so a restart is never held.

const HOLD_PATH: &str = "/api/maintenance/hold";
const HOLD_TOKEN_ENV: &str = "KHU_HOLD_TOKEN_FILE";
/// This app's row in the contract's port table. Fixed, because the signed feed names it as a
/// literal URL; `STORAGE_STUDIO_HOLD_PORT` only exists so a test instance can avoid the live one.
const HOLD_PORT: u16 = 8646;
const HOLD_TIMEOUT_DEFAULT_S: u64 = 20;
const HOLD_TIMEOUT_MAX_S: u64 = 30;
const HOLD_PAUSE_DEFAULT_S: u64 = 120;
/// A pause is a gap, not a latch: even a wild `pause_s` ends within an hour.
const HOLD_PAUSE_MAX_S: u64 = 3600;

fn hold_seconds(raw: Option<String>, default: u64, max: u64) -> u64 {
    raw.and_then(|value| value.trim().parse::<u64>().ok()).unwrap_or(default).min(max)
}

fn query_value(query: &str, key: &str) -> Option<String> {
    query.split('&').find_map(|pair| {
        let (name, value) = pair.split_once('=')?;
        (name == key).then(|| value.to_string())
    })
}

/// New work is refused while held, in plain words that say it is not a failure.
fn refuse_new_work(state: &AppState) -> Result<(), String> {
    let hold = state.hold.lock().unwrap();
    if !hold.paused() {
        return Ok(());
    }
    Err(format!(
        "Storage Studio KH is holding new work while an update installs. Nothing was started; it takes work again by itself in about {} s.",
        hold.seconds_left()
    ))
}

/// What a restart right now would strand: a mount running now, and a queued retry whose storage
/// the next start would not pick up again (only a login reconnect re-dispatches work).
fn unsettled(state: &AppState) -> Vec<String> {
    let work = state.work.lock().unwrap().clone();
    let settings = state.settings.lock().unwrap();
    let name = |id: &str| {
        settings
            .storages
            .iter()
            .find(|storage| storage.id == id)
            .map(|storage| storage.name.clone())
            .unwrap_or_else(|| id.to_string())
    };
    let mut out: Vec<String> = work
        .in_flight
        .iter()
        .map(|id| {
            // The helper names an archive job `archive:<row id>`; say what it is, not "(mounting)".
            if let Some(archive_id) = id.strip_prefix("archive:") {
                let label = settings
                    .archives
                    .iter()
                    .find(|archive| archive.id == archive_id)
                    .map(|archive| archive.name.clone())
                    .unwrap_or_else(|| archive_id.to_string());
                return format!("{label} (archiving)");
            }
            format!("{} (mounting)", name(id))
        })
        .collect();
    // A hold-deferred claim is resumable by this helper. A retry timer dies with the process, so
    // it is only stranded when the next start would not re-dispatch it (no login reconnect).
    for id in &work.queued {
        let follows_next_start = settings
            .storages
            .iter()
            .any(|storage| &storage.id == id && storage.reconnect_at_login);
        if !follows_next_start {
            out.push(format!("{} (retry pending)", name(id)));
        }
    }
    out
}

fn tell_helper(app: &AppHandle, kind: &str, ceiling_s: u64) {
    let state = app.state::<AppState>();
    *state.work_type.lock().unwrap() = if kind == "resume" { "resume" } else { "hold" };
    // The helper is told the ceiling it must answer inside, so its own log can name it.
    let message = if kind == "hold" {
        serde_json::json!({ "type": kind, "ceiling": ceiling_s })
    } else {
        serde_json::json!({ "type": kind })
    };
    if let Err(error) = send_to_helper(&state, &message) {
        if kind == "hold" || kind == "resume" {
            // Without a helper, no mount is running and the hold can answer from that truth.
            let version = {
                let mut version = state.work_version.lock().unwrap();
                *version += 1;
                *version
            };
            *state.work.lock().unwrap() = Work::default();
            acknowledge_hold(app, kind, version);
        }
        log(&format!("hold: the helper did not take '{kind}': {error}"));
    }
}

/// Records the helper's own post-hold outcome. Returns true when a mount was still running, so a
/// later settle can report it; a newer outcome always replaces an older one.
fn record_hold_outcome(awaiting: &mut Option<HoldWork>, kind: &str, in_flight: usize) -> bool {
    if kind == "resume" {
        *awaiting = Some(HoldWork::Settled);
        return false;
    }
    let pending = if in_flight == 0 { HoldWork::Settled } else { HoldWork::Held };
    let previous = awaiting.replace(pending);
    pending == HoldWork::Held || previous == Some(HoldWork::Held)
}

/// A state report without a new revision is the helper's own outcome, not its echoed command.
fn acknowledge_hold(app: &AppHandle, kind: &str, version: u64) {
    let state = app.state::<AppState>();
    if *state.work_revision.lock().unwrap() == version {
        return;
    }
    let in_flight = state.work.lock().unwrap().in_flight.len();
    let held = record_hold_outcome(&mut state.work_pending.lock().unwrap(), kind, in_flight);
    *state.work_revision.lock().unwrap() = version;
    if kind == "hold" {
        log(if held { "the helper has paused new work" } else { "the helper has already paused new work" });
    }
}

/// POST: pause new work now, settle running work up to `timeout_s`, answer whether a restart is safe.
fn hold_request(app: &AppHandle, query: &str) -> String {
    let timeout_s = hold_seconds(query_value(query, "timeout_s"), HOLD_TIMEOUT_DEFAULT_S, HOLD_TIMEOUT_MAX_S);
    let pause_s = hold_seconds(query_value(query, "pause_s"), HOLD_PAUSE_DEFAULT_S, HOLD_PAUSE_MAX_S).max(1);
    let state = app.state::<AppState>();
    {
        let mut awaiting = state.work_pending.lock().unwrap();
        *awaiting = None;
    }
    let generation = {
        let mut hold = state.hold.lock().unwrap();
        hold.generation += 1;
        hold.until = Some(Instant::now() + Duration::from_secs(pause_s));
        hold.generation
    };
    let started = Instant::now();
    arm_resume(app.clone(), generation, pause_s);
    tell_helper(app, "hold", timeout_s);
    log(&format!("held new work for an update (paused {pause_s} s)"));
    emit_snapshot(app);

    // Wait for the helper's own answer: a fresh report AND the helper saying it is paused. A
    // state report that lands before the helper has taken the hold says `paused: false`, so it
    // cannot end the wait early and claim a pause that has not happened.
    // A helper started moments ago needs a moment to answer; this stays well inside the settle.
    let fresh_deadline = Instant::now() + Duration::from_secs(3);
    while state.work_pending.lock().unwrap().is_none() || !state.work.lock().unwrap().paused {
        // No helper: nothing can be mounting, so the hold answers from that truth.
        if state.helper.lock().unwrap().is_none() {
            break;
        }
        if Instant::now() >= fresh_deadline {
            // Plain words, the guard named, and the moment kept: the updater should never have to
            // say "did not pause" on this app's behalf.
            let in_flight = state.work.lock().unwrap().in_flight.len();
            let reason = format!(
                "The background helper is running but did not answer the pause within 3 s (the hold's ceiling is {timeout_s} s); nothing was changed."
            );
            let ms = started.elapsed().as_millis();
            log(&format!("update hold: NOT paused after {ms} ms (ceiling {timeout_s} s) — {reason}"));
            record_hold_attempt("hold", timeout_s, ms, false, in_flight, Some(&reason));
            return serde_json::json!({
                "safe": false,
                "unsettled": [reason],
                "dispatch_paused_s": pause_s,
                "in_flight": in_flight,
            }).to_string();
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    *state.work_pending.lock().unwrap() = None;
    // The newest mount attempt may finish; the retry queue is never waited for.
    let settle_deadline = Instant::now() + Duration::from_secs(timeout_s);
    while !state.work.lock().unwrap().in_flight.is_empty() && Instant::now() < settle_deadline {
        std::thread::sleep(Duration::from_millis(50));
    }
    let in_flight = state.work.lock().unwrap().in_flight.len();
    let unsettled = unsettled(&state);
    let safe = unsettled.is_empty();
    let ms = started.elapsed().as_millis();
    // The app's own record of the handshake: moment, what was asked, how long it took, what happened.
    log(&format!(
        "update hold: {} in {ms} ms (ceiling {timeout_s} s, pause {pause_s} s, {in_flight} in flight){}",
        if safe { "safe" } else { "not safe" },
        if unsettled.is_empty() { String::new() } else { format!(" — still in flight: {}", unsettled.join(", ")) }
    ));
    let why = if safe { None } else { Some(unsettled.join(", ")) };
    record_hold_attempt("hold", timeout_s, ms, safe, in_flight, why.as_deref());
    serde_json::json!({
        "safe": safe,
        "unsettled": unsettled,
        "dispatch_paused_s": pause_s,
        "in_flight": in_flight,
    })
    .to_string()
}

/// DELETE: resume at once. Never required — the pause expires by itself.
fn resume_request(app: &AppHandle) -> String {
    let state = app.state::<AppState>();
    {
        let mut hold = state.hold.lock().unwrap();
        hold.generation += 1;
        hold.until = None;
    }
    tell_helper(app, "resume", 0);
    log("resumed; new work is accepted again");
    emit_snapshot(app);
    let in_flight = state.work.lock().unwrap().in_flight.len();
    serde_json::json!({
        "safe": true,
        "unsettled": Vec::<String>::new(),
        "dispatch_paused_s": 0,
        "in_flight": in_flight,
    })
    .to_string()
}

/// An install that never comes back must not leave the app refusing work: the pause ends itself.
fn arm_resume(app: AppHandle, generation: u64, pause_s: u64) {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(pause_s));
        let state = app.state::<AppState>();
        let expired = {
            let mut hold = state.hold.lock().unwrap();
            let current = hold.generation == generation;
            if current {
                hold.until = None;
            }
            current
        };
        if !expired {
            return; // a newer hold renewed the pause
        }
        if let Err(error) = send_to_helper(&state, &serde_json::json!({ "type": "resume" })) {
            log(&format!("hold: the pause expired but the helper did not hear it: {error}"));
        }
        log("the update pause expired; new work is accepted again");
        emit_snapshot(&app);
    });
}

fn start_hold_server(app: AppHandle) {
    let port = std::env::var("STORAGE_STUDIO_HOLD_PORT")
        .ok()
        .and_then(|value| value.trim().parse::<u16>().ok())
        .unwrap_or(HOLD_PORT);
    let listener = match TcpListener::bind(("127.0.0.1", port)) {
        Ok(listener) => listener,
        Err(error) => {
            log(&format!("the update hold is not listening on 127.0.0.1:{port}: {error}"));
            return;
        }
    };
    log(&format!("update hold listening on http://127.0.0.1:{port}{HOLD_PATH}"));
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            match stream {
                // One thread per request: a settle must never block a DELETE.
                Ok(stream) => {
                    let app = app.clone();
                    std::thread::spawn(move || handle_hold_connection(&app, stream));
                }
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(error) => log(&format!("update hold: {error}")),
            }
        }
    });
}

fn hold_token_path() -> PathBuf {
    if let Ok(override_path) = std::env::var(HOLD_TOKEN_ENV) {
        let trimmed = override_path.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }
    let own = data_dir().join("hold-token");
    let marker = data_dir().join(".hold-token-migrated");
    if !own.exists() && !marker.exists() {
        let home = std::env::var("HOME").unwrap_or_default();
        let legacy = PathBuf::from(home).join("Library").join("KHUpdater").join("state").join("hold-token");
        migrate_legacy_hold_token(&legacy, &own, &marker);
    }
    own
}

/// RELEASE-POLICY §2d: the app reads its own token; a legacy updater-side token is copied here
/// exactly once, the move is logged, and the old path is never read again. A marker proves the
/// copy was attempted, so deleting the app's token later cannot quietly re-create the tenancy.
fn migrate_legacy_hold_token(legacy: &Path, own: &Path, marker: &Path) {
    let Ok(meta) = std::fs::symlink_metadata(legacy) else { return };
    if meta.file_type().is_symlink() || !meta.is_file() {
        log(&format!(
            "the updater's hold token at {} is not a regular file; it was not copied",
            legacy.display()
        ));
        return;
    }
    let Ok(bytes) = std::fs::read(legacy) else {
        log(&format!("the updater's hold token at {} could not be read; it was not copied", legacy.display()));
        return;
    };
    if let Some(dir) = own.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let write = || -> std::io::Result<()> {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(own)?;
        file.write_all(&bytes)
    };
    match write() {
        Ok(()) => {
            let _ = std::fs::write(marker, "");
            log(&format!(
                "the hold token was copied from {} to {}; the updater's shared file is left in place",
                legacy.display(),
                own.display()
            ));
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => log(&format!(
            "the hold token could not be moved from {} to {}: {error}",
            legacy.display(),
            own.display()
        )),
    }
}

/// Why the token file cannot be trusted, in words the updater and the log can print; `None` when
/// it is usable. The 0600 rule is enforced here, not just documented (§2d): a token another user
/// can read is refused, and so is anything that is not 64 hex characters.
fn hold_token_fault(path: &Path) -> Option<String> {
    let meta = match std::fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(_) => return Some("the token file is missing".into()),
    };
    if meta.file_type().is_symlink() {
        return Some("the token file is a symlink".into());
    }
    if !meta.is_file() {
        return Some("the token is not a regular file".into());
    }
    if meta.len() > 512 {
        return Some("the token file is oversized".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = meta.permissions().mode() & 0o777;
        if mode & 0o077 != 0 {
            return Some(format!(
                "the token file is readable or writable by other users (mode {mode:03o}); it must be 600"
            ));
        }
    }
    let raw = match std::fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(_) => return Some("the token file cannot be read".into()),
    };
    let token = raw.trim();
    if token.is_empty() {
        return Some("the token file is empty".into());
    }
    if token.len() != 64 || !token.chars().all(|c| c.is_ascii_hexdigit()) {
        return Some("the token is not 64 hex characters".into());
    }
    None
}

/// Reads the Launcher's hold credential fresh on every request so an atomic rotation takes effect
/// without restarting the app. Anything `hold_token_fault` names fails closed.
fn read_hold_token_at(path: &Path) -> Option<String> {
    if hold_token_fault(path).is_some() {
        return None;
    }
    let raw = std::fs::read_to_string(path).ok()?;
    Some(raw.trim().to_string())
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (&x, &y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

fn authorize_hold_headers(headers: &[(String, String)], token_path: &Path) -> Result<(), String> {
    // Reject browser-origin requests even on loopback.
    if headers.iter().any(|(name, _)| name.eq_ignore_ascii_case("origin")) {
        return Err("a browser origin is not allowed".into());
    }
    let Some(expected) = read_hold_token_at(token_path) else {
        return Err(hold_token_fault(token_path).unwrap_or_else(|| "the hold token is unavailable".into()));
    };
    let mut bearer: Option<&str> = None;
    let mut hub_token: Option<&str> = None;
    for (name, value) in headers {
        if name.eq_ignore_ascii_case("authorization") {
            let trimmed = value.trim();
            // ASCII compare on bytes: a multibyte value must not panic on a slice boundary.
            if trimmed.len() >= 7 && trimmed.as_bytes()[..7].eq_ignore_ascii_case(b"bearer ") {
                let candidate = trimmed[7..].trim();
                if !candidate.is_empty() {
                    bearer = Some(candidate);
                }
            }
        } else if name.eq_ignore_ascii_case("x-hub-token") {
            let candidate = value.trim();
            if !candidate.is_empty() {
                hub_token = Some(candidate);
            }
        }
    }
    if bearer.is_none() && hub_token.is_none() {
        return Err("no hold token was sent".into());
    }
    let expected_bytes = expected.as_bytes();
    let bearer_ok = bearer.map_or(true, |token| constant_time_eq(token.as_bytes(), expected_bytes));
    let hub_ok = hub_token.map_or(true, |token| constant_time_eq(token.as_bytes(), expected_bytes));
    if bearer_ok && hub_ok {
        Ok(())
    } else {
        Err("the hold token does not match".into())
    }
}

enum HoldDispatch {
    Hold,
    Resume,
    Error(&'static str, String),
}

fn route_hold_request(
    method: &str,
    path: &str,
    headers: &[(String, String)],
    token_path: &Path,
) -> HoldDispatch {
    if path != HOLD_PATH {
        return HoldDispatch::Error("404 Not Found", r#"{"error":"no such route"}"#.to_string());
    }
    if let Err(reason) = authorize_hold_headers(headers, token_path) {
        // The refusal says why on the route itself, not only in the app's log.
        log(&format!("update hold refused: {reason}"));
        let body = serde_json::json!({ "error": "unauthorized", "reason": reason }).to_string();
        return HoldDispatch::Error("401 Unauthorized", body);
    }
    match method {
        "POST" => HoldDispatch::Hold,
        "DELETE" => HoldDispatch::Resume,
        _ => HoldDispatch::Error("405 Method Not Allowed", r#"{"error":"use POST or DELETE"}"#.to_string()),
    }
}

fn handle_hold_connection(app: &AppHandle, mut stream: TcpStream) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));
    let Ok(reader_stream) = stream.try_clone() else { return };
    let mut reader = BufReader::new(reader_stream);
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() {
        return;
    }
    let mut headers: Vec<(String, String)> = Vec::new();
    let mut total_bytes = request_line.len();
    for _ in 0..64 {
        let mut line = String::new();
        match reader.read_line(&mut line) {
            Ok(0) => break,
            Ok(_) if line.trim().is_empty() => break,
            Ok(n) => {
                total_bytes += n;
                if total_bytes > 8192 {
                    break;
                }
                if let Some((name, value)) = line.split_once(':') {
                    headers.push((name.trim().to_string(), value.trim().to_string()));
                }
            }
            Err(_) => break,
        }
    }
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("");
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    let (status, body) = match route_hold_request(method, path, &headers, &hold_token_path()) {
        HoldDispatch::Hold => ("200 OK", hold_request(app, query)),
        HoldDispatch::Resume => ("200 OK", resume_request(app)),
        HoldDispatch::Error(status, json) => (status, json.to_string()),
    };
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

// ---------------------------------------------------------------- commands

#[tauri::command]
fn get_snapshot(app: AppHandle) -> Snapshot {
    snapshot(&app)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StorageInput {
    id: Option<String>,
    name: String,
    kind: String,
    target: String,
    #[serde(default)]
    mount_point: String,
    #[serde(default, rename = "volumeUUID")]
    volume_uuid: Option<String>,
    #[serde(default)]
    reconnect_at_login: bool,
    #[serde(default)]
    reconnect_after_wake: bool,
    #[serde(default)]
    username: Option<String>,
    #[serde(default)]
    password: Option<String>,
    #[serde(default)]
    remove_credentials: bool,
}

fn clean(value: &str) -> String {
    value.trim().to_string()
}

fn validate_input(input: &StorageInput) -> Result<(), String> {
    if clean(&input.name).is_empty() {
        return Err("Give this storage a name.".into());
    }
    match input.kind.as_str() {
        "smb" => {
            let target = clean(&input.target);
            if !target.starts_with("smb://") || target.trim_start_matches("smb://").is_empty() {
                return Err("Use a share address like smb://nas.local/photos.".into());
            }
            if target.matches('/').count() < 3 {
                return Err("Include the share name, like smb://nas.local/photos.".into());
            }
        }
        "volume" => {
            if clean(&input.mount_point).is_empty() {
                return Err("Choose the disk to reconnect.".into());
            }
        }
        _ => return Err("Choose SMB share or attached disk.".into()),
    }
    Ok(())
}

#[tauri::command]
fn save_storage(app: AppHandle, state: State<'_, AppState>, input: StorageInput) -> Result<Snapshot, String> {
    validate_input(&input)?;
    let id = input.id.clone().unwrap_or_else(|| format!("s{}", unix_millis()));
    let storage = Storage {
        id: id.clone(),
        name: clean(&input.name),
        kind: input.kind.clone(),
        target: clean(&input.target),
        mount_point: clean(&input.mount_point),
        volume_uuid: input.volume_uuid.clone().filter(|v| !v.trim().is_empty()),
        reconnect_at_login: input.reconnect_at_login,
        reconnect_after_wake: input.reconnect_after_wake,
        username: input.username.clone().filter(|v| !v.trim().is_empty()),
    };
    let password = input.password.clone().unwrap_or_default();

    {
        let mut settings = state.settings.lock().unwrap();
        let previous = settings.storages.iter().find(|s| s.id == id).cloned();
        let is_new = previous.is_none();
        // A changed user name leaves the old key behind unless it is forgotten before the
        // helper is reconfigured with the new identity.
        let old_username = previous.and_then(|old| {
            (old.kind == "smb" && old.username != storage.username).then_some(old.username.unwrap_or_default())
        });
        if let Some(existing) = settings.storages.iter_mut().find(|s| s.id == id) {
            *existing = storage.clone();
        } else {
            settings.storages.push(storage.clone());
        }
        save_settings(&settings)?;

        if let Some(username) = old_username {
            let _ = send_to_helper(
                &state,
                &serde_json::json!({ "type": "forget_credentials", "id": id, "username": username }),
            );
        }

        let credentials = if input.remove_credentials {
            Some(serde_json::json!({ "type": "forget_credentials", "id": id }))
        } else if !password.is_empty() {
            Some(serde_json::json!({
                "type": "credentials",
                "id": id,
                "username": storage.username.clone().unwrap_or_default(),
                "password": password,
            }))
        } else {
            None
        };

        if is_new && !input.remove_credentials && !password.is_empty() {
            // Configure the new share without reconnect flags so it cannot mount (and ask for a
            // password) before the credentials line behind it is read; then restore the flags.
            let mut quiet = settings.clone();
            for item in quiet.storages.iter_mut() {
                if item.id == id {
                    item.reconnect_at_login = false;
                    item.reconnect_after_wake = false;
                }
            }
            let _ = send_to_helper(&state, &helper_config(&quiet));
            if let Some(message) = &credentials {
                let _ = send_to_helper(&state, message);
            }
            let _ = send_to_helper(&state, &helper_config(&settings));
        } else {
            let _ = send_to_helper(&state, &helper_config(&settings));
            if let Some(message) = &credentials {
                // The settings are already saved; a helper that is down is reported by the banner.
                if let Err(error) = send_to_helper(&state, message) {
                    log(&format!("credentials: {error}"));
                }
            }
        }
    }
    emit_snapshot(&app);
    Ok(snapshot(&app))
}

/// Case, a leading user name, a trailing slash and %-escapes do not make a new share.
fn share_key(target: &str) -> String {
    let lower = target.trim().to_lowercase();
    let rest = lower.strip_prefix("smb://").unwrap_or(&lower);
    let after_query = rest.split('?').next().unwrap_or(rest);
    let after_query = after_query.split('#').next().unwrap_or(after_query);
    let after_user = match after_query.split_once('@') {
        Some((_, host)) => host,
        None => after_query,
    };
    let mut decoded = String::new();
    let mut chars = after_user.chars();
    while let Some(character) = chars.next() {
        if character == '%' {
            let hex: String = chars.by_ref().take(2).collect();
            if hex.len() == 2 {
                if let Ok(byte) = u8::from_str_radix(&hex, 16) {
                    decoded.push(byte as char);
                    continue;
                }
            }
            decoded.push('%');
            decoded.push_str(&hex);
        } else {
            decoded.push(character);
        }
    }
    let decoded = decoded.trim_end_matches('/').to_string();
    let decoded = match decoded.split_once('/') {
        Some((host, path)) => {
            let mut resolved: Vec<&str> = Vec::new();
            for segment in path.split('/').filter(|part| !part.is_empty()) {
                match segment {
                    "." => {}
                    ".." => {
                        resolved.pop();
                    }
                    other => resolved.push(other),
                }
            }
            let host = host.strip_suffix(":445").unwrap_or(host);
            if resolved.is_empty() {
                host.to_string()
            } else {
                format!("{host}/{}", resolved.join("/"))
            }
        }
        None => decoded.strip_suffix(":445").unwrap_or(&decoded).to_string(),
    };
    decoded
}

/// The same share is one mount whether or not a user name is written in front of the host.
fn same_storage(a: &Storage, b: &Storage) -> bool {
    if a.kind != b.kind {
        return false;
    }
    if a.kind == "smb" {
        share_key(&a.target) == share_key(&b.target)
    } else {
        match (&a.volume_uuid, &b.volume_uuid) {
            (Some(left), Some(right)) => left == right,
            _ => a.id == b.id,
        }
    }
}

#[tauri::command]
fn remove_storage(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<Snapshot, String> {
    let mut removed_ids = vec![id.clone()];
    {
        let mut settings = state.settings.lock().unwrap();
        let Some(removed) = settings.storages.iter().find(|s| s.id == id).cloned() else {
            return Ok(snapshot(&app));
        };
        // The helper must still know the storage when it is told to forget the password.
        let _ = send_to_helper(&state, &serde_json::json!({ "type": "forget_credentials", "id": id }));
        // One visible row may stand for several legacy entries; removing it removes them all.
        removed_ids = settings.storages.iter().filter(|s| same_storage(s, &removed)).map(|s| s.id.clone()).collect();
        settings.storages.retain(|s| !same_storage(s, &removed));
        save_settings_after_removal(&settings)?;
        let _ = send_to_helper(&state, &helper_config(&settings));
    }
    {
        let mut statuses = state.statuses.lock().unwrap();
        for removed in &removed_ids {
            statuses.remove(removed);
        }
    }
    emit_snapshot(&app);
    Ok(snapshot(&app))
}

#[tauri::command]
fn mount_storage(state: State<'_, AppState>, id: String) -> Result<(), String> {
    refuse_new_work(&state)?;
    send_to_helper(&state, &serde_json::json!({ "type": "mount", "id": id }))
}

#[tauri::command]
fn mount_all(state: State<'_, AppState>) -> Result<(), String> {
    refuse_new_work(&state)?;
    send_to_helper(&state, &serde_json::json!({ "type": "mount_all" }))
}

#[tauri::command]
fn unmount_storage(state: State<'_, AppState>, id: String) -> Result<(), String> {
    send_to_helper(&state, &serde_json::json!({ "type": "unmount", "id": id }))
}

/// Stop a mount or a waiting retry. Stopping is not new work, so a held app still allows it.
#[tauri::command]
fn cancel_storage(state: State<'_, AppState>, id: String) -> Result<(), String> {
    send_to_helper(&state, &serde_json::json!({ "type": "cancel", "id": id }))
}

#[tauri::command]
fn test_storage(state: State<'_, AppState>, id: String) -> Result<(), String> {
    refuse_new_work(&state)?;
    send_to_helper(&state, &serde_json::json!({ "type": "test", "id": id }))
}

#[tauri::command]
fn refresh_storage(state: State<'_, AppState>) -> Result<(), String> {
    send_to_helper(&state, &serde_json::json!({ "type": "refresh" }))
}

fn host_from_address(address: &str) -> Option<String> {
    let text = address.trim().trim_start_matches("smb://");
    let host = text.split('/').next().unwrap_or("").trim();
    if host.is_empty() { None } else { Some(host.to_string()) }
}

#[tauri::command]
fn list_shares(
    state: State<'_, AppState>,
    address: String,
    username: Option<String>,
    password: Option<String>,
) -> Result<(), String> {
    let host = host_from_address(&address).ok_or("Enter a device address like 192.168.0.217.")?;
    send_to_helper(
        &state,
        &serde_json::json!({
            "type": "list_shares",
            "host": host,
            "username": username,
            "password": password,
        }),
    )
}

#[tauri::command]
fn reveal_storage(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let path = {
        let statuses = state.statuses.lock().unwrap();
        statuses.get(&id).and_then(|s| s.mounted_path.clone())
    };
    let settings = state.settings.lock().unwrap();
    let storage = settings.storages.iter().find(|s| s.id == id).ok_or("That storage is no longer in the list.")?;
    let path = path.or_else(|| if storage.mount_point.is_empty() { None } else { Some(storage.mount_point.clone()) });
    let path = path.ok_or("That storage is not mounted yet.")?;
    if !Path::new(&path).exists() {
        return Err(format!("{path} is not available right now."));
    }
    Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|_| "Could not open that folder in Finder.".to_string())?;
    Ok(())
}

// ---------------------------------------------------------------- channel archives

/// A Story channel's `project.json`, read for four fields only. Nothing else in a channel is
/// interpreted: Storage copies bytes, it does not learn what an episode is.
#[derive(Deserialize)]
struct ChannelMeta {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    slug: Option<String>,
    #[serde(default)]
    project_id: Option<String>,
    #[serde(default)]
    media_root: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArchiveInput {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    name: Option<String>,
    folder: String,
    #[serde(default)]
    media_folder: Option<String>,
    destination: String,
}

fn channel_meta(folder: &Path) -> Option<ChannelMeta> {
    let text = std::fs::read_to_string(folder.join("project.json")).ok()?;
    serde_json::from_str::<ChannelMeta>(&text).ok()
}

fn child_channel_count(folder: &Path) -> usize {
    let Ok(entries) = std::fs::read_dir(folder) else { return 0 };
    entries
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.path().is_dir() && entry.path().join("project.json").is_file())
        .count()
}

fn require_folder(raw: &str, what: &str) -> Result<PathBuf, String> {
    let text = raw.trim();
    if text.is_empty() {
        return Err(format!("Choose {what}."));
    }
    let path = PathBuf::from(text);
    if !path.is_absolute() {
        return Err(format!("{what} needs a full path. Choose it with the folder panel."));
    }
    if !path.is_dir() {
        return Err(format!("{text} isn't a folder on this Mac right now."));
    }
    Ok(path)
}

fn inside(child: &Path, parent: &Path) -> bool {
    let child = child.canonicalize().unwrap_or_else(|_| child.to_path_buf());
    let parent = parent.canonicalize().unwrap_or_else(|_| parent.to_path_buf());
    child != parent && child.starts_with(&parent)
}

/// What the Add sheet needs to know about a picked folder before it is saved. Read-only.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ChannelInspect {
    is_channel: bool,
    name: Option<String>,
    slug: Option<String>,
    has_media_root: bool,
    looks_like_library: bool,
}

#[tauri::command]
fn inspect_channel(folder: String) -> Result<ChannelInspect, String> {
    let path = require_folder(&folder, "the channel's folder")?;
    let meta = channel_meta(&path);
    Ok(ChannelInspect {
        is_channel: meta.is_some(),
        name: meta.as_ref().and_then(|meta| meta.name.clone()),
        slug: meta.as_ref().and_then(|meta| meta.slug.clone()),
        has_media_root: meta
            .as_ref()
            .and_then(|meta| meta.media_root.clone())
            .map(|root| !root.trim().is_empty())
            .unwrap_or(false),
        looks_like_library: path.join("_trash").is_dir() || child_channel_count(&path) > 1,
    })
}

/// The Add sheet saves the row; nothing is copied until Archive is pressed. A picked folder is
/// the channel: the app never scans a disk for channels or guesses which one is meant.
#[tauri::command]
fn archive_add(app: AppHandle, state: State<'_, AppState>, input: ArchiveInput) -> Result<Snapshot, String> {
    let folder = require_folder(&input.folder, "the channel's folder")?;
    if folder.join("_trash").is_dir() || child_channel_count(&folder) > 1 {
        return Err("That looks like the Library, not one channel. Choose the channel's own folder.".into());
    }
    let destination = require_folder(&input.destination, "where the archive goes")?;
    let media = match input.media_folder.as_deref().map(str::trim).filter(|text| !text.is_empty()) {
        Some(raw) => {
            let media = require_folder(raw, "the channel's media folder")?;
            if media == folder || inside(&media, &folder) {
                return Err("That media folder is already inside the channel's folder, so it is copied with it.".into());
            }
            Some(media)
        }
        None => None,
    };

    let meta = channel_meta(&folder);
    let folder_name = folder.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
    if folder_name.is_empty() {
        return Err("That folder can't be used as a channel.".into());
    }
    let slug = meta
        .as_ref()
        .and_then(|meta| meta.slug.clone())
        .filter(|slug| !slug.trim().is_empty() && !slug.contains('/'))
        .unwrap_or(folder_name.clone());
    let name = input
        .name
        .as_deref()
        .map(clean)
        .filter(|name| !name.is_empty())
        .or_else(|| meta.as_ref().and_then(|meta| meta.name.clone()).filter(|name| !name.trim().is_empty()))
        .unwrap_or(folder_name);
    let project_id = meta.as_ref().and_then(|meta| meta.project_id.clone()).filter(|id| !id.trim().is_empty());

    let mut roots = vec![folder.to_string_lossy().into_owned()];
    if let Some(media) = media {
        roots.push(media.to_string_lossy().into_owned());
    }

    {
        let mut settings = state.settings.lock().unwrap();
        let id = input.id.clone().unwrap_or_else(|| format!("a{}", unix_millis()));
        let previous_last = settings.archives.iter().find(|item| item.id == id).and_then(|item| item.last.clone());
        let archive = Archive {
            id: id.clone(),
            name,
            slug,
            project_id,
            roots,
            destination: destination.to_string_lossy().into_owned(),
            last: previous_last,
        };
        if let Some(existing) = settings.archives.iter_mut().find(|item| item.id == id) {
            *existing = archive;
        } else {
            settings.archives.push(archive);
        }
        save_settings(&settings)?;
        let _ = send_to_helper(&state, &helper_config(&settings));
    }
    emit_snapshot(&app);
    Ok(snapshot(&app))
}

/// Forgetting a row deletes nothing: the archive stays where it is on the destination.
#[tauri::command]
fn archive_remove(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<Snapshot, String> {
    {
        let mut settings = state.settings.lock().unwrap();
        settings.archives.retain(|archive| archive.id != id);
        save_settings_after_removal(&settings)?;
        let _ = send_to_helper(&state, &helper_config(&settings));
    }
    emit_snapshot(&app);
    Ok(snapshot(&app))
}

#[tauri::command]
fn archive_start(state: State<'_, AppState>, id: String) -> Result<(), String> {
    refuse_new_work(&state)?;
    send_to_helper(&state, &serde_json::json!({ "type": "archive_start", "id": id }))
}

#[tauri::command]
fn archive_reveal(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let path = {
        let settings = state.settings.lock().unwrap();
        let archive = settings.archives.iter().find(|item| item.id == id).ok_or("That row is no longer in the list.")?;
        archive
            .last
            .as_ref()
            .map(|last| last.path.clone())
            .unwrap_or_else(|| archive.destination.clone())
    };
    if !Path::new(&path).exists() {
        return Err(format!("{path} is not available right now."));
    }
    Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|_| "Could not open that folder in Finder.".to_string())?;
    Ok(())
}

#[tauri::command]
fn restore_scan(app: AppHandle, state: State<'_, AppState>, root: String) -> Result<(), String> {
    *state.restorable.lock().unwrap() = None;
    emit_snapshot(&app);
    send_to_helper(&state, &serde_json::json!({ "type": "restore_scan", "root": root.trim() }))
}

#[tauri::command]
fn restore_start(
    state: State<'_, AppState>,
    archive_path: String,
    destination: String,
) -> Result<(), String> {
    refuse_new_work(&state)?;
    send_to_helper(
        &state,
        &serde_json::json!({
            "type": "restore_start",
            "archivePath": archive_path,
            "destination": destination,
        }),
    )
}

/// Stop a running archive at its next file boundary. The part-copied archive stays on the
/// destination, and the job says where it is, so the row never sits at "Archiving…" with no control.
#[tauri::command]
fn archive_cancel(state: State<'_, AppState>) -> Result<(), String> {
    send_to_helper(&state, &serde_json::json!({ "type": "archive_cancel" }))
}

/// Free up space: move the archived channel folder(s) to the Trash. The helper refuses unless the
/// archive's own manifest says it was verified, and it never deletes — emptying the Trash is the
/// person's step.
#[tauri::command]
fn archive_free_space(state: State<'_, AppState>, path: String) -> Result<(), String> {
    refuse_new_work(&state)?;
    if !Path::new(&path).is_dir() {
        return Err(format!("{path} is not available right now."));
    }
    send_to_helper(
        &state,
        &serde_json::json!({ "type": "archive_trash", "archivePath": path }),
    )
}

/// Archive a channel again from an archive's own manifest, for when the row that made it is gone.
#[tauri::command]
fn archive_again(state: State<'_, AppState>, path: String) -> Result<(), String> {
    refuse_new_work(&state)?;
    if !Path::new(&path).is_dir() {
        return Err(format!("{path} is not available right now."));
    }
    send_to_helper(
        &state,
        &serde_json::json!({ "type": "archive_again", "archivePath": path }),
    )
}

/// The storage form never types a filesystem path: macOS's own folder panel is the only way to
/// set a mount point, and the field is read-only afterwards. A cancelled panel answers `None`.
/// `message` names what the panel is for, so an archive's folder is not asked for with a
/// sentence about mounting.
#[tauri::command]
async fn pick_mount_point(
    app: AppHandle,
    start_dir: Option<String>,
    message: Option<String>,
) -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        let (sender, receiver) = std::sync::mpsc::channel();
        let start = start_dir.unwrap_or_default();
        let message = message.unwrap_or_else(|| "Choose a folder to mount the share at".into());
        app.run_on_main_thread(move || {
            let _ = sender.send(folder_panel(&start, &message));
        })
        .map_err(|e| format!("The folder chooser could not open: {e}"))?;
        // The panel is modal on the main thread; wait off it so the rest of the app keeps painting.
        tauri::async_runtime::spawn_blocking(move || receiver.recv().ok().flatten())
            .await
            .map_err(|e| format!("The folder chooser did not answer: {e}"))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, start_dir, message);
        Err("Choosing a folder needs macOS.".into())
    }
}

#[cfg(target_os = "macos")]
fn folder_panel(start: &str, message: &str) -> Option<String> {
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    use std::ffi::{CStr, CString};

    unsafe {
        let panel: Retained<AnyObject> = msg_send![class!(NSOpenPanel), openPanel];
        let _: () = msg_send![&*panel, setCanChooseFiles: false];
        let _: () = msg_send![&*panel, setCanChooseDirectories: true];
        let _: () = msg_send![&*panel, setCanCreateDirectories: true];
        let _: () = msg_send![&*panel, setAllowsMultipleSelection: false];
        let _: () = msg_send![&*panel, setResolvesAliases: true];
        let message = CString::new(message).ok()?;
        let text: *mut AnyObject = msg_send![class!(NSString), stringWithUTF8String: message.as_ptr()];
        let _: () = msg_send![&*panel, setMessage: text];
        let prompt = CString::new("Choose").ok()?;
        let prompt_text: *mut AnyObject = msg_send![class!(NSString), stringWithUTF8String: prompt.as_ptr()];
        let _: () = msg_send![&*panel, setPrompt: prompt_text];
        if !start.is_empty() {
            if let Ok(path) = CString::new(start) {
                let path_text: *mut AnyObject = msg_send![class!(NSString), stringWithUTF8String: path.as_ptr()];
                let url: *mut AnyObject = msg_send![class!(NSURL), fileURLWithPath: path_text];
                let _: () = msg_send![&*panel, setDirectoryURL: url];
            }
        }
        // NSModalResponseOK is 1; anything else is Cancel.
        let response: i64 = msg_send![&*panel, runModal];
        if response != 1 {
            return None;
        }
        let url: *mut AnyObject = msg_send![&*panel, URL];
        if url.is_null() {
            return None;
        }
        let path: *mut AnyObject = msg_send![url, path];
        if path.is_null() {
            return None;
        }
        let bytes: *const std::ffi::c_char = msg_send![path, UTF8String];
        if bytes.is_null() {
            return None;
        }
        Some(CStr::from_ptr(bytes).to_string_lossy().into_owned())
    }
}

#[tauri::command]
fn set_credentials(state: State<'_, AppState>, id: String, username: String, password: String) -> Result<(), String> {
    send_to_helper(&state, &serde_json::json!({ "type": "credentials", "id": id, "username": username, "password": password }))
}

#[tauri::command]
fn set_appearance(app: AppHandle, state: State<'_, AppState>, mode: String) -> Result<Snapshot, String> {
    let mode = match mode.as_str() {
        "light" => "light",
        "dark" => "dark",
        _ => "system",
    };
    {
        let mut settings = state.settings.lock().unwrap();
        settings.appearance = mode.into();
        save_settings(&settings)?;
    }
    if let Some(window) = app.get_webview_window("settings") {
        let theme = match mode {
            "light" => Some(tauri::Theme::Light),
            "dark" => Some(tauri::Theme::Dark),
            _ => None,
        };
        let _ = window.set_theme(theme);
    }
    emit_snapshot(&app);
    Ok(snapshot(&app))
}

#[tauri::command]
fn set_general(app: AppHandle, state: State<'_, AppState>, notifications: bool, launch_at_login: bool, retries: u32) -> Result<Snapshot, String> {
    let retries = retries.clamp(1, 8);
    {
        let mut settings = state.settings.lock().unwrap();
        let was = settings.general.launch_at_login;
        settings.general.notifications = notifications;
        settings.general.launch_at_login = launch_at_login;
        settings.general.retries = retries;
        save_settings(&settings)?;
        if was != launch_at_login {
            match login_item::set(launch_at_login) {
                Ok(()) => *state.login_error.lock().unwrap() = None,
                Err(error) => {
                    *state.login_error.lock().unwrap() = Some(error.clone());
                    log(&format!("launch at login: {error}"));
                }
            }
        }
        let _ = send_to_helper(&state, &helper_config(&settings));
    }
    emit_snapshot(&app);
    Ok(snapshot(&app))
}

#[tauri::command]
fn check_updates(app: AppHandle, state: State<'_, AppState>) -> Result<UpdateState, String> {
    *state.update.lock().unwrap() = UpdateState { state: "checking".into(), version: None, reason: None };
    emit_snapshot(&app);
    let result = feed::check_with_timeout(APP_VERSION);
    *state.update.lock().unwrap() = result.clone();
    emit_snapshot(&app);
    Ok(result)
}

#[tauri::command]
fn open_updater() -> Result<(), String> {
    for name in ["Studio Launcher KH", "Update Studio KH"] {
        let path = format!("/Applications/{name}.app");
        if Path::new(&path).exists() && Command::new("open").arg(&path).spawn().is_ok() {
            return Ok(());
        }
    }
    Err("Studio Launcher KH is not installed on this Mac.".into())
}

#[tauri::command]
fn set_list_view(app: AppHandle, state: State<'_, AppState>, mode: String) -> Result<Snapshot, String> {
    let mode = if mode == "table" { "table" } else { "cards" };
    {
        let mut settings = state.settings.lock().unwrap();
        settings.list_view = mode.into();
        save_settings(&settings)?;
    }
    emit_snapshot(&app);
    Ok(snapshot(&app))
}

#[tauri::command]
fn restart_helper(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let running = state.helper.lock().unwrap().is_some();
    if running {
        return Err("The background helper is already running.".into());
    }
    start_helper(&app)?;
    emit_snapshot(&app);
    Ok(())
}

#[tauri::command]
fn open_support() -> Result<(), String> {
    Command::new("open")
        .arg(SUPPORT_URL)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Could not open the support page: {e}"))
}

// ---------------------------------------------------------------- updates

mod feed {
    use super::{UpdateState, APP_NAME};
    use base64::Engine as _;
    use ed25519_dalek::{Signature, VerifyingKey};
    use serde_json::Value;
    use std::time::Duration;

    const BUNDLE_ID: &str = "app.storagestudiokh.desktop";

    fn publisher() -> Result<(String, String), String> {
        let home = std::env::var("HOME").unwrap_or_default();
        let path = std::path::PathBuf::from(home).join("Library").join("KHUpdater").join("publisher.json");
        let text = std::fs::read_to_string(path)
            .map_err(|_| "This Mac is not connected to an Update Studio.".to_string())?;
        let value: Value = serde_json::from_str(&text).map_err(|_| "The Update Studio connection is incomplete.".to_string())?;
        let url = value.get("feedURL").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
        let key = value.get("publicKey").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
        if url.is_empty() || key.is_empty() {
            return Err("The Update Studio connection is incomplete.".into());
        }
        Ok((url, key))
    }

    fn decode(value: Option<&Value>) -> Result<Vec<u8>, String> {
        let text = value.and_then(|v| v.as_str()).ok_or_else(|| "Malformed update response.".to_string())?;
        base64::engine::general_purpose::STANDARD
            .decode(text)
            .map_err(|_| "Malformed update response.".to_string())
    }

    fn verify(feed_bytes: &[u8], signature: &[u8], key: &[u8]) -> Result<Value, String> {
        if key.len() != 32 || signature.len() != 64 {
            return Err("The Update Studio's key is not usable.".into());
        }
        let key: [u8; 32] = key.try_into().map_err(|_| "Bad key".to_string())?;
        let signature: [u8; 64] = signature.try_into().map_err(|_| "Bad signature".to_string())?;
        let key = VerifyingKey::from_bytes(&key).map_err(|_| "The Update Studio's key is not usable.".to_string())?;
        key.verify_strict(feed_bytes, &Signature::from_bytes(&signature))
            .map_err(|_| "The update feed's signature did not match.".to_string())?;
        let value: Value = serde_json::from_slice(feed_bytes).map_err(|_| "The update feed is not readable.".to_string())?;
        if value.get("schema").and_then(|v| v.as_u64()) != Some(1) {
            return Err("This update feed uses a newer format than this app understands.".into());
        }
        Ok(value)
    }

    pub(super) fn parse_version(text: &str) -> Option<Vec<u64>> {
        if text.is_empty() || text.len() > 64 || !text.chars().all(|c| c.is_ascii_digit() || c == '.') {
            return None;
        }
        let parts: Vec<&str> = text.split('.').collect();
        if parts.len() < 2 || parts.len() > 6 || parts.iter().any(|p| p.is_empty() || p.len() > 9) {
            return None;
        }
        parts.iter().map(|p| p.parse().ok()).collect()
    }

    pub(super) fn is_newer(candidate: &str, installed: &str) -> Option<bool> {
        let a = parse_version(candidate)?;
        let b = parse_version(installed)?;
        let len = a.len().max(b.len());
        for i in 0..len {
            let x = *a.get(i).unwrap_or(&0);
            let y = *b.get(i).unwrap_or(&0);
            if x != y {
                return Some(x > y);
            }
        }
        Some(false)
    }

    /// A DNS lookup can outlive the HTTP timeout; the person still gets an answer.
    pub fn check_with_timeout(installed: &str) -> UpdateState {
        let (sender, receiver) = std::sync::mpsc::channel();
        let installed = installed.to_string();
        std::thread::spawn(move || {
            let _ = sender.send(check(&installed));
        });
        receiver.recv_timeout(Duration::from_secs(15)).unwrap_or(UpdateState {
            state: "failed".into(),
            version: None,
            reason: Some("The Update Studio did not answer within 15 seconds.".into()),
        })
    }

    pub fn check(installed: &str) -> UpdateState {
        let fail = |reason: String| UpdateState { state: "failed".into(), version: None, reason: Some(reason) };
        let (url, key) = match publisher() {
            Ok(found) => found,
            Err(reason) => return UpdateState { state: "not-checked".into(), version: None, reason: Some(reason) },
        };
        let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(8)).build();
        let body = match agent.get(&url).call() {
            Ok(response) => match response.into_string() {
                Ok(text) => text,
                Err(_) => return fail("The Update Studio sent an unreadable answer.".into()),
            },
            Err(error) => return fail(format!("Could not reach the Update Studio: {error}")),
        };
        let response: Value = match serde_json::from_str(&body) {
            Ok(value) => value,
            Err(_) => return fail("The Update Studio sent an unreadable answer.".into()),
        };
        let feed_bytes = match decode(response.get("feed")) {
            Ok(bytes) => bytes,
            Err(reason) => return fail(reason),
        };
        let signature = match decode(response.get("signature")) {
            Ok(bytes) => bytes,
            Err(reason) => return fail(reason),
        };
        let key_bytes = match base64::engine::general_purpose::STANDARD.decode(&key) {
            Ok(bytes) => bytes,
            Err(_) => return fail("The Update Studio's key is not usable.".into()),
        };
        let feed = match verify(&feed_bytes, &signature, &key_bytes) {
            Ok(value) => value,
            Err(reason) => return fail(reason),
        };
        let entry = feed
            .get("apps")
            .and_then(|v| v.as_object())
            .and_then(|apps| apps.values().find(|app| app.get("bundleID").and_then(|v| v.as_str()) == Some(BUNDLE_ID)).cloned());
        let Some(entry) = entry else {
            return fail(format!("{APP_NAME} is not offered by this Update Studio."));
        };
        let offered = entry.get("version").and_then(|v| v.as_str()).unwrap_or("");
        match is_newer(offered, installed) {
            Some(true) => UpdateState { state: "available".into(), version: Some(offered.into()), reason: None },
            Some(false) => UpdateState { state: "up-to-date".into(), version: Some(offered.into()), reason: None },
            None => fail("The update feed has an invalid version.".into()),
        }
    }
}

fn unix_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::feed::{is_newer, parse_version};
    use super::{
        channel_meta, child_channel_count, hold_seconds, inside, query_value, record_hold_outcome,
        refuse_new_work, require_folder, route_hold_request, unix_millis, unsettled, validate_input,
        AppState, Hold, HoldDispatch, HoldWork, Storage, StorageInput, Work, HOLD_PAUSE_DEFAULT_S,
        HOLD_PAUSE_MAX_S, HOLD_PATH, HOLD_TIMEOUT_DEFAULT_S, HOLD_TIMEOUT_MAX_S,
    };
    use std::time::{Duration, Instant};

    fn input(kind: &str, target: &str, mount_point: &str) -> StorageInput {
        StorageInput {
            id: None,
            name: "Test".into(),
            kind: kind.into(),
            target: target.into(),
            mount_point: mount_point.into(),
            volume_uuid: None,
            reconnect_at_login: false,
            reconnect_after_wake: false,
            username: None,
            password: None,
            remove_credentials: false,
        }
    }

    #[test]
    fn a_hold_token_another_user_can_read_is_refused() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("ss-hold-token-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("hold-token");
        let token = "a".repeat(64);
        std::fs::write(&path, &token).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert_eq!(super::hold_token_fault(&path), None);
        assert_eq!(super::read_hold_token_at(&path), Some(token.clone()));

        // Group read is the defect this check exists for: 0644 must fail, naming 600.
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        let fault = super::hold_token_fault(&path).unwrap();
        assert!(fault.contains("600"), "{fault}");
        assert_eq!(super::read_hold_token_at(&path), None);
        let headers = vec![("X-Hub-Token".to_string(), token.clone())];
        assert!(super::authorize_hold_headers(&headers, &path).is_err());

        // A short or non-hex token fails even at 0600.
        std::fs::write(&path, "not-a-token").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert!(super::hold_token_fault(&path).unwrap().contains("64 hex"));

        // And the good file authenticates.
        std::fs::write(&path, &token).unwrap();
        assert!(super::authorize_hold_headers(&headers, &path).is_ok());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_legacy_hold_token_is_moved_once_and_locked_to_600() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("ss-hold-move-{}", super::unix_millis()));
        std::fs::create_dir_all(&dir).unwrap();
        let legacy = dir.join("legacy-token");
        std::fs::write(&legacy, "a".repeat(64)).unwrap();
        std::fs::set_permissions(&legacy, std::fs::Permissions::from_mode(0o644)).unwrap();
        let own = dir.join("app").join("hold-token");
        let marker = dir.join("app").join(".hold-token-migrated");

        super::migrate_legacy_hold_token(&legacy, &own, &marker);
        assert_eq!(std::fs::read_to_string(&own).unwrap(), "a".repeat(64));
        assert_eq!(std::fs::metadata(&own).unwrap().permissions().mode() & 0o777, 0o600);
        assert!(marker.exists());
        assert_eq!(super::hold_token_fault(&own), None);

        // Once moved, a later legacy token cannot overwrite the app's own copy.
        std::fs::write(&legacy, "b".repeat(64)).unwrap();
        super::migrate_legacy_hold_token(&legacy, &own, &marker);
        assert_eq!(std::fs::read_to_string(&own).unwrap(), "a".repeat(64));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn only_the_installed_copy_may_register_a_login_item() {
        let installed = |path: &str| super::is_installed_copy(std::path::Path::new(path));
        assert!(installed("/Applications/Storage Studio KH.app/Contents/MacOS/Storage Studio KH"));
        // A build-tree bundle used to pass: macOS re-pointed the owner's record at it.
        assert!(!installed(
            "/Users/x/Developer/My Own Apps/storage-studio-kh/src-tauri/target/release/bundle/macos/Storage Studio KH.app/Contents/MacOS/Storage Studio KH"
        ));
        assert!(!installed("/Volumes/Storage Studio KH/Storage Studio KH.app/Contents/MacOS/Storage Studio KH"));
        assert!(!installed(
            "/Users/x/Developer/My Own Apps/storage-studio-kh/src-tauri/target/release/Storage Studio KH"
        ));
        assert!(!installed("/tmp/Storage Studio KH"));
    }

    #[test]
    fn login_item_registration_is_idempotent() {
        assert!(!super::login_item_needs_change(1, true));
        assert!(!super::login_item_needs_change(0, false));
        assert!(super::login_item_needs_change(0, true));
        assert!(super::login_item_needs_change(1, false));
        assert!(super::login_item_needs_change(2, true));
        assert!(super::login_item_needs_change(2, false));
        // 3 = not found: a copy with no registration has nothing to unregister.
        assert!(!super::login_item_needs_change(3, false));
    }

    #[test]
    fn one_share_is_one_storage_with_or_without_a_user() {
        let storage = |id: &str, target: &str, user: Option<&str>| super::Storage {
            id: id.into(),
            name: id.into(),
            kind: "smb".into(),
            target: target.into(),
            mount_point: String::new(),
            volume_uuid: None,
            reconnect_at_login: true,
            reconnect_after_wake: true,
            username: user.map(|name| name.to_string()),
        };
        let with_user = storage("a", "smb://studio@nas.local/studio", Some("studio"));
        let without_user = storage("b", "SMB://NAS.local/studio", None);
        let other = storage("c", "smb://nas.local/other", None);
        let trailing = storage("d", "smb://nas.local/studio/", None);
        let escaped = storage("e", "smb://nas.local/st%75dio", None);
        let port = storage("f", "smb://nas.local:445/studio", None);
        let query = storage("g", "smb://nas.local/studio?x=1", None);
        let dotted = storage("h", "smb://nas.local/./studio", None);
        assert!(super::same_storage(&with_user, &without_user));
        assert!(super::same_storage(&with_user, &trailing));
        assert!(super::same_storage(&with_user, &escaped));
        assert!(super::same_storage(&with_user, &port));
        assert!(super::same_storage(&with_user, &query));
        assert!(super::same_storage(&with_user, &dotted));
        assert!(!super::same_storage(&with_user, &other));
    }

    #[test]
    fn smb_address_must_name_a_share() {
        assert!(validate_input(&input("smb", "smb://nas.local/photos", "")).is_ok());
        assert!(validate_input(&input("smb", "smb://nas.local", "")).is_err());
        assert!(validate_input(&input("smb", "nas.local/photos", "")).is_err());
        assert!(validate_input(&input("smb", "https://nas.local/photos", "")).is_err());
    }

    #[test]
    fn attached_disk_needs_a_mount_point() {
        assert!(validate_input(&input("volume", "/dev/disk4s1", "/Volumes/Archive")).is_ok());
        assert!(validate_input(&input("volume", "/dev/disk4s1", "")).is_err());
        assert!(validate_input(&input("nfs", "nfs://x/y", "")).is_err());
    }

    #[test]
    fn storage_json_matches_the_helper_and_ui_contract() {
        let storage = super::Storage {
            id: "s1".into(),
            name: "NAS".into(),
            kind: "smb".into(),
            target: "smb://nas.local/photos".into(),
            mount_point: "".into(),
            volume_uuid: Some("UUID-1".into()),
            reconnect_at_login: true,
            reconnect_after_wake: true,
            username: None,
        };
        let json = serde_json::to_value(&storage).unwrap();
        assert!(json.get("volumeUUID").is_some(), "{json}");
        assert!(json.get("volumeUuid").is_none(), "{json}");
        assert!(json.get("mountPoint").is_some());
        assert!(json.get("reconnectAtLogin").is_some());
    }

    #[test]
    fn a_host_is_taken_from_the_typed_address() {
        use super::host_from_address;
        assert_eq!(host_from_address("smb://192.168.0.217"), Some("192.168.0.217".into()));
        assert_eq!(host_from_address("smb://192.168.0.217/Photos"), Some("192.168.0.217".into()));
        assert_eq!(host_from_address(" nas.local/photos "), Some("nas.local".into()));
        assert_eq!(host_from_address("smb://"), None);
        assert_eq!(host_from_address("   "), None);
    }

    #[test]
    fn a_name_is_required() {
        let mut empty = input("smb", "smb://nas.local/photos", "");
        empty.name = "   ".into();
        assert!(validate_input(&empty).is_err());
    }

    #[test]
    fn versions_compare_numerically() {
        assert_eq!(parse_version("1.10.0"), Some(vec![1, 10, 0]));
        assert_eq!(is_newer("1.10", "1.9"), Some(true));
        assert_eq!(is_newer("1.2", "1.2.0"), Some(false));
        assert_eq!(is_newer("0.1.1", "0.1.0"), Some(true));
    }

    #[test]
    fn bad_versions_are_rejected_not_guessed() {
        for value in ["", "1", "1.a", "1..2", "１", "1\n", "1.2.3.4.5.6.7"] {
            assert!(parse_version(value).is_none(), "{value:?} must be rejected");
            assert!(!is_newer(value, "1.0").unwrap_or(false));
        }
    }

    // ------------------------------------------------------------ update hold

    fn storage(id: &str, reconnect_at_login: bool) -> Storage {
        Storage {
            id: id.into(),
            name: format!("Storage {id}"),
            kind: "smb".into(),
            target: format!("smb://nas.local/{id}"),
            mount_point: String::new(),
            volume_uuid: None,
            reconnect_at_login,
            reconnect_after_wake: false,
            username: None,
        }
    }

    #[test]
    fn the_settle_window_is_twenty_seconds_and_never_past_thirty() {
        let (default, max) = (HOLD_TIMEOUT_DEFAULT_S, HOLD_TIMEOUT_MAX_S);
        assert_eq!(hold_seconds(None, default, max), 20);
        assert_eq!(hold_seconds(Some("0".into()), default, max), 0);
        assert_eq!(hold_seconds(Some("5".into()), default, max), 5);
        assert_eq!(hold_seconds(Some("99".into()), default, max), 30);
        assert_eq!(hold_seconds(Some("soon".into()), default, max), 20);
    }

    #[test]
    fn a_pause_is_a_gap_and_never_a_latch() {
        let long = hold_seconds(Some("999999999".into()), HOLD_PAUSE_DEFAULT_S, HOLD_PAUSE_MAX_S);
        assert_eq!(long, 3600);
        assert_eq!(hold_seconds(None, HOLD_PAUSE_DEFAULT_S, HOLD_PAUSE_MAX_S), 120);
    }

    #[test]
    fn the_hold_reads_its_two_query_values_by_name() {
        let query = "timeout_s=20&pause_s=120";
        assert_eq!(query_value(query, "timeout_s"), Some("20".into()));
        assert_eq!(query_value(query, "pause_s"), Some("120".into()));
        assert_eq!(query_value(query, "other"), None);
        assert_eq!(query_value("", "timeout_s"), None);
    }

    #[test]
    fn a_pause_expires_by_itself_and_a_restart_starts_unheld() {
        let mut hold = Hold::default();
        assert!(!hold.paused(), "a fresh app takes work");
        hold.until = Some(Instant::now() + Duration::from_secs(120));
        assert!(hold.paused());
        assert!(hold.seconds_left() > 0);
        hold.until = Some(Instant::now() - Duration::from_secs(1));
        assert!(!hold.paused(), "an elapsed pause never latches");
        assert_eq!(hold.seconds_left(), 0);
    }

    #[test]
    fn a_held_app_refuses_new_work_in_plain_words() {
        let state = AppState::new(super::Settings::default());
        assert!(refuse_new_work(&state).is_ok());
        state.hold.lock().unwrap().until = Some(Instant::now() + Duration::from_secs(60));
        let reason = refuse_new_work(&state).unwrap_err();
        assert!(reason.contains("holding new work"), "{reason}");
        assert!(reason.contains("by itself"), "the reason says it ends on its own: {reason}");
    }

    #[test]
    fn unsettled_names_a_running_mount_and_a_retry_a_restart_would_strand() {
        let mut settings = super::Settings::default();
        settings.storages = vec![storage("follows", true), storage("orphan", false)];
        let state = AppState::new(settings);
        *state.work.lock().unwrap() = Work {
            in_flight: vec!["follows".into()],
            queued: vec!["follows".into(), "orphan".into()],
            deferred: vec!["orphan".into()],
            paused: false,
        };
        let names = unsettled(&state);
        assert_eq!(names, vec!["Storage follows (mounting)", "Storage orphan (retry pending)"]);
        // A claim this helper defers is resumable, and does not block its own update.
        *state.work.lock().unwrap() = Work {
            in_flight: vec![],
            queued: vec!["orphan".into()],
            deferred: vec!["orphan".into()],
            paused: false,
        };
        assert_eq!(unsettled(&state), vec!["Storage orphan (retry pending)"]);
        *state.work.lock().unwrap() = Work::default();
        assert!(unsettled(&state).is_empty(), "an idle app is safe");
    }

    #[test]
    fn a_queued_retry_does_not_burn_the_settle_window() {
        let mut settings = super::Settings::default();
        settings.storages = vec![storage("orphan", false), storage("follows", true)];
        let state = AppState::new(settings);
        *state.work.lock().unwrap() = Work {
            in_flight: vec![],
            queued: vec!["orphan".into(), "follows".into()],
            deferred: vec![],
            paused: false,
        };
        assert!(state.work.lock().unwrap().in_flight.is_empty());
        // Only the retry a restart would drop is a stranding; the login one is picked up again.
        assert_eq!(unsettled(&state), vec!["Storage orphan (retry pending)"]);
        *state.work.lock().unwrap() = Work::default();
        let none: Vec<String> = vec![];
        assert_eq!(unsettled(&state), none);
    }

    // ------------------------------------------------------- hold credential

    fn token_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("storage-hold-token-{}-{}", name, super::unix_millis()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Any readable label becomes a 64-hex token, so tests can name their tokens and still
    /// satisfy the §2d shape rule.
    fn token(text: &str) -> String {
        let mut hex: String = text.bytes().map(|b| format!("{b:02x}")).collect();
        hex.truncate(64);
        while hex.len() < 64 {
            hex.push('0');
        }
        hex
    }

    fn write_raw(dir: &std::path::Path, name: &str, text: &str) -> std::path::PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let path = dir.join(name);
        std::fs::write(&path, text).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        path
    }

    fn write_token(dir: &std::path::Path, text: &str) -> std::path::PathBuf {
        write_raw(dir, "hold-token", &token(text))
    }

    fn header(name: &str, value: &str) -> Vec<(String, String)> {
        vec![(name.to_string(), value.to_string())]
    }

    fn is_unauthorized(outcome: HoldDispatch) -> bool {
        matches!(outcome, HoldDispatch::Error(status, _) if status == "401 Unauthorized")
    }

    #[test]
    fn a_hold_request_without_the_launcher_token_is_refused() {
        let dir = token_dir("no-header");
        let path = write_token(&dir, "a-real-launcher-token-value");
        for method in ["POST", "DELETE", "GET"] {
            assert!(is_unauthorized(route_hold_request(method, HOLD_PATH, &[], &path)), "{method} without a credential");
        }
        assert!(is_unauthorized(route_hold_request("POST", HOLD_PATH, &header("X-Other", "x"), &path)));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_wrong_token_is_refused_and_the_right_one_answered() {
        let dir = token_dir("wrong");
        let path = write_token(&dir, "the-launcher-token");
        assert!(is_unauthorized(route_hold_request("POST", HOLD_PATH, &header("X-Hub-Token", &token("not-the-token")), &path)));
        assert!(is_unauthorized(route_hold_request("POST", HOLD_PATH, &header("Authorization", &format!("Bearer {}", token("nope"))), &path)));
        assert!(matches!(
            route_hold_request("POST", HOLD_PATH, &header("X-Hub-Token", &token("the-launcher-token")), &path),
            HoldDispatch::Hold
        ));
        assert!(matches!(
            route_hold_request("DELETE", HOLD_PATH, &header("Authorization", &format!("Bearer {}", token("the-launcher-token"))), &path),
            HoldDispatch::Resume
        ));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn both_credentials_present_must_agree() {
        let dir = token_dir("both");
        let path = write_token(&dir, "the-launcher-token");
        let agree = vec![
            ("Authorization".to_string(), format!("Bearer {}", token("the-launcher-token"))),
            ("x-hub-token".to_string(), token("the-launcher-token")),
        ];
        assert!(matches!(route_hold_request("POST", HOLD_PATH, &agree, &path), HoldDispatch::Hold));
        let disagree = vec![
            ("Authorization".to_string(), format!("Bearer {}", token("the-launcher-token"))),
            ("X-Hub-Token".to_string(), token("some-other-token")),
        ];
        assert!(is_unauthorized(route_hold_request("POST", HOLD_PATH, &disagree, &path)));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_browser_origin_is_refused_even_with_the_right_token() {
        let dir = token_dir("origin");
        let path = write_token(&dir, "the-launcher-token");
        let headers = vec![
            ("X-Hub-Token".to_string(), token("the-launcher-token")),
            ("Origin".to_string(), "https://example.com".to_string()),
        ];
        assert!(is_unauthorized(route_hold_request("POST", HOLD_PATH, &headers, &path)));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn only_the_hold_route_is_served_and_only_after_the_token() {
        let dir = token_dir("route");
        let path = write_token(&dir, "the-launcher-token");
        // Another path is not found, credential or not.
        assert!(matches!(
            route_hold_request("POST", "/api/other", &header("X-Hub-Token", &token("the-launcher-token")), &path),
            HoldDispatch::Error("404 Not Found", _)
        ));
        assert!(matches!(route_hold_request("POST", "/api/other", &[], &path), HoldDispatch::Error("404 Not Found", _)));
        // The right token on the wrong method is a method error, not a refusal of the credential.
        assert!(matches!(
            route_hold_request("GET", HOLD_PATH, &header("X-Hub-Token", &token("the-launcher-token")), &path),
            HoldDispatch::Error("405 Method Not Allowed", _)
        ));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_missing_empty_or_symlinked_token_file_fails_closed() {
        let dir = token_dir("fail-closed");
        let missing = dir.join("absent-token");
        assert!(is_unauthorized(route_hold_request("POST", HOLD_PATH, &header("X-Hub-Token", &token("anything")), &missing)));
        let empty = write_raw(&dir, "empty-token", "   \n");
        assert!(is_unauthorized(route_hold_request("POST", HOLD_PATH, &header("X-Hub-Token", ""), &empty)));
        let real = write_token(&dir, "the-launcher-token");
        let link = dir.join("link-token");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&real, &link).unwrap();
        #[cfg(unix)]
        assert!(is_unauthorized(route_hold_request("POST", HOLD_PATH, &header("X-Hub-Token", &token("the-launcher-token")), &link)));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_token_is_read_fresh_so_a_rotation_takes_effect() {
        let dir = token_dir("rotate");
        let path = write_token(&dir, "first-token-value");
        assert!(matches!(
            route_hold_request("POST", HOLD_PATH, &header("X-Hub-Token", &token("first-token-value")), &path),
            HoldDispatch::Hold
        ));
        write_token(&dir, "second-token-value");
        assert!(is_unauthorized(route_hold_request("POST", HOLD_PATH, &header("X-Hub-Token", &token("first-token-value")), &path)));
        assert!(matches!(
            route_hold_request("POST", HOLD_PATH, &header("X-Hub-Token", &token("second-token-value")), &path),
            HoldDispatch::Hold
        ));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_constant_time_compare_still_compares() {
        assert!(super::constant_time_eq(b"abc", b"abc"));
        assert!(!super::constant_time_eq(b"abc", b"abd"));
        assert!(!super::constant_time_eq(b"abc", b"ab"));
    }

    #[test]
    fn helper_hold_outcomes_supersede_older_reports() {
        let mut awaiting = None;
        assert!(!record_hold_outcome(&mut awaiting, "hold", 0));
        assert_eq!(awaiting, Some(HoldWork::Settled));
        assert!(record_hold_outcome(&mut awaiting, "hold", 1), "a running mount is reported");
        assert_eq!(awaiting, Some(HoldWork::Held));
        assert!(record_hold_outcome(&mut awaiting, "hold", 0), "held wins until settled");
        assert_eq!(awaiting, Some(HoldWork::Settled));
        assert!(!record_hold_outcome(&mut awaiting, "resume", 1), "resume clears the pause");
        assert_eq!(awaiting, Some(HoldWork::Settled));
    }

    #[test]
    fn the_settings_file_is_readable_only_by_its_owner() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("storage-studio-settings-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("settings.json");
        // A file written before this rule was world-readable; the next write fixes it.
        std::fs::write(&path, "{}").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        super::write_private(&path, r#"{"schema":1}"#).unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "settings.json must be owner-only");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), r#"{"schema":1}"#);
        std::fs::remove_dir_all(&dir).ok();
    }

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("storage-studio-{name}-{}", unix_millis()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// The exact line the helper sent on 1301 on 2026-11-22, verbatim.
    const CAPTURED_SHARES_LINE: &str = r#"{"host":"192.168.0.217","needsCredentials":false,"shares":["Public Space-Media - 4TB - Music","Public Space-System pool","Public Space-Media - 6TB - TV Show","Public Space-Media - 6TB - Movies"],"type":"shares"}"#;

    #[test]
    fn the_captured_share_list_from_1301_decodes() {
        let event: super::HelperEvent = serde_json::from_str(CAPTURED_SHARES_LINE)
            .expect("the payload this app's own helper sends must decode");
        match event {
            super::HelperEvent::Shares { host, shares, needs_credentials, error } => {
                assert_eq!(host, "192.168.0.217");
                assert!(!needs_credentials);
                assert_eq!(shares.len(), 4);
                assert_eq!(shares[0], "Public Space-Media - 4TB - Music");
                assert!(error.is_none(), "an absent error key means no error, not a failed decode");
            }
            _ => panic!("expected a shares event"),
        }
    }

    #[test]
    fn a_failed_decode_cannot_empty_settings_or_secrets() {
        let dir = scratch("empty-store");
        let saved = super::Settings { storages: vec![storage("s1", true)], ..super::Settings::default() };
        super::save_settings_to(&dir, &saved, false).unwrap();
        let secrets = dir.join("secrets.json");
        std::fs::write(&secrets, r#"{"schema":1,"items":{"user@host":{"username":"user","password":"pw"}}}"#).unwrap();
        let settings_before = std::fs::read(dir.join("settings.json")).unwrap();
        let secrets_before = std::fs::read(&secrets).unwrap();
        // What a decode fault leaves the app holding: defaults, no rows.
        assert!(
            super::save_settings_to(&dir, &super::Settings::default(), false).is_err(),
            "an empty store must not replace a saved list"
        );
        assert_eq!(std::fs::read(dir.join("settings.json")).unwrap(), settings_before);
        assert_eq!(std::fs::read(&secrets).unwrap(), secrets_before);
        // Removing the owner's last row is a real empty save and still goes through.
        assert!(super::save_settings_to(&dir, &super::Settings::default(), true).is_ok());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_channel_meta_reads_four_fields_and_ignores_the_rest() {
        let dir = scratch("channel-meta");
        std::fs::write(
            dir.join("project.json"),
            r#"{"name":"Night Atlas","slug":"night-atlas","project_id":"p-1","media_root":"${MEDIA}","episodes":[{"never":"read"}]}"#,
        )
        .unwrap();
        let meta = channel_meta(&dir).expect("project.json decodes");
        assert_eq!(meta.name.as_deref(), Some("Night Atlas"));
        assert_eq!(meta.slug.as_deref(), Some("night-atlas"));
        assert_eq!(meta.project_id.as_deref(), Some("p-1"));
        assert!(meta.media_root.is_some());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn one_channel_and_a_library_are_told_apart() {
        let library = scratch("library-shape");
        std::fs::create_dir_all(library.join("_trash").join("night-atlas")).unwrap();
        let first = library.join("night-atlas");
        let second = library.join("komsan");
        std::fs::create_dir_all(&first).unwrap();
        std::fs::create_dir_all(&second).unwrap();
        std::fs::write(first.join("project.json"), "{}").unwrap();
        std::fs::write(second.join("project.json"), "{}").unwrap();
        // The Library itself: a `_trash` and two channels below it.
        assert!(library.join("_trash").is_dir());
        assert_eq!(child_channel_count(&library), 2);
        // One of its channels: no `_trash`, no channel below it.
        assert!(!first.join("_trash").is_dir());
        assert_eq!(child_channel_count(&first), 0);
        std::fs::remove_dir_all(&library).ok();
    }

    #[test]
    fn an_archive_folder_must_be_absolute_and_real() {
        assert!(require_folder("", "the channel's folder").is_err());
        assert!(require_folder("relative/path", "the channel's folder").is_err());
        assert!(require_folder("/definitely/not/here-20261121", "the channel's folder").is_err());
        let dir = scratch("folder-check");
        assert!(require_folder(&dir.to_string_lossy(), "the channel's folder").is_ok());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_media_folder_inside_the_channel_is_caught() {
        let dir = scratch("inside");
        let channel = dir.join("night-atlas");
        let media = channel.join("media");
        std::fs::create_dir_all(&media).unwrap();
        assert!(inside(&media, &channel));
        let other = dir.join("elsewhere");
        std::fs::create_dir_all(&other).unwrap();
        assert!(!inside(&other, &channel));
        assert!(!inside(&channel, &other));
        std::fs::remove_dir_all(&dir).ok();
    }
}

// ---------------------------------------------------------------- lifecycle

fn shutdown_helper(app: &AppHandle) {
    let state = app.state::<AppState>();
    let mut guard = state.helper.lock().unwrap();
    if let Some(mut helper) = guard.take() {
        let _ = helper.stdin.write_all(b"{\"type\":\"quit\"}\n");
        let _ = helper.stdin.flush();
        for _ in 0..20 {
            if let Ok(Some(_)) = helper.child.try_wait() {
                return;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let _ = helper.child.kill();
        let _ = helper.child.wait();
    }
}

/// A hidden test instance must never collide with the owner's running app. The plugin's guard is
/// `/tmp/<identifier>_si.sock`, fixed by the build's identifier, so a test copy would forward to
/// the live app and exit — and the live app would show its window. A test copy therefore takes an
/// identifier derived from its own data folder: a second instance of the same test still counts as
/// one, and nothing on the machine's installed app is touched (gate rule 9).
fn test_scoped_context() -> tauri::Context {
    let mut context = tauri::generate_context!();
    let test_dir = std::env::var("STORAGE_STUDIO_TEST_DATA_DIR").unwrap_or_default();
    let trimmed = test_dir.trim();
    if !trimmed.is_empty() {
        let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
        for byte in trimmed.bytes() {
            hash ^= byte as u64;
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
        context.config_mut().identifier = format!("app.storagestudiokh.desktop.test.{hash:016x}");
    }
    context
}

fn main() {
    // Hidden verification hooks for the release gate; they never open a window.
    let arguments: Vec<String> = std::env::args().collect();
    if arguments.iter().any(|a| a == "--login-item-status") {
        println!("{}", login_item::status());
        std::process::exit(0);
    }
    if arguments.iter().any(|a| a == "--login-item-on") {
        println!("{:?}", login_item::set(true));
        std::process::exit(0);
    }
    if arguments.iter().any(|a| a == "--login-item-off") {
        println!("{:?}", login_item::set(false));
        std::process::exit(0);
    }
    if arguments.iter().any(|a| a == "--check-updates") {
        println!("{:?}", feed::check_with_timeout(APP_VERSION));
        std::process::exit(0);
    }
    let dump_snapshot = arguments.iter().any(|a| a == "--dump-snapshot");
    let start_hidden = arguments.iter().any(|a| a == "--start-hidden");
    let show_once = arguments.iter().any(|a| a == "--show-once");

    // Tests and hidden verification runs use their own data folder.
    if let Ok(dir) = std::env::var("STORAGE_STUDIO_TEST_DATA_DIR") {
        std::env::set_var("HOME", dir); // data_dir() and the helper both follow HOME
    }

    let settings = load_settings();
    let state = AppState::new(settings.clone());
    let setup_settings = settings.clone();
    let requested_quit = arguments.iter().any(|a| a == "--quit");

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // A second launch is a plain note, not a crash. `--quit` lets the
            // release gate stop a hidden test instance the way the menu does.
            if args.iter().any(|a| a == "--quit") {
                app.exit(0);
                return;
            }
            log("another copy was launched; showing the running one");
            *app.state::<AppState>().second_instance.lock().unwrap() = true;
            show_settings(app);
            let _ = app.emit("second-instance", ());
            emit_snapshot(app);
        }))
        .plugin(tauri_plugin_notification::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            save_storage,
            remove_storage,
            mount_storage,
            mount_all,
            unmount_storage,
            cancel_storage,
            test_storage,
            refresh_storage,
            list_shares,
            reveal_storage,
            pick_mount_point,
            set_credentials,
            set_appearance,
            set_general,
            check_updates,
            open_updater,
            open_support,
            restart_helper,
            set_list_view,
            inspect_channel,
            archive_add,
            archive_remove,
            archive_start,
            archive_reveal,
            archive_cancel,
            archive_free_space,
            archive_again,
            restore_scan,
            restore_start,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();

            if let Some(window) = app.get_webview_window("settings") {
                let theme = match setup_settings.appearance.as_str() {
                    "light" => Some(tauri::Theme::Light),
                    "dark" => Some(tauri::Theme::Dark),
                    _ => None,
                };
                let _ = window.set_theme(theme);
            }

            // A real app menu gives Settings its ⌘, and the text fields their usual
            // Cut/Copy/Paste while the window is focused.
            let app_menu = Submenu::with_items(
                app,
                APP_NAME,
                true,
                &[
                    &MenuItem::with_id(app, "app-settings", "Settings…", true, Some("CmdOrCtrl+,"))?,
                    &PredefinedMenuItem::close_window(app, Some("Close Window"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::hide(app, Some("Hide Storage Studio KH"))?,
                    &PredefinedMenuItem::hide_others(app, Some("Hide Others"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::quit(app, Some("Quit Storage Studio KH"))?,
                ],
            )?;
            let edit_menu = Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(app, Some("Undo"))?,
                    &PredefinedMenuItem::redo(app, Some("Redo"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, Some("Cut"))?,
                    &PredefinedMenuItem::copy(app, Some("Copy"))?,
                    &PredefinedMenuItem::paste(app, Some("Paste"))?,
                    &PredefinedMenuItem::select_all(app, Some("Select All"))?,
                ],
            )?;
            app.set_menu(Menu::with_items(app, &[&app_menu, &edit_menu])?)?;

            // Launch at login is on by default; report honestly when macOS refuses.
            if setup_settings.general.launch_at_login
                && !is_test_mode()
                && login_item::can_register()
                && !login_item::is_enabled()
                && std::env::var("STORAGE_STUDIO_NO_LOGIN_ITEM").is_err()
            {
                if let Err(error) = login_item::set(true) {
                    *handle.state::<AppState>().login_error.lock().unwrap() = Some(error.clone());
                    log(&format!("launch at login: {error}"));
                }
            }

            let snap = snapshot(&handle);
            let menu = build_tray_menu(&handle, &snap)?;
            let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?;
            TrayIconBuilder::with_id("main")
                .icon(icon)
                .icon_as_template(true)
                .tooltip(APP_NAME)
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "mount-all" => {
                        let state = app.state::<AppState>();
                        let sent = refuse_new_work(&state)
                            .and_then(|_| send_to_helper(&state, &serde_json::json!({ "type": "mount_all" })));
                        if let Err(error) = sent {
                            log(&error);
                        }
                    }
                    "reveal" => {
                        let state = app.state::<AppState>();
                        let path = state
                            .statuses
                            .lock()
                            .unwrap()
                            .values()
                            .find_map(|s| s.mounted_path.clone());
                        if let Some(path) = path {
                            let _ = Command::new("open").arg(path).spawn();
                        }
                    }
                    "settings" => show_settings(app),
                    "whatsnew" => {
                        show_settings(app);
                        let _ = app.emit("show-whats-new", ());
                    }
                    "support" => {
                        let _ = Command::new("open").arg(SUPPORT_URL).spawn();
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            // The update hold answers on loopback so Studio Launcher can hold this app's work
            // before it installs; the address is in the signed feed entry.
            start_hold_server(handle.clone());

            // Release screenshots (RELEASE-POLICY §5d): a hidden instance renders the app's own
            // window off the visible area and captures it from inside, never by driving the pointer.
            // Set STORAGE_STUDIO_SNAPSHOT_DIR together with the test data dir, then the app writes
            // <view>-<theme>.png and exits.
            if let Ok(dir) = std::env::var("STORAGE_STUDIO_SNAPSHOT_DIR") {
                let trimmed = dir.trim();
                if !trimmed.is_empty() && is_test_mode() {
                    let dir = PathBuf::from(trimmed);
                    let shot_handle = handle.clone();
                    std::thread::spawn(move || {
                        let Some(window) = shot_handle.get_webview_window("settings") else {
                            log("no settings window to photograph");
                            std::process::exit(3);
                        };
                        let _ = window.set_position(tauri::PhysicalPosition::new(-20000, -20000));
                        let _ = window.show();
                        std::thread::sleep(std::time::Duration::from_millis(900));
                        let shots = [("storage", "light"), ("storage", "dark"), ("archives", "light"), ("general", "light")];
                        for (view, theme) in shots {
                            let _ = shot_handle.emit("snapshot-view", serde_json::json!({ "view": view, "theme": theme }));
                            std::thread::sleep(std::time::Duration::from_millis(700));
                            let file = dir.join(format!("{view}-{theme}.png"));
                            match capture::snapshot(&window, &file) {
                                Ok(()) => log(&format!("screenshot {} written", file.display())),
                                Err(error) => log(&format!("screenshot {} failed: {error}", file.display())),
                            }
                        }
                        std::process::exit(0);
                    });
                }
            }
            start_hold_server(handle.clone());
            // The shim reads KHHoldTokenFile itself, before any hold request reaches this app, so the
            // one-time move of the legacy token has to happen at startup rather than on first use:
            // otherwise a fresh install refuses its first update because the file is not there yet.
            let _ = hold_token_path();

            // Sparkle, once, after the tray exists (INTEGRATION.md §3A). Not in test or capture runs:
            // those are hidden instances and must never reach for a feed.
            if !is_test_mode() && !dump_snapshot {
                sparkle::start(&handle);
            }

            if dump_snapshot {
                // Acceptance capture: let the helper settle, print the real state, close.
                let dump_handle = handle.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(7));
                    let snap = snapshot(&dump_handle);
                    if let Ok(text) = serde_json::to_string(&snap) {
                        println!("SNAPSHOT_JSON:{text}");
                    }
                    dump_handle.exit(0);
                });
            }

            if requested_quit {
                // `--quit` with no running copy still just closes this one.
                handle.exit(0);
                return Ok(());
            }

            // The helper needs the app's resources and its data folder; start it once the UI exists.
            if let Err(error) = start_helper(&handle) {
                log(&error);
                *handle.state::<AppState>().engine_error.lock().unwrap() = Some(error);
            }

            // Opening the app always shows its window — the app is useless as an invisible
            // menu-bar item, and "nothing happened" was the owner's report.
            if !is_test_mode() && !dump_snapshot && !start_hidden && !show_once {
                show_settings(&handle);
            }
            if show_once {
                let hook = handle.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(800));
                    show_settings(&hook);
                    std::thread::sleep(std::time::Duration::from_millis(800));
                    let visible = hook
                        .get_webview_window("settings")
                        .map(|w| w.is_visible().unwrap_or(false))
                        .unwrap_or(false);
                    if let Some(window) = hook.get_webview_window("settings") {
                        let _ = window.hide();
                    }
                    std::thread::sleep(std::time::Duration::from_millis(400));
                    show_settings(&hook);
                    std::thread::sleep(std::time::Duration::from_millis(800));
                    let again = hook
                        .get_webview_window("settings")
                        .map(|w| w.is_visible().unwrap_or(false))
                        .unwrap_or(false);
                    println!("SHOW_ONCE:shown={visible} after_hide_show={again}");
                    hook.exit(0);
                });
            }

            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "app-settings" {
                show_settings(app);
            }
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // This is a menu-bar app: closing Settings hides it, it does not quit.
                api.prevent_close();
                hide_settings(window);
            }
        })
        .build(test_scoped_context())
        .expect("Storage Studio KH could not start");

    app.run(|app, event| match event {
        RunEvent::Exit => shutdown_helper(app),
        // A second launch of this LSUIElement app arrives as an activation, not a new process.
        RunEvent::Reopen { .. } => show_settings(app),
        _ => {}
    });
}
