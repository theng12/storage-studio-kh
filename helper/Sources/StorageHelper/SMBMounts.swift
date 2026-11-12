import Foundation

/// A share Finder already has mounted, offered to the owner as a one-click addition.
public struct ShareCandidate: Codable, Equatable {
    public var name: String
    public var url: String       // smb://user@host/share, percent-encoded
    public var user: String?
    public var host: String
    public var mountPoint: String

    public init(name: String, url: String, user: String?, host: String, mountPoint: String) {
        self.name = name
        self.url = url
        self.user = user
        self.host = host
        self.mountPoint = mountPoint
    }
}

public enum SMBMounts {
    /// `//vengtheng@100.69.137.42/Public%20Space-Music` becomes
    /// `smb://vengtheng@100.69.137.42/Public%20Space-Music`; the display name stays readable.
    public static func candidates(from table: [MountedVolume]) -> [ShareCandidate] {
        var found: [ShareCandidate] = []
        for entry in table where entry.fsType == "smbfs" && entry.source.hasPrefix("//") {
            let rest = String(entry.source.dropFirst(2))
            guard let slash = rest.firstIndex(of: "/") else { continue }
            let authority = String(rest[..<slash])
            let path = String(rest[slash...])
            let pieces = authority.split(separator: "@", maxSplits: 1, omittingEmptySubsequences: false)
            let user = pieces.count == 2 ? String(pieces[0]) : nil
            let host = pieces.count == 2 ? String(pieces[1]) : authority
            guard !host.isEmpty else { continue }
            let url = "smb://" + rest
            guard !found.contains(where: { $0.url == url }) else { continue }
            let readable = (path.removingPercentEncoding ?? path).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            found.append(ShareCandidate(
                name: readable,
                url: url,
                user: user,
                host: host,
                mountPoint: entry.mountPoint
            ))
        }
        return found
    }


}
