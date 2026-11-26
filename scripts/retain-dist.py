#!/usr/bin/env python3
"""Keep the current and previous released DMGs in dist/ and retire older ones to _trash.

Owner rule 2026-11-16: current + previous stay (KEEP = 2); anything older is moved recoverably to the
app's own `~/Desktop/_trash/storage-studio-kh/<date> retention/`, never deleted in place and never ~/.Trash. A version
named by a local receipt, release.json, previous-release.json or the retention ledger is
never moved, and neither is the version being released now.

Usage: python3 -I scripts/retain-dist.py "Storage Studio KH" 0.1.0
"""
import json
import os
import re
import shutil
import sys
from pathlib import Path

PRODUCT = "Storage Studio KH"
KEEP = 2


def version_of(path: Path):
    match = re.match(rf"^{re.escape(PRODUCT)}-(\d+(?:\.\d+){{1,5}})\.dmg$", path.name)
    return match.group(1) if match else None


def key(version: str):
    return tuple(int(part) for part in version.split("."))


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__.strip().splitlines()[0], file=sys.stderr)
        return 2
    product, current = sys.argv[1], sys.argv[2]
    if product != PRODUCT:
        print(f"REFUSED unknown product {product}", file=sys.stderr)
        return 2
    dist = Path("dist")
    dmgs = [p for p in dist.glob(f"{PRODUCT}-*.dmg") if version_of(p)]
    dmgs.sort(key=lambda p: key(version_of(p)), reverse=True)
    protected = {current}
    for name in ("release.json", "previous-release.json", ".release-dist.json"):
        path = dist / name
        if path.exists():
            try:
                protected.update(re.findall(r"\b\d{1,9}(?:\.\d{1,9}){1,5}\b", path.read_text()))
            except OSError:
                pass
    # Local receipts are history, not feed pins: only the version being released is kept
    # beyond the newest two.

    kept, retired = [], []
    for index, path in enumerate(dmgs):
        version = version_of(path)
        if index < KEEP or version in protected:
            kept.append(path)
            continue
        trash = Path.home() / "Desktop/_trash/storage-studio-kh" / ("%s retention" % __import__("datetime").date.today().isoformat())
        trash.mkdir(parents=True, exist_ok=True)
        destination = trash / path.name
        shutil.move(str(path), destination)
        retired.append({"version": version, "from": str(path), "to": str(destination)})
    print(json.dumps({"kept": [str(p) for p in kept], "retired": retired}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
