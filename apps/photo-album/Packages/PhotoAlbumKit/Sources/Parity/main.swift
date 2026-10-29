// Parity check: renders every Template × Page Format through the Swift renderer with the
// reference renderer's stand-in photos, then lays the reference previews and the Swift
// renders side by side in one contact sheet per Theme.
//
//   swift run parity <themes-dir> <photos-dir> <reference-previews-dir> <out-dir>
//
// <photos-dir> holds `photos.json` (id, w, h, focal, faces, in SAMPLE_PHOTOS order) and one
// `<id>.jpg` per stand-in photo (tools/parity/export-sample-photos.mjs).

import AppKit
import Catalog
import Composition
import CoreGraphics
import Foundation
import ImageIO
import Insights
import Rendering
import Suggestion
import UniformTypeIdentifiers

struct SamplePhoto: Decodable {
    let id: String
    let w: Double
    let h: Double
    let focal: [Double]
    let faces: Bool?
}

let args = CommandLine.arguments
guard args.count == 5 else {
    FileHandle.standardError.write(Data("usage: parity <themes-dir> <photos-dir> <reference-previews-dir> <out-dir>\n".utf8))
    exit(2)
}
let themesDir = URL(fileURLWithPath: args[1])
let photosDir = URL(fileURLWithPath: args[2])
let referenceDir = URL(fileURLWithPath: args[3])
let outDir = URL(fileURLWithPath: args[4])
let rendersDir = outDir.appending(path: "swift")
try FileManager.default.createDirectory(at: rendersDir, withIntermediateDirectories: true)

func loadImage(_ url: URL) -> CGImage? {
    guard let src = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
    return CGImageSourceCreateImageAtIndex(src, 0, nil)
}

func writeImage(_ image: CGImage, to url: URL, type: UTType, quality: Double? = nil) throws {
    guard let dest = CGImageDestinationCreateWithURL(url as CFURL, type.identifier as CFString, 1, nil) else {
        throw ExportFailure(url: url)
    }
    let props: [CFString: Any] = quality.map { [kCGImageDestinationLossyCompressionQuality: $0] } ?? [:]
    CGImageDestinationAddImage(dest, image, props as CFDictionary)
    guard CGImageDestinationFinalize(dest) else { throw ExportFailure(url: url) }
}

struct ExportFailure: Error { let url: URL }

// Stand-in photos, as the Matcher sees them: pool order is rank, faces from the flag.
let samples = try JSONDecoder().decode([SamplePhoto].self, from: Data(contentsOf: photosDir.appending(path: "photos.json")))
var sampleImages: [String: CGImage] = [:]
for s in samples { sampleImages[s.id] = loadImage(photosDir.appending(path: "\(s.id).jpg")) }
let pool = samples.map { s in
    MatchablePhoto(
        id: .init(source: .folder, local: s.id), aspect: s.w / s.h,
        insight: Insight(focalPoint: CGPoint(x: s.focal[0], y: s.focal[1]),
                         faces: s.faces == true ? [CGRect(x: 0.4, y: 0.2, width: 0.2, height: 0.2)] : []))
}
let sampleByID = Dictionary(uniqueKeysWithValues: samples.map { ($0.id, $0) })

// The reference renderer builds `new Date('2026-07-12')` (UTC midnight) and formats it with
// local getters; format in UTC so the day matches the date that was written.
var utc = Calendar(identifier: .gregorian)
utc.timeZone = TimeZone(identifier: "UTC")!
let isoDay = DateFormatter()
isoDay.calendar = utc
isoDay.timeZone = utc.timeZone
isoDay.dateFormat = "yyyy-MM-dd"

struct Cell { let format: PageFormat; let reference: CGImage?; let swift: CGImage; let difference: Double? }
struct Row { let template: String; let cells: [Cell] }

/// Mean absolute difference of two images (0…1) after downsampling both to 96 px wide.
func difference(_ a: CGImage, _ b: CGImage) -> Double {
    let w = 96, h = max(1, Int(Double(a.height) / Double(a.width) * 96))
    func pixels(_ img: CGImage) -> [UInt8] {
        var buf = [UInt8](repeating: 0, count: w * h * 4)
        let ctx = CGContext(data: &buf, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                            space: CGColorSpace(name: CGColorSpace.sRGB)!,
                            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        ctx.interpolationQuality = .high
        ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
        return buf
    }
    let pa = pixels(a), pb = pixels(b)
    var sum = 0
    for i in 0..<pa.count where i % 4 != 3 { sum += abs(Int(pa[i]) - Int(pb[i])) }
    return Double(sum) / Double(w * h * 3) / 255
}

let catalog = try Catalog(directory: themesDir)
var report = "theme\ttemplate\tformat\tstatus\tdroppedSlots\tassignment\tmeanAbsDiff\n"
for bundle in catalog.bundles {
    let assets = ThemeAssets(bundle: bundle)
    let palette = bundle.theme.palette()
    var rows: [Row] = []
    for template in bundle.templates {
        var cells: [Cell] = []
        for format in PageFormat.allCases {
            // The reference renderer runs with an unlimited photo count, so no Optional Slot drops.
            let resolved = try template.resolve(format: format)
            let assignment = Matcher.place(pool, in: resolved)
            var images: [String: SlotImage] = [:]
            for (slot, photo) in assignment {
                guard let s = sampleByID[photo.local], let img = sampleImages[photo.local] else { continue }
                images[slot] = SlotImage(image: img, aspect: s.w / s.h,
                                         fit: FitSuggester.fit(for: pool.first { $0.id == photo }!.insight))
            }
            var strings = bundle.theme.sampleData ?? [:]
            for (k, v) in template.sampleData ?? [:] { strings[k] = v }
            let date = strings["date"].flatMap(isoDay.date(from:))
            let scene = RenderScene(template: resolved, assets: assets, palette: palette, images: images,
                                    bindings: BindingValues(strings: strings, date: date, timeZone: utc.timeZone),
                                    locale: Locale(identifier: "en_US"))
            let image = try CollageRenderer().image(scene, pixelSize: format.canvas,
                                                    colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
            let name = "\(bundle.id)--\(template.localID)--\(format.rawValue)"
            try writeImage(image, to: rendersDir.appending(path: "\(name).png"), type: .png)
            let reference = loadImage(referenceDir.appending(path: "\(name).jpg"))
            let diff = reference.map { difference($0, image) }
            cells.append(Cell(format: format, reference: reference, swift: image, difference: diff))
            let assigned = assignment.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value.local)" }.joined(separator: ",")
            report += "\(bundle.id)\t\(template.localID)\t\(format.rawValue)\t\(resolved.formatStatus)\t\(resolved.droppedSlots.joined(separator: ","))\t\(assigned)\t\(diff.map { String(format: "%.4f", $0) } ?? "n/a")\n"
            print(name, diff.map { String(format: "diff %.4f", $0) } ?? "no reference")
        }
        rows.append(Row(template: template.localID, cells: cells))
    }
    let sheet = contactSheet(title: "\(bundle.theme.name): reference (left) vs Swift (right), every Template × Page Format", rows: rows)
    try writeImage(sheet, to: outDir.appending(path: "parity-\(bundle.id).jpg"), type: .jpeg, quality: 0.85)
}
try report.write(to: outDir.appending(path: "parity-report.tsv"), atomically: true, encoding: .utf8)
print("wrote", outDir.path)

// MARK: - Contact sheet

func contactSheet(title: String, rows: [Row]) -> CGImage {
    let cellH = 300.0, gap = 18.0, pairGap = 6.0, head = 64.0, label = 30.0, caption = 22.0
    func w(_ f: PageFormat) -> Double { (cellH * f.canvas.width / f.canvas.height).rounded() }
    let rowW = PageFormat.allCases.reduce(gap) { $0 + 2 * w($1) + pairGap + gap * 2 }
    let height = head + Double(rows.count) * (label + cellH + caption + gap)
    let ctx = CGContext(data: nil, width: Int(rowW), height: Int(height), bitsPerComponent: 8, bytesPerRow: 0,
                        space: CGColorSpace(name: CGColorSpace.sRGB)!,
                        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.interpolationQuality = .high
    ctx.setFillColor(CGColor(srgbRed: 0.98, green: 0.98, blue: 0.97, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: rowW, height: height))
    // Flip to y-down for layout.
    ctx.translateBy(x: 0, y: height)
    ctx.scaleBy(x: 1, y: -1)
    func text(_ s: String, x: Double, y: Double, size: Double, bold: Bool = false, grey: Double = 0.15) {
        let font = NSFont.systemFont(ofSize: size, weight: bold ? .semibold : .regular)
        let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: NSColor(white: grey, alpha: 1)]
        let line = CTLineCreateWithAttributedString(NSAttributedString(string: s, attributes: attrs))
        ctx.saveGState()
        ctx.textMatrix = CGAffineTransform(scaleX: 1, y: -1)
        ctx.textPosition = CGPoint(x: x, y: y)
        CTLineDraw(line, ctx)
        ctx.restoreGState()
    }
    func image(_ img: CGImage?, _ r: CGRect) {
        ctx.saveGState()
        if let img {
            ctx.translateBy(x: r.minX, y: r.maxY)
            ctx.scaleBy(x: 1, y: -1)
            ctx.draw(img, in: CGRect(origin: .zero, size: r.size))
        } else {
            ctx.setFillColor(CGColor(srgbRed: 0.85, green: 0.85, blue: 0.85, alpha: 1))
            ctx.fill(r)
        }
        ctx.restoreGState()
        ctx.setStrokeColor(CGColor(srgbRed: 0, green: 0, blue: 0, alpha: 0.15))
        ctx.stroke(r, width: 1)
    }
    text(title, x: gap, y: 40, size: 24, bold: true)
    var y = head
    for row in rows {
        text(row.template, x: gap, y: y + 21, size: 18, bold: true)
        y += label
        var x = gap
        for c in row.cells {
            image(c.reference, CGRect(x: x, y: y, width: w(c.format), height: cellH))
            image(c.swift, CGRect(x: x + w(c.format) + pairGap, y: y, width: w(c.format), height: cellH))
            let d = c.difference.map { String(format: "  ·  mean diff %.1f%%", $0 * 100) } ?? "  ·  no reference"
            text("\(c.format.rawValue)  reference | swift\(d)", x: x, y: y + cellH + 16, size: 12, grey: 0.4)
            x += 2 * w(c.format) + pairGap + gap * 2
        }
        y += cellH + caption + gap
    }
    return ctx.makeImage()!
}
