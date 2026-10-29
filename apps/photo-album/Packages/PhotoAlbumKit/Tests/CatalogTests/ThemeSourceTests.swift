import Foundation
import Testing
@testable import Catalog

/// A folder of Theme bundles made from the prototype `kraft-scrapbook` (its `theme.json` and
/// Templates; assets are not needed to load). Removed when the value goes away.
final class ThemeFolder {
    let url = FileManager.default.temporaryDirectory.appending(path: "ThemeSourceTests-\(UUID().uuidString)")

    init() throws {
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    }

    deinit { try? FileManager.default.removeItem(at: url) }

    /// Adds a copy of kraft-scrapbook in `<dir>`, with `theme.json` fields changed (nil removes one).
    @discardableResult
    func add(_ dir: String, changes: [String: String?] = [:]) throws -> URL {
        let src = themesDirectory.appending(path: "kraft-scrapbook")
        let dst = url.appending(path: dir)
        try FileManager.default.createDirectory(at: dst, withIntermediateDirectories: true)
        try FileManager.default.copyItem(at: src.appending(path: "templates"), to: dst.appending(path: "templates"))
        var theme = try #require(try JSONSerialization.jsonObject(with: Data(contentsOf: src.appending(path: "theme.json"))) as? [String: Any])
        for (k, v) in changes { theme[k] = v }
        try JSONSerialization.data(withJSONObject: theme).write(to: dst.appending(path: "theme.json"))
        return dst
    }

    func add(raw: String, in dir: String) throws {
        let dst = url.appending(path: dir)
        try FileManager.default.createDirectory(at: dst, withIntermediateDirectories: true)
        try Data(raw.utf8).write(to: dst.appending(path: "theme.json"))
    }

    var source: BundledThemeSource { BundledThemeSource(directory: url, name: url.lastPathComponent) }
}

@Suite("Catalog: Theme versions")
struct ThemeVersionTests {
    @Test func comparesNumerically() throws {
        let v = { (s: String) in try #require(ThemeVersion(s)) }
        #expect(try v("0.10.0") > v("0.9.9"))
        #expect(try v("1.2") == v("1.2.0"))
        #expect(try v("2") > v("1.99.99"))
        #expect(ThemeVersion("1.x") == nil)
        #expect(ThemeVersion("") == nil)
        #expect(ThemeVersion("1..2") == nil)
    }

    @Test func prototypeThemesDeclareIdentityAndTemplateFormat() throws {
        for b in try Catalog(directory: themesDirectory).bundles {
            #expect(b.theme.ref == ThemeRef(id: b.id, version: "0.1.0"))
            #expect(b.theme.templateFormat == Template.formatID)
        }
    }
}

@Suite("Catalog: compatibility gate")
struct CompatibilityGateTests {
    func skipReasons(_ folder: ThemeFolder, appVersion: String? = "0.1") -> [String: String] {
        let catalog = ThemeCatalog(sources: [folder.source],
                                   compatibility: ThemeCompatibility(appVersion: appVersion.flatMap(ThemeVersion.init)))
        return Dictionary(uniqueKeysWithValues: catalog.skipped.map { ($0.name, $0.reason) })
    }

    @Test func acceptsTheShippedThemes() {
        let catalog = ThemeCatalog(sources: [BundledThemeSource(directory: themesDirectory)],
                                   compatibility: ThemeCompatibility(appVersion: ThemeVersion("0.1")))
        #expect(catalog.skipped == [])
        #expect(catalog.catalog.bundles.map(\.id) == ["kraft-scrapbook", "meadow-arch"])
    }

    @Test func skipsAThemeWithoutTemplateFormat() throws {
        let f = try ThemeFolder()
        try f.add("a", changes: ["templateFormat": nil])
        #expect(skipReasons(f)["kraft-scrapbook@0.1.0"] == "declares no templateFormat")
    }

    @Test func skipsUnsupportedFormats() throws {
        let f = try ThemeFolder()
        try f.add("a", changes: ["templateFormat": "photo-album/template@2", "version": "1.0.0"])
        try f.add("b", changes: ["format": "photo-album/theme@2", "version": "2.0.0"])
        let reasons = skipReasons(f)
        #expect(reasons["kraft-scrapbook@1.0.0"] == "unsupported template format photo-album/template@2")
        #expect(reasons["kraft-scrapbook@2.0.0"] == "unsupported theme format photo-album/theme@2")
    }

    @Test func honoursMinAppVersion() throws {
        let f = try ThemeFolder()
        try f.add("new", changes: ["minAppVersion": "2.0", "version": "0.2.0"])
        try f.add("ok", changes: ["minAppVersion": "0.1.0", "version": "0.1.5"])
        #expect(skipReasons(f)["kraft-scrapbook@0.2.0"] == "needs app 2.0, this is 0.1")
        #expect(skipReasons(f)["kraft-scrapbook@0.1.5"] == nil)
        // Without a known app version the minimum is not checked.
        #expect(skipReasons(f, appVersion: nil).isEmpty)
    }

    @Test func skipsInvalidVersionsAndUnreadableHeaders() throws {
        let f = try ThemeFolder()
        try f.add("a", changes: ["version": "latest"])
        try f.add("b", changes: ["minAppVersion": "soon", "version": "0.3.0"])
        try f.add(raw: "{ not json", in: "broken")
        let reasons = skipReasons(f)
        #expect(reasons["kraft-scrapbook@latest"] == "invalid version latest")
        #expect(reasons["kraft-scrapbook@0.3.0"] == "invalid minAppVersion soon")
        #expect(reasons["broken"]?.hasPrefix("theme.json cannot be read") == true)
    }

    @Test func skipsAThemeWhoseTemplatesFailToLoad() throws {
        let f = try ThemeFolder()
        let dir = try f.add("a")
        try Data("{}".utf8).write(to: dir.appending(path: "templates/01-cover.json"))
        let catalog = ThemeCatalog(sources: [f.source])
        #expect(catalog.catalog.bundles.isEmpty)
        #expect(catalog.skipped.first?.reason.hasPrefix("failed to load") == true)
    }
}

@Suite("Catalog: merging Theme sources")
struct ThemeMergeTests {
    @Test func newestCompatibleVersionWinsAndOlderOnesStayLoaded() throws {
        let shipped = try ThemeFolder(), remote = try ThemeFolder()
        try shipped.add("kraft", changes: ["version": "0.1.0"])
        try remote.add("kraft-2", changes: ["version": "0.2.0"])
        try remote.add("kraft-3", changes: ["version": "0.3.0", "minAppVersion": "9"])
        let catalog = ThemeCatalog(sources: [shipped.source, remote.source],
                                   compatibility: ThemeCompatibility(appVersion: ThemeVersion("1.0")))
        #expect(catalog.newest("kraft-scrapbook")?.theme.version == "0.2.0")
        #expect(catalog.catalog.bundles.count == 1)
        // A Collage made with 0.1.0 still renders with 0.1.0.
        #expect(catalog.bundle(for: ThemeRef(id: "kraft-scrapbook", version: "0.1.0"))?.directory.lastPathComponent == "kraft")
        #expect(catalog.bundle(for: ThemeRef(id: "kraft-scrapbook", version: "0.3.0")) == nil)
        #expect(catalog.skipped.map(\.name) == ["kraft-scrapbook@0.3.0"])
    }

    @Test func sourceOrderDoesNotBeatAVersion() throws {
        let first = try ThemeFolder(), second = try ThemeFolder()
        try first.add("kraft", changes: ["version": "1.0.0"])
        try second.add("kraft", changes: ["version": "0.9.0"])
        let catalog = ThemeCatalog(sources: [second.source, first.source])
        #expect(catalog.newest("kraft-scrapbook")?.theme.version == "1.0.0")
        #expect(catalog.versions.count == 2)
    }

    @Test func onATieTheEarlierSourceWins() throws {
        let first = try ThemeFolder(), second = try ThemeFolder()
        try first.add("kraft", changes: ["version": "1.0.0", "name": "From first"])
        try second.add("kraft", changes: ["version": "1.0.0", "name": "From second"])
        let catalog = ThemeCatalog(sources: [first.source, second.source])
        #expect(catalog.newest("kraft-scrapbook")?.theme.name == "From first")
        #expect(catalog.skipped.map(\.reason) == ["same version already provided by an earlier source"])
        #expect(catalog.skipped.first?.sourceName == second.source.name)
    }

    @Test func mergesDifferentThemesFromDifferentSources() throws {
        let extra = try ThemeFolder()
        try extra.add("kraft", changes: ["id": "kraft-remix", "version": "1.0.0"])
        let catalog = ThemeCatalog(sources: [BundledThemeSource(directory: themesDirectory), extra.source])
        #expect(catalog.catalog.bundles.map(\.id) == ["kraft-remix", "kraft-scrapbook", "meadow-arch"])
    }
}
