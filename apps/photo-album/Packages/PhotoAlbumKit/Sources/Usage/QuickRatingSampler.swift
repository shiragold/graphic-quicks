import Foundation

/// Decides which Collages get the Quick Rating. It is deterministic: the decision for a
/// Collage depends only on its UUID and on the sampler's state, never on a random generator.
///
/// The rule, evaluated the first time a Collage is shown on the results screen:
/// 1. A Collage is considered once. If it was considered before (offered or not), it is
///    never offered again.
/// 2. At least `minimumGap × 2^streak` other Collages must have been considered since the last
///    offer.
/// 3. The Collage's UUID hashes to a stable number `u` in [0, 1). It is offered when
///    `u < baseRate / 2^streak`.
///
/// `streak` counts consecutive dismissals, capped at `maximumBackoff`. Each dismissal halves
/// the rate and doubles the gap; a rating resets the streak to 0. Ignoring an offer (leaving
/// the screen) changes nothing.
public struct QuickRatingSampler: Hashable, Codable, Sendable {
    public struct Policy: Hashable, Codable, Sendable {
        public var baseRate: Double
        public var minimumGap: Int
        public var maximumBackoff: Int

        public init(baseRate: Double = 0.15, minimumGap: Int = 3, maximumBackoff: Int = 4) {
            self.baseRate = baseRate
            self.minimumGap = minimumGap
            self.maximumBackoff = maximumBackoff
        }

        /// About one Collage in ten is offered without dismissals (15 % of the Collages that
        /// pass a gap of three). After four dismissals in a row, fewer than one in a hundred.
        public static let standard = Policy()
    }

    public var policy: Policy
    public private(set) var considered: Set<CollageRef> = []
    public private(set) var consideredSinceLastOffer: Int
    public private(set) var dismissalStreak: Int = 0

    public init(policy: Policy = .standard) {
        self.policy = policy
        // The very first Collage may be offered.
        self.consideredSinceLastOffer = policy.minimumGap
    }

    public var currentRate: Double {
        policy.baseRate / Double(1 << dismissalStreak)
    }

    public var currentGap: Int {
        policy.minimumGap << dismissalStreak
    }

    /// Whether to show the Quick Rating for `collage`. Call once when the Collage is first
    /// shown; every later call for the same Collage returns `false`.
    public mutating func shouldOffer(_ collage: CollageRef) -> Bool {
        guard considered.insert(collage).inserted else { return false }
        if consideredSinceLastOffer >= currentGap,
           Self.unitHash(collage.id) < currentRate {
            consideredSinceLastOffer = 0
            return true
        }
        consideredSinceLastOffer += 1
        return false
    }

    public mutating func recordRating() {
        dismissalStreak = 0
    }

    public mutating func recordDismissal() {
        dismissalStreak = min(dismissalStreak + 1, policy.maximumBackoff)
    }

    /// FNV-1a over the UUID's 16 bytes, mapped to [0, 1). Stable across launches and
    /// platforms, unlike `Hashable`, which is seeded per process.
    public static func unitHash(_ id: UUID) -> Double {
        var hash: UInt64 = 0xcbf2_9ce4_8422_2325
        withUnsafeBytes(of: id.uuid) { bytes in
            for byte in bytes {
                hash ^= UInt64(byte)
                hash &*= 0x0000_0100_0000_01b3
            }
        }
        // Top 53 bits give an exact Double in [0, 1).
        return Double(hash >> 11) / Double(UInt64(1) << 53)
    }
}
