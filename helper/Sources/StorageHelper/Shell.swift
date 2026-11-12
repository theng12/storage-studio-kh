import Foundation

public enum Shell {
    public struct Result {
        public var status: Int32
        public var output: Data
        public var error: String
    }

    @discardableResult
    public static func run(_ executable: String, _ arguments: [String], timeout: TimeInterval = 30) -> Result {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        let output = Pipe()
        let error = Pipe()
        process.standardOutput = output
        process.standardError = error
        do {
            try process.run()
        } catch {
            return Result(status: -1, output: Data(), error: error.localizedDescription)
        }
        // Drain both pipes while the command runs; a full pipe would deadlock a large
        // `diskutil list -plist` before the process ever exits.
        let outBox = NSMutableData()
        let errBox = NSMutableData()
        let group = DispatchGroup()
        group.enter()
        DispatchQueue.global(qos: .utility).async {
            outBox.append(output.fileHandleForReading.readDataToEndOfFile())
            group.leave()
        }
        group.enter()
        DispatchQueue.global(qos: .utility).async {
            errBox.append(error.fileHandleForReading.readDataToEndOfFile())
            group.leave()
        }
        let deadline = Date().addingTimeInterval(timeout)
        while process.isRunning && Date() < deadline {
            usleep(50_000)
        }
        let timedOut = process.isRunning
        if timedOut { process.terminate() }
        process.waitUntilExit()
        group.wait()
        return Result(
            status: timedOut ? -2 : process.terminationStatus,
            output: outBox as Data,
            error: timedOut
                ? "The command took too long."
                : (String(data: errBox as Data, encoding: .utf8)?
                    .trimmingCharacters(in: .whitespacesAndNewlines) ?? "")
        )
    }
}
