import Foundation
import Security

/// Share passwords live only in the login Keychain, one item per storage. They never
/// touch the settings file, the log or a process argument list.
///
/// Two hard-won details:
/// - an updated helper must be able to read what the previous version wrote. A default
///   SecItemAdd item trusts only the exact binary that created it, so a rebuilt helper
///   triggered an invisible access prompt and the engine stopped reporting. Items are
///   therefore created with an access object that trusts any application (still a login
///   Keychain item, readable only while the login keychain is unlocked).
/// - a Keychain call can block on such a prompt. Every call runs on a private queue with a
///   short timeout so a storage never stops the whole engine.
public enum Keychain {
    public struct Credentials: Codable, Equatable {
        public var username: String
        public var password: String
        public init(username: String, password: String) {
            self.username = username
            self.password = password
        }
    }

    static let service = "app.storagestudiokh.desktop.smb"
    private static let queue = DispatchQueue(label: "app.storagestudiokh.helper.keychain")
    private static let timeout: DispatchTimeInterval = .milliseconds(1500)
    private enum TimedOut { static let status: OSStatus = -25207 } // errSecTimeout

    private static func run(_ work: @escaping () -> OSStatus) -> OSStatus {
        let semaphore = DispatchSemaphore(value: 0)
        var status = TimedOut.status
        queue.async {
            status = work()
            semaphore.signal()
        }
        return semaphore.wait(timeout: .now() + timeout) == .success ? status : TimedOut.status
    }

    private static func query(id: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: id,
        ]
    }

    /// Trusts any application so an app update never turns a saved password unreadable.
    private static func permissiveAccess() -> SecAccess? {
        var trusted: SecTrustedApplication?
        guard SecTrustedApplicationCreateFromPath(nil, &trusted) == errSecSuccess, let trusted else {
            return nil
        }
        var access: SecAccess?
        SecAccessCreate("Storage Studio KH" as CFString, [trusted] as CFArray, &access)
        return access
    }

    @discardableResult
    public static func save(id: String, credentials: Credentials) -> OSStatus {
        guard let data = try? JSONEncoder().encode(credentials) else { return errSecParam }
        return run {
            SecItemDelete(query(id: id) as CFDictionary)
            var item = query(id: id)
            item[kSecValueData as String] = data
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
            if let access = permissiveAccess() { item[kSecAttrAccess as String] = access }
            return SecItemAdd(item as CFDictionary, nil)
        }
    }

    public static func load(id: String) -> Credentials? {
        var credentials: Credentials?
        run {
            var item = query(id: id)
            item[kSecReturnData as String] = true
            item[kSecMatchLimit as String] = kSecMatchLimitOne
            var result: CFTypeRef?
            let status = SecItemCopyMatching(item as CFDictionary, &result)
            if status == errSecSuccess, let data = result as? Data {
                credentials = try? JSONDecoder().decode(Credentials.self, from: data)
            }
            return status
        }
        return credentials
    }

    /// Metadata only: it answers "is there a saved password?" without touching the data,
    /// so a stale item from an older build cannot stall the engine.
    public static func has(id: String) -> Bool {
        var found = false
        run {
            var item = query(id: id)
            item[kSecReturnAttributes as String] = true
            item[kSecMatchLimit as String] = kSecMatchLimitOne
            var result: CFTypeRef?
            let status = SecItemCopyMatching(item as CFDictionary, &result)
            found = status == errSecSuccess
            return status
        }
        return found
    }

    public static func delete(id: String) {
        run { SecItemDelete(query(id: id) as CFDictionary) }
    }

    // Finder, `open smb://…` and NetFS all use this system item, so the password the
    // owner enters once works everywhere and never has to be typed again.

    private static func internetQuery(host: String, account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassInternetPassword,
            kSecAttrServer as String: host,
            kSecAttrAccount as String: account,
            kSecAttrProtocol as String: "smb ",  // kSecProtocolTypeSMB's four-character value
        ]
    }

    @discardableResult
    public static func saveInternet(host: String, account: String, password: String) -> OSStatus {
        guard !host.isEmpty, !account.isEmpty else { return errSecParam }
        return run {
            SecItemDelete(internetQuery(host: host, account: account) as CFDictionary)
            var item = internetQuery(host: host, account: account)
            item[kSecValueData as String] = Data(password.utf8)
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
            if let access = permissiveAccess() { item[kSecAttrAccess as String] = access }
            return SecItemAdd(item as CFDictionary, nil)
        }
    }

    public static func deleteInternet(host: String, account: String) {
        guard !host.isEmpty, !account.isEmpty else { return }
        run { SecItemDelete(internetQuery(host: host, account: account) as CFDictionary) }
    }

    /// Checks that a usable system credential exists without reading it.
    public static func hasInternet(host: String, account: String) -> Bool {
        guard !host.isEmpty, !account.isEmpty else { return false }
        var found = false
        run {
            var item = internetQuery(host: host, account: account)
            item[kSecReturnAttributes as String] = true
            item[kSecMatchLimit as String] = kSecMatchLimitOne
            var result: CFTypeRef?
            let status = SecItemCopyMatching(item as CFDictionary, &result)
            found = status == errSecSuccess
            return status
        }
        return found
    }
}
