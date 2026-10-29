import Foundation

/// A family of Templates that share Palettes, Styles and decoration files
/// (`photo-album/theme@1`, one `theme.json` per bundle).
public struct Theme: Codable, Hashable, Sendable, Identifiable {
    public static let formatID = "photo-album/theme@1"

    public var format: String
    public var id: String
    public var name: String
    public var version: String
    /// The Template format of its Templates (`photo-album/template@1`). Checked by
    /// `ThemeCompatibility` before the Theme is loaded.
    public var templateFormat: String?
    /// The oldest app version that can render this Theme.
    public var minAppVersion: String?
    public var description: String?
    public var tags: [String]?
    public var mood: [String]?
    public var seasons: [String]?
    public var occasions: [String]?
    /// Palette name → Token → colour. Partial Palettes inherit `default`.
    public var palettes: [String: [String: String]]
    /// Style key → typography.
    public var typography: [String: TextStyle]
    public var fonts: [FontFile]?
    /// Preview-only text. Never a Collage's content.
    public var sampleData: [String: String]?
    /// Asset ID → path inside the bundle.
    public var assets: [String: String]
    /// Template file paths inside the bundle, in Catalog order.
    public var templates: [String]

    public var ref: ThemeRef { ThemeRef(id: id, version: version) }

    /// The names of all Palettes, `default` first.
    public var paletteNames: [String] {
        ["default"] + palettes.keys.filter { $0 != "default" }.sorted()
    }

    /// The Palette with this name, with missing Tokens taken from `default`.
    public func palette(named name: String = "default") -> Palette {
        var tokens = palettes["default"] ?? [:]
        if name != "default", let partial = palettes[name] {
            for (k, v) in partial { tokens[k] = v }
        }
        return Palette(name: palettes[name] == nil ? "default" : name, tokens: tokens)
    }
}

public struct FontFile: Codable, Hashable, Sendable {
    public var family: String
    public var file: String
    public var license: String?
    public var italic: Bool?
}

/// A named typography setting. Every field is optional so a Text Slot's `override` can be a
/// partial Style merged on top.
public struct TextStyle: Codable, Hashable, Sendable {
    /// Font fallback chain, e.g. `["Caveat", "Bradley Hand", "cursive"]`.
    public var family: [String]?
    public var weight: Int?
    public var italic: Bool?
    public var color: String?
    /// Tracking as a fraction of the font size.
    public var letterSpacing: Double?
    public var transform: String?
    public var lineHeight: Double?
    /// Average glyph width as a fraction of the size. Used by the reference renderer, which
    /// cannot measure; this renderer measures with Core Text instead.
    public var avgCharWidth: Double?

    public init(family: [String]? = nil, weight: Int? = nil, italic: Bool? = nil, color: String? = nil,
                letterSpacing: Double? = nil, transform: String? = nil, lineHeight: Double? = nil,
                avgCharWidth: Double? = nil) {
        self.family = family; self.weight = weight; self.italic = italic; self.color = color
        self.letterSpacing = letterSpacing; self.transform = transform; self.lineHeight = lineHeight
        self.avgCharWidth = avgCharWidth
    }

    /// `{...self, ...other}`.
    public func merged(with other: TextStyle?) -> TextStyle {
        guard let o = other else { return self }
        return TextStyle(
            family: o.family ?? family, weight: o.weight ?? weight, italic: o.italic ?? italic,
            color: o.color ?? color, letterSpacing: o.letterSpacing ?? letterSpacing,
            transform: o.transform ?? transform, lineHeight: o.lineHeight ?? lineHeight,
            avgCharWidth: o.avgCharWidth ?? avgCharWidth)
    }

    public var isUppercase: Bool { transform == "uppercase" }
}

/// One mapping of Tokens to colours, with `default` filled in.
public struct Palette: Hashable, Sendable {
    public let name: String
    public let tokens: [String: String]

    public init(name: String, tokens: [String: String]) {
        self.name = name
        self.tokens = tokens
    }

    /// Resolves `@token` to its colour. Literal colours and unknown Tokens pass through.
    public func resolve(_ color: String) -> String {
        guard color.hasPrefix("@") else { return color }
        return tokens[String(color.dropFirst())] ?? color
    }

    /// Replaces every `@token` in a decoration file, so the same string replace serves the
    /// native and the web renderer (themes docs/03, rule 5).
    public func substitute(in text: String) -> String {
        var out = ""
        out.reserveCapacity(text.count)
        var i = text.startIndex
        while i < text.endIndex {
            let ch = text[i]
            if ch == "@" {
                var j = text.index(after: i)
                if j < text.endIndex, text[j].isASCII, text[j].isLetter {
                    while j < text.endIndex, text[j].isASCII, text[j].isLetter || text[j].isNumber {
                        j = text.index(after: j)
                    }
                    let key = String(text[text.index(after: i)..<j])
                    out += tokens[key] ?? "@\(key)"
                    i = j
                    continue
                }
            }
            out.append(ch)
            i = text.index(after: i)
        }
        return out
    }
}
