import Foundation

/// A calendar month in the Gregorian calendar, written `YYYY-MM` (the Usage Report's `period`).
public struct UsageMonth: Hashable, Comparable, Codable, Sendable, CustomStringConvertible {
    public let year: Int
    public let month: Int

    public init?(year: Int, month: Int) {
        guard (1...12).contains(month), (1...9999).contains(year) else { return nil }
        self.year = year
        self.month = month
    }

    /// The month that contains `date` for someone in `timeZone`.
    public init(containing date: Date, in timeZone: TimeZone) {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let parts = calendar.dateComponents([.year, .month], from: date)
        self.year = parts.year!
        self.month = parts.month!
    }

    /// Parses `YYYY-MM`.
    public init?(_ text: String) {
        let parts = text.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 2, parts[0].count == 4, parts[1].count == 2,
              let year = Int(parts[0]), let month = Int(parts[1]) else { return nil }
        self.init(year: year, month: month)
    }

    public var description: String {
        let y = String(year), m = String(month)
        return String(repeating: "0", count: max(0, 4 - y.count)) + y + "-"
            + (m.count == 1 ? "0" + m : m)
    }

    /// The month's file name, `usage-YYYY-MM.json`.
    public var reportFileName: String { "usage-\(self).json" }

    public static func < (lhs: Self, rhs: Self) -> Bool { (lhs.year, lhs.month) < (rhs.year, rhs.month) }

    public init(from decoder: any Decoder) throws {
        let text = try decoder.singleValueContainer().decode(String.self)
        guard let month = UsageMonth(text) else {
            throw DecodingError.dataCorrupted(.init(
                codingPath: decoder.codingPath, debugDescription: "Expected YYYY-MM"))
        }
        self = month
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(description)
    }
}
