import Foundation
import Security

/// Share passwords live only in the login Keychain, one item per storage. They never
/// touch the settings file, the log or a process argument list.
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

    private static func query(id: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: id,
        ]
    }

    @discardableResult
    public static func save(id: String, credentials: Credentials) -> OSStatus {
        guard let data = try? JSONEncoder().encode(credentials) else { return errSecParam }
        SecItemDelete(query(id: id) as CFDictionary)
        var item = query(id: id)
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        return SecItemAdd(item as CFDictionary, nil)
    }

    public static func load(id: String) -> Credentials? {
        var item = query(id: id)
        item[kSecReturnData as String] = true
        item[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(item as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data,
              let credentials = try? JSONDecoder().decode(Credentials.self, from: data)
        else { return nil }
        return credentials
    }

    public static func has(id: String) -> Bool {
        load(id: id) != nil
    }

    public static func delete(id: String) {
        SecItemDelete(query(id: id) as CFDictionary)
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
        SecItemDelete(internetQuery(host: host, account: account) as CFDictionary)
        var item = internetQuery(host: host, account: account)
        item[kSecValueData as String] = Data(password.utf8)
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        return SecItemAdd(item as CFDictionary, nil)
    }

    public static func deleteInternet(host: String, account: String) {
        guard !host.isEmpty, !account.isEmpty else { return }
        SecItemDelete(internetQuery(host: host, account: account) as CFDictionary)
    }

    /// Checks that a usable system credential exists without reading it.
    public static func hasInternet(host: String, account: String) -> Bool {
        guard !host.isEmpty, !account.isEmpty else { return false }
        var item = internetQuery(host: host, account: account)
        item[kSecReturnAttributes as String] = true
        item[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        return SecItemCopyMatching(item as CFDictionary, &result) == errSecSuccess
    }
}
