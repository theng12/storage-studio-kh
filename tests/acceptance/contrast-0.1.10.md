# Storage Studio KH 0.1.10 — contrast and layering

Measured with the WCAG relative-luminance formula on the app's own token values. The acceptance run
prints the same pairs from the rendered computed styles (`Contrast` checks in
`tests/acceptance/report.md`). The neutral ramp is now explicit tokens in `ui/src/styles.css`:
`--page`, `--sidebar`, `--surface`, `--raised`, `--border`, `--border-strong`, `--text-body`,
`--text-muted`, `--text-quiet`, with the old names (`--bg`, `--line`, `--text`, `--text-2`,
`--text-3`) aliased to them.

## Body, muted and quiet text (minimum over page / sidebar / surface / raised)

| Pair | Before (light) | After (light) | Before (dark) | After (dark) |
| --- | --- | --- | --- | --- |
| Body text | 13.82 | 14.19 | 12.60 | 12.60 |
| Muted text | 5.79 | 6.01 | 6.94 | 7.23 |
| Quiet text | **4.73** | **5.13** | 5.77 | 6.02 |

Lowest text pair is now 5.13:1 in light (quiet text on the navigation plane) and 6.02:1 in dark,
both well above the 4.5:1 body minimum. Disabled controls are exempt and stay dimmer by design.

## Status chips and primary action (unchanged colours, re-measured)

| Pair | Light | Dark |
| --- | --- | --- |
| Mounted chip | 5.10 | 7.91 |
| Needs attention chip | 5.65 | 7.45 |
| Unreachable chip | 5.81 | 6.95 |
| Not mounted chip | 5.38 | 5.95 |
| Info chip | 6.02 | 7.82 |
| Primary button label | 6.41 | 8.92 |

Status colours appear only in chips, the helper banner and the grouped warning line; the single
accent (`#0d6b5c` light / `#6ecfbc` dark) marks the primary action, the current section and the
download control.

## Layer separation (relative luminance difference, decorative)

| Plane pair | Before (light) | After (light) | Before (dark) | After (dark) |
| --- | --- | --- | --- | --- |
| Navigation vs content | 0.1563 | 0.1785 | 0.0030 | 0.0043 |
| Raised card vs surface | 0.0440 | 0.0440 | 0.0052 | 0.0071 |
| Page vs navigation | 0.0711 | 0.0845 | 0.0038 | 0.0036 |

Borders are decorative; the 1px line goes from 1.35:1 to 1.46:1 against the content surface in
light and from 1.30:1 to 1.42:1 in dark, while the planes themselves separate more clearly.
