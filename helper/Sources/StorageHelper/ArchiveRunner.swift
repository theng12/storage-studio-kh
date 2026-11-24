import CryptoKit
import Foundation

/// One saved archive row, as the app holds it. `roots` is the channel folder, plus the channel's
/// heavy-media folder when Story keeps it outside the channel. `destination` is the archive root:
/// `…/Channel Archives` on a share or a disk.
public struct ArchiveSpec: Codable, Equatable {
    public var id: String
    public var name: String
    public var slug: String
    public var roots: [String]
    public var destination: String

    public init(id: String, name: String, slug: String, roots: [String], destination: String) {
        self.id = id
        self.name = name
        self.slug = slug
        self.roots = roots
        self.destination = destination
    }
}

/// What the window draws for the one job that can run. Nothing is invented: `filesDone` and
/// `bytesDone` are counted as files verify, and there is no percentage or finish time.
public struct JobView: Codable, Equatable {
    public var id: String
    public var kind: String      // "archive" | "restore"
    public var name: String
    public var state: String     // copying | verifying | archived | restoring | restored | paused | failed
    public var filesDone: Int
    public var filesTotal: Int
    public var bytesDone: Int64
    public var bytesTotal: Int64
    public var detail: String?
    public var path: String?

    public var json: Data {
        var object: [String: Any] = [
            "id": id, "kind": kind, "name": name, "state": state,
            "filesDone": filesDone, "filesTotal": filesTotal,
            "bytesDone": bytesDone, "bytesTotal": bytesTotal,
        ]
        if let detail { object["detail"] = detail }
        if let path { object["path"] = path }
        return (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])) ?? Data("{}".utf8)
    }
}

/// An archive found on a destination, read from its `manifest.json` alone.
public struct Restorable: Codable, Equatable {
    public var name: String
    public var slug: String
    public var path: String
    public var createdAt: String
    public var machine: String
    public var files: Int
    public var bytes: Int64
    public var roots: [String]

    public var json: [String: Any] {
        [
            "name": name, "slug": slug, "path": path, "createdAt": createdAt,
            "machine": machine, "files": files, "bytes": bytes, "roots": roots,
        ]
    }
}

// MARK: - the manifest

struct Manifest: Codable {
    struct Channel: Codable {
        var name: String
        var slug: String
        var projectId: String?
    }
    struct Root: Codable {
        var kind: String    // "channel" | "media"
        var label: String   // folder name, used to name the restored folder
        var source: String
    }
    struct Totals: Codable {
        var files: Int
        var bytes: Int64
    }
    struct File: Codable {
        var root: Int
        var path: String
        var bytes: Int64
        var sha256: String
        var modified: Double
    }

    var format: Int
    var archiveId: String
    var createdAt: String
    var machine: String
    var channel: Channel
    var roots: [Root]
    var totals: Totals
    var files: [File]
    var changedWhileCopying: [String]
    var skipped: [String]
    var state: String
}

// MARK: - the job on disk

/// Written when a job starts and kept until it finishes, so an interrupted job is still known
/// after the app or the Mac restarts. The per-file truth lives in the destination journal.
struct JobRecord: Codable {
    var id: String
    var kind: String
    var name: String
    var state: String
    var archiveId: String
    var directory: String
    var destination: String
    var roots: [String]
    var slug: String
    var filesDone: Int
    var filesTotal: Int
    var bytesDone: Int64
    var bytesTotal: Int64
    var detail: String?

    var view: JobView {
        JobView(
            id: id, kind: kind, name: name, state: state,
            filesDone: filesDone, filesTotal: filesTotal,
            bytesDone: bytesDone, bytesTotal: bytesTotal,
            detail: detail, path: directory
        )
    }
}

// MARK: - the runner

/// Copies one channel folder (and optionally its media folder) into a dated archive, verifies
/// every byte on the destination, and can resume after a kill, a lost share or a reboot.
/// It also restores an archive onto a new Mac. One job at a time; everything is synchronous and
/// runs on the helper's archive queue, so the engine keeps answering holds and mounts.
public final class ArchiveRunner {
    public typealias Emitter = (JobView) -> Void

    public let ownerId: String
    private let mode: Mode
    private let emit: Emitter
    private let finished: Emitter
    private let jobsDirectory: URL
    private let lock = NSLock()
    private var pauseRequested = false
    private var stopRequested = false
    private var lastEmit = Date.distantPast

    private enum Mode {
        case archive(ArchiveSpec)
        case restore(archivePath: String, destination: String)
    }

    public init(
        archive spec: ArchiveSpec,
        jobsDirectory: URL,
        emit: @escaping Emitter,
        finished: @escaping Emitter
    ) {
        self.mode = .archive(spec)
        self.ownerId = "archive:\(spec.id)"
        self.jobsDirectory = jobsDirectory
        self.emit = emit
        self.finished = finished
    }

    public init(
        restore archivePath: String,
        destination: String,
        jobsDirectory: URL,
        emit: @escaping Emitter,
        finished: @escaping Emitter
    ) {
        self.mode = .restore(archivePath: archivePath, destination: destination)
        self.ownerId = "restore:\(UUID().uuidString.prefix(8))"
        self.jobsDirectory = jobsDirectory
        self.emit = emit
        self.finished = finished
    }

    /// Asked by the engine when an update holds new work. The copy stops at the next file
    /// boundary (never inside a file), so the hold can settle and the next start resumes.
    public func requestPause() {
        lock.lock()
        pauseRequested = true
        lock.unlock()
    }

    private var shouldPause: Bool {
        lock.lock()
        defer { lock.unlock() }
        return pauseRequested
    }

    /// The person pressed Stop. Like a pause it ends at a file boundary, never inside a file, and
    /// the part-copied archive stays on the destination so the next start carries on from it.
    public func requestStop() {
        lock.lock()
        stopRequested = true
        lock.unlock()
    }

    private var shouldStop: Bool {
        lock.lock()
        defer { lock.unlock() }
        return stopRequested
    }

    public func run() {
        switch mode {
        case .archive(let spec):
            runArchive(spec)
        case .restore(let path, let destination):
            runRestore(archivePath: path, destination: destination)
        }
    }

    /// Interrupted jobs this helper still knows about, for the window to offer Resume.
    public static func leftoverJobs(jobsDirectory: URL) -> [JobView] {
        let files = (try? FileManager.default.contentsOfDirectory(
            at: jobsDirectory,
            includingPropertiesForKeys: nil
        )) ?? []
        return files
            .filter { $0.pathExtension == "json" && $0.lastPathComponent.hasPrefix("archive-") }
            .compactMap { url -> JobView? in
                guard let data = try? Data(contentsOf: url),
                      var record = try? JSONDecoder().decode(JobRecord.self, from: data)
                else { return nil }
                record.state = "paused"
                record.detail = "Stopped before it finished. Resume carries on from the last checked file."
                return record.view
            }
    }

    // MARK: archive

    private func runArchive(_ spec: ArchiveSpec) {
        let manager = FileManager.default
        // A share that is not mounted right now must never be re-created as an empty local
        // folder at its mount path: that would write the archive onto the wrong disk.
        var isDirectory: ObjCBool = false
        guard manager.fileExists(atPath: spec.destination, isDirectory: &isDirectory), isDirectory.boolValue else {
            finished(JobView(
                id: spec.id, kind: "archive", name: spec.name, state: "failed",
                filesDone: 0, filesTotal: 0, bytesDone: 0, bytesTotal: 0,
                detail: "The folder this channel is archived into isn't there right now. Connect it, then try again.",
                path: nil
            ))
            return
        }
        var record: JobRecord
        var journal: [String: Manifest.File] = [:]

        let existing = jobURL(id: spec.id)
        if let data = try? Data(contentsOf: existing),
           let saved = try? JSONDecoder().decode(JobRecord.self, from: data),
           saved.kind == "archive",
           saved.destination == spec.destination,
           saved.roots == spec.roots,
           matchesDevice(saved.directory, spec.destination) {
            record = saved
            record.name = spec.name
            record.state = "copying"
            record.detail = nil
            // Counted again from zero: every file is re-checked from the top, so the numbers
            // must describe this run, not the interrupted one.
            record.filesDone = 0
            record.bytesDone = 0
            journal = readJournal(URL(fileURLWithPath: saved.directory))
        } else {
            var archiveId = Self.newArchiveId()
            let channelRoot = URL(fileURLWithPath: spec.destination, isDirectory: true)
                .appendingPathComponent(spec.slug, isDirectory: true)
            var directory = channelRoot.appendingPathComponent(archiveId, isDirectory: true)
            if manager.fileExists(atPath: directory.path) {
                // Two runs in the same second must never share a journal.
                archiveId += "-2"
                directory = channelRoot.appendingPathComponent(archiveId, isDirectory: true)
            }
            record = JobRecord(
                id: spec.id, kind: "archive", name: spec.name, state: "copying",
                archiveId: archiveId, directory: directory.path, destination: spec.destination,
                roots: spec.roots, slug: spec.slug,
                filesDone: 0, filesTotal: 0, bytesDone: 0, bytesTotal: 0, detail: nil
            )
        }

        guard let entries = walk(spec.roots) else {
            fail(&record, "A folder in this archive can't be read.")
            return
        }
        record.filesTotal = entries.files.count
        record.bytesTotal = entries.files.reduce(Int64(0)) { $0 + $1.bytes }

        let directory = URL(fileURLWithPath: record.directory, isDirectory: true)
        do {
            try manager.createDirectory(at: directory, withIntermediateDirectories: true)
        } catch {
            fail(&record, "The archive folder couldn't be created: \(error.localizedDescription)")
            return
        }
        if let free = Self.freeSpace(at: directory), free < record.bytesTotal + 64 * 1024 * 1024 {
            fail(&record, "There isn't room for \(Self.size(record.bytesTotal)). The destination has \(Self.size(free)) free.")
            return
        }
        save(record)
        emitNow(record)

        let journalURL = directory.appendingPathComponent("manifest.partial.jsonl")
        var changed: [String] = []
        for entry in entries.files {
            if shouldStop {
                record.state = "cancelled"
                record.detail = "Stopped. The part-copied archive is kept at \(record.directory); Archive again carries on from the last checked file."
                save(record)
                emitNow(record)
                finished(record.view)
                return
            }
            if shouldPause {
                record.state = "paused"
                record.detail = "Paused for an update. It carries on by itself after the app starts again."
                save(record)
                emitNow(record)
                finished(record.view)
                return
            }
            let root = entries.roots[entry.root]
            let target = directory
                .appendingPathComponent("roots", isDirectory: true)
                .appendingPathComponent(String(format: "%02d-%@", entry.root + 1, root.label), isDirectory: true)
                .appendingPathComponent(entry.path, isDirectory: false)
            let key = "\(entry.root)/\(entry.path)"

            if let done = journal[key],
               done.bytes == entry.bytes,
               done.modified == entry.modified,
               manager.fileExists(atPath: target.path),
               (try? Self.sha256(of: target)) == done.sha256 {
                record.filesDone += 1
                record.bytesDone += entry.bytes
                throttled(record)
                continue
            }

            do {
                let copied = try Self.copyVerified(from: URL(fileURLWithPath: entry.absolute), to: target)
                if copied.changed {
                    changed.append(key)
                }
                let file = Manifest.File(
                    root: entry.root, path: entry.path, bytes: copied.bytes,
                    sha256: copied.sha, modified: copied.modified
                )
                journal[key] = file
                appendJournal(file, to: journalURL)
                record.filesDone += 1
                record.bytesDone += entry.bytes
                throttled(record)
            } catch {
                record.state = "failed"
                record.detail = "\(entry.path): \(Self.reason(error)) The archive is kept; Resume carries on from the last checked file."
                save(record)
                emitNow(record)
                finished(record.view)
                return
            }
        }

        // Every file is verified on the destination. The manifest is the proof; it is written
        // once, read back, and compared before the job may say "Archived".
        record.state = "verifying"
        record.detail = "Checking the manifest on the destination."
        emitNow(record)
        let manifest = Manifest(
            format: 1,
            archiveId: record.archiveId,
            createdAt: Self.iso(Date()),
            machine: Host.current().localizedName ?? ProcessInfo.processInfo.hostName,
            channel: Manifest.Channel(name: spec.name, slug: spec.slug, projectId: nil),
            roots: entries.roots.map { Manifest.Root(kind: $0.kind, label: $0.label, source: $0.source) },
            totals: Manifest.Totals(files: record.filesTotal, bytes: record.bytesTotal),
            files: entries.files.compactMap { journal["\($0.root)/\($0.path)"] },
            changedWhileCopying: changed,
            skipped: entries.skipped,
            state: "verified"
        )
        do {
            try writeManifest(manifest, to: directory.appendingPathComponent("manifest.json"))
            let readBack = try JSONDecoder().decode(
                Manifest.self,
                from: Data(contentsOf: directory.appendingPathComponent("manifest.json"))
            )
            guard readBack.totals.files == manifest.totals.files,
                  readBack.totals.bytes == manifest.totals.bytes,
                  readBack.files.count == manifest.files.count
            else {
                fail(&record, "The manifest didn't read back the same. Nothing is marked archived.")
                return
            }
        } catch {
            fail(&record, "The manifest couldn't be written: \(Self.reason(error))")
            return
        }
        try? manager.removeItem(at: journalURL)
        try? manager.removeItem(at: existing)

        record.state = "archived"
        record.detail = changed.isEmpty
            ? nil
            : "\(changed.count) file\(changed.count == 1 ? " was" : "s were") still changing while copying."
        record.bytesDone = record.bytesTotal
        record.filesDone = record.filesTotal
        emitNow(record)
        finished(record.view)
    }

    // MARK: restore

    private func runRestore(archivePath: String, destination: String) {
        let manager = FileManager.default
        let archive = URL(fileURLWithPath: archivePath, isDirectory: true)
        guard let data = try? Data(contentsOf: archive.appendingPathComponent("manifest.json")),
              let manifest = try? JSONDecoder().decode(Manifest.self, from: data)
        else {
            var record = restoreRecord(archivePath: archivePath, destination: destination)
            record.state = "failed"
            record.detail = "This folder has no manifest, so nothing can be checked. Only an archive made by Storage Studio KH can be restored here."
            emitNow(record)
            finished(record.view)
            return
        }

        var record = restoreRecord(archivePath: archivePath, destination: destination)
        record.name = manifest.channel.name
        record.filesTotal = manifest.files.count
        record.bytesTotal = manifest.totals.bytes
        record.state = "restoring"

        let destinationURL = URL(fileURLWithPath: destination, isDirectory: true)
        guard manager.fileExists(atPath: destinationURL.path) else {
            fail(&record, "The folder to restore into doesn't exist.")
            return
        }
        if let free = Self.freeSpace(at: destinationURL), free < manifest.totals.bytes + 64 * 1024 * 1024 {
            fail(&record, "There isn't room for \(Self.size(manifest.totals.bytes)). That folder has \(Self.size(free)) free.")
            return
        }
        let staging = destinationURL.appendingPathComponent(".restoring-\(manifest.archiveId)", isDirectory: true)
        do {
            try manager.createDirectory(at: staging, withIntermediateDirectories: true)
        } catch {
            fail(&record, "The staging folder couldn't be created: \(Self.reason(error))")
            return
        }
        save(record)
        emitNow(record)

        // Stage and verify every file first: a failed restore leaves the destination untouched.
        do {
            for file in manifest.files {
                if shouldPause {
                    record.state = "paused"
                    record.detail = "Paused while restoring. Restore again to carry on; checked files are not copied twice."
                    save(record)
                    emitNow(record)
                    finished(record.view)
                    return
                }
                guard file.root >= 0, file.root < manifest.roots.count else {
                    throw CopyError.mismatch(file.path)
                }
                let root = manifest.roots[file.root]
                let source = archive
                    .appendingPathComponent("roots", isDirectory: true)
                    .appendingPathComponent(String(format: "%02d-%@", file.root + 1, root.label), isDirectory: true)
                    .appendingPathComponent(file.path, isDirectory: false)
                let target = staging
                    .appendingPathComponent(String(format: "%02d-%@", file.root + 1, root.label), isDirectory: true)
                    .appendingPathComponent(file.path, isDirectory: false)
                record.detail = nil

                let stagedSize = (try? manager.attributesOfItem(atPath: target.path))?[.size] as? NSNumber
                if manager.fileExists(atPath: target.path),
                   stagedSize?.int64Value == file.bytes,
                   (try? Self.sha256(of: target)) == file.sha256 {
                    record.filesDone += 1
                    record.bytesDone += file.bytes
                    throttled(record)
                    continue
                }
                let copied = try Self.copyVerified(from: source, to: target, expect: file.sha256)
                guard copied.sha == file.sha256 else {
                    throw CopyError.mismatch(file.path)
                }
                record.filesDone += 1
                record.bytesDone += file.bytes
                throttled(record)
            }
        } catch {
            fail(&record, "Restore stopped: \(Self.reason(error)) Nothing was replaced; press Restore again to carry on.")
            return
        }

        // Every root is verified. Move each into place, never merging or overwriting.
        record.state = "verifying"
        record.detail = "Moving the checked copy into place."
        emitNow(record)
        var placed: [String] = []
        for (index, root) in manifest.roots.enumerated() {
            let label = String(format: "%02d-%@", index + 1, root.label)
            let staged = staging.appendingPathComponent(label, isDirectory: true)
            guard manager.fileExists(atPath: staged.path) else { continue }
            let wanted = destinationURL.appendingPathComponent(root.label, isDirectory: true)
            let target = Self.freeName(for: wanted, createdAt: manifest.createdAt)
            do {
                try manager.moveItem(at: staged, to: target)
                placed.append(target.lastPathComponent)
            } catch {
                fail(&record, "The checked copy couldn't be moved into place: \(Self.reason(error)) It is still in \(staging.path).")
                return
            }
        }
        try? manager.removeItem(at: staging)
        try? manager.removeItem(at: jobURL(id: record.id, kind: record.kind))

        record.state = "restored"
        record.filesDone = record.filesTotal
        record.bytesDone = record.bytesTotal
        record.detail = placed.isEmpty
            ? nil
            : "Restored \(placed.joined(separator: ", ")) into \(destinationURL.path)."
        emitNow(record)
        finished(record.view)
    }

    private func restoreRecord(archivePath: String, destination: String) -> JobRecord {
        JobRecord(
            id: UUID().uuidString, kind: "restore", name: "Restore", state: "restoring",
            archiveId: URL(fileURLWithPath: archivePath).lastPathComponent,
            directory: archivePath, destination: destination,
            roots: [], slug: "", filesDone: 0, filesTotal: 0, bytesDone: 0, bytesTotal: 0,
            detail: nil
        )
    }

    // MARK: freeing space, and archiving again

    /// Moves the archived channel folder(s) to the Trash — never deleted here, and only when the
    /// archive's own manifest says it was verified. Emptying the Trash is the person's step.
    public struct Freed {
        public var moved: [String]
        public var bytes: Int64
    }

    public enum FreeError: Error, CustomStringConvertible {
        case notVerified(String)
        case missing(String)
        public var description: String {
            switch self {
            case .notVerified(let path):
                return "\(path) has no verified archive manifest, so nothing was moved. Run Archive and let it finish first."
            case .missing(let path):
                return "\(path) isn't there any more, so nothing was moved."
            }
        }
    }

    public static func freeSpace(afterArchiveAt directory: String) throws -> Freed {
        let folder = URL(fileURLWithPath: directory, isDirectory: true)
        guard let data = try? Data(contentsOf: folder.appendingPathComponent("manifest.json")),
              let manifest = try? JSONDecoder().decode(Manifest.self, from: data),
              manifest.state == "verified"
        else { throw FreeError.notVerified(directory) }
        var moved: [String] = []
        let manager = FileManager.default
        for root in manifest.roots {
            let source = URL(fileURLWithPath: root.source, isDirectory: true)
            guard manager.fileExists(atPath: source.path) else { throw FreeError.missing(root.source) }
        }
        // Tests must never write the owner's Trash: with the override set the folder moves into
        // that folder instead. The product path is the real Trash, one call, nothing deleted.
        let override = ProcessInfo.processInfo.environment["STORAGE_STUDIO_TRASH_DIR"] ?? ""
        let trashDir = override.isEmpty ? nil : URL(fileURLWithPath: override, isDirectory: true)
        if let trashDir { try manager.createDirectory(at: trashDir, withIntermediateDirectories: true) }
        for root in manifest.roots {
            let source = URL(fileURLWithPath: root.source, isDirectory: true)
            if let trashDir {
                var target = trashDir.appendingPathComponent(source.lastPathComponent, isDirectory: true)
                if manager.fileExists(atPath: target.path) {
                    target = trashDir.appendingPathComponent("\(source.lastPathComponent)-\(Int(Date().timeIntervalSince1970))", isDirectory: true)
                }
                try manager.moveItem(at: source, to: target)
            } else {
                try manager.trashItem(at: source, resultingItemURL: nil)
            }
            moved.append(root.source)
        }
        return Freed(moved: moved, bytes: manifest.totals.bytes)
    }

    /// The spec an archive's own manifest describes, so "Archive again" works when the row that
    /// made it is gone: the roots and the archive root come from the manifest, not from memory.
    public static func spec(fromManifestAt directory: String, id: String) throws -> ArchiveSpec {
        let folder = URL(fileURLWithPath: directory, isDirectory: true)
        guard let data = try? Data(contentsOf: folder.appendingPathComponent("manifest.json")),
              let manifest = try? JSONDecoder().decode(Manifest.self, from: data)
        else { throw FreeError.notVerified(directory) }
        // <destination>/<slug>/<archive id>
        let destination = folder.deletingLastPathComponent().deletingLastPathComponent().path
        return ArchiveSpec(
            id: id,
            name: manifest.channel.name,
            slug: manifest.channel.slug,
            roots: manifest.roots.map(\.source),
            destination: destination
        )
    }

    // MARK: discovery

    /// Every archive under `root`, found by its own `manifest.json`, so a channel this Mac has
    /// never seen is discoverable by listing folders. Bounded to four levels, no following links.
    public static func scan(root: String) -> [Restorable] {
        let start = URL(fileURLWithPath: root, isDirectory: true)
        var found: [Restorable] = []
        var stack: [(URL, Int)] = [(start, 0)]
        while let (folder, depth) = stack.popLast() {
            guard depth <= 4 else { continue }
            if folder.lastPathComponent == ".trash" || folder.lastPathComponent.hasPrefix(".") {
                continue
            }
            let manifestURL = folder.appendingPathComponent("manifest.json")
            if let data = try? Data(contentsOf: manifestURL),
               let manifest = try? JSONDecoder().decode(Manifest.self, from: data) {
                found.append(Restorable(
                    name: manifest.channel.name,
                    slug: manifest.channel.slug,
                    path: folder.path,
                    createdAt: manifest.createdAt,
                    machine: manifest.machine,
                    files: manifest.totals.files,
                    bytes: manifest.totals.bytes,
                    roots: manifest.roots.map(\.label)
                ))
                continue
            }
            let children = (try? FileManager.default.contentsOfDirectory(
                at: folder, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles]
            )) ?? []
            for child in children {
                let isDirectory = (try? child.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
                if isDirectory { stack.append((child, depth + 1)) }
            }
        }
        return found.sorted { $0.createdAt > $1.createdAt }
    }

    // MARK: walking

    private struct Entries {
        struct Root {
            var kind: String
            var label: String
            var source: String
        }
        struct File {
            var root: Int
            var path: String
            var absolute: String
            var bytes: Int64
            var modified: Double
        }
        var roots: [Root] = []
        var files: [File] = []
        var skipped: [String] = []
    }

    private func walk(_ roots: [String]) -> Entries? {
        var entries = Entries()
        for (index, source) in roots.enumerated() {
            let base = URL(fileURLWithPath: source, isDirectory: true)
            let label = base.lastPathComponent
            entries.roots.append(Entries.Root(kind: index == 0 ? "channel" : "media", label: label, source: source))
            guard let enumerator = FileManager.default.enumerator(
                at: base,
                includingPropertiesForKeys: [.isRegularFileKey, .isDirectoryKey, .fileSizeKey, .contentModificationDateKey],
                options: []
            ) else { return nil }
            for case let item as URL in enumerator {
                let values = try? item.resourceValues(forKeys: [.isRegularFileKey, .isDirectoryKey, .fileSizeKey, .contentModificationDateKey])
                if values?.isDirectory == true { continue }
                if values?.isRegularFile != true {
                    // A folder link or a special file: named, never silently dropped.
                    entries.skipped.append(item.lastPathComponent)
                    continue
                }
                if item.lastPathComponent == ".DS_Store" { continue }
                let size = Int64(values?.fileSize ?? 0)
                let modified = (values?.contentModificationDate ?? Date.distantPast).timeIntervalSince1970
                entries.files.append(Entries.File(
                    root: index,
                    path: relative(item, from: base),
                    absolute: item.path,
                    bytes: size,
                    modified: modified
                ))
            }
        }
        entries.files.sort { ($0.root, $0.path) < ($1.root, $1.path) }
        return entries
    }

    private func relative(_ file: URL, from base: URL) -> String {
        let baseParts = base.standardizedFileURL.pathComponents
        let fileParts = file.standardizedFileURL.pathComponents
        guard fileParts.count > baseParts.count, Array(fileParts.prefix(baseParts.count)) == baseParts else {
            return file.lastPathComponent
        }
        return fileParts.dropFirst(baseParts.count).joined(separator: "/")
    }

    // MARK: copy and verify

    struct Copied {
        var sha: String
        var bytes: Int64
        var modified: Double
        var changed: Bool
    }

    private enum CopyError: Error, CustomStringConvertible {
        case mismatch(String)
        case unreadable(String)
        var description: String {
            switch self {
            case .mismatch(let path): return "\(path) didn't read back the same"
            case .unreadable(let path): return "\(path) couldn't be read"
            }
        }
    }

    /// Reads the source in 1 MiB chunks, hashes the same bytes it writes, renames into place and
    /// then reads the destination back. A file that is still being written while it is copied is
    /// copied once more; if it keeps changing it is reported, never silently short.
    static func copyVerified(from source: URL, to target: URL, expect: String? = nil) throws -> Copied {
        let manager = FileManager.default
        let before = try manager.attributesOfItem(atPath: source.path)
        let beforeSize = (before[.size] as? NSNumber)?.int64Value ?? 0
        let beforeModified = (before[.modificationDate] as? Date) ?? Date.distantPast
        try manager.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
        if manager.fileExists(atPath: target.path) { try manager.removeItem(at: target) }
        let partial = target.appendingPathExtension("partial")
        if manager.fileExists(atPath: partial.path) { try manager.removeItem(at: partial) }

        guard manager.createFile(atPath: partial.path, contents: nil) else {
            throw CopyError.unreadable(source.lastPathComponent)
        }
        let input = try FileHandle(forReadingFrom: source)
        let output = try FileHandle(forWritingTo: partial)
        var hasher = SHA256()
        var bytes: Int64 = 0
        do {
            while let data = try input.read(upToCount: 1 << 20), !data.isEmpty {
                // One pool per chunk so a bridged Data cannot sit in the thread's pool for a whole
                // long transfer. Measured 2026-11-24: this did NOT move the helper's RSS (8.8 MB idle,
                // ~3.4 GB peak for a 3 GiB archive either way; 6 GiB copied peaked lower at 2.7 GB),
                // so the resident pages are not per-iteration allocations. Kept because it is correct
                // and costs one line; the open finding is recorded in lead/0.1.28.
                try autoreleasepool {
                    hasher.update(data: data)
                    try output.write(contentsOf: data)
                    bytes += Int64(data.count)
                }
            }
            try output.synchronize()
        } catch {
            try? input.close()
            try? output.close()
            throw CopyError.unreadable(source.lastPathComponent)
        }
        try? input.close()
        try output.close()
        let digest = hasher.finalize().map { String(format: "%02x", $0) }.joined()
        try manager.setAttributes([.modificationDate: beforeModified], ofItemAtPath: partial.path)
        try manager.moveItem(at: partial, to: target)

        let readBack = try sha256(of: target)
        guard readBack == digest, expect == nil || digest == expect else {
            try? manager.removeItem(at: target)
            throw CopyError.mismatch(source.lastPathComponent)
        }
        let after = try manager.attributesOfItem(atPath: source.path)
        let afterSize = (after[.size] as? NSNumber)?.int64Value ?? 0
        let afterModified = (after[.modificationDate] as? Date) ?? Date.distantPast
        let changed = afterSize != beforeSize || abs(afterModified.timeIntervalSince(beforeModified)) > 0.5
        return Copied(
            sha: digest,
            bytes: bytes,
            modified: beforeModified.timeIntervalSince1970,
            changed: changed
        )
    }

    static func sha256(of url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        var hasher = SHA256()
        do {
            while let data = try handle.read(upToCount: 1 << 20), !data.isEmpty {
                // Same shape as the copy loop, for the same reason; same measurement result.
                autoreleasepool {
                    hasher.update(data: data)
                }
            }
        } catch {
            try? handle.close()
            throw CopyError.unreadable(url.lastPathComponent)
        }
        try? handle.close()
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    // MARK: job plumbing

    private func jobURL(id: String, kind: String = "archive") -> URL {
        jobsDirectory.appendingPathComponent("\(kind)-\(id).json")
    }

    private func save(_ record: JobRecord) {
        let manager = FileManager.default
        try? manager.createDirectory(at: jobsDirectory, withIntermediateDirectories: true)
        guard let data = try? JSONEncoder().encode(record) else { return }
        let url = jobURL(id: record.id, kind: record.kind)
        let temporary = url.appendingPathExtension("tmp")
        try? data.write(to: temporary)
        try? manager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: temporary.path)
        if manager.fileExists(atPath: url.path) {
            _ = try? manager.replaceItemAt(url, withItemAt: temporary)
        } else {
            try? manager.moveItem(at: temporary, to: url)
        }
        try? manager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }

    private func fail(_ record: inout JobRecord, _ reason: String) {
        record.state = "failed"
        record.detail = reason
        save(record)
        emitNow(record)
        finished(record.view)
    }

    /// Progress goes out at most five times a second; a thousand small files must not flood the
    /// window or the app's event loop.
    private func throttled(_ record: JobRecord) {
        guard Date().timeIntervalSince(lastEmit) >= 0.2 else { return }
        emitNow(record)
    }

    private func emitNow(_ record: JobRecord) {
        lastEmit = Date()
        emit(record.view)
    }

    private func readJournal(_ directory: URL) -> [String: Manifest.File] {
        let url = directory.appendingPathComponent("manifest.partial.jsonl")
        guard let text = try? String(contentsOf: url, encoding: .utf8) else { return [:] }
        var journal: [String: Manifest.File] = [:]
        for line in text.split(separator: "\n") {
            guard let data = line.data(using: .utf8),
                  let file = try? JSONDecoder().decode(Manifest.File.self, from: data)
            else { continue }
            journal["\(file.root)/\(file.path)"] = file
        }
        return journal
    }

    private func appendJournal(_ file: Manifest.File, to url: URL) {
        let manager = FileManager.default
        guard let data = try? JSONEncoder().encode(file), var line = String(data: data, encoding: .utf8) else {
            return
        }
        line += "\n"
        if !manager.fileExists(atPath: url.path) {
            manager.createFile(atPath: url.path, contents: nil, attributes: [.posixPermissions: 0o600])
        }
        guard let handle = try? FileHandle(forWritingTo: url) else { return }
        _ = try? handle.seekToEnd()
        try? handle.write(contentsOf: Data(line.utf8))
        try? handle.synchronize()
        try? handle.close()
    }

    private func writeManifest(_ manifest: Manifest, to url: URL) throws {
        let data = try JSONEncoder().encode(manifest)
        let temporary = url.appendingPathExtension("partial")
        try data.write(to: temporary)
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: temporary.path)
        try FileManager.default.moveItem(at: temporary, to: url)
    }

    /// A resumed job is only trusted when its destination is the same device as now: a share that
    /// came back as another mount must not be appended to.
    private func matchesDevice(_ directory: String, _ destination: String) -> Bool {
        let manager = FileManager.default
        guard manager.fileExists(atPath: directory) else { return false }
        let a = (try? manager.attributesOfItem(atPath: directory))?[.systemNumber] as? NSNumber
        let b = (try? manager.attributesOfItem(atPath: destination))?[.systemNumber] as? NSNumber
        return a != nil && a == b
    }

    // MARK: small helpers

    static func newArchiveId() -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyyMMdd'T'HHmmss'Z'"
        let suffix = String(format: "%04x", Int.random(in: 0...0xffff))
        return "\(formatter.string(from: Date()))-\(suffix)"
    }

    static func iso(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: date)
    }

    static func freeSpace(at url: URL) -> Int64? {
        let values = try? url.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
        if let capacity = values?.volumeAvailableCapacityForImportantUsage { return capacity }
        let attributes = try? FileManager.default.attributesOfFileSystem(forPath: url.path)
        return (attributes?[.systemFreeSize] as? NSNumber)?.int64Value
    }

    static func size(_ bytes: Int64) -> String {
        ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)
    }

    static func reason(_ error: Error) -> String {
        if let copy = error as? CopyError { return copy.description }
        if let free = error as? FreeError { return free.description }
        return (error as NSError).localizedDescription
    }

    /// Never overwrite and never merge: a second copy of the same folder gets a dated name.
    static func freeName(for url: URL, createdAt: String) -> URL {
        let manager = FileManager.default
        guard manager.fileExists(atPath: url.path) else { return url }
        let stamp = createdAt.prefix(10)
        let readable: String
        if let date = ISO8601DateFormatter().date(from: createdAt) {
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_GB")
            formatter.dateFormat = "d MMM yyyy"
            readable = formatter.string(from: date)
        } else {
            readable = String(stamp)
        }
        let candidate = url.deletingLastPathComponent()
            .appendingPathComponent("\(url.lastPathComponent) (archived \(readable))", isDirectory: true)
        if !manager.fileExists(atPath: candidate.path) { return candidate }
        return url.deletingLastPathComponent()
            .appendingPathComponent("\(url.lastPathComponent) (archived \(readable) 2)", isDirectory: true)
    }
}
