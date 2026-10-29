import Foundation
import Testing
@testable import Usage

@Suite("Preferences")
struct PreferencesTests {
    static func log(_ signals: [UsageSignal]) async throws -> UsageLog {
        let log = UsageLog(store: InMemoryUsageStore(), now: { date("2026-10-05T08:00:00Z") }, timeZone: { utc })
        for signal in signals { try await log.record(signal) }
        return log
    }

    @Test("No usage means no boost")
    func empty() async throws {
        let preferences = try await Self.log([]).preferences()
        #expect(preferences == .none)
        #expect(preferences.boost(for: Fixtures.a.templateRef) == 0)
    }

    @Test("Replacing A with B boosts B, lowers A, and is listed as a replacement")
    func replacement() async throws {
        var signals: [UsageSignal] = []
        for n in 1...4 {
            let c = collage(UInt8(n))
            signals += [
                .templatePicked(collage: c, variant: Fixtures.a, source: .suggestion(position: 0)),
                .templateChanged(collage: c, from: Fixtures.a, to: Fixtures.b),
                .accepted(collage: c, variant: Fixtures.b, optionalSlot: .none),
                .exported(collage: c, variant: Fixtures.b, optionalSlot: .none),
            ]
        }
        let preferences = try await Self.log(signals).preferences()
        let a = Fixtures.a.templateRef, b = Fixtures.b.templateRef
        #expect(preferences.templates[a] == .init(positive: 4, negative: 4))
        // Change Template +1 and one keep per Collage (accept and export count once).
        #expect(preferences.templates[b] == .init(positive: 8, negative: 0))
        #expect(preferences.boost(for: b) > 0)
        #expect(preferences.boost(for: a) == 0)
        #expect(preferences.replacements == [.init(from: a, to: b, count: 4)])
    }

    @Test("Boosts stay small", arguments: [1, 10, 1_000])
    func bounded(count: Int) async throws {
        var signals: [UsageSignal] = []
        for n in 0..<count {
            let c = CollageRef(UUID())
            signals.append(.templatePicked(collage: c, variant: Fixtures.a, source: .search))
            signals.append(.collageRemoved(collage: CollageRef(UUID()), variant: Fixtures.b))
            _ = n
        }
        let preferences = Preferences.derive(from: zip(0..., signals).map {
            UsageEntry(sequence: $0.0, date: .distantPast, month: month("2026-10"), signal: $0.1)
        })
        let up = preferences.boost(for: Fixtures.a.templateRef)
        let down = preferences.boost(for: Fixtures.b.templateRef)
        #expect(up > 0 && up < Preferences.maximumBoost)
        #expect(down < 0 && down > -Preferences.maximumBoost)
    }

    @Test("Ratings nudge the boost: 👍 up, 👎 down")
    func ratings() async throws {
        let up = try await Self.log([.quickRated(collage: collage(1), variant: Fixtures.a, rating: .up)]).preferences()
        let down = try await Self.log([.quickRated(collage: collage(1), variant: Fixtures.a, rating: .down)]).preferences()
        #expect(up.boost(for: Fixtures.a.templateRef) > 0)
        #expect(down.boost(for: Fixtures.a.templateRef) < 0)
    }

    @Test("A Theme's affinity lifts its other Templates a little")
    func themeSpill() async throws {
        let preferences = try await Self.log([
            .templatePicked(collage: collage(1), variant: Fixtures.a, source: .search),
        ]).preferences()
        let sibling = TemplateRef(theme: Fixtures.meadow, template: TemplateID("03-trio")!)
        #expect(preferences.boost(for: sibling) > 0)
        #expect(preferences.boost(for: sibling) < preferences.boost(for: Fixtures.a.templateRef))
    }

    @Test("A Palette set on most of a Theme's Collages is preferred")
    func palette() async throws {
        var signals: [UsageSignal] = []
        for n in 1...4 {
            signals.append(.templatePicked(collage: collage(UInt8(n)), variant: Fixtures.a, source: .search))
        }
        for n in 1...2 { signals.append(.paletteChosen(collage: collage(UInt8(n)), variant: Fixtures.aWinter)) }
        #expect(try await Self.log(signals).preferences().palettes.isEmpty) // 2 of 4: too few

        signals.append(.paletteChosen(collage: collage(3), variant: Fixtures.aWinter))
        signals.append(.paletteChosen(collage: collage(3), variant: Fixtures.aWinter)) // same Collage again
        #expect(try await Self.log(signals).preferences().palettes == [Fixtures.meadow: Fixtures.winter])
    }

    @Test("A clear Page Format favourite is preferred; a tie is not")
    func pageFormat() async throws {
        let tie = try await Self.log([.bookStarted(format: .square), .bookStarted(format: .a4Portrait)]).preferences()
        #expect(tie.pageFormat == nil)
        let clear = try await Self.log([
            .bookStarted(format: .square), .bookStarted(format: .a4Portrait), .bookStarted(format: .a4Portrait),
        ]).preferences()
        #expect(clear.pageFormat == .a4Portrait)
    }

    @Test("Reset returns Preferences to none")
    func reset() async throws {
        let log = try await Self.log([.templatePicked(collage: collage(1), variant: Fixtures.a, source: .search)])
        #expect(try await log.preferences().boost(for: Fixtures.a.templateRef) > 0)
        try await log.reset()
        #expect(try await log.preferences() == .none)
    }
}
