# khsparkle — vendored for Storage Studio KH's Sparkle baseline (0.1.30)

- `Sparkle.framework` — Sparkle 2.10.1 (build 2065), from
  `_orchestra/developer-system/sparkle-shim-20261123/vendor/`.
- `libkhsparkle.a` — the shared shim's universal static library (arm64 + x86_64), 86,632 bytes,
  sha256 `2bce760e7749a0f21dfa378c53c391d039401355012e774a81b691043a3cb17f` — the **current** entry in
  `_orchestra/tools/pinned/REQUIRED-SHIM.txt` (taken at 0.1.30; 0.1.27–0.1.29 carried the
  accepted-previous `818826a7…`). It carries the `~`-expansion fix for `KHHoldTokenFile`; without it a
  `~/…` token path never resolves.
- `khsparkle.h` — the C surface the app calls.

Committed with the wiring that uses it (policy `1f043c3`, row `160`), so `git ls-tree -r <tag>` proves
what the tag builds. Hashing the framework binary is not a check: `Sparkle.framework/Versions/B/Sparkle`
differs per tree.
