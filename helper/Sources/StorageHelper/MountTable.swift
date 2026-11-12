import Foundation

/// The live mount table, read the same way `mount` reports it, and the small amount of
/// normalisation needed to tell whether a configured storage is already mounted.
public enum MountTable {
    public static func current() -> [MountedVolume] {
        var buffer: UnsafeMutablePointer<statfs>?
        let count = getmntinfo(&buffer, MNT_NOWAIT)
        guard count > 0, let buffer else { return [] }
        var result: [MountedVolume] = []
        for index in 0..<Int(count) {
            let entry = buffer[index]
            let size = MemoryLayout.size(ofValue: entry.f_mntfromname)
            let source = withUnsafePointer(to: entry.f_mntfromname) { pointer in
                pointer.withMemoryRebound(to: CChar.self, capacity: size) { String(cString: $0) }
            }
            let path = withUnsafePointer(to: entry.f_mntonname) { pointer in
                pointer.withMemoryRebound(to: CChar.self, capacity: MemoryLayout.size(ofValue: entry.f_mntonname)) {
                    String(cString: $0)
                }
            }
            let type = withUnsafePointer(to: entry.f_fstypename) { pointer in
                pointer.withMemoryRebound(to: CChar.self, capacity: MemoryLayout.size(ofValue: entry.f_fstypename)) {
                    String(cString: $0)
                }
            }
            result.append(MountedVolume(source: source, mountPoint: path, fsType: type))
        }
        return result
    }

    /// `//user@host/share/` and `smb://host/share` name the same share.
    public static func canonicalSMB(_ value: String) -> String? {
        var text = value.trimmingCharacters(in: .whitespaces)
        if text.lowercased().hasPrefix("smb://") {
            text = String(text.dropFirst("smb://".count))
        } else if text.hasPrefix("//") {
            text = String(text.dropFirst(2))
        } else {
            return nil
        }
        if let at = text.firstIndex(of: "@") {
            text = String(text[text.index(after: at)...])
        }
        while text.hasSuffix("/") { text.removeLast() }
        guard !text.isEmpty else { return nil }
        return text.lowercased()
    }

    public static func entry(for storage: Storage, in table: [MountedVolume]) -> MountedVolume? {
        switch storage.kind {
        case "smb":
            guard let target = canonicalSMB(storage.target) else { return nil }
            return table.first { entry in
                guard entry.fsType == "smbfs" || entry.fsType == "afpfs" else { return false }
                return canonicalSMB(entry.source) == target
            }
        default:
            let wanted = storage.mountPoint.trimmingCharacters(in: .whitespaces)
            guard !wanted.isEmpty else { return nil }
            return table.first { $0.mountPoint.caseInsensitiveCompare(wanted) == .orderedSame }
        }
    }

    /// The path Finder should open for a configured storage.
    public static func mountedPath(for storage: Storage, in table: [MountedVolume]) -> String? {
        entry(for: storage, in: table)?.mountPoint
    }
}
