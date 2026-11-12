import CoreFoundation
import Foundation

/// Thin wrapper over the system's own network filesystem mounter. Using NetFS (the API
/// Finder itself uses) means the password stays out of the process argument list.
///
/// The option keys are the documented NetFS strings. Darwin 27 no longer exports the
/// `kNetFS…Key` data symbols, so the strings are used directly; a missing symbol used to
/// drop the options silently, which could leave a background mount waiting on a dialog.
enum NetFS {
    typealias MountSync = @convention(c) (
        CFURL?, CFURL?, CFString?, CFString?, CFMutableDictionary?, CFMutableDictionary?, UnsafeMutableRawPointer?
    ) -> Int32

    static let noUserPrompt = "NoUserPrompt" as CFString
    static let allowLoopback = "AllowLoopback" as CFString
    static let useGuest = "Guest" as CFString
    static let mountAtMountDir = "MountAtMountDir" as CFString

    static let handle: UnsafeMutableRawPointer? = dlopen("/System/Library/Frameworks/NetFS.framework/NetFS", RTLD_NOW)
    static let mountSync: MountSync? = {
        guard let handle, let symbol = dlsym(handle, "NetFSMountURLSync") else { return nil }
        return unsafeBitCast(symbol, to: MountSync.self)
    }()

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
        components.path = url.path
        guard let cleanURL = components.url else {
            return MountFailure(message: "The share address isn't valid.")
        }

        var mountPath: CFURL?
        let wanted = storage.mountPoint.trimmingCharacters(in: .whitespaces)
        if !wanted.isEmpty {
            var isDirectory: ObjCBool = false
            if !FileManager.default.fileExists(atPath: wanted, isDirectory: &isDirectory) {
                do {
                    try FileManager.default.createDirectory(atPath: wanted, withIntermediateDirectories: true)
                } catch {
                    return MountFailure(message: "The mount folder \(wanted) couldn't be created.")
                }
            }
            mountPath = URL(fileURLWithPath: wanted) as CFURL
        }

        var pairs: [(CFString, CFBoolean)] = [(noUserPrompt, kCFBooleanTrue)]
        if mountPath != nil { pairs.append((mountAtMountDir, kCFBooleanTrue)) }
        if credentials == nil { pairs.append((useGuest, kCFBooleanTrue)) }
        // Only loopback shares need this, and it is harmless for the rest.
        pairs.append((allowLoopback, kCFBooleanTrue))
        let options = options(pairs)

        let user = credentials?.username as CFString?
        let password = credentials?.password as CFString?
        let code = mountSync(cleanURL as CFURL, mountPath, user, password, options, nil, nil)
        if code == 0 { return nil }

        let needsCredentials = code == 1 || code == 13 || code == 80 || code == -6003
        return MountFailure(
            message: needsCredentials
                ? "The device needs a user name and password."
                : "The share couldn't be mounted (code \(code)).",
            needsCredentials: needsCredentials
        )
    }
}
