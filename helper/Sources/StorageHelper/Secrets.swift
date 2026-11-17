import Foundation

/// Passwords live in this app's own data folder, never in a system credential store:
/// `~/Library/Application Support/Storage Studio KH/secrets.json`, mode 0600, written
/// atomically (a sibling temp file is renamed over it). Nothing here touches the macOS
/// system credential store and nothing can make macOS show a credential prompt.
public enum Secrets {
    public struct Credentials: Codable, Equatable {
        public var username: String
        public var password: String
        public init(username: String, password: String) {
            self.username = username
            self.password = password
        }
    }

    public enum LoadOutcome {
        case found(Credentials)
        case missing
        case unreadable
    }

    private struct Payload: Codable {
        var schema: Int
        var items: [String: Credentials]
    }

    /// `user@host`, or just `host` when the share needs no user name.
    public static func account(host: String, username: String?) -> String {
        let user = username?.trimmingCharacters(in: .whitespaces) ?? ""
        return user.isEmpty ? host : "\(user)@\(host)"
    }

    public static var fileURL: URL {
        // Follow the app's data folder (and the gate's isolated HOME), not a fixed home.
        let environment = ProcessInfo.processInfo.environment
        let home: URL
        if let override = environment["STORAGE_STUDIO_TEST_DATA_DIR"], !override.isEmpty {
            home = URL(fileURLWithPath: override, isDirectory: true)
        } else if let envHome = environment["HOME"], !envHome.isEmpty {
            home = URL(fileURLWithPath: envHome, isDirectory: true)
        } else {
            home = FileManager.default.homeDirectoryForCurrentUser
        }
        return home
            .appendingPathComponent("Library/Application Support/Storage Studio KH", isDirectory: true)
            .appendingPathComponent("secrets.json")
    }

    /// Free space on the disk that holds the secrets file, so a failed save can say the number.
    public static func freeSpace() -> Int64? {
        var folder = fileURL.deletingLastPathComponent()
        while !FileManager.default.fileExists(atPath: folder.path) {
            let parent = folder.deletingLastPathComponent()
            if parent.path == folder.path { break }
            folder = parent
        }
        let attributes = try? FileManager.default.attributesOfFileSystem(forPath: folder.path)
        return attributes?[.systemFreeSize] as? Int64
    }

    public static func save(host: String, username: String?, password: String) -> Bool {
        guard !host.isEmpty, !password.isEmpty else { return false }
        let key = account(host: host, username: username)
        var items = read()
        items[key] = Credentials(
            username: username?.trimmingCharacters(in: .whitespaces) ?? "",
            password: password
        )
        return write(items)
    }

    public static func load(host: String, username: String?) -> LoadOutcome {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return .missing }
        let key = account(host: host, username: username)
        return readStrict().map { items in
            items[key].map { LoadOutcome.found($0) } ?? .missing
        } ?? .unreadable
    }

    /// Metadata only: answers "is a password saved here?" without decoding the secret.
    public static func has(host: String, username: String?) -> Bool {
        let key = account(host: host, username: username)
        return read()[key] != nil
    }

    public static func forget(host: String, username: String?) {
        guard !host.isEmpty else { return }
        let key = account(host: host, username: username)
        var items = read()
        guard items.removeValue(forKey: key) != nil else { return }
        _ = write(items)
    }

    // MARK: storage

    private static func read() -> [String: Credentials] {
        readStrict() ?? [:]
    }

    private static func readStrict() -> [String: Credentials]? {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return [:] }
        do {
            let data = try Data(contentsOf: fileURL)
            let payload = try JSONDecoder().decode(Payload.self, from: data)
            try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: fileURL.path)
            return payload.items
        } catch {
            // Keep the unreadable copy instead of overwriting it; the owner can re-enter.
            let backup = fileURL.deletingLastPathComponent().appendingPathComponent("secrets-unreadable.json")
            try? FileManager.default.removeItem(at: backup)
            try? FileManager.default.copyItem(at: fileURL, to: backup)
            return nil
        }
    }

    private static func write(_ items: [String: Credentials]) -> Bool {
        let manager = FileManager.default
        let directory = fileURL.deletingLastPathComponent()
        do {
            try manager.createDirectory(
                at: directory,
                withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700]
            )
            try? manager.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
            let data = try JSONEncoder().encode(Payload(schema: 1, items: items))
            let temporary = directory.appendingPathComponent(".secrets-\(UUID().uuidString).tmp")
            guard manager.createFile(
                atPath: temporary.path,
                contents: nil,
                attributes: [.posixPermissions: 0o600]
            ) else { return false }
            let handle = try FileHandle(forWritingTo: temporary)
            try handle.write(contentsOf: data)
            try handle.synchronize()
            try handle.close()
            _ = try manager.replaceItemAt(fileURL, withItemAt: temporary)
            try manager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: fileURL.path)
            return true
        } catch {
            return false
        }
    }
}
