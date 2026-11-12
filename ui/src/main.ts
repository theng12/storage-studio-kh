import "./styles.css";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import { icons } from "./icons";
import {
  parseShareHost,
  shareNameFromTarget,
  saveBlockReason,
  esc,
  orderWhatsNew,
  statusLabel,
  statusTone,
  testResultChanged,
  updateIsAvailable,
  updateWording,
  validateStorageDraft,
} from "./model";
import type {
  General,
  Snapshot,
  StorageInput,
  StorageKind,
  StorageView,
  UpdateState,
} from "./types";

interface Backend {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  listen<T>(event: string, handler: (payload: T) => void): Promise<() => void>;
}

type View = "storage" | "general" | "appearance" | "support";
type ThemeChoice = "system" | "light" | "dark";

interface Draft {
  id?: string;
  name: string;
  kind: StorageKind;
  target: string;
  mountPoint: string;
  volumeUUID: string | null;
  username: string;
  password: string;
  reconnectAtLogin: boolean;
  reconnectAfterWake: boolean;
}

interface EditorState {
  shareChoices: string[] | null;
  shareNote: string | null;
  browseBusy: boolean;
  browseHost: string | null;
  draft: Draft;
  originalName: string | null;
  error: string | null;
  busy: "save" | "test" | "browse" | null;
  confirmRemove: boolean;
}

interface PendingTest {
  id: string;
  detail: string | null;
  status: string;
  timer: number;
}

interface CredentialsState {
  id: string;
  name: string;
  username: string;
  password: string;
  error: string | null;
  busy: boolean;
}

interface ToastItem {
  id: number;
  message: string;
  error: boolean;
  timer: number;
}

const root = document.documentElement;
const navEl = document.querySelector<HTMLElement>("#nav")!;
const footEl = document.querySelector<HTMLElement>("#foot")!;
const mainEl = document.querySelector<HTMLElement>("#main")!;
const toastsEl = document.querySelector<HTMLElement>("#toasts")!;
const editorEl = document.querySelector<HTMLDialogElement>("#editor")!;
const whatsnewEl = document.querySelector<HTMLDialogElement>("#whatsnew")!;
const credentialsEl = document.querySelector<HTMLDialogElement>("#credentials")!;
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
const isTauri = "__TAURI_INTERNALS__" in window;
const isDev = import.meta.env.DEV && !isTauri;

let backend: Backend = {
  invoke: <T,>(command: string, args?: Record<string, unknown>) => tauriInvoke<T>(command, args),
  listen: <T,>(event: string, handler: (payload: T) => void) =>
    tauriListen<T>(event, (eventPayload) => handler(eventPayload.payload)),
};

let snapshot: Snapshot | null = null;
let view: View = "storage";
let editor: EditorState | null = null;
let credentials: CredentialsState | null = null;
let checkingUpdates = false;
let refreshingStorage = false;
let secondInstanceShown = false;
let pendingTest: PendingTest | null = null;
let booting = false;
let devPrepared = false;
let eventsWired = false;
let listenersReady = false;
const rowBusy: Record<string, string> = {};
const busy: Record<string, boolean> = {};
const toasts: ToastItem[] = [];
let toastSeq = 0;

function errText(error: unknown): string {
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return "Something went wrong. Try again.";
}

function appearanceChoice(mode: string): ThemeChoice {
  return mode === "light" || mode === "dark" ? mode : "system";
}

function effectiveTheme(choice: ThemeChoice): "light" | "dark" {
  if (choice === "light" || choice === "dark") return choice;
  return darkQuery.matches ? "dark" : "light";
}

function applyTheme(): void {
  if (!snapshot) return;
  root.dataset.theme = effectiveTheme(appearanceChoice(snapshot.appearance));
}

/* Toasts -------------------------------------------------------------- */

function toast(message: string, options: { error?: boolean; seconds?: number } = {}): void {
  const item: ToastItem = {
    id: (toastSeq += 1),
    message,
    error: options.error ?? false,
    timer: 0,
  };
  toasts.unshift(item);
  while (toasts.length > 3) {
    const removed = toasts.pop();
    if (removed) window.clearTimeout(removed.timer);
  }
  if (!item.error) {
    item.timer = window.setTimeout(() => dismissToast(item.id), (options.seconds ?? 6) * 1000);
  }
  renderToasts();
}

function dismissToast(id: number): void {
  const index = toasts.findIndex((item) => item.id === id);
  if (index < 0) return;
  window.clearTimeout(toasts[index].timer);
  toasts.splice(index, 1);
  renderToasts();
}

function renderToasts(): void {
  toastsEl.innerHTML = toasts
    .map(
      (item) => `
      <div class="toast${item.error ? " toast-error" : ""}">
        <span class="toast-text">${esc(item.message)}</span>
        ${
          item.error
            ? `<button type="button" class="toast-close" data-toast="${item.id}" title="Dismiss" aria-label="Dismiss">${icons.close}</button>`
            : ""
        }
      </div>`,
    )
    .join("");
}

/* Shell --------------------------------------------------------------- */

function render(): void {
  if (!snapshot) return;
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.fk : undefined;
  const modalOpen = Boolean(document.querySelector("dialog[open]"));
  applyTheme();
  renderNav();
  renderFoot();
  renderMain();
  if (focused && !modalOpen) {
    const next = document.querySelector<HTMLElement>(`[data-fk="${focused.replace(/["\\]/g, "")}"]`);
    next?.focus({ preventScroll: true });
  }
}

function focusTopDialog(): void {
  const dialogs = Array.from(document.querySelectorAll<HTMLDialogElement>("dialog[open]"));
  const top = dialogs[dialogs.length - 1];
  if (!top) return;
  const target = top.querySelector<HTMLElement>("[data-autofocus]") ?? top.querySelector<HTMLElement>("input, select, button");
  target?.focus();
}

function renderBootError(error: unknown): void {
  snapshot = null;
  renderNav();
  footEl.innerHTML = "";
  mainEl.innerHTML = `
    <header class="page-head">
      <div>
        <h1>Storage Studio KH</h1>
        <p class="lede">The settings window couldn't read the app's current state.</p>
      </div>
    </header>
    <div class="empty" role="alert">
      <div class="empty-icon">${icons.warning}</div>
      <p class="empty-title">Storage Studio KH couldn't start</p>
      <p class="empty-text">${esc(errText(error))}</p>
      <button type="button" class="btn btn-primary" data-action="retry-boot" data-fk="retry-boot">Retry</button>
    </div>`;
}

function renderNav(): void {
  const items: { view: View; label: string; icon: string }[] = [
    { view: "storage", label: "Storage", icon: icons.storage },
    { view: "general", label: "General", icon: icons.general },
    { view: "appearance", label: "Appearance", icon: icons.appearance },
  ];
  navEl.innerHTML = items
    .map((item) => {
      const active = view === item.view;
      return `<button type="button" class="nav-item${active ? " is-active" : ""}" data-view="${item.view}" data-fk="nav-${item.view}"${
        active ? ' aria-current="page"' : ""
      }>${item.icon}<span>${item.label}</span></button>`;
    })
    .join("");
}

function renderFoot(): void {
  if (!snapshot) return;
  const update = snapshot.update;
  const wording = updateWording(update);
  const download = updateIsAvailable(update);
  const downloadLabel = update.version ? `Download version ${update.version}` : "Download update";
  const checkBusy = checkingUpdates || update.state === "checking";
  footEl.innerHTML = `
    <button type="button" class="foot-support${view === "support" ? " is-active" : ""}" data-view="support" data-fk="nav-support"${
      view === "support" ? ' aria-current="page"' : ""
    }>${icons.heart}<span>Support this app</span></button>
    <div class="foot-updates">
      <button type="button" class="pill" data-action="whats-new" data-fk="pill" title="What's New" aria-label="What's New, ${esc(
        snapshot.appName,
      )} v${esc(snapshot.version)}">${esc(snapshot.appName)} v${esc(snapshot.version)}</button>
      <button type="button" class="icon-btn${checkBusy ? " is-spinning" : ""}" data-action="check-updates" data-fk="check" title="${
        checkBusy ? "Checking for Updates…" : "Check for Updates"
      }" aria-label="${checkBusy ? "Checking for Updates" : "Check for Updates"}"${
        checkBusy ? ' disabled aria-busy="true"' : ""
      }>${icons.refresh}</button>
      ${
        download
          ? `<button type="button" class="icon-btn icon-btn-accent" data-action="download-update" data-fk="download" title="${esc(
              downloadLabel,
            )}" aria-label="${esc(downloadLabel)}">${icons.download}</button>`
          : ""
      }
    </div>
    <p class="update-line" role="status" aria-live="polite" title="${esc(wording)}">${esc(wording)}</p>`;
}

function renderMain(): void {
  if (!snapshot) return;
  if (view === "general") {
    mainEl.innerHTML = renderGeneral();
    return;
  }
  if (view === "appearance") {
    mainEl.innerHTML = renderAppearance();
    return;
  }
  if (view === "support") {
    mainEl.innerHTML = renderSupport();
    return;
  }
  mainEl.innerHTML = renderStorage();
}

function renderEngineBannerIfNeeded(): string {
  return snapshot && !snapshot.engineRunning ? renderEngineBanner(snapshot) : "";
}

function renderStorage(): string {
  if (!snapshot) return "";
  const s = snapshot;
  return `
    <header class="page-head">
      <div>
        <h1>Storage</h1>
        <p class="lede">Shares and disks reconnect after login, after wake, and when the network changes.</p>
      </div>
      ${
        s.storages.length
          ? `<button type="button" class="btn btn-primary" data-action="add-storage" data-fk="add-storage">${icons.plus}<span>Add storage</span></button>`
          : ""
      }
    </header>
    ${renderEngineBannerIfNeeded()}
    ${s.storages.length ? `<ul class="storage-list">${s.storages.map(renderStorageRow).join("")}</ul>` : renderEmpty()}`;
}

function renderEngineBanner(s: Snapshot): string {
  const reason = s.engineError ?? "Storages can't mount or reconnect until it runs again.";
  return `
    <div class="banner" role="alert">
      ${icons.warning}
      <div>
        <p class="banner-title">The background helper isn't running</p>
        <p class="banner-text">${esc(reason)}</p>
        <p class="banner-text">Reopening Storage Studio KH restarts it.</p>
      </div>
    </div>`;
}

function renderEmpty(): string {
  return `
    <div class="empty">
      <div class="empty-icon">${icons.drive}</div>
      <p class="empty-title">No storage yet</p>
      <p class="empty-text">Add a share or disk and Storage Studio KH will reconnect it after login, after wake, and when the network changes.</p>
      <button type="button" class="btn btn-primary" data-action="add-storage">${icons.plus}<span>Add storage</span></button>
    </div>`;
}

function renderStorageRow(storage: StorageView): string {
  const tone = statusTone(storage.status);
  const mounted = storage.status === "mounted";
  const busyAction = rowBusy[storage.id];
  const engine = Boolean(snapshot?.engineRunning);
  const helperTitle = engine ? "" : ' title="The background helper isn\'t running."';
  const disabled = busyAction ? " disabled" : "";

  const mountLabel = mounted
    ? ""
    : `<button type="button" class="row-btn row-btn-accent" data-action="mount" data-id="${esc(storage.id)}" data-fk="row-${esc(storage.id)}-mount"${
        disabled || !engine || storage.status === "mounting" ? " disabled" : ""
      }${helperTitle}>${busyAction === "mount" ? "Mounting…" : "Mount now"}</button>`;
  const unmountLabel = mounted
    ? `<button type="button" class="row-btn" data-action="unmount" data-id="${esc(storage.id)}" data-fk="row-${esc(storage.id)}-unmount"${disabled || !engine ? " disabled" : ""}${helperTitle}>${
        busyAction === "unmount" ? "Unmounting…" : "Unmount"
      }</button>`
    : "";
  const finderLabel = `<button type="button" class="row-btn" data-action="reveal" data-id="${esc(storage.id)}" data-fk="row-${esc(storage.id)}-reveal"${
    storage.mountedPath ? "" : ' disabled title="Mount the storage to open it in Finder."'
  }>Open in Finder</button>`;
  const testLabel = `<button type="button" class="row-btn" data-action="test" data-id="${esc(storage.id)}" data-fk="row-${esc(storage.id)}-test"${disabled || !engine ? " disabled" : ""}${helperTitle}>${
    busyAction === "test" ? "Testing…" : "Test"
  }</button>`;
  const editLabel = `<button type="button" class="row-btn" data-action="edit" data-id="${esc(storage.id)}" data-fk="row-${esc(storage.id)}-edit">Edit</button>`;

  const facts = [
    storage.reconnectAtLogin ? "Reconnects at login" : "No reconnect at login",
    storage.reconnectAfterWake ? "Reconnects after wake" : "No reconnect after wake",
  ];

  return `
    <li class="storage-row" data-storage="${esc(storage.id)}">
      <div class="storage-head">
        <div class="storage-id">
          <h3>${esc(storage.name)}</h3>
          <p class="storage-kind">${storage.kind === "smb" ? "SMB share" : "Attached disk"}</p>
        </div>
        <span class="chip chip-${tone}">${statusLabel(storage.status)}</span>
      </div>
      ${storage.detail ? `<p class="storage-detail">${esc(storage.detail)}</p>` : ""}
      ${
        storage.mountedPath
          ? `<p class="storage-path">${icons.folder}<span>Mounted at</span> <span class="path-text">${esc(storage.mountedPath)}</span></p>`
          : ""
      }
      <p class="facts">${facts
        .map(
          (fact, index) =>
            `<span class="fact${index === 0 && !storage.reconnectAtLogin ? " fact-off" : ""}${
              index === 1 && !storage.reconnectAfterWake ? " fact-off" : ""
            }">${index === 0 ? (storage.reconnectAtLogin ? icons.check : icons.dash) : storage.reconnectAfterWake ? icons.check : icons.dash}<span>${fact}</span></span>`,
        )
        .join("")}</p>
      <div class="row-actions">${mountLabel}${unmountLabel}${finderLabel}${testLabel}${editLabel}</div>
    </li>`;
}

function renderGeneral(): string {
  if (!snapshot) return "";
  const s = snapshot;
  const general = s.general;
  const generalBusy = Boolean(busy.general);
  const loginNote = s.launchAtLoginError
    ? `<p class="inline-note" role="status">macOS couldn't change the login item: ${esc(s.launchAtLoginError)}</p>`
    : general.launchAtLogin !== s.launchAtLoginEnabled
      ? `<p class="inline-note inline-note-warn" role="status">The login item didn't change. Launch at login is currently ${
          s.launchAtLoginEnabled ? "on" : "off"
        }.</p>`
      : "";
  return `
    <header class="page-head">
      <div>
        <h1>General</h1>
        <p class="lede">How Storage Studio KH behaves on this Mac.</p>
      </div>
    </header>
    ${renderEngineBannerIfNeeded()}
    <section class="group" aria-label="General settings">
      <div class="setting-row">
        <div class="setting-copy">
          <span class="setting-title" id="notifications-title">Notifications</span>
          <p class="setting-hint">Tell me when a storage reconnects or stops trying.</p>
        </div>
        <label class="switch">
          <input type="checkbox" data-general="notifications" data-fk="general-notifications" aria-labelledby="notifications-title" ${
            general.notifications ? "checked" : ""
          }${generalBusy ? " disabled" : ""} />
          <span class="track"></span>
        </label>
      </div>
      <div class="setting-row">
        <div class="setting-copy">
          <span class="setting-title" id="login-title">Launch at login</span>
          <p class="setting-hint">Start Storage Studio KH when you log in, so your storage reconnects without opening the app.</p>
          ${loginNote}
        </div>
        <label class="switch">
          <input type="checkbox" data-general="launchAtLogin" data-fk="general-launch" aria-labelledby="login-title" ${
            general.launchAtLogin ? "checked" : ""
          }${generalBusy ? " disabled" : ""} />
          <span class="track"></span>
        </label>
      </div>
      <div class="setting-row">
        <div class="setting-copy">
          <span class="setting-title" id="retries-title">Retries before it stops</span>
          <p class="setting-hint">Choose from 1 to 8. The default is 3.</p>
        </div>
        <input class="number-input" type="number" min="1" max="8" step="1" value="${general.retries}" data-general="retries" data-fk="general-retries" aria-labelledby="retries-title"${
          generalBusy ? " disabled" : ""
        } />
      </div>
    </section>
    <p class="note">It retries after 5 s, 15 s and 60 s, then stops and marks the storage <strong>Needs attention</strong> until you choose Mount now.</p>`;
}

function renderAppearance(): string {
  if (!snapshot) return "";
  const choice = appearanceChoice(snapshot.appearance);
  const appearanceBusy = Boolean(busy.appearance);
  const options: { value: ThemeChoice; label: string; icon: string }[] = [
    { value: "system", label: "System", icon: icons.monitor },
    { value: "light", label: "Light", icon: icons.sun },
    { value: "dark", label: "Dark", icon: icons.moon },
  ];
  return `
    <header class="page-head">
      <div>
        <h1>Appearance</h1>
        <p class="lede">Choose how Storage Studio KH looks.</p>
      </div>
    </header>
    ${renderEngineBannerIfNeeded()}
    <section class="group appearance-block" aria-label="Appearance">
      <div class="segmented" role="radiogroup" aria-label="Appearance">
        ${options
          .map(
            (option) => `
          <label>
            <input type="radio" name="appearance" value="${option.value}" data-appearance="${option.value}" data-fk="appearance-${option.value}" ${
              choice === option.value ? "checked" : ""
            }${appearanceBusy ? " disabled" : ""} />
            <span>${option.icon}${option.label}</span>
          </label>`,
          )
          .join("")}
      </div>
      <p class="note">System follows your Mac's light or dark appearance.</p>
    </section>`;
}

function renderSupport(): string {
  return `
    <header class="page-head">
      <div>
        <h1>Support</h1>
        <p class="lede">How you can support Storage Studio KH.</p>
      </div>
    </header>
    <section class="support-copy">
      <p>Storage Studio KH is free, with everything unlocked. A one-time donation is optional — it is never required to keep using the app.</p>
      <button type="button" class="btn btn-primary" data-action="open-support">Open donation page</button>
    </section>`;
}

/* Storage actions ----------------------------------------------------- */

function openEditor(storage?: StorageView): void {
  if (!snapshot) return;
  const draft: Draft = storage
    ? {
        id: storage.id,
        name: storage.name,
        kind: storage.kind,
        target: storage.target,
        mountPoint: storage.mountPoint,
        volumeUUID: storage.volumeUUID,
        username: storage.username ?? "",
        password: "",
        reconnectAtLogin: storage.reconnectAtLogin,
        reconnectAfterWake: storage.reconnectAfterWake,
      }
    : {
        name: "",
        kind: "smb",
        target: "",
        mountPoint: "",
        volumeUUID: null,
        username: "",
        password: "",
        reconnectAtLogin: true,
        reconnectAfterWake: true,
      };
  editor = {
    draft,
    originalName: storage?.name ?? null,
    error: null,
    busy: null,
    confirmRemove: false,
    shareChoices: null,
    shareNote: null,
    browseBusy: false,
    browseHost: null,
  };
  renderEditor();
  if (!editorEl.open) editorEl.showModal();
  const first = editorEl.querySelector<HTMLElement>('[name="name"]');
  first?.focus();
}

function closeEditor(): void {
  editor = null;
  if (editorEl.open) editorEl.close();
}

function shareLine(d: Draft): string {
  const name = d.kind === "smb" ? shareNameFromTarget(d.target) : null;
  return name ? `<span class="quiet-line" id="share-name">Share: ${esc(name)}</span>` : "";
}

function browsePanel(): string {
  if (!editor) return "";
  if (editor.shareChoices) {
    return `<div class="share-picker" role="group" aria-label="Shares on this device">
      ${editor.shareChoices
        .map(
          (share) =>
            `<button type="button" class="share-choice" data-editor-action="pick-share" data-share="${esc(
              share,
            )}" data-fk="share-${esc(share)}">${esc(share)}</button>`,
        )
        .join("")}
    </div>`;
  }
  return editor.shareNote ? `<span class="field-hint" role="status">${esc(editor.shareNote)}</span>` : "";
}

function renderEditor(): void {
  if (!editor) return;
  const focused = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLSelectElement
    ? document.activeElement
    : null;
  const focusName = focused?.name;
  const focusValue = focused?.type === "radio" ? focused.value : "";

  if (editor.confirmRemove) {
    const name = editor.originalName ?? "this storage";
    editorEl.innerHTML = `
      <div class="sheet-head">
        <h2 id="editor-title">Remove ${esc(name)}?</h2>
        <p class="sheet-sub">Storage Studio KH will stop reconnecting it. The files stay where they are.</p>
      </div>
      <div class="sheet-body">
        ${editor.error ? `<p class="form-error" role="alert">${esc(editor.error)}</p>` : ""}
        <p class="confirm-text">This only removes the storage from Storage Studio KH. Nothing is deleted from the share or disk.</p>
      </div>
      <div class="sheet-actions">
        <button type="button" class="btn btn-danger" data-editor-action="confirm-remove" data-fk="editor-confirm-remove"${
          editor.busy ? " disabled" : ""
        }>Remove ${esc(name)}</button>
        <span class="spacer"></span>
        <button type="button" class="btn btn-primary" data-editor-action="keep" data-fk="editor-keep">Keep</button>
      </div>`;
    const keep = editorEl.querySelector<HTMLElement>('[data-editor-action="keep"]');
    keep?.focus();
    return;
  }

  const d = editor.draft;
  const isEdit = Boolean(d.id);
  const volumes = snapshot?.volumes ?? [];
  const savedVolumeMissing = d.kind === "volume" && d.volumeUUID && !volumes.some((volume) => volume.uuid === d.volumeUUID);
  const blockReason = saveBlockReason(d);
  const identityFields =
    d.kind === "smb"
      ? `
        <label class="field">
          <span class="field-label">Share address (host + share)</span>
          <div class="browse-row">
            <input type="text" name="target" value="${esc(d.target)}" placeholder="smb://nas.local/studio" spellcheck="false" autocomplete="off"${
              editor.busy ? " disabled" : ""
            } />
            <button type="button" class="btn" data-editor-action="browse" data-fk="editor-browse"${
              editor.busy || editor.browseBusy ? " disabled" : ""
            }>${editor.browseBusy ? "Looking…" : "Browse…"}</button>
          </div>
          <span class="field-hint">A share address starts with smb:// and includes the share name.</span>
          ${shareLine(d)}
          ${browsePanel()}
        </label>
        <label class="field">
          <span class="field-label">User name (optional)</span>
          <input type="text" name="username" value="${esc(d.username)}" autocomplete="off"${
            editor.busy ? " disabled" : ""
          } />
        </label>
        <label class="field">
          <span class="field-label">Password (optional)</span>
          <input type="password" name="password" value="${esc(d.password)}" placeholder="Saved in the Keychain; leave blank to keep the saved one" autocomplete="off"${
            editor.busy ? " disabled" : ""
          } />
        </label>
        <label class="field">
          <span class="field-label">Mount point (optional)</span>
          <input type="text" name="mountPoint" value="${esc(d.mountPoint)}" placeholder="/Volumes/studio" spellcheck="false" autocomplete="off"${
            editor.busy ? " disabled" : ""
          }${d.kind === "smb" ? "" : " readonly"} />
          <span class="field-hint">Leave blank and macOS chooses a folder in /Volumes.</span>
        </label>`
      : `
        <label class="field">
          <span class="field-label">Disk</span>
          <select name="volumeUUID"${volumes.length ? "" : " disabled"}>
            <option value="">Choose a disk</option>
            ${
              savedVolumeMissing
                ? `<option value="${esc(d.volumeUUID)}" selected>Saved disk — ${esc(d.mountPoint || "path not known")}</option>`
                : ""
            }
            ${volumes
              .map(
                (volume) =>
                  `<option value="${esc(volume.uuid)}"${volume.uuid === d.volumeUUID ? " selected" : ""}>${esc(volume.name)} — ${esc(
                    volume.path,
                  )}</option>`,
              )
              .join("")}
          </select>
          <span class="field-hint">${
            volumes.length
              ? "These disks are connected now. Choose the one to reconnect."
              : "Connect the disk first, then reopen this window."
          }</span>
        </label>
        ${
          d.mountPoint
            ? `<p class="volume-choice">Reconnects at <span class="path-text">${esc(d.mountPoint)}</span></p>`
            : ""
        }`;

  editorEl.innerHTML = `
    <div class="sheet-head">
      <h2 id="editor-title">${isEdit ? "Edit storage" : "Add storage"}</h2>
      <p class="sheet-sub">${isEdit ? "Change how this storage reconnects." : "A share or disk that reconnects on its own."}</p>
    </div>
    <div class="sheet-body">
      ${editor.error ? `<p class="form-error" role="alert">${esc(editor.error)}</p>` : ""}
      <label class="field">
        <span class="field-label">Name</span>
        <input type="text" name="name" value="${esc(d.name)}" placeholder="Studio NAS" autocomplete="off" data-autofocus data-fk="editor-name"${
          editor.busy ? " disabled" : ""
        } />
      </label>
      <fieldset class="field">
        <legend class="field-label">Kind</legend>
        <div class="segmented" role="radiogroup" aria-label="Kind">
          <label>
            <input type="radio" name="kind" value="smb" ${d.kind === "smb" ? "checked" : ""}${editor.busy ? " disabled" : ""} />
            <span>SMB share</span>
          </label>
          <label>
            <input type="radio" name="kind" value="volume" ${d.kind === "volume" ? "checked" : ""}${editor.busy ? " disabled" : ""} />
            <span>Attached disk</span>
          </label>
        </div>
      </fieldset>
      ${identityFields}
      <div class="check-stack">
        <label class="check-row"><input type="checkbox" name="login" ${d.reconnectAtLogin ? "checked" : ""}${
          editor.busy ? " disabled" : ""
        } /> Reconnect at login</label>
        <label class="check-row"><input type="checkbox" name="wake" ${d.reconnectAfterWake ? "checked" : ""}${
          editor.busy ? " disabled" : ""
        } /> Reconnect after wake</label>
      </div>
    </div>
    <div class="sheet-actions">
      ${
        isEdit
          ? `<button type="button" class="btn btn-quiet-danger" data-editor-action="remove" data-fk="editor-remove"${editor.busy ? " disabled" : ""}>Remove</button>`
          : ""
      }
      <span class="spacer"></span>
      ${
        blockReason
          ? `<span class="save-reason" id="save-reason">${esc(blockReason)}</span>`
          : ""
      }
      <button type="button" class="btn" data-editor-action="cancel" data-fk="editor-cancel"${editor.busy === "save" ? " disabled" : ""}>Cancel</button>
      <button type="button" class="btn" data-editor-action="test" data-fk="editor-test"${
        !isEdit || editor.busy ? " disabled" : ""
      } title="${isEdit ? "Test the saved storage settings." : "Save the storage before testing it."}">${
        editor.busy === "test" ? "Testing…" : "Test"
      }</button>
      <button type="button" class="btn btn-primary" data-editor-action="save" data-fk="editor-save"${
        editor.busy || blockReason ? " disabled" : ""
      }${blockReason ? ' aria-describedby="save-reason"' : ""}>${
        editor.busy === "save" ? "Saving…" : "Save"
      }</button>
    </div>`;

  if (focusName) {
    const selector = focusValue ? `input[name="${focusName}"][value="${focusValue}"]` : `[name="${focusName}"]`;
    editorEl.querySelector<HTMLElement>(selector)?.focus();
  }
}

function syncEditorField(target: HTMLInputElement | HTMLSelectElement): void {
  if (!editor) return;
  const draft = editor.draft;
  switch (target.name) {
    case "name":
      draft.name = target.value;
      break;
    case "target":
      draft.target = target.value;
      break;
    case "username":
      draft.username = target.value;
      break;
    case "password":
      draft.password = target.value;
      break;
    case "mountPoint":
      draft.mountPoint = target.value;
      break;
    case "kind": {
      const kind = target.value === "volume" ? "volume" : "smb";
      if (kind !== draft.kind) {
        draft.kind = kind;
        draft.target = "";
        draft.mountPoint = "";
        draft.volumeUUID = null;
        renderEditor();
      }
      break;
    }
    case "volumeUUID": {
      const volume = snapshot?.volumes.find((candidate) => candidate.uuid === target.value);
      draft.volumeUUID = volume?.uuid ?? (target.value || null);
      if (volume) {
        draft.mountPoint = volume.path;
        draft.target = volume.device;
        renderEditor();
      }
      break;
    }
    case "login":
      draft.reconnectAtLogin = (target as HTMLInputElement).checked;
      break;
    case "wake":
      draft.reconnectAfterWake = (target as HTMLInputElement).checked;
      break;
  }
}

async function browseShares(): Promise<void> {
  if (!editor || editor.busy || editor.browseBusy) return;
  const host = parseShareHost(editor.draft.target);
  if (!host) {
    editor.error = "Enter the device address first, like smb://192.168.0.217.";
    renderEditor();
    editorEl.querySelector<HTMLElement>('[name="target"]')?.focus();
    return;
  }
  editor.browseBusy = true;
  editor.shareChoices = null;
  editor.shareNote = null;
  editor.browseHost = host;
  editor.error = null;
  renderEditor();
  try {
    await backend.invoke<null>("list_shares", {
      address: editor.draft.target.trim(),
      username: editor.draft.username,
      password: editor.draft.password,
    });
  } catch (error) {
    if (!editor) return;
    editor.browseBusy = false;
    editor.shareNote = error instanceof Error ? error.message : String(error);
    renderEditor();
  }
}

function applyShares(payload: { host: string; shares: string[]; needsCredentials: boolean; error: string | null }): void {
  if (!editor || !editor.browseBusy) return;
  editor.browseBusy = false;
  if (payload.needsCredentials) {
    editor.shareNote = "That device needs a user name and password. Enter them above, then choose Browse again.";
    editor.error = null;
    renderEditor();
    editorEl.querySelector<HTMLElement>('[name="username"]')?.focus();
    return;
  }
  if (payload.error) {
    editor.shareNote = payload.error;
    renderEditor();
    return;
  }
  if (!payload.shares.length) {
    editor.shareNote = "That device didn't offer any shares.";
    renderEditor();
    return;
  }
  editor.shareChoices = payload.shares;
  editor.shareNote = null;
  renderEditor();
}

function pickShare(share: string): void {
  if (!editor || !share) return;
  const host = editor.browseHost ?? parseShareHost(editor.draft.target);
  if (!host) return;
  editor.draft.target = `smb://${host}/${encodeURIComponent(share)}`;
  editor.shareChoices = null;
  editor.shareNote = null;
  editor.error = null;
  renderEditor();
  editorEl.querySelector<HTMLElement>('[name="target"]')?.focus();
}

async function saveEditor(): Promise<void> {
  if (!editor || editor.busy) return;
  const d = editor.draft;
  const validationError = validateStorageDraft(d);
  if (validationError) {
    editor.error = validationError;
    renderEditor();
    return;
  }
  editor.busy = "save";
  editor.error = null;
  renderEditor();
  const input: StorageInput = {
    name: d.name.trim(),
    kind: d.kind,
    target: d.target.trim(),
    mountPoint: d.mountPoint.trim(),
    volumeUUID: d.volumeUUID,
    reconnectAtLogin: d.reconnectAtLogin,
    reconnectAfterWake: d.reconnectAfterWake,
  };
  if (d.id) input.id = d.id;
  if (d.kind === "smb") {
    input.username = d.username.trim();
    if (d.password) input.password = d.password;
  }
  try {
    snapshot = await backend.invoke<Snapshot>("save_storage", { input });
    closeEditor();
    render();
  } catch (error) {
    if (editor) {
      editor.busy = null;
      editor.error = errText(error);
      renderEditor();
    }
  }
}

function beginTest(id: string): void {
  const storage = snapshot?.storages.find((item) => item.id === id);
  if (pendingTest) window.clearTimeout(pendingTest.timer);
  pendingTest = { id, detail: storage?.detail ?? null, status: storage?.status ?? "", timer: 0 };
  pendingTest.timer = window.setTimeout(() => {
    pendingTest = null;
  }, 12000);
}

function clearPendingTest(): void {
  if (pendingTest) window.clearTimeout(pendingTest.timer);
  pendingTest = null;
}

async function testEditor(): Promise<void> {
  if (!editor || editor.busy) return;
  const id = editor.draft.id;
  if (!id) {
    editor.error = "Save the storage before testing it.";
    renderEditor();
    return;
  }
  editor.busy = "test";
  editor.error = null;
  beginTest(id);
  renderEditor();
  try {
    await backend.invoke("test_storage", { id });
  } catch (error) {
    clearPendingTest();
    if (editor) {
      editor.busy = null;
      editor.error = errText(error);
      renderEditor();
    }
  }
}

async function removeFromEditor(): Promise<void> {
  if (!editor?.draft.id || editor.busy) return;
  editor.busy = "save";
  renderEditor();
  try {
    snapshot = await backend.invoke<Snapshot>("remove_storage", { id: editor.draft.id });
    closeEditor();
    render();
  } catch (error) {
    if (editor) {
      editor.busy = null;
      editor.error = errText(error);
      renderEditor();
    }
  }
}

/* Row actions --------------------------------------------------------- */

const ROW_COMMANDS: Record<string, string> = {
  mount: "mount_storage",
  unmount: "unmount_storage",
  test: "test_storage",
};

async function runRowAction(id: string, action: string): Promise<void> {
  if (!snapshot || rowBusy[id]) return;
  const command = ROW_COMMANDS[action];
  if (!command) return;
  rowBusy[id] = action;
  if (action === "test") beginTest(id);
  render();
  try {
    await backend.invoke(command, { id });
    window.setTimeout(() => {
      if (rowBusy[id] === action) {
        delete rowBusy[id];
        render();
      }
    }, 15000);
  } catch (error) {
    delete rowBusy[id];
    if (action === "test") clearPendingTest();
    toast(errText(error), { error: true });
    render();
  }
}

async function revealStorage(id: string): Promise<void> {
  try {
    await backend.invoke("reveal_storage", { id });
  } catch (error) {
    toast(errText(error), { error: true });
  }
}

/* General and appearance ---------------------------------------------- */

async function setGeneral(patch: Partial<General>): Promise<void> {
  if (!snapshot || busy.general) return;
  const current = snapshot.general;
  let retries = patch.retries ?? current.retries;
  if (!Number.isFinite(retries) || retries < 1 || retries > 8) retries = current.retries;
  const next: General = {
    notifications: patch.notifications ?? current.notifications,
    launchAtLogin: patch.launchAtLogin ?? current.launchAtLogin,
    retries: Math.round(retries),
  };
  busy.general = true;
  render();
  try {
    snapshot = await backend.invoke<Snapshot>("set_general", { ...next });
  } catch (error) {
    toast(errText(error), { error: true });
  } finally {
    delete busy.general;
    render();
  }
}

async function setAppearance(mode: ThemeChoice): Promise<void> {
  if (!snapshot || busy.appearance) return;
  busy.appearance = true;
  render();
  try {
    snapshot = await backend.invoke<Snapshot>("set_appearance", { mode });
  } catch (error) {
    toast(errText(error), { error: true });
  } finally {
    delete busy.appearance;
    render();
  }
}

/* Updates and support -------------------------------------------------- */

async function checkUpdates(): Promise<void> {
  if (!snapshot || checkingUpdates) return;
  checkingUpdates = true;
  render();
  try {
    const update = await backend.invoke<UpdateState>("check_updates");
    if (snapshot) {
      snapshot.update = update;
      render();
    }
  } catch (error) {
    if (snapshot) {
      snapshot.update = { state: "failed", version: null, reason: errText(error) };
      render();
    }
    toast(errText(error), { error: true });
  } finally {
    checkingUpdates = false;
    render();
  }
}

async function refreshStorage(): Promise<void> {
  if (!snapshot || refreshingStorage) return;
  refreshingStorage = true;
  try {
    await backend.invoke("refresh_storage");
  } catch (error) {
    toast(errText(error), { error: true });
  } finally {
    refreshingStorage = false;
  }
}

async function openUpdater(): Promise<void> {
  try {
    await backend.invoke("open_updater");
  } catch (error) {
    toast(errText(error), { error: true });
  }
}

async function openSupport(): Promise<void> {
  try {
    await backend.invoke("open_support");
  } catch (error) {
    toast(errText(error), { error: true });
  }
}

/* What's New ---------------------------------------------------------- */

function openWhatsNew(): void {
  if (!snapshot) return;
  renderWhatsNew();
  if (!whatsnewEl.open) whatsnewEl.showModal();
}

function renderWhatsNew(): void {
  if (!snapshot) return;
  const s = snapshot;
  const entries = orderWhatsNew(s.whatsNew);
  const releases = entries.length
    ? entries
        .map(
          (entry) => `
          <section class="release">
            <div class="release-head">
              <h3>${esc(entry.version)}</h3>
              ${entry.version === s.version ? '<span class="current-badge">Current version</span>' : ""}
              ${entry.date ? `<span class="release-date">${esc(entry.date)}</span>` : ""}
            </div>
            ${
              entry.items.length
                ? `<ul>${entry.items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`
                : '<p class="sheet-sub">No notes for this version.</p>'
            }
          </section>`,
        )
        .join("")
    : '<p class="sheet-sub">No release notes yet.</p>';
  whatsnewEl.innerHTML = `
    <div class="sheet-head">
      <h2 id="whatsnew-title">What's New</h2>
      <p class="sheet-sub">${esc(s.appName)} ${esc(s.version)}</p>
    </div>
    <div class="sheet-body">${releases}</div>
    <div class="sheet-actions">
      <span class="spacer"></span>
      <button type="button" class="btn btn-primary" data-whatsnew-action="close">Close</button>
    </div>`;
  whatsnewEl.querySelector<HTMLElement>('[data-whatsnew-action="close"]')?.focus();
}

/* Credentials --------------------------------------------------------- */

function openCredentials(id: string, name: string): void {
  const storage = snapshot?.storages.find((item) => item.id === id);
  credentials = {
    id,
    name,
    username: storage?.username ?? "",
    password: "",
    error: null,
    busy: false,
  };
  renderCredentials();
  if (!credentialsEl.open) credentialsEl.showModal();
  const target = credentialsEl.querySelector<HTMLElement>(
    credentials.username ? '[name="credential-password"]' : '[name="credential-username"]',
  );
  target?.focus();
}

function closeCredentials(): void {
  credentials = null;
  if (credentialsEl.open) credentialsEl.close();
  focusTopDialog();
}

function closeWhatsNew(): void {
  if (whatsnewEl.open) whatsnewEl.close();
  focusTopDialog();
}

function renderCredentials(): void {
  if (!credentials) return;
  credentialsEl.innerHTML = `
    <div class="sheet-head">
      <h2 id="credentials-title">Sign in to ${esc(credentials.name)}</h2>
      <p class="sheet-sub">Storage Studio KH needs a user name and password for this share. The password is saved in the macOS Keychain.</p>
    </div>
    <div class="sheet-body">
      ${credentials.error ? `<p class="form-error" role="alert">${esc(credentials.error)}</p>` : ""}
      <label class="field">
        <span class="field-label">User name</span>
        <input type="text" name="credential-username" value="${esc(credentials.username)}" autocomplete="username" data-autofocus data-fk="credentials-username"${credentials.username ? "" : " autofocus"} />
      </label>
      <label class="field">
        <span class="field-label">Password</span>
        <input type="password" name="credential-password" value="${esc(credentials.password)}" autocomplete="current-password" data-fk="credentials-password"${credentials.username ? " autofocus" : ""} />
      </label>
    </div>
    <div class="sheet-actions">
      <span class="spacer"></span>
      <button type="button" class="btn" data-credentials-action="cancel"${credentials.busy ? " disabled" : ""}>Cancel</button>
      <button type="button" class="btn btn-primary" data-credentials-action="save"${credentials.busy ? " disabled" : ""}>${
        credentials.busy ? "Saving…" : "Save"
      }</button>
    </div>`;
}

async function saveCredentials(): Promise<void> {
  if (!credentials || credentials.busy) return;
  const usernameInput = credentialsEl.querySelector<HTMLInputElement>('[name="credential-username"]');
  const passwordInput = credentialsEl.querySelector<HTMLInputElement>('[name="credential-password"]');
  const username = usernameInput?.value.trim() ?? "";
  const password = passwordInput?.value ?? "";
  if (!password) {
    credentials.error = "Enter the password for this share.";
    renderCredentials();
    credentialsEl.querySelector<HTMLInputElement>('[name="credential-password"]')?.focus();
    return;
  }
  credentials.username = username;
  credentials.busy = true;
  credentials.error = null;
  renderCredentials();
  try {
    await backend.invoke("set_credentials", { id: credentials.id, username, password });
    closeCredentials();
  } catch (error) {
    if (credentials) {
      credentials.busy = false;
      credentials.error = errText(error);
      renderCredentials();
      credentialsEl.querySelector<HTMLInputElement>('[name="credential-password"]')?.focus();
    }
  }
}

/* Events and wiring --------------------------------------------------- */

function showSecondInstance(): void {
  if (secondInstanceShown) return;
  secondInstanceShown = true;
  toast("Storage Studio KH is already running. This window is the running copy.", { seconds: 10 });
}

function applySnapshot(next: Snapshot): void {
  snapshot = next;
  for (const id of Object.keys(rowBusy)) delete rowBusy[id];
  if (pendingTest) {
    const storage = next.storages.find((item) => item.id === pendingTest?.id);
    if (
      storage &&
      pendingTest &&
      testResultChanged({ detail: pendingTest.detail, status: pendingTest.status }, storage)
    ) {
      toast(`Test: ${storage.detail ?? statusLabel(storage.status)}`);
      clearPendingTest();
    }
  }
  if (editor?.busy === "test") {
    editor.busy = null;
    renderEditor();
  }
  if (next.secondInstance) showSecondInstance();
  render();
}

function applyDevLocation(): void {
  if (!isDev) return;
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const requested = params.get("view");
  if (requested === "general" || requested === "appearance" || requested === "support" || requested === "storage") {
    view = requested;
  }
  render();
  if (params.has("whats-new")) openWhatsNew();
  if (params.get("add") === "1") {
    openEditor();
  }
  const edit = params.get("edit");
  if (edit) {
    const storage = snapshot?.storages.find((item) => item.id === edit);
    if (storage) openEditor(storage);
  }
}

function wireEvents(): void {
  document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;

    const viewButton = target.closest<HTMLElement>("[data-view]");
    if (viewButton?.dataset.view) {
      view = viewButton.dataset.view as View;
      mainEl.scrollTop = 0;
      render();
      return;
    }

    const actionButton = target.closest<HTMLElement>("[data-action]");
    if (actionButton) {
      const action = actionButton.dataset.action;
      const id = actionButton.dataset.id ?? "";
      if (action === "whats-new") openWhatsNew();
      else if (action === "check-updates") void checkUpdates();
      else if (action === "download-update") void openUpdater();
      else if (action === "add-storage") openEditor();
      else if (action === "open-support") void openSupport();
      else if (action === "retry-boot") void boot();
      else if (action === "mount" || action === "unmount" || action === "test") void runRowAction(id, action);
      else if (action === "reveal") void revealStorage(id);
      else if (action === "edit") {
        const storage = snapshot?.storages.find((item) => item.id === id);
        if (storage) openEditor(storage);
      }
      return;
    }

    const toastButton = target.closest<HTMLElement>("[data-toast]");
    if (toastButton?.dataset.toast) dismissToast(Number(toastButton.dataset.toast));
  });

  document.addEventListener("change", (event) => {
    const target = event.target as HTMLInputElement;
    if (target.dataset.general === "notifications") void setGeneral({ notifications: target.checked });
    else if (target.dataset.general === "launchAtLogin") void setGeneral({ launchAtLogin: target.checked });
    else if (target.dataset.general === "retries") void setGeneral({ retries: Number(target.value) });
    else if (target.dataset.appearance) void setAppearance(target.dataset.appearance as ThemeChoice);
  });

  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "r") {
      event.preventDefault();
      void refreshStorage();
    }
  });

  darkQuery.addEventListener("change", () => {
    if (snapshot) applyTheme();
  });

  editorEl.addEventListener("input", (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) syncEditorField(target);
  });

  editorEl.addEventListener("change", (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) syncEditorField(target);
  });

  editorEl.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-editor-action]");
    if (!button) return;
    switch (button.dataset.editorAction) {
      case "cancel":
        closeEditor();
        break;
      case "remove":
        if (editor) {
          editor.confirmRemove = true;
          editor.error = null;
          renderEditor();
        }
        break;
      case "keep":
        if (editor) {
          editor.confirmRemove = false;
          editor.error = null;
          renderEditor();
        }
        break;
      case "confirm-remove":
        void removeFromEditor();
        break;
      case "test":
        void testEditor();
        break;
      case "save":
        void saveEditor();
        break;
      case "browse":
        void browseShares();
        break;
      case "pick-share":
        pickShare(button.dataset.share ?? "");
        break;
    }
  });

  whatsnewEl.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-whatsnew-action]");
    if (button?.dataset.whatsnewAction === "close") closeWhatsNew();
  });

  credentialsEl.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-credentials-action]");
    if (!button) return;
    if (button.dataset.credentialsAction === "cancel") closeCredentials();
    if (button.dataset.credentialsAction === "save") void saveCredentials();
  });

  credentialsEl.addEventListener("input", (event) => {
    const target = event.target;
    if (!credentials || !(target instanceof HTMLInputElement)) return;
    if (target.name === "credential-username") credentials.username = target.value;
    if (target.name === "credential-password") credentials.password = target.value;
  });

  credentialsEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.target as HTMLElement).tagName === "INPUT") {
      event.preventDefault();
      void saveCredentials();
    }
  });

  for (const dialog of [editorEl, whatsnewEl, credentialsEl]) {
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      if (dialog === editorEl && editor?.confirmRemove) return;
      if (dialog === editorEl) closeEditor();
      else if (dialog === whatsnewEl) closeWhatsNew();
      else closeCredentials();
    });
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      if (dialog === editorEl) {
        if (editor?.confirmRemove) {
          editor.confirmRemove = false;
          editor.error = null;
          renderEditor();
        } else {
          closeEditor();
        }
      } else if (dialog === whatsnewEl) {
        closeWhatsNew();
      } else {
        closeCredentials();
      }
    });
  }
}

async function attachListeners(): Promise<void> {
  const cleanups: (() => void)[] = [];
  try {
    cleanups.push(await backend.listen<Snapshot>("snapshot", applySnapshot));
    cleanups.push(await backend.listen("shares", applyShares));
    cleanups.push(
      await backend.listen<{ id: string; name: string }>("needs-credentials", (payload) => {
        openCredentials(payload.id, payload.name);
      }),
    );
    cleanups.push(
      await backend.listen("second-instance", () => {
        showSecondInstance();
      }),
    );
    cleanups.push(
      await backend.listen("show-whats-new", () => {
        openWhatsNew();
      }),
    );
  } catch (error) {
    for (const cleanup of cleanups) cleanup();
    throw error;
  }
}

async function boot(): Promise<void> {
  if (booting) return;
  booting = true;
  try {
    if (import.meta.env.DEV && !isTauri && !devPrepared) {
      const dev = await import("./dev-fixture");
      const session = dev.createDevBackend(window.location.hash);
      backend = session.backend;
      devPrepared = true;
      renderToasts();
    }
    if (!eventsWired) {
      wireEvents();
      eventsWired = true;
    }
    if (!listenersReady) {
      await attachListeners();
      listenersReady = true;
    }
    snapshot = await backend.invoke<Snapshot>("get_snapshot");
    if (snapshot.secondInstance) showSecondInstance();
    render();
    applyDevLocation();
  } catch (error) {
    renderBootError(error);
  } finally {
    booting = false;
  }
}

void boot();
