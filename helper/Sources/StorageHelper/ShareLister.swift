import Foundation

/// Lists the shares a server offers, using the system's own `smbutil`. When a password is
/// available it is typed through a private terminal, never passed on the command line.
public enum ShareLister {
    public struct Result {
        public var shares: [String]
        public var needsCredentials: Bool
        public var error: String?

        public init(shares: [String] = [], needsCredentials: Bool = false, error: String? = nil) {
            self.shares = shares
            self.needsCredentials = needsCredentials
            self.error = error
        }
    }

    public static func list(host: String, credentials: Secrets.Credentials?) -> Result {
        let trimmed = host.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, !trimmed.contains("/"), !trimmed.contains(" ") else {
            return Result(needsCredentials: false, error: "Enter a device address like 192.168.0.217.")
        }

        // Guest first: it never prompts, answers in well under a second on a device that
        // lets guests in, and is what finds the owner's NAS (all five shares, spaces and all).
        let guest = run(arguments: ["/usr/bin/smbutil", "view", "-N", "//\(trimmed)"], password: nil, timeout: 10)
        let guestShares = parse(guest.output)
        if !guestShares.isEmpty {
            return Result(shares: guestShares)
        }
        let guestSaysAuth = saysAuthRejected(guest.output)

        // Only a refused or empty guest answer goes on to the password path; a device that
        // never answered will not answer a sign-in either, so say so once, not twice.
        var outcome = guest
        if let credentials, !credentials.password.isEmpty, !guest.timedOut {
            let secured = run(
                arguments: ["/usr/bin/script", "-q", "/dev/null", "/usr/bin/smbutil", "view", "//\(credentials.username)@\(trimmed)"],
                password: credentials.password,
                timeout: 10
            )
            outcome = secured
            let shares = parse(secured.output)
            if !shares.isEmpty {
                return Result(shares: shares)
            }
        } else if guestSaysAuth {
            return Result(needsCredentials: true, error: "That device needs a user name and password.")
        }

        let text = outcome.output
        if saysAuthRejected(text) {
            return Result(needsCredentials: true, error: "That device needs a user name and password.")
        }
        if outcome.timedOut {
            return Result(error: "The device didn't answer.")
        }
        let reason = text
            .split(separator: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .first { $0.hasPrefix("smbutil:") || $0.hasPrefix("view:") }
        return Result(error: reason ?? "That device did not list any shares.")
    }

    private static func saysAuthRejected(_ text: String) -> Bool {
        text.contains("Authentication error")
            || text.contains("server rejected")
            || text.lowercased().contains("authentication failed")
    }

    /// `smbutil view` prints `name <2+ spaces> type <spaces> comment`. Names contain single
    /// spaces and dashes, so only a run of two or more spaces separates the name from the type.
    public static func parse(_ output: String) -> [String] {
        // A pseudo-terminal may end lines with \r or \r\n; both mean the same table.
        let text = output
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
        var shares: [String] = []
        for raw in text.split(separator: "\n") {
            let line = raw
                .replacingOccurrences(of: "\t", with: "  ")
                .trimmingCharacters(in: .whitespaces)
            guard !line.isEmpty,
                  let gap = line.range(of: #"\s{2,}"#, options: .regularExpression)
            else { continue }
            let name = String(line[..<gap.lowerBound]).trimmingCharacters(in: .whitespaces)
            let rest = String(line[gap.upperBound...]).trimmingCharacters(in: .whitespaces)
            let type = rest.split(separator: " ").first.map(String.init) ?? ""
            guard !name.isEmpty, name != "Share", name != "IPC$", type == "Disk" || type == "Printer" else {
                continue
            }
            if !shares.contains(name) { shares.append(name) }
        }
        return shares
    }

    private struct Outcome {
        var output: String
        var timedOut: Bool
    }

    private static func run(arguments: [String], password: String?, timeout: TimeInterval) -> Outcome {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: arguments[0])
        process.arguments = Array(arguments.dropFirst())
        let input = Pipe()
        let output = Pipe()
        process.standardInput = input
        process.standardOutput = output
        process.standardError = output
        do {
            try process.run()
        } catch {
            return Outcome(output: error.localizedDescription, timedOut: false)
        }

        let collected = NSMutableData()
        var answeredPrompts = 0
        var sawEnd = false
        var inputClosed = false
        func closeInput() {
            guard !inputClosed else { return }
            inputClosed = true
            input.fileHandleForWriting.closeFile()
        }
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if sawEnd {
                // `script` can keep running briefly after closing the pipe; give it a moment.
                if !process.isRunning { break }
                usleep(50_000)
                continue
            }
            if !process.isRunning { break }
            if waitForData(output.fileHandleForReading.fileDescriptor, timeout: 0.2) {
                let chunk = output.fileHandleForReading.availableData
                if chunk.isEmpty {
                    sawEnd = true
                    continue
                }
                collected.append(chunk)
            }
            if let password {
                // smbutil asks again after a refused password; answer up to three times.
                let text = String(data: collected as Data, encoding: .utf8) ?? ""
                let prompts = text.components(separatedBy: "assword").count - 1
                while answeredPrompts < prompts && answeredPrompts < 3 {
                    input.fileHandleForWriting.write(Data((password + "\n").utf8))
                    answeredPrompts += 1
                }
            }
            // `script` exits only when its stdin ends. Left open it hangs until the timeout,
            // which read as "The device didn't answer" for a device that had just listed.
            let text = String(data: collected as Data, encoding: .utf8) ?? ""
            if text.contains("shares listed") || text.contains("smbutil:") {
                closeInput()
            }
        }
        let timedOut = process.isRunning
        if timedOut { process.terminate() }
        closeInput()
        process.waitUntilExit()
        if !sawEnd { collected.append(output.fileHandleForReading.availableData) }
        let text = String(data: collected as Data, encoding: .utf8) ?? ""
        if ProcessInfo.processInfo.environment["STORAGE_STUDIO_DEBUG_LIST"] != nil {
            FileHandle.standardError.write(Data("list: \(collected.length) bytes, \(answeredPrompts) prompt(s), exit \(process.terminationStatus), parsed \(parse(text).count)\n".utf8))
        }
        return Outcome(output: text, timedOut: timedOut)
    }

    private static func waitForData(_ descriptor: Int32, timeout: TimeInterval) -> Bool {
        var item = pollfd(fd: descriptor, events: Int16(POLLIN), revents: 0)
        return poll(&item, 1, Int32(timeout * 1000)) > 0
    }
}
