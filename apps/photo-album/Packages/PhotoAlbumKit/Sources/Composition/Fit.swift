import CoreGraphics
import Foundation

/// Who decided a Placement or a Fit.
public enum Origin: String, Codable, Hashable, Sendable { case suggested, user }

/// The pairing of one Slot with one Book Photo inside a Collage.
public struct Placement: Codable, Hashable, Sendable {
    public var photo: PhotoRef
    public var origin: Origin

    public init(photo: PhotoRef, origin: Origin) {
        self.photo = photo
        self.origin = origin
    }
}

/// How a placed Photo sits inside its Slot: a scale of at least "cover" and the point of the
/// Photo (normalized 0..1, top-left origin) shown at the Slot's centre, clamped so the Photo
/// always fills the Slot.
public struct Fit: Codable, Hashable, Sendable {
    /// 1 = cover exactly; larger zooms in.
    public var scale: Double
    public var centre: CGPoint
    public var origin: Origin

    public init(scale: Double = 1, centre: CGPoint = CGPoint(x: 0.5, y: 0.5), origin: Origin = .suggested) {
        self.scale = max(1, scale)
        self.centre = centre
        self.origin = origin
    }

    /// Where to draw a Photo of `photoAspect` in a Slot of `slot` size (Slot-local, top-left
    /// origin). The result always covers the Slot. With `scale` 1 this equals `coverRect` in
    /// the reference renderer.
    public func imageRect(photoAspect: Double, slot: CGSize) -> CGRect {
        let w = slot.width, h = slot.height
        var iw: Double, ih: Double
        if photoAspect > w / h { ih = h; iw = h * photoAspect } else { iw = w; ih = w / photoAspect }
        iw *= scale; ih *= scale
        let x = min(0, max(w - iw, w / 2 - centre.x * iw))
        let y = min(0, max(h - ih, h / 2 - centre.y * ih))
        return CGRect(x: x, y: y, width: iw, height: ih)
    }
}
