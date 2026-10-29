import CoreGraphics
import Foundation

/// Parses SVG path data (`M L H V C S Q T A Z`, absolute and relative) into a `CGPath`.
enum SVGPath {
    static func parse(_ d: String) -> CGPath {
        let path = CGMutablePath()
        var s = Scanner(d)
        var cmd: Character = "M"
        var cur = CGPoint.zero, start = CGPoint.zero
        var lastControl: CGPoint?
        var lastCmd: Character = " "
        while true {
            s.skipSeparators()
            guard let c = s.peek() else { break }
            if c.isLetter { cmd = c; s.advance() } else if lastCmd == " " { break }
            let rel = cmd.isLowercase
            let base = rel ? cur : .zero
            func pt(_ x: Double, _ y: Double) -> CGPoint { CGPoint(x: base.x + x, y: base.y + y) }
            switch cmd.uppercased().first! {
            case "M":
                guard let x = s.number(), let y = s.number() else { return path }
                cur = pt(x, y); start = cur
                path.move(to: cur)
                cmd = rel ? "l" : "L" // further pairs are line-tos
                lastControl = nil
            case "L":
                guard let x = s.number(), let y = s.number() else { return path }
                cur = pt(x, y); path.addLine(to: cur); lastControl = nil
            case "H":
                guard let x = s.number() else { return path }
                cur = CGPoint(x: rel ? cur.x + x : x, y: cur.y); path.addLine(to: cur); lastControl = nil
            case "V":
                guard let y = s.number() else { return path }
                cur = CGPoint(x: cur.x, y: rel ? cur.y + y : y); path.addLine(to: cur); lastControl = nil
            case "C":
                guard let x1 = s.number(), let y1 = s.number(), let x2 = s.number(), let y2 = s.number(),
                      let x = s.number(), let y = s.number() else { return path }
                let c2 = pt(x2, y2)
                cur = pt(x, y)
                path.addCurve(to: cur, control1: pt(x1, y1), control2: c2)
                lastControl = c2
            case "S":
                guard let x2 = s.number(), let y2 = s.number(), let x = s.number(), let y = s.number() else { return path }
                let c1 = "CS".contains(lastCmd.uppercased().first!) ? reflect(lastControl, cur) : cur
                let c2 = pt(x2, y2)
                cur = pt(x, y)
                path.addCurve(to: cur, control1: c1, control2: c2)
                lastControl = c2
            case "Q":
                guard let x1 = s.number(), let y1 = s.number(), let x = s.number(), let y = s.number() else { return path }
                let c1 = pt(x1, y1)
                cur = pt(x, y)
                path.addQuadCurve(to: cur, control: c1)
                lastControl = c1
            case "T":
                guard let x = s.number(), let y = s.number() else { return path }
                let c1 = "QT".contains(lastCmd.uppercased().first!) ? reflect(lastControl, cur) : cur
                cur = pt(x, y)
                path.addQuadCurve(to: cur, control: c1)
                lastControl = c1
            case "A":
                guard let rx = s.number(), let ry = s.number(), let rot = s.number(),
                      let large = s.flag(), let sweep = s.flag(),
                      let x = s.number(), let y = s.number() else { return path }
                let end = pt(x, y)
                addArc(path, from: cur, to: end, rx: rx, ry: ry, rotation: rot, large: large, sweep: sweep)
                cur = end; lastControl = nil
            case "Z":
                path.closeSubpath(); cur = start; lastControl = nil
            default:
                return path
            }
            lastCmd = cmd
        }
        return path
    }

    private static func reflect(_ p: CGPoint?, _ about: CGPoint) -> CGPoint {
        guard let p else { return about }
        return CGPoint(x: 2 * about.x - p.x, y: 2 * about.y - p.y)
    }

    /// SVG endpoint arc → centre parameterization → cubic Béziers (SVG spec, appendix F.6).
    static func addArc(_ path: CGMutablePath, from p0: CGPoint, to p1: CGPoint, rx rx0: Double, ry ry0: Double,
                       rotation: Double, large: Bool, sweep: Bool) {
        var rx = abs(rx0), ry = abs(ry0)
        if rx == 0 || ry == 0 || p0 == p1 { path.addLine(to: p1); return }
        let phi = rotation * .pi / 180, cosP = cos(phi), sinP = sin(phi)
        let dx = (p0.x - p1.x) / 2, dy = (p0.y - p1.y) / 2
        let x1p = cosP * dx + sinP * dy, y1p = -sinP * dx + cosP * dy
        let lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
        if lambda > 1 { rx *= sqrt(lambda); ry *= sqrt(lambda) }
        let num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
        let den = rx * rx * y1p * y1p + ry * ry * x1p * x1p
        var coef = sqrt(max(0, num / den))
        if large == sweep { coef = -coef }
        let cxp = coef * rx * y1p / ry, cyp = -coef * ry * x1p / rx
        let cx = cosP * cxp - sinP * cyp + (p0.x + p1.x) / 2
        let cy = sinP * cxp + cosP * cyp + (p0.y + p1.y) / 2
        func angle(_ ux: Double, _ uy: Double, _ vx: Double, _ vy: Double) -> Double {
            let a = atan2(ux * vy - uy * vx, ux * vx + uy * vy)
            return a
        }
        let theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
        var delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
        if !sweep && delta > 0 { delta -= 2 * .pi }
        if sweep && delta < 0 { delta += 2 * .pi }
        let segments = max(1, Int(ceil(abs(delta) / (.pi / 2))))
        let step = delta / Double(segments)
        let k = 4.0 / 3.0 * tan(step / 4)
        func point(_ t: Double) -> CGPoint {
            CGPoint(x: cx + rx * cos(t) * cosP - ry * sin(t) * sinP, y: cy + rx * cos(t) * sinP + ry * sin(t) * cosP)
        }
        func deriv(_ t: Double) -> CGPoint {
            CGPoint(x: -rx * sin(t) * cosP - ry * cos(t) * sinP, y: -rx * sin(t) * sinP + ry * cos(t) * cosP)
        }
        var t = theta1
        for _ in 0..<segments {
            let t2 = t + step
            let a = point(t), b = point(t2), da = deriv(t), db = deriv(t2)
            path.addCurve(to: b, control1: CGPoint(x: a.x + k * da.x, y: a.y + k * da.y),
                          control2: CGPoint(x: b.x - k * db.x, y: b.y - k * db.y))
            t = t2
        }
    }

    /// A small scanner for SVG number lists.
    struct Scanner {
        let chars: [Character]
        var i = 0
        init(_ s: String) { chars = Array(s) }

        func peek() -> Character? { i < chars.count ? chars[i] : nil }
        mutating func advance() { i += 1 }

        mutating func skipSeparators() {
            while i < chars.count, chars[i] == " " || chars[i] == "," || chars[i] == "\n" || chars[i] == "\t" || chars[i] == "\r" { i += 1 }
        }

        mutating func number() -> Double? {
            skipSeparators()
            let startIndex = i
            if i < chars.count, chars[i] == "-" || chars[i] == "+" { i += 1 }
            var sawDot = false, sawDigit = false
            while i < chars.count {
                let c = chars[i]
                if c.isNumber { sawDigit = true; i += 1 }
                else if c == ".", !sawDot { sawDot = true; i += 1 }
                else { break }
            }
            if sawDigit, i < chars.count, chars[i] == "e" || chars[i] == "E" {
                var j = i + 1
                if j < chars.count, chars[j] == "-" || chars[j] == "+" { j += 1 }
                if j < chars.count, chars[j].isNumber {
                    i = j
                    while i < chars.count, chars[i].isNumber { i += 1 }
                }
            }
            guard sawDigit else { i = startIndex; return nil }
            return Double(String(chars[startIndex..<i]))
        }

        /// Arc flags may be written without separators (`a1 1 0 01 2 2`).
        mutating func flag() -> Bool? {
            skipSeparators()
            guard i < chars.count, chars[i] == "0" || chars[i] == "1" else { return nil }
            defer { i += 1 }
            return chars[i] == "1"
        }

        mutating func numbers() -> [Double] {
            var out: [Double] = []
            while let n = number() { out.append(n) }
            return out
        }
    }
}
