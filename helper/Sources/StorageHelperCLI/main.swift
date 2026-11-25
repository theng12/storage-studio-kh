import Foundation
import StorageHelper
#if canImport(Darwin)
import Darwin
#endif

// The helper is this app's child process. Its stdin is the command channel; when the
// app quits or crashes, stdin closes and the helper ends with it. Nothing is left behind.

let writeLock = NSLock()

func emit(_ data: Data) {
    writeLock.lock()
    defer { writeLock.unlock() }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
}

/// Starts this same binary again, with the same arguments, in the same process: same pid, same
/// stdin/stdout pipes, no supervision gap, and a fresh heap. Called only between jobs.
func recycleInPlace() {
    let argv0 = CommandLine.arguments.first ?? ""
    var path = argv0
    if !argv0.hasPrefix("/"), let resolved = realpath(argv0, nil) {
        path = String(cString: resolved)
        free(resolved)
    }
    guard path.hasPrefix("/") else {
        FileHandle.standardError.write(Data("cannot restart in place at \(argv0)\n".utf8))
        return
    }
    execv(path, CommandLine.unsafeArgv)
    FileHandle.standardError.write(Data("could not restart in place at \(path): \(String(cString: strerror(errno)))\n".utf8))
}

let engine = Engine(emit: emit)
engine.recycleInPlace = recycleInPlace
engine.start()
engine.resumeSavedSetup()

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
