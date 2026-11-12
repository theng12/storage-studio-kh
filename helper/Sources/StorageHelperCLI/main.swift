import Foundation
import StorageHelper

// The helper is this app's child process. Its stdin is the command channel; when the
// app quits or crashes, stdin closes and the helper ends with it. Nothing is left behind.

let writeLock = NSLock()

func emit(_ data: Data) {
    writeLock.lock()
    defer { writeLock.unlock() }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
}

let engine = Engine(emit: emit)
engine.start()

signal(SIGTERM) { _ in exit(0) }
signal(SIGINT) { _ in exit(0) }
signal(SIGHUP) { _ in exit(0) }

DispatchQueue.global(qos: .userInitiated).async {
    while let line = readLine(strippingNewline: true) {
        guard !line.trimmingCharacters(in: .whitespaces).isEmpty else { continue }
        do {
            let command = try JSONDecoder().decode(Command.self, from: Data(line.utf8))
            engine.handle(command)
        } catch {
            emit(Event.log(level: "warn", message: "unreadable command: \(error.localizedDescription)").json)
        }
    }
    // The app closed the channel: end at once. Tearing down would wait on a mount that
    // may be blocked, and this process must never outlive its app.
    exit(0)
}

dispatchMain()
