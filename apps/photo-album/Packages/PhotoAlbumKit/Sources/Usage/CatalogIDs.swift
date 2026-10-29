import Foundation

// The Usage context knows only Catalog IDs (research/jargon.md, "Dependency direction").
// These types are the privacy boundary: a Usage Signal can only be built from them, and each
// one accepts nothing but a Catalog slug, so Photo IDs, typed text, places and image data
// cannot be stored in the Usage Log.

/// Validation shared by every Catalog ID: a lowercase slug as used in theme files,
/// e.g. `meadow-arch`, `05-story`, `berry`.
public enum CatalogSlug {
    public static let maxLength = 64

    /// `[a-z0-9]` followed by `[a-z0-9-]`, at most `maxLength` characters, no trailing or
    /// doubled hyphen. Rejects spaces, capitals, slashes, punctuation and non-ASCII, which
    /// rules out PhotoKit identifiers (`9F98…/L0/001`), file paths, place names and prose.
    public static func isValid(_ value: String) -> Bool {
        let scalars = value.unicodeScalars
        guard !scalars.isEmpty, scalars.count <= maxLength else { return false }
        var previousWasHyphen = true // forbids a leading hyphen
        for scalar in scalars {
            switch scalar {
            case "a"..."z", "0"..."9":
                previousWasHyphen = false
            case "-":
                if previousWasHyphen { return false }
                previousWasHyphen = true
            default:
                return false
            }
        }
        return !previousWasHyphen
    }
}

public struct InvalidCatalogID: Error, Equatable, CustomStringConvertible {
    public let kind: String
    public var description: String { "Not a valid \(kind) ID (expected a lowercase Catalog slug)" }
}

/// A Catalog ID backed by a validated slug. The only public initializer validates, so there
/// is no way to wrap arbitrary text in one.
public protocol CatalogID: Hashable, Comparable, Sendable, Codable, CustomStringConvertible {
    var rawValue: String { get }
    init?(_ rawValue: String)
}

extension CatalogID {
    public var description: String { rawValue }

    public static func < (lhs: Self, rhs: Self) -> Bool { lhs.rawValue < rhs.rawValue }

    public init(from decoder: any Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        guard let id = Self(raw) else {
            throw DecodingError.dataCorrupted(.init(
                codingPath: decoder.codingPath,
                debugDescription: InvalidCatalogID(kind: "\(Self.self)").description))
        }
        self = id
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

/// A Theme's ID, e.g. `meadow-arch`.
public struct ThemeID: CatalogID {
    public let rawValue: String
    public init?(_ rawValue: String) {
        guard CatalogSlug.isValid(rawValue) else { return nil }
        self.rawValue = rawValue
    }
}

/// A Template's ID within its Theme, e.g. `05-story`.
public struct TemplateID: CatalogID {
    public let rawValue: String
    public init?(_ rawValue: String) {
        guard CatalogSlug.isValid(rawValue) else { return nil }
        self.rawValue = rawValue
    }
}

/// A Palette's ID within its Theme, e.g. `default`, `berry`, `winter`.
public struct PaletteID: CatalogID {
    public let rawValue: String
    public init?(_ rawValue: String) {
        guard CatalogSlug.isValid(rawValue) else { return nil }
        self.rawValue = rawValue
    }

    /// Every Theme has a `default` Palette.
    public static let `default` = PaletteID("default")!
    public var isDefault: Bool { self == .default }
}

/// The three Page Formats every Template ships in.
public enum PageFormat: String, CaseIterable, Codable, Sendable, Comparable {
    case square
    case a4Portrait = "a4-portrait"
    case a4Landscape = "a4-landscape"

    public static func < (lhs: Self, rhs: Self) -> Bool {
        allCases.firstIndex(of: lhs)! < allCases.firstIndex(of: rhs)!
    }
}

/// The Binding of a Text Slot, without its format (`{date:MMMM yyyy}` is `.date`).
/// Only the name is recorded, never the text.
public enum TextBinding: String, CaseIterable, Codable, Sendable, Comparable {
    case title, subtitle, place, date, dateRange, count, section1, section2, story

    public static func < (lhs: Self, rhs: Self) -> Bool { lhs.rawValue < rhs.rawValue }
}

/// A Template, named by its Theme and its ID: `meadow-arch/05-story`.
public struct TemplateRef: Hashable, Comparable, Codable, Sendable, CustomStringConvertible {
    public let theme: ThemeID
    public let template: TemplateID

    public init(theme: ThemeID, template: TemplateID) {
        self.theme = theme
        self.template = template
    }

    public var description: String { "\(theme)/\(template)" }

    public static func < (lhs: Self, rhs: Self) -> Bool {
        (lhs.theme, lhs.template) < (rhs.theme, rhs.template)
    }
}

/// One combination of Theme × Template × Page Format × Palette. Usage is counted per Variant.
public struct Variant: Hashable, Comparable, Codable, Sendable, CustomStringConvertible {
    public let theme: ThemeID
    public let template: TemplateID
    public let format: PageFormat
    public let palette: PaletteID

    public init(theme: ThemeID, template: TemplateID, format: PageFormat, palette: PaletteID = .default) {
        self.theme = theme
        self.template = template
        self.format = format
        self.palette = palette
    }

    public var templateRef: TemplateRef { TemplateRef(theme: theme, template: template) }

    public var description: String { "\(theme)/\(template) \(format.rawValue) \(palette)" }

    public static func < (lhs: Self, rhs: Self) -> Bool {
        (lhs.theme, lhs.template, lhs.format, lhs.palette)
            < (rhs.theme, rhs.template, rhs.format, rhs.palette)
    }
}

/// An opaque reference to a Collage: the Collage's own UUID, nothing derived from its Photos.
/// It lets the log tell "the same Collage" apart (kept, remade, rated once) and never appears
/// in a Usage Report.
public struct CollageRef: Hashable, Codable, Sendable {
    public let id: UUID
    public init(_ id: UUID) { self.id = id }
}
