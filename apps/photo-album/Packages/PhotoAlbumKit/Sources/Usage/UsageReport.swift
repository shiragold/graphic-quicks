import Foundation

/// The monthly Usage Report, in the shape of
/// `research/themes/skill/references/usage-report.md`. Aggregate counts per Variant only:
/// no Collage references, no dates finer than the month.
public struct UsageReport: Hashable, Codable, Sendable {
    public var period: UsageMonth
    public var appVersion: String
    public var rows: [Row]
    public var replacedBy: [ReplacedBy]
    public var variants: Variants

    public struct Row: Hashable, Codable, Sendable {
        public var theme: ThemeID
        public var template: TemplateID
        public var format: PageFormat
        public var palette: PaletteID
        /// Times offered in Template Suggestions.
        public var suggested = 0
        /// Chosen from Suggestions.
        public var picked = 0
        /// Chosen from Search.
        public var searched = 0
        /// Collages made from it (picked, searched, or the target of Change Template).
        public var made = 0
        /// Accepted or exported, and not later replaced or removed.
        public var kept = 0
        /// Change Template away from it.
        public var replaced = 0
        /// Remove Collage.
        public var removed = 0
        /// Collages with at least one Reshuffle.
        public var remade = 0
        /// Kept with an Optional Slot empty.
        public var optionalEmpty = 0
        /// Default Text typed over, per Binding (Collages, once per Binding).
        public var textOverridden: [TextBinding: Int] = [:]
        public var ratingUp = 0
        public var ratingDown = 0

        public init(variant: Variant) {
            theme = variant.theme
            template = variant.template
            format = variant.format
            palette = variant.palette
        }

        public var variant: Variant {
            Variant(theme: theme, template: template, format: format, palette: palette)
        }

        var isEmpty: Bool {
            suggested == 0 && picked == 0 && searched == 0 && made == 0 && kept == 0
                && replaced == 0 && removed == 0 && remade == 0 && optionalEmpty == 0
                && textOverridden.isEmpty && ratingUp == 0 && ratingDown == 0
        }

        enum CodingKeys: String, CodingKey {
            case theme, template, format, palette, suggested, picked, searched, made, kept
            case replaced, removed, remade, optionalEmpty, textOverridden, ratingUp, ratingDown
        }

        public init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            theme = try c.decode(ThemeID.self, forKey: .theme)
            template = try c.decode(TemplateID.self, forKey: .template)
            format = try c.decode(PageFormat.self, forKey: .format)
            palette = try c.decode(PaletteID.self, forKey: .palette)
            suggested = try c.decode(Int.self, forKey: .suggested)
            picked = try c.decode(Int.self, forKey: .picked)
            searched = try c.decode(Int.self, forKey: .searched)
            made = try c.decode(Int.self, forKey: .made)
            kept = try c.decode(Int.self, forKey: .kept)
            replaced = try c.decode(Int.self, forKey: .replaced)
            removed = try c.decode(Int.self, forKey: .removed)
            remade = try c.decode(Int.self, forKey: .remade)
            optionalEmpty = try c.decode(Int.self, forKey: .optionalEmpty)
            let text = try c.decode([String: Int].self, forKey: .textOverridden)
            textOverridden = try text.reduce(into: [:]) { result, pair in
                guard let binding = TextBinding(rawValue: pair.key) else {
                    throw DecodingError.dataCorruptedError(
                        forKey: .textOverridden, in: c, debugDescription: "Unknown binding \(pair.key)")
                }
                result[binding] = pair.value
            }
            ratingUp = try c.decode(Int.self, forKey: .ratingUp)
            ratingDown = try c.decode(Int.self, forKey: .ratingDown)
        }

        public func encode(to encoder: any Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(theme, forKey: .theme)
            try c.encode(template, forKey: .template)
            try c.encode(format, forKey: .format)
            try c.encode(palette, forKey: .palette)
            try c.encode(suggested, forKey: .suggested)
            try c.encode(picked, forKey: .picked)
            try c.encode(searched, forKey: .searched)
            try c.encode(made, forKey: .made)
            try c.encode(kept, forKey: .kept)
            try c.encode(replaced, forKey: .replaced)
            try c.encode(removed, forKey: .removed)
            try c.encode(remade, forKey: .remade)
            try c.encode(optionalEmpty, forKey: .optionalEmpty)
            // A [TextBinding: Int] would encode as an array; the report wants an object.
            try c.encode(Dictionary(uniqueKeysWithValues: textOverridden.map { ($0.key.rawValue, $0.value) }),
                         forKey: .textOverridden)
            try c.encode(ratingUp, forKey: .ratingUp)
            try c.encode(ratingDown, forKey: .ratingDown)
        }
    }

    /// A Change Template pair, `theme/template` → `theme/template`.
    public struct ReplacedBy: Hashable, Codable, Sendable {
        public var from: String
        public var to: String
        public var count: Int
        public var themeChanged: Bool

        public init(from: TemplateRef, to: TemplateRef, count: Int) {
            self.from = from.description
            self.to = to.description
            self.count = count
            self.themeChanged = from.theme != to.theme
        }
    }

    public struct Variants: Hashable, Codable, Sendable {
        /// Collages a non-default Palette was set on, keyed `theme/palette`.
        public var palette: [String: Int]
        /// Books started per Page Format; every format is listed, zero included.
        public var format: [String: Int]

        public init(palette: [String: Int] = [:], format: [String: Int] = [:]) {
            self.palette = palette
            self.format = format
        }
    }

    public init(period: UsageMonth, appVersion: String, rows: [Row] = [],
                replacedBy: [ReplacedBy] = [], variants: Variants = .init()) {
        self.period = period
        self.appVersion = appVersion
        self.rows = rows
        self.replacedBy = replacedBy
        self.variants = variants
    }

    /// The JSON written to `usage-YYYY-MM.json`: pretty-printed, keys sorted, slashes unescaped.
    public func encoded() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(self)
    }
}

extension UsageReport {
    /// Builds the report for `month` from the whole log. The whole log is needed because
    /// "kept" depends on later signals: a Collage accepted in October and replaced in November
    /// is not kept, so October's report changes when November's signal is recorded.
    public static func aggregate(_ entries: [UsageEntry], month: UsageMonth, appVersion: String) -> UsageReport {
        var rows: [Variant: Row] = [:]
        func update(_ variant: Variant, _ change: (inout Row) -> Void) {
            change(&rows[variant, default: Row(variant: variant)])
        }

        var pairs: [TemplatePair: Int] = [:]
        var palettes: [String: Set<CollageRef>] = [:]
        var formats = Dictionary(uniqueKeysWithValues: PageFormat.allCases.map { ($0.rawValue, 0) })
        var remade: Set<VariantCollage> = []
        var overridden: Set<BindingCollage> = []
        var rated: Set<CollageRef> = []
        // The latest keep of each Collage, cleared by Change Template away or Remove Collage.
        var lastKeep: [CollageRef: (entry: UsageEntry, variant: Variant, optional: OptionalSlotOutcome)] = [:]

        for entry in entries.sorted(by: { $0.sequence < $1.sequence }) {
            let inMonth = entry.month == month
            switch entry.signal {
            case .accepted(let c, let v, let o), .exported(let c, let v, let o):
                lastKeep[c] = (entry, v, o)
            case .templateChanged(let c, _, _), .collageRemoved(let c, _):
                lastKeep[c] = nil
            default:
                break
            }
            // A Collage is rated once; the first rating counts, wherever it falls.
            if case .quickRated(let c, let v, let r) = entry.signal, rated.insert(c).inserted, inMonth {
                update(v) { r == .up ? ($0.ratingUp += 1) : ($0.ratingDown += 1) }
            }
            guard inMonth else { continue }

            switch entry.signal {
            case .bookStarted(let format):
                formats[format.rawValue, default: 0] += 1
            case .suggestionsShown(let variants):
                for v in Set(variants) { update(v) { $0.suggested += 1 } }
            case .templatePicked(_, let v, let source):
                update(v) {
                    $0.made += 1
                    switch source {
                    case .suggestion: $0.picked += 1
                    case .search: $0.searched += 1
                    }
                }
            case .templateChanged(_, let from, let to):
                update(from) { $0.replaced += 1 }
                update(to) { $0.made += 1 }
                if from.templateRef != to.templateRef {
                    pairs[TemplatePair(from: from.templateRef, to: to.templateRef), default: 0] += 1
                }
            case .paletteChosen(let c, let v):
                if !v.palette.isDefault { palettes["\(v.theme)/\(v.palette)", default: []].insert(c) }
            case .remade(let c, let v):
                if remade.insert(VariantCollage(variant: v, collage: c)).inserted {
                    update(v) { $0.remade += 1 }
                }
            case .textEdited(let c, let v, let binding):
                if overridden.insert(BindingCollage(variant: v, collage: c, binding: binding)).inserted {
                    update(v) { $0.textOverridden[binding, default: 0] += 1 }
                }
            case .collageRemoved(_, let v):
                update(v) { $0.removed += 1 }
            case .swapped, .replaced, .refitted, .accepted, .exported, .quickRated, .quickRatingDismissed:
                break
            }
        }

        for keep in lastKeep.values where keep.entry.month == month {
            update(keep.variant) {
                $0.kept += 1
                if keep.optional == .empty { $0.optionalEmpty += 1 }
            }
        }

        return UsageReport(
            period: month,
            appVersion: appVersion,
            rows: rows.values.filter { !$0.isEmpty }.sorted { $0.variant < $1.variant },
            replacedBy: pairs.map { ReplacedBy(from: $0.key.from, to: $0.key.to, count: $0.value) }
                .sorted { ($0.from, $0.to) < ($1.from, $1.to) },
            variants: Variants(palette: palettes.mapValues(\.count), format: formats))
    }
}

struct TemplatePair: Hashable {
    let from: TemplateRef
    let to: TemplateRef
}

private struct VariantCollage: Hashable {
    let variant: Variant
    let collage: CollageRef
}

private struct BindingCollage: Hashable {
    let variant: Variant
    let collage: CollageRef
    let binding: TextBinding
}
