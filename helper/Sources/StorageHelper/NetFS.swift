import CoreFoundation
import Foundation

/// Thin wrapper over the system's own network filesystem mounter. Using NetFS (the API
/// Finder itself uses) means the password stays out of the process argument list.
enum NetFS {
    typealias MountSync = @convention(c) (
        CFURL?, CFURL?, CFString?, CFString?, CFMutableDictionary?, CFMutableDictionary?, UnsafeMutableRawPointer?
    ) -> Int32

    static let handle: UnsafeMutableRawPointer? = dlopen("/System/Library/Frameworks/NetFS.framework/NetFS", RTLD_NOW)
    static let mountSync: MountSync? = {
        guard let handle, let symbol = dlsym(handle, "NetFSMountURLSync") else { return nil }
        return unsafeBitCast(symbol, to: MountSync.self)
    }()

    /// NetFS exports its option keys as CFString variables; read them rather than
    /// guessing their values.
    static func stringConstant(_ name: String) -> CFString? {
        guard let handle, let symbol = dlsym(handle, name) else { return nil }
        return symbol.assumingMemoryBound(to: Unmanaged<CFString>.self).pointee.takeUnretainedValue()
    }

    static func options(_ pairs: [(CFString, CFBoolean)]) -> CFMutableDictionary {
        let dictionary = CFDictionaryCreateMutable(kCFAllocatorDefault, 0, nil, nil)
        for (key, value) in pairs {
            CFDictionaryAddValue(dictionary, Unmanaged.passUnretained(key).toOpaque(), Unmanaged.passUnretained(value).toOpaque())
        }
        return dictionary!
    }

    /// Returns nil on success, or the person-facing reason it failed.
    static func mountSMB(storage: Storage, credentials: Keychain.Credentials?) -> MountFailure? {
        guard let mountSync else {
            return MountFailure(message: "The system's network mounter isn't available on this Mac.")
        }
        guard let url = URL(string: storage.target), let host = url.host, !host.isEmpty else {
            return MountFailure(message: "The share address isn't valid.")
        }
        var components = URLComponents()
        components.scheme = "smb"
        components.host = host
        components.path = url.path.isEmpty ? "" : url.path
        guard let cleanURL = components.url else {
            return MountFailure(message: "The share address isn't valid.")
        }

        var mountPath: CFURL?
        if !storage.mountPoint.trimmingCharacters(in: .whitespaces).isEmpty {
            let path = storage.mountPoint
            var isDirectory: ObjCBool = false
            if !FileManager.default.fileExists(atPath: path, isDirectory: &isDirectory) {
                do {
                    try FileManager.default.createDirectory(atPath: path, withIntermediateDirectories: true)
                } catch {
                    return MountFailure(message: "The mount folder \(path) couldn't be created.")
                }
            }
            mountPath = URL(fileURLWithPath: path) as CFURL
        }

        var pairs: [(CFString, CFBoolean)] = []
        if let key = stringConstant("kNetFSNoUserPromptKey") { pairs.append((key, kCFBooleanTrue)) }
        if let key = stringConstant("kNetFSAllowLoopbackKey") { pairs.append((key, kCFBooleanTrue)) }
        if let key = stringConstant("kNetFSMountAtMountDirKey"), mountPath != nil { pairs.append((key, kCFBooleanTrue)) }
        if credentials == nil, let key = stringConstant("kNetFSUseGuestKey") { pairs.append((key, kCFBooleanTrue)) }
        let options = options(pairs)

        let user = credentials?.username as CFString?
        let password = credentials?.password as CFString?
        let code = mountSync(cleanURL as CFURL, mountPath, user, password, options, nil, nil)
        if code == 0 { return nil }

        let needsCredentials = code == 13 || code == 80 || code == -6003
        return MountFailure(
            message: needsCredentials
                ? "The device needs a user name and password."
                : "The share couldn't be mounted (code \(code)).",
            needsCredentials: needsCredentials
        )
    }
}
