import XCTest
@testable import StorageHelper

final class RetryPolicyTests: XCTestCase {
    func testLadderIsFiveFifteenSixtyThenStop() {
        XCTAssertEqual(RetryPolicy.delay(afterFailure: 1), 5)
        XCTAssertEqual(RetryPolicy.delay(afterFailure: 2), 15)
        XCTAssertEqual(RetryPolicy.delay(afterFailure: 3), 60)
        // Extra retries keep the last step; the ladder never invents a shorter wait.
        XCTAssertEqual(RetryPolicy.delay(afterFailure: 4), 60)
        XCTAssertEqual(RetryPolicy.delay(afterFailure: 8), 60)
        XCTAssertNil(RetryPolicy.delay(afterFailure: 0))
    }

    func testRetryCountIsBounded() {
        XCTAssertEqual(RetryPolicy.retryCount(0), 1)
        XCTAssertEqual(RetryPolicy.retryCount(3), 3)
        XCTAssertEqual(RetryPolicy.retryCount(5), 5)
        XCTAssertEqual(RetryPolicy.retryCount(99), 8)
    }

    func testMountBudgetHasADefaultAndItsOwnCeiling() {
        XCTAssertEqual(MountBudget.seconds(nil), 90)
        XCTAssertEqual(MountBudget.seconds("soon"), 90)
        XCTAssertEqual(MountBudget.seconds("0"), 90)
        XCTAssertEqual(MountBudget.seconds("2.5"), 2.5)
        // A mounted wait is a gap, not a latch: a wild value ends within ten minutes.
        XCTAssertEqual(MountBudget.seconds("999999"), MountBudget.secondsMax)
        // The row's ceiling itself: 90 s to answer, ten minutes at the very most.
        XCTAssertEqual(MountBudget.secondsDefault, 90)
        XCTAssertEqual(MountBudget.secondsMax, 600)
        // One second is the floor, so a fixture can inject a short gap and never sleep a minute.
        XCTAssertEqual(MountBudget.seconds("1"), 1)
    }

    func testWakeDetectionUsesWallAndMonotonicClocks() {
        let before = SleepDetector.Sample(wall: 1_000, monotonic: 100)
        let after = SleepDetector.Sample(wall: 1_300, monotonic: 110)
        XCTAssertTrue(SleepDetector.didWake(from: before, to: after))
        let normal = SleepDetector.Sample(wall: 1_005, monotonic: 105)
        XCTAssertFalse(SleepDetector.didWake(from: before, to: normal))
    }
}

final class MountTableTests: XCTestCase {
    func testCanonicalSourceIgnoresUserAndTrailingSlash() {
        XCTAssertEqual(MountTable.canonicalSMB("smb://nas.local/photos"), "nas.local/photos")
        XCTAssertEqual(MountTable.canonicalSMB("//theng@nas.local/photos/"), "nas.local/photos")
        XCTAssertEqual(MountTable.canonicalSMB("//NAS.local/Photos"), "nas.local/photos")
        XCTAssertEqual(MountTable.canonicalSMB("//theng@nas.local/My%20Share"), "nas.local/my share")
        XCTAssertNil(MountTable.canonicalSMB("/dev/disk1s1"))
    }

    func testAlreadyMountedSMBIsFoundByShareNotByPath() {
        let table = [
            MountedVolume(source: "//theng@nas.local/photos", mountPoint: "/Volumes/photos-1", fsType: "smbfs"),
            MountedVolume(source: "/dev/disk3s5", mountPoint: "/System/Volumes/Data", fsType: "apfs"),
        ]
        let storage = Storage(id: "a", name: "Photos", kind: "smb", target: "smb://nas.local/photos")
        XCTAssertEqual(MountTable.mountedPath(for: storage, in: table), "/Volumes/photos-1")
    }

    func testOtherSharesDoNotCountAsMounted() {
        let table = [MountedVolume(source: "//nas.local/music", mountPoint: "/Volumes/music", fsType: "smbfs")]
        let storage = Storage(id: "a", name: "Photos", kind: "smb", target: "smb://nas.local/photos")
        XCTAssertNil(MountTable.mountedPath(for: storage, in: table))
    }

    func testAttachedDiskIsFoundByItsMountPoint() {
        let table = [MountedVolume(source: "/dev/disk11s1", mountPoint: "/Volumes/Archive", fsType: "apfs")]
        let storage = Storage(id: "b", name: "Archive", kind: "volume", target: "/dev/disk11s1", mountPoint: "/Volumes/Archive")
        XCTAssertEqual(MountTable.mountedPath(for: storage, in: table), "/Volumes/Archive")
    }
}

final class ShareListerTests: XCTestCase {
    func testRealSmbutilTable() {
        let output = """
        Share                                           Type    Comments
        -------------------------------                 ----    --------
        Public Space-Media - 4TB - Music                Disk    Public Space-Media - 4TB - Music
        Public Space-System pool                        Disk    Public Space-System pool
        IPC$                                            Pipe    IPC Service (Samba 4.17.12-Debian)
        Public Space-Media - 6TB - Movies               Disk    Public Space-Media - 6TB - Movies

        4 shares listed
        """
        XCTAssertEqual(
            ShareLister.parse(output),
            [
                "Public Space-Media - 4TB - Music",
                "Public Space-System pool",
                "Public Space-Media - 6TB - Movies",
            ]
        )
    }

    func testEmptyAndErrorsGiveNoShares() {
        XCTAssertEqual(ShareLister.parse(""), [])
        XCTAssertEqual(ShareLister.parse("smbutil: server rejected the authentication: Authentication error"), [])
    }

    func testTabSeparatedTableIsAccepted() {
        XCTAssertEqual(ShareLister.parse("Media\tDisk\tMedia share"), ["Media"])
    }

    func testTerminalLineEndingsAreAccepted() {
        XCTAssertEqual(ShareLister.parse("Media       Disk    A share\rSecond     Disk    B\r"), ["Media", "Second"])
        XCTAssertEqual(ShareLister.parse("Media       Disk    A share\r\nSecond      Disk    B share\r\n"), ["Media", "Second"])
    }
}

final class SMBMountsTests: XCTestCase {
    func testMountedSharesBecomeAddableCandidates() {
        let table = [
            MountedVolume(source: "//vengtheng@100.69.137.42/Public%20Space-Media%20-%206TB%20-%20TV%20Show",
                          mountPoint: "/Volumes/Public Space-Media - 6TB - TV Show", fsType: "smbfs"),
            MountedVolume(source: "/dev/disk3s5", mountPoint: "/System/Volumes/Data", fsType: "apfs"),
        ]
        let candidates = SMBMounts.candidates(from: table)
        XCTAssertEqual(candidates.count, 1)
        XCTAssertEqual(candidates[0].name, "Public Space-Media - 6TB - TV Show")
        XCTAssertEqual(candidates[0].host, "100.69.137.42")
        XCTAssertEqual(candidates[0].user, "vengtheng")
        XCTAssertEqual(candidates[0].url,
                       "smb://vengtheng@100.69.137.42/Public%20Space-Media%20-%206TB%20-%20TV%20Show")
    }

}

final class ProtocolTests: XCTestCase {
    func testConfigureCommandDecodesCamelCaseStorage() throws {
        let line = """
        {"type":"configure","retries":2,"storages":[{"id":"s1","name":"NAS","kind":"smb","target":"smb://nas.local/photos","mountPoint":"","volumeUUID":null,"reconnectAtLogin":true,"reconnectAfterWake":true,"username":"theng"}]}
        """
        let command = try JSONDecoder().decode(Command.self, from: Data(line.utf8))
        XCTAssertEqual(command.type, "configure")
        XCTAssertEqual(command.retries, 2)
        XCTAssertEqual(command.storages?.first?.target, "smb://nas.local/photos")
        XCTAssertEqual(command.storages?.first?.reconnectAtLogin, true)
    }

    func testStateEventIsOneJSONObjectWithCamelCaseKeys() throws {
        let state = StorageState(id: "s1", status: .needsAttention, detail: "Can't reach nas.local", mountedPath: nil, hasCredentials: true)
        let object = try JSONSerialization.jsonObject(with: Event.state([state], inFlight: ["s1"], queued: [], deferred: []).json) as? [String: Any]
        XCTAssertEqual(object?["type"] as? String, "state")
        let item = (object?["items"] as? [[String: Any]])?.first
        XCTAssertEqual(item?["status"] as? String, "needs_attention")
        XCTAssertEqual(item?["hasCredentials"] as? Bool, true)
        XCTAssertEqual(item?["detail"] as? String, "Can't reach nas.local")
        XCTAssertEqual(object?["inFlight"] as? [String], ["s1"])
        XCTAssertEqual(object?["queued"] as? [String], [])
        XCTAssertEqual(object?["deferred"] as? [String], [])
    }

    /// The update hold's two commands decode like every other helper command.
    func testHoldAndResumeCommandsDecode() throws {
        for type in ["hold", "resume"] {
            let command = try JSONDecoder().decode(Command.self, from: Data("{\"type\":\"\(type)\"}".utf8))
            XCTAssertEqual(command.type, type)
        }
    }

    /// Stop trying arrives like Mount now, with the storage it belongs to.
    func testCancelCommandDecodesWithItsStorage() throws {
        let command = try JSONDecoder().decode(Command.self, from: Data("{\"type\":\"cancel\",\"id\":\"s1\"}".utf8))
        XCTAssertEqual(command.type, "cancel")
        XCTAssertEqual(command.id, "s1")
    }
}

final class SecretsTests: XCTestCase {
    func testTheAccountKeyIsUserAtHostOrDefault() {
        XCTAssertEqual(Secrets.account(host: "nas.local", username: nil), "nas.local")
        XCTAssertEqual(Secrets.account(host: "nas.local", username: " "), "nas.local")
        XCTAssertEqual(Secrets.account(host: "nas.local", username: "studio"), "studio@nas.local")
    }

    /// A failed save must be able to say the number, so this read has to answer on a real disk.
    func testFreeSpaceIsMeasuredForTheDataVolume() {
        let free = Secrets.freeSpace()
        XCTAssertNotNil(free)
        XCTAssertGreaterThan(free ?? 0, 0)
    }

    /// A save that cannot land — a blocked folder stands in for a full disk — fails instead of
    /// pretending, and the free-space read still answers so the row can print the number.
    func testBlockedDataFolderFailsTheSaveAndStillMeasuresFreeSpace() throws {
        let temp = FileManager.default.temporaryDirectory.appendingPathComponent("storage-fixture-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: temp, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: temp) }
        // A file where the data folder must go: createDirectory cannot succeed, like a full disk.
        try Data("blocked".utf8).write(to: temp.appendingPathComponent("Library"))
        setenv("STORAGE_STUDIO_TEST_DATA_DIR", temp.path, 1)
        defer { unsetenv("STORAGE_STUDIO_TEST_DATA_DIR") }
        XCTAssertFalse(Secrets.save(host: "fixture.invalid", username: "user", password: "secret"))
        let free = Secrets.freeSpace()
        XCTAssertNotNil(free)
        XCTAssertGreaterThan(free ?? 0, 0)
    }
}

/// Reads the engine's JSON events in order so a test waits for one instead of sleeping blind.
private final class EngineRecorder {
    private let lock = NSLock()
    private var events: [[String: Any]] = []

    func emit(_ data: Data) {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        lock.lock()
        events.append(object)
        lock.unlock()
    }

    var all: [[String: Any]] {
        lock.lock()
        defer { lock.unlock() }
        return events
    }
}

private func stateEvents(_ events: [[String: Any]]) -> [[String: Any]] {
    events.filter { $0["type"] as? String == "state" }
}

private func item(in event: [String: Any], id: String) -> [String: Any]? {
    ((event["items"] as? [[String: Any]]) ?? []).first { $0["id"] as? String == id }
}

private func latestItem(_ events: [[String: Any]], id: String) -> [String: Any]? {
    for event in stateEvents(events).reversed() {
        if let found = item(in: event, id: id) { return found }
    }
    return nil
}

private let stoppedDetail = "Stopped trying. Mount now starts again."

/// States a cancelled row must never show again once it has said "Stopped trying".
private let forbiddenAfterStop: Set<String> = ["mounting", "retrying", "unreachable", "needs_attention"]

private func strayedAfterStop(_ events: [[String: Any]], from index: Int, id: String) -> Bool {
    stateEvents(Array(events[index...])).contains { event in
        guard let status = item(in: event, id: id)?["status"] as? String else { return false }
        return forbiddenAfterStop.contains(status)
    }
}

extension XCTestCase {
    /// The helper answers on its own queues; poll for the event instead of guessing a sleep.
    @discardableResult
    func wait(timeout: TimeInterval = 5, file: StaticString = #filePath, line: UInt = #line,
              until condition: () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            Thread.sleep(forTimeInterval: 0.02)
        }
        XCTFail("no expected helper event within \(timeout)s", file: file, line: line)
        return false
    }
}

/// b40c816's Stop trying and password-save row, driven straight at the engine. The fixture
/// only reads the mount table and runs diskutil: no share is reached, nothing is mounted,
/// and no path under /Volumes is ever looked at. No start(), so no ticker and no network watch.
final class EngineTests: XCTestCase {
    private func command(_ type: String, id: String? = nil, retries: Int? = nil,
                         storages: [Storage]? = nil, username: String? = nil,
                         password: String? = nil, host: String? = nil) -> Command {
        Command(type: type, id: id, retries: retries, storages: storages,
                username: username, password: password, host: host)
    }

    /// Stop trying drops the retry that is waiting to run; nothing attempts the share afterwards.
    func testCancelDropsAWaitingRetrySoNoAttemptFollows() {
        setenv("STORAGE_STUDIO_RETRY_DELAYS", "1.5", 1)
        defer { unsetenv("STORAGE_STUDIO_RETRY_DELAYS") }
        let recorder = EngineRecorder()
        let engine = Engine(emit: recorder.emit)
        defer { engine.stop() }
        // A target without a host fails the address check: zero network, zero mount.
        let storage = Storage(id: "s1", name: "Fixture", kind: "smb", target: "not-a-share")
        engine.handle(command("configure", retries: 3, storages: [storage]))
        engine.handle(command("mount", id: storage.id))
        guard wait(until: { latestItem(recorder.all, id: "s1")?["status"] as? String == "retrying" }) else { return }
        // A Test's verdict is not work, but a waiting retry is: Snapshot.queued still names it.
        engine.handle(command("test", id: storage.id))
        guard wait(until: { latestItem(recorder.all, id: "s1")?["status"] as? String == "unreachable" }) else { return }
        let verdict = stateEvents(recorder.all).last { item(in: $0, id: "s1")?["status"] as? String == "unreachable" }
        XCTAssertTrue(((verdict?["queued"] as? [String]) ?? []).contains("s1"))
        engine.handle(command("cancel", id: storage.id))
        guard wait(until: { latestItem(recorder.all, id: "s1")?["detail"] as? String == stoppedDetail }) else { return }
        let all = recorder.all
        guard let stoppedIndex = all.lastIndex(where: {
            ($0["type"] as? String) == "state" && item(in: $0, id: "s1")?["detail"] as? String == stoppedDetail
        }) else { XCTFail("the Stop trying state event is missing"); return }
        // The drop is visible in the same snapshot: no queue name left for the row.
        XCTAssertFalse(((all[stoppedIndex]["queued"] as? [String]) ?? []).contains("s1"))
        Thread.sleep(forTimeInterval: 2.5) // past the injected 1.5 s retry the failure queued
        let after = recorder.all
        XCTAssertFalse(strayedAfterStop(after, from: stoppedIndex, id: "s1"),
                       "the cancelled retry came back: \(String(describing: latestItem(after, id: "s1")))")
        XCTAssertEqual(latestItem(after, id: "s1")?["status"] as? String, "not_mounted")
        XCTAssertEqual(latestItem(after, id: "s1")?["detail"] as? String, stoppedDetail)
    }

    /// Stop trying during a real attempt: the row stops, the engine stops claiming the attempt,
    /// and the answer that arrives afterwards changes nothing.
    func testCancelStopsBelievingARunningAttempt() {
        setenv("STORAGE_STUDIO_RETRY_DELAYS", "1.5", 1)
        defer { unsetenv("STORAGE_STUDIO_RETRY_DELAYS") }
        let recorder = EngineRecorder()
        let engine = Engine(emit: recorder.emit)
        defer { engine.stop() }
        // A disk identity that does not exist: the diskutil lookup is the attempt, so the row
        // goes in flight without a share, a mount, or any /Volumes path in the picture.
        let storage = Storage(id: "s2", name: "Fixture", kind: "volume", target: "fixture-disk",
                              volumeUUID: "fixture-uuid-not-a-disk")
        engine.handle(command("configure", retries: 3, storages: [storage]))
        engine.handle(command("mount", id: storage.id))
        guard wait(until: {
            stateEvents(recorder.all).contains { (($0["inFlight"] as? [String]) ?? []).contains("s2") }
        }) else { return }
        engine.handle(command("cancel", id: storage.id))
        guard wait(until: { latestItem(recorder.all, id: "s2")?["detail"] as? String == stoppedDetail }) else { return }
        let all = recorder.all
        guard let stoppedIndex = all.lastIndex(where: {
            ($0["type"] as? String) == "state" && item(in: $0, id: "s2")?["detail"] as? String == stoppedDetail
        }) else { XCTFail("the Stop trying state event is missing"); return }
        // The stop itself clears both beliefs the row held about the attempt.
        XCTAssertFalse(((all[stoppedIndex]["inFlight"] as? [String]) ?? []).contains("s2"))
        XCTAssertFalse(((all[stoppedIndex]["queued"] as? [String]) ?? []).contains("s2"))
        Thread.sleep(forTimeInterval: 2.5) // room for the attempt's late answer and any retry
        let after = recorder.all
        XCTAssertFalse(strayedAfterStop(after, from: stoppedIndex, id: "s2"),
                       "the stopped attempt's answer came back: \(String(describing: latestItem(after, id: "s2")))")
        XCTAssertEqual(latestItem(after, id: "s2")?["detail"] as? String, stoppedDetail)
    }

    /// A password save that fails leaves the row saying it, with the free space really measured.
    func testFailedPasswordSaveReachesTheRowWithMeasuredFreeSpace() throws {
        guard let entry = MountTable.current().first(where: {
            $0.fsType == "apfs" && !$0.mountPoint.hasPrefix("/Volumes/")
        }), let uuid = Volumes.volumeUUID(at: entry.mountPoint), !uuid.isEmpty else {
            throw XCTSkip("No mounted APFS volume outside /Volumes to hang the row on.")
        }
        let recorder = EngineRecorder()
        let engine = Engine(emit: recorder.emit)
        defer { engine.stop() }
        // Already mounted, so Mount now stops at the table lookup: no attempt, no network.
        let storage = Storage(id: "e1", name: "Fixture", kind: "volume", target: "fixture-disk",
                              mountPoint: entry.mountPoint, volumeUUID: uuid)
        engine.handle(command("configure", retries: 3, storages: [storage]))
        // The target names no host, so the save cannot land — the same branch a full disk takes.
        engine.handle(command("credentials", id: storage.id, username: "user", password: "secret"))
        guard wait(until: {
            ((latestItem(recorder.all, id: "e1")?["detail"]) as? String)?.contains("password wasn't saved") == true
        }) else { return }
        let row = latestItem(recorder.all, id: "e1")
        XCTAssertEqual(row?["status"] as? String, "mounted")
        let prefix = "The password wasn't saved, so it will be asked for again. The startup disk has "
        let suffix = " free."
        let detail = row?["detail"] as? String ?? ""
        XCTAssertTrue(detail.hasPrefix(prefix), detail)
        XCTAssertTrue(detail.hasSuffix(suffix), detail)
        // The number tracks the disk, not a constant: free space moves a little between reads.
        let mine = ByteCountFormatter.string(fromByteCount: try XCTUnwrap(Secrets.freeSpace()),
                                             countStyle: .file).split(separator: " ")
        let shown = String(detail.dropFirst(prefix.count).dropLast(suffix.count)).split(separator: " ")
        guard shown.count == 2, mine.count == 2, shown[1] == mine[1],
              let shownValue = Double(shown[0]), let mineValue = Double(mine[0]) else {
            return XCTFail("the row's free space is not the disk's reading: \(detail) vs \(mine)")
        }
        XCTAssertLessThan(abs(shownValue - mineValue), 0.5, "\(detail) vs \(mine)")
    }

    /// The heart of 0.1.12: an attempt that never answers ends its row at the budget and stays
    /// ended. A watched slow mount stands in for a half-open share; no NetFS call is made.
    func testAnAttemptPastItsBudgetEndsTheRowAndIgnoresItsLateAnswer() {
        setenv("STORAGE_STUDIO_MOUNT_BUDGET_S", "1", 1)
        defer { unsetenv("STORAGE_STUDIO_MOUNT_BUDGET_S") }
        let recorder = EngineRecorder()
        let engine = Engine(emit: recorder.emit)
        defer { engine.stop() }
        engine.mountAttempt = { _ in
            Thread.sleep(forTimeInterval: 2.0) // a share that accepts the call and never answers
            return MountFailure(message: "late failure")
        }
        let storage = Storage(id: "c1", name: "Fixture", kind: "smb", target: "not-a-share")
        engine.handle(command("configure", retries: 3, storages: [storage]))
        engine.handle(command("mount", id: storage.id))
        guard wait(until: { latestItem(recorder.all, id: "c1")?["status"] as? String == "mounting" }) else { return }
        // The wedged attempt runs off the command queue: another command answers at once.
        let beforeRefresh = recorder.all.count
        engine.handle(command("refresh"))
        XCTAssertTrue(wait(timeout: 0.6, until: { recorder.all.count > beforeRefresh }),
                      "a mount that never answers blocked the command queue")
        guard wait(until: {
            ((latestItem(recorder.all, id: "c1")?["detail"]) as? String)?.contains("didn't answer within 1 s") == true
        }) else { return }
        let expiredIndex = stateEvents(recorder.all).lastIndex {
            ((item(in: $0, id: "c1")?["detail"]) as? String)?.contains("didn't answer within 1 s") == true
        } ?? 0
        let expired = latestItem(recorder.all, id: "c1")
        XCTAssertEqual(expired?["status"] as? String, "needs_attention")
        XCTAssertTrue(((expired?["detail"] as? String) ?? "").hasSuffix("Mount now starts again."))
        // Terminal: the row holds no work, and nothing retries on its own.
        let snapshot = stateEvents(Array(recorder.all[expiredIndex...])).last { item(in: $0, id: "c1") != nil }
        XCTAssertFalse(((snapshot?["inFlight"] as? [String]) ?? []).contains("c1"))
        XCTAssertFalse(((snapshot?["queued"] as? [String]) ?? []).contains("c1"))
        // The late failure arrives past the budget and changes nothing, and is not reported twice.
        Thread.sleep(forTimeInterval: 1.5)
        let after = recorder.all
        XCTAssertEqual(latestItem(after, id: "c1")?["status"] as? String, "needs_attention")
        XCTAssertEqual(after.filter { ($0["type"] as? String) == "attention" }.count, 1)
    }

    /// A Browse is a device call with its own ceiling. It runs off the command queue, so a slow
    /// server cannot stop the ticker, a Stop trying or a hold; its answer still comes, once.
    func testASlowShareListDoesNotBlockTheEngine() {
        let recorder = EngineRecorder()
        let engine = Engine(emit: recorder.emit)
        defer { engine.stop() }
        let release = DispatchSemaphore(value: 0)
        let listed = expectation(description: "the listing started")
        engine.listShares = { _, _ in
            listed.fulfill()
            _ = release.wait(timeout: .now() + 10)
            return ShareLister.Result(shares: ["photos"])
        }
        engine.handle(command("list_shares", host: "slow.example"))
        wait(for: [listed], timeout: 2)
        let before = recorder.all.count
        engine.handle(command("refresh"))
        XCTAssertTrue(wait(timeout: 0.6, until: { recorder.all.count > before }),
                      "a listing that never answers blocked the command queue")
        XCTAssertFalse(recorder.all.contains { $0["type"] as? String == "shares" })
        release.signal()
        guard wait(until: { recorder.all.contains { $0["type"] as? String == "shares" } }) else { return }
        let answers = recorder.all.filter { $0["type"] as? String == "shares" }
        XCTAssertEqual(answers.count, 1)
        XCTAssertEqual(answers.last?["host"] as? String, "slow.example")
        XCTAssertEqual(answers.last?["shares"] as? [String], ["photos"])
    }

    /// A wedged unmount holds `umount` for 30 s and `diskutil` for another 30. Both run off the
    /// command queue, and the row moves only when the drive has actually been let go.
    func testASlowUnmountDoesNotBlockTheEngine() throws {
        guard let entry = MountTable.current().first(where: {
            $0.fsType == "apfs" && !$0.mountPoint.hasPrefix("/Volumes/")
        }) else {
            throw XCTSkip("No mounted APFS volume outside /Volumes to hang the row on.")
        }
        let recorder = EngineRecorder()
        let engine = Engine(emit: recorder.emit)
        defer { engine.stop() }
        let release = DispatchSemaphore(value: 0)
        let started = expectation(description: "the unmount started")
        // Injected, so no umount or diskutil call ever runs against the fixture volume.
        engine.unmountAttempt = { _ in
            started.fulfill()
            _ = release.wait(timeout: .now() + 10)
            return Shell.Result(status: 0, output: Data(), error: "")
        }
        let storage = Storage(id: "u1", name: "Fixture", kind: "volume", target: "fixture-disk",
                              mountPoint: entry.mountPoint)
        engine.handle(command("configure", retries: 3, storages: [storage]))
        engine.handle(command("unmount", id: storage.id))
        wait(for: [started], timeout: 2)
        let before = recorder.all.count
        engine.handle(command("refresh"))
        XCTAssertTrue(wait(timeout: 0.6, until: { recorder.all.count > before }),
                      "an unmount that never answers blocked the command queue")
        XCTAssertEqual(latestItem(recorder.all, id: "u1")?["status"] as? String, "mounted")
        release.signal()
        guard wait(until: { latestItem(recorder.all, id: "u1")?["status"] as? String == "not_mounted" }) else { return }
        XCTAssertEqual(latestItem(recorder.all, id: "u1")?["detail"] as? String, "Disconnected just now.")
    }
}
