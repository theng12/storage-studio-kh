import Foundation

/// The owner's bounded retry rule: 5 s, 15 s, 60 s, then stop and flag. A manual
/// Mount now starts the count again. Pure so the rule is testable without waiting.
public enum RetryPolicy {
    public static let ladder: [TimeInterval] = [5, 15, 60]

    /// The ladder is 5, 15, 60; extra retries (up to the owner's chosen count) keep the
    /// last step rather than inventing a shorter one.
    public static func delay(afterFailure attempt: Int) -> TimeInterval? {
        guard attempt >= 1 else { return nil }
        return ladder[min(attempt, ladder.count) - 1]
    }

    /// How many automatic retries follow the first attempt. The settings screen offers 1–8.
    public static func retryCount(_ configured: Int) -> Int {
        min(max(configured, 1), 8)
    }
}

/// A mount attempt's own ceiling. `NetFSMountURLSync` has no timeout of its own and can block
/// on a half-open share, so the row gets a terminal answer instead of sitting at Mounting…
public enum MountBudget {
    public static let secondsDefault: TimeInterval = 90
    public static let secondsMax: TimeInterval = 600

    public static func seconds(_ raw: String?) -> TimeInterval {
        guard let raw,
              let value = Double(raw.trimmingCharacters(in: .whitespaces)),
              value >= 1
        else { return secondsDefault }
        return min(value, secondsMax)
    }
}

/// Notices a wake without an AppKit app: after sleep the wall clock runs ahead of the
/// monotonic clock by however long the Mac slept.
public enum SleepDetector {
    public struct Sample: Equatable {
        public var wall: TimeInterval
        public var monotonic: TimeInterval
        public init(wall: TimeInterval, monotonic: TimeInterval) {
            self.wall = wall
            self.monotonic = monotonic
        }
    }

    /// True when this pair of samples spans a sleep of at least `threshold` seconds.
    public static func didWake(from previous: Sample, to now: Sample, threshold: TimeInterval = 10) -> Bool {
        let wallGap = now.wall - previous.wall
        let monotonicGap = now.monotonic - previous.monotonic
        guard wallGap > 0, monotonicGap >= 0 else { return false }
        return wallGap - monotonicGap >= threshold
    }
}
