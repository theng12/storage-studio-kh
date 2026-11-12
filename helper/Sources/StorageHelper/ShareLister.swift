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

    public static func list(host: String, credentials: Keychain.Credentials?) -> Result {
        let trimmed = host.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, !trimmed.contains("/"), !trimmed.contains(" ") else {
            return Result(needsCredentials: false, error: "Enter a device address like 192.168.0.217.")
        }

        var arguments: [String]
        if let credentials, !credentials.password.isEmpty {
            arguments = ["/usr/bin/script", "-q", "/dev/null", "/usr/bin/smbutil", "view", "//\(credentials.username)@\(trimmed)"]
        } else {
            // No password: ask the server for guest access without prompting anyone.
            arguments = ["/usr/bin/smbutil", "view", "-N", "//\(trimmed)"]
        }

        let outcome = run(arguments: arguments, password: credentials?.password, timeout: 15)
        let text = outcome.output
        let lower = text.lowercased()
        let authRejected = text.contains("Authentication error")
            || text.contains("server rejected")
            || lower.contains("authentication failed")
        let shares = parse(text)
        if !shares.isEmpty {
            return Result(shares: shares)
        }
        if authRejected {
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
        }
        let timedOut = process.isRunning
        if timedOut { process.terminate() }
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
