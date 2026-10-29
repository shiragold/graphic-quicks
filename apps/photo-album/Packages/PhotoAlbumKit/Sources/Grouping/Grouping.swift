import Foundation
import Library

/// The size of the Periods the app lists.
public enum Granularity: String, Sendable, Hashable { case month }

/// A date range `[start, end)` in the user's calendar and time zone.
public struct Period: Hashable, Sendable, Identifiable {
    public let interval: DateInterval
    public let granularity: Granularity

    public var id: Date { interval.start }

    /// The calendar month containing `date`.
    public static func month(containing date: Date, calendar: Calendar = .current) -> Period {
        let interval = calendar.dateInterval(of: .month, for: date)!
        return Period(interval: interval, granularity: .month)
    }

    public func title(locale: Locale = .current, calendar: Calendar = .current) -> String {
        let f = DateFormatter()
        f.locale = locale
        f.calendar = calendar
        f.timeZone = calendar.timeZone
        f.setLocalizedDateFormatFromTemplate("MMMM yyyy")
        return f.string(from: interval.start)
    }
}

/// A Period with how many Photos the Source has in it.
public struct PeriodSummary: Hashable, Sendable, Identifiable {
    public let period: Period
    public let photoCount: Int
    public var id: Date { period.id }
}

public enum PeriodIndex {
    /// Months that contain Photos, newest first, with counts.
    public static func months(of dates: [Date], calendar: Calendar = .current) -> [PeriodSummary] {
        var counts: [Date: Int] = [:]
        for d in dates {
            counts[calendar.dateInterval(of: .month, for: d)!.start, default: 0] += 1
        }
        return counts.keys.sorted(by: >).map {
            PeriodSummary(period: Period.month(containing: $0, calendar: calendar), photoCount: counts[$0]!)
        }
    }
}

/// A transient view: the Photos of one Period that are not yet in the Book and not Excluded
/// from it. Nothing persists it.
public struct Group: Sendable {
    public let period: Period
    /// Oldest first.
    public let photos: [Photo]
    /// Photos of the Period the Book already holds or excluded, for "Show excluded".
    public let hidden: [Photo]

    /// `isInBook` answers whether the Book already contains or excludes a Photo.
    public init(period: Period, photos all: [Photo], isInBook: (PhotoID) -> Bool) {
        self.period = period
        let sorted = all.sorted { ($0.captureDate ?? .distantPast) < ($1.captureDate ?? .distantPast) }
        photos = sorted.filter { !isInBook($0.id) }
        hidden = sorted.filter { isInBook($0.id) }
    }
}
