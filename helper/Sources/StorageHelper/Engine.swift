import Foundation
import Network

/// Watches storage, mounts and unmounts it, and reports plain states. One watcher
/// (a single 5-second tick plus the system path monitor) for every storage; retries
/// are bounded per storage and stop with "needs attention".
public final class Engine {
    public typealias Emitter = (Data) -> Void

    private let emit: Emitter
    private let queue = DispatchQueue(label: "app.storagestudiokh.helper.engine")
    /// Mounts run here, never on `queue`: a wedged NetFS call must not block commands or a hold.
    private let mountQueue = DispatchQueue(label: "app.storagestudiokh.helper.mount", attributes: .concurrent)
    private let environment = ProcessInfo.processInfo.environment

    private var storages: [Storage] = []
    private var states: [String: StorageState] = [:]
    private var attempts: [String: Int] = [:]
    private var scheduled: [String: DispatchWorkItem] = [:]
    private var retries = 3
    private var configured = false
    private var inFlight = Set<String>()
    /// Which attempt owns a row's current mount call, so a late answer cannot overwrite a newer one.
    private var attemptToken: [String: UInt64] = [:]
    private var nextToken: UInt64 = 0
    /// Attempts that ran past their budget; only a late success may be adopted.
    private var expiredToken: [String: UInt64] = [:]
    /// Replaced by a test to stand in for a share that accepts the connection and never answers.
    var mountAttempt: ((Storage) -> MountFailure?)?
    /// Stand-ins for the other two device calls, so a test can prove neither blocks the engine.
    var listShares: ((String, Secrets.Credentials?) -> ShareLister.Result)?
    var unmountAttempt: ((MountedVolume) -> Shell.Result)?
    /// Which browse owns a host's answer: a newer browse supersedes an older one.
    private var listToken: [String: UInt64] = [:]
    /// Unmounts running now, so a second request cannot race the first off the engine queue.
    private var unmounting = Set<String>()
    /// A save that failed, said in the row once the storage is connected. Cleared by the next save.
    private var notice: [String: String] = [:]
    /// Claims this process will retry: timers survive a restart, a login-only label does not.
    private var queued = Set<String>()
    /// Held for an update: no new attempt starts. In memory only, so a restart takes work again.
    private var paused = false
    private var deferred = Set<String>()

    private var ticker: DispatchSourceTimer?
    private var monitor: NWPathMonitor?
    private var lastSample = SleepDetector.Sample(wall: 0, monotonic: 0)
    private var lastMountScan = Date.distantPast
    private var lastVolumeScan = Date.distantPast
    private var volumeSnapshot: [VolumeCandidate] = []
    private var shareSnapshot: [ShareCandidate] = []
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
        case "cancel":
            if let storage = storage(command.id) { cancel(storage) }
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
            let credentials: Secrets.Credentials?
            if let username = command.username, let password = command.password, !username.isEmpty, !password.isEmpty {
                credentials = Secrets.Credentials(username: username, password: password)
            } else {
                credentials = nil
            }
            // smbutil is a device call with a 15 s ceiling of its own: it runs off `queue`, so a
            // slow server cannot stop the ticker, a Stop trying or an update hold.
            nextToken += 1
            let token = nextToken
            listToken[host] = token
            let lister = listShares ?? ShareLister.list
            mountQueue.async { [weak self] in
                let result = lister(host, credentials)
                guard let self else { return }
                self.queue.async { self.finishList(host, token, result) }
            }
        case "credentials":
            if let storage = storage(command.id) {
                let credentials = Secrets.Credentials(
                    username: command.username ?? storage.username ?? "",
                    password: command.password ?? ""
                )
                let host = Reachability.smbHost(storage.target) ?? ""
                if Secrets.save(host: host, username: credentials.username, password: credentials.password) {
                    notice[storage.id] = nil
                } else {
                    emit(Event.log(level: "warn", message: "Storage Studio KH couldn't save the password for \(storage.name); check the app's data folder.").json)
                    notice[storage.id] = passwordSaveNotice()
                }
                mountNow(storage)
            }
        case "forget_credentials":
            if let id = command.id, let storage = storage(id) {
                if let host = Reachability.smbHost(storage.target) {
                    // An explicit user name lets the app forget the previous identity on a change.
                    Secrets.forget(host: host, username: command.username ?? storage.username)
                }
                notice[id] = nil
                announce()
            }
        case "hold":
            hold()
        case "resume":
            resume()
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
                next[storage.id] = StorageState(id: storage.id, status: .mounted, detail: nil, mountedPath: entry.mountPoint, hasCredentials: hasCredentials(storage))
            } else if var existing = states[storage.id], existing.status != .notMounted {
                // Keep Needs attention / Retrying while the owner edits another setting.
                if existing.status == .mounted || existing.mountedPath != nil {
                    existing.status = .notMounted
                    existing.detail = "It disconnected."
                    existing.mountedPath = nil
                }
                next[storage.id] = existing
            } else {
                next[storage.id] = StorageState(id: storage.id, status: .notMounted, detail: nil, mountedPath: nil, hasCredentials: hasCredentials(storage))
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

    /// An update is about to replace this app: claim nothing new until `resume`.
    private func hold() {
        guard !paused else { return }
        paused = true
        emit(Event.log(level: "info", message: "holding new work for an update").json)
        announce()
    }

    /// The pause ended (the installer said so, or it expired). Work it deferred starts again
    /// by itself — no operator step, and a restart is just as unpaused.
    private func resume() {
        guard paused else { return }
        paused = false
        let waiting = deferred.sorted()
        deferred.removeAll()
        queued.formUnion(waiting)
        emit(Event.log(level: "info", message: "resumed; new work is accepted again").json)
        announce()
        for id in waiting {
            if let storage = storage(id), states[id]?.status != .mounted { begin(storage) }
        }
    }

    private func mountNow(_ storage: Storage) {
        attempts[storage.id] = 0
        scheduled[storage.id]?.cancel()
        scheduled[storage.id] = nil
        begin(storage)
    }

    private func begin(_ storage: Storage) {
        guard !inFlight.contains(storage.id) else { return }
        if paused {
            // Held for an update: nothing starts. The storage id is kept and re-run on resume.
            deferred.insert(storage.id)
            queued.insert(storage.id)
            announce()
            return
        }
        if let entry = mountedEntry(storage, in: MountTable.current()) {
            markMounted(storage, path: entry.mountPoint)
            return
        }
        nextToken += 1
        let token = nextToken
        attemptToken[storage.id] = token
        inFlight.insert(storage.id)
        set(storage, .mounting, detail: nil)
        // NetFS has no ceiling of its own: this deadline is the row's, and it never blocks
        // the engine queue, so a wedged share cannot freeze commands or an update hold.
        let budget = MountBudget.seconds(environment["STORAGE_STUDIO_MOUNT_BUDGET_S"])
        queue.asyncAfter(deadline: .now() + budget) { [weak self] in
            self?.expire(storage, token, budget)
        }
        let attempt = mountAttempt
        mountQueue.async { [weak self] in
            guard let self else { return }
            let failure: MountFailure?
            if let attempt { failure = attempt(storage) } else { failure = self.performMount(storage) }
            self.queue.async { self.finish(storage, token, failure) }
        }
    }

    /// The attempt ran past its budget. Its late answer is ignored except for a success,
    /// which `finish` adopts beside this verdict; nothing retries on its own.
    private func expire(_ storage: Storage, _ token: UInt64, _ budget: TimeInterval) {
        guard attemptToken[storage.id] == token, inFlight.remove(storage.id) != nil else { return }
        guard let current = self.storage(storage.id) else {
            attemptToken[storage.id] = nil
            return
        }
        expiredToken[storage.id] = token
        let reason = failureText(current, MountFailure(message: "It didn't answer within \(Int(budget)) s.")) + " Mount now starts again."
        set(current, .needsAttention, detail: reason)
        emit(Event.attention(id: current.id, name: current.name, reason: reason).json)
    }

    private func finish(_ storage: Storage, _ token: UInt64, _ failure: MountFailure?) {
        guard attemptToken[storage.id] == token else { return }
        guard let current = self.storage(storage.id) else {
            // Removed while its mount ran: nothing to report, and nothing may stay in flight.
            inFlight.remove(storage.id)
            attemptToken[storage.id] = nil
            expiredToken[storage.id] = nil
            return
        }
        if inFlight.remove(storage.id) != nil {
            attemptToken[storage.id] = nil
            if let failure {
                failed(current, failure)
            } else if let entry = mountedEntry(current, in: MountTable.current()) {
                markMounted(current, path: entry.mountPoint)
            } else {
                failed(current, MountFailure(message: "The connection didn't appear after mounting."))
            }
            return
        }
        // Past the deadline: a real mount is adopted; a late failure changes nothing.
        guard expiredToken[storage.id] == token else { return }
        expiredToken[storage.id] = nil
        attemptToken[storage.id] = nil
        if failure == nil, let entry = mountedEntry(current, in: MountTable.current()) {
            markMounted(current, path: entry.mountPoint)
        }
    }

    /// A browse's answer, adopted only while it still owns its host. A newer Browse reclaims the
    /// row, and the older answer is dropped instead of landing over it.
    private func finishList(_ host: String, _ token: UInt64, _ result: ShareLister.Result) {
        guard listToken[host] == token else { return }
        listToken[host] = nil
        emit(Event.shares(
            host: host,
            shares: result.shares,
            needsCredentials: result.needsCredentials,
            error: result.error
        ).json)
    }

    /// Stop trying: a waiting retry is dropped and a running attempt's answer is no longer
    /// believed. The call itself cannot be cancelled inside NetFS, so the mount table, read
    /// every 15 s, still reflects a connection that lands late.
    private func cancel(_ storage: Storage) {
        let status = states[storage.id]?.status
        // Only a real attempt or a waiting retry can be stopped; a Test's verdict is not work.
        guard inFlight.contains(storage.id) || scheduled[storage.id] != nil,
              status == .mounting || status == .retrying || status == .unreachable
        else { return }
        scheduled[storage.id]?.cancel()
        scheduled[storage.id] = nil
        attempts[storage.id] = 0
        queued.remove(storage.id)
        deferred.remove(storage.id)
        attemptToken[storage.id] = nil
        expiredToken[storage.id] = nil
        inFlight.remove(storage.id)
        set(storage, .notMounted, detail: "Stopped trying. Mount now starts again.")
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
            // Only this app's own item is ever read. A missing password goes straight to the
            // in-window prompt; nothing consults another app's saved credential.
            switch Secrets.load(host: host, username: storage.username) {
            case .found(let credentials):
                return NetFS.mountSMB(storage: storage, credentials: credentials)
            case .unreadable:
                return MountFailure(
                    message: "Storage Studio KH couldn't read its saved password. Enter it again in Settings.",
                    needsCredentials: true
                )
            case .missing:
                let user = (storage.username ?? "").trimmingCharacters(in: .whitespaces)
                if user.isEmpty {
                    return NetFS.mountSMB(storage: storage, credentials: nil) // guest share
                }
                return MountFailure(
                    message: "The device needs a user name and password. Enter them in Settings — Storage Studio KH will remember them.",
                    needsCredentials: true
                )
            }
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
        // A wedged drive holds umount for up to 30 s and diskutil for another 30: both run off
        // `queue`, so the rest of the app keeps answering while the drive is let go.
        guard unmounting.insert(storage.id).inserted else { return }
        let runner = unmountAttempt
        mountQueue.async { [weak self] in
            var result = runner?(entry) ?? Shell.run("/sbin/umount", [entry.mountPoint], timeout: 30)
            if runner == nil, result.status != 0 {
                result = Shell.run("/usr/sbin/diskutil", ["unmount", entry.mountPoint], timeout: 30)
            }
            guard let self else { return }
            self.queue.async { self.finishUnmount(storage.id, entry.mountPoint, result) }
        }
    }

    private func finishUnmount(_ id: String, _ mountPoint: String, _ result: Shell.Result) {
        unmounting.remove(id)
        guard let current = storage(id) else { return }
        if result.status == 0 {
            set(current, .notMounted, detail: "Disconnected just now.")
        } else {
            let reason = result.error.isEmpty ? "macOS wouldn't disconnect it." : result.error
            set(current, .mounted, detail: reason, path: mountPoint)
        }
    }

    private func test(_ storage: Storage) {
        // A Test always answers, even when the result is identical to the last one.
        func report(_ status: StorageStatus, detail: String, path: String? = nil) {
            set(storage, status, detail: detail, path: path)
            announce()
        }
        if let entry = mountedEntry(storage, in: MountTable.current()) {
            report(.mounted, detail: "Connected at \(entry.mountPoint).", path: entry.mountPoint)
            return
        }
        switch storage.kind {
        case "smb":
            guard let host = Reachability.smbHost(storage.target) else {
                report(.unreachable, detail: "The share address isn't valid.")
                return
            }
            if Reachability.tcp(host: host, port: 445) {
                report(.notMounted, detail: "\(host) is reachable and ready to mount.")
            } else {
                report(.unreachable, detail: "Can't reach \(host) right now.")
            }
        default:
            guard let uuid = storage.volumeUUID else {
                report(.unreachable, detail: "This disk has no saved identity; choose it again in Settings.")
                return
            }
            if Volumes.device(forUUID: uuid) != nil {
                report(.notMounted, detail: "The disk is connected and ready to mount.")
            } else {
                report(.unreachable, detail: "The disk isn't connected.")
            }
        }
    }

    // MARK: outcomes

    private func markMounted(_ storage: Storage, path: String) {
        let wasTrouble = [StorageStatus.needsAttention, .unreachable, .retrying].contains(states[storage.id]?.status)
        attempts[storage.id] = 0
        scheduled[storage.id]?.cancel()
        scheduled[storage.id] = nil
        queued.remove(storage.id)
        deferred.remove(storage.id)
        set(storage, .mounted, detail: notice[storage.id], path: path)
        if wasTrouble {
            emit(Event.recovered(id: storage.id, name: storage.name).json)
        }
    }

    /// A full or read-only disk must not be a quiet failure: the row says it, with the number.
    private func passwordSaveNotice() -> String {
        guard let free = Secrets.freeSpace() else {
            return "The password wasn't saved, so it will be asked for again."
        }
        let text = ByteCountFormatter.string(fromByteCount: free, countStyle: .file)
        return "The password wasn't saved, so it will be asked for again. The startup disk has \(text) free."
    }

    /// The row must say which address was tried, not just that something failed.
    private func failureText(_ storage: Storage, _ failure: MountFailure) -> String {
        if storage.kind == "smb" {
            let readable = storage.target.removingPercentEncoding ?? storage.target
            return "\(failure.message) Address tried: \(readable)"
        }
        return failure.message
    }

    private func failed(_ storage: Storage, _ failure: MountFailure) {
        let previous = states[storage.id]?.status
        let attempt = (attempts[storage.id] ?? 0) + 1
        attempts[storage.id] = attempt
        if failure.needsCredentials {
            // Retrying without a password cannot help; ask once and stop.
            attempts[storage.id] = 0
            scheduled[storage.id]?.cancel()
            scheduled[storage.id] = nil
            queued.remove(storage.id)
            let reason = failureText(storage, failure)
            set(storage, .needsAttention, detail: reason)
            emit(Event.needsCredentials(id: storage.id, name: storage.name).json)
            return
        }
        queued.remove(storage.id)
        let reason = failureText(storage, failure)
        if attempt <= retries, let wait = retryDelay(attempt) {
            let retryState: StorageStatus = failure.unreachable ? .unreachable : .retrying
            let when = wait >= 1 ? "Retrying in \(Int(wait)) s." : "Retrying…"
            set(storage, retryState, detail: "\(reason) \(when)")
            let work = DispatchWorkItem { [weak self] in
                guard let self, let current = self.storage(storage.id) else { return }
                // It has fired: it is no longer queued (a held retry lands in `deferred` instead).
                self.scheduled[storage.id] = nil
                if self.states[storage.id]?.status != .mounted { self.begin(current) }
            }
            scheduled[storage.id]?.cancel()
            scheduled[storage.id] = work
            queued.insert(storage.id)
            queue.asyncAfter(deadline: .now() + wait, execute: work)
        } else {
            set(storage, .needsAttention, detail: reason)
            if previous != .needsAttention {
                emit(Event.attention(id: storage.id, name: storage.name, reason: reason).json)
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
        let candidates = SMBMounts.candidates(from: table)
        if candidates != shareSnapshot {
            shareSnapshot = candidates
            emit(Event.smbMounts(candidates).json)
        }
        var changed = false
        for storage in storages {
            let entry = mountedEntry(storage, in: table)
            let current = states[storage.id]
            if let entry, current?.status != .mounted || current?.mountedPath != entry.mountPoint {
                // Mounted in Finder or by another app: reflect it, never mount twice.
                attempts[storage.id] = 0
                scheduled[storage.id]?.cancel()
                scheduled[storage.id] = nil
                states[storage.id] = StorageState(id: storage.id, status: .mounted, detail: nil, mountedPath: entry.mountPoint, hasCredentials: hasCredentials(storage))
                changed = true
            } else if entry == nil, current?.status == .mounted {
                states[storage.id] = StorageState(id: storage.id, status: .notMounted, detail: "It disconnected.", mountedPath: nil, hasCredentials: hasCredentials(storage))
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

    private func hasCredentials(_ storage: Storage) -> Bool {
        guard let host = Reachability.smbHost(storage.target) else { return false }
        return Secrets.has(host: host, username: storage.username)
    }

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
            hasCredentials: hasCredentials(storage)
        )
        announce()
    }

    private func announce() {
        let items = storages.map { storage -> StorageState in
            var state = states[storage.id] ?? StorageState(
                id: storage.id, status: .notMounted, detail: nil, mountedPath: nil,
                hasCredentials: false
            )
            state.hasCredentials = hasCredentials(storage)
            return state
        }
        let queued = Set(scheduled.keys).union(deferred).sorted()
        emit(Event.state(items, inFlight: inFlight.sorted(), queued: queued, deferred: deferred.sorted()).json)
    }
}
