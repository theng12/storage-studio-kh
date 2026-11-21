#!/usr/bin/env python3
"""Every address format a person may paste saves and mounts the share it names.

    python3 -I tests/mount-check.py <helper-binary> <work-dir>

Drives the real helper against the owner's NAS (guest), each format to its own temp mount
folder under $TMPDIR — never /Volumes, never the Finder, no window. Each storage is unmounted
before the next so one successful mount cannot make the following ones look right.

The NAS checks skip cleanly (SKIP, not FAIL) when this Mac cannot reach it.
"""
import json
import os
import subprocess
import sys
import time

HELPER = sys.argv[1]
WORK = sys.argv[2]
DATA = os.path.join(WORK, "home")
NAS = "100.69.137.42"
SHARE = "Public Space-Media - 6TB - TV Show"
ENCODED = "Public%20Space-Media%20-%206TB%20-%20TV%20Show"

# One storage per real share, each named for the way a person reached it. The UI normalises
# every one of these input shapes to the same canonical target the helper is given here
# (proved in tests/web.test.mjs); this check proves that target mounts the share it names.
TARGETS = {
    "bare-ip": "smb://%s/Public%%20Space-System%%20pool" % NAS,
    "double-slash": "smb://%s/Public%%20Space-Media%%20-%%206TB%%20-%%20TV%%20Show" % NAS,
    "picked-from-list": "smb://%s/Public%%20Space-Media%%20-%%206TB%%20-%%20Movies" % NAS,
}

failures = []
skipped = []


def ok(message):
    print("PASS  " + message)


def fail(message):
    print("FAIL  " + message)
    failures.append(message)


def skip(message):
    print("SKIP  " + message)
    skipped.append(message)


def start_helper():
    environment = dict(os.environ)
    environment["HOME"] = DATA
    environment["STORAGE_STUDIO_TEST_DATA_DIR"] = DATA
    environment["STORAGE_STUDIO_NO_NOTIFICATIONS"] = "1"
    environment["STORAGE_STUDIO_NO_LOGIN_ITEM"] = "1"
    os.makedirs(os.path.join(DATA, "Library", "Application Support", "Storage Studio KH"), exist_ok=True)
    log = open(os.path.join(WORK, "helper.log"), "w", encoding="utf-8")
    process = subprocess.Popen(
        [HELPER], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log,
        env=environment, universal_newlines=True, bufsize=1,
    )
    return process, log


def send(process, message):
    process.stdin.write(json.dumps(message) + "\n")
    process.stdin.flush()


def configure(process, ids):
    storages = []
    for ident in ids:
        storages.append({
            "id": ident,
            "name": ident,
            "kind": "smb",
            "target": TARGETS[ident],
            "mountPoint": "",
            "volumeUUID": None,
            "reconnectAtLogin": False,
            "reconnectAfterWake": False,
            "username": None,
        })
    send(process, {"type": "configure", "retries": 1, "storages": storages, "archives": []})


def wait_state(process, ident, wanted, timeout):
    """Reads until this storage reports one of `wanted`; returns (state, seconds)."""
    started = time.time()
    deadline = started + timeout
    while time.time() < deadline:
        line = process.stdout.readline()
        if not line:
            if process.poll() is not None:
                return None, time.time() - started
            continue
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if event.get("type") != "state":
            continue
        for state in event.get("items") or []:
            if state.get("id") == ident and state.get("status") in wanted:
                return state, time.time() - started
    return None, time.time() - started


def mount_and_check(process, ident):
    send(process, {"type": "mount", "id": ident})
    state, seconds = wait_state(process, ident, {"mounted", "needs_attention", "unreachable"}, 40)
    if state is None:
        fail("%s: no answer within 40 s" % ident)
        return False
    if state.get("status") != "mounted":
        detail = state.get("detail") or ""
        if "unreachable" in state.get("status", "") or "didn't answer" in detail:
            skip("%s: the NAS cannot be reached from this Mac (%s)" % (ident, detail))
            return False
        fail("%s: %s (%s)" % (ident, state.get("status"), detail))
        return False
    mount_point = state.get("mountedPath") or ""
    entries = os.listdir(mount_point) if mount_point and os.path.isdir(mount_point) else []
    if not entries:
        fail("%s: mounted but the folder is empty" % ident)
        return False
    ok("%s mounts the share it names (%.1f s, %d entries at %s)" % (ident, seconds, len(entries), mount_point))
    send(process, {"type": "unmount", "id": ident})
    wait_state(process, ident, {"not_mounted", "needs_attention", "unmounted"}, 20)
    if mount_point and os.path.ismount(mount_point):
        fail("%s: still mounted after unmount" % ident)
        return False
    return True


def main():
    process, log = start_helper()
    ids = list(TARGETS)
    try:
        time.sleep(0.5)
        process.stdout.readline()
        configure(process, ids)
        mounted_any = False
        for ident in ids:
            mounted_any = mount_and_check(process, ident) or mounted_any
        if not mounted_any and not failures:
            skip("no format could be mounted because the NAS was not reachable")
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()

    if failures:
        print("\n%d check(s) failed" % len(failures))
        return 1
    print("\nAll mount checks passed%s" % (" (%d skipped)" % len(skipped) if skipped else ""))
    return 0


sys.exit(main())
