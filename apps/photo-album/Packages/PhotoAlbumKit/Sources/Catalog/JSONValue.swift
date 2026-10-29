import Foundation

/// A JSON value. Template Layers are kept in this form until a Page Format and the Optional
/// Slots are resolved, because format overrides and Absent Overrides are partial nodes that
/// are merged into a Layer key by key (a shallow merge, as in `tools/formats.mjs`).
public enum JSONValue: Hashable, Sendable, Codable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    public init(from decoder: any Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let b): try c.encode(b)
        case .number(let n): try c.encode(n)
        case .string(let s): try c.encode(s)
        case .array(let a): try c.encode(a)
        case .object(let o): try c.encode(o)
        }
    }

    public subscript(key: String) -> JSONValue? {
        if case .object(let o) = self { return o[key] }
        return nil
    }

    public var string: String? { if case .string(let s) = self { s } else { nil } }
    public var number: Double? { if case .number(let n) = self { n } else { nil } }
    public var bool: Bool? { if case .bool(let b) = self { b } else { nil } }
    public var object: [String: JSONValue]? { if case .object(let o) = self { o } else { nil } }

    /// `{...self, ...other}`: keys of `other` replace keys of `self`. Nested objects such as
    /// `frame` are replaced whole, never merged.
    public func merging(_ other: JSONValue) -> JSONValue {
        guard case .object(var base) = self, case .object(let top) = other else { return other }
        for (k, v) in top { base[k] = v }
        return .object(base)
    }

    /// Decodes a typed value from this JSON value.
    public func decode<T: Decodable>(_ type: T.Type) throws -> T {
        try JSONDecoder().decode(T.self, from: JSONEncoder().encode(self))
    }
}
