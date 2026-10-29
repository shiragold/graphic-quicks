import Catalog
import Composition
import CoreGraphics
import CoreText
import Foundation

/// The Image placed in a Slot, with its Fit.
public struct SlotImage: @unchecked Sendable {
    public var image: CGImage
    /// Aspect of the Photo (its Original), which may differ slightly from the Image's.
    public var aspect: Double
    public var fit: Fit

    public init(image: CGImage, aspect: Double? = nil, fit: Fit) {
        self.image = image
        self.aspect = aspect ?? Double(image.width) / Double(image.height)
        self.fit = fit
    }
}

/// Everything one Render needs: the resolved Template, its Theme assets and Palette, the
/// Images per Slot and the text per Text Slot.
public struct RenderScene: @unchecked Sendable {
    public var template: ResolvedTemplate
    public var assets: ThemeAssets
    public var palette: Palette
    /// Slot ID → Image. A Slot without one draws an empty placeholder.
    public var images: [String: SlotImage]
    /// Text Slot ID → text the user typed; otherwise the Binding's Default Text is used.
    public var texts: [String: String]
    public var bindings: BindingValues
    public var locale: Locale
    /// Editor-only: draw Text Placeholders in empty Text Slots. Never in an Export.
    public var showsTextPlaceholders: Bool

    public init(template: ResolvedTemplate, assets: ThemeAssets, palette: Palette, images: [String: SlotImage],
                texts: [String: String] = [:], bindings: BindingValues = BindingValues(),
                locale: Locale = .current, showsTextPlaceholders: Bool = false) {
        self.template = template
        self.assets = assets
        self.palette = palette
        self.images = images
        self.texts = texts
        self.bindings = bindings
        self.locale = locale
        self.showsTextPlaceholders = showsTextPlaceholders
    }

    public var canvas: CGSize { template.canvas }
}

/// One renderer for preview and export (themes docs/03, "Rendering rules"). It walks the
/// Template's Layers in painter's order in design units, scaled uniformly to the target.
public struct CollageRenderer: Sendable {
    public init() {}

    /// Draws the scene filling `size` (in the context's current user space, y up as Core
    /// Graphics delivers it for bitmap and PDF contexts).
    public func draw(_ scene: RenderScene, in ctx: CGContext, size: CGSize) {
        let canvas = scene.canvas
        ctx.saveGState()
        ctx.translateBy(x: 0, y: size.height)
        ctx.scaleBy(x: size.width / canvas.width, y: -size.height / canvas.height)
        ctx.addRect(CGRect(origin: .zero, size: canvas))
        ctx.clip()
        ctx.interpolationQuality = .high
        let painter = Painter(scene: scene, ctx: ctx)
        for layer in scene.template.topLevel { painter.draw(layer) }
        ctx.restoreGState()
    }

    /// A bitmap Render in Display P3 at `pixelSize`.
    public func image(_ scene: RenderScene, pixelSize: CGSize, colorSpace: CGColorSpace? = nil) throws -> CGImage {
        let cs = colorSpace ?? CGColorSpace(name: CGColorSpace.displayP3)!
        guard let ctx = CGContext(data: nil, width: Int(pixelSize.width), height: Int(pixelSize.height),
                                  bitsPerComponent: 8, bytesPerRow: 0, space: cs,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
            throw RenderError.context
        }
        draw(scene, in: ctx, size: pixelSize)
        guard let img = ctx.makeImage() else { throw RenderError.context }
        return img
    }

    /// The pixel size of a preview `longSide` pixels long on its longer side.
    public static func previewSize(for format: PageFormat, longSide: Double) -> CGSize {
        let c = format.canvas
        let s = longSide / max(c.width, c.height)
        return CGSize(width: (c.width * s).rounded(), height: (c.height * s).rounded())
    }
}

/// Draws Layers for one Render. Everything is in design units in a y-down user space.
private struct Painter {
    let scene: RenderScene
    let ctx: CGContext

    var palette: Palette { scene.palette }

    func color(_ v: String?, fallback: String = "#000000") -> CGColor {
        SVGColor.parse(palette.resolve(v ?? fallback)) ?? CGColor(srgbRed: 0, green: 0, blue: 0, alpha: 1)
    }

    func draw(_ layer: Layer) {
        switch layer {
        case .background(let b): drawBackground(b)
        case .decoration(let d): drawDecoration(d)
        case .shape(let s): drawShape(s)
        case .slot(let s): drawSlot(s)
        case .text(let t): drawText(t)
        }
    }

    /// `translate(x+w/2, y+h/2) · rotate(r) · translate(-w/2, -h/2)`.
    func enterFrame(_ p: NodePlacement) {
        let f = p.frame
        ctx.translateBy(x: f.x + f.w / 2, y: f.y + f.h / 2)
        ctx.rotate(by: p.rotate * .pi / 180)
        ctx.translateBy(x: -f.w / 2, y: -f.h / 2)
    }

    func children(of id: String, z: AttachedZ) {
        for k in scene.template.attached(to: id, z: z) { draw(k) }
    }

    /// Applies an SVG `feDropShadow` look. Core Graphics shadows live in device space, so the
    /// offset and blur are mapped through the current transform; the offset turns with the
    /// node, as it does in SVG.
    func setShadow(_ s: Shadow?) {
        guard let s else { return }
        let m = ctx.ctm
        let offset = CGSize(width: s.dx * m.a + s.dy * m.c, height: s.dx * m.b + s.dy * m.d)
        let scale = sqrt(abs(m.a * m.d - m.b * m.c))
        let c = SVGColor.parse(Shadow.color)!.copy(alpha: s.opacity)!
        ctx.setShadow(offset: offset, blur: 2 * s.deviation * scale, color: c)
    }

    // MARK: Background

    func drawBackground(_ b: Background) {
        let canvas = scene.canvas
        let full = CGRect(origin: .zero, size: canvas)
        ctx.setFillColor(color(b.fill ?? "@paper"))
        ctx.fill(full)
        guard let a = b.asset else { return }
        do {
            if scene.assets.isTexture(a) {
                let tex = try scene.assets.texture(a)
                // One tile is 6 in at the Page Format's print width.
                let tile = textureTileMillimetres / scene.template.format.printMillimetres.width * canvas.width
                ctx.saveGState()
                ctx.clip(to: full)
                ctx.draw(tex, in: CGRect(x: 0, y: 0, width: tile, height: tile), byTiling: true)
                ctx.restoreGState()
            } else {
                try scene.assets.document(a, palette: palette).draw(in: ctx, rect: full, fit: .stretch)
            }
        } catch {
            // A missing decoration file leaves the plain fill.
        }
    }

    // MARK: Decoration and Shape

    func group(opacity: Double?, shadow: Shadow?, _ body: () -> Void) {
        let o = opacity ?? 1
        guard o < 1 || shadow != nil else { body(); return }
        ctx.saveGState()
        if o < 1 { ctx.setAlpha(o) }
        setShadow(shadow)
        ctx.beginTransparencyLayer(auxiliaryInfo: nil)
        body()
        ctx.endTransparencyLayer()
        ctx.restoreGState()
    }

    func drawDecoration(_ d: Decoration) {
        let p = d.placement
        ctx.saveGState()
        enterFrame(p)
        children(of: d.id, z: .below)
        if let doc = try? scene.assets.document(d.asset, palette: palette) {
            let fit: SVGDocument.FitMode = switch d.fit { case .contain: .contain; case .cover: .cover; case .stretch: .stretch }
            group(opacity: p.opacity, shadow: p.shadow) {
                doc.draw(in: ctx, rect: CGRect(x: 0, y: 0, width: p.frame.w, height: p.frame.h), fit: fit)
            }
        }
        children(of: d.id, z: .above)
        ctx.restoreGState()
    }

    func drawShape(_ s: ShapeLayer) {
        let p = s.placement
        ctx.saveGState()
        enterFrame(p)
        children(of: s.id, z: .below)
        if let path = try? MaskGeometry.path(s.mask, size: CGSize(width: p.frame.w, height: p.frame.h), assets: scene.assets) {
            group(opacity: p.opacity, shadow: p.shadow) {
                if let f = s.fill {
                    ctx.setFillColor(color(f))
                    ctx.addPath(path)
                    ctx.fillPath()
                }
                if let st = s.stroke {
                    ctx.setStrokeColor(color(st))
                    ctx.setLineWidth(s.strokeWidth ?? 2)
                    if let dash = s.dash {
                        var sc = SVGPath.Scanner(dash)
                        ctx.setLineDash(phase: 0, lengths: sc.numbers().map { CGFloat($0) })
                    }
                    ctx.addPath(path)
                    ctx.strokePath()
                }
            }
        }
        children(of: s.id, z: .above)
        ctx.restoreGState()
    }

    // MARK: Slot

    func drawSlot(_ s: Slot) {
        let p = s.placement
        let w = p.frame.w, h = p.frame.h
        ctx.saveGState()
        enterFrame(p)
        children(of: s.id, z: .below)
        guard let mask = try? MaskGeometry.path(s.mask, size: CGSize(width: w, height: h), assets: scene.assets) else {
            ctx.restoreGState(); return
        }
        let b = s.border ?? Border()
        let style = b.style ?? .none

        // Under the photo: the card (mat/polaroid) or the sticker outline, with the shadow.
        ctx.saveGState()
        setShadow(p.shadow)
        switch style {
        case .mat, .polaroid:
            let side = (b.width ?? 0.05) * min(w, h)
            let bottom = style == .polaroid ? (b.bottom ?? 0.2) * min(w, h) : side
            let card = CGRect(x: -side, y: -side, width: w + side * 2, height: h + side + bottom)
            ctx.setFillColor(color(b.color ?? "@card"))
            if let r = b.radius, r > 0 {
                ctx.addPath(CGPath(roundedRect: card, cornerWidth: r, cornerHeight: r, transform: nil))
                ctx.fillPath()
            } else { ctx.fill(card) }
        case .sticker:
            let c = color(b.color ?? "#ffffff")
            ctx.beginTransparencyLayer(auxiliaryInfo: nil)
            ctx.setFillColor(c)
            ctx.setStrokeColor(c)
            ctx.setLineWidth((b.width ?? 10) * 2)
            ctx.setLineJoin(.round)
            ctx.addPath(mask)
            ctx.drawPath(using: .fillStroke)
            ctx.endTransparencyLayer()
        default:
            if p.shadow != nil {
                ctx.setFillColor(CGColor(srgbRed: 0, green: 0, blue: 0, alpha: 1))
                ctx.addPath(mask)
                ctx.fillPath()
            }
        }
        ctx.restoreGState()

        // The photo, clipped to the Mask and covering the frame around its Fit.
        ctx.saveGState()
        ctx.addPath(mask)
        ctx.clip()
        if let img = scene.images[s.id] {
            let r = img.fit.imageRect(photoAspect: img.aspect, slot: CGSize(width: w, height: h))
            ctx.translateBy(x: r.minX, y: r.maxY)
            ctx.scaleBy(x: 1, y: -1)
            ctx.draw(img.image, in: CGRect(x: 0, y: 0, width: r.width, height: r.height))
        } else {
            ctx.setFillColor(CGColor(srgbRed: 0.84, green: 0.82, blue: 0.78, alpha: 1))
            ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
        }
        ctx.restoreGState()

        // Over it: outline and inset echo.
        if style == .outline {
            ctx.setStrokeColor(color(b.color ?? "@ink"))
            ctx.setLineWidth(b.width ?? 3)
            ctx.addPath(mask)
            ctx.strokePath()
        }
        if let k = b.inset, k != 0,
           let echo = try? MaskGeometry.path(s.mask, size: CGSize(width: w + 2 * k, height: h + 2 * k), assets: scene.assets) {
            ctx.saveGState()
            ctx.translateBy(x: -k, y: -k)
            ctx.setStrokeColor(color(b.insetColor ?? "@ink"))
            ctx.setLineWidth(1.6)
            ctx.addPath(echo)
            ctx.strokePath()
            ctx.restoreGState()
        }
        children(of: s.id, z: .above)
        ctx.restoreGState()
    }

    // MARK: Text

    func drawText(_ t: TextSlot) {
        let theme = scene.assets.bundle.theme
        let style = (theme.typography[t.style] ?? TextStyle()).merged(with: t.override)
        var text = scene.texts[t.id] ?? t.bind.map { Binding.format($0, with: scene.bindings, locale: scene.locale) } ?? ""
        var tint = color(t.color ?? style.color ?? "@ink")
        var opacity = t.placement.opacity
        if text.isEmpty { text = t.sample ?? "" }
        if text.isEmpty, scene.showsTextPlaceholders, let ph = t.placeholder {
            text = ph
            opacity = (opacity ?? 1) * 0.4
            tint = color("@ink")
        }
        guard !text.isEmpty else { return }
        if style.isUppercase { text = text.uppercased(with: scene.locale) }
        let layout = TextLayout.fit(text, node: t, style: style, frame: t.placement.frame)
        ctx.saveGState()
        enterFrame(t.placement)
        group(opacity: opacity, shadow: t.placement.shadow) {
            layout.draw(in: ctx, frame: t.placement.frame, align: t.align, valign: t.valign, color: tint)
        }
        children(of: t.id, z: .above)
        ctx.restoreGState()
    }
}
