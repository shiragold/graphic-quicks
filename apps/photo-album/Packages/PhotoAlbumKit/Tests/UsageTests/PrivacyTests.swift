import Foundation
import Testing
@testable import Usage

/// No Photo IDs, text, places or image data can enter the Usage Log. The types enforce it:
/// every Usage Signal payload is built from the types below, and the only one holding a string
/// (a Catalog ID) accepts nothing but a Catalog slug.
@Suite("Privacy")
struct PrivacyTests {
    /// Types a signal may hold as values. Anything else (String, Data, URL, Double, Date,
    /// CGImage, a PhotoKit identifier…) fails the walk.
    static func isAllowedLeaf(_ value: Any) -> Bool {
        value is ThemeID || value is TemplateID || value is PaletteID || value is PageFormat
            || value is TextBinding || value is QuickRating || value is OptionalSlotOutcome
            || value is CollageRef || value is ThemeVersionID || value is Int || value is Bool
    }

    /// Walks a value with `Mirror`, descending into enums, tuples, arrays, Variant and
    /// PickSource, and returns the paths of disallowed values.
    static func disallowedValues(in value: Any, path: String = "") -> [String] {
        if isAllowedLeaf(value) { return [] }
        let mirror = Mirror(reflecting: value)
        let descend = value is UsageSignal || value is Variant || value is PickSource
            || mirror.displayStyle == .tuple || mirror.displayStyle == .collection
            || mirror.displayStyle == .optional
        guard descend else { return ["\(path): \(type(of: value))"] }
        // zip, not enumerated(): this test bundle also runs on macOS 15 hosts, where the
        // macOS 26 deployment target's `EnumeratedSequence: Collection` is missing.
        return zip(0..., mirror.children).flatMap { index, child in
            disallowedValues(in: child.value, path: path + "." + (child.label ?? "\(index)"))
        }
    }

    @Test("The samples cover every kind of signal")
    func samplesAreExhaustive() {
        #expect(Set(everySignal.map(\.kind)) == Set(UsageSignal.Kind.allCases))
    }

    @Test("Every signal holds only Catalog IDs, formats, bindings, small enums and counts",
          arguments: everySignal)
    func signalPayloads(signal: UsageSignal) {
        #expect(Self.disallowedValues(in: signal) == [])
    }

    @Test("The walk does catch a string")
    func walkCatchesStrings() {
        #expect(Self.disallowedValues(in: ("a caption", 3)).map { $0.hasSuffix(": String") } == [true])
        #expect(Self.disallowedValues(in: Data([0x89, 0x50])) != [])
    }

    @Test("A stored entry adds only an order, a date and a month")
    func entryFields() throws {
        let entry = UsageEntry(sequence: 0, date: Date(), month: month("2026-10"), signal: .bookStarted(format: .square))
        #expect(Mirror(reflecting: entry).children.compactMap(\.label) == ["sequence", "date", "month", "signal"])
        let object = try #require(try JSONSerialization.jsonObject(with: JSONEncoder().encode(entry)) as? [String: Any])
        #expect(Set(object.keys) == ["sequence", "date", "month", "signal"])
    }

    @Test("Catalog IDs reject Photo IDs, paths, text, places and image data",
          arguments: [
            "9F983DBA-EC35-42B8-8773-B597CF782EDD/L0/001", // PHAsset.localIdentifier
            "9f983dba-ec35-42b8-8773-b597cf782edd/l0/001", // lowercased, still has slashes
            "/Users/someone/Pictures/IMG_0042.HEIC",
            "file:///Users/someone/Pictures/beach.jpg",
            "Summer at Grandma's",
            "Paris, France",
            "Lisbon",
            "48.8566,2.3522",
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk",
            "café",
            "",
            "-leading",
            "trailing-",
            "double--hyphen",
            "has space",
            String(repeating: "a", count: CatalogSlug.maxLength + 1),
          ])
    func rejectsNonCatalogText(text: String) {
        #expect(ThemeID(text) == nil)
        #expect(TemplateID(text) == nil)
        #expect(PaletteID(text) == nil)
    }

    @Test("Catalog IDs accept the slugs used in theme files",
          arguments: ["meadow-arch", "kraft-scrapbook", "05-story", "05-journal-entry", "default", "berry"])
    func acceptsCatalogSlugs(text: String) {
        #expect(ThemeID(text)?.rawValue == text)
    }

    @Test("A tampered log with free text in an ID does not decode")
    func decodingValidates() throws {
        let good = #"{"theme":"meadow-arch","template":"05-story","format":"square","palette":"default"}"#
        #expect(throws: Never.self) { try JSONDecoder().decode(Variant.self, from: Data(good.utf8)) }
        let bad = good.replacingOccurrences(of: "meadow-arch", with: "Trip to Paris")
        #expect(throws: DecodingError.self) { try JSONDecoder().decode(Variant.self, from: Data(bad.utf8)) }
    }

    @Test("The saved log and the report contain only what the signals carry")
    func persistedBytes() async throws {
        let dir = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let location = UsageLocation(root: dir)
        let log = UsageLog(
            store: FileUsageStore(location: location),
            reportWriter: UsageReportWriter(directory: location.reportsDirectory, appVersion: "1.0"),
            now: { date("2026-10-10T10:00:00Z") }, timeZone: { utc })
        for signal in everySignal { try await log.record(signal) }

        let saved = String(decoding: try Data(contentsOf: location.logFile), as: UTF8.self)
        let report = String(decoding: try Data(contentsOf: location.reportFile(for: month("2026-10"))), as: UTF8.self)
        for text in [saved, report] {
            #expect(!text.contains("UTC"))
            #expect(!text.contains("America/"))
            #expect(!text.lowercased().contains("photo"))
        }
        // The report holds no Collage references.
        #expect(!report.contains(collage(1).id.uuidString))
        #expect(!report.lowercased().contains(collage(1).id.uuidString.lowercased()))
    }
}
