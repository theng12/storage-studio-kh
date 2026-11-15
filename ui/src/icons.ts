function svg(body: string, className = "icon"): string {
  return `<svg class="${className}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

export const icons = {
  storage: svg(
    '<rect x="2.2" y="2.6" width="11.6" height="4.6" rx="1.2"/><rect x="2.2" y="8.8" width="11.6" height="4.6" rx="1.2"/><path d="M4.6 4.9h.01M4.6 11.1h.01"/>',
  ),
  general: svg(
    '<path d="M2.5 4h4.2M9.3 4h4.2M2.5 12h6.2M11.3 12h2.2"/><circle cx="8" cy="4" r="1.5"/><circle cx="10" cy="12" r="1.5"/>',
  ),
  appearance: svg(
    '<circle cx="8" cy="8" r="5.5"/><path d="M8 2.5a5.5 5.5 0 0 1 0 11Z" fill="currentColor" stroke="none"/>',
  ),
  heart: svg(
    '<path d="M8 13.2S2.4 9.9 2.4 6.3A2.9 2.9 0 0 1 8 5.1a2.9 2.9 0 0 1 5.6 1.2c0 3.6-5.6 6.9-5.6 6.9Z"/>',
  ),
  refresh: svg('<path d="M13.5 8A5.5 5.5 0 1 1 11.9 4.1"/><path d="M12.5 1.8v2.7H9.8"/>'),
  download: svg('<path d="M8 2.6v6.2M5.2 6.2 8 9l2.8-2.8M2.8 11.4v1.6h10.4v-1.6"/>'),
  plus: svg('<path d="M8 3v10M3 8h10"/>'),
  check: svg('<path d="m3.2 8.4 3 3 6.6-6.8"/>'),
  dash: svg('<path d="M4 8h8"/>'),
  warning: svg('<path d="M8 2.6 14 13H2L8 2.6Z"/><path d="M8 6.4v3.1M8 11.4h.01"/>'),
  drive: svg(
    '<rect x="2.2" y="2.6" width="11.6" height="4.6" rx="1.2"/><rect x="2.2" y="8.8" width="11.6" height="4.6" rx="1.2"/><path d="M4.6 4.9h.01M4.6 11.1h.01"/>',
    "icon icon-large",
  ),
  folder: svg(
    '<path d="M2.3 5.2c0-.7.6-1.2 1.2-1.2h2.4l1.2 1.4h5.6c.7 0 1.2.6 1.2 1.2v5c0 .7-.6 1.2-1.2 1.2H3.5c-.7 0-1.2-.6-1.2-1.2V5.2Z"/>',
  ),
  monitor: svg('<rect x="2" y="3" width="12" height="8" rx="1.2"/><path d="M5.5 13.5h5M8 11v2.5"/>'),
  sun: svg(
    '<circle cx="8" cy="8" r="3.1"/><path d="M8 1.8v1.4M8 12.8v1.4M1.8 8h1.4M12.8 8h1.4M3.6 3.6l1 1M11.4 11.4l1 1M12.4 3.6l-1 1M4.6 11.4l-1 1"/>',
  ),
  moon: svg('<path d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.5 5.5 0 1 0 6.8 6.8Z"/>'),
  close: svg('<path d="m4.2 4.2 7.6 7.6M11.8 4.2l-7.6 7.6"/>'),
  clock: svg('<circle cx="8" cy="8" r="5.6"/><path d="M8 4.9V8l2.2 1.4"/>'),
  more: svg(
    '<circle cx="3.4" cy="8" r="1.15" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1.15" fill="currentColor" stroke="none"/><circle cx="12.6" cy="8" r="1.15" fill="currentColor" stroke="none"/>',
  ),
  grid: svg('<rect x="2.2" y="2.2" width="4.8" height="4.8" rx="1"/><rect x="9" y="2.2" width="4.8" height="4.8" rx="1"/><rect x="2.2" y="9" width="4.8" height="4.8" rx="1"/><rect x="9" y="9" width="4.8" height="4.8" rx="1"/>'),
  rows: svg('<path d="M2.5 4h11M2.5 8h11M2.5 12h11"/>'),
};
