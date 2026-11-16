import Foundation

/// One JSON object per line, both ways, over the helper's stdin/stdout.
public struct Command: Decodable {
    public var type: String
    public var id: String?
    public var retries: Int?
    public var storages: [Storage]?
    public var username: String?
    public var password: String?
    public var host: String?
}

public enum Event {
    /// `inFlight` is a mount attempt running now; `queued` is work this process will try again;
    /// `deferred` names the subset held only because an update asked. The hold never guesses.
    case state([StorageState], inFlight: [String], queued: [String], deferred: [String])
    case volumes([VolumeCandidate])
    case attention(id: String, name: String, reason: String)
    case recovered(id: String, name: String)
    case needsCredentials(id: String, name: String)
    case shares(host: String, shares: [String], needsCredentials: Bool, error: String?)
    case smbMounts([ShareCandidate])
    case log(level: String, message: String)

    public var json: Data {
        var object: [String: Any] = [:]
        switch self {
        case .state(let items, let inFlight, let queued, let deferred):
            object["type"] = "state"
            object["inFlight"] = inFlight
            object["queued"] = queued
            object["deferred"] = deferred
            object["items"] = items.map { item -> [String: Any] in
                var value: [String: Any] = [
                    "id": item.id,
                    "status": item.status.rawValue,
                    "hasCredentials": item.hasCredentials,
                ]
                if let detail = item.detail { value["detail"] = detail }
                if let path = item.mountedPath { value["mountedPath"] = path }
                return value
            }
        case .volumes(let items):
            object["type"] = "volumes"
            object["items"] = items.map {
                ["name": $0.name, "path": $0.path, "uuid": $0.uuid, "device": $0.device]
            }
        case .attention(let id, let name, let reason):
            object = ["type": "attention", "id": id, "name": name, "reason": reason]
        case .recovered(let id, let name):
            object = ["type": "recovered", "id": id, "name": name]
        case .needsCredentials(let id, let name):
            object = ["type": "needs_credentials", "id": id, "name": name]
        case .smbMounts(let items):
            object["type"] = "smb_mounts"
            object["items"] = items.map {
                ["name": $0.name, "url": $0.url, "user": $0.user as Any,
                 "host": $0.host, "mountPoint": $0.mountPoint]
            }
        case .shares(let host, let shares, let needsCredentials, let error):
            object = [
                "type": "shares",
                "host": host,
                "shares": shares,
                "needsCredentials": needsCredentials,
            ]
            if let error { object["error"] = error }
        case .log(let level, let message):
            object = ["type": "log", "level": level, "message": message]
        }
        return (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])) ?? Data("{}".utf8)
    }
}
