import CoreGraphics
import Foundation

/// The shape and print size of a Collage. Every Template ships in all three.
public enum PageFormat: String, CaseIterable, Codable, Sendable, Hashable, Identifiable {
    case square
    case a4Portrait = "a4-portrait"
    case a4Landscape = "a4-landscape"

    public var id: String { rawValue }

    /// The Canvas in design units (short side 1000).
    public var canvas: CGSize {
        switch self {
        case .square: CGSize(width: 1000, height: 1000)
        case .a4Portrait: CGSize(width: 1000, height: 1414)
        case .a4Landscape: CGSize(width: 1414, height: 1000)
        }
    }

    /// Print size in millimetres (square is 305 mm, 12 in).
    public var printMillimetres: CGSize {
        switch self {
        case .square: CGSize(width: 305, height: 305)
        case .a4Portrait: CGSize(width: 210, height: 297)
        case .a4Landscape: CGSize(width: 297, height: 210)
        }
    }

    /// Print size in PostScript points, the PDF media box.
    public var printPoints: CGSize {
        CGSize(width: printMillimetres.width / 25.4 * 72, height: printMillimetres.height / 25.4 * 72)
    }

    /// The Output Size at a Resolution, in pixels.
    public func outputSize(dpi: Double) -> CGSize {
        CGSize(width: (printMillimetres.width / 25.4 * dpi).rounded(),
               height: (printMillimetres.height / 25.4 * dpi).rounded())
    }

    public var displayName: String {
        switch self {
        case .square: "Square (305 mm)"
        case .a4Portrait: "A4 portrait"
        case .a4Landscape: "A4 landscape"
        }
    }
}

/// Paper texture tiles are 6 in (152.4 mm) square, repeated at their physical size so grain
/// looks the same on every Page Format (`TILE_MM` in `tools/formats.mjs`).
public let textureTileMillimetres: Double = 152.4

/// A Layer's rectangle in design units (or in its parent's local units when attached),
/// rotated about its centre. Geometry only.
public struct Frame: Codable, Hashable, Sendable {
    public var x: Double
    public var y: Double
    public var w: Double
    public var h: Double

    public init(x: Double, y: Double, w: Double, h: Double) {
        self.x = x; self.y = y; self.w = w; self.h = h
    }

    public var rect: CGRect { CGRect(x: x, y: y, width: w, height: h) }
    public var aspect: Double { w / h }
}
