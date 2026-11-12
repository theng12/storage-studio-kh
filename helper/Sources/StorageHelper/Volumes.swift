import Foundation

/// Attached disks. A disk that comes back under a new disk number is still the same
/// volume, so the volume's own UUID is the identity we keep.
public enum Volumes {
    public static func candidates() -> [VolumeCandidate] {
        var seen = Set<String>()
        var found: [VolumeCandidate] = []
        for entry in volumeDictionaries() {
            guard let uuid = entry["VolumeUUID"] as? String,
                  let name = entry["VolumeName"] as? String,
                  let device = entry["DeviceIdentifier"] as? String,
                  let path = entry["MountPoint"] as? String,
                  path.hasPrefix("/Volumes/"),
                  name != "Recovery",
                  !path.contains("localsnapshots"),
                  !path.contains("Backups.backupdb"),
                  !seen.contains(uuid)
            else { continue }
            seen.insert(uuid)
            found.append(VolumeCandidate(name: name, path: path, uuid: uuid, device: device))
        }
        return found.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    public static func device(forUUID uuid: String) -> String? {
        volumeDictionaries()
            .first { ($0["VolumeUUID"] as? String)?.caseInsensitiveCompare(uuid) == .orderedSame }?["DeviceIdentifier"] as? String
    }

    public static func mount(device: String) -> MountFailure? {
        let result = Shell.run("/usr/sbin/diskutil", ["mount", device], timeout: 45)
        if result.status == 0 { return nil }
        let reason = result.error.isEmpty ? "The disk could not be mounted." : result.error
        return MountFailure(message: reason, unreachable: result.status == -2)
    }

    private static func volumeDictionaries() -> [[String: Any]] {
        let result = Shell.run("/usr/sbin/diskutil", ["list", "-plist"], timeout: 20)
        guard result.status == 0,
              let plist = try? PropertyListSerialization.propertyList(from: result.output, format: nil),
              let root = plist as? [String: Any]
        else { return [] }
        var collected: [[String: Any]] = []
        collect(root, into: &collected)
        return collected
    }

    private static func collect(_ value: Any, into found: inout [[String: Any]]) {
        if let dictionary = value as? [String: Any] {
            if dictionary["VolumeUUID"] != nil { found.append(dictionary) }
            for child in dictionary.values { collect(child, into: &found) }
        } else if let array = value as? [Any] {
            for child in array { collect(child, into: &found) }
        }
    }
}
