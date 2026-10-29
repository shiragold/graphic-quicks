import Foundation

/// One drawable item of a Template, drawn in painter's order. Exactly five kinds.
public enum Layer: Hashable, Sendable, Decodable {
    case background(Background)
    case slot(Slot)
    case text(TextSlot)
    case decoration(Decoration)
    case shape(ShapeLayer)

    private enum TypeKey: String, CodingKey { case type }

    public init(from decoder: any Decoder) throws {
        let type = try decoder.container(keyedBy: TypeKey.self).decode(String.self, forKey: .type)
        switch type {
        case "background": self = .background(try Background(from: decoder))
        case "photo": self = .slot(try Slot(from: decoder))
        case "text": self = .text(try TextSlot(from: decoder))
        case "asset": self = .decoration(try Decoration(from: decoder))
        case "shape": self = .shape(try ShapeLayer(from: decoder))
        default:
            throw DecodingError.dataCorrupted(.init(
                codingPath: decoder.codingPath, debugDescription: "Unknown layer type \(type)"))
        }
    }

    /// The node ID. The Background has none.
    public var id: String? {
        switch self {
        case .background: nil
        case .slot(let n): n.id
        case .text(let n): n.id
        case .decoration(let n): n.id
        case .shape(let n): n.id
        }
    }

    public var placement: NodePlacement? {
        switch self {
        case .background: nil
        case .slot(let n): n.placement
        case .text(let n): n.placement
        case .decoration(let n): n.placement
        case .shape(let n): n.placement
        }
    }

    public var attachTo: String? { placement?.attachTo }
    public var slot: Slot? { if case .slot(let s) = self { s } else { nil } }
    public var textSlot: TextSlot? { if case .text(let s) = self { s } else { nil } }
}

/// Where a node sits: Frame, rotation, opacity, shadow and its attachment. Shared by every
/// Layer except the Background.
public struct NodePlacement: Hashable, Sendable, Decodable {
    public var frame: Frame
    /// Degrees, clockwise, about the Frame's centre.
    public var rotate: Double
    public var opacity: Double?
    public var shadow: Shadow?
    /// Parent node ID. The Frame is then in the parent's local, rotated space.
    public var attachTo: String?
    public var z: AttachedZ

    enum CodingKeys: String, CodingKey { case frame, rotate, opacity, shadow, attachTo, z }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        frame = try c.decode(Frame.self, forKey: .frame)
        rotate = try c.decodeIfPresent(Double.self, forKey: .rotate) ?? 0
        opacity = try c.decodeIfPresent(Double.self, forKey: .opacity)
        shadow = try c.decodeIfPresent(Shadow.self, forKey: .shadow)
        attachTo = try c.decodeIfPresent(String.self, forKey: .attachTo)
        z = try c.decodeIfPresent(AttachedZ.self, forKey: .z) ?? .above
    }
}

public enum AttachedZ: String, Codable, Hashable, Sendable { case above, below }

/// Drop shadows, in design units (`SHADOWS` in `tools/render.mjs`).
public enum Shadow: String, Codable, Hashable, Sendable {
    case soft, lifted, flat

    public var dx: Double { switch self { case .soft: 0; case .lifted: 2; case .flat: 2 } }
    public var dy: Double { switch self { case .soft: 3; case .lifted: 9; case .flat: 2 } }
    /// Gaussian standard deviation.
    public var deviation: Double { switch self { case .soft: 4; case .lifted: 9; case .flat: 0.6 } }
    public var opacity: Double { switch self { case .soft: 0.22; case .lifted: 0.28; case .flat: 0.18 } }
    /// Shadow colour `#2b1d12`.
    public static let color = "#2b1d12"
}

/// The outline of a Slot or a Shape.
public enum MaskShape: String, Codable, Hashable, Sendable {
    case rect, roundRect, circle, ellipse, arch, path
}

public struct Mask: Codable, Hashable, Sendable {
    public var shape: MaskShape
    /// roundRect: fraction of min(w, h).
    public var radius: Double?
    /// path: ID of a mask asset (0..1 box, absolute M/L/C/Z only).
    public var asset: String?

    public init(shape: MaskShape, radius: Double? = nil, asset: String? = nil) {
        self.shape = shape; self.radius = radius; self.asset = asset
    }

    public static let rect = Mask(shape: .rect)
}

// MARK: - The five kinds

public struct Background: Hashable, Sendable, Decodable {
    public var fill: String?
    /// A texture tile (PNG) or a vector asset stretched to the page.
    public var asset: String?
}

/// A Layer that draws Theme artwork, optionally attached to another node.
public struct Decoration: Hashable, Sendable, Decodable {
    public var id: String
    public var placement: NodePlacement
    public var asset: String
    public var fit: AssetFit
    public var blend: String?

    enum CodingKeys: String, CodingKey { case id, asset, fit, blend }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        placement = try NodePlacement(from: decoder)
        asset = try c.decode(String.self, forKey: .asset)
        fit = try c.decodeIfPresent(AssetFit.self, forKey: .fit) ?? .contain
        blend = try c.decodeIfPresent(String.self, forKey: .blend)
    }
}

public enum AssetFit: String, Codable, Hashable, Sendable { case contain, cover, stretch }

/// A plain filled or stroked figure.
public struct ShapeLayer: Hashable, Sendable, Decodable {
    public var id: String
    public var placement: NodePlacement
    public var mask: Mask
    public var fill: String?
    public var stroke: String?
    public var strokeWidth: Double?
    /// SVG dash array, e.g. `"6 7"`.
    public var dash: String?

    enum CodingKeys: String, CodingKey { case id, fill, stroke, strokeWidth, dash }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        placement = try NodePlacement(from: decoder)
        mask = try Mask(from: decoder)
        fill = try c.decodeIfPresent(String.self, forKey: .fill)
        stroke = try c.decodeIfPresent(String.self, forKey: .stroke)
        strokeWidth = try c.decodeIfPresent(Double.self, forKey: .strokeWidth)
        dash = try c.decodeIfPresent(String.self, forKey: .dash)
    }
}

/// The aspect class of a Photo or a Slot.
public enum Orientation: String, Codable, Hashable, Sendable {
    case portrait, landscape, square, panorama, any

    /// Thresholds defined once (research/jargon.md, "Orientation").
    public static func of(aspect: Double) -> Orientation {
        if aspect >= 2 { return .panorama }
        if aspect > 1.1 { return .landscape }
        if aspect < 0.9 { return .portrait }
        return .square
    }
}

public enum Focus: String, Codable, Hashable, Sendable { case faces, subject, center, horizon }

/// Visible framing drawn with a Slot.
public struct Border: Codable, Hashable, Sendable {
    public enum Style: String, Codable, Hashable, Sendable { case none, mat, polaroid, sticker, outline }
    public var style: Style?
    public var color: String?
    /// mat/polaroid: fraction of min(w, h); sticker/outline: design units.
    public var width: Double?
    /// Polaroid bottom lip, fraction of min(w, h).
    public var bottom: Double?
    /// Echo outline distance in design units.
    public var inset: Double?
    public var insetColor: String?
    /// Corner radius of a mat or polaroid card.
    public var radius: Double?

    public init(style: Style? = nil, color: String? = nil, width: Double? = nil, bottom: Double? = nil,
                inset: Double? = nil, insetColor: String? = nil, radius: Double? = nil) {
        self.style = style; self.color = color; self.width = width; self.bottom = bottom
        self.inset = inset; self.insetColor = insetColor; self.radius = radius
    }
}

/// A Layer that holds one Photo.
public struct Slot: Hashable, Sendable, Decodable {
    public var id: String
    public var placement: NodePlacement
    /// 1 is the Hero.
    public var importance: Int
    public var orientation: Orientation?
    public var focus: Focus?
    public var minPixels: Int?
    public var mask: Mask
    public var border: Border?
    public var filter: String?
    public var optional: Bool
    /// Node ID → partial node, applied when this Optional Slot stays empty.
    public var absentOverrides: [String: JSONValue]?
    public var section: Int?

    enum CodingKeys: String, CodingKey {
        case id, importance, orientation, focus, minPixels, mask, border, filter, optional, absentOverrides, section
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        placement = try NodePlacement(from: decoder)
        importance = try c.decodeIfPresent(Int.self, forKey: .importance) ?? 2
        orientation = try c.decodeIfPresent(Orientation.self, forKey: .orientation)
        focus = try c.decodeIfPresent(Focus.self, forKey: .focus)
        minPixels = try c.decodeIfPresent(Int.self, forKey: .minPixels)
        mask = try c.decodeIfPresent(Mask.self, forKey: .mask) ?? .rect
        border = try c.decodeIfPresent(Border.self, forKey: .border)
        filter = try c.decodeIfPresent(String.self, forKey: .filter)
        optional = try c.decodeIfPresent(Bool.self, forKey: .optional) ?? false
        absentOverrides = try c.decodeIfPresent([String: JSONValue].self, forKey: .absentOverrides)
        section = try c.decodeIfPresent(Int.self, forKey: .section)
    }

    public var frame: Frame { placement.frame }
}

public enum TextAlign: String, Codable, Hashable, Sendable { case left, center, right }
public enum TextVAlign: String, Codable, Hashable, Sendable { case top, middle, bottom }

/// A Layer that holds text the user types, styled by a Style with fixed size and limits.
public struct TextSlot: Hashable, Sendable, Decodable {
    public var id: String
    public var placement: NodePlacement
    public var role: String?
    /// The Binding, e.g. `{title}` or `{date:MMMM yyyy}`. Absent for fixed decoration text.
    public var bind: String?
    /// Fixed or fallback text.
    public var sample: String?
    public var style: String
    public var override: TextStyle?
    public var color: String?
    /// Design units.
    public var size: Double
    public var minSize: Double?
    public var maxLines: Int
    public var align: TextAlign
    public var valign: TextVAlign
    /// `shrink` (default) or `none`.
    public var fit: String?
    public var maxChars: Int?
    /// Editor-only hint. Never rendered in an Export.
    public var placeholder: String?

    enum CodingKeys: String, CodingKey {
        case id, role, bind, sample, style, override, color, size, minSize, maxLines, align, valign, fit, maxChars, placeholder
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        placement = try NodePlacement(from: decoder)
        role = try c.decodeIfPresent(String.self, forKey: .role)
        bind = try c.decodeIfPresent(String.self, forKey: .bind)
        sample = try c.decodeIfPresent(String.self, forKey: .sample)
        style = try c.decode(String.self, forKey: .style)
        override = try c.decodeIfPresent(TextStyle.self, forKey: .override)
        color = try c.decodeIfPresent(String.self, forKey: .color)
        size = try c.decodeIfPresent(Double.self, forKey: .size) ?? 32
        minSize = try c.decodeIfPresent(Double.self, forKey: .minSize)
        maxLines = try c.decodeIfPresent(Int.self, forKey: .maxLines) ?? 1
        align = try c.decodeIfPresent(TextAlign.self, forKey: .align) ?? .left
        valign = try c.decodeIfPresent(TextVAlign.self, forKey: .valign) ?? .middle
        fit = try c.decodeIfPresent(String.self, forKey: .fit)
        maxChars = try c.decodeIfPresent(Int.self, forKey: .maxChars)
        placeholder = try c.decodeIfPresent(String.self, forKey: .placeholder)
    }

    /// The smallest size the fitter may shrink to: `minSize`, or half of `size`.
    public var effectiveMinSize: Double {
        fit == "none" ? size : (minSize ?? size * 0.5)
    }

    /// The Binding name without braces or format, e.g. `date` for `{date:MMM dd}`.
    public var bindingName: String? { bind.flatMap { Binding.parse($0).first?.name } }
}
