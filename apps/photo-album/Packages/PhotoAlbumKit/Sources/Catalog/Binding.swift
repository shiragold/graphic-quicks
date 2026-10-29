import Foundation

/// A single-brace Binding in a Text Slot: `{title}`, `{place}`, `{date:MMMM yyyy}`.
public struct Binding: Hashable, Sendable {
    public var name: String
    /// The format after the colon, a Unicode date pattern for `{date:…}`.
    public var format: String?

    /// All Bindings in a `bind` string, in order.
    public static func parse(_ template: String) -> [Binding] {
        matches(in: template).map(\.binding)
    }

    /// Fills every Binding in `template` from `values`. Unknown names become empty, as in the
    /// reference renderer's `formatBinding`.
    public static func format(_ template: String, with values: BindingValues, locale: Locale = .current) -> String {
        var out = ""
        var last = template.startIndex
        for m in matches(in: template) {
            out += template[last..<m.range.lowerBound]
            out += values.text(for: m.binding, locale: locale)
            last = m.range.upperBound
        }
        out += template[last...]
        return out
    }

    private struct Match { var range: Range<String.Index>; var binding: Binding }

    private static func matches(in s: String) -> [Match] {
        var result: [Match] = []
        var i = s.startIndex
        while let open = s[i...].firstIndex(of: "{") {
            guard let close = s[open...].firstIndex(of: "}") else { break }
            let body = s[s.index(after: open)..<close]
            let parts = body.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
            let name = String(parts[0])
            if !name.isEmpty, name.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "_" }) {
                result.append(Match(range: open..<s.index(after: close),
                                    binding: Binding(name: name, format: parts.count > 1 ? String(parts[1]) : nil)))
            }
            i = s.index(after: close)
        }
        return result
    }
}

/// The values a Collage offers its Bindings: plain strings by name, plus the date that
/// `{date:…}` formats.
public struct BindingValues: Hashable, Sendable {
    public var strings: [String: String]
    public var date: Date?
    public var timeZone: TimeZone

    public init(strings: [String: String] = [:], date: Date? = nil, timeZone: TimeZone = .current) {
        self.strings = strings
        self.date = date
        self.timeZone = timeZone
    }

    public func text(for binding: Binding, locale: Locale = .current) -> String {
        if binding.name == "date", let date {
            let f = DateFormatter()
            f.locale = locale
            f.timeZone = timeZone
            f.dateFormat = binding.format ?? "MMMM yyyy"
            return f.string(from: date)
        }
        return strings[binding.name] ?? ""
    }
}
