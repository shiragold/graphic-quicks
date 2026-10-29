import CoreGraphics
import Foundation

/// The constrained SVG subset that decoration files use (tech-stack §6): `path`, `rect`,
/// `circle`, `ellipse`, `line`, `polygon`, `polyline` and `g`, with fill, stroke, opacity,
/// transforms, `clipPath` and tiled `pattern` fills. No CSS, filters, gradients or text.
/// Tokens are substituted before parsing.
final class SVGDocument: @unchecked Sendable {
    // Immutable after init.
    let viewBox: CGRect
    let root: SVGElement
    private let defs: [String: SVGElement]

    init(data: Data) throws {
        let builder = SVGTreeBuilder()
        let parser = XMLParser(data: data)
        parser.delegate = builder
        guard parser.parse(), let root = builder.root else {
            throw RenderError.badSVG(parser.parserError?.localizedDescription ?? "no root element")
        }
        self.root = root
        var vbScanner = SVGPath.Scanner(root.attributes["viewBox"] ?? "")
        let vb = vbScanner.numbers()
        if vb.count == 4 {
            viewBox = CGRect(x: vb[0], y: vb[1], width: vb[2], height: vb[3])
        } else {
            viewBox = CGRect(x: 0, y: 0, width: Double(root.attributes["width"] ?? "") ?? 100,
                             height: Double(root.attributes["height"] ?? "") ?? 100)
        }
        var defs: [String: SVGElement] = [:]
        func index(_ e: SVGElement) {
            if let id = e.attributes["id"] { defs[id] = e }
            e.children.forEach(index)
        }
        index(root)
        self.defs = defs
    }

    /// The `d` of the first `path`, for path Masks.
    var firstPathData: String? {
        func find(_ e: SVGElement) -> String? {
            if e.name == "path", let d = e.attributes["d"] { return d }
            for c in e.children { if let d = find(c) { return d } }
            return nil
        }
        return find(root)
    }

    /// Draws the document's viewBox into `rect` (current user space), like a nested `<svg>`
    /// with `overflow="visible"` and the Decoration's fit as `preserveAspectRatio`.
    func draw(in ctx: CGContext, rect: CGRect, fit: FitMode) {
        let sx = rect.width / viewBox.width, sy = rect.height / viewBox.height
        ctx.saveGState()
        switch fit {
        case .stretch:
            ctx.translateBy(x: rect.minX, y: rect.minY)
            ctx.scaleBy(x: sx, y: sy)
        case .contain, .cover:
            let s = fit == .contain ? min(sx, sy) : max(sx, sy)
            ctx.translateBy(x: rect.midX - viewBox.width * s / 2, y: rect.midY - viewBox.height * s / 2)
            ctx.scaleBy(x: s, y: s)
        }
        ctx.translateBy(x: -viewBox.minX, y: -viewBox.minY)
        for c in root.children { draw(c, in: ctx, style: SVGStyle()) }
        ctx.restoreGState()
    }

    enum FitMode { case contain, cover, stretch }

    // MARK: Drawing

    private func draw(_ e: SVGElement, in ctx: CGContext, style parent: SVGStyle) {
        guard !["defs", "clipPath", "pattern", "title", "desc", "metadata", "style"].contains(e.name) else { return }
        let style = parent.inheriting(e.attributes)
        let opacity = Double(e.attributes["opacity"] ?? "") ?? 1
        ctx.saveGState()
        if let t = e.attributes["transform"] { ctx.concatenate(SVGTransform.parse(t)) }
        if let ref = SVGStyle.urlReference(e.attributes["clip-path"]), let clip = defs[ref] {
            let p = CGMutablePath()
            for c in clip.children { if let s = shape(c) { p.addPath(s) } }
            ctx.addPath(p)
            ctx.clip()
        }
        let layered = opacity < 1
        if layered { ctx.setAlpha(opacity); ctx.beginTransparencyLayer(auxiliaryInfo: nil) }
        if e.name == "g" || e.name == "svg" || e.name == "a" {
            for c in e.children { draw(c, in: ctx, style: style) }
        } else if let path = shape(e) {
            paint(path, style: style, in: ctx)
        }
        if layered { ctx.endTransparencyLayer() }
        ctx.restoreGState()
    }

    private func paint(_ path: CGPath, style: SVGStyle, in ctx: CGContext) {
        switch style.fill {
        case .none: break
        case .color(let c):
            ctx.setFillColor(c.copy(alpha: c.alpha * style.fillOpacity) ?? c)
            ctx.addPath(path)
            ctx.fillPath(using: style.evenOdd ? .evenOdd : .winding)
        case .reference(let id):
            if let pattern = defs[id], pattern.name == "pattern" {
                fill(path, with: pattern, opacity: style.fillOpacity, in: ctx)
            }
        }
        if case .color(let c) = style.stroke, style.strokeWidth > 0 {
            ctx.setStrokeColor(c.copy(alpha: c.alpha * style.strokeOpacity) ?? c)
            ctx.setLineWidth(style.strokeWidth)
            ctx.setLineCap(style.lineCap)
            ctx.setLineJoin(style.lineJoin)
            ctx.setLineDash(phase: 0, lengths: style.dash)
            ctx.addPath(path)
            ctx.strokePath()
        }
    }

    /// Tiles a `patternUnits="userSpaceOnUse"` pattern over the path's bounds.
    private func fill(_ path: CGPath, with pattern: SVGElement, opacity: Double, in ctx: CGContext) {
        let a = pattern.attributes
        let w = Double(a["width"] ?? "") ?? 0, h = Double(a["height"] ?? "") ?? 0
        guard w > 0, h > 0 else { return }
        let px = Double(a["x"] ?? "") ?? 0, py = Double(a["y"] ?? "") ?? 0
        let t = a["patternTransform"].map(SVGTransform.parse) ?? .identity
        ctx.saveGState()
        ctx.addPath(path)
        ctx.clip()
        if opacity < 1 { ctx.setAlpha(opacity); ctx.beginTransparencyLayer(auxiliaryInfo: nil) }
        ctx.concatenate(t)
        let bounds = path.boundingBoxOfPath.applying(t.inverted())
        let i0 = Int(floor((bounds.minX - px) / w)), i1 = Int(ceil((bounds.maxX - px) / w))
        let j0 = Int(floor((bounds.minY - py) / h)), j1 = Int(ceil((bounds.maxY - py) / h))
        if (i1 - i0) * (j1 - j0) < 20_000 {
            for i in i0..<max(i0 + 1, i1) {
                for j in j0..<max(j0 + 1, j1) {
                    ctx.saveGState()
                    ctx.translateBy(x: px + Double(i) * w, y: py + Double(j) * h)
                    for c in pattern.children { draw(c, in: ctx, style: SVGStyle()) }
                    ctx.restoreGState()
                }
            }
        }
        if opacity < 1 { ctx.endTransparencyLayer() }
        ctx.restoreGState()
    }

    /// The geometry of a basic shape element, with its own transform applied.
    private func shape(_ e: SVGElement) -> CGPath? {
        let a = e.attributes
        func n(_ k: String) -> Double { Double(a[k] ?? "") ?? 0 }
        let p = CGMutablePath()
        switch e.name {
        case "path":
            guard let d = a["d"] else { return nil }
            p.addPath(SVGPath.parse(d))
        case "rect":
            let r = CGRect(x: n("x"), y: n("y"), width: n("width"), height: n("height"))
            var rx = a["rx"].flatMap(Double.init), ry = a["ry"].flatMap(Double.init)
            rx = rx ?? ry; ry = ry ?? rx
            if let rx, let ry, rx > 0 {
                p.addRoundedRect(in: r, cornerWidth: min(rx, r.width / 2), cornerHeight: min(ry, r.height / 2))
            } else { p.addRect(r) }
        case "circle":
            let r = n("r")
            p.addEllipse(in: CGRect(x: n("cx") - r, y: n("cy") - r, width: 2 * r, height: 2 * r))
        case "ellipse":
            p.addEllipse(in: CGRect(x: n("cx") - n("rx"), y: n("cy") - n("ry"), width: 2 * n("rx"), height: 2 * n("ry")))
        case "line":
            p.move(to: CGPoint(x: n("x1"), y: n("y1")))
            p.addLine(to: CGPoint(x: n("x2"), y: n("y2")))
        case "polygon", "polyline":
            var s = SVGPath.Scanner(a["points"] ?? "")
            let v = s.numbers()
            guard v.count >= 4 else { return nil }
            p.move(to: CGPoint(x: v[0], y: v[1]))
            for k in stride(from: 2, to: v.count - 1, by: 2) { p.addLine(to: CGPoint(x: v[k], y: v[k + 1])) }
            if e.name == "polygon" { p.closeSubpath() }
        default:
            return nil
        }
        return p
    }
}

/// A parsed element.
final class SVGElement: @unchecked Sendable {
    let name: String
    let attributes: [String: String]
    var children: [SVGElement] = []
    init(name: String, attributes: [String: String]) {
        self.name = name
        self.attributes = attributes
    }
}

private final class SVGTreeBuilder: NSObject, XMLParserDelegate {
    var root: SVGElement?
    private var stack: [SVGElement] = []

    func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?,
                qualifiedName: String?, attributes: [String: String] = [:]) {
        let e = SVGElement(name: name, attributes: attributes)
        if let parent = stack.last { parent.children.append(e) } else { root = e }
        stack.append(e)
    }

    func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?, qualifiedName: String?) {
        stack.removeLast()
    }
}

/// Inherited presentation attributes.
struct SVGStyle {
    enum Paint { case none, color(CGColor), reference(String) }

    var fill: Paint = .color(CGColor(srgbRed: 0, green: 0, blue: 0, alpha: 1))
    var stroke: Paint = .none
    var strokeWidth: Double = 1
    var fillOpacity: Double = 1
    var strokeOpacity: Double = 1
    var lineCap: CGLineCap = .butt
    var lineJoin: CGLineJoin = .miter
    var dash: [CGFloat] = []
    var evenOdd = false

    func inheriting(_ a: [String: String]) -> SVGStyle {
        var s = self
        if let f = a["fill"] { s.fill = Self.paint(f) }
        if let v = a["stroke"] { s.stroke = Self.paint(v) }
        if let v = a["stroke-width"].flatMap(Double.init) { s.strokeWidth = v }
        if let v = a["fill-opacity"].flatMap(Double.init) { s.fillOpacity = v }
        if let v = a["stroke-opacity"].flatMap(Double.init) { s.strokeOpacity = v }
        if let v = a["fill-rule"] { s.evenOdd = v == "evenodd" }
        switch a["stroke-linecap"] {
        case "round": s.lineCap = .round
        case "square": s.lineCap = .square
        case "butt": s.lineCap = .butt
        default: break
        }
        switch a["stroke-linejoin"] {
        case "round": s.lineJoin = .round
        case "bevel": s.lineJoin = .bevel
        case "miter": s.lineJoin = .miter
        default: break
        }
        if let v = a["stroke-dasharray"] {
            var sc = SVGPath.Scanner(v)
            s.dash = v == "none" ? [] : sc.numbers().map { CGFloat($0) }
        }
        return s
    }

    static func paint(_ v: String) -> Paint {
        if v == "none" || v == "transparent" { return .none }
        if let ref = urlReference(v) { return .reference(ref) }
        return SVGColor.parse(v).map(Paint.color) ?? .none
    }

    static func urlReference(_ v: String?) -> String? {
        guard let v, v.hasPrefix("url(#"), v.hasSuffix(")") else { return nil }
        return String(v.dropFirst(5).dropLast())
    }
}

enum SVGTransform {
    /// `translate`, `rotate(a [cx cy])`, `scale`, `skewX`, `skewY` and `matrix`, applied left
    /// to right.
    static func parse(_ s: String) -> CGAffineTransform {
        var t = CGAffineTransform.identity
        var rest = Substring(s)
        while let open = rest.firstIndex(of: "("), let close = rest.firstIndex(of: ")") {
            let name = rest[..<open].trimmingCharacters(in: CharacterSet(charactersIn: " ,\n\t"))
            var sc = SVGPath.Scanner(String(rest[rest.index(after: open)..<close]))
            let v = sc.numbers()
            var m = CGAffineTransform.identity
            switch name {
            case "translate": m = CGAffineTransform(translationX: v.first ?? 0, y: v.count > 1 ? v[1] : 0)
            case "scale": m = CGAffineTransform(scaleX: v.first ?? 1, y: v.count > 1 ? v[1] : (v.first ?? 1))
            case "rotate":
                let a = (v.first ?? 0) * .pi / 180
                if v.count >= 3 {
                    m = CGAffineTransform(translationX: v[1], y: v[2]).rotated(by: a).translatedBy(x: -v[1], y: -v[2])
                } else { m = CGAffineTransform(rotationAngle: a) }
            case "skewX": m = CGAffineTransform(a: 1, b: 0, c: tan((v.first ?? 0) * .pi / 180), d: 1, tx: 0, ty: 0)
            case "skewY": m = CGAffineTransform(a: 1, b: tan((v.first ?? 0) * .pi / 180), c: 0, d: 1, tx: 0, ty: 0)
            case "matrix" where v.count == 6: m = CGAffineTransform(a: v[0], b: v[1], c: v[2], d: v[3], tx: v[4], ty: v[5])
            default: break
            }
            t = m.concatenating(t)
            rest = rest[rest.index(after: close)...]
        }
        return t
    }
}

/// Hex and a few named colours, in sRGB.
public enum SVGColor {
    public static func parse(_ v: String) -> CGColor? {
        let s = v.trimmingCharacters(in: .whitespaces).lowercased()
        switch s {
        case "white": return CGColor(srgbRed: 1, green: 1, blue: 1, alpha: 1)
        case "black": return CGColor(srgbRed: 0, green: 0, blue: 0, alpha: 1)
        default: break
        }
        guard s.hasPrefix("#") else { return nil }
        var hex = String(s.dropFirst())
        if hex.count == 3 || hex.count == 4 { hex = hex.map { "\($0)\($0)" }.joined() }
        guard hex.count == 6 || hex.count == 8, let n = UInt64(hex, radix: 16) else { return nil }
        let hasAlpha = hex.count == 8
        let r = Double((n >> (hasAlpha ? 24 : 16)) & 0xff) / 255
        let g = Double((n >> (hasAlpha ? 16 : 8)) & 0xff) / 255
        let b = Double((n >> (hasAlpha ? 8 : 0)) & 0xff) / 255
        let a = hasAlpha ? Double(n & 0xff) / 255 : 1
        return CGColor(srgbRed: r, green: g, blue: b, alpha: a)
    }
}

public enum RenderError: Error, CustomStringConvertible {
    case badSVG(String)
    case badImage(String)
    case context

    public var description: String {
        switch self {
        case .badSVG(let m): "Cannot read decoration file: \(m)"
        case .badImage(let m): "Cannot read image: \(m)"
        case .context: "Cannot create a drawing context"
        }
    }
}
