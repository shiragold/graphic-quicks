import Foundation

/// Local aggregates of the Usage Log that Suggestion may use as a small ranking boost
/// (research/jargon.md, "Preference"). They are an explicit, inspectable input: Suggestion
/// stays deterministic given its inputs, and "Reset usage data" returns `Preferences.none`.
public struct Preferences: Hashable, Sendable {
    /// The largest boost (up or down) added to a Template's suggestion score.
    public static let maximumBoost = 0.1
    /// Signals needed before an affinity reaches half its range.
    public static let prior = 5.0

    /// What the user did with each Template, over the whole log.
    public var templates: [TemplateRef: Affinity]
    /// The same, summed per Theme.
    public var themes: [ThemeID: Affinity]
    /// The Palette the user usually picks in a Theme, when there is a clear one.
    public var palettes: [ThemeID: PaletteID]
    /// The Page Format most Books were started with, when there is a clear one.
    public var pageFormat: PageFormat?
    /// Change Template pairs: "often replaces A with B".
    public var replacements: [Replacement]

    public static let none = Preferences(templates: [:], themes: [:], palettes: [:], pageFormat: nil, replacements: [])

    public init(templates: [TemplateRef: Affinity], themes: [ThemeID: Affinity],
                palettes: [ThemeID: PaletteID], pageFormat: PageFormat?, replacements: [Replacement]) {
        self.templates = templates
        self.themes = themes
        self.palettes = palettes
        self.pageFormat = pageFormat
        self.replacements = replacements
    }

    public struct Affinity: Hashable, Sendable {
        /// Picked, found in Search, kept, chosen as a replacement, rated 👍.
        public var positive: Int
        /// Replaced, removed, rated 👎.
        public var negative: Int

        public init(positive: Int = 0, negative: Int = 0) {
            self.positive = positive
            self.negative = negative
        }

        /// In (-1, 1): (positive − negative) / (positive + negative + prior).
        public var score: Double {
            Double(positive - negative) / (Double(positive + negative) + Preferences.prior)
        }
    }

    public struct Replacement: Hashable, Sendable {
        public var from: TemplateRef
        public var to: TemplateRef
        public var count: Int
    }

    /// The ranking boost for a Template, in `-maximumBoost...maximumBoost`: 70 % from the
    /// Template's own affinity, 30 % from its Theme's. Zero for anything never used.
    public func boost(for template: TemplateRef) -> Double {
        let own = templates[template]?.score ?? 0
        let theme = themes[template.theme]?.score ?? 0
        return Self.maximumBoost * (0.7 * own + 0.3 * theme)
    }
}

extension Preferences {
    /// Derives Preferences from the log.
    public static func derive(from entries: [UsageEntry]) -> Preferences {
        var templates: [TemplateRef: Affinity] = [:]
        var pairs: [TemplatePair: Int] = [:]
        var formats: [PageFormat: Int] = [:]
        var themeCollages: [ThemeID: Set<CollageRef>] = [:]
        var paletteCollages: [ThemeID: [PaletteID: Set<CollageRef>]] = [:]
        var kept: Set<CollageRef> = []
        var rated: Set<CollageRef> = []

        func plus(_ ref: TemplateRef) { templates[ref, default: .init()].positive += 1 }
        func minus(_ ref: TemplateRef) { templates[ref, default: .init()].negative += 1 }

        for entry in entries.sorted(by: { $0.sequence < $1.sequence }) {
            if let collage = entry.signal.collage, let theme = entry.signal.variant?.theme {
                themeCollages[theme, default: []].insert(collage)
            }
            switch entry.signal {
            case .bookStarted(let format):
                formats[format, default: 0] += 1
            case .templatePicked(_, let v, _):
                plus(v.templateRef)
            case .templateChanged(let c, let from, let to):
                minus(from.templateRef)
                plus(to.templateRef)
                kept.remove(c)
                if from.templateRef != to.templateRef {
                    pairs[TemplatePair(from: from.templateRef, to: to.templateRef), default: 0] += 1
                }
            case .accepted(let c, let v, _), .exported(let c, let v, _):
                // Keeping counts once per Collage, however often it is accepted or exported.
                if kept.insert(c).inserted { plus(v.templateRef) }
            case .collageRemoved(let c, let v):
                minus(v.templateRef)
                kept.remove(c)
            case .quickRated(let c, let v, let rating):
                if rated.insert(c).inserted { rating == .up ? plus(v.templateRef) : minus(v.templateRef) }
            case .paletteChosen(let c, let v):
                paletteCollages[v.theme, default: [:]][v.palette, default: []].insert(c)
            case .suggestionsShown, .remade, .swapped, .replaced, .refitted, .textEdited, .quickRatingDismissed:
                break
            }
        }

        var themes: [ThemeID: Affinity] = [:]
        for (ref, affinity) in templates {
            themes[ref.theme, default: .init()].positive += affinity.positive
            themes[ref.theme, default: .init()].negative += affinity.negative
        }

        // A Palette is preferred when it was set on at least 3 Collages of the Theme and on at
        // least half of all the Theme's Collages.
        var palettes: [ThemeID: PaletteID] = [:]
        for (theme, byPalette) in paletteCollages {
            let total = themeCollages[theme]?.count ?? 0
            let best = byPalette.max { ($0.value.count, $1.key) < ($1.value.count, $0.key) }
            if let best, !best.key.isDefault, best.value.count >= 3, best.value.count * 2 >= total {
                palettes[theme] = best.key
            }
        }

        // A Page Format is preferred when at least 2 Books used it and no other format ties it.
        let sortedFormats = formats.sorted { ($0.value, $1.key) > ($1.value, $0.key) }
        var pageFormat: PageFormat?
        if let first = sortedFormats.first, first.value >= 2,
           sortedFormats.dropFirst().first.map({ $0.value < first.value }) ?? true {
            pageFormat = first.key
        }

        return Preferences(
            templates: templates,
            themes: themes,
            palettes: palettes,
            pageFormat: pageFormat,
            replacements: pairs.map { Replacement(from: $0.key.from, to: $0.key.to, count: $0.value) }
                .sorted { ($1.count, $0.from, $0.to) < ($0.count, $1.from, $1.to) })
    }
}

extension UsageSignal {
    /// The Variant this signal is about (the new one for Change Template).
    public var variant: Variant? {
        switch self {
        case .bookStarted, .suggestionsShown, .quickRatingDismissed: nil
        case .templateChanged(_, _, let to): to
        case .templatePicked(_, let v, _), .paletteChosen(_, let v), .remade(_, let v),
             .swapped(_, let v), .replaced(_, let v), .refitted(_, let v),
             .textEdited(_, let v, _), .accepted(_, let v, _), .exported(_, let v, _),
             .collageRemoved(_, let v), .quickRated(_, let v, _):
            v
        }
    }
}
