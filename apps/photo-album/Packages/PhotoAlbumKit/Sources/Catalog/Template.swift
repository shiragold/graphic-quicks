import CoreGraphics
import Foundation

/// One page design inside a Theme (`photo-album/template@1`). Immutable: making a Collage never
/// changes it. The Layers are kept as JSON until `resolve(format:photoCount:)` applies the Page
/// Format's overrides and the Optional Slots' Absent Overrides.
public struct Template: Decodable, Hashable, Sendable, Identifiable {
    public static let formatID = "photo-album/template@1"

    public struct PhotoCount: Codable, Hashable, Sendable {
        public var min: Int
        public var max: Int
        public func contains(_ n: Int) -> Bool { n >= min && n <= max }
    }

    /// Geometry for one non-base Page Format.
    public struct FormatVariant: Decodable, Hashable, Sendable {
        /// `draft` (from the retarget tool) or `tuned`.
        public var status: String?
        /// Node ID → partial node.
        public var nodes: [String: JSONValue]?
        /// Node IDs not drawn in this format; their attached children are hidden too.
        public var hide: [String]?
        /// Optional Slot ID → { node ID: partial node } for this format.
        public var absentOverrides: [String: JSONValue]?
    }

    public var format: String
    /// `<themeId>/<templateId>`.
    public var id: String
    public var name: String?
    public var role: String?
    public var baseFormat: PageFormat
    public var formats: [String: FormatVariant]?
    public var photoCount: PhotoCount
    public var tags: [String]?
    public var mood: [String]?
    public var seasons: [String]?
    public var sampleData: [String: String]?
    public var layers: [JSONValue]

    /// The Theme part of the ID.
    public var themeID: String { String(id.split(separator: "/").first ?? "") }
    /// The Template part of the ID, e.g. `02-polaroid-trio`.
    public var localID: String { String(id.split(separator: "/").last ?? "") }
    public var displayName: String { name ?? localID }

    public func variant(for format: PageFormat) -> FormatVariant? { formats?[format.rawValue] }

    /// The Template's Layers for one Page Format with `photoCount` Photos. Optional Slots are
    /// dropped (least important first) while there are more Slots than Photos, but never below
    /// `photoCount.min`; each dropped Slot takes its attached nodes with it and applies its
    /// Absent Overrides. `photoCount: nil` keeps every Slot. Same rules as `templateForFormat`
    /// and `renderTemplate` in the reference renderer.
    public func resolve(format: PageFormat, photoCount count: Int? = nil) throws -> ResolvedTemplate {
        // 1. Page Format overrides.
        var raw = layers
        var formatStatus = "base"
        if format != baseFormat {
            guard let v = variant(for: format) else { throw CatalogError.missingFormat(id, format) }
            formatStatus = v.status ?? "draft"
            let hide = Set(v.hide ?? [])
            raw = raw.compactMap { l in
                let id = l["id"]?.string, parent = l["attachTo"]?.string
                if let id, hide.contains(id) { return nil }
                if let parent, hide.contains(parent) { return nil }
                var n = l
                if let id, let o = v.nodes?[id] { n = n.merging(o) }
                if n["absentOverrides"] != nil, let id {
                    n = n.merging(.object(["absentOverrides": v.absentOverrides?[id] ?? .object([:])]))
                }
                return n
            }
        }

        // 2. Optional Slots, least important first, while Slots outnumber Photos.
        var decoded = try raw.map { try $0.decode(Layer.self) }
        var dropped: [String] = []
        if let count {
            var slotCount = decoded.filter { $0.slot != nil }.count
            let optional = decoded.compactMap(\.slot).filter(\.optional)
            let order = optional.enumerated().sorted {
                ($0.element.importance, $1.offset) > ($1.element.importance, $0.offset)
            }.map(\.element)
            for s in order {
                if slotCount <= Swift.max(count, photoCount.min) { break }
                dropped.append(s.id)
                slotCount -= 1
            }
        }

        // 3. Absent Overrides of the dropped Slots, then drop them and their attached nodes.
        if !dropped.isEmpty {
            var overrides: [String: JSONValue] = [:]
            for l in decoded { if let s = l.slot, dropped.contains(s.id) { overrides.merge(s.absentOverrides ?? [:]) { $1 } } }
            let gone = Set(dropped)
            var kept: [JSONValue] = []
            for (json, layer) in zip(raw, decoded) {
                if let id = layer.id, gone.contains(id) { continue }
                if let p = layer.attachTo, gone.contains(p) { continue }
                if let id = layer.id, let o = overrides[id] { kept.append(json.merging(o)) } else { kept.append(json) }
            }
            decoded = try kept.map { try $0.decode(Layer.self) }
        }

        return ResolvedTemplate(templateID: id, format: format, formatStatus: formatStatus,
                                layers: decoded, droppedSlots: dropped)
    }
}

public enum CatalogError: Error, CustomStringConvertible, Equatable {
    case missingFormat(String, PageFormat)
    case unknownAsset(String)
    case unsupportedFormat(String)
    case unknownStyle(String, String)
    case unknownAttachment(String, String)

    public var description: String {
        switch self {
        case .missingFormat(let t, let f): "\(t) has no \(f.rawValue) format variant"
        case .unknownAsset(let a): "Unknown asset \(a)"
        case .unsupportedFormat(let f): "Unsupported file format \(f)"
        case .unknownStyle(let t, let s): "\(t) uses unknown style \(s)"
        case .unknownAttachment(let t, let a): "\(t) attaches to unknown node \(a)"
        }
    }
}

/// A Template's Layers for one Page Format and photo count, ready to place and render.
public struct ResolvedTemplate: Hashable, Sendable {
    public let templateID: String
    public let format: PageFormat
    /// `base`, `draft` or `tuned`.
    public let formatStatus: String
    /// Painter's order. Attached nodes are included; draw them with their parent.
    public let layers: [Layer]
    /// Optional Slots dropped for the photo count.
    public let droppedSlots: [String]

    public var canvas: CGSize { format.canvas }

    /// All Slots, in Layer order.
    public var slots: [Slot] { layers.compactMap(\.slot) }
    public var textSlots: [TextSlot] { layers.compactMap(\.textSlot) }

    /// Layers drawn at the top level, in order.
    public var topLevel: [Layer] { layers.filter { $0.attachTo == nil } }

    /// Nodes attached to `id` on one side, in order.
    public func attached(to id: String, z: AttachedZ) -> [Layer] {
        layers.filter { $0.attachTo == id && $0.placement?.z == z }
    }

    /// A top-level Frame normalized to 0..1 of the Canvas.
    public func normalized(_ frame: Frame) -> CGRect {
        CGRect(x: frame.x / canvas.width, y: frame.y / canvas.height,
               width: frame.w / canvas.width, height: frame.h / canvas.height)
    }

    /// Whether an Optional Slot was dropped (the Usage "optional slot outcome").
    public var hasEmptyOptionalSlot: Bool { !droppedSlots.isEmpty }
    public var hasOptionalSlot: Bool { !droppedSlots.isEmpty || slots.contains(where: \.optional) }
}
