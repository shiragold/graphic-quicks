import Foundation
import os

// Where Themes come from. Today the app ships its Themes in its resources
// (`BundledThemeSource`). A separate, hosted catalog can be added later as one more
// `ThemeSource` passed to `ThemeCatalog`; nothing else in the app needs to change.

/// A Theme's identity: its ID plus its version. Collages and Usage records keep both, so a
/// later Theme update never silently changes a finished page.
public struct ThemeRef: Codable, Hashable, Sendable, CustomStringConvertible {
    public var id: String
    public var version: String

    public init(id: String, version: String) {
        self.id = id
        self.version = version
    }

    public var description: String { "\(id)@\(version)" }
}

/// A dotted numeric version (`0.1.0`, `2.10`), compared component by component; missing
/// components count as 0, so `1.2` == `1.2.0`.
public struct ThemeVersion: Comparable, Hashable, Sendable, CustomStringConvertible {
    public let components: [Int]

    public init?(_ text: String) {
        let parts = text.split(separator: ".", omittingEmptySubsequences: false)
        guard !parts.isEmpty, parts.count <= 4 else { return nil }
        var c: [Int] = []
        for p in parts {
            guard !p.isEmpty, p.allSatisfy(\.isASCII), let n = Int(p), n >= 0 else { return nil }
            c.append(n)
        }
        components = c
    }

    public var description: String { components.map(String.init).joined(separator: ".") }

    private var padded: [Int] { components + Array(repeating: 0, count: 4 - components.count) }

    public static func == (a: Self, b: Self) -> Bool { a.padded == b.padded }
    public func hash(into h: inout Hasher) { h.combine(padded) }
    public static func < (a: Self, b: Self) -> Bool { a.padded.lexicographicallyPrecedes(b.padded) }
}

/// What a source knows about one Theme before loading it: the `theme.json` header.
public struct ThemeListing: Hashable, Sendable {
    public var ref: ThemeRef
    /// `photo-album/theme@1`.
    public var themeFormat: String
    /// The Template format its Templates use, e.g. `photo-album/template@1`. Nil when the
    /// Theme does not declare one, which the compatibility gate rejects.
    public var templateFormat: String?
    /// The oldest app version that can render it.
    public var minAppVersion: String?
    /// The bundle directory on disk.
    public var directory: URL
    /// The name of the source that listed it, for logs.
    public var sourceName: String
}

/// A Theme left out, and why.
public struct SkippedTheme: Hashable, Sendable, CustomStringConvertible {
    /// `id@version` when the header could be read, otherwise the directory name.
    public var name: String
    public var sourceName: String
    public var reason: String

    public var description: String { "\(name) from \(sourceName): \(reason)" }
}

/// Lists and loads Theme bundles.
public protocol ThemeSource: Sendable {
    /// For logs and for telling sources apart.
    var name: String { get }
    /// The Themes this source offers, plus the ones whose header could not be read.
    func listings() -> (listings: [ThemeListing], skipped: [SkippedTheme])
    /// Loads one listed Theme bundle with all its Templates.
    func load(_ listing: ThemeListing) throws -> ThemeBundle
}

/// The `theme.json` fields a source reads to list a Theme.
struct ThemeHeader: Decodable {
    var format: String
    var id: String
    var version: String
    var templateFormat: String?
    var minAppVersion: String?
}

/// Reads Theme bundles from a local folder: one directory per Theme, each with a `theme.json`.
/// The app uses it for the Themes shipped in its resources (`<Resources>/themes`).
public struct BundledThemeSource: ThemeSource {
    public let directory: URL
    public let name: String

    public init(directory: URL, name: String = "bundled") {
        self.directory = directory
        self.name = name
    }

    public func listings() -> (listings: [ThemeListing], skipped: [SkippedTheme]) {
        let fm = FileManager.default
        let children = ((try? fm.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? [])
            .filter { fm.fileExists(atPath: $0.appending(path: "theme.json").path) }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
        var listings: [ThemeListing] = []
        var skipped: [SkippedTheme] = []
        for dir in children {
            do {
                let h = try JSONDecoder().decode(ThemeHeader.self, from: Data(contentsOf: dir.appending(path: "theme.json")))
                listings.append(ThemeListing(
                    ref: ThemeRef(id: h.id, version: h.version), themeFormat: h.format, templateFormat: h.templateFormat,
                    minAppVersion: h.minAppVersion, directory: dir, sourceName: name))
            } catch {
                skipped.append(SkippedTheme(name: dir.lastPathComponent, sourceName: name,
                                            reason: "theme.json cannot be read: \(error)"))
            }
        }
        return (listings, skipped)
    }

    public func load(_ listing: ThemeListing) throws -> ThemeBundle {
        try ThemeBundle(directory: listing.directory)
    }
}

// MARK: - Future: CatalogThemeSource
//
// A separate, hosted Theme catalog. NOT BUILT YET: no networking in the app so far.
// The intended shape, so that adding it is one more entry in `ThemeCatalog(sources:)`:
//
//   struct CatalogThemeSource: ThemeSource {
//       let catalogURL: URL   // a hosted `catalog.json`: [{ id, version, templateFormat,
//                             //   minAppVersion, url (zipped .collagetheme), sha256 }]
//       let cache: URL        // Application Support/PhotoAlbum/Themes/<id>/<version>/
//       var name: String { "catalog" }
//       func listings() -> …  // read the last downloaded catalog.json from the cache
//                             // (a separate refresh step downloads it and the bundles)
//       func load(_:) throws -> ThemeBundle  // ThemeBundle(directory: cache/<id>/<version>)
//   }
//
// Downloaded versions are kept side by side, so Collages made with an older version
// still render with it (see `ThemeCatalog.bundle(for:)`).

/// Decides whether this app can use a Theme.
public struct ThemeCompatibility: Sendable {
    public var themeFormats: Set<String>
    public var templateFormats: Set<String>
    /// This app's version; nil skips the `minAppVersion` check.
    public var appVersion: ThemeVersion?

    public init(themeFormats: Set<String> = [Theme.formatID], templateFormats: Set<String> = [Template.formatID],
                appVersion: ThemeVersion? = nil) {
        self.themeFormats = themeFormats
        self.templateFormats = templateFormats
        self.appVersion = appVersion
    }

    /// Why the Theme cannot be used, or nil when it can.
    public func reason(against listing: ThemeListing) -> String? {
        if !themeFormats.contains(listing.themeFormat) {
            return "unsupported theme format \(listing.themeFormat)"
        }
        guard let tf = listing.templateFormat else { return "declares no templateFormat" }
        if !templateFormats.contains(tf) { return "unsupported template format \(tf)" }
        if ThemeVersion(listing.ref.version) == nil { return "invalid version \(listing.ref.version)" }
        if let min = listing.minAppVersion {
            guard let needed = ThemeVersion(min) else { return "invalid minAppVersion \(min)" }
            if let app = appVersion, app < needed { return "needs app \(needed), this is \(app)" }
        }
        return nil
    }
}

/// Merges Theme sources into the Catalog the app uses. For each Theme ID the newest
/// compatible version wins; on a tie the earlier source in `sources` wins. Older compatible
/// versions stay loaded so Collages made with them keep rendering unchanged. Adding a remote
/// source later is one more element in `sources`.
public struct ThemeCatalog: Sendable {
    /// The newest compatible version of each Theme.
    public let catalog: Catalog
    /// Every compatible version that loaded, by identity.
    public let versions: [ThemeRef: ThemeBundle]
    /// Themes left out by the gate or because they failed to load.
    public let skipped: [SkippedTheme]

    static let log = Logger(subsystem: "com.graphicquicks.PhotoAlbum", category: "ThemeCatalog")

    public init(sources: [any ThemeSource], compatibility: ThemeCompatibility = ThemeCompatibility()) {
        var skipped: [SkippedTheme] = []
        var candidates: [(listing: ThemeListing, order: Int, source: any ThemeSource)] = []
        for (order, source) in sources.enumerated() {
            let (listings, unreadable) = source.listings()
            skipped += unreadable
            for l in listings {
                if let reason = compatibility.reason(against: l) {
                    skipped.append(SkippedTheme(name: l.ref.description, sourceName: source.name, reason: reason))
                } else {
                    candidates.append((l, order, source))
                }
            }
        }
        var versions: [ThemeRef: ThemeBundle] = [:]
        var newest: [String: (version: ThemeVersion, order: Int, bundle: ThemeBundle)] = [:]
        for c in candidates {
            let ref = c.listing.ref
            if versions[ref] != nil {
                skipped.append(SkippedTheme(name: ref.description, sourceName: c.source.name,
                                            reason: "same version already provided by an earlier source"))
                continue
            }
            do {
                let bundle = try c.source.load(c.listing)
                guard bundle.theme.id == ref.id, bundle.theme.version == ref.version else {
                    throw CatalogError.unsupportedFormat("theme.json changed while loading")
                }
                if let bad = bundle.templates.first(where: { $0.format != c.listing.templateFormat }) {
                    throw CatalogError.unsupportedFormat("\(bad.id) is \(bad.format)")
                }
                versions[ref] = bundle
                let v = ThemeVersion(ref.version)!
                if let cur = newest[ref.id], (cur.version, -cur.order) >= (v, -c.order) { continue }
                newest[ref.id] = (v, c.order, bundle)
            } catch {
                skipped.append(SkippedTheme(name: ref.description, sourceName: c.source.name, reason: "failed to load: \(error)"))
            }
        }
        for s in skipped { Self.log.notice("Skipped theme \(s.description, privacy: .public)") }
        self.catalog = Catalog(bundles: newest.values.map(\.bundle).sorted { $0.id < $1.id })
        self.versions = versions
        self.skipped = skipped
    }

    /// The exact Theme version a Collage was made with, when it is still available.
    public func bundle(for ref: ThemeRef) -> ThemeBundle? { versions[ref] }

    /// The newest compatible version of a Theme.
    public func newest(_ themeID: String) -> ThemeBundle? { catalog.bundle(themeID) }
}
