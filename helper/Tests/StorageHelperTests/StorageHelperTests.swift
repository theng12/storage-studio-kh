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
        let object = try JSONSerialization.jsonObject(with: Event.state([state]).json) as? [String: Any]
        XCTAssertEqual(object?["type"] as? String, "state")
        let item = (object?["items"] as? [[String: Any]])?.first
        XCTAssertEqual(item?["status"] as? String, "needs_attention")
        XCTAssertEqual(item?["hasCredentials"] as? Bool, true)
        XCTAssertEqual(item?["detail"] as? String, "Can't reach nas.local")
    }
}
