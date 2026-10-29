import Catalog
import CoreGraphics
import Foundation
import ImageIO

/// Loads and caches a Theme bundle's decoration files (Tokens substituted per Palette), mask
/// paths and texture tiles.
public final class ThemeAssets: @unchecked Sendable {
    public let bundle: ThemeBundle
    private let lock = NSLock()
    private var documents: [String: SVGDocument] = [:]
    private var masks: [String: CGPath] = [:]
    private var textures: [String: CGImage] = [:]

    public init(bundle: ThemeBundle) {
        self.bundle = bundle
    }

    func isTexture(_ assetID: String) -> Bool {
        (bundle.theme.assets[assetID] ?? "").lowercased().hasSuffix(".png")
    }

    func document(_ assetID: String, palette: Palette) throws -> SVGDocument {
        let key = "\(palette.name)|\(assetID)"
        if let d = lock.withLock({ documents[key] }) { return d }
        let raw = try String(contentsOf: bundle.assetURL(assetID), encoding: .utf8)
        let doc = try SVGDocument(data: Data(palette.substitute(in: raw).utf8))
        lock.withLock { documents[key] = doc }
        return doc
    }

    /// A path Mask in its 0..1 box.
    func maskPath(_ assetID: String) throws -> CGPath {
        if let p = lock.withLock({ masks[assetID] }) { return p }
        let raw = try String(contentsOf: bundle.assetURL(assetID), encoding: .utf8)
        let doc = try SVGDocument(data: Data(raw.utf8))
        let p = SVGPath.parse(doc.firstPathData ?? "")
        lock.withLock { masks[assetID] = p }
        return p
    }

    func texture(_ assetID: String) throws -> CGImage {
        if let t = lock.withLock({ textures[assetID] }) { return t }
        let url = try bundle.assetURL(assetID)
        guard let src = CGImageSourceCreateWithURL(url as CFURL, nil),
              let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
            throw RenderError.badImage(url.lastPathComponent)
        }
        lock.withLock { textures[assetID] = img }
        return img
    }
}

/// Mask and Shape geometry in frame-local coordinates (0,0)–(w,h), `shapePath` in the
/// reference renderer.
enum MaskGeometry {
    static func path(_ mask: Mask, size: CGSize, assets: ThemeAssets) throws -> CGPath {
        let w = size.width, h = size.height
        let p = CGMutablePath()
        switch mask.shape {
        case .rect:
            p.addRect(CGRect(x: 0, y: 0, width: w, height: h))
        case .roundRect:
            let r = (mask.radius ?? 0.08) * min(w, h)
            p.addRoundedRect(in: CGRect(x: 0, y: 0, width: w, height: h), cornerWidth: r, cornerHeight: r)
        case .circle, .ellipse:
            p.addEllipse(in: CGRect(x: 0, y: 0, width: w, height: h))
        case .arch:
            // M0 h V r A r r 0 0 1 w r V h Z, with r = w/2 (a circular top when h ≥ r).
            let r = w / 2
            p.move(to: CGPoint(x: 0, y: h))
            p.addLine(to: CGPoint(x: 0, y: r))
            SVGPath.addArc(p, from: CGPoint(x: 0, y: r), to: CGPoint(x: w, y: r), rx: r, ry: r,
                           rotation: 0, large: false, sweep: true)
            p.addLine(to: CGPoint(x: w, y: h))
            p.closeSubpath()
        case .path:
            let unit = try assets.maskPath(mask.asset ?? "")
            p.addPath(unit, transform: CGAffineTransform(scaleX: w, y: h))
        }
        return p
    }
}
