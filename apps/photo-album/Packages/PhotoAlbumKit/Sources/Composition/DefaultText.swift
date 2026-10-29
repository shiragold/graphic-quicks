import Catalog
import Foundation
import Library

/// Default Text: what a Text Slot starts with, derived from the Collage's placed Photos
/// (research/jargon.md, "Default Text"). `{story}` has none.
public enum DefaultText {
    /// Binding values for the Photos of a Collage. `sections` maps a Section number to the
    /// Photos in that Section's Slots.
    public static func values(for photos: [Photo], sections: [Int: [Photo]] = [:],
                              locale: Locale = .current, calendar: Calendar = .current) -> BindingValues {
        let dates = photos.compactMap(\.captureDate).sorted()
        var strings: [String: String] = [:]
        let place = mostCommonPlace(photos)
        strings["place"] = place ?? ""
        strings["title"] = place ?? dates.first.map { format($0, "MMMM", locale, calendar) } ?? ""
        let span = dateSpan(dates, locale: locale, calendar: calendar)
        strings["subtitle"] = span
        strings["dateRange"] = span
        strings["count"] = String(photos.count)
        for (n, ps) in sections {
            let first = ps.compactMap(\.captureDate).min()
            strings["section\(n)"] = mostCommonPlace(ps) ?? first.map { format($0, "EEEE", locale, calendar) } ?? ""
        }
        return BindingValues(strings: strings, date: dates.first, timeZone: calendar.timeZone)
    }

    static func mostCommonPlace(_ photos: [Photo]) -> String? {
        let counts = Dictionary(grouping: photos.compactMap(\.place), by: { $0 }).mapValues(\.count)
        return counts.max { ($0.value, $1.key) < ($1.value, $0.key) }?.key
    }

    /// "12–19 July 2026", "30 June – 2 July 2026", or one day.
    static func dateSpan(_ dates: [Date], locale: Locale, calendar: Calendar) -> String {
        guard let a = dates.first, let b = dates.last else { return "" }
        let f = DateIntervalFormatter()
        f.locale = locale
        f.calendar = calendar
        f.timeZone = calendar.timeZone
        f.dateTemplate = "dMMMMyyyy"
        return f.string(from: a, to: b)
    }

    static func format(_ date: Date, _ template: String, _ locale: Locale, _ calendar: Calendar) -> String {
        let f = DateFormatter()
        f.locale = locale
        f.calendar = calendar
        f.timeZone = calendar.timeZone
        f.setLocalizedDateFormatFromTemplate(template)
        return f.string(from: date)
    }
}
