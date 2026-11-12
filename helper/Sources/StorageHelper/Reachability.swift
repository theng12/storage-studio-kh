import Foundation

/// A short, silent TCP check so an unreachable host is reported as unreachable
/// instead of sitting in a long mount timeout.
public enum Reachability {
    public static func tcp(host: String, port: UInt16, timeout: TimeInterval = 2) -> Bool {
        var hints = addrinfo()
        hints.ai_family = AF_UNSPEC
        hints.ai_socktype = SOCK_STREAM
        var result: UnsafeMutablePointer<addrinfo>?
        guard getaddrinfo(host, String(port), &hints, &result) == 0, let first = result else { return false }
        defer { freeaddrinfo(result) }
        var node: UnsafeMutablePointer<addrinfo>? = first
        while let current = node {
            let address = current.pointee
            node = address.ai_next
            let fd = socket(address.ai_family, address.ai_socktype, address.ai_protocol)
            guard fd >= 0 else { continue }
            defer { close(fd) }
            _ = fcntl(fd, F_SETFL, fcntl(fd, F_GETFL, 0) | O_NONBLOCK)
            if connect(fd, address.ai_addr, address.ai_addrlen) == 0 { return true }
            guard errno == EINPROGRESS else { continue }
            var descriptor = pollfd(fd: fd, events: Int16(POLLOUT), revents: 0)
            guard poll(&descriptor, 1, Int32(timeout * 1000)) > 0 else { continue }
            var code: Int32 = 0
            var length = socklen_t(MemoryLayout<Int32>.size)
            getsockopt(fd, SOL_SOCKET, SO_ERROR, &code, &length)
            if code == 0 { return true }
        }
        return false
    }

    public static func smbHost(_ target: String) -> String? {
        URL(string: target)?.host
    }
}
