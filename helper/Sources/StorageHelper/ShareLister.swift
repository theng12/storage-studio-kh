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
        var shares: [String] = []
        for raw in output.split(separator: "\n") {
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
        var sentPassword = false
        let deadline = Date().addingTimeInterval(timeout)
        while process.isRunning && Date() < deadline {
            let ready = waitForData(output.fileHandleForReading.fileDescriptor, timeout: 0.2)
            if ready {
                let chunk = output.fileHandleForReading.availableData
                if chunk.isEmpty { break }
                collected.append(chunk)
            }
            if let password, !sentPassword,
               String(data: collected as Data, encoding: .utf8)?.contains("assword") == true {
                input.fileHandleForWriting.write(Data((password + "\n").utf8))
                sentPassword = true
            }
        }
        let timedOut = process.isRunning
        if timedOut { process.terminate() }
        process.waitUntilExit()
        collected.append(output.fileHandleForReading.availableData)
        return Outcome(
            output: String(data: collected as Data, encoding: .utf8) ?? "",
            timedOut: timedOut
        )
    }

    private static func waitForData(_ descriptor: Int32, timeout: TimeInterval) -> Bool {
        var item = pollfd(fd: descriptor, events: Int16(POLLIN), revents: 0)
        return poll(&item, 1, Int32(timeout * 1000)) > 0
    }
}
