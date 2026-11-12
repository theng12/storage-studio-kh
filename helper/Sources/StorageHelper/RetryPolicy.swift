import Foundation

/// The owner's bounded retry rule: 5 s, 15 s, 60 s, then stop and flag. A manual
/// Mount now starts the count again. Pure so the rule is testable without waiting.
public enum RetryPolicy {
    public static let ladder: [TimeInterval] = [5, 15, 60]

    public static func delay(afterFailure attempt: Int) -> TimeInterval? {
        guard attempt >= 1, attempt <= ladder.count else { return nil }
        return ladder[attempt - 1]
    }

    /// How many automatic retries follow the first attempt.
    public static func retryCount(_ configured: Int) -> Int {
        min(max(configured, 1), ladder.count)
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
