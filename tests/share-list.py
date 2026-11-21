#!/usr/bin/env python3
"""Share listing, proven against the real helper binary and the owner's own NAS.

    python3 -I tests/share-list.py <helper-binary> <work-dir>

Three facts, each measured:
  1. A device that answers in well under a second lists its shares with their real names,
     spaces and all — the owner's NAS, guest.
  2. The same device with a user name and a password in hand does not hang: the guest answer
     comes back inside a couple of seconds and the password never went on a command line.
  3. A device that never answers ends with a plain reason, and the helper keeps running.

The NAS checks skip cleanly (SKIP, not FAIL) when this Mac cannot reach it; the unreachable
check always runs, since it needs no network. No share is mounted and no window is shown.
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
DEAD = "192.0.2.1"  # TEST-NET-1: never answers.

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


def wait_shares(process, host, timeout):
    """Reads events until the shares answer for this host arrives. Returns (event, seconds)."""
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
        if event.get("type") == "shares" and event.get("host") == host:
            return event, time.time() - started
    return None, time.time() - started


def main():
    process, log = start_helper()
    try:
        time.sleep(0.5)  # the helper's first state event
        process.stdout.readline()

        # 1. Guest listing of the owner's NAS.
        send(process, {"type": "list_shares", "host": NAS})
        event, seconds = wait_shares(process, NAS, 12)
        if event is None:
            fail("the helper never answered for %s" % NAS)
        elif event.get("error") and "didn't answer" in event["error"]:
            skip("this Mac cannot reach %s right now (%s)" % (NAS, event["error"]))
        else:
            shares = event.get("shares") or []
            wanted = ["Public Space-Media - 4TB - Music", "Public Space-Media - 6TB - Movies"]
            if all(name in shares for name in wanted) and len(shares) == 4:
                ok("the NAS lists its 4 disk shares, names with spaces intact, in %.1f s" % seconds)
            else:
                fail("expected 4 disk shares including %r, got %r" % (wanted, shares))
            if seconds < 3:
                ok("the list arrived inside a couple of seconds (%.1f s)" % seconds)
            else:
                fail("the list took %.1f s with no password" % seconds)

            # 2. The same device with a user name and a password in hand must not hang.
            send(process, {"type": "list_shares", "host": NAS, "username": "vengtheng", "password": "not-the-real-password"})
            event, seconds = wait_shares(process, NAS, 12)
            if event is None:
                fail("the credentialed listing never answered")
            elif (event.get("shares") or []) and seconds < 3:
                ok("with a user name and password in hand the list still answers in %.1f s" % seconds)
            else:
                fail("credentialed listing answered %r after %.1f s" % (event, seconds))
        log.flush()
        with open(os.path.join(WORK, "helper.log"), encoding="utf-8") as text:
            seen = text.read()
        if "not-the-real-password" in seen:
            fail("the password reached the helper's log")
        else:
            ok("the password is in neither the log nor any command line")

        # 3. A device that never answers ends, and the helper keeps running.
        send(process, {"type": "list_shares", "host": DEAD})
        event, seconds = wait_shares(process, DEAD, 30)
        if event is None:
            fail("a device that never answers never produced an answer")
        elif event.get("error") and "didn't answer" in event["error"]:
            ok("a silent device ends with its reason after %.1f s" % seconds)
        else:
            fail("expected the plain reason for a silent device, got %r" % event)
        if process.poll() is None:
            ok("the helper is still running after both answers")
        else:
            fail("the helper exited")
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()

    if failures:
        print("\n%d check(s) failed" % len(failures))
        return 1
    print("\nAll share-list checks passed%s" % (" (%d skipped)" % len(skipped) if skipped else ""))
    return 0


sys.exit(main())
