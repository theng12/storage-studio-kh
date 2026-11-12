import Foundation

public struct Storage: Codable, Equatable, Identifiable {
    public var id: String
    public var name: String
    public var kind: String          // "smb" | "volume"
    public var target: String        // smb://host/share, or the disk's own label
    public var mountPoint: String    // "" means macOS chooses the SMB mount point
    public var volumeUUID: String?
    public var reconnectAtLogin: Bool
    public var reconnectAfterWake: Bool
    public var username: String?

    public init(
        id: String, name: String, kind: String, target: String, mountPoint: String = "",
        volumeUUID: String? = nil, reconnectAtLogin: Bool = false, reconnectAfterWake: Bool = false,
        username: String? = nil
    ) {
        self.id = id
        self.name = name
        self.kind = kind
        self.target = target
        self.mountPoint = mountPoint
        self.volumeUUID = volumeUUID
        self.reconnectAtLogin = reconnectAtLogin
        self.reconnectAfterWake = reconnectAfterWake
        self.username = username
    }
}

public enum StorageStatus: String, Codable {
    case mounted
    case mounting
    case retrying
    case needsAttention = "needs_attention"
    case unreachable
    case notMounted = "not_mounted"
}

public struct StorageState: Codable, Equatable {
    public var id: String
    public var status: StorageStatus
    public var detail: String?
    public var mountedPath: String?
    public var hasCredentials: Bool
}

public struct VolumeCandidate: Codable, Equatable {
    public var name: String
    public var path: String
    public var uuid: String
    public var device: String
}

public struct MountedVolume: Equatable {
    public var source: String
    public var mountPoint: String
    public var fsType: String
}

/// Where a mount attempt failed, and what the person should do about it.
public struct MountFailure: Equatable {
    public var message: String
    public var unreachable: Bool
    public var needsCredentials: Bool

    public init(message: String, unreachable: Bool = false, needsCredentials: Bool = false) {
        self.message = message
        self.unreachable = unreachable
        self.needsCredentials = needsCredentials
    }
}
