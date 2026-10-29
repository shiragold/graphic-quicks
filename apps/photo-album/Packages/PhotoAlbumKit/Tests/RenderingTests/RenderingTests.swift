import Catalog
import Composition
import CoreGraphics
import Export
import Foundation
import ImageIO
import Grouping
import Insights
import Library
@testable import Rendering
import Suggestion
import Testing

let themesDirectory = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .deletingLastPathComponent().deletingLastPathComponent().appending(path: "themes")

func photo(_ name: String, _ w: Int, _ h: Int, day: Int = 1) -> Photo {
    var utc = Calendar(identifier: .gregorian)
    utc.timeZone = TimeZone(identifier: "UTC")!
    return Photo(id: PhotoID(source: .folder, local: name), captureDate: utc.date(from: DateComponents(year: 2026, month: 7, day: day)),
                 pixelWidth: w, pixelHeight: h)
}

func solidImage(_ w: Int, _ h: Int, red: Double = 0.2) -> CGImage {
    let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                        space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.setFillColor(CGColor(srgbRed: red, green: 0.4, blue: 0.6, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
    return ctx.makeImage()!
}

@Suite("Rendering: SVG subset")
struct SVGTests {
    @Test func pathDataHandlesAbsoluteRelativeAndImplicitCommands() {
        let p = SVGPath.parse("M10 10 L20 10 l0 10 H10 Z m5 5 q5 -5 10 0")
        #expect(p.boundingBoxOfPath.minX == 10)
        #expect(p.boundingBoxOfPath.maxY >= 20)
        let implicit = SVGPath.parse("M0 0 10 0 10 10")
        #expect(implicit.boundingBoxOfPath == CGRect(x: 0, y: 0, width: 10, height: 10))
    }

    @Test func arcsBecomeCurvesThroughTheEndpoint() {
        let p = SVGPath.parse("M0 50 A50 50 0 0 1 100 50")
        let box = p.boundingBoxOfPath
        #expect(abs(box.minY - 0) < 0.5) // the semicircle reaches the top
        #expect(abs(box.maxX - 100) < 0.01)
        #expect(p.currentPoint.x.isNearlyEqual(to: 100))
    }

    @Test func numbersWithoutSeparators() {
        var s = SVGPath.Scanner("-.5.5e1-3")
        #expect(s.numbers() == [-0.5, 5, -3])
    }

    @Test func transformsComposeLeftToRight() {
        let t = SVGTransform.parse("translate(10 0) scale(2)")
        #expect(CGPoint(x: 1, y: 1).applying(t) == CGPoint(x: 12, y: 2))
        let r = SVGTransform.parse("rotate(90 10 10)")
        let q = CGPoint(x: 20, y: 10).applying(r)
        #expect(q.x.isNearlyEqual(to: 10) && q.y.isNearlyEqual(to: 20))
    }

    @Test func colours() {
        #expect(SVGColor.parse("#fff")?.components == [1, 1, 1, 1])
        #expect(SVGColor.parse("#ff000080")?.alpha.isNearlyEqual(to: 128.0 / 255) == true)
        #expect(SVGColor.parse("@ink") == nil)
    }

    @Test func everyDecorationFileParses() throws {
        for b in try Catalog(directory: themesDirectory).bundles {
            let assets = ThemeAssets(bundle: b)
            for (id, path) in b.theme.assets where path.hasSuffix(".svg") {
                let doc = try assets.document(id, palette: b.theme.palette())
                #expect(doc.viewBox.width > 0, "\(b.id)/\(id)")
            }
        }
    }
}

@Suite("Rendering: Fit, Matcher and render")
struct RenderTests {
    @Test func fitCoversTheSlotAndClamps() {
        let slot = CGSize(width: 100, height: 100)
        let centred = Fit().imageRect(photoAspect: 2, slot: slot)
        #expect(centred == CGRect(x: -50, y: 0, width: 200, height: 100))
        // A focal point at the far left is clamped so the photo still covers the slot.
        let left = Fit(centre: CGPoint(x: 0, y: 0.5)).imageRect(photoAspect: 2, slot: slot)
        #expect(left.minX == 0)
        let zoomed = Fit(scale: 2).imageRect(photoAspect: 1, slot: slot)
        #expect(zoomed.width == 200 && zoomed.minX == -50)
        #expect(Fit(scale: 0.5).scale == 1)
    }

    @Test func matcherPlacesEachPhotoOnceAndPrefersMatchingAspects() throws {
        let catalog = try Catalog(directory: themesDirectory)
        let t = try #require(catalog.bundle("kraft-scrapbook")?.template("02-polaroid-trio"))
        let r = try t.resolve(format: .square)
        // Best-ranked first; the rank penalty is doubled for the Hero.
        let photos = [
            MatchablePhoto(id: PhotoID(source: .folder, local: "portrait"), aspect: 0.8),
            MatchablePhoto(id: PhotoID(source: .folder, local: "square"), aspect: 1),
            MatchablePhoto(id: PhotoID(source: .folder, local: "landscape"), aspect: 1.5),
        ]
        let a = Matcher.place(photos, in: r)
        #expect(Set(a.values).count == 3)
        #expect(a["p1"]?.local == "portrait") // hero, 320×400
        #expect(a["p2"]?.local == "square")
        #expect(a["p3"]?.local == "landscape")
    }

    @Test func suggesterListsTemplatesThatFitTheCount() throws {
        let catalog = try Catalog(directory: themesDirectory)
        let one = TemplateSuggester.candidates(in: catalog, photoCount: 1)
        #expect(one.allSatisfy { $0.template.photoCount.min <= 1 })
        #expect(one.contains { $0.id == "kraft-scrapbook/05-journal-entry" })
        let five = TemplateSuggester.candidates(in: catalog, photoCount: 5)
        #expect(five.first?.fitsExactly == true)
        #expect(TemplateSuggester.candidates(in: catalog, photoCount: 0).isEmpty)
    }

    @Test(arguments: PageFormat.allCases)
    func everyTemplateRendersWithAndWithoutPhotos(format: PageFormat) throws {
        let catalog = try Catalog(directory: themesDirectory)
        for b in catalog.bundles {
            let assets = ThemeAssets(bundle: b)
            for t in b.templates {
                let r = try t.resolve(format: format, photoCount: t.photoCount.min)
                var images: [String: SlotImage] = [:]
                for s in r.slots { images[s.id] = SlotImage(image: solidImage(30, 20), fit: Fit()) }
                for imgs in [images, [:]] {
                    let scene = RenderScene(template: r, assets: assets, palette: b.theme.palette(), images: imgs,
                                            bindings: BindingValues(strings: b.theme.sampleData ?? [:], date: .now))
                    let img = try CollageRenderer().image(scene, pixelSize: CollageRenderer.previewSize(for: format, longSide: 200))
                    #expect(img.width > 0)
                }
            }
        }
    }

    @Test func pngAndPdfExportsHavePrintSize() throws {
        let catalog = try Catalog(directory: themesDirectory)
        let b = try #require(catalog.bundle("meadow-arch"))
        let r = try #require(b.template("02-duo")).resolve(format: .a4Portrait)
        let images = Dictionary(uniqueKeysWithValues: r.slots.map { ($0.id, SlotImage(image: solidImage(40, 30), fit: Fit())) })
        let scene = RenderScene(template: r, assets: ThemeAssets(bundle: b), palette: b.theme.palette(), images: images)
        let dir = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }

        try Exporter.writePNG(scene, to: dir.appending(path: "c.png"), dpi: 72)
        let src = try #require(CGImageSourceCreateWithURL(dir.appending(path: "c.png") as CFURL, nil))
        let props = try #require(CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any])
        #expect(props[kCGImagePropertyPixelWidth] as? Int == 595)
        #expect(props[kCGImagePropertyPixelHeight] as? Int == 842)

        try Exporter.writePDF([scene, scene], to: dir.appending(path: "c.pdf"))
        let pdf = try #require(CGPDFDocument(dir.appending(path: "c.pdf") as CFURL))
        #expect(pdf.numberOfPages == 2)
        let box = try #require(pdf.page(at: 1)).getBoxRect(.mediaBox)
        #expect(abs(box.width - 595.3) < 0.5 && abs(box.height - 841.9) < 0.5)
    }
}

@Suite("Composition: the Book invariant and Default Text")
struct CompositionTests {
    @Test func aPhotoIsPlacedAtMostOncePerBook() throws {
        var book = Book(title: "t", pageFormat: .square)
        let a = photo("a", 4, 3), b = photo("b", 3, 4)
        book.add([a, b])
        let c1 = Collage(templateID: "x/y", theme: ThemeRef(id: "x", version: "1.0"), photoCount: 1, placements: ["p1": Placement(photo: a.id, origin: .suggested)], fits: [:])
        try book.addCollage(c1)
        let c2 = Collage(templateID: "x/y", theme: ThemeRef(id: "x", version: "1.0"), photoCount: 1, placements: ["p1": Placement(photo: a.id, origin: .suggested)], fits: [:])
        #expect(throws: CompositionError.alreadyPlaced(a.id)) { try book.addCollage(c2) }
        #expect(book.unplaced.map(\.id) == [b.id])
        #expect(throws: CompositionError.placedCannotBeExcluded(a.id)) { try book.exclude(a.id) }
        try book.exclude(b.id)
        #expect(book.photos[b.id] == nil && book.containsOrExcludes(b.id))
        book.add([b]) // an Excluded Photo is not added back by a Group
        #expect(book.photos[b.id] == nil)
    }

    @Test func groupLeavesOutBookAndExcludedPhotos() {
        var book = Book(title: "t", pageFormat: .square)
        let ps = (1...4).map { photo("p\($0)", 4, 3, day: $0) }
        book.add([ps[0]])
        try? book.exclude(ps[1].id)
        let g = Grouping.Group(period: .month(containing: ps[0].captureDate!), photos: ps.reversed(), isInBook: book.containsOrExcludes)
        #expect(g.photos.map(\.id.local) == ["p3", "p4"])
    }

    @Test func defaultTextFromPlacedPhotos() throws {
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC")!
        let ps = [photo("a", 1, 1, day: 12), photo("b", 1, 1, day: 19)]
        let v = DefaultText.values(for: ps, sections: [1: [ps[0]]], locale: Locale(identifier: "en_GB"), calendar: utc)
        #expect(v.strings["title"] == "July")
        let span = try #require(v.strings["subtitle"])
        #expect(span.hasPrefix("12") && span.hasSuffix("19 July 2026") && span.contains("–"))
        #expect(v.strings["dateRange"] == span)
        #expect(v.strings["count"] == "2")
        #expect(v.strings["section1"] == "Sunday")
        #expect(v.strings["story"] == nil)
        var withPlace = ps
        withPlace[0].place = "Lisbon"
        #expect(DefaultText.values(for: withPlace, calendar: utc).strings["title"] == "Lisbon")
    }

    @Test func booksRoundTripThroughTheStore() throws {
        let dir = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = BookStore(directory: dir)
        var book = Book(title: "Round trip", pageFormat: .a4Landscape)
        book.add([photo("a", 4, 3)])
        try book.addCollage(Collage(templateID: "x/y", theme: ThemeRef(id: "x", version: "1.0"), photoCount: 1,
                                    placements: ["p1": Placement(photo: PhotoID(source: .folder, local: "a"), origin: .user)],
                                    fits: ["p1": Fit(scale: 1.2, centre: CGPoint(x: 0.3, y: 0.4), origin: .user)]))
        try store.save(book)
        let loaded = try store.load()
        #expect(loaded.count == 1)
        #expect(loaded[0].collages == book.collages)
        #expect(loaded[0].photos == book.photos)
    }
}

extension CGFloat {
    func isNearlyEqual(to other: CGFloat) -> Bool { abs(self - other) < 1e-6 }
}
