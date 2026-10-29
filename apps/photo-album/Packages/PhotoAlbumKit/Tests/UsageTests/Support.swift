import Foundation
import Synchronization
@testable import Usage

/// A settable clock for `UsageLog(now:)`.
final class TestClock: Sendable {
    private let current: Mutex<Date>

    init(_ date: Date) { current = Mutex(date) }

    var now: Date { current.withLock { $0 } }
    func set(_ date: Date) { current.withLock { $0 = date } }
    func set(_ iso: String) { set(date(iso)) }
}

final class TestZone: Sendable {
    private let zone: Mutex<TimeZone>
    init(_ zone: TimeZone) { self.zone = .init(zone) }
    var value: TimeZone { zone.withLock { $0 } }
    func set(_ new: TimeZone) { zone.withLock { $0 = new } }
}

/// Parses an ISO 8601 date with offset, e.g. `2026-10-31T23:30:00-07:00`.
func date(_ iso: String) -> Date {
    try! Date(iso, strategy: .iso8601)
}

let losAngeles = TimeZone(identifier: "America/Los_Angeles")!
let tokyo = TimeZone(identifier: "Asia/Tokyo")!
let utc = TimeZone(identifier: "UTC")!

func month(_ text: String) -> UsageMonth { UsageMonth(text)! }

func collage(_ n: UInt8) -> CollageRef {
    CollageRef(UUID(uuid: (n, 0, 0, 0, 0, 0, 0x40, 0, 0x80, 0, 0, 0, 0, 0, 0, n)))
}

enum Fixtures {
    static let meadow = ThemeID("meadow-arch")!
    static let kraft = ThemeID("kraft-scrapbook")!
    static let story = TemplateID("05-story")!
    static let journal = TemplateID("05-journal-entry")!
    static let winter = PaletteID("winter")!
    static let berry = PaletteID("berry")!

    /// meadow-arch/05-story, A4 portrait, default Palette.
    static let a = Variant(theme: meadow, template: story, format: .a4Portrait)
    /// The same with the winter Palette.
    static let aWinter = Variant(theme: meadow, template: story, format: .a4Portrait, palette: winter)
    /// kraft-scrapbook/05-journal-entry, A4 portrait.
    static let b = Variant(theme: kraft, template: journal, format: .a4Portrait)

    static func url(_ name: String) -> URL {
        Bundle.module.url(forResource: name, withExtension: nil, subdirectory: "Fixtures")!
    }
}

/// A fresh temporary folder, removed by the caller.
func temporaryDirectory() -> URL {
    let url = FileManager.default.temporaryDirectory
        .appending(path: "PhotoAlbumKitTests-\(UUID().uuidString)", directoryHint: .isDirectory)
    try! FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
}

/// One sample of every kind of Usage Signal.
let everySignal: [UsageSignal] = {
    let a = Fixtures.a, b = Fixtures.b, c = collage(1)
    return [
        .bookStarted(format: .square),
        .suggestionsShown(variants: [a, b]),
        .templatePicked(collage: c, variant: a, source: .suggestion(position: 2)),
        .templatePicked(collage: c, variant: a, source: .search),
        .templateChanged(collage: c, from: a, to: b),
        .paletteChosen(collage: c, variant: Fixtures.aWinter),
        .remade(collage: c, variant: a),
        .swapped(collage: c, variant: a),
        .replaced(collage: c, variant: a),
        .refitted(collage: c, variant: a),
        .textEdited(collage: c, variant: a, binding: .title),
        .accepted(collage: c, variant: a, optionalSlot: .empty),
        .exported(collage: c, variant: a, optionalSlot: .filled),
        .collageRemoved(collage: c, variant: a),
        .quickRated(collage: c, variant: a, rating: .up),
        .quickRatingDismissed(collage: c),
    ]
}()
