import Foundation

/// One Theme bundle on disk: `theme.json`, `templates/*.json` and its asset files. The
/// directory may be named `<id>` or `<id>.collagetheme`.
public struct ThemeBundle: Hashable, Sendable, Identifiable {
    public let directory: URL
    public let theme: Theme
    public let templates: [Template]

    public var id: String { theme.id }

    public init(directory: URL) throws {
        self.directory = directory
        let decoder = JSONDecoder()
        theme = try decoder.decode(Theme.self, from: Data(contentsOf: directory.appending(path: "theme.json")))
        guard theme.format == Theme.formatID else { throw CatalogError.unsupportedFormat(theme.format) }
        templates = try theme.templates.map { path in
            let t = try decoder.decode(Template.self, from: Data(contentsOf: directory.appending(path: path)))
            guard t.format == Template.formatID else { throw CatalogError.unsupportedFormat(t.format) }
            return t
        }
    }

    /// The file of a decoration, texture or mask asset.
    public func assetURL(_ assetID: String) throws -> URL {
        guard let rel = theme.assets[assetID] else { throw CatalogError.unknownAsset(assetID) }
        return directory.appending(path: rel)
    }

    public func template(_ id: String) -> Template? {
        templates.first { $0.id == id || $0.localID == id }
    }

    /// Cross-reference problems: unknown assets and styles, attachments to missing nodes, and
    /// Page Formats that fail to resolve. Empty when the bundle is sound.
    public func validate() -> [String] {
        var problems: [String] = []
        for t in templates {
            for format in PageFormat.allCases {
                do {
                    let r = try t.resolve(format: format)
                    let ids = Set(r.layers.compactMap(\.id))
                    for l in r.layers {
                        if let p = l.attachTo, !ids.contains(p) {
                            problems.append(CatalogError.unknownAttachment(t.id, p).description)
                        }
                        switch l {
                        case .background(let b):
                            if let a = b.asset, theme.assets[a] == nil { problems.append("\(t.id): unknown asset \(a)") }
                        case .decoration(let d):
                            if theme.assets[d.asset] == nil { problems.append("\(t.id): unknown asset \(d.asset)") }
                        case .slot(let s):
                            if s.mask.shape == .path, theme.assets[s.mask.asset ?? ""] == nil {
                                problems.append("\(t.id): unknown mask \(s.mask.asset ?? "nil")")
                            }
                        case .shape(let s):
                            if s.mask.shape == .path, theme.assets[s.mask.asset ?? ""] == nil {
                                problems.append("\(t.id): unknown mask \(s.mask.asset ?? "nil")")
                            }
                        case .text(let x):
                            if theme.typography[x.style] == nil {
                                problems.append(CatalogError.unknownStyle(t.id, x.style).description)
                            }
                        }
                    }
                } catch {
                    problems.append("\(t.id) \(format.rawValue): \(error)")
                }
            }
        }
        return problems
    }
}

/// All Themes available to the app. Read-only at runtime.
public struct Catalog: Sendable {
    public let bundles: [ThemeBundle]

    public init(bundles: [ThemeBundle]) {
        self.bundles = bundles
    }

    /// Loads every Theme bundle (a directory with a `theme.json`) inside `directory`, by ID.
    public init(directory: URL) throws {
        let fm = FileManager.default
        let children = try fm.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
        bundles = try children
            .filter { fm.fileExists(atPath: $0.appending(path: "theme.json").path) }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
            .map { try ThemeBundle(directory: $0) }
    }

    public func bundle(_ themeID: String) -> ThemeBundle? { bundles.first { $0.id == themeID } }

    /// The bundle and Template for a full Template ID (`<theme>/<template>`).
    public func template(_ id: String) -> (ThemeBundle, Template)? {
        for b in bundles { if let t = b.templates.first(where: { $0.id == id }) { return (b, t) } }
        return nil
    }
}
