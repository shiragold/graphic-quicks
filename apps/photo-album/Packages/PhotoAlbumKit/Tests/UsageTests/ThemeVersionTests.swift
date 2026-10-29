import Foundation
import Testing
@testable import Usage

@Suite("Theme versions in Usage records")
struct ThemeVersionTests {
    @Test("Theme versions accept dotted numbers only",
          arguments: ["0.1.0", "1", "2.10", "1.2.3.4"])
    func accepts(text: String) {
        #expect(ThemeVersionID(text)?.rawValue == text)
    }

    @Test("Theme versions reject text, paths and IDs",
          arguments: ["", "1.", ".1", "1..2", "v1", "1.2-beta", "1.2.3.4.5", "Lisbon", "../x", "123456.1"])
    func rejects(text: String) {
        #expect(ThemeVersionID(text) == nil)
    }

    @Test("Report rows keep Theme versions apart and omit a missing version")
    func rowsPerVersion() async throws {
        let v1 = Variant(theme: Fixtures.meadow, template: Fixtures.story, format: .a4Portrait,
                         themeVersion: ThemeVersionID("0.1.0")!)
        let v2 = Variant(theme: Fixtures.meadow, template: Fixtures.story, format: .a4Portrait,
                         themeVersion: ThemeVersionID("0.2.0")!)
        let log = UsageLog(store: InMemoryUsageStore())
        try await log.record(.templatePicked(collage: collage(1), variant: v1, source: .suggestion(position: 0)))
        try await log.record(.templatePicked(collage: collage(2), variant: v2, source: .suggestion(position: 0)))
        try await log.record(.templatePicked(collage: collage(3), variant: Fixtures.b, source: .search))
        let month = try #require(try await log.months().first)
        let report = try await log.report(for: month)
        let made = Dictionary(uniqueKeysWithValues: report.rows.map { ($0.variant, $0.made) })
        #expect(made[v1] == 1 && made[v2] == 1 && made[Fixtures.b] == 1)

        let rows = try #require(try JSONSerialization.jsonObject(with: report.encoded()) as? [String: Any])["rows"] as? [[String: Any]]
        let versions = try #require(rows).map { $0["themeVersion"] as? String }
        #expect(versions.compactMap { $0 }.sorted() == ["0.1.0", "0.2.0"])
        #expect(versions.filter { $0 == nil }.count == 1)
        #expect(try JSONDecoder().decode(UsageReport.self, from: report.encoded()) == report)
    }
}
