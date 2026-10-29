import Foundation
import Testing
@testable import Usage

@Suite("Usage Report")
struct UsageReportTests {
    /// October 2026 in Los Angeles, ending with one signal on each side of midnight on the 31st.
    static func octoberLog(reportsTo directory: URL? = nil) async throws -> UsageLog {
        let clock = TestClock(date("2026-10-03T10:00:00-07:00"))
        let log = UsageLog(
            store: InMemoryUsageStore(),
            reportWriter: directory.map { UsageReportWriter(directory: $0, appVersion: "1.2.0") },
            now: { clock.now }, timeZone: { losAngeles })
        let a = Fixtures.a, b = Fixtures.b, aw = Fixtures.aWinter
        let c1 = collage(1), c2 = collage(2), c3 = collage(3), c4 = collage(4)
        let signals: [UsageSignal] = [
            .bookStarted(format: .a4Portrait),
            .bookStarted(format: .square),
            .suggestionsShown(variants: [a, b]),
            .suggestionsShown(variants: [a, b, a]), // a duplicate in one list counts once
            .templatePicked(collage: c1, variant: a, source: .suggestion(position: 0)),
            .textEdited(collage: c1, variant: a, binding: .title),
            .textEdited(collage: c1, variant: a, binding: .title),
            .textEdited(collage: c1, variant: a, binding: .subtitle),
            .remade(collage: c1, variant: a),
            .remade(collage: c1, variant: a),
            .swapped(collage: c1, variant: a),
            .replaced(collage: c1, variant: a),
            .refitted(collage: c1, variant: a),
            .accepted(collage: c1, variant: a, optionalSlot: .empty),
            .templatePicked(collage: c2, variant: a, source: .search),
            .templateChanged(collage: c2, from: a, to: b),
            .accepted(collage: c2, variant: b, optionalSlot: .none),
            .quickRated(collage: c2, variant: b, rating: .up),
            .templatePicked(collage: c3, variant: a, source: .suggestion(position: 1)),
            .paletteChosen(collage: c3, variant: aw),
            .exported(collage: c3, variant: aw, optionalSlot: .filled),
            .quickRated(collage: c3, variant: aw, rating: .down),
            .templatePicked(collage: c4, variant: b, source: .suggestion(position: 0)),
            .quickRatingDismissed(collage: c4),
        ]
        for signal in signals { try await log.record(signal) }
        // 23:30 in Los Angeles on 31 October is already 1 November in UTC: still October.
        clock.set("2026-10-31T23:30:00-07:00")
        try await log.record(.collageRemoved(collage: c4, variant: b))
        // Ten minutes after midnight: November.
        clock.set("2026-11-01T00:10:00-07:00")
        try await log.record(.bookStarted(format: .a4Landscape))
        return log
    }

    static func json(_ data: Data) throws -> NSDictionary {
        try #require(try JSONSerialization.jsonObject(with: data) as? NSDictionary)
    }

    @Test("October matches the usage-report.md fixture exactly")
    func matchesFixture() async throws {
        let log = try await Self.octoberLog()
        let report = try await log.report(for: month("2026-10"))
        var withVersion = report
        withVersion.appVersion = "1.2.0"
        let expected = try Self.json(Data(contentsOf: Fixtures.url("usage-2026-10.json")))
        #expect(try Self.json(withVersion.encoded()) == expected)
    }

    @Test("A row has exactly the documented keys")
    func rowKeys() async throws {
        let report = try await Self.octoberLog().report(for: month("2026-10"))
        let object = try Self.json(report.encoded())
        #expect(Set(object.allKeys as! [String]) == ["period", "appVersion", "rows", "replacedBy", "variants"])
        let row = try #require((object["rows"] as? [NSDictionary])?.first)
        #expect(Set(row.allKeys as! [String]) == [
            "theme", "template", "format", "palette", "suggested", "picked", "searched", "made",
            "kept", "replaced", "removed", "remade", "optionalEmpty", "textOverridden",
            "ratingUp", "ratingDown",
        ])
        let pair = try #require((object["replacedBy"] as? [NSDictionary])?.first)
        #expect(Set(pair.allKeys as! [String]) == ["from", "to", "count", "themeChanged"])
        // Slashes stay readable.
        #expect(String(decoding: try report.encoded(), as: UTF8.self).contains("\"meadow-arch/05-story\""))
    }

    @Test("Reports round-trip through Codable")
    func roundTrip() async throws {
        let report = try await Self.octoberLog().report(for: month("2026-10"))
        #expect(try JSONDecoder().decode(UsageReport.self, from: report.encoded()) == report)
    }

    @Test("Recording writes usage-YYYY-MM.json for each month")
    func writesMonthFiles() async throws {
        let dir = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        _ = try await Self.octoberLog(reportsTo: dir)

        let names = try FileManager.default.contentsOfDirectory(atPath: dir.path).sorted()
        #expect(names == ["usage-2026-10.json", "usage-2026-11.json"])
        let october = try Self.json(Data(contentsOf: dir.appending(path: "usage-2026-10.json")))
        #expect(october == (try Self.json(Data(contentsOf: Fixtures.url("usage-2026-10.json")))))
        let november = try JSONDecoder().decode(
            UsageReport.self, from: Data(contentsOf: dir.appending(path: "usage-2026-11.json")))
        #expect(november.rows.isEmpty)
        #expect(november.variants.format == ["square": 0, "a4-portrait": 0, "a4-landscape": 1])
    }

    @Test("A Collage kept in October and replaced in November is no longer kept in October")
    func keptAcrossMonthBoundary() async throws {
        let dir = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let clock = TestClock(date("2026-10-30T12:00:00Z"))
        let log = UsageLog(
            store: InMemoryUsageStore(),
            reportWriter: UsageReportWriter(directory: dir, appVersion: "1.0"),
            now: { clock.now }, timeZone: { utc })
        let c = collage(9)
        try await log.record(.templatePicked(collage: c, variant: Fixtures.a, source: .search))
        try await log.record(.accepted(collage: c, variant: Fixtures.a, optionalSlot: .empty))

        func octoberRow() throws -> UsageReport.Row? {
            let data = try Data(contentsOf: dir.appending(path: "usage-2026-10.json"))
            return try JSONDecoder().decode(UsageReport.self, from: data).rows.first { $0.variant == Fixtures.a }
        }
        #expect(try octoberRow()?.kept == 1)
        #expect(try octoberRow()?.optionalEmpty == 1)

        clock.set("2026-11-02T09:00:00Z")
        try await log.record(.templateChanged(collage: c, from: Fixtures.a, to: Fixtures.b))

        // October's file was rewritten: made stays, kept goes.
        #expect(try octoberRow()?.made == 1)
        #expect(try octoberRow()?.kept == 0)
        #expect(try octoberRow()?.optionalEmpty == 0)
        let november = try await log.report(for: month("2026-11"))
        #expect(november.rows.first { $0.variant == Fixtures.a }?.replaced == 1)
        #expect(november.rows.first { $0.variant == Fixtures.b }?.made == 1)
        #expect(november.rows.first { $0.variant == Fixtures.b }?.kept == 0)

        // Accepted again in December: kept moves to December, once.
        clock.set("2026-12-01T09:00:00Z")
        try await log.record(.accepted(collage: c, variant: Fixtures.b, optionalSlot: .none))
        try await log.record(.exported(collage: c, variant: Fixtures.b, optionalSlot: .none))
        #expect(try await log.report(for: month("2026-12")).rows.first?.kept == 1)
        #expect(try await log.report(for: month("2026-11")).rows.allSatisfy { $0.kept == 0 })
    }

    @Test("A signal's month is fixed in the time zone it was recorded in",
          arguments: [
            (losAngeles, "2026-10"), // 23:30 on 31 Oct
            (utc, "2026-11"),        // 06:30 on 1 Nov
            (tokyo, "2026-11"),      // 15:30 on 1 Nov
          ])
    func monthInTimeZone(zone: TimeZone, expected: String) async throws {
        let instant = date("2026-11-01T06:30:00Z")
        let log = UsageLog(store: InMemoryUsageStore(), now: { instant }, timeZone: { zone })
        try await log.record(.bookStarted(format: .square))
        #expect(try await log.entries().map(\.month) == [month(expected)])
        #expect(try await log.report(for: month(expected)).variants.format["square"] == 1)
    }

    @Test("Travelling does not move earlier signals to another month")
    func travel() async throws {
        let clock = TestClock(date("2026-10-31T23:30:00-07:00"))
        let zone = TestZone(losAngeles)
        let log = UsageLog(store: InMemoryUsageStore(), now: { clock.now }, timeZone: { zone.value })
        try await log.record(.bookStarted(format: .square))
        zone.set(tokyo) // the user flies to Tokyo; the same instant is November there
        try await log.record(.bookStarted(format: .a4Portrait))
        #expect(try await log.months() == [month("2026-10"), month("2026-11")])
        #expect(try await log.report(for: month("2026-10")).variants.format["square"] == 1)
    }

    @Test("Month text and file names")
    func monthText() {
        #expect(UsageMonth(year: 2026, month: 3)?.description == "2026-03")
        #expect(UsageMonth(year: 2026, month: 3)?.reportFileName == "usage-2026-03.json")
        #expect(UsageMonth("2026-13") == nil)
        #expect(UsageMonth("26-10") == nil)
        #expect(UsageReportWriter.isReportFileName("usage-2026-10.json"))
        #expect(!UsageReportWriter.isReportFileName("usage-log.json"))
        #expect(!UsageReportWriter.isReportFileName("usage-2026-10.json.bak"))
    }

    @Test("An empty month still lists every Page Format")
    func emptyMonth() {
        let report = UsageReport.aggregate([], month: month("2026-01"), appVersion: "1")
        #expect(report.rows.isEmpty && report.replacedBy.isEmpty && report.variants.palette.isEmpty)
        #expect(report.variants.format == ["square": 0, "a4-portrait": 0, "a4-landscape": 0])
    }
}
