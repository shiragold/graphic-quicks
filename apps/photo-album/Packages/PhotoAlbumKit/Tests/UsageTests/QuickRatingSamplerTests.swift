import Foundation
import Testing
@testable import Usage

@Suite("Quick Rating sampling")
struct QuickRatingSamplerTests {
    /// Deterministic UUIDs: the first 8 bytes from a counter.
    static func collages(_ count: Int, offset: Int = 0) -> [CollageRef] {
        (offset..<(offset + count)).map { n in
            var bytes = [UInt8](repeating: 0, count: 16)
            withUnsafeBytes(of: UInt64(n).littleEndian) { bytes.replaceSubrange(0..<8, with: $0) }
            bytes[6] = 0x40; bytes[8] = 0x80
            return CollageRef(UUID(uuid: (bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
                                          bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15])))
        }
    }

    @Test("The hash is stable and uniform enough")
    func hash() {
        let id = UUID(uuidString: "6F9619FF-8B86-D011-B42D-00C04FC964FF")!
        #expect(QuickRatingSampler.unitHash(id) == QuickRatingSampler.unitHash(id))
        let values = Self.collages(10_000).map { QuickRatingSampler.unitHash($0.id) }
        #expect(values.allSatisfy { (0..<1).contains($0) })
        let below = values.filter { $0 < 0.15 }.count
        #expect((1_300...1_700).contains(below))
    }

    @Test("A small fraction of Collages is offered")
    func smallFraction() {
        var sampler = QuickRatingSampler()
        let offered = Self.collages(2_000).filter { sampler.shouldOffer($0) }.count
        // About one in ten: 15 % of those past a gap of three.
        #expect((150...250).contains(offered))
    }

    @Test("The same sequence gives the same decisions")
    func deterministic() {
        var first = QuickRatingSampler(), second = QuickRatingSampler()
        let ids = Self.collages(500)
        let a = ids.map { first.shouldOffer($0) }
        let b = ids.map { second.shouldOffer($0) }
        #expect(a == b)
        #expect(first == second)
    }

    @Test("A Collage is never offered twice")
    func neverTwice() {
        var sampler = QuickRatingSampler(policy: .init(baseRate: 1, minimumGap: 0))
        let c = collage(1)
        var decisions = [sampler.shouldOffer(c)]
        for _ in 0..<5 { decisions.append(sampler.shouldOffer(c)) }
        sampler.recordRating()
        decisions.append(sampler.shouldOffer(c))
        #expect(decisions == [true] + Array(repeating: false, count: 6))
    }

    @Test("Offers keep a gap between them")
    func gap() {
        var sampler = QuickRatingSampler(policy: .init(baseRate: 1, minimumGap: 3))
        let decisions = Self.collages(9).map { sampler.shouldOffer($0) }
        #expect(decisions == [true, false, false, false, true, false, false, false, true])
    }

    @Test("Dismissals halve the rate and double the gap; a rating resets them")
    func backOff() {
        var sampler = QuickRatingSampler()
        #expect(sampler.currentRate == 0.15 && sampler.currentGap == 3)
        sampler.recordDismissal()
        #expect(sampler.currentRate == 0.075 && sampler.currentGap == 6)
        sampler.recordDismissal()
        #expect(sampler.currentRate == 0.0375 && sampler.currentGap == 12)
        for _ in 0..<10 { sampler.recordDismissal() }
        #expect(sampler.dismissalStreak == 4)
        #expect(sampler.currentRate == 0.15 / 16 && sampler.currentGap == 48)
        sampler.recordRating()
        #expect(sampler.currentRate == 0.15 && sampler.currentGap == 3)
    }

    @Test("After dismissals far fewer Collages are offered")
    func backOffReducesOffers() {
        var fresh = QuickRatingSampler()
        var tired = QuickRatingSampler()
        for _ in 0..<4 { tired.recordDismissal() }
        let ids = Self.collages(3_000)
        let freshCount = ids.filter { fresh.shouldOffer($0) }.count
        let tiredCount = ids.filter { tired.shouldOffer($0) }.count
        #expect(tiredCount > 0)
        #expect(tiredCount * 8 < freshCount)
    }

    @Test("The log persists sampling state and backs off on dismissals")
    func throughTheLog() async throws {
        let store = InMemoryUsageStore()
        let log = UsageLog(store: store)
        let ids = Self.collages(200)
        var offered: [CollageRef] = []
        for id in ids where try await log.shouldOfferQuickRating(for: id) { offered.append(id) }
        #expect(!offered.isEmpty)

        // Reopening the app: none of them is offered again.
        let reopened = UsageLog(store: store)
        for id in ids { #expect(try await !reopened.shouldOfferQuickRating(for: id)) }

        try await reopened.recordQuickRatingDismissed(for: offered[0])
        #expect(try await reopened.samplerState().dismissalStreak == 1)
        try await reopened.recordQuickRating(.up, for: offered[1], variant: Fixtures.a)
        #expect(try await reopened.samplerState().dismissalStreak == 0)
        let kinds = try await reopened.entries().map(\.signal.kind)
        #expect(kinds == [.quickRatingDismissed, .quickRated])
    }

    @Test("Only the first rating of a Collage counts")
    func firstRatingCounts() async throws {
        let log = UsageLog(store: InMemoryUsageStore(), now: { date("2026-10-05T08:00:00Z") }, timeZone: { utc })
        try await log.recordQuickRating(.up, for: collage(1), variant: Fixtures.a)
        try await log.recordQuickRating(.down, for: collage(1), variant: Fixtures.a)
        try await log.recordQuickRating(.down, for: collage(2), variant: Fixtures.a)
        let row = try #require(try await log.report(for: month("2026-10")).rows.first)
        #expect(row.ratingUp == 1 && row.ratingDown == 1)
    }
}
