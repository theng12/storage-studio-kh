# khsparkle — vendored for Storage Studio KH's Sparkle baseline (0.1.27)

- `Sparkle.framework` — Sparkle 2.10.1 (build 2065), from
  `_orchestra/developer-system/sparkle-shim-20261123/vendor/`.
- `libkhsparkle.a` — the shared shim's universal static library (arm64 + x86_64), 85,480 bytes,
  sha256 in `_orchestra/tools/pinned/REQUIRED-SHIM.txt` and in this release's receipt. It carries the
  `~`-expansion fix for `KHHoldTokenFile`; without it a `~/…` token path never resolves.
- `khsparkle.h` — the C surface the app calls.

Committed with the wiring that uses it (policy `1f043c3`, row `160`), so `git ls-tree -r <tag>` proves
what the tag builds. Hashing the framework binary is not a check: `Sparkle.framework/Versions/B/Sparkle`
differs per tree.
