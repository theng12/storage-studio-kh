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
        let deadline = Date().addingTimeInterval(timeout)
        while process.isRunning && Date() < deadline {
            usleep(50_000)
        }
        if process.isRunning {
            process.terminate()
            return Result(status: -2, output: Data(), error: "The command took too long.")
        }
        process.waitUntilExit()
        return Result(
            status: process.terminationStatus,
            output: output.fileHandleForReading.readDataToEndOfFile(),
            error: String(data: error.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        )
    }
}
