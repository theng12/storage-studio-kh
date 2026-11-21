#!/usr/bin/env python3
"""Channel archive / restore, proven against the real helper binary.

Drives the shipped helper over its own stdin/stdout protocol with a temporary HOME:
copy every file and check it on the destination, kill it mid-archive and resume from the
journal on the destination, then restore into a folder that already holds a channel and
prove nothing is merged or overwritten. No share, no window, no desktop, no network.

    python3 -I tests/archive.py <helper-binary> <work-dir>

Prints one PASS line per check; any failure prints FAIL and exits 1.
"""
import hashlib
import json
import os
import shutil
import signal
import subprocess
import sys
import time
import uuid

HELPER = sys.argv[1]
WORK = sys.argv[2]
DATA = os.path.join(WORK, "home")
APP_SUPPORT = os.path.join(DATA, "Library", "Application Support", "Storage Studio KH")
CHANNEL = os.path.join(WORK, "channel")
DESTINATION = os.path.join(WORK, "Channel Archives")
JOBS = os.path.join(APP_SUPPORT, "jobs")

failures = []


def ok(message):
    print("PASS  " + message)


def fail(message):
    print("FAIL  " + message)
    failures.append(message)


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        while True:
            chunk = stream.read(1 << 20)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as stream:
        stream.write(text)


def write_bytes(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as stream:
        stream.write(data)


META = json.dumps({"name": "Night Atlas", "slug": "night-atlas", "project_id": "p-1"})


def make_channel(folder, files):
    write(os.path.join(folder, "project.json"), META)
    for relative, payload in files.items():
        write_bytes(os.path.join(folder, relative), payload)


def start_helper(log_path):
    environment = dict(os.environ)
    environment["HOME"] = DATA
    environment["STORAGE_STUDIO_TEST_DATA_DIR"] = DATA
    environment["STORAGE_STUDIO_NO_NOTIFICATIONS"] = "1"
    environment["STORAGE_STUDIO_NO_LOGIN_ITEM"] = "1"
    log = open(log_path, "w", encoding="utf-8")
    process = subprocess.Popen(
        [HELPER], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log,
        env=environment, universal_newlines=True, bufsize=1,
    )
    return process, log


def send(process, message):
    process.stdin.write(json.dumps(message) + "\n")
    process.stdin.flush()


def configure(process, destination, channel=None):
    send(process, {
        "type": "configure",
        "retries": 3,
        "storages": [],
        "archives": [{
            "id": "a1",
            "name": "Night Atlas",
            "slug": "night-atlas",
            "roots": [channel or CHANNEL],
            "destination": destination,
        }],
    })


def wait_for(process, predicate, timeout, what, events):
    """Reads events until predicate(event) is true. Bounded by its own ceiling."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        line = process.stdout.readline()
        if not line:
            if process.poll() is not None:
                fail("the helper exited while waiting for " + what)
                return None
            continue
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except ValueError:
            continue
        events.append(event)
        if predicate(event):
            return event
    fail("no " + what + " within %d s; last events: %s" % (timeout, events[-3:]))
    return None


def is_job(state):
    def check(event):
        return event.get("type") == "archive" and event.get("job", {}).get("state") == state
    return check


def archive_dir(destination):
    channel_dir = os.path.join(destination, "night-atlas")
    runs = sorted(os.listdir(channel_dir))
    return os.path.join(channel_dir, runs[-1]) if runs else None


def check_bytes(destination, channel):
    """Every manifest file exists on the destination with the source's bytes."""
    directory = archive_dir(destination)
    if not directory:
        fail("no archive folder was created")
        return
    manifest_path = os.path.join(directory, "manifest.json")
    if not os.path.isfile(manifest_path):
        fail("manifest.json is missing from " + directory)
        return
    with open(manifest_path, "r", encoding="utf-8") as stream:
        manifest = json.load(stream)
    if manifest.get("state") != "verified":
        fail("the manifest does not say verified: %r" % manifest.get("state"))
    label = manifest["roots"][0]["label"]
    for item in manifest["files"]:
        source = os.path.join(channel, item["path"])
        copied = os.path.join(directory, "roots", "01-" + label, item["path"])
        if not os.path.isfile(copied):
            fail("missing on the destination: " + item["path"])
            continue
        if sha256(copied) != item["sha256"] or sha256(source) != item["sha256"]:
            fail("bytes differ for " + item["path"])
    ok("%d files are on the destination byte for byte; manifest says verified" % len(manifest["files"]))
    if os.path.exists(os.path.join(directory, "manifest.partial.jsonl")):
        fail("the resume journal was left behind after a finished archive")


def check_manifest_totals(destination, files, size):
    directory = archive_dir(destination)
    with open(os.path.join(directory, "manifest.json"), "r", encoding="utf-8") as stream:
        manifest = json.load(stream)
    if manifest["totals"]["files"] != files or manifest["totals"]["bytes"] != size:
        fail("manifest totals are %r, expected %d files / %d bytes" % (manifest["totals"], files, size))
        return
    ok("manifest totals name %d files, %d bytes" % (files, size))


def main():
    for folder in (WORK, DATA, APP_SUPPORT, CHANNEL, DESTINATION):
        os.makedirs(folder, exist_ok=True)

    # A channel: a project.json, a text file, a 2 MB binary and a nested file.
    big = bytes((index * 7 + 13) % 256 for index in range(2 * 1024 * 1024))
    small = {"episodes/EP1/script.txt": b"alpha", "assets/big.bin": big, "music/bed.txt": b"beta"}
    make_channel(CHANNEL, small)
    total_bytes = sum(len(value) for value in small.values())

    # 1. A complete archive.
    process, log = start_helper(os.path.join(WORK, "helper-1.log"))
    try:
        configure(process, DESTINATION)
        events = []
        send(process, {"type": "archive_start", "id": "a1"})
        event = wait_for(process, is_job("archived"), 120, "an archived job", events)
        expected_files = len(small) + 1
        expected_bytes = total_bytes + len(META)
        if event:
            job = event["job"]
            if job.get("filesTotal") != expected_files:
                fail("the job counted %r files, expected %d" % (job.get("filesTotal"), expected_files))
            ok("archive reported archived for %d files" % expected_files)
        check_bytes(DESTINATION, CHANNEL)
        check_manifest_totals(DESTINATION, expected_files, expected_bytes)
        if os.listdir(JOBS):
            fail("a finished archive left a job record behind: %s" % os.listdir(JOBS))
        else:
            ok("no job record is left after a finished archive")
    finally:
        process.kill()
        process.wait()
        log.close()

    # 2. Interrupt it (an update hold stops it at a file boundary), kill the helper, restart,
    #    and resume from the journal the first run left on the destination.
    second = os.path.join(WORK, "big-channel")
    files = {}
    # Big enough that the hold lands after the first checked file and well before the last.
    for index in range(12):
        files["episodes/EP%02d/part.bin" % index] = bytes([index]) * (16 * 1024 * 1024)
    for relative, payload in files.items():
        write_bytes(os.path.join(second, relative), payload)
    make_channel(second, {})
    resumed_destination = os.path.join(WORK, "Channel Archives 2")
    os.makedirs(resumed_destination, exist_ok=True)

    process, log = start_helper(os.path.join(WORK, "helper-2.log"))
    try:
        configure(process, resumed_destination, channel=second)
        send(process, {"type": "archive_start", "id": "a1"})
        events = []
        # Let the first file land, then ask for the update hold: it must stop at the next boundary.
        wait_for(
            process,
            lambda item: item.get("type") == "archive" and item.get("job", {}).get("filesDone", 0) >= 1,
            120, "a first checked file", events,
        )
        send(process, {"type": "hold", "ceiling": 20})
        event = wait_for(process, is_job("paused"), 120, "a paused job", events)
        if not event:
            return finish()
        if event["job"].get("filesDone", 0) < 1:
            fail("the pause landed before a single file was checked")
        else:
            ok("the hold stopped the copy at a file boundary after %d checked files" % event["job"]["filesDone"])
        directory = archive_dir(resumed_destination)
        journal = os.path.join(directory, "manifest.partial.jsonl")
        if not os.path.isfile(journal):
            fail("the destination journal was not written")
        elif not open(journal, "r", encoding="utf-8").read().strip():
            fail("the destination journal is empty")
        else:
            ok("the journal on the destination holds the checked files")
        if not os.path.isfile(os.path.join(JOBS, "archive-a1.json")):
            fail("no job record was written for an unfinished archive")
        else:
            ok("the job record survives for the next start")
    finally:
        process.send_signal(signal.SIGKILL)
        process.wait()
        log.close()
    ok("killed mid-archive; the destination and the job record are the only state")

    process, log = start_helper(os.path.join(WORK, "helper-3.log"))
    try:
        configure(process, resumed_destination, channel=second)
        send(process, {"type": "archive_start", "id": "a1"})
        events = []
        event = wait_for(process, is_job("archived"), 180, "the resumed archive", events)
        expected_files = len(files) + 1
        expected = sum(len(value) for value in files.values()) + len(META)
        if event:
            ok("resume finished the interrupted archive")
            # The counters describe this run, not the interrupted one: re-checked files are
            # counted once, so a resumed run cannot report more files than it has.
            if event["job"].get("filesDone") != expected_files:
                fail("the resumed job counted %r checked files, expected %d"
                     % (event["job"].get("filesDone"), expected_files))
        check_bytes(resumed_destination, second)
        check_manifest_totals(resumed_destination, expected_files, expected)
        if os.listdir(JOBS):
            fail("the resumed archive left its job record behind: %s" % os.listdir(JOBS))
    finally:
        process.kill()
        process.wait()
        log.close()

    # 3. Discovery: a Mac that has never seen this channel finds it by its manifest.
    process, log = start_helper(os.path.join(WORK, "helper-4.log"))
    try:
        configure(process, resumed_destination)
        events = []
        send(process, {"type": "restore_scan", "root": resumed_destination})
        event = wait_for(process, lambda item: item.get("type") == "restorable", 60, "a discovery answer", events)
        if not event:
            return finish()
        items = event.get("items") or []
        if len(items) != 1 or items[0].get("slug") != "night-atlas":
            fail("discovery found %r" % items)
        else:
            ok("discovery found the channel from its manifest alone")
        archive_path = items[0]["path"]

        # 4. Restore twice: the second copy must not merge into the first.
        target = os.path.join(WORK, "Restored")
        os.makedirs(target, exist_ok=True)
        send(process, {"type": "restore_start", "archivePath": archive_path, "destination": target})
        wait_for(process, is_job("restored"), 180, "a restored job", events)
        restored = os.path.join(target, "big-channel")
        if not os.path.isfile(os.path.join(restored, "episodes/EP00/part.bin")):
            fail("the restored folder is missing a file")
        elif sha256(os.path.join(restored, "episodes/EP00/part.bin")) != sha256(
                os.path.join(second, "episodes/EP00/part.bin")):
            fail("the restored bytes differ")
        else:
            ok("restore produced the channel with the same bytes")

        send(process, {"type": "restore_start", "archivePath": archive_path, "destination": target})
        wait_for(process, is_job("restored"), 180, "a second restored job", events)
        names = sorted(os.listdir(target))
        if "big-channel" not in names or not any(name.startswith("big-channel (archived ") for name in names):
            fail("a second restore merged or replaced instead of taking a dated name: %r" % names)
        else:
            ok("a second restore took a dated name instead of merging")
        if any(name.startswith(".restoring-") for name in names):
            fail("the staging folder was left behind")
        else:
            ok("no staging folder is left behind")
    finally:
        process.kill()
        process.wait()
        log.close()

    # 5. A folder with no manifest is refused plainly and nothing is copied.
    process, log = start_helper(os.path.join(WORK, "helper-5.log"))
    try:
        configure(process, resumed_destination)
        events = []
        plain = os.path.join(WORK, "plain-copy")
        os.makedirs(plain, exist_ok=True)
        target = os.path.join(WORK, "Plain Target")
        os.makedirs(target, exist_ok=True)
        send(process, {"type": "restore_start", "archivePath": plain, "destination": target})
        event = wait_for(process, is_job("failed"), 60, "a refused restore", events)
        if event:
            detail = (event["job"].get("detail") or "")
            if "no manifest" not in detail:
                fail("the refusal does not say the manifest is missing: %r" % detail)
            else:
                ok("a folder with no manifest is refused, and it says why")
        if os.listdir(target):
            fail("a refused restore copied something: %r" % os.listdir(target))
    finally:
        process.kill()
        process.wait()
        log.close()

    return finish()


def finish():
    if failures:
        print("\n%d check(s) failed" % len(failures))
        return 1
    print("\nAll archive checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
