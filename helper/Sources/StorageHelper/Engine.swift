import Foundation
import Network

/// Watches storage, mounts and unmounts it, and reports plain states. One watcher
/// (a single 5-second tick plus the system path monitor) for every storage; retries
/// are bounded per storage and stop with "needs attention".
public final class Engine {
    public typealias Emitter = (Data) -> Void

    private let emit: Emitter
    private let queue = DispatchQueue(label: "app.storagestudiokh.helper.engine")
    private let environment = ProcessInfo.processInfo.environment

    private var storages: [Storage] = []
    private var states: [String: StorageState] = [:]
    private var attempts: [String: Int] = [:]
    private var scheduled: [String: DispatchWorkItem] = [:]
    private var retries = 3
    private var configured = false
    private var inFlight = Set<String>()

    private var ticker: DispatchSourceTimer?
    private var monitor: NWPathMonitor?
    private var lastSample = SleepDetector.Sample(wall: 0, monotonic: 0)
    private var lastMountScan = Date.distantPast
    private var lastVolumeScan = Date.distantPast
    private var volumeSnapshot: [VolumeCandidate] = []
    private var wakeWork: DispatchWorkItem?
    private var networkWork: DispatchWorkItem?
    private var networkSignature: String?

    public init(emit: @escaping Emitter) {
        self.emit = emit
    }

    // MARK: lifecycle

    public func start() {
        queue.async {
            self.lastSample = self.sample()
            self.startTicker()
            self.startNetworkMonitor()
            self.emit(Event.log(level: "info", message: "helper started").json)
        }
    }

    public func handle(_ command: Command) {
        queue.async { self.handleOnQueue(command) }
    }

    public func stop() {
        queue.sync {
            self.ticker?.cancel()
            self.monitor?.cancel()
            for work in self.scheduled.values { work.cancel() }
            self.scheduled.removeAll()
        }
    }

    private func handleOnQueue(_ command: Command) {
        switch command.type {
        case "configure":
            configure(command)
        case "mount":
            if let storage = storage(command.id) { mountNow(storage) }
        case "mount_all":
            for storage in storages { mountNow(storage) }
        case "unmount":
            if let storage = storage(command.id) { unmount(storage) }
        case "test":
            if let storage = storage(command.id) { test(storage) }
        case "refresh":
            refreshMountStates()
            refreshVolumes(force: true)
        case "list_shares":
            guard let host = command.host, !host.isEmpty else {
                emit(Event.shares(host: "", shares: [], needsCredentials: false, error: "Enter a device address first.").json)
                return
            }
            let credentials: Keychain.Credentials?
            if let username = command.username, let password = command.password, !username.isEmpty, !password.isEmpty {
                credentials = Keychain.Credentials(username: username, password: password)
            } else {
                credentials = nil
            }
            let result = ShareLister.list(host: host, credentials: credentials)
            emit(Event.shares(
                host: host,
                shares: result.shares,
                needsCredentials: result.needsCredentials,
                error: result.error
            ).json)
        case "credentials":
            if let storage = storage(command.id) {
                let credentials = Keychain.Credentials(
                    username: command.username ?? storage.username ?? "",
                    password: command.password ?? ""
                )
                let status = Keychain.save(id: storage.id, credentials: credentials)
                if status != errSecSuccess {
                    emit(Event.log(level: "warn", message: "The Keychain refused the password for \(storage.name) (status \(status)); it was not saved.").json)
                }
                mountNow(storage)
            }
        case "forget_credentials":
            if let id = command.id {
                Keychain.delete(id: id)
                announce()
            }
        case "quit":
            exit(0)
        default:
            emit(Event.log(level: "warn", message: "unknown command \(command.type)").json)
        }
    }

    // MARK: configuration

    private func configure(_ command: Command) {
        retries = RetryPolicy.retryCount(command.retries ?? 3)
        let previousIds = Set(storages.map(\.id))
        storages = command.storages ?? []
        let ids = Set(storages.map(\.id))
        for (id, work) in scheduled where !ids.contains(id) {
            work.cancel()
            scheduled[id] = nil
        }
        var next: [String: StorageState] = [:]
        let table = MountTable.current()
        for storage in storages {
            if let entry = mountedEntry(storage, in: table) {
                next[storage.id] = StorageState(id: storage.id, status: .mounted, detail: nil, mountedPath: entry.mountPoint, hasCredentials: Keychain.has(id: storage.id))
            } else if var existing = states[storage.id], existing.status != .notMounted {
                // Keep Needs attention / Retrying while the owner edits another setting.
                if existing.status == .mounted || existing.mountedPath != nil {
                    existing.status = .notMounted
                    existing.detail = "It disconnected."
                    existing.mountedPath = nil
                }
                next[storage.id] = existing
            } else {
                next[storage.id] = StorageState(id: storage.id, status: .notMounted, detail: nil, mountedPath: nil, hasCredentials: Keychain.has(id: storage.id))
            }
        }
        states = next
        announce()
        refreshVolumes(force: true)

        if configured {
            // A storage just added in Settings connects now, without waiting for a wake.
            for storage in storages where !previousIds.contains(storage.id) && (storage.reconnectAtLogin || storage.reconnectAfterWake) {
                if states[storage.id]?.status != .mounted { begin(storage) }
            }
            return
        }
        configured = true
        // Login (or first launch): reconnect the storage the owner asked to restore.
        for storage in storages where storage.reconnectAtLogin {
            if states[storage.id]?.status != .mounted && states[storage.id]?.status != .needsAttention {
                begin(storage)
            }
        }
    }

    // MARK: actions

    private func mountNow(_ storage: Storage) {
        attempts[storage.id] = 0
        scheduled[storage.id]?.cancel()
        scheduled[storage.id] = nil
        begin(storage)
    }

    private func begin(_ storage: Storage) {
        guard !inFlight.contains(storage.id) else { return }
        if let entry = mountedEntry(storage, in: MountTable.current()) {
            markMounted(storage, path: entry.mountPoint)
            return
        }
        inFlight.insert(storage.id)
        set(storage, .mounting, detail: nil)
        let failure = performMount(storage)
        inFlight.remove(storage.id)
        if let failure {
            failed(storage, failure)
        } else if let entry = mountedEntry(storage, in: MountTable.current()) {
            markMounted(storage, path: entry.mountPoint)
        } else {
            failed(storage, MountFailure(message: "The connection didn't appear after mounting."))
        }
    }

    /// An attached disk counts as mounted only when the volume at that folder is the one
    /// the owner chose, not merely another disk with the same name.
    private func mountedEntry(_ storage: Storage, in table: [MountedVolume]) -> MountedVolume? {
        guard let entry = MountTable.entry(for: storage, in: table) else { return nil }
        if storage.kind == "volume", let uuid = storage.volumeUUID, !uuid.isEmpty {
            if let actual = Volumes.volumeUUID(at: entry.mountPoint), actual.caseInsensitiveCompare(uuid) != .orderedSame {
                return nil
            }
        }
        return entry
    }

    private func performMount(_ storage: Storage) -> MountFailure? {
        switch storage.kind {
        case "smb":
            guard let host = Reachability.smbHost(storage.target) else {
                return MountFailure(message: "The share address isn't valid.")
            }
            guard Reachability.tcp(host: host, port: 445) else {
                return MountFailure(message: "Can't reach \(host) right now.", unreachable: true)
            }
            return NetFS.mountSMB(storage: storage, credentials: Keychain.load(id: storage.id))
        case "volume":
            guard let uuid = storage.volumeUUID, !uuid.isEmpty else {
                return MountFailure(message: "This disk has no saved identity; choose it again in Settings.")
            }
            guard let device = Volumes.device(forUUID: uuid) else {
                return MountFailure(message: "The disk isn't connected.", unreachable: true)
            }
            return Volumes.mount(device: device)
        default:
            return MountFailure(message: "This kind of storage isn't supported yet.")
        }
    }

    private func unmount(_ storage: Storage) {
        scheduled[storage.id]?.cancel()
        scheduled[storage.id] = nil
        attempts[storage.id] = 0
        guard let entry = mountedEntry(storage, in: MountTable.current()) else {
            if let other = MountTable.entry(for: storage, in: MountTable.current()) {
                set(storage, .notMounted, detail: "A different disk is mounted at \(other.mountPoint); nothing was disconnected.")
            } else {
                set(storage, .notMounted)
            }
            return
        }
        var result = Shell.run("/sbin/umount", [entry.mountPoint], timeout: 30)
        if result.status != 0 {
            result = Shell.run("/usr/sbin/diskutil", ["unmount", entry.mountPoint], timeout: 30)
        }
        if result.status == 0 {
            set(storage, .notMounted, detail: "Disconnected just now.")
        } else {
            let reason = result.error.isEmpty ? "macOS wouldn't disconnect it." : result.error
            set(storage, .mounted, detail: reason, path: entry.mountPoint)
        }
    }

    private func test(_ storage: Storage) {
        if let entry = mountedEntry(storage, in: MountTable.current()) {
            set(storage, .mounted, detail: "Connected at \(entry.mountPoint).", path: entry.mountPoint)
            return
        }
        switch storage.kind {
        case "smb":
            guard let host = Reachability.smbHost(storage.target) else {
                set(storage, .unreachable, detail: "The share address isn't valid.")
                return
            }
            if Reachability.tcp(host: host, port: 445) {
                set(storage, .notMounted, detail: "\(host) is reachable and ready to mount.")
            } else {
                set(storage, .unreachable, detail: "Can't reach \(host) right now.")
            }
        default:
            guard let uuid = storage.volumeUUID else {
                set(storage, .unreachable, detail: "This disk has no saved identity; choose it again in Settings.")
                return
            }
            if Volumes.device(forUUID: uuid) != nil {
                set(storage, .notMounted, detail: "The disk is connected and ready to mount.")
            } else {
                set(storage, .unreachable, detail: "The disk isn't connected.")
            }
        }
    }

    // MARK: outcomes

    private func markMounted(_ storage: Storage, path: String) {
        let wasTrouble = [StorageStatus.needsAttention, .unreachable, .retrying].contains(states[storage.id]?.status)
        attempts[storage.id] = 0
        scheduled[storage.id]?.cancel()
        scheduled[storage.id] = nil
        set(storage, .mounted, detail: nil, path: path)
        if wasTrouble {
            emit(Event.recovered(id: storage.id, name: storage.name).json)
        }
    }

    private func failed(_ storage: Storage, _ failure: MountFailure) {
        let previous = states[storage.id]?.status
        let attempt = (attempts[storage.id] ?? 0) + 1
        attempts[storage.id] = attempt
        if failure.needsCredentials {
            emit(Event.needsCredentials(id: storage.id, name: storage.name).json)
        }
        if attempt <= retries, let wait = retryDelay(attempt) {
            let retryState: StorageStatus = failure.unreachable ? .unreachable : .retrying
            let when = wait >= 1 ? "Retrying in \(Int(wait)) s." : "Retrying…"
            set(storage, retryState, detail: "\(failure.message) \(when)")
            let work = DispatchWorkItem { [weak self] in
                guard let self, let current = self.storage(storage.id) else { return }
                if self.states[storage.id]?.status != .mounted { self.begin(current) }
            }
            scheduled[storage.id]?.cancel()
            scheduled[storage.id] = work
            queue.asyncAfter(deadline: .now() + wait, execute: work)
        } else {
            set(storage, .needsAttention, detail: failure.message)
            if previous != .needsAttention {
                emit(Event.attention(id: storage.id, name: storage.name, reason: failure.message).json)
            }
        }
    }

    private func retryDelay(_ attempt: Int) -> TimeInterval? {
        if let raw = environment["STORAGE_STUDIO_RETRY_DELAYS"], !raw.isEmpty {
            let values = raw.split(separator: ",").compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
            if attempt >= 1, attempt <= values.count { return values[attempt - 1] }
            return nil
        }
        return RetryPolicy.delay(afterFailure: attempt)
    }

    // MARK: watching

    private func startTicker() {
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + 5, repeating: 5)
        timer.setEventHandler { [weak self] in self?.tick() }
        timer.resume()
        ticker = timer
    }

    private func startNetworkMonitor() {
        let monitor = NWPathMonitor()
        monitor.pathUpdateHandler = { [weak self] path in
            guard let self else { return }
            let signature = "\(path.status == .satisfied):" + path.availableInterfaces.map(\.name).joined(separator: ",")
            self.queue.async {
                // The first callback describes the network we are already on, not a change.
                let previous = self.networkSignature
                self.networkSignature = signature
                guard previous != nil, previous != signature, path.status == .satisfied else { return }
                self.networkWork?.cancel()
                let work = DispatchWorkItem {
                    for storage in self.storages where storage.reconnectAfterWake {
                        if self.states[storage.id]?.status != .mounted && self.states[storage.id]?.status != .needsAttention {
                            self.begin(storage)
                        }
                    }
                }
                self.networkWork = work
                self.queue.asyncAfter(deadline: .now() + 3, execute: work)
            }
        }
        monitor.start(queue: DispatchQueue(label: "app.storagestudiokh.helper.network"))
        self.monitor = monitor
    }

    private func tick() {
        let now = sample()
        if SleepDetector.didWake(from: lastSample, to: now) {
            emit(Event.log(level: "info", message: "wake detected").json)
            wakeWork?.cancel()
            let work = DispatchWorkItem { [weak self] in
                guard let self else { return }
                for storage in self.storages where storage.reconnectAfterWake {
                    if self.states[storage.id]?.status != .mounted && self.states[storage.id]?.status != .needsAttention {
                        self.begin(storage)
                    }
                }
            }
            wakeWork = work
            queue.asyncAfter(deadline: .now() + 5, execute: work)
        }
        lastSample = now

        if Date().timeIntervalSince(lastMountScan) >= 15 {
            lastMountScan = Date()
            refreshMountStates()
        }
        if Date().timeIntervalSince(lastVolumeScan) >= 60 {
            refreshVolumes(force: false)
        }
    }

    private func refreshMountStates() {
        let table = MountTable.current()
        var changed = false
        for storage in storages {
            let entry = mountedEntry(storage, in: table)
            let current = states[storage.id]
            if let entry, current?.status != .mounted || current?.mountedPath != entry.mountPoint {
                // Mounted in Finder or by another app: reflect it, never mount twice.
                attempts[storage.id] = 0
                scheduled[storage.id]?.cancel()
                scheduled[storage.id] = nil
                states[storage.id] = StorageState(id: storage.id, status: .mounted, detail: nil, mountedPath: entry.mountPoint, hasCredentials: Keychain.has(id: storage.id))
                changed = true
            } else if entry == nil, current?.status == .mounted {
                states[storage.id] = StorageState(id: storage.id, status: .notMounted, detail: "It disconnected.", mountedPath: nil, hasCredentials: Keychain.has(id: storage.id))
                changed = true
            }
        }
        if changed { announce() }
    }

    private func refreshVolumes(force: Bool) {
        lastVolumeScan = Date()
        let candidates = Volumes.candidates()
        if force || candidates != volumeSnapshot {
            volumeSnapshot = candidates
            emit(Event.volumes(candidates).json)
        }
    }

    // MARK: plumbing

    private func storage(_ id: String?) -> Storage? {
        guard let id else { return nil }
        return storages.first { $0.id == id }
    }

    private func sample() -> SleepDetector.Sample {
        SleepDetector.Sample(wall: Date().timeIntervalSince1970, monotonic: ProcessInfo.processInfo.systemUptime)
    }

    private func set(_ storage: Storage, _ status: StorageStatus, detail: String? = nil, path: String? = nil) {
        let previous = states[storage.id]
        if previous?.status == status, previous?.detail == detail, previous?.mountedPath == path { return }
        states[storage.id] = StorageState(
            id: storage.id,
            status: status,
            detail: detail,
            mountedPath: path,
            hasCredentials: Keychain.has(id: storage.id)
        )
        announce()
    }

    private func announce() {
        let items = storages.map { storage -> StorageState in
            var state = states[storage.id] ?? StorageState(
                id: storage.id, status: .notMounted, detail: nil, mountedPath: nil,
                hasCredentials: false
            )
            state.hasCredentials = Keychain.has(id: storage.id)
            return state
        }
        emit(Event.state(items).json)
    }
}
