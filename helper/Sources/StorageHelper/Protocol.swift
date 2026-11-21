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
    /// The hold's settle ceiling in seconds, sent by the app so the helper can name it.
    public var ceiling: Int? = nil
    /// The saved archive rows, sent with every configure so a start needs only its row id.
    public var archives: [ArchiveSpec]? = nil
    /// Discovery and restore: the folder to scan, and where the copy goes.
    public var root: String? = nil
    public var destination: String? = nil
    public var archivePath: String? = nil
}

public enum Event {
    /// `inFlight` is a mount attempt running now; `queued` is work this process will try again;
    /// `deferred` names the subset held only because an update asked. `paused` is the helper's
    /// own answer to a hold: the app reads it rather than inferring a pause from an empty queue.
    case state([StorageState], inFlight: [String], queued: [String], deferred: [String], paused: Bool)
    case volumes([VolumeCandidate])
    case attention(id: String, name: String, reason: String)
    case recovered(id: String, name: String)
    case needsCredentials(id: String, name: String)
    case shares(host: String, shares: [String], needsCredentials: Bool, error: String?)
    case smbMounts([ShareCandidate])
    case archive(JobView)
    case restorable(root: String, items: [Restorable], error: String?)
    case log(level: String, message: String)

    public var json: Data {
        var object: [String: Any] = [:]
        switch self {
        case .state(let items, let inFlight, let queued, let deferred, let paused):
            object["type"] = "state"
            object["paused"] = paused
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
        case .archive(let job):
            object["type"] = "archive"
            object["job"] = (try? JSONSerialization.jsonObject(with: job.json)) ?? [:]
        case .restorable(let root, let items, let error):
            object["type"] = "restorable"
            object["root"] = root
            object["items"] = items.map(\.json)
            if let error { object["error"] = error }
        case .log(let level, let message):
            object = ["type": "log", "level": level, "message": message]
        }
        return (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])) ?? Data("{}".utf8)
    }
}
