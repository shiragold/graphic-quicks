import CoreGraphics
import Foundation
import Library

/// Everything the app computed about one Photo's content. A fact, never a decision.
public struct Insight: Codable, Hashable, Sendable {
    /// The point that must stay visible and as central as possible, normalized 0..1 with the
    /// origin at the top left.
    public var focalPoint: CGPoint
    /// Face rectangles, normalized 0..1.
    public var faces: [CGRect]
    /// Vision's aesthetics score (−1…1), when computed.
    public var qualityScore: Double?

    public init(focalPoint: CGPoint = CGPoint(x: 0.5, y: 0.5), faces: [CGRect] = [], qualityScore: Double? = nil) {
        self.focalPoint = focalPoint
        self.faces = faces
        self.qualityScore = qualityScore
    }

    public var hasFaces: Bool { !faces.isEmpty }
}

/// Produces Insights for Photos.
public protocol InsightProvider: Sendable {
    func insight(for photo: Photo) async -> Insight
}

/// The walking-skeleton stand-in for the Vision step: every Photo gets a centred Focal Point,
/// no Faces and no Quality Score. The real provider runs saliency, face and aesthetics
/// requests and caches the results by Photo ID and modification date.
public struct CentreFocusInsights: InsightProvider {
    public init() {}
    public func insight(for photo: Photo) async -> Insight { Insight() }
}
