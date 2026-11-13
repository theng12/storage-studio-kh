//! Storage Studio KH — menu-bar shell.
//!
//! The Tauri window is only Settings. The macOS work (mount table, SMB mounting,
//! private secret file, wake/network watching, bounded retries) lives in the bundled helper at
//! `Contents/Helpers/Storage Studio KH Helper.app`, started as this app's child and
//! stopped when the app quits. Nothing here or there copies, mirrors or syncs data.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};

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

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct Settings {
    schema: u32,
    appearance: String, // "system" | "light" | "dark"
    #[serde(default = "default_list_view")]
    list_view: String, // "cards" | "table"
    general: General,
    storages: Vec<Storage>,
}

fn default_list_view() -> String {
    "cards".into()
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            schema: 1,
            appearance: "system".into(),
            list_view: default_list_view(),
            general: General::default(),
            storages: Vec::new(),
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

fn log(message: &str) {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
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
    let dir = data_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("Could not create {APP_NAME}'s data folder: {e}"))?;
    let text = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    let temporary = dir.join(".settings.json.tmp");
    std::fs::write(&temporary, text).map_err(|e| format!("Could not save settings: {e}"))?;
    std::fs::rename(&temporary, settings_path()).map_err(|e| format!("Could not save settings: {e}"))
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
    second_instance: bool,
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
    second_instance: Mutex<bool>,
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
            second_instance: Mutex::new(false),
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
        engine_error,
        second_instance,
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
    let any_unmounted = snap.storages.iter().any(|s| s.status != "mounted");
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
    State { items: Vec<HelperItem> },
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
    #[serde(rename = "shares")]
    Shares { host: String, shares: Vec<String>, needs_credentials: bool, error: Option<String> },
    #[serde(rename = "smb_mounts")]
    SmbMounts { items: Vec<ShareCandidate> },
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
        HelperEvent::State { items } => {
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
        HelperEvent::Log { level, message } => log(&format!("helper [{level}]: {message}")),
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

/// Only a real .app bundle may register a login item. A bare `target/release` binary
/// registers under a phantom identity that no installed app can match (owner-reported).
fn is_app_bundle_path(exe: &std::path::Path) -> bool {
    exe.to_string_lossy().contains(".app/Contents/MacOS/")
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
    pub fn status() -> i64 {
        match service() {
            Some(service) => unsafe { msg_send![&*service, status] },
            None => 3,
        }
    }

    pub fn is_enabled() -> bool {
        status() == 1
    }

    /// A development build (`cargo run`, a bare release binary) must never register.
    pub fn can_register() -> bool {
        std::env::current_exe()
            .map(|exe| super::is_app_bundle_path(&exe))
            .unwrap_or(false)
    }

    pub fn set(enabled: bool) -> Result<(), String> {
        if enabled && !can_register() {
            return Err("Launch at login needs the installed app. Open Storage Studio KH from Applications.".into());
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
    let after_user = match rest.split_once('@') {
        Some((_, host)) => host,
        None => rest,
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
    decoded.trim_end_matches('/').to_string()
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
        save_settings(&settings)?;
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
    send_to_helper(&state, &serde_json::json!({ "type": "mount", "id": id }))
}

#[tauri::command]
fn mount_all(state: State<'_, AppState>) -> Result<(), String> {
    send_to_helper(&state, &serde_json::json!({ "type": "mount_all" }))
}

#[tauri::command]
fn unmount_storage(state: State<'_, AppState>, id: String) -> Result<(), String> {
    send_to_helper(&state, &serde_json::json!({ "type": "unmount", "id": id }))
}

#[tauri::command]
fn test_storage(state: State<'_, AppState>, id: String) -> Result<(), String> {
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
    use super::{validate_input, StorageInput};

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
    fn only_an_app_bundle_may_register_a_login_item() {
        assert!(super::is_app_bundle_path(std::path::Path::new(
            "/Applications/Storage Studio KH.app/Contents/MacOS/Storage Studio KH"
        )));
        assert!(!super::is_app_bundle_path(std::path::Path::new(
            "/Users/x/Developer/My Own Apps/storage-studio-kh/src-tauri/target/release/Storage Studio KH"
        )));
        assert!(!super::is_app_bundle_path(std::path::Path::new("/tmp/Storage Studio KH")));
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
        assert!(super::same_storage(&with_user, &without_user));
        assert!(super::same_storage(&with_user, &trailing));
        assert!(super::same_storage(&with_user, &escaped));
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
            test_storage,
            refresh_storage,
            list_shares,
            reveal_storage,
            set_credentials,
            set_appearance,
            set_general,
            check_updates,
            open_updater,
            open_support,
            restart_helper,
            set_list_view,
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
                        if let Err(error) = send_to_helper(&state, &serde_json::json!({ "type": "mount_all" })) {
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
        .build(tauri::generate_context!())
        .expect("Storage Studio KH could not start");

    app.run(|app, event| match event {
        RunEvent::Exit => shutdown_helper(app),
        // A second launch of this LSUIElement app arrives as an activation, not a new process.
        RunEvent::Reopen { .. } => show_settings(app),
        _ => {}
    });
}
