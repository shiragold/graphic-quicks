import Catalog
import Composition
import CoreGraphics
import Foundation
import Insights
import Library

/// A Template proposed for the Photos being added.
public struct TemplateCandidate: Hashable, Sendable, Identifiable {
    public let theme: String
    public let template: Template
    /// Lower is better.
    public let score: Double
    /// The Template has a Slot for every Photo (no Photo is left Unplaced).
    public let fitsExactly: Bool

    public var id: String { template.id }
}

/// Template Suggestion, walking-skeleton version: Templates whose photo count range suits the
/// number of Photos, closest first. Orientation mix, season, Tags and Preferences come later.
public enum TemplateSuggester {
    /// Templates that can take `photoCount` Photos: `photoCount.min ≤ n`. When there are more
    /// Photos than Slots, the rest stay Unplaced, so such Templates are ranked lower.
    public static func candidates(in catalog: Catalog, photoCount n: Int, theme: String? = nil) -> [TemplateCandidate] {
        guard n > 0 else { return [] }
        var out: [TemplateCandidate] = []
        for b in catalog.bundles where theme == nil || b.id == theme {
            for t in b.templates where t.photoCount.min <= n {
                let leftOver = max(0, n - t.photoCount.max)
                out.append(TemplateCandidate(theme: b.id, template: t, score: Double(leftOver),
                                             fitsExactly: t.photoCount.contains(n)))
            }
        }
        return out.sorted { ($0.score, $0.template.id) < ($1.score, $1.template.id) }
    }
}

/// A Photo with what the Matcher needs to know about it.
public struct MatchablePhoto: Sendable, Hashable {
    public var id: PhotoID
    public var aspect: Double
    public var insight: Insight

    public init(id: PhotoID, aspect: Double, insight: Insight = Insight()) {
        self.id = id
        self.aspect = aspect
        self.insight = insight
    }
}

/// Proposes Placements (research/jargon.md, "Matcher"). Greedy, the v0 rule of the reference
/// renderer: fill Slots by Importance (then area); for each choose the unused Photo with the
/// smallest `|ln(photoAspect / slotAspect)|`, plus a rank penalty (doubled for the Hero),
/// minus a bonus for Faces when the Slot's Focus is faces. Rank is the Photo's position in
/// `photos`, which callers order best first.
public enum Matcher {
    public static func place(_ photos: [MatchablePhoto], in template: ResolvedTemplate) -> [String: PhotoID] {
        let order = template.slots.enumerated().sorted { a, b in
            let (sa, sb) = (a.element, b.element)
            if sa.importance != sb.importance { return sa.importance < sb.importance }
            let (aa, ab) = (sa.frame.w * sa.frame.h, sb.frame.w * sb.frame.h)
            if aa != ab { return aa > ab }
            return a.offset < b.offset
        }.map(\.element)
        var used = Set<PhotoID>()
        var out: [String: PhotoID] = [:]
        for slot in order {
            let slotAspect = slot.frame.aspect
            var best: (PhotoID, Double)?
            for (rank, p) in photos.enumerated() where !used.contains(p.id) {
                let faceBonus = slot.focus == .faces && p.insight.hasFaces ? -0.4 : 0
                let score = abs(log(p.aspect / slotAspect)) + 0.12 * Double(rank) * (slot.importance == 1 ? 2 : 1) + faceBonus
                if best == nil || score < best!.1 { best = (p.id, score) }
            }
            guard let (id, _) = best else { break }
            used.insert(id)
            out[slot.id] = id
        }
        return out
    }
}

/// The Fit Suggestion: cover the Slot, centred on the Focal Point, clamped.
public enum FitSuggester {
    public static func fit(for insight: Insight) -> Fit {
        Fit(scale: 1, centre: insight.focalPoint, origin: .suggested)
    }
}

/// Makes a new Collage from a Template and Photos: Optional Slots for the photo count, the
/// Matcher's Placements and suggested Fits.
public enum CollageMaker {
    public static func make(template: Template, theme: ThemeRef, format: PageFormat, palette: String = "default",
                            photos: [MatchablePhoto]) throws -> Collage {
        let count = min(photos.count, template.photoCount.max)
        let resolved = try template.resolve(format: format, photoCount: count)
        let assignment = Matcher.place(photos, in: resolved)
        let byID = Dictionary(photos.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        var placements: [String: Placement] = [:]
        var fits: [String: Fit] = [:]
        for (slot, id) in assignment {
            placements[slot] = Placement(photo: id, origin: .suggested)
            fits[slot] = FitSuggester.fit(for: byID[id]?.insight ?? Insight())
        }
        return Collage(templateID: template.id, theme: theme, palette: palette, photoCount: count,
                       placements: placements, fits: fits)
    }
}
