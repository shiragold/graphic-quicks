import Foundation

/// One recorded choice the user made (research/jargon.md, "Usage Signal"), with the Catalog IDs
/// involved. Every payload is a Catalog ID, a Page Format, a Binding name, a small enum, an
/// Int or a `CollageRef`: there is no case that can carry a Photo, an Image, a Photo ID,
/// typed text or a place.
public enum UsageSignal: Hashable, Codable, Sendable {
    /// A Book was started with this Page Format ("Page Format chosen").
    case bookStarted(format: PageFormat)

    /// Template Suggestions were shown. The denominator of the pick rate.
    case suggestionsShown(variants: [Variant])

    /// A Template was picked for a new Collage, from Suggestions (with list position) or from
    /// Search ("Suggestion Pick", "Search Pick"). The Collage counts as made from `variant`.
    case templatePicked(collage: CollageRef, variant: Variant, source: PickSource)

    /// Change Template on a Collage. When `from` and `to` are in different Themes this is also
    /// a Change Theme. `from` counts as replaced, `to` as made.
    case templateChanged(collage: CollageRef, from: Variant, to: Variant)

    /// A Palette was set on a Collage ("Variant Chosen"); `variant` carries the new Palette.
    case paletteChosen(collage: CollageRef, variant: Variant)

    /// Remake on the same Template (Reshuffle).
    case remade(collage: CollageRef, variant: Variant)

    /// Swap, Replace and Re-fit of Photos inside a Collage. Recorded, not part of the report.
    case swapped(collage: CollageRef, variant: Variant)
    case replaced(collage: CollageRef, variant: Variant)
    case refitted(collage: CollageRef, variant: Variant)

    /// Default Text overwritten in a Text Slot ("Text Edited"). Only the Binding is recorded.
    case textEdited(collage: CollageRef, variant: Variant, binding: TextBinding)

    /// Accept and Export. Either one makes the Collage "kept" unless it is later replaced or
    /// removed. `optionalSlot` is the Optional Slot outcome at that moment.
    case accepted(collage: CollageRef, variant: Variant, optionalSlot: OptionalSlotOutcome)
    case exported(collage: CollageRef, variant: Variant, optionalSlot: OptionalSlotOutcome)

    /// Remove Collage.
    case collageRemoved(collage: CollageRef, variant: Variant)

    /// The one-tap Quick Rating, and the user closing it without rating.
    case quickRated(collage: CollageRef, variant: Variant, rating: QuickRating)
    case quickRatingDismissed(collage: CollageRef)
}

extension UsageSignal {
    /// The kinds of signal, for exhaustive tests and diagnostics.
    public enum Kind: String, CaseIterable, Sendable {
        case bookStarted, suggestionsShown, templatePicked, templateChanged, paletteChosen
        case remade, swapped, replaced, refitted, textEdited, accepted, exported
        case collageRemoved, quickRated, quickRatingDismissed
    }

    public var kind: Kind {
        switch self {
        case .bookStarted: .bookStarted
        case .suggestionsShown: .suggestionsShown
        case .templatePicked: .templatePicked
        case .templateChanged: .templateChanged
        case .paletteChosen: .paletteChosen
        case .remade: .remade
        case .swapped: .swapped
        case .replaced: .replaced
        case .refitted: .refitted
        case .textEdited: .textEdited
        case .accepted: .accepted
        case .exported: .exported
        case .collageRemoved: .collageRemoved
        case .quickRated: .quickRated
        case .quickRatingDismissed: .quickRatingDismissed
        }
    }

    /// The Collage this signal is about, if any.
    public var collage: CollageRef? {
        switch self {
        case .bookStarted, .suggestionsShown: nil
        case .templatePicked(let c, _, _), .templateChanged(let c, _, _),
             .paletteChosen(let c, _), .remade(let c, _), .swapped(let c, _),
             .replaced(let c, _), .refitted(let c, _), .textEdited(let c, _, _),
             .accepted(let c, _, _), .exported(let c, _, _), .collageRemoved(let c, _),
             .quickRated(let c, _, _), .quickRatingDismissed(let c):
            c
        }
    }
}

/// Where a picked Template came from.
public enum PickSource: Hashable, Codable, Sendable {
    /// From Template Suggestions; `position` is the 0-based place in the list.
    case suggestion(position: Int)
    case search
}

/// Whether the Collage's Template has an Optional Slot, and if so whether it was filled.
public enum OptionalSlotOutcome: String, Hashable, Codable, Sendable {
    case none, filled, empty
}

/// The Quick Rating: 👍 or 👎.
public enum QuickRating: String, Hashable, Codable, Sendable, CaseIterable {
    case up, down
}

/// A Usage Signal as stored: its order in the log, when it happened, and the calendar month it
/// belongs to. The month is fixed when the signal is recorded, in the user's time zone at that
/// moment, so travelling later never moves a signal to another month's report. The time zone
/// itself is not stored (it would hint at a place).
public struct UsageEntry: Hashable, Codable, Sendable {
    public let sequence: Int
    public let date: Date
    public let month: UsageMonth
    public let signal: UsageSignal

    public init(sequence: Int, date: Date, month: UsageMonth, signal: UsageSignal) {
        self.sequence = sequence
        self.date = date
        self.month = month
        self.signal = signal
    }
}
