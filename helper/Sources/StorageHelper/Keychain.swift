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

    public static func save(id: String, credentials: Credentials) {
        guard let data = try? JSONEncoder().encode(credentials) else { return }
        SecItemDelete(query(id: id) as CFDictionary)
        var item = query(id: id)
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(item as CFDictionary, nil)
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
}
