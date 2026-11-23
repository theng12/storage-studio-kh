import "./styles.css";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import { icons } from "./icons";
import {
  parseShareHost,
  normaliseShareAddress,
  shareNameFromTarget,
  shareTarget,
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
  Archive,
  ArchiveInput,
  ChannelInspect,
  General,
  JobView,
  RestorableItem,
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

type View = "storage" | "archives" | "general" | "appearance" | "support";
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
  /** The shares the device actually offered; null means "not looked at yet". */
  shareChoices: string[] | null;
  shareNote: string | null;
  shareNoteTone: "hint" | "warn" | "error";
  browseBusy: boolean;
  browseHost: string | null;
  /** The person chose to type the address for this device instead of picking from its list. */
  shareListSkipped: boolean;
  /** Debounce for listing automatically once a host is typed. */
  shareListTimer: number;
  /** False from the moment a listing is scheduled until its answer or failure is in. */
  listSettled: boolean;
  mountPickBusy: boolean;
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
  /** Details sections keep their state across the sheet's frequent re-renders. */
  signInOpen: boolean;
  advancedOpen: boolean;
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

interface ArchiveSheetState {
  draft: { id?: string; name: string; folder: string; mediaFolder: string; destination: string };
  inspect: ChannelInspect | null;
  inspecting: boolean;
  /** Shown only when project.json says the channel keeps heavy media somewhere else. */
  showMedia: boolean;
  error: string | null;
  busy: boolean;
}

interface RestoreSheetState {
  root: string;
  destination: string;
  scanning: boolean;
  chosen: string | null;
  error: string | null;
  busy: boolean;
  scanTimer: number;
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
const archiveSheetEl = document.querySelector<HTMLDialogElement>("#archive-sheet")!;
const restoreSheetEl = document.querySelector<HTMLDialogElement>("#restore-sheet")!;
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
let archiveSheet: ArchiveSheetState | null = null;
let restoreSheet: RestoreSheetState | null = null;
let archiveSheetOpener: string | undefined;
let restoreSheetOpener: string | undefined;
/** The last job state shown in a toast, so a finished job says it once. */
let announcedJob: string | null = null;
/** The last discovery result the restore sheet drew, so an unrelated snapshot doesn't redraw it. */
let restoreSignature = "none";
let checkingUpdates = false;
let afterSharesRendered = false;
let refreshingStorage = false;
let secondInstanceShown = false;
let pendingTest: PendingTest | null = null;
/** A Browse is a device call bounded at 15 s in the helper; past this the row must say so. */
let browseLease: number | null = null;
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
    { view: "archives", label: "Archives", icon: icons.archive },
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
      )} v${esc(snapshot.version)}"><span>v${esc(snapshot.version)}</span></button>
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
  if (view === "archives") {
    mainEl.innerHTML = renderArchives();
    return;
  }
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

function renderUpdateBannerIfNeeded(): string {
  if (!snapshot?.updating) return "";
  return `
    <div class="banner banner-hold" role="status">
      ${icons.download}
      <div>
        <p class="banner-title">Updating ${esc(snapshot.appName)}</p>
        <p class="banner-text">The update installs and the app reopens by itself. Nothing new starts until it is back; anything already running finishes or is picked up again.</p>
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
    ${renderUpdateBannerIfNeeded()}
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
  const archive = snapshot?.archives.find((item) => item.id === id);
  if (!storage && !archive) return;
  if (openMenuFor && openMenuFor !== id) {
    document
      .querySelector<HTMLElement>(`[data-row-menu][data-id="${openMenuFor.replace(/["\\]/g, "")}"]`)
      ?.setAttribute("aria-expanded", "false");
  }
  openMenuFor = id;
  menuOpenedAt = performance.now();
  if (storage) renderRowMenu(storage);
  else if (archive) renderArchiveMenu(archive);
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

/* Channel archives ------------------------------------------------------ */

function sizeLabel(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

function dayLabel(at: number): string {
  return new Date(at).toLocaleDateString([], { day: "numeric", month: "short" });
}

function archiveDay(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso.slice(0, 10) : dayLabel(date.getTime());
}

function runningJob(): JobView | null {
  const job = snapshot?.job ?? null;
  if (!job) return null;
  return ["copying", "verifying", "restoring"].includes(job.state) ? job : null;
}

function jobFor(id: string): JobView | null {
  return snapshot?.job && snapshot.job.id === id ? snapshot.job : null;
}

function jobLine(job: JobView): string {
  const files = `${job.filesDone.toLocaleString()} of ${job.filesTotal.toLocaleString()} files`;
  if (job.state === "verifying") return `Checking ${files} on the destination.`;
  if (job.state === "restoring") return `Restoring ${files}.`;
  return `${files} · ${sizeLabel(job.bytesDone)} of ${sizeLabel(job.bytesTotal)}`;
}

function renderJobBanner(job: JobView): string {
  if (job.state === "paused") {
    return `<div class="banner banner-hold" role="status">
      ${icons.clock}
      <div>
        <p class="banner-title">${job.kind === "restore" ? "Restore" : "Archive"} paused${job.kind === "archive" ? ` — ${esc(job.name)}` : ""}</p>
        <p class="banner-text">${esc(job.detail ?? "It stopped at a checked file. Resume carries on from there.")}</p>
      </div>
      ${
        job.kind === "archive"
          ? `<button type="button" class="btn banner-btn" data-action="archive-start" data-id="${esc(job.id)}" data-fk="job-resume">Resume</button>`
          : ""
      }
    </div>`;
  }
  if (job.state === "failed") {
    return `<div class="banner" role="alert">
      ${icons.warning}
      <div>
        <p class="banner-title">${job.kind === "restore" ? "Restore" : `Archiving ${esc(job.name)}`} stopped</p>
        <p class="banner-text">${esc(job.detail ?? "It stopped without saying why.")}</p>
      </div>
      ${
        job.kind === "archive"
          ? `<button type="button" class="btn banner-btn" data-action="archive-start" data-id="${esc(job.id)}" data-fk="job-retry">Try again</button>`
          : ""
      }
    </div>`;
  }
  const done = job.filesTotal ? Math.min(100, Math.round((job.filesDone / job.filesTotal) * 100)) : 0;
  return `<div class="banner banner-job" role="status">
    ${icons.drive}
    <div class="job-body">
      <p class="banner-title">${job.state === "verifying" ? "Checking" : job.kind === "restore" ? "Restoring" : "Copying"} ${esc(job.name)}</p>
      <p class="banner-text">${esc(jobLine(job))}</p>
      <div class="job-bar" aria-hidden="true"><span style="width: ${done}%"></span></div>
    </div>
  </div>`;
}

function renderArchiveRow(archive: Archive): string {
  const id = esc(archive.id);
  const job = jobFor(archive.id);
  const running = Boolean(job && ["copying", "verifying"].includes(job.state));
  const last = archive.last;
  const line = running && job ? jobLine(job) : last
    ? `Archived ${dayLabel(last.at)} · ${sizeLabel(last.bytes)} · ${last.files.toLocaleString()} files`
    : "Not archived yet";
  return `<div class="setting-row archive-row" data-archive="${id}">
    <div class="setting-copy">
      <span class="setting-title">${esc(archive.name)}</span>
      <p class="setting-hint">${esc(line)}</p>
      ${last ? `<p class="setting-hint path-text">Archived to ${esc(last.path)}</p>` : ""}
      ${
        archive.roots.length > 1
          ? `<p class="setting-hint">Heavy media: ${esc(archive.roots[1])}</p>`
          : ""
      }
    </div>
    <div class="row-actions">
      <button type="button" class="row-primary row-primary-accent" data-action="archive-start" data-id="${id}" data-fk="archive-${id}-start"${
        running || snapshot?.holding ? " disabled" : ""
      }>${running ? "Archiving…" : last ? "Archive again" : "Archive now"}</button>
      <button type="button" class="row-menu-btn" data-row-menu data-id="${id}" data-fk="archive-${id}-menu" aria-haspopup="menu" aria-expanded="${
        openMenuFor === archive.id
      }" aria-label="More actions for ${esc(archive.name)}" title="More actions">${icons.more}</button>
    </div>
  </div>`;
}

function renderArchives(): string {
  if (!snapshot) return "";
  const archives = snapshot.archives ?? [];
  const job = snapshot.job;
  const banner = job && (runningJob() || job.state === "paused" || job.state === "failed") ? renderJobBanner(job) : "";
  return `
    <header class="page-head">
      <div>
        <h1>Archives</h1>
        <p class="lede">${
          archives.length
            ? "One channel folder per archive, checked file by file on the destination."
            : "An archive is a copy of one channel's folder, kept ready to restore on a new Mac."
        }</p>
      </div>
      ${
        archives.length
          ? `<div class="page-head-actions">
              <button type="button" class="btn btn-primary" data-action="add-archive" data-fk="add-archive">${icons.plus}<span>Archive a channel…</span></button>
              <button type="button" class="btn" data-action="restore-open" data-fk="restore-open">${icons.download}<span>Restore a channel…</span></button>
            </div>`
          : ""
      }
    </header>
    ${renderUpdateBannerIfNeeded()}
    ${renderHoldBannerIfNeeded()}
    ${renderEngineBannerIfNeeded()}
    ${banner}
    ${
      archives.length
        ? `<section class="group archive-group" aria-label="Archives">${archives.map(renderArchiveRow).join("")}</section>`
        : `<div class="empty">
            <div class="empty-icon">${icons.archive}</div>
            <p class="empty-title">No channel archived yet</p>
            <p class="empty-text">Pick a channel's folder and where to copy it. Every file is checked on the destination.</p>
            <div class="empty-actions">
              <button type="button" class="btn" data-action="restore-open" data-fk="restore-open-empty">${icons.download}<span>Restore a channel…</span></button>
              <button type="button" class="btn btn-primary" data-action="add-archive" data-fk="add-archive-empty">${icons.plus}<span>Archive a channel…</span></button>
            </div>
          </div>`
    }`;
}

function renderArchiveMenu(archive: Archive): void {
  const running = Boolean(runningJob());
  const job = jobFor(archive.id);
  const item = (action: string, label: string, disabled: boolean): string =>
    `<button type="button" class="row-menu-item" role="menuitem" data-action="${action}" data-id="${esc(
      archive.id,
    )}" data-fk="archive-${esc(archive.id)}-${action}"${disabled ? " disabled" : ""}>${label}</button>`;
  rowMenuEl.innerHTML = `
    ${item("archive-start", job && job.state === "paused" ? "Resume" : "Archive now", running || !snapshot?.engineRunning)}
    ${item("restore-open", "Restore a channel…", running)}
    ${item("archive-reveal", "Show on the NAS", !archive.last)}
    ${item("archive-edit", "Edit…", false)}
    ${item("archive-forget", "Forget this row", running)}`;
}

function openArchiveSheet(archive?: Archive): void {
  if (!snapshot) return;
  archiveSheetOpener = focusedKey();
  archiveSheet = {
    draft: {
      id: archive?.id,
      name: archive?.name ?? "",
      folder: archive?.roots[0] ?? "",
      mediaFolder: archive?.roots[1] ?? "",
      destination: archive?.destination ?? "",
    },
    inspect: null,
    inspecting: false,
    showMedia: Boolean(archive && archive.roots.length > 1),
    error: null,
    busy: false,
  };
  renderArchiveSheet();
  archiveSheetEl.showModal();
  focusTopDialog();
}

function closeArchiveSheet(): void {
  const opener = archiveSheetOpener;
  archiveSheet = null;
  archiveSheetEl.close();
  archiveSheetEl.innerHTML = "";
  restoreFocus(opener);
}

function renderArchiveSheet(): void {
  if (!archiveSheet) return;
  const d = archiveSheet.draft;
  const isEdit = Boolean(d.id);
  const inspect = archiveSheet.inspect;
  const channelNote = inspect
    ? inspect.looksLikeLibrary
      ? `<p class="field-note field-note-error" role="alert">That looks like the Library, not one channel. Choose the channel's own folder.</p>`
      : inspect.isChannel
        ? `<p class="field-note field-note-hint">${esc(inspect.name ?? d.folder)}</p>`
        : `<p class="field-note field-note-warn" role="status">This folder has no project.json, so the channel's name and id can't be saved. It is still copied as a folder.</p>`
    : "";
  archiveSheetEl.innerHTML = `
    <div class="sheet-head">
      <h2 id="archive-sheet-title">${isEdit ? "Edit this archive" : "Archive a channel"}</h2>
      <p class="sheet-sub">The whole folder is copied and every file is checked on the destination. Nothing on this Mac is moved or deleted.</p>
    </div>
    <div class="sheet-body">
      ${archiveSheet.error ? `<p class="form-error" role="alert">${esc(archiveSheet.error)}</p>` : ""}
      <div class="field">
        <span class="field-label" id="archive-folder-label">Channel folder</span>
        <div class="browse-row">
          <input type="text" name="folder" value="${esc(d.folder)}" placeholder="Choose the channel's folder" readonly aria-labelledby="archive-folder-label"${
            archiveSheet.busy ? " disabled" : ""
          } />
          <button type="button" class="btn" data-archive-action="pick-folder" data-fk="archive-pick-folder"${
            archiveSheet.busy || archiveSheet.inspecting ? " disabled" : ""
          }>${archiveSheet.inspecting ? "Looking…" : "Choose…"}</button>
        </div>
        ${channelNote}
      </div>
      <label class="field">
        <span class="field-label">Name</span>
        <input type="text" name="archive-name" value="${esc(d.name)}" placeholder="The channel's name"${archiveSheet.busy ? " disabled" : ""} />
      </label>
      ${
        archiveSheet.showMedia
          ? `<div class="field">
              <span class="field-label" id="archive-media-label">Heavy media folder</span>
              <div class="browse-row">
                <input type="text" name="media" value="${esc(d.mediaFolder)}" placeholder="Where this channel keeps its images and video" readonly aria-labelledby="archive-media-label"${
                  archiveSheet.busy ? " disabled" : ""
                } />
                <button type="button" class="btn" data-archive-action="pick-media" data-fk="archive-pick-media"${
                  archiveSheet.busy ? " disabled" : ""
                }>Choose…</button>
              </div>
              <p class="field-note field-note-hint">This channel keeps its heavy media somewhere else. Add that folder too, or the copy will be missing its images and video.</p>
            </div>`
          : ""
      }
      <div class="field">
        <span class="field-label" id="archive-destination-label">Copy to</span>
        <div class="browse-row">
          <input type="text" name="destination" value="${esc(d.destination)}" placeholder="Choose the folder to copy into" readonly aria-labelledby="archive-destination-label"${
            archiveSheet.busy ? " disabled" : ""
          } />
          <button type="button" class="btn" data-archive-action="pick-destination" data-fk="archive-pick-destination"${
            archiveSheet.busy ? " disabled" : ""
          }>Choose…</button>
        </div>
        <p class="field-note field-note-hint">The copy goes inside the folder you choose, named after the channel and the date.</p>
      </div>
    </div>
    <div class="sheet-actions">
      <button type="button" class="btn" data-archive-action="cancel" data-fk="archive-cancel"${archiveSheet.busy ? " disabled" : ""}>Cancel</button>
      <span class="spacer"></span>
      <button type="button" class="btn btn-primary" data-archive-action="save" data-fk="archive-save"${
        archiveSheet.busy || !d.folder || !d.destination || Boolean(inspect?.looksLikeLibrary) ? " disabled" : ""
      }>${archiveSheet.busy ? "Starting…" : isEdit ? "Save and archive" : "Archive"}</button>
    </div>`;
}

async function pickArchiveFolder(which: "folder" | "media" | "destination"): Promise<void> {
  if (!archiveSheet) return;
  const start =
    which === "folder" ? archiveSheet.draft.folder : which === "media" ? archiveSheet.draft.mediaFolder : archiveSheet.draft.destination;
  const messages = {
    folder: "Choose the channel's folder",
    media: "Choose the folder that holds this channel's heavy media",
    destination: "Choose the folder to copy the archive into",
  };
  try {
    const picked = await backend.invoke<string | null>("pick_mount_point", {
      startDir: start || undefined,
      message: messages[which],
    });
    if (!picked || !archiveSheet) return;
    if (which === "folder") {
      archiveSheet.draft.folder = picked;
      archiveSheet.inspecting = true;
      renderArchiveSheet();
      const inspect = await backend.invoke<ChannelInspect>("inspect_channel", { folder: picked });
      if (!archiveSheet) return;
      archiveSheet.inspect = inspect;
      archiveSheet.inspecting = false;
      if (!archiveSheet.draft.name && inspect.name) archiveSheet.draft.name = inspect.name;
      archiveSheet.showMedia = inspect.hasMediaRoot || Boolean(archiveSheet.draft.mediaFolder);
    } else if (which === "media") {
      archiveSheet.draft.mediaFolder = picked;
      archiveSheet.showMedia = true;
    } else {
      archiveSheet.draft.destination = picked;
    }
    renderArchiveSheet();
  } catch (error) {
    if (!archiveSheet) return;
    archiveSheet.inspecting = false;
    archiveSheet.error = errText(error);
    renderArchiveSheet();
  }
}

async function saveArchiveSheet(): Promise<void> {
  if (!archiveSheet || archiveSheet.busy) return;
  const d = archiveSheet.draft;
  if (!d.folder || !d.destination) return;
  archiveSheet.busy = true;
  archiveSheet.error = null;
  renderArchiveSheet();
  try {
    const input: ArchiveInput = {
      id: d.id,
      name: d.name.trim() || undefined,
      folder: d.folder,
      mediaFolder: d.mediaFolder || undefined,
      destination: d.destination,
    };
    const next = await backend.invoke<Snapshot>("archive_add", { input });
    applySnapshot(next);
    const id = d.id ?? next.archives[next.archives.length - 1]?.id;
    closeArchiveSheet();
    if (id) await startArchiveRow(id);
  } catch (error) {
    if (!archiveSheet) return;
    archiveSheet.busy = false;
    archiveSheet.error = errText(error);
    renderArchiveSheet();
  }
}

async function startArchiveRow(id: string): Promise<void> {
  if (!snapshot || busy[`archive-${id}`]) return;
  busy[`archive-${id}`] = true;
  render();
  try {
    await backend.invoke("archive_start", { id });
  } catch (error) {
    toast(errText(error), { error: true });
  } finally {
    window.setTimeout(() => {
      delete busy[`archive-${id}`];
      render();
    }, 400);
  }
}

function openRestoreSheet(): void {
  restoreSheetOpener = focusedKey();
  restoreSheet = { root: "", destination: "", scanning: false, chosen: null, error: null, busy: false, scanTimer: 0 };
  renderRestoreSheet();
  restoreSheetEl.showModal();
  focusTopDialog();
}

function closeRestoreSheet(): void {
  const opener = restoreSheetOpener;
  if (restoreSheet) window.clearTimeout(restoreSheet.scanTimer);
  restoreSheet = null;
  restoreSheetEl.close();
  restoreSheetEl.innerHTML = "";
  restoreFocus(opener);
}

function renderRestoreSheet(): void {
  if (!restoreSheet) return;
  const list = snapshot?.restorable ?? null;
  const items = list && list.root === restoreSheet.root ? list.items : [];
  const scanning = restoreSheet.scanning;
  const chosen = items.find((item) => item.path === restoreSheet?.chosen) ?? null;
  restoreSheetEl.innerHTML = `
    <div class="sheet-head">
      <h2 id="restore-sheet-title">Restore a channel</h2>
      <p class="sheet-sub">Choose the folder that holds the archives. Each one is read from its own manifest, so a channel this Mac has never seen is still found.</p>
    </div>
    <div class="sheet-body">
      ${restoreSheet.error ? `<p class="form-error" role="alert">${esc(restoreSheet.error)}</p>` : ""}
      <div class="field">
        <span class="field-label" id="restore-root-label">Folder with the archives</span>
        <div class="browse-row">
          <input type="text" name="restore-root" value="${esc(restoreSheet.root)}" placeholder="Choose the folder you archived into" readonly aria-labelledby="restore-root-label"${
            restoreSheet.busy ? " disabled" : ""
          } />
          <button type="button" class="btn" data-restore-action="pick-root" data-fk="restore-pick-root"${
            restoreSheet.busy || scanning ? " disabled" : ""
          }>${scanning ? "Looking…" : "Choose…"}</button>
        </div>
      </div>
      ${
        restoreSheet.root
          ? `<div class="field">
              <span class="field-label">Archives found</span>
              ${
                list?.error
                  ? `<p class="field-note field-note-error" role="alert">${esc(list.error)}</p>`
                  : scanning
                    ? `<p class="field-note field-note-hint" role="status">Looking…</p>`
                    : items.length
                      ? `<ul class="archive-choices" role="radiogroup" aria-label="Archives found">${items
                          .map(
                            (item: RestorableItem) => `<li>
                              <label class="archive-choice${restoreSheet?.chosen === item.path ? " is-chosen" : ""}">
                                <input type="radio" name="archive-choice" value="${esc(item.path)}"${
                                  restoreSheet?.chosen === item.path ? " checked" : ""
                                } />
                                <span class="archive-choice-name">${esc(item.name)}</span>
                                <span class="archive-choice-detail">${archiveDay(item.createdAt)} · ${sizeLabel(
                                  item.bytes,
                                )} · ${item.files.toLocaleString()} files · from ${esc(item.machine)}</span>
                                <span class="archive-choice-roots">${esc(item.roots.join(" + "))}</span>
                              </label>
                            </li>`,
                          )
                          .join("")}</ul>`
                      : `<p class="field-note field-note-warn" role="status">No archive with a manifest was found in that folder.</p>`
              }
            </div>`
          : ""
      }
      <div class="field">
        <span class="field-label" id="restore-destination-label">Restore into</span>
        <div class="browse-row">
          <input type="text" name="restore-destination" value="${esc(restoreSheet.destination)}" placeholder="Choose the folder the channel should land in" readonly aria-labelledby="restore-destination-label"${
            restoreSheet.busy ? " disabled" : ""
          } />
          <button type="button" class="btn" data-restore-action="pick-destination" data-fk="restore-pick-destination"${
            restoreSheet.busy ? " disabled" : ""
          }>Choose…</button>
        </div>
        <p class="field-note field-note-hint">${esc(
          chosen
            ? `The copy is checked into a staging folder first, then moved here as ${chosen.roots[0]}. An existing folder of that name is never merged or replaced.`
            : "The copy is checked into a staging folder first, then moved here. Nothing that already exists is merged or replaced.",
        )}</p>
      </div>
    </div>
    <div class="sheet-actions">
      <button type="button" class="btn" data-restore-action="cancel" data-fk="restore-cancel"${restoreSheet.busy ? " disabled" : ""}>Cancel</button>
      <span class="spacer"></span>
      <button type="button" class="btn btn-primary" data-restore-action="start" data-fk="restore-start"${
        restoreSheet.busy || !restoreSheet.chosen || !restoreSheet.destination ? " disabled" : ""
      }>${restoreSheet.busy ? "Starting…" : "Restore"}</button>
    </div>`;
}

async function pickRestoreRoot(): Promise<void> {
  if (!restoreSheet) return;
  try {
    const picked = await backend.invoke<string | null>("pick_mount_point", {
      startDir: restoreSheet.root || undefined,
      message: "Choose the folder that holds the archives",
    });
    if (!picked || !restoreSheet) return;
    restoreSheet.root = picked;
    restoreSheet.chosen = null;
    restoreSheet.scanning = true;
    restoreSheet.error = null;
    renderRestoreSheet();
    // A settle bound of its own: a share that stops answering must not leave "Looking…" forever.
    window.clearTimeout(restoreSheet.scanTimer);
    restoreSheet.scanTimer = window.setTimeout(() => {
      if (!restoreSheet || !restoreSheet.scanning) return;
      restoreSheet.scanning = false;
      restoreSheet.error = "That folder didn't answer in time. Try again, or choose another folder.";
      renderRestoreSheet();
    }, 20000);
    await backend.invoke("restore_scan", { root: picked });
  } catch (error) {
    if (!restoreSheet) return;
    restoreSheet.scanning = false;
    restoreSheet.error = errText(error);
    renderRestoreSheet();
  }
}

async function pickRestoreDestination(): Promise<void> {
  if (!restoreSheet) return;
  try {
    const picked = await backend.invoke<string | null>("pick_mount_point", {
      startDir: restoreSheet.destination || undefined,
      message: "Choose the folder the channel should be restored into",
    });
    if (!picked || !restoreSheet) return;
    restoreSheet.destination = picked;
    renderRestoreSheet();
  } catch (error) {
    if (!restoreSheet) return;
    restoreSheet.error = errText(error);
    renderRestoreSheet();
  }
}

async function startRestore(): Promise<void> {
  if (!restoreSheet || restoreSheet.busy || !restoreSheet.chosen || !restoreSheet.destination) return;
  restoreSheet.busy = true;
  restoreSheet.error = null;
  renderRestoreSheet();
  try {
    await backend.invoke("restore_start", {
      archivePath: restoreSheet.chosen,
      destination: restoreSheet.destination,
    });
    closeRestoreSheet();
    if (view !== "archives") {
      view = "archives";
      render();
    }
  } catch (error) {
    if (!restoreSheet) return;
    restoreSheet.busy = false;
    restoreSheet.error = errText(error);
    renderRestoreSheet();
  }
}

async function revealArchive(id: string): Promise<void> {
  try {
    await backend.invoke("archive_reveal", { id });
  } catch (error) {
    toast(errText(error), { error: true });
  }
}

function archivedSentence(job: JobView): string {
  const where = job.path ? ` In ${job.path}.` : "";
  const note = job.detail ? ` ${job.detail}` : "";
  return `Archived ${job.name} — ${job.filesTotal.toLocaleString()} files, ${sizeLabel(
    job.bytesTotal,
  )}, every check passed.${where}${note}`;
}

// Forgetting a row deletes nothing: the archive on the destination is untouched.
async function forgetArchive(id: string): Promise<void> {
  const archive = snapshot?.archives.find((item) => item.id === id);
  try {
    const next = await backend.invoke<Snapshot>("archive_remove", { id });
    applySnapshot(next);
    toast(`${archive?.name ?? "That row"} is no longer listed. The archive is still where it was.`);
  } catch (error) {
    toast(errText(error), { error: true });
  }
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
          <p class="setting-hint">Tell you when a storage reconnects or stops trying.</p>
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
    shareListSkipped: false,
    shareListTimer: 0,
    listSettled: true,
    mountPickBusy: false,
    signInOpen: false,
    advancedOpen: false,
  };
  renderEditor();
  if (!editorEl.open) editorEl.showModal();
  const first = editorEl.querySelector<HTMLElement>('[name="name"]');
  first?.focus();
  // A host the person can't type but the device can answer: list its shares straight away.
  scheduleShareList(0);
}

function closeEditor(): void {
  cancelBrowseWait();
  if (editor) window.clearTimeout(editor.shareListTimer);
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
  if (base) {
    // With the device's own list on screen, "use a share address like …" would invite typing.
    if (shareListShown() && parseShareHost(editor.draft.target) && !shareNameFromTarget(editor.draft.target)) {
      return "Choose a share from the list.";
    }
    return base;
  }
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
  // A confirmation is the top layer: Escape always answers it, even if a share list is also
  // open behind it (found 2026-11-22: Escape dismissed the list and left Remove asking).
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
  if (editor.shareChoices) {
    typeAddressInstead();
    return;
  }
  requestCloseEditor();
}

function shareLine(d: Draft): string {
  const name = d.kind === "smb" ? shareNameFromTarget(d.target) : null;
  return name ? `<span class="quiet-line" id="share-name">Share: ${esc(name)}</span>` : "";
}

/** The share address is chosen from what the device offers; the field is read-only while a list
 *  is showing, so the address is never typed in that case. Typing is the escape hatch for a
 *  device that offers nothing or cannot be listed, and the note says which of the two it was. */
function browsePanel(): string {
  if (!editor) return "";
  const host = editor.browseHost ?? parseShareHost(editor.draft.target);
  if (editor.browseBusy) {
    return `<p class="field-note field-note-hint" role="status">Looking for shares on ${esc(
      host ?? "this device",
    )}…</p>`;
  }
  if (editor.shareChoices?.length) {
    return `<div class="share-picker" role="group" aria-label="Shares on ${esc(host ?? "this device")}">
      <p class="share-picker-head">Shares on ${esc(host ?? "this device")}</p>
      ${editor.shareChoices
        .map(
          (share) =>
            `<button type="button" class="share-choice share-row${shareNameFromTarget(editor?.draft.target ?? "") === share ? " is-chosen" : ""}" data-editor-action="pick-share" data-share="${esc(
              share,
            )}" data-fk="share-${esc(share)}" aria-pressed="${
              shareNameFromTarget(editor?.draft.target ?? "") === share
            }"><span class="share-row-name">${esc(share)}</span><span class="share-row-add">Add</span></button>`,
        )
        .join("")}
      <button type="button" class="share-choice share-choice-dismiss" data-editor-action="dismiss-shares">Type the address instead</button>
    </div>`;
  }
  return editor.shareNote
    ? `<p class="field-note field-note-${editor.shareNoteTone}" role="status">${esc(editor.shareNote)}</p>`
    : "";
}

function shareListShown(): boolean {
  return Boolean(editor?.shareChoices?.length) && !editor?.shareListSkipped;
}

/** Lists the host's shares after a short pause, so typing a host does not fire a request
 *  on every keystroke. A host already listed is not listed again. */
function scheduleShareList(delay = 500): void {
  if (!editor) return;
  window.clearTimeout(editor.shareListTimer);
  editor.listSettled = false;
  editor.shareListTimer = window.setTimeout(() => autoListShares(), delay);
}

function autoListShares(): void {
  if (!editor || editor.busy || editor.browseBusy) return;
  const host = parseShareHost(editor.draft.target);
  if (editor.draft.kind !== "smb" || !host) {
    // Nothing to wait for: without this the save reason stays hidden for ever on a draft with
    // no address, and Save is disabled with no explanation (found 2026-11-22).
    editor.listSettled = true;
    updateEditorBlockState();
    return;
  }
  if (editor.shareListSkipped && editor.browseHost === host) return;
  if (editor.browseHost === host && editor.shareChoices) return;
  void browseShares();
}

/** The escape hatch: type the address for this device instead of picking from its list. */
function typeAddressInstead(): void {
  if (!editor) return;
  editor.shareListSkipped = true;
  editor.listSettled = true;
  editor.shareChoices = null;
  editor.shareNote = null;
  editor.focusField = "target";
  renderEditor();
  editorEl.querySelector<HTMLElement>('[name="target"]')?.focus();
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
  const showReason = editorShowReason() && blockReason;
  const connectedShares =
    !isEdit && d.kind === "smb" && !editor.connectedChosen && !d.target.trim()
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
        <span class="field-hint">Already mounted in Finder? Add it here.</span>
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
  const mountField = `
        <div class="field">
          <span class="field-label" id="mount-point-label">Mount point (optional)</span>
          <div class="browse-row">
            <input id="mount-point" type="text" name="mountPoint" value="${esc(d.mountPoint)}" placeholder="macOS chooses a folder in /Volumes" spellcheck="false" autocomplete="off" readonly aria-labelledby="mount-point-label" aria-describedby="mount-point-hint"${
              editor.busy ? " disabled" : ""
            } />
            <button type="button" class="btn" data-editor-action="pick-mount" data-fk="editor-pick-mount"${
              editor.busy || editor.mountPickBusy ? " disabled" : ""
            }>${editor.mountPickBusy ? "Choosing…" : "Choose…"}</button>
            ${
              d.mountPoint
                ? `<button type="button" class="btn" data-editor-action="clear-mount" data-fk="editor-clear-mount"${
                    editor.busy ? " disabled" : ""
                  }>Clear</button>`
                : ""
            }
          </div>
          <span class="field-hint" id="mount-point-hint">Chosen in the folder panel, so a path is never typed by hand.</span>
        </div>`;
  const reconnectSwitches = `
      <div class="check-stack">
        <label class="check-row"><input type="checkbox" name="login" ${d.reconnectAtLogin ? "checked" : ""}${
          editor.busy ? " disabled" : ""
        } /> Reconnect at login</label>
        <label class="check-row"><input type="checkbox" name="wake" ${d.reconnectAfterWake ? "checked" : ""}${
          editor.busy ? " disabled" : ""
        } /> Reconnect after wake</label>
      </div>`;
  const signInOpen = editor.signInOpen || Boolean(d.username) || Boolean(d.password) || savedCredentials;
  const identityFields =
    d.kind === "smb"
      ? `
        <div class="field">
          <label class="field-label" for="share-target">Device address (or share)</label>
          <div class="browse-row">
            <input id="share-target" type="text" name="target" value="${esc(readableTarget(d.target))}" placeholder="192.168.0.10 or smb://nas/studio" spellcheck="false" autocomplete="off" aria-describedby="share-target-hint"${
              editor.busy ? " disabled" : ""
            }${shareListShown() ? ' readonly aria-describedby="share-list-hint"' : ""} />
            <button type="button" class="btn" data-editor-action="browse" data-fk="editor-browse"${
              editor.busy || editor.browseBusy ? " disabled" : ""
            }>${editor.browseBusy ? "Looking…" : shareListShown() ? "Refresh list" : "Find shares"}</button>
          </div>
          <span class="field-hint" id="share-target-hint">The address you type in Finder, or your NAS's IP — we'll find its shares for you.</span>
          ${
            shareListShown()
              ? `<p class="field-note field-note-hint" id="share-list-hint">Choose a share below. The address is filled in for you.</p>`
              : ""
          }
        </div>
        ${shareLine(d)}
        ${browsePanel()}
        <details class="group signin-group"${signInOpen ? " open" : ""}>
          <summary>Sign in (optional)</summary>
          <p class="field-hint">Leave this blank if the device lets guests in. If it asks for a user name and password, enter them here and we'll look again.</p>
          <label class="field">
            <span class="field-label">User name</span>
            <input type="text" name="username" value="${esc(d.username)}" autocomplete="off"${
              editor.busy ? " disabled" : ""
            } />
          </label>
          <label class="field">
            <span class="field-label">Password</span>
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
        </details>
        <details class="group advanced-group"${editor.advancedOpen ? " open" : ""}>
          <summary>Advanced</summary>
          ${mountField}
          ${reconnectSwitches}
        </details>`
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
      ${d.kind === "volume" ? reconnectSwitches : ""}
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
      // The device may have just become known: list its shares once typing pauses.
      scheduleShareList();
      break;
    case "username":
      draft.username = target.value;
      // Another identity on the same device can offer a different list.
      if (editor.shareChoices) {
        editor.shareChoices = null;
        editor.browseHost = null;
      }
      scheduleShareList();
      break;
    case "password":
      draft.password = target.value;
      break;
    case "forgetPassword":
      draft.removeCredentials = (target as HTMLInputElement).checked;
      if (draft.removeCredentials) draft.password = "";
      renderEditor();
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
/** One rule for the red reason: not before the person has touched anything, never while a list is
 *  on its way or on screen, and never for a sheet that is busy finishing something. */
function editorShowReason(): boolean {
  if (!editor?.touched) return false;
  if (editor.browseBusy) return false;
  if (editor.draft.kind === "smb" && !editor.shareListSkipped && !editor.listSettled) return false;
  if (shareListShown()) return false;
  return true;
}

function updateEditorBlockState(): void {
  if (!editor) return;
  const blockReason = editorBlockReason();
  const showReason = editorShowReason() && blockReason;
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

function cancelBrowseWait(): void {
  if (browseLease !== null) window.clearTimeout(browseLease);
  browseLease = null;
}

/** Ends a Browse with its answer or its reason; the wait is over either way. */
function endBrowse(note: string | null = null, tone: "warn" | "error" = "warn"): void {
  cancelBrowseWait();
  if (!editor) return;
  editor.browseBusy = false;
  editor.listSettled = true;
  if (note) {
    editor.shareNote = note;
    editor.shareNoteTone = tone;
  }
  renderEditor();
}

async function browseShares(): Promise<void> {
  if (!editor || editor.busy || editor.browseBusy) return;
  const host = parseShareHost(editor.draft.target);
  if (!host) {
    editor.listSettled = true;
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
  editor.shareListSkipped = false;
  editor.error = null;
  renderEditor();
  // Looking… is an answer owed: if the helper or the device never answers, the row says so
  // instead of staying disabled with no way out.
  cancelBrowseWait();
  browseLease = window.setTimeout(() => {
    endBrowse("The device didn't answer. Check the address, or press Find shares.", "error");
  }, 25000);
  try {
    await backend.invoke<null>("list_shares", {
      address: editor.draft.target.trim(),
      username: editor.draft.username,
      password: editor.draft.password,
    });
  } catch (error) {
    cancelBrowseWait();
    if (!editor) return;
    editor.browseBusy = false;
    editor.listSettled = true;
    editor.shareNote = error instanceof Error ? error.message : String(error);
  editor.shareNoteTone = "error";
    renderEditor();
  }
}

function applyShares(payload: { host: string; shares: string[]; needsCredentials: boolean; error: string | null }): void {
  if (!editor || !editor.browseBusy) return;
  // An answer for another device is an older Browse's: it must not be read as this one's.
  if (editor.browseHost && payload.host.trim().toLowerCase() !== editor.browseHost.trim().toLowerCase()) return;
  cancelBrowseWait();
  editor.browseBusy = false;
  editor.listSettled = true;
  if (payload.needsCredentials) {
    editor.shareNote = "That device needs a user name and password. Enter them below, or type the address instead.";
    editor.shareNoteTone = "warn";
    editor.error = null;
    editor.signInOpen = true;
    renderEditor();
    editorEl.querySelector<HTMLElement>('[name="username"]')?.focus();
    return;
  }
  if (payload.error) {
    // Plainly why there is no list, and what to do next; typing stays the way through.
    editor.shareNote = `${payload.error.replace(/[.]$/, "")}. Check the address, or press Find shares.`;
    editor.shareNoteTone = "error";
    renderEditor();
    return;
  }
  afterSharesRendered = true;
  if (!payload.shares.length) {
    // An empty answer is not "this device has no shares": it may hide them or be misconfigured.
    editor.shareNote = "This device didn't list any shares. That doesn't mean it has none. You can type the share address instead.";
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
  // Normalised exactly as the typed path is: host, then the share percent-encoded.
  editor.draft.target = shareTarget(host, share);
  if (!editor.draft.name.trim()) editor.draft.name = share;
  editor.shareNote = null;
  editor.error = null;
  editor.shareListSkipped = false;
  editor.touched = true;
  editor.dirty = true;
  renderEditor();
  editorEl.querySelector<HTMLElement>(`[data-share="${share.replace(/["\\]/g, "")}"]`)?.focus();
}

/** The mount point comes from macOS's folder panel; the field is read-only so no path is typed. */
async function pickMountPoint(): Promise<void> {
  if (!editor || editor.busy || editor.mountPickBusy) return;
  editor.mountPickBusy = true;
  editor.error = null;
  renderEditor();
  try {
    const chosen = await backend.invoke<string | null>("pick_mount_point", {
      startDir: editor.draft.mountPoint,
    });
    if (!editor) return;
    if (typeof chosen === "string" && chosen.trim()) {
      editor.draft.mountPoint = chosen.trim();
      editor.touched = true;
      editor.dirty = true;
    }
  } catch (error) {
    if (editor) editor.error = errText(error);
  } finally {
    if (editor) {
      editor.mountPickBusy = false;
      renderEditor();
      if (!restoreFocus("editor-pick-mount")) focusTopDialog();
    }
  }
}

function clearMountPoint(): void {
  if (!editor || editor.busy) return;
  editor.draft.mountPoint = "";
  editor.touched = true;
  editor.dirty = true;
  renderEditor();
  editorEl.querySelector<HTMLElement>('[data-editor-action="pick-mount"]')?.focus();
}

async function saveEditor(): Promise<void> {
  if (!editor || editor.busy) return;
  const d = editor.draft;
  editor.touched = true;
  // One canonical stored address, whether it was picked or typed.
  if (d.kind === "smb") {
    const address = normaliseShareAddress(d.target);
    if (address) d.target = address.target;
  }
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
  const job = next.job;
  if (job && ["archived", "restored", "failed"].includes(job.state)) {
    const key = `${job.state}:${job.id}:${job.filesTotal}`;
    if (announcedJob !== key) {
      announcedJob = key;
      if (job.state === "archived") {
        toast(archivedSentence(job));
      } else if (job.state === "restored") {
        toast(job.detail ?? "Restored, and every check passed.");
        toast("YouTube sign-in, Content Packs and the Gateway address belong to each Mac: set them again in Story Studio KH here.");
      } else {
        toast(job.detail ?? "It stopped without saying why.", { error: true });
      }
    }
  }
  if (restoreSheet) {
    if (next.restorable && next.restorable.root === restoreSheet.root) {
      window.clearTimeout(restoreSheet.scanTimer);
      restoreSheet.scanning = false;
    }
    const signature = next.restorable
      ? `${next.restorable.root}:${next.restorable.items.length}:${next.restorable.error ?? ""}`
      : "none";
    if (signature !== restoreSignature) {
      restoreSignature = signature;
      renderRestoreSheet();
    }
  }
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
      else if (action === "mount" || action === "unmount" || action === "cancel" || action === "test") {
        void runRowAction(id, action);
      }
      else if (action === "reveal") void revealStorage(id);
      else if (action === "edit") {
        const storage = snapshot?.storages.find((item) => item.id === id);
        if (storage) openEditor(storage, `row-${id}-menu`);
      } else if (action === "add-archive") openArchiveSheet();
      else if (action === "archive-start") void startArchiveRow(id);
      else if (action === "restore-open") openRestoreSheet();
      else if (action === "archive-reveal") void revealArchive(id);
      else if (action === "archive-edit") {
        const archive = snapshot?.archives.find((item) => item.id === id);
        if (archive) openArchiveSheet(archive);
      } else if (action === "archive-forget") void forgetArchive(id);
      else if (action === "show-warning") showWarningRow(id);
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

  // The sheet re-renders on every change; a disclosure the person opened stays open.
  editorEl.addEventListener(
    "toggle",
    (event) => {
      const section = event.target;
      if (!editor || !(section instanceof HTMLDetailsElement)) return;
      if (section.classList.contains("signin-group")) editor.signInOpen = section.open;
      if (section.classList.contains("advanced-group")) editor.advancedOpen = section.open;
    },
    true,
  );

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
      case "pick-mount":
        void pickMountPoint();
        break;
      case "clear-mount":
        clearMountPoint();
        break;
      case "dismiss-shares":
        typeAddressInstead();
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

  archiveSheetEl.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-archive-action]");
    if (!button) return;
    switch (button.dataset.archiveAction) {
      case "cancel":
        closeArchiveSheet();
        break;
      case "pick-folder":
        void pickArchiveFolder("folder");
        break;
      case "pick-media":
        void pickArchiveFolder("media");
        break;
      case "pick-destination":
        void pickArchiveFolder("destination");
        break;
      case "save":
        void saveArchiveSheet();
        break;
    }
  });

  archiveSheetEl.addEventListener("input", (event) => {
    if (!archiveSheet || !(event.target instanceof HTMLInputElement)) return;
    if (event.target.name === "archive-name") archiveSheet.draft.name = event.target.value;
  });

  archiveSheetEl.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || !archiveSheet || archiveSheet.busy) return;
    if (!(event.target instanceof HTMLInputElement) || event.target.type === "checkbox") return;
    event.preventDefault();
    void saveArchiveSheet();
  });

  restoreSheetEl.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-restore-action]");
    if (!button) return;
    switch (button.dataset.restoreAction) {
      case "cancel":
        closeRestoreSheet();
        break;
      case "pick-root":
        void pickRestoreRoot();
        break;
      case "pick-destination":
        void pickRestoreDestination();
        break;
      case "start":
        void startRestore();
        break;
    }
  });

  restoreSheetEl.addEventListener("change", (event) => {
    const target = event.target;
    if (!restoreSheet || !(target instanceof HTMLInputElement) || target.name !== "archive-choice") return;
    restoreSheet.chosen = target.value;
    renderRestoreSheet();
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

  for (const dialog of [editorEl, whatsnewEl, credentialsEl, archiveSheetEl, restoreSheetEl]) {
    dialog.addEventListener("keydown", (event) => trapTab(dialog, event));
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      // A click outside a sheet must never throw away typed input; Escape or Cancel closes it.
      if (dialog !== whatsnewEl) return;
      closeWhatsNew();
    });
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      if (dialog === editorEl) handleEditorEscape();
      else if (dialog === whatsnewEl) closeWhatsNew();
      else if (dialog === archiveSheetEl) closeArchiveSheet();
      else if (dialog === restoreSheetEl) closeRestoreSheet();
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
