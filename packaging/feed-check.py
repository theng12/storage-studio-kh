#!/usr/bin/env python3
"""Check a served feed row (and optionally its artifact) after a publish.

    packaging/feed-check.py --app <id> (--feed-url <url> | --feed-json <file>) [--artifact <file>]
      [--expect-version V] [--expect-sha S] [--expect-bytes N] [--expect-tagline T]
      [--expect-description D] [--expect-type T] [--expect-hold-url H] [--expect-hold-since V]

Every --expect-* given must be present on the row and equal; anything else is a failed release.
A missing field reads "None" and fails — that is the bug this exists for (2026-11-22: a publish
left type and holdSince off the Storage row and the old readback only checked what it sent).
--feed-json accepts the served envelope ({"feed": base64}) or a decoded feed, so tests use
fixtures with no network. Exits 0 on pass, 1 on any difference, 2 on usage or unreadable input.
"""
import argparse
import base64
import hashlib
import json
import pathlib
import sys
import urllib.parse
import urllib.request


def load_feed(args):
    if args.feed_json:
        raw = json.loads(pathlib.Path(args.feed_json).read_text())
    else:
        raw = json.load(urllib.request.urlopen(args.feed_url, timeout=20))
    return json.loads(base64.b64decode(raw["feed"])) if "feed" in raw else raw


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--app", required=True)
    p.add_argument("--feed-url")
    p.add_argument("--feed-json")
    p.add_argument("--artifact")
    for name in ("version", "sha", "bytes", "tagline", "description", "type", "hold-url", "hold-since"):
        p.add_argument("--expect-" + name)
    args = p.parse_args()
    if bool(args.feed_url) == bool(args.feed_json):
        p.error("give exactly one of --feed-url and --feed-json")

    feed = load_feed(args)
    entry = (feed.get("apps") or {}).get(args.app) or {}
    previous = ((feed.get("previous") or {}).get(args.app) or {}).get("version")
    print(f"feed offers {args.app} {entry.get('version')} (previous {previous})")

    failures = []

    def check(label, got, want):
        print(f"{label}: served {got!r}; expected {want!r}")
        if got != want:
            failures.append(label)

    wanted = {
        "version": args.expect_version,
        "sha256": args.expect_sha,
        "bytes": int(args.expect_bytes) if args.expect_bytes else None,
        "tagline": args.expect_tagline,
        "description": args.expect_description,
        "type": args.expect_type,
        "holdURL": args.expect_hold_url,
        "holdSince": args.expect_hold_since,
    }
    for field, want in wanted.items():
        if want is not None:
            check(field, entry.get(field), want)

    if args.artifact:
        path = pathlib.Path(args.artifact)
        local_sha = hashlib.sha256(path.read_bytes()).hexdigest()
        check("local artifact sha256", local_sha, entry.get("sha256"))
        check("local artifact bytes", path.stat().st_size, entry.get("bytes"))
        if args.feed_url and entry.get("file"):
            url = urllib.parse.urljoin(args.feed_url, "artifacts/" + urllib.parse.quote(entry["file"], safe=""))
            served = hashlib.sha256()
            served_bytes = 0
            with urllib.request.urlopen(url, timeout=60) as response:
                while chunk := response.read(1 << 20):
                    served.update(chunk)
                    served_bytes += len(chunk)
            check("served artifact sha256", served.hexdigest(), local_sha)
            check("served artifact bytes", served_bytes, path.stat().st_size)

    if failures:
        print("ROW FAILED: " + ", ".join(failures))
        return 1
    print("ROW OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
