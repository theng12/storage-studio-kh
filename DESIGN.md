---
name: Storage Studio KH
description: A calm macOS settings window for reconnecting shares and disks, with a clear view of what is connected and what needs attention.
colors:
  accent: "#0d6b5c"
  accent-hover: "#0a5a4d"
  accent-tint: "#dfeee9"
  accent-dark: "#6ecfbc"
  accent-tint-dark: "#173a34"
  page: "#f0efea"
  page-dark: "#161615"
  surface: "#fbfaf7"
  surface-dark: "#222220"
  surface-raised: "#ffffff"
  surface-raised-dark: "#2a2a28"
  sidebar: "#e7e4de"
  sidebar-dark: "#1c1c1b"
  text: "#20201d"
  text-dark: "#f1f0ea"
  text-secondary: "#54544e"
  text-secondary-dark: "#b9b8b1"
  text-caption: "#5f5e58"
  text-caption-dark: "#a9a8a0"
  line: "#d4d1c9"
  line-dark: "#3b3b37"
  line-strong: "#c2beb5"
  line-strong-dark: "#4d4d47"
  status-ok: "#1f7248"
  status-warn: "#7c5600"
  status-bad: "#a92a20"
  status-off: "#5c5f5c"
  status-info: "#215d86"
  control-shadow: "rgba(0, 0, 0, 0.25)"
typography:
  page-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Helvetica Neue, sans-serif"
    fontSize: "26px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  section:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Helvetica Neue, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Helvetica Neue, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
  secondary:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Helvetica Neue, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.45
  caption:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Helvetica Neue, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.35
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Helvetica Neue, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.4
rounded:
  control: "6px"
  card: "8px"
  sheet: "12px"
  pill: "999px"
spacing:
  xs: "4px"
  tight: "6px"
  s: "8px"
  m: "12px"
  l: "16px"
  xl: "24px"
  page: "28px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "28px"
    typography: "{typography.label}"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "#ffffff"
  button-secondary:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "28px"
  chip:
    backgroundColor: "{colors.accent-tint}"
    textColor: "{colors.accent}"
    rounded: "{rounded.control}"
    height: "22px"
    typography: "{typography.caption}"
  sidebar-item:
    backgroundColor: "{colors.accent-tint}"
    textColor: "{colors.accent}"
    rounded: "{rounded.control}"
    height: "30px"
    padding: "0 8px"
  version-pill:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text}"
    rounded: "999px"
    height: "26px"
    padding: "0 6px"
    typography: "{typography.caption}"
---

## Overview

Storage Studio KH is a macOS settings window, not a web dashboard. The visual world is a quiet
native instrument: neutral warm greys in light mode and layered charcoal in dark mode, one deep
teal accent, system type, and information arranged in single bordered groups. The task is to see
which storages are connected, fix the ones that are not, and close the window. Decoration stays
out of the way; state honesty carries the design.

The window is 820 × 640 (minimum 700 × 520). The sidebar is 220 px with three destinations
(Storage, General, Appearance) and a footer pinned to the bottom. The footer holds Support this
app, the version + What's New pill, the icon-only Check for Updates button, and the download icon
only when an update is available. A short quiet update line sits beneath.

## Colors

Light and dark are two complete token sets selected by `data-theme` on `<html>`. System follows
`prefers-color-scheme`; a stored `default` is treated as System. Body and placeholder text are at
least 4.5:1 in both themes (measured: 5.77:1 minimum for captions, 6.22:1 for placeholders).

| Role | Light | Dark |
| --- | --- | --- |
| Window | `#f1f0ec` | `#181817` |
| Sidebar | `#e9e7e2` | `#1e1e1d` |
| Content surface | `#fbfaf7` | `#222220` |
| Raised surface | `#ffffff` | `#282826` |
| Text | `#232320` | `#eeede8` |
| Secondary text | `#585852` | `#b3b2ab` |
| Caption text | `#66655f` | `#a3a29b` |
| Hairline | `#dcd9d2` | `#353532` |
| Accent | `#0d6b5c` | `#6ecfbc` |
| Accent text on fill | `#ffffff` | `#07231e` |
| Accent tint | `#dfeee9` | `#173a34` |
| Status ok | `#1f7248` on `#e6f1ea` | `#7bd3a1` on `#16301f` |
| Status warn | `#7c5600` on `#f5edd9` | `#e2b56a` on `#332a16` |
| Status bad | `#a92a20` on `#f8e8e5` | `#ff8f85` on `#3a1d1a` |
| Status off | `#5c5f5c` on `#eceae5` | `#a9a8a1` on `#2b2b28` |
| Status info | `#215d86` on `#e6eef5` | `#8fc3e8` on `#182a37` |

The accent is used only for primary actions, current selection, focus rings, and update affordances.
Status colours are semantic and always paired with a written label and a dot; colour never carries
the state alone. Destructive confirm buttons are solid status-bad; the safe action in a confirm is
the accent primary.

## Typography

One family: the macOS system sans (`-apple-system`, `SF Pro Text`, `Helvetica Neue`). The scale is
fixed, not fluid: 26 page title, 15 section and empty title, 13 row title/body, 12 secondary and
hints, 11 caption and chip labels. Weights step only 400 / 500 / 600. Title tracking is −0.02em;
everything else is normal. Prose measures stay between 44ch and 62ch. Numerals in the retries
input are tabular. Monospace is used only for mounted paths, not as a style for labels.

## Layout

- Sidebar 220 px, content area fills the rest. Page padding 28 px; 24 px below 760 px width.
- Page header: title and one-sentence lede on the left, the primary page action on the right,
  24 px below the header.
- Navigation rows are 30 px high with 4 px between them; sidebar footer groups sit above a hairline
  and are flush to the bottom edge.
- Storage rows live in one bordered group (8 px radius) with hairline dividers. Each row: title and
  kind, status chip at top-right, optional detail, optional mounted path, the two reconnect facts,
  then row actions. 16 px row padding.
- Settings pages use one group with 16 px rows and hairline dividers; supporting sentences sit
  outside the group.
- Tight groups, generous section separation: 8–12 px inside a row cluster, 16 px between fields in
  a sheet, 24 px between page sections.
- Spacing tokens only: 4 / 6 / 8 / 12 / 16 / 24 / 28.

## Elevation & Depth

Hairline borders and tonal layering carry depth. Groups, rows, and settings blocks use a 1 px
border, never a border plus a wide shadow. Only sheets and toasts float, using a soft offset shadow
(`0 12px 32px rgba(30,28,24,.18)` light; `0 16px 38px rgba(0,0,0,.5)` dark) and a dimmed backdrop.
Open dialogs get the sheet radius and one soft shadow; nothing else is elevated.

## Shapes

Radii are 6 px for controls, 8 px for cards and groups, 12 px for sheets. The version control and
status dots are the only fully round shapes; switches are pill-shaped tracks. Dividers are 1 px.
There are no nested cards: a storage row is content inside one group, not a card inside a card.

## Components

- **Primary button**: accent fill, 28 px high, 6 px radius, 12 px horizontal padding, 12 px
  semibold label with a 16 px SVG icon where useful. Hover darkens the fill, active deepens it,
  focus draws a 2 px accent ring at 2 px offset, disabled drops to 50% opacity.
- **Secondary button**: raised surface, hairline border, text colour. Same shape and states.
- **Quiet danger button / danger button**: Remove starts as red text in the sheet footer; the
  confirm step uses a solid status-bad button named after the storage.
- **Icon-only update controls**: 24 px boxes with 16 px inline SVG. Refresh is the exact Launcher
  circular-arrow glyph; download is the exact circular-download glyph; both carry `title` and
  `aria-label`. The download control appears only for an available update and uses an accent fill.
- **Version pill**: 26 px pill, raised surface, hairline, app name + installed version at 11 px
  semibold, opens What's New. It never truncates at the supported minimum width.
- **Status chip**: 22 px tinted block, 6 px radius, 11 px semibold label, 6 px leading dot. Tones:
  ok / warn / bad / off / info.
- **Switch**: 36 × 20 px track with a 16 px thumb; accent when on, neutral when off, visible focus
  ring around the track, disabled at reduced opacity. Thumb motion 160 ms and removed under
  reduced motion.
- **Segmented control**: 4 px inset track on the page background, 30 px segments, 12 px semibold
  labels with 14 px icons. The selected segment is accent-filled; keyboard focus follows the
  native radio group.
- **Storage row actions**: text buttons at 12 px, 24 px high, 6 px radius, accent only for the
  row's primary action (Mount now). Disabled actions stay visible with a reason in `title`.
- **Dialogs**: native `<dialog>` sheets, 480 px wide, 12 px radius, head + scrollable body + footer
  actions. Esc closes the topmost dialog only; a destructive confirm ignores backdrop clicks and
  returns to the edit form on Esc. Focus is moved into the sheet and restored on close.
- **Empty, error, and helper-down states**: one quiet icon, one-line title, one sentence, one
  action (empty); the helper-down banner uses a warn tint, a warning triangle, the reason, and the
  recovery sentence. They share the same shape and spacing.
- **Toasts**: bottom-right, maximum three, newest on top, 12 px body, raised surface with hairline
  and soft shadow. Success dismisses after 6 s; errors stay until dismissed and carry an SVG close
  button. Container is `role="status"` with `aria-live="polite"`.

## Do's and Don'ts

- Do keep the macOS settings vocabulary: left sidebar, one page at a time, native dialogs, system
  type, familiar controls.
- Do use the shared KH status names exactly: Mounted, Mounting…, Retrying…, Needs attention,
  Unreachable, Not mounted.
- Do keep all text and placeholders at 4.5:1 or better in both themes; measured in the built UI.
- Do use inline SVG icons only, in one 1.7 px stroke style; no emoji, Unicode glyphs, or text icons.
- Do keep one accent and use it only for primary action, selection, focus, and update affordances.
- Do respect `prefers-reduced-motion`; motion is state feedback in 150–250 ms, never page choreography.
- Don't add eyebrow labels, nested cards, gradient text, decorative blur/glass, or monospace as a
  costume.
- Don't replace the framework, component vocabulary, or tokens with a new design system.
- Don't hide a failed state, invent a percentage, or let "not checked" read as passed.
