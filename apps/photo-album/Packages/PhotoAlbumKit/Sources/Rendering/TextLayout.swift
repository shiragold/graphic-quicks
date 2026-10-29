import AppKit
import Catalog
import CoreText

/// Text Slot fitting and drawing with Core Text (themes docs/03, "Text slots"): start at
/// `size`, wrap to the frame width, shrink in small steps until the text fits `maxLines` and
/// the frame height, never below `minSize`; if it still does not fit, truncate the last line
/// with an ellipsis. The reference renderer estimates widths from `avgCharWidth`; this one
/// measures.
struct TextLayout {
    let lines: [String]
    let size: Double
    let font: CTFont
    let attributes: [NSAttributedString.Key: Any]
    let lineHeight: Double

    static func fit(_ text: String, node: TextSlot, style: TextStyle, frame: Frame) -> TextLayout {
        let maxLines = node.maxLines
        let minSize = node.effectiveMinSize
        let lh = style.lineHeight ?? 1.1
        var size = node.size
        while size >= minSize - 0.01 {
            let l = make(text, size: size, style: style, lineHeight: lh, width: frame.w)
            if l.lines.count <= maxLines, Double(l.lines.count) * l.lineHeight <= frame.h * 1.05,
               l.widest <= frame.w * 1.02 {
                return l
            }
            size -= max(0.5, node.size * 0.03)
        }
        let l = make(text, size: minSize, style: style, lineHeight: lh, width: frame.w)
        let fit = max(1, min(maxLines, Int(floor(frame.h * 1.05 / l.lineHeight))))
        guard l.lines.count > fit else { return l }
        var lines = Array(l.lines.prefix(fit))
        var last = lines[fit - 1]
        if let r = last.range(of: #"\s*\S*$"#, options: .regularExpression) { last.removeSubrange(r) }
        lines[fit - 1] = last + "…"
        return TextLayout(lines: lines, size: l.size, font: l.font, attributes: l.attributes, lineHeight: l.lineHeight)
    }

    private static func make(_ text: String, size: Double, style: TextStyle, lineHeight: Double, width: Double) -> TextLayout {
        let font = FontResolver.font(style: style, size: size)
        var attrs: [NSAttributedString.Key: Any] = [.font: font]
        if let ls = style.letterSpacing, ls != 0 { attrs[.kern] = ls * size }
        let lines = wrap(text, width: width) { measure($0, attrs) }
        return TextLayout(lines: lines, size: size, font: font, attributes: attrs, lineHeight: size * lineHeight)
    }

    /// Greedy word wrap at the measured width. Explicit newlines start new lines.
    static func wrap(_ text: String, width: Double, measure: (String) -> Double) -> [String] {
        var lines: [String] = []
        for para in text.components(separatedBy: "\n") {
            var cur: String?
            for word in para.split(whereSeparator: \.isWhitespace).map(String.init) {
                if let c = cur, measure(c + " " + word) <= width { cur = c + " " + word }
                else { if let c = cur { lines.append(c) }; cur = word }
            }
            lines.append(cur ?? "")
        }
        return lines
    }

    static func measure(_ s: String, _ attrs: [NSAttributedString.Key: Any]) -> Double {
        let line = CTLineCreateWithAttributedString(NSAttributedString(string: s, attributes: attrs))
        return CTLineGetTypographicBounds(line, nil, nil, nil)
    }

    var widest: Double { lines.map { Self.measure($0, attributes) }.max() ?? 0 }

    /// Draws into the frame-local box (0,0)–(w,h) of a y-down context.
    func draw(in ctx: CGContext, frame: Frame, align: TextAlign, valign: TextVAlign, color: CGColor) {
        var attrs = attributes
        attrs[NSAttributedString.Key(kCTForegroundColorAttributeName as String)] = color
        let total = lineHeight * Double(lines.count)
        let top: Double = switch valign {
        case .top: 0
        case .bottom: frame.h - total
        case .middle: (frame.h - total) / 2
        }
        // Same baseline as the reference renderer's SVG: 0.8 × size below the line box top.
        let y0 = top + size * 0.8 + (lineHeight - size) / 2
        ctx.saveGState()
        ctx.textMatrix = CGAffineTransform(scaleX: 1, y: -1)
        for (i, s) in lines.enumerated() {
            let line = CTLineCreateWithAttributedString(NSAttributedString(string: s, attributes: attrs))
            let w = CTLineGetTypographicBounds(line, nil, nil, nil)
            let x: Double = switch align {
            case .left: 0
            case .center: (frame.w - w) / 2
            case .right: frame.w - w
            }
            ctx.textPosition = CGPoint(x: x, y: y0 + Double(i) * lineHeight)
            CTLineDraw(line, ctx)
        }
        ctx.restoreGState()
    }
}

/// Picks the first installed family in a Style's fallback chain (bundled OFL fonts first once
/// they are registered, then the macOS fallback, then a generic family).
enum FontResolver {
    private static let generic: [String: String] = [
        "cursive": "Apple Chancery", "serif": "Times New Roman", "sans-serif": "Helvetica Neue",
        "monospace": "Courier New", "fantasy": "Papyrus",
    ]

    static func font(style: TextStyle, size: Double) -> CTFont {
        let weight = appKitWeight(style.weight ?? 400)
        let traits: NSFontTraitMask = style.italic == true ? .italicFontMask : []
        let fm = NSFontManager.shared
        for family in style.family ?? [] {
            let name = generic[family] ?? family
            if let f = fm.font(withFamily: name, traits: traits, weight: weight, size: size)
                ?? fm.font(withFamily: name, traits: traits, weight: 5, size: size) {
                return f as CTFont
            }
        }
        return CTFontCreateUIFontForLanguage(.system, size, nil)!
    }

    /// CSS weight → NSFontManager's 0–15 scale (5 regular, 9 bold).
    static func appKitWeight(_ css: Int) -> Int {
        switch css {
        case ..<150: 2
        case ..<250: 3
        case ..<350: 4
        case ..<450: 5
        case ..<550: 6
        case ..<650: 8
        case ..<750: 9
        case ..<850: 10
        default: 11
        }
    }
}
