import Foundation
import Security

/// Share passwords live only in this app's own login-Keychain items. Nothing is ever read
/// from Finder's SMB items: reading another app's item is what makes macOS ask for the
/// Keychain password, and a background helper must never cause that.
///
/// Two hard-won details:
/// - an updated helper must be able to read what the previous version wrote. A default
///   SecItemAdd item trusts only the exact binary that created it, so a rebuilt helper
///   triggered an invisible access prompt. Items are created with an access object that
///   trusts any application; it is still a login Keychain item, readable only while the
///   login keychain is unlocked.
/// - a Keychain call can block on such a prompt. Every call runs on a private queue with a
///   short timeout so one storage never stops the whole engine.
public enum Keychain {
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
        case refused
    }

    static let service = "Storage Studio KH"
    private static let legacyService = "app.storagestudiokh.desktop.smb"
    private static let queue = DispatchQueue(label: "app.storagestudiokh.helper.keychain")
    private static let timeout: DispatchTimeInterval = .milliseconds(1500)
    private enum TimedOut { static let status: OSStatus = -25207 } // errSecTimeout

    /// `user@host`, or just `host` when the share needs no user name.
    public static func account(host: String, username: String?) -> String {
        let user = username?.trimmingCharacters(in: .whitespaces) ?? ""
        return user.isEmpty ? host : "\(user)@\(host)"
    }

    private static func run(_ work: @escaping () -> OSStatus) -> OSStatus {
        let semaphore = DispatchSemaphore(value: 0)
        var status = TimedOut.status
        queue.async {
            status = work()
            semaphore.signal()
        }
        return semaphore.wait(timeout: .now() + timeout) == .success ? status : TimedOut.status
    }

    private static func query(host: String, account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: Keychain.account(host: host, username: account),
        ]
    }

    private static func legacyQuery(id: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: legacyService,
            kSecAttrAccount as String: id,
        ]
    }

    /// Trusts only this app and its helper, by their signing identity. If a rebuild ever
    /// invalidates that identity macOS asks once; the item is never opened to every process.
    private static func trustedAccess() -> SecAccess? {
        var paths: [String] = []
        let own = Bundle.main.bundleURL
        if own.pathExtension == "app" {
            paths.append(own.path)
            if let range = own.path.range(of: "/Contents/Helpers/") {
                paths.append(String(own.path[..<range.lowerBound]))
            }
        } else {
            // A bare development binary: trust the app bundle two levels up when present.
            let contents = own.deletingLastPathComponent().deletingLastPathComponent()
            if contents.lastPathComponent == "Contents" {
                paths.append(contents.deletingLastPathComponent().path)
            }
            paths.append(own.path)
        }
        var applications: [SecTrustedApplication] = []
        for path in paths {
            var application: SecTrustedApplication?
            if SecTrustedApplicationCreateFromPath(path, &application) == errSecSuccess, let application {
                applications.append(application)
            }
        }
        guard !applications.isEmpty else { return nil }
        var access: SecAccess?
        SecAccessCreate("Storage Studio KH" as CFString, applications as CFArray, &access)
        return access
    }

    @discardableResult
    public static func save(host: String, username: String?, password: String) -> OSStatus {
        guard !host.isEmpty, !password.isEmpty else { return errSecParam }
        let credentials = Credentials(username: username?.trimmingCharacters(in: .whitespaces) ?? "", password: password)
        guard let data = try? JSONEncoder().encode(credentials) else { return errSecParam }
        return run {
            SecItemDelete(query(host: host, account: username ?? "") as CFDictionary)
            var item = query(host: host, account: username ?? "")
            item[kSecValueData as String] = data
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
            if let access = trustedAccess() { item[kSecAttrAccess as String] = access }
            return SecItemAdd(item as CFDictionary, nil)
        }
    }

    public static func load(host: String, username: String?) -> LoadOutcome {
        var outcome = LoadOutcome.missing
        let status = run {
            var item = query(host: host, account: username ?? "")
            item[kSecReturnData as String] = true
            item[kSecMatchLimit as String] = kSecMatchLimitOne
            var result: CFTypeRef?
            let status = SecItemCopyMatching(item as CFDictionary, &result)
            if status == errSecSuccess, let data = result as? Data,
               let credentials = try? JSONDecoder().decode(Credentials.self, from: data) {
                outcome = .found(credentials)
            }
            return status
        }
        if status == errSecSuccess { return outcome }
        if status == errSecItemNotFound { return .missing }
        return .refused
    }

    /// Metadata only: answers "is a password saved here?" without touching the data.
    public static func has(host: String, username: String?) -> Bool {
        var found = false
        run {
            var item = query(host: host, account: username ?? "")
            item[kSecReturnAttributes as String] = true
            item[kSecMatchLimit as String] = kSecMatchLimitOne
            var result: CFTypeRef?
            let status = SecItemCopyMatching(item as CFDictionary, &result)
            found = status == errSecSuccess
            return status
        }
        return found
    }

    public static func forget(host: String, username: String?) {
        guard !host.isEmpty else { return }
        run { SecItemDelete(query(host: host, account: username ?? "") as CFDictionary) }
    }

    /// Removes the item written by versions before 0.1.3 (service by bundle id, account by
    /// storage id). Best effort: an old item may be unreadable, and it is never read.
    public static func forgetLegacy(id: String) {
        run { SecItemDelete(legacyQuery(id: id) as CFDictionary) }
    }
}
