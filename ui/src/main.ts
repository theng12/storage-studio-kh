import "./styles.css";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import { icons } from "./icons";
import {
  parseShareHost,
  shareNameFromTarget,
  saveBlockReason,
  duplicateStorageReason,
  esc,
  orderWhatsNew,
  retrySentence,
  statusLabel,
  statusTone,
  storageSummary,
  dedupeStorages,
  warningGroups,
  readableTarget,
  checkedAgo,
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
  removeCredentials: boolean;
  reconnectAtLogin: boolean;
  reconnectAfterWake: boolean;
}

interface EditorState {
  shareChoices: string[] | null;
  shareNote: string | null;
  shareNoteTone: "hint" | "warn" | "error";
  browseBusy: boolean;
  browseHost: string | null;
  draft: Draft;
  originalName: string | null;
  error: string | null;
  busy: "save" | "test" | "browse" | null;
  confirmRemove: boolean;
  confirmDiscard: boolean;
  touched: boolean;
  dirty: boolean;
  focusField: string | null;
  connectedChosen: boolean;
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
  action?: { label: string; run: () => void };
  timer: number;
}

const root = document.documentElement;
const navEl = document.querySelector<HTMLElement>("#nav")!;
const footEl = document.querySelector<HTMLElement>("#foot")!;
const mainEl = document.querySelector<HTMLElement>("#main")!;
const toastsEl = document.querySelector<HTMLElement>("#toasts")!;
const rowMenuEl = document.querySelector<HTMLElement>("#row-menu")!;
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
let afterSharesRendered = false;
let refreshingStorage = false;
let secondInstanceShown = false;
let pendingTest: PendingTest | null = null;
let editorOpener: string | undefined;
let whatsnewOpener: string | undefined;
let credentialsOpener: string | undefined;
let credentialsPending: { storageId: string; toastId: number } | null = null;
let pendingRowFocus: string[] | null = null;
let openMenuFor: string | null = null;
let menuOpenedAt = 0;
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
  return mode === "light" || mode === "dark" ? mode : "system"; // a stored "default" reads as System
}

function effectiveTheme(choice: ThemeChoice): "light" | "dark" {
  if (choice === "light" || choice === "dark") return choice;
  // System and the app's designed look both follow the Mac.
  return darkQuery.matches ? "dark" : "light";
}

function applyTheme(): void {
  if (!snapshot) return;
  root.dataset.theme = effectiveTheme(appearanceChoice(snapshot.appearance));
}

/* Toasts -------------------------------------------------------------- */

function toast(
  message: string,
  options: {
    error?: boolean;
    seconds?: number;
    action?: { label: string; run: () => void };
    focusAction?: boolean;
  } = {},
): number {
  const duplicate = toasts.find((entry) => entry.message === message && !entry.action);
  if (duplicate) dismissToast(duplicate.id);
  const item: ToastItem = {
    id: (toastSeq += 1),
    message,
    error: options.error ?? false,
    action: options.action,
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
  if (item.action && options.focusAction) {
    // The recovery step is the next thing to do; put the keyboard there, not on BODY.
    toastsEl.querySelector<HTMLElement>(`[data-toast-action="${item.id}"]`)?.focus();
  }
  return item.id;
}

function dismissToast(id: number): void {
  const index = toasts.findIndex((item) => item.id === id);
  if (index < 0) return;
  const hadFocus = Boolean(document.activeElement && toastsEl.contains(document.activeElement));
  window.clearTimeout(toasts[index].timer);
  toasts.splice(index, 1);
  renderToasts();
  if (hadFocus) {
    if (!restoreFocus("add-storage")) {
      const first = mainEl.querySelector<HTMLElement>(".row-primary, .row-menu-btn");
      if (first) first.focus({ preventScroll: true });
      else mainEl.focus({ preventScroll: true });
    }
  }
}

function dismissToastsMatching(prefix: string): void {
  for (const item of [...toasts]) {
    if (item.message.startsWith(prefix)) dismissToast(item.id);
  }
}

function renderToasts(): void {
  toastsEl.innerHTML = toasts
    .map(
      (item) => `
      <div class="toast${item.error ? " toast-error" : ""}">
        <span class="toast-text">${esc(item.message)}</span>
        ${
          item.action
            ? `<button type="button" class="toast-action" data-toast-action="${item.id}">${esc(item.action.label)}</button>`
            : ""
        }
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

let bootFailed = false;

function renderBootError(error: unknown): void {
  bootFailed = true;
  snapshot = null;
  // Nothing but Retry works until the app can read its state, so no dead navigation.
  navEl.innerHTML = "";
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
  mainEl.querySelector<HTMLElement>('[data-action="retry-boot"]')?.focus();
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
      )} v${esc(snapshot.version)}">${icons.drive}<span>${esc(snapshot.appName)} v${esc(snapshot.version)}</span></button>
      <button type="button" class="icon-btn${checkBusy ? " is-spinning" : ""}" data-action="check-updates" data-fk="check" title="${
        checkBusy ? "Checking for Updates…" : "Check for Updates"
      }" aria-label="${checkBusy ? "Checking for Updates" : "Check for Updates"}"${
        checkBusy ? ' aria-disabled="true" aria-busy="true"' : ""
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

function renderHoldBannerIfNeeded(): string {
  if (!snapshot?.holding) return "";
  return `
    <div class="banner banner-hold" role="status">
      ${icons.clock}
      <div>
        <p class="banner-title">Holding new work for an update</p>
        <p class="banner-text">Nothing new starts until the update finishes. Storage Studio KH resumes by itself, and anything already running finishes or is picked up again.</p>
      </div>
    </div>`;
}

function storageStatusLine(groups: { storage: { status: string } }[]): string {
  if (!groups.length) return "Shares and disks reconnect after login, after wake, and when the network changes.";
  const summary = storageSummary(groups.map((group) => group.storage));
  if (snapshot?.engineRunning !== false) return summary;
  const checked = snapshot.lastChecked
    ? new Date(snapshot.lastChecked).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;
  return checked
    ? `Helper isn't running. Helper last reported ${checked}. ${summary}`
    : `Helper isn't running. ${summary}`;
}

function renderStorage(): string {
  if (!snapshot) return "";
  const s = snapshot;
  // shortcut: no search or sort; the list is small — add them when it grows past ~12 rows.
  const groups = dedupeStorages(s.storages);
  const mode = s.listView === "table" ? "table" : "cards";
  const warnings = warningGroups(groups.map((group) => group.storage));
  return `
    <header class="page-head">
      <div>
        <h1>Storage</h1>
        <p class="lede" title="${groups.length ? "Press ⌘R to re-read the mount table." : ""}">${esc(storageStatusLine(groups))}</p>
      </div>
      ${
        groups.length
          ? `<button type="button" class="btn btn-primary" data-action="add-storage" data-fk="add-storage">${icons.plus}<span>Add storage</span></button>`
          : ""
      }
    </header>
    ${renderHoldBannerIfNeeded()}
    ${renderEngineBannerIfNeeded()}
    ${
      groups.length
        ? `<div class="storage-toolbar">
            ${
              warnings.length
                ? `<div class="warning-groups" aria-label="Warnings">${warnings.map(renderWarningGroup).join("")}</div>`
                : ""
            }
            ${
              s.lastChecked
                ? `<span class="checked-line" title="Storage list last read ${esc(
                    new Date(s.lastChecked).toLocaleString(),
                  )}">${checkedAgo(s.lastChecked)}</span>`
                : ""
            }
            ${renderViewSwitch(mode)}
          </div>
          ${mode === "table" ? renderStorageTable(groups) : renderStorageCards(groups)}`
        : renderEmpty()
    }`;
}

function renderEngineBanner(s: Snapshot): string {
  const reason = s.engineError ?? "Storages can't mount or reconnect until it runs again.";
  return `
    <div class="banner" role="alert">
      ${icons.warning}
      <div>
        <p class="banner-title">The background helper isn't running</p>
        <p class="banner-text">${esc(reason)}</p>
      </div>
      <button type="button" class="btn banner-btn" data-action="restart-helper" data-fk="restart-helper"${
        busy.helper ? " disabled" : ""
      }>${busy.helper ? "Starting…" : "Restart helper"}</button>
    </div>`;
}

function renderEmpty(): string {
  return `
    <div class="empty">
      <div class="empty-icon">${icons.drive}</div>
      <p class="empty-title">No storage yet</p>
      <p class="empty-text">Add your first share or disk to keep it connected automatically.</p>
      <button type="button" class="btn btn-primary" data-action="add-storage">${icons.plus}<span>Add storage</span></button>
    </div>`;
}

function renderViewSwitch(mode: string): string {
  const options = [
    { value: "cards", label: "Cards", icon: icons.grid },
    { value: "table", label: "Table", icon: icons.rows },
  ];
  return `<div class="segmented view-switch" role="radiogroup" aria-label="List view">
    ${options
      .map(
        (option) => `<label>
          <input type="radio" name="list-view" value="${option.value}" data-list-view="${option.value}" data-fk="view-${option.value}" ${
            mode === option.value ? "checked" : ""
          }${busy.listView ? " disabled" : ""} />
          <span>${option.icon}${option.label}</span>
        </label>`,
      )
      .join("")}
  </div>`;
}

function renderWarningGroup(group: { label: string; count: number; firstId: string }): string {
  return `<button type="button" class="warning-group" data-action="show-warning" data-id="${esc(group.firstId)}" aria-label="${esc(
    group.label,
  )}: ${group.count}. Show the first one.">
    <span class="warning-label">${esc(group.label)}</span>
    <span class="warning-count">${group.count}</span>
    <span class="warning-show">Show</span>
  </button>`;
}

function renderRowActions(storage: StorageView): string {
  const id = esc(storage.id);
  const mounted = storage.status === "mounted";
  const engine = Boolean(snapshot?.engineRunning);
  const busyAction = rowBusy[storage.id];
  // A mount that is running or waiting to retry gets a control that ends it, first try.
  // An Unreachable row is only stoppable while a retry is really waiting; a Test's verdict is not.
  const stoppable =
    storage.status === "mounting" ||
    storage.status === "retrying" ||
    (storage.status === "unreachable" && (snapshot?.queued ?? []).includes(storage.id));
  const primary = mounted
    ? `<button type="button" class="row-primary" data-action="reveal" data-id="${id}" data-fk="row-${id}-reveal" aria-label="Open ${esc(
        storage.name,
      )} in Finder"${storage.mountedPath ? "" : " disabled"}>${icons.folder}<span>Open in Finder</span></button>`
    : stoppable
      ? `<button type="button" class="row-primary" data-action="cancel" data-id="${id}" data-fk="row-${id}-cancel" aria-label="Stop trying to mount ${esc(
          storage.name,
        )}"${engine ? "" : " disabled"}><span>Stop trying</span></button>`
      : `<button type="button" class="row-primary row-primary-accent" data-action="mount" data-id="${id}" data-fk="row-${id}-mount" aria-label="Mount now ${esc(
          storage.name,
        )}"${busyAction || !engine ? " disabled" : ""}>Mount now</button>`;
  return `<div class="row-actions">
    ${primary}
    <button type="button" class="row-menu-btn" data-row-menu data-id="${id}" data-fk="row-${id}-menu" aria-haspopup="menu" aria-expanded="${
      openMenuFor === storage.id
    }" aria-label="More actions for ${esc(storage.name)}" title="More actions">${icons.more}</button>
  </div>`;
}

function renderStorageCards(groups: { storage: StorageView; count: number }[]): string {
  return `<ul class="storage-list storage-cards">${groups
    .map(({ storage, count }) => {
      const tone = statusTone(storage.status);
      const kind = storage.kind === "smb" ? "SMB share" : "Attached disk";
      return `<li class="storage-row storage-card" data-storage="${esc(storage.id)}">
        <div class="storage-head">
          <div class="storage-id">
            <h3>${esc(storage.name)}${
              count > 1 ? `<span class="dup-count" title="${count} entries for this one storage">×${count}</span>` : ""
            }<span class="storage-kind" aria-hidden="true">${kind}</span><span class="sr-only">, ${kind}</span></h3>
          </div>
          <span class="chip chip-${tone}">${statusLabel(storage.status)}</span>
        </div>
        ${storage.detail ? `<p class="storage-detail">${esc(storage.detail)}</p>` : ""}
        <dl class="metrics">
          <div class="metric"><dt>Mounted at</dt><dd class="path-text">${
            storage.mountedPath ? esc(storage.mountedPath) : "Not mounted"
          }</dd></div>
          ${
            storage.kind === "smb"
              ? `<div class="metric"><dt>Address</dt><dd class="path-text">${esc(readableTarget(storage.target))}</dd></div>`
              : ""
          }
          <div class="metric"><dt>Reconnects</dt><dd>${
            storage.reconnectAtLogin ? "At login" : "No login"
          } · ${storage.reconnectAfterWake ? "after wake" : "not after wake"}</dd></div>
        </dl>
        ${renderRowActions(storage)}
      </li>`;
    })
    .join("")}</ul>`;
}

function renderStorageTable(groups: { storage: StorageView; count: number }[]): string {
  return `<div class="storage-table-wrap"><table class="storage-table">
    <thead><tr><th>Storage</th><th>Status</th><th>Address</th><th>Mounted at</th><th>Reconnects</th><th>Actions</th></tr></thead>
    <tbody>${groups
      .map(({ storage, count }) => {
        const tone = statusTone(storage.status);
        const kind = storage.kind === "smb" ? "SMB share" : "Attached disk";
        return `<tr class="storage-table-row" data-storage="${esc(storage.id)}">
          <td class="cell-name"><span class="table-name">${esc(storage.name)}${
            count > 1 ? ` <span class="dup-count">×${count}</span>` : ""
          }</span><span class="storage-kind" aria-hidden="true">${kind}</span><span class="sr-only">, ${kind}</span></td>
          <td class="cell-status"><span class="chip chip-${tone}">${statusLabel(storage.status)}</span>${
            storage.detail ? `<p class="table-detail">${esc(storage.detail)}</p>` : ""
          }</td>
          <td class="path-text cell-address">${storage.kind === "smb" ? esc(readableTarget(storage.target)) : "—"}</td>
          <td class="path-text">${storage.mountedPath ? esc(storage.mountedPath) : "—"}</td>
          <td class="cell-reconnects">${storage.reconnectAtLogin ? "Login" : "—"} · ${storage.reconnectAfterWake ? "Wake" : "—"}</td>
          <td class="cell-actions">${renderRowActions(storage)}</td>
        </tr>`;
      })
      .join("")}</tbody></table></div>`;
}

function renderRowMenu(storage: StorageView): void {
  if (!snapshot) return;
  const id = esc(storage.id);
  const mounted = storage.status === "mounted";
  const blocked = Boolean(rowBusy[storage.id]) || !snapshot.engineRunning;
  const stoppable =
    storage.status === "mounting" ||
    storage.status === "retrying" ||
    (storage.status === "unreachable" && (snapshot.queued ?? []).includes(storage.id));
  const item = (action: string, label: string, disabled: boolean): string =>
    `<button type="button" class="row-menu-item" role="menuitem" data-action="${action}" data-id="${id}" data-fk="row-${id}-${action}"${
      disabled ? " disabled" : ""
    }>${label}</button>`;
  rowMenuEl.innerHTML = `
    ${mounted ? item("unmount", "Unmount", blocked) : ""}
    ${stoppable ? item("cancel", "Stop trying", !snapshot.engineRunning) : ""}
    ${item("test", rowBusy[storage.id] === "test" ? "Testing…" : "Test", blocked)}
    ${item("edit", "Edit", false)}
    ${item("remove", "Remove…", false)}`;
}

function openRowMenu(id: string, anchor: HTMLElement): void {
  const storage = snapshot?.storages.find((item) => item.id === id);
  if (!storage) return;
  if (openMenuFor && openMenuFor !== id) {
    document
      .querySelector<HTMLElement>(`[data-row-menu][data-id="${openMenuFor.replace(/["\\]/g, "")}"]`)
      ?.setAttribute("aria-expanded", "false");
  }
  openMenuFor = id;
  menuOpenedAt = performance.now();
  renderRowMenu(storage);
  rowMenuEl.hidden = false;
  const rect = anchor.getBoundingClientRect();
  const width = rowMenuEl.offsetWidth;
  const height = rowMenuEl.offsetHeight;
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width));
  const top =
    rect.bottom + 4 + height > window.innerHeight - 8 ? Math.max(8, rect.top - height - 4) : rect.bottom + 4;
  rowMenuEl.style.left = `${Math.round(left)}px`;
  rowMenuEl.style.top = `${Math.round(top)}px`;
  anchor.setAttribute("aria-expanded", "true");
  rowMenuEl.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
}

function closeRowMenu(restoreFocusToToggle = false): void {
  if (!openMenuFor) return;
  const id = openMenuFor;
  openMenuFor = null;
  rowMenuEl.hidden = true;
  rowMenuEl.innerHTML = "";
  const toggle = document.querySelector<HTMLElement>(`[data-row-menu][data-id="${id.replace(/["\\]/g, "")}"]`);
  toggle?.setAttribute("aria-expanded", "false");
  if (restoreFocusToToggle) toggle?.focus();
}

async function setListView(mode: "cards" | "table"): Promise<void> {
  if (!snapshot || busy.listView || (snapshot.listView ?? "cards") === mode) return;
  const fk = focusedKey();
  busy.listView = true;
  render();
  try {
    snapshot = await backend.invoke<Snapshot>("set_list_view", { mode });
  } catch (error) {
    toast(errText(error), { error: true });
  } finally {
    delete busy.listView;
    render();
    restoreFocus(fk);
  }
}

function showWarningRow(id: string): void {
  const row = mainEl.querySelector<HTMLElement>(`[data-storage="${id.replace(/["\\]/g, "")}"]`);
  if (!row) return;
  row.scrollIntoView({ block: "nearest" });
  row.querySelector<HTMLElement>(".row-primary, .row-menu-btn")?.focus();
}

function renderGeneral(): string {
  if (!snapshot) return "";
  const s = snapshot;
  const general = s.general;
  const generalBusy = Boolean(busy.general);
  const loginNote = s.launchAtLoginError
    ? `<p class="inline-note inline-note-warn" role="status">${esc(s.launchAtLoginError)} Launch at login is currently ${
        s.launchAtLoginEnabled ? "on" : "off"
      }. Check System Settings › General › Login Items & Extensions, then try again.</p>`
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
            (s.launchAtLoginError ? s.launchAtLoginEnabled : general.launchAtLogin) ? "checked" : ""
          }${generalBusy ? " disabled" : ""} />
          <span class="track"></span>
        </label>
      </div>
      <div class="setting-row">
        <div class="setting-copy">
          <span class="setting-title" id="retries-title">Retries before it stops</span>
          <p class="setting-hint" id="retries-hint">Choose from 1 to 8. The default is 3.</p>
        </div>
        <select class="number-input" data-general="retries" data-fk="general-retries" aria-labelledby="retries-title" aria-describedby="retries-hint"${
          generalBusy ? " disabled" : ""
        }>
          ${[1, 2, 3, 4, 5, 6, 7, 8]
            .map((n) => `<option value="${n}"${n === general.retries ? " selected" : ""}>${n}</option>`)
            .join("")}
        </select>
      </div>
    </section>
    <p class="note">${esc(retrySentence(general.retries))}</p>`;
}

function appearanceNote(choice: ThemeChoice): string {
  if (choice === "light") return "This window is using the light look.";
  if (choice === "dark") return "This window is using the dark look.";
  return "This window follows your Mac's light or dark appearance.";
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
      <div class="setting-row">
        <div class="setting-copy">
          <span class="setting-title">Appearance</span>
          <p class="setting-hint">${esc(appearanceNote(choice))}</p>
        </div>
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
      </div>
    </section>`;
}

function renderSupport(): string {
  return `
    <header class="page-head">
      <div>
        <h1>Support</h1>
        <p class="lede">Help keep Storage Studio KH going.</p>
      </div>
    </header>
    <section class="support-copy">
      <p>Storage Studio KH is free, with everything unlocked. A one-time donation is optional.</p>
      <button type="button" class="btn btn-primary" data-action="open-support">Open donation page</button>
    </section>`;
}

/* Storage actions ----------------------------------------------------- */

function openEditor(storage?: StorageView, openerFk?: string): void {
  if (!snapshot) return;
  editorOpener = openerFk ?? focusedKey() ?? "add-storage";
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
        removeCredentials: false,
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
        removeCredentials: false,
        reconnectAtLogin: true,
        reconnectAfterWake: true,
      };
  editor = {
    draft,
    originalName: storage?.name ?? null,
    error: null,
    busy: null,
    confirmRemove: false,
    confirmDiscard: false,
    touched: false,
    dirty: false,
    focusField: null,
    connectedChosen: false,
    shareChoices: null,
    shareNote: null,
    shareNoteTone: "hint",
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
  const opener = editorOpener ?? "add-storage";
  editorOpener = undefined;
  restoreFocus(opener);
  if (document.activeElement === document.body) mainEl.focus({ preventScroll: true });
}

/** Save stays blocked by the first real problem, including a share that is already added. */
function editorBlockReason(): string | null {
  if (!editor) return null;
  const base = saveBlockReason(editor.draft, (snapshot?.volumes ?? []).length > 0);
  if (base) return base;
  return duplicateStorageReason(editor.draft, snapshot?.storages ?? []);
}

function requestCloseEditor(): void {
  if (!editor || editor.busy) return;
  if (editor.dirty) {
    editor.confirmDiscard = true;
    renderEditor();
    return;
  }
  closeEditor();
}

/** One Escape path: results → confirmation → form → close prompt, never a silent close. */
function handleEditorEscape(): void {
  if (!editor || editor.busy) return;
  if (editor.shareChoices) {
    editor.shareChoices = null;
    editor.shareNote = null;
    editor.focusField = "target";
    renderEditor();
    return;
  }
  if (editor.confirmRemove) {
    editor.confirmRemove = false;
    editor.error = null;
    editor.focusField = "name";
    renderEditor();
    return;
  }
  if (editor.confirmDiscard) {
    editor.confirmDiscard = false;
    editor.focusField = "name";
    renderEditor();
    return;
  }
  requestCloseEditor();
}

function shareLine(d: Draft): string {
  const name = d.kind === "smb" ? shareNameFromTarget(d.target) : null;
  return name ? `<span class="quiet-line" id="share-name">Share: ${esc(name)}</span>` : "";
}

function browsePanel(): string {
  if (!editor) return "";
  if (editor.shareChoices) {
    return `<div class="share-picker" role="status" aria-live="polite" aria-label="Shares on ${esc(editor.browseHost ?? "this device")}">
      <p class="share-picker-head">Shares on ${esc(editor.browseHost ?? "this device")}</p>
      ${editor.shareChoices
        .map(
          (share) =>
            `<button type="button" class="share-choice" data-editor-action="pick-share" data-share="${esc(
              share,
            )}" data-fk="share-${esc(share)}">${esc(share)}</button>`,
        )
        .join("")}
      <button type="button" class="share-choice share-choice-dismiss" data-editor-action="dismiss-shares">Dismiss</button>
    </div>`;
  }
  return editor.shareNote
    ? `<p class="field-note field-note-${editor.shareNoteTone}" role="status">${esc(editor.shareNote)}</p>`
    : "";
}

function renderEditor(): void {
  if (!editor) return;
  const focused = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLSelectElement
    ? document.activeElement
    : null;
  const focusName = focused?.name;
  const focusValue = focused?.type === "radio" ? focused.value : "";

  if (editor.confirmDiscard) {
    editorEl.innerHTML = `
      <div class="sheet-head">
        <h2 id="editor-title">Discard changes?</h2>
        <p class="sheet-sub">Your edits to this storage haven't been saved.</p>
      </div>
      <div class="sheet-body">
        <p class="confirm-text">Closing now loses them. Keep editing to go back.</p>
      </div>
      <div class="sheet-actions">
        <button type="button" class="btn btn-danger" data-editor-action="discard" data-fk="editor-discard">Discard changes</button>
        <span class="spacer"></span>
        <button type="button" class="btn btn-primary" data-editor-action="keep-editing" data-fk="editor-keep-editing">Keep editing</button>
      </div>`;
    editorEl.querySelector<HTMLElement>('[data-editor-action="keep-editing"]')?.focus();
    return;
  }

  if (editor.confirmRemove) {
    const name = editor.originalName ?? "this storage";
    editorEl.innerHTML = `
      <div class="sheet-head">
        <h2 id="editor-title">Remove ${esc(name)}?</h2>
        <p class="sheet-sub">Storage Studio KH will stop reconnecting it. The files stay where they are.</p>
      </div>
      <div class="sheet-body">
        ${editor.error ? `<p class="form-error" role="alert">${esc(editor.error)}</p>` : ""}
        <p class="confirm-text">This removes the storage from Storage Studio KH, forgets its saved password and clears any duplicate entries. Nothing is deleted from the share or disk.</p>
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
  const savedStorage = d.id ? snapshot?.storages.find((item) => item.id === d.id) : undefined;
  const savedCredentials = Boolean(savedStorage?.hasCredentials);
  const volumes = snapshot?.volumes ?? [];
  const savedVolumeMissing = d.kind === "volume" && d.volumeUUID && !volumes.some((volume) => volume.uuid === d.volumeUUID);
  const savedDiskMissing = Boolean(savedVolumeMissing) || savedStorage?.status === "unreachable";
  const blockReason = editorBlockReason();
  const showReason = editor.touched && blockReason;
  const connectedShares =
    !isEdit && d.kind === "smb" && !editor.connectedChosen
      ? (snapshot?.mountedShares ?? []).filter(
          (candidate) =>
            candidate.url !== d.target &&
            !(snapshot?.storages ?? []).some((storage) => storage.target === candidate.url),
        )
      : [];
  const connectedGroup = connectedShares.length
    ? `
      <div class="field connected-group">
        <span class="field-label">From a connected share</span>
        <div class="connected-list">
          ${connectedShares
            .map(
              (candidate) => `
            <button type="button" class="connected-row" data-editor-action="add-connected" data-connected-url="${esc(
              candidate.url,
            )}" data-fk="connected-${esc(candidate.url)}">
              <span class="connected-copy">
                <span class="connected-name">${esc(candidate.name)}</span>
                <span class="connected-path">${esc(candidate.mountPoint)}</span>
              </span>
              <span class="connected-add">Add</span>
            </button>`,
            )
            .join("")}
        </div>
      </div>`
    : "";
  const identityFields =
    d.kind === "smb"
      ? `
        <div class="field">
          <label class="field-label" for="share-target">Share address (host + share)</label>
          <div class="browse-row">
            <input id="share-target" type="text" name="target" value="${esc(d.target)}" placeholder="e.g. smb://nas/studio" spellcheck="false" autocomplete="off"${
              editor.busy ? " disabled" : ""
            } />
            <button type="button" class="btn" data-editor-action="browse" data-fk="editor-browse"${
              editor.busy || editor.browseBusy ? " disabled" : ""
            }>${editor.browseBusy ? "Looking…" : "Browse…"}</button>
          </div>
        </div>
        ${shareLine(d)}
        ${browsePanel()}
        <label class="field">
          <span class="field-label">User name (optional)</span>
          <input type="text" name="username" value="${esc(d.username)}" autocomplete="off"${
            editor.busy ? " disabled" : ""
          } />
        </label>
        <label class="field">
          <span class="field-label">Password (optional)</span>
          <input type="password" name="password" value="${esc(d.password)}" placeholder="${
            d.removeCredentials
              ? "Saved password will be forgotten"
              : savedCredentials
                ? "Leave blank to keep the saved one"
                : "Stored privately by Storage Studio KH"
          }" autocomplete="off"${editor.busy || d.removeCredentials ? " disabled" : ""} />
        </label>
        ${
          isEdit && savedCredentials
            ? `<label class="check-row"><input type="checkbox" name="forgetPassword" data-fk="editor-forget" ${
                d.removeCredentials ? "checked" : ""
              }${editor.busy ? " disabled" : ""} /> Forget the saved password</label>`
            : ""
        }
        <label class="field">
          <span class="field-label">Mount point (optional)</span>
          <input type="text" name="mountPoint" value="${esc(d.mountPoint)}" placeholder="e.g. /Volumes/studio" spellcheck="false" autocomplete="off"${
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
            savedDiskMissing
              ? `${esc(savedStorage?.name ?? "This disk")} isn't connected. Reconnect it, then reopen this window.`
              : volumes.length
                ? "These disks are connected now."
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
        <input type="text" name="name" value="${esc(d.name)}" placeholder="e.g. Studio NAS" autocomplete="off" data-autofocus data-fk="editor-name"${
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
      ${connectedGroup}
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
        showReason
          ? `<span class="save-reason" id="save-reason" role="status" aria-live="polite">${esc(blockReason)}</span>`
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
      }${showReason ? ' aria-describedby="save-reason"' : ""}>${
        editor.busy === "save" ? "Saving…" : "Save"
      }</button>
    </div>`;

  updateEditorBlockState();
  if (focusName) {
    const selector = focusValue ? `input[name="${focusName}"][value="${focusValue}"]` : `[name="${focusName}"]`;
    editorEl.querySelector<HTMLElement>(selector)?.focus();
  } else if (editor.focusField) {
    editorEl.querySelector<HTMLElement>(`[name="${editor.focusField}"]`)?.focus();
  }
  editor.focusField = null;
  if (afterSharesRendered) {
    afterSharesRendered = false;
    editorEl.querySelector<HTMLElement>('[data-editor-action="pick-share"]')?.focus();
  }
}

function syncEditorField(target: HTMLInputElement | HTMLSelectElement): void {
  if (!editor) return;
  editor.touched = true;
  editor.dirty = true;
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
    case "forgetPassword":
      draft.removeCredentials = (target as HTMLInputElement).checked;
      if (draft.removeCredentials) draft.password = "";
      renderEditor();
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
        if (!draft.name.trim()) draft.name = volume.name;
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
  if (editor.error) editor.error = null;
  updateEditorBlockState();
}

/// Keeps the reason beside Save and the Save button in step with what is typed.
function updateEditorBlockState(): void {
  if (!editor) return;
  const blockReason = editorBlockReason();
  const showReason = editor.touched && blockReason;
  const save = editorEl.querySelector<HTMLButtonElement>('[data-editor-action="save"]');
  if (save) {
    save.disabled = Boolean(editor.busy || blockReason);
    if (showReason) save.setAttribute("aria-describedby", "save-reason");
    else save.removeAttribute("aria-describedby");
  }
  const markInvalid = (name: string): void => {
    for (const field of editorEl.querySelectorAll<HTMLElement>("[aria-invalid]")) field.removeAttribute("aria-invalid");
    const target = editorEl.querySelector<HTMLElement>(`[name="${name}"]`);
    target?.setAttribute("aria-invalid", "true");
  };
  for (const field of editorEl.querySelectorAll<HTMLElement>("[aria-invalid]")) field.removeAttribute("aria-invalid");
  if (showReason) {
    if (blockReason.startsWith("Give this storage a name")) markInvalid("name");
    else if (blockReason.startsWith("Enter the device address") || blockReason.startsWith("Add the share name") || blockReason.startsWith("Use an smb://"))
      markInvalid("target");
    else if (blockReason.startsWith("This share")) markInvalid("target");
    else if (blockReason.startsWith("Choose a disk") || blockReason.startsWith("No disks") || blockReason.startsWith("This disk"))
      markInvalid("volumeUUID");
  }
  let reason = editorEl.querySelector<HTMLElement>("#save-reason");
  if (!showReason) {
    reason?.remove();
    return;
  }
  if (!reason) {
    reason = document.createElement("span");
    reason.id = "save-reason";
    reason.className = "save-reason";
    reason.setAttribute("role", "status");
    reason.setAttribute("aria-live", "polite");
    const spacer = editorEl.querySelector(".sheet-actions .spacer");
    if (spacer?.parentElement) spacer.parentElement.insertBefore(reason, spacer.nextSibling);
    else editorEl.querySelector(".sheet-actions")?.prepend(reason);
  }
  reason.textContent = blockReason;
}

async function browseShares(): Promise<void> {
  if (!editor || editor.busy || editor.browseBusy) return;
  const host = parseShareHost(editor.draft.target);
  if (!host) {
    editor.shareNote = "Enter the device address first, like smb://studio.local/photos.";
    editor.shareNoteTone = "warn";
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
  editor.shareNoteTone = "error";
    renderEditor();
  }
}

function applyShares(payload: { host: string; shares: string[]; needsCredentials: boolean; error: string | null }): void {
  if (!editor || !editor.browseBusy) return;
  editor.browseBusy = false;
  if (payload.needsCredentials) {
    editor.shareNote = "That device needs a user name and password. Enter them below, then choose Browse again.";
    editor.shareNoteTone = "warn";
    editor.error = null;
    renderEditor();
    editorEl.querySelector<HTMLElement>('[name="username"]')?.focus();
    return;
  }
  if (payload.error) {
    editor.shareNote = `${payload.error} Choose Browse to try again.`;
    editor.shareNoteTone = "error";
    renderEditor();
    return;
  }
  afterSharesRendered = true;
  if (!payload.shares.length) {
    editor.shareNote = "That device didn't offer any shares. You can type the share address instead.";
  editor.shareNoteTone = "warn";
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
  if (!editor.draft.name.trim()) editor.draft.name = share;
  editor.shareChoices = null;
  editor.shareNote = null;
  editor.error = null;
  editor.touched = true;
  editor.dirty = true;
  renderEditor();
  editorEl.querySelector<HTMLElement>('[name="target"]')?.focus();
}

async function saveEditor(): Promise<void> {
  if (!editor || editor.busy) return;
  const d = editor.draft;
  editor.touched = true;
  const validationError = validateStorageDraft(d) ?? duplicateStorageReason(d, snapshot?.storages ?? []);
  if (validationError) {
    renderEditor();
    return;
  }
  const isEdit = Boolean(d.id);
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
    if (d.removeCredentials) input.removeCredentials = true;
  }
  try {
    const saved = await backend.invoke<Snapshot>("save_storage", { input });
    snapshot = saved;
    closeEditor();
    render();
    const row =
      saved.storages.find((item) => d.id && item.id === d.id) ??
      saved.storages.find((item) => item.name === input.name && item.target === input.target && item.kind === input.kind);
    flashRow(row?.id);
    if (row) restoreFocus(`row-${row.id}-menu`);
    if (isEdit) {
      toast(d.removeCredentials ? `Saved ${input.name}. The saved password was forgotten.` : `Saved ${input.name}.`);
    } else {
      toast(`Added ${input.name}.`, {
        action: row ? { label: "Mount now", run: () => void runRowAction(row.id, "mount") } : undefined,
      });
    }
  } catch (error) {
    if (editor) {
      editor.busy = null;
      editor.error = errText(error);
      renderEditor();
    }
  }
}

/** The new or edited row may sit below the fold; bring it into view and mark it briefly. */
function flashRow(id: string | undefined): void {
  if (!id) return;
  const row = mainEl.querySelector<HTMLElement>(`[data-storage="${id.replace(/["\\]/g, "")}"]`);
  if (!row) return;
  row.scrollIntoView({ block: "nearest" });
  // Leave the toast its corner: a row whose actions sit under it is not really visible.
  const rowRect = row.getBoundingClientRect();
  const mainRect = mainEl.getBoundingClientRect();
  const clearBottom = mainRect.bottom - 96;
  if (rowRect.bottom > clearBottom) mainEl.scrollTop += rowRect.bottom - clearBottom;
  row.classList.add("is-new");
  window.setTimeout(() => row.classList.remove("is-new"), 1600);
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
      if (!restoreFocus("editor-test")) focusTopDialog();
    }
  }
}

async function removeFromEditor(): Promise<void> {
  if (!editor?.draft.id || editor.busy) return;
  const removed = { ...editor.draft };
  editor.busy = "save";
  renderEditor();
  try {
    snapshot = await backend.invoke<Snapshot>("remove_storage", { id: removed.id });
    closeEditor();
    render();
    toast(`Removed ${removed.name}.`, {
      seconds: 12,
      action: { label: "Undo", run: () => void restoreStorage(removed) },
      focusAction: true,
    });
  } catch (error) {
    if (editor) {
      editor.busy = null;
      editor.error = errText(error);
      renderEditor();
    }
  }
}

/** Undo puts the entry back; the saved password was forgotten when it was removed. */
async function restoreStorage(draft: Draft): Promise<void> {
  if (!snapshot) return;
  const input: StorageInput = {
    id: draft.id,
    name: draft.name,
    kind: draft.kind,
    target: draft.target,
    mountPoint: draft.mountPoint,
    volumeUUID: draft.volumeUUID,
    reconnectAtLogin: draft.reconnectAtLogin,
    reconnectAfterWake: draft.reconnectAfterWake,
  };
  if (draft.kind === "smb") input.username = draft.username.trim();
  try {
    snapshot = await backend.invoke<Snapshot>("save_storage", { input });
    render();
    flashRow(draft.id);
    if (!restoreFocus(`row-${draft.id}-menu`)) mainEl.focus({ preventScroll: true });
    toast(`Restored ${draft.name}.`);
  } catch (error) {
    toast(errText(error), { error: true });
  }
}

/* Row actions --------------------------------------------------------- */

const ROW_COMMANDS: Record<string, string> = {
  mount: "mount_storage",
  unmount: "unmount_storage",
  cancel: "cancel_storage",
  test: "test_storage",
};

async function runRowAction(id: string, action: string): Promise<void> {
  // Stop is never blocked by the row's own busy latch: it is the way out of a waiting mount.
  if (!snapshot || (rowBusy[id] && action !== "cancel")) return;
  const command = ROW_COMMANDS[action];
  if (!command) return;
  pendingRowFocus =
    action === "unmount"
      ? [`row-${id}-mount`, `row-${id}-menu`]
      : action === "mount"
        ? [`row-${id}-reveal`, `row-${id}-menu`]
        : action === "cancel"
          ? [`row-${id}-mount`, `row-${id}-menu`]
          : [`row-${id}-menu`];
  rowBusy[id] = action;
  if (action === "test") beginTest(id);
  render();
  try {
    await backend.invoke(command, { id });
    window.setTimeout(() => {
      if (rowBusy[id] === action) {
        delete rowBusy[id];
        render();
        if (pendingRowFocus) {
          const targets = pendingRowFocus;
          pendingRowFocus = null;
          if (!targets.some(restoreFocus)) mainEl.focus({ preventScroll: true });
        }
      }
    }, 15000);
    if (action === "cancel") {
      // The helper answers with the row's real state; nothing to wait 15 s for. The next
      // snapshot restores focus to the control that replaced Stop; this is the bounded fallback.
      delete rowBusy[id];
      render();
      window.setTimeout(() => {
        if (!pendingRowFocus) return;
        const targets = pendingRowFocus;
        pendingRowFocus = null;
        if (!targets.some(restoreFocus)) mainEl.focus({ preventScroll: true });
      }, 1000);
    }
  } catch (error) {
    delete rowBusy[id];
    pendingRowFocus = null;
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

function focusedKey(): string | undefined {
  return document.activeElement instanceof HTMLElement ? document.activeElement.dataset.fk : undefined;
}

function restoreFocus(fk: string | undefined): boolean {
  if (!fk) return false;
  const target = document.querySelector<HTMLElement>(`[data-fk="${fk.replace(/["\\]/g, "")}"]`);
  if (!target) return false;
  target.focus({ preventScroll: true });
  return document.activeElement === target;
}

async function setGeneral(patch: Partial<General>): Promise<void> {
  if (!snapshot || busy.general) return;
  const fk = focusedKey();
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
    restoreFocus(fk);
  }
}

async function setAppearance(mode: ThemeChoice): Promise<void> {
  if (!snapshot || busy.appearance) return;
  const fk = focusedKey();
  busy.appearance = true;
  render();
  try {
    snapshot = await backend.invoke<Snapshot>("set_appearance", { mode });
  } catch (error) {
    toast(errText(error), { error: true });
  } finally {
    delete busy.appearance;
    render();
    restoreFocus(fk);
  }
}

/* Updates and support -------------------------------------------------- */

async function checkUpdates(): Promise<void> {
  if (!snapshot || checkingUpdates) return;
  const fk = focusedKey();
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
    if (!restoreFocus(fk ?? "check")) mainEl.focus({ preventScroll: true });
  }
}

async function restartHelper(): Promise<void> {
  if (busy.helper) return;
  const fk = focusedKey();
  busy.helper = true;
  render();
  try {
    await backend.invoke("restart_helper");
    toast("Helper started.");
  } catch (error) {
    toast(errText(error), { error: true });
  } finally {
    delete busy.helper;
    render();
    if (!restoreFocus(fk) && !restoreFocus("nav-storage")) mainEl.focus({ preventScroll: true });
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
  if (!whatsnewEl.open) whatsnewOpener = focusedKey() ?? "pill";
  renderWhatsNew();
  if (!whatsnewEl.open) whatsnewEl.showModal();
  // showModal() moves focus itself; put it on Close so the ring is inside the sheet.
  whatsnewEl.querySelector<HTMLElement>('[data-whatsnew-action="close"]')?.focus();
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
  const pendingUpdate =
    s.update.state === "available" && s.update.version && !entries.some((entry) => entry.version === s.update.version)
      ? `<p class="note">Version ${esc(s.update.version)} is available. Its notes appear here after it is installed.</p>`
      : "";
  whatsnewEl.innerHTML = `
    <div class="sheet-head">
      <h2 id="whatsnew-title">What's New</h2>
      <p class="sheet-sub">${esc(s.appName)} ${esc(s.version)}</p>
    </div>
    <div class="sheet-body">${pendingUpdate}${releases}</div>
    <div class="sheet-actions">
      <span class="spacer"></span>
      <button type="button" class="btn btn-primary" data-whatsnew-action="close">Close</button>
    </div>`;
}

/* Credentials --------------------------------------------------------- */

function openCredentials(id: string, name: string): void {
  // The prompt arrives from the helper, not a click; the row's menu control is the way back.
  credentialsOpener = `row-${id}-menu`;
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
  const opener = credentialsOpener ?? "pill";
  credentialsOpener = undefined;
  if (document.querySelector("dialog[open]")) focusTopDialog();
  else if (!restoreFocus(opener)) mainEl.focus({ preventScroll: true });
}

function closeWhatsNew(): void {
  if (whatsnewEl.open) whatsnewEl.close();
  const opener = whatsnewOpener ?? "pill";
  whatsnewOpener = undefined;
  if (document.querySelector("dialog[open]")) focusTopDialog();
  else restoreFocus(opener);
}

function renderCredentials(): void {
  if (!credentials) return;
  credentialsEl.innerHTML = `
    <div class="sheet-head">
      <h2 id="credentials-title">Sign in to ${esc(credentials.name)}</h2>
      <p class="sheet-sub">Storage Studio KH needs a user name and password for this share. It is saved privately at ~/Library/Application Support/Storage Studio KH/secrets.json.</p>
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
  const savedName = credentials.name;
  const savedId = credentials.id;
  credentials.error = null;
  renderCredentials();
  try {
    await backend.invoke("set_credentials", { id: credentials.id, username, password });
    closeCredentials();
    // The helper mounts again as soon as it has the password; drop the stale test result only.
    dismissToastsMatching("Test:");
    const toastId = toast(`Password saved. Trying ${savedName}…`, { seconds: 8 });
    credentialsPending = { storageId: savedId, toastId };
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

/** Tab stays inside an open sheet instead of escaping to the page or the browser chrome. */
function trapTab(dialog: HTMLDialogElement, event: KeyboardEvent): void {
  if (event.key !== "Tab") return;
  const focusables = Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => element.offsetParent !== null);
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  } else if (!dialog.contains(document.activeElement)) {
    event.preventDefault();
    first.focus();
  }
}

function applySnapshot(next: Snapshot): void {
  if (openMenuFor) closeRowMenu();
  snapshot = next;
  for (const id of Object.keys(rowBusy)) delete rowBusy[id];
  if (pendingTest) {
    const storage = next.storages.find((item) => item.id === pendingTest?.id);
    if (storage) {
      // Every Test must end in a named result, even when it says the same thing as last time.
      toast(`Test: ${storage.detail ?? statusLabel(storage.status)}`);
      clearPendingTest();
    }
  }
  if (editor?.busy === "test") {
    editor.busy = null;
    renderEditor();
    if (!restoreFocus("editor-test")) focusTopDialog();
  }
  if (credentialsPending) {
    const storage = next.storages.find((item) => item.id === credentialsPending?.storageId);
    if (!storage || (storage.status !== "mounting" && storage.status !== "retrying")) {
      dismissToast(credentialsPending.toastId);
      credentialsPending = null;
    }
  }
  if (next.secondInstance) showSecondInstance();
  render();
  if (pendingRowFocus) {
    const ready = pendingRowFocus.some((fk) =>
      document.querySelector(`[data-fk="${fk.replace(/["\\]/g, "")}"]`),
    );
    if (ready) {
      const targets = pendingRowFocus;
      pendingRowFocus = null;
      // The row's busy buttons cannot take focus; land on the control that replaced them.
      if (!targets.some(restoreFocus)) mainEl.focus({ preventScroll: true });
    }
  }
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

    const menuButton = target.closest<HTMLElement>("[data-row-menu]");
    if (menuButton?.dataset.id) {
      const id = menuButton.dataset.id;
      if (openMenuFor === id) closeRowMenu(true);
      else openRowMenu(id, menuButton);
      return;
    }
    if (openMenuFor && !target.closest("#row-menu")) closeRowMenu();

    const viewButton = target.closest<HTMLElement>("[data-view]");
    if (viewButton?.dataset.view) {
      view = viewButton.dataset.view as View;
      mainEl.scrollTop = 0;
      render();
      return;
    }

    const actionButton = target.closest<HTMLElement>("[data-action]");
    if (actionButton) {
      // Close first: the action's snapshot re-render must not fight a menu that is about to go.
      if (openMenuFor) closeRowMenu();
      const action = actionButton.dataset.action;
      const id = actionButton.dataset.id ?? "";
      if (action === "whats-new") openWhatsNew();
      else if (action === "check-updates") void checkUpdates();
      else if (action === "download-update") void openUpdater();
      else if (action === "add-storage") openEditor(undefined, actionButton.dataset.fk);
      else if (action === "open-support") void openSupport();
      else if (action === "retry-boot") void boot();
      else if (action === "restart-helper") void restartHelper();
      else if (action === "mount" || action === "unmount" || action === "test") void runRowAction(id, action);
      else if (action === "reveal") void revealStorage(id);
      else if (action === "edit") {
        const storage = snapshot?.storages.find((item) => item.id === id);
        if (storage) openEditor(storage, `row-${id}-menu`);
      } else if (action === "show-warning") showWarningRow(id);
      else if (action === "remove") {
        const storage = snapshot?.storages.find((item) => item.id === id);
        if (storage) {
          openEditor(storage, `row-${id}-menu`);
          if (editor) {
            editor.confirmRemove = true;
            renderEditor();
          }
        }
      }
      return;
    }

    const toastAction = target.closest<HTMLElement>("[data-toast-action]");
    if (toastAction?.dataset.toastAction) {
      const item = toasts.find((entry) => entry.id === Number(toastAction.dataset.toastAction));
      dismissToast(Number(toastAction.dataset.toastAction));
      item?.action?.run();
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
    else if (target.dataset.listView) void setListView(target.dataset.listView as "cards" | "table");
  });

  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "r") {
      event.preventDefault();
      if (!document.querySelector("dialog[open]")) void refreshStorage();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Tab" || document.querySelector("dialog[open]")) return;
    const focusables = Array.from(
      document.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.offsetParent !== null);
    if (focusables.length < 2) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && openMenuFor) {
      event.preventDefault();
      closeRowMenu(true);
    }
  });

  rowMenuEl.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(rowMenuEl.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'));
    if (!items.length) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next = index;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else if (event.key === "ArrowDown") next = (index + 1 + items.length) % items.length;
    else next = (index + items.length - 1) % items.length;
    items[next]?.focus();
  });

  mainEl.addEventListener("scroll", () => {
    // The scroll that brings a row into view happens just before its click; ignore that one.
    if (openMenuFor && performance.now() - menuOpenedAt > 250) closeRowMenu(true);
  }, { passive: true });

  navEl.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"].includes(event.key)) return;
    const items = Array.from(navEl.querySelectorAll<HTMLElement>(".nav-item"));
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (index < 0) return;
    event.preventDefault();
    const step = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
    const next = items[(index + step + items.length) % items.length];
    next.focus();
    next.click();
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
        requestCloseEditor();
        break;
      case "discard":
        closeEditor();
        break;
      case "keep-editing":
        if (editor) {
          editor.confirmDiscard = false;
          editor.focusField = "name";
          renderEditor();
        }
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
          editor.focusField = "name";
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
      case "dismiss-shares":
        if (editor) {
          editor.shareChoices = null;
          editor.shareNote = null;
          editor.focusField = "target";
          renderEditor();
        }
        break;
      case "add-connected": {
        const candidate = (snapshot?.mountedShares ?? []).find(
          (item) => item.url === button.dataset.connectedUrl,
        );
        if (candidate && editor) {
          const draft = editor.draft;
          if (!draft.name.trim()) draft.name = candidate.name;
          draft.kind = "smb";
          draft.target = candidate.url;
          draft.username = candidate.user ?? "";
          draft.mountPoint = "";
          editor.error = null;
          editor.shareChoices = null;
          editor.touched = true;
          editor.dirty = true;
          // The choice is made; hide the list so a second click cannot swap the address
          // under the name that was already filled in.
          editor.connectedChosen = true;
          renderEditor();
          editorEl.querySelector<HTMLInputElement>('input[name="target"]')?.focus();
        }
        break;
      }
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

  // Escape is routed here so every step (results, confirmations, close) is ours and
  // a prevented cancel can never fall through to the dialog's native close.
  editorEl.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    handleEditorEscape();
  });

  editorEl.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || !editor || editor.busy || editor.confirmRemove) return;
    if (!(event.target instanceof HTMLInputElement) || event.target.type === "checkbox") return;
    if (editor.shareChoices) return;
    if (editorBlockReason()) return;
    event.preventDefault();
    void saveEditor();
  });

  for (const dialog of [editorEl, whatsnewEl, credentialsEl]) {
    dialog.addEventListener("keydown", (event) => trapTab(dialog, event));
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      // A click outside a sheet must never throw away typed input; Escape or Cancel closes it.
      if (dialog === editorEl || dialog === credentialsEl) return;
      closeWhatsNew();
    });
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      if (dialog === editorEl) handleEditorEscape();
      else if (dialog === whatsnewEl) closeWhatsNew();
      else closeCredentials();
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
    if (bootFailed) {
      bootFailed = false;
      if (document.activeElement === document.body) mainEl.focus({ preventScroll: true });
    }
  } catch (error) {
    renderBootError(error);
  } finally {
    booting = false;
  }
}

void boot();
