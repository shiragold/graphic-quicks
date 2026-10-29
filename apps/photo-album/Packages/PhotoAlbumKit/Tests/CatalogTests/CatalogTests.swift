import Foundation
import Testing
@testable import Catalog

/// `apps/photo-album/themes`, the two prototype Themes.
let themesDirectory = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .deletingLastPathComponent().deletingLastPathComponent().appending(path: "themes")

func loadCatalog() throws -> Catalog { try Catalog(directory: themesDirectory) }

@Suite("Catalog: loading the prototype Themes")
struct LoadingTests {
    @Test func loadsBothThemes() throws {
        let catalog = try loadCatalog()
        #expect(catalog.bundles.map(\.id) == ["kraft-scrapbook", "meadow-arch"])
        for b in catalog.bundles {
            #expect(b.templates.count == 6)
            #expect(b.templates.allSatisfy { $0.themeID == b.id })
        }
    }

    @Test func bundlesHaveNoCrossReferenceProblems() throws {
        for b in try loadCatalog().bundles {
            #expect(b.validate() == [], "\(b.id)")
        }
    }

    @Test(arguments: PageFormat.allCases)
    func everyTemplateResolvesInEveryFormat(format: PageFormat) throws {
        for b in try loadCatalog().bundles {
            for t in b.templates {
                let r = try t.resolve(format: format)
                #expect(r.canvas == format.canvas)
                #expect(r.slots.count == t.photoCount.max, "\(t.id)")
                #expect(r.topLevel.first.map { if case .background = $0 { true } else { false } } == true)
            }
        }
    }

    @Test func layerKindsDecode() throws {
        let t = try #require(try loadCatalog().bundle("kraft-scrapbook")?.template("02-polaroid-trio"))
        let r = try t.resolve(format: .square)
        let p1 = try #require(r.slots.first { $0.id == "p1" })
        #expect(p1.importance == 1)
        #expect(p1.focus == .faces)
        #expect(p1.border?.style == .polaroid)
        #expect(p1.border?.bottom == 0.27)
        #expect(p1.placement.rotate == -6)
        #expect(p1.placement.shadow == .lifted)
        let caption = try #require(r.textSlots.first { $0.id == "caption" })
        #expect(caption.placement.attachTo == "p1")
        #expect(caption.bindingName == "place")
        #expect(caption.align == .center)
        #expect(caption.valign == .middle)
        #expect(r.attached(to: "p1", z: .above).compactMap(\.id) == ["tape-masking", "caption"])
    }
}

@Suite("Catalog: Tokens and Palettes")
struct PaletteTests {
    @Test func defaultPaletteResolvesTokens() throws {
        let theme = try #require(try loadCatalog().bundle("kraft-scrapbook")).theme
        let p = theme.palette()
        #expect(p.resolve("@ink") == "#3a2c25")
        #expect(p.resolve("#ffffff") == "#ffffff")
        #expect(p.resolve("@nope") == "@nope")
    }

    @Test func partialPaletteInheritsDefault() throws {
        let theme = try #require(try loadCatalog().bundle("kraft-scrapbook")).theme
        let berry = theme.palette(named: "berry")
        #expect(berry.name == "berry")
        #expect(berry.resolve("@accent") == "#b5487a")
        #expect(berry.resolve("@ink") == "#3a2c25") // not in berry
        #expect(theme.palette(named: "missing").name == "default")
        #expect(theme.paletteNames == ["default", "berry"])
    }

    @Test func substitutesTokensInDecorationFiles() throws {
        let p = Palette(name: "x", tokens: ["ink": "#111111", "accent2": "#222222"])
        let svg = ##"<path fill="@ink" stroke="@accent2"/><text>a@b.c @unknown</text>"##
        #expect(p.substitute(in: svg) == ##"<path fill="#111111" stroke="#222222"/><text>a@b.c @unknown</text>"##)
    }

    @Test func everyTokenUsedInTemplatesExists() throws {
        for b in try loadCatalog().bundles {
            let palette = b.theme.palette()
            for path in b.theme.templates {
                let text = try String(contentsOf: b.directory.appending(path: path), encoding: .utf8)
                #expect(!palette.substitute(in: text).contains("\"@"), "\(path)")
            }
        }
    }
}

@Suite("Catalog: Page Format overrides")
struct FormatTests {
    @Test func nonBaseFormatReplacesFrames() throws {
        let t = try #require(try loadCatalog().bundle("kraft-scrapbook")?.template("02-polaroid-trio"))
        let square = try t.resolve(format: .square)
        let portrait = try t.resolve(format: .a4Portrait)
        #expect(square.formatStatus == "base")
        #expect(portrait.formatStatus == "draft")
        #expect(square.slots[0].frame == Frame(x: 130, y: 140, w: 320, h: 400))
        #expect(portrait.slots[0].frame == Frame(x: 130, y: 243, w: 320, h: 476))
        // Content is written once: overrides never touch the border or the mask.
        #expect(portrait.slots[0].border == square.slots[0].border)
        #expect(portrait.slots[0].placement.rotate == -6)
    }

    @Test func baseFormatIsNotSquareForMeadow() throws {
        let t = try #require(try loadCatalog().bundle("meadow-arch")?.template("01-arch-hero"))
        #expect(t.baseFormat == .a4Portrait)
        #expect(try t.resolve(format: .a4Portrait).slots[0].frame.h == 936)
        #expect(try t.resolve(format: .square).slots[0].frame.h == 662)
    }

    @Test func hideDropsNodesAndTheirChildren() throws {
        let json = """
        {"format": "photo-album/template@1", "id": "t/x", "baseFormat": "square", "photoCount": {"min": 1, "max": 1},
         "layers": [
          {"type": "background", "fill": "#ffffff"},
          {"id": "p1", "type": "photo", "frame": {"x": 0, "y": 0, "w": 10, "h": 10}},
          {"id": "deco", "type": "asset", "asset": "a", "frame": {"x": 0, "y": 0, "w": 10, "h": 10}},
          {"id": "tape", "type": "asset", "asset": "a", "attachTo": "deco", "frame": {"x": 0, "y": 0, "w": 1, "h": 1}}
         ],
         "formats": {"a4-portrait": {"hide": ["deco"], "nodes": {"p1": {"rotate": 5}}}, "a4-landscape": {}}}
        """
        let t = try JSONDecoder().decode(Template.self, from: Data(json.utf8))
        let r = try t.resolve(format: .a4Portrait)
        #expect(r.layers.compactMap(\.id) == ["p1"])
        #expect(r.slots[0].placement.rotate == 5)
        #expect(try t.resolve(format: .a4Landscape).layers.count == 4)
    }

    @Test func missingFormatThrows() throws {
        let json = """
        {"format": "photo-album/template@1", "id": "t/x", "baseFormat": "square", "photoCount": {"min": 1, "max": 1}, "layers": []}
        """
        let t = try JSONDecoder().decode(Template.self, from: Data(json.utf8))
        #expect(throws: CatalogError.missingFormat("t/x", .a4Portrait)) { try t.resolve(format: .a4Portrait) }
    }
}

@Suite("Catalog: Optional Slots and Absent Overrides")
struct OptionalSlotTests {
    @Test func journalEntryKeepsBothSlotsForTwoPhotos() throws {
        let t = try #require(try loadCatalog().bundle("kraft-scrapbook")?.template("05-journal-entry"))
        let r = try t.resolve(format: .square, photoCount: 2)
        #expect(r.droppedSlots == [])
        #expect(r.slots.map(\.id) == ["p1", "p2"])
    }

    @Test func journalEntryDropsP2ForOnePhoto() throws {
        let t = try #require(try loadCatalog().bundle("kraft-scrapbook")?.template("05-journal-entry"))
        let r = try t.resolve(format: .square, photoCount: 1)
        #expect(r.droppedSlots == ["p2"])
        #expect(r.slots.map(\.id) == ["p1"])
        // The attached washi tape goes with the Slot.
        #expect(!r.layers.contains { $0.id == "washi-p2" })
        // Absent Overrides move p1 and the sun sticker.
        #expect(r.slots[0].frame == Frame(x: 70, y: 150, w: 340, h: 560))
        let sun = try #require(r.layers.first { $0.id == "sun" })
        #expect(sun.placement?.frame == Frame(x: 300, y: 760, w: 140, h: 140))
    }

    @Test(arguments: [(PageFormat.a4Portrait, Frame(x: 70, y: 275, w: 340, h: 666)),
                      (PageFormat.a4Landscape, Frame(x: 137, y: 150, w: 404, h: 560))])
    func absentOverridesArePerFormat(format: PageFormat, expected: Frame) throws {
        let t = try #require(try loadCatalog().bundle("kraft-scrapbook")?.template("05-journal-entry"))
        let r = try t.resolve(format: format, photoCount: 1)
        #expect(r.slots.map(\.id) == ["p1"])
        #expect(r.slots[0].frame == expected)
    }

    @Test func neverDropsBelowMinimum() throws {
        let t = try #require(try loadCatalog().bundle("meadow-arch")?.template("04-gallery-five"))
        #expect(t.photoCount.min == 4)
        let r = try t.resolve(format: .square, photoCount: 1)
        #expect(r.slots.count == 4)
        #expect(r.droppedSlots == ["p5"])
        let p4 = try #require(r.slots.first { $0.id == "p4" })
        #expect(p4.orientation == .panorama) // Absent Override changes a Slot Hint too
    }

    @Test func noPhotoCountKeepsEverySlot() throws {
        let t = try #require(try loadCatalog().bundle("meadow-arch")?.template("04-gallery-five"))
        #expect(try t.resolve(format: .square).slots.count == 5)
        #expect(try t.resolve(format: .square, photoCount: 9).slots.count == 5)
    }
}

@Suite("Catalog: Bindings")
struct BindingTests {
    @Test func parsesNamesAndFormats() {
        #expect(Binding.parse("{date:MMMM yyyy}") == [Binding(name: "date", format: "MMMM yyyy")])
        #expect(Binding.parse("{title} · {place}").map(\.name) == ["title", "place"])
        #expect(Binding.parse("no braces") == [])
    }

    @Test func formatsStringsAndDates() {
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC")!
        let date = utc.date(from: DateComponents(year: 2026, month: 7, day: 12))!
        let values = BindingValues(strings: ["title": "Lake"], date: date, timeZone: TimeZone(identifier: "UTC")!)
        let en = Locale(identifier: "en_US_POSIX")
        #expect(Binding.format("{title}", with: values, locale: en) == "Lake")
        #expect(Binding.format("{date:MMMM yyyy}", with: values, locale: en) == "July 2026")
        #expect(Binding.format("{date:MMM dd}", with: values, locale: en) == "Jul 12")
        #expect(Binding.format("{story}", with: values, locale: en) == "")
        #expect(Binding.format("— {title} —", with: values, locale: en) == "— Lake —")
    }

    @Test func textSlotsUseKnownBindings() throws {
        let known: Set = ["title", "subtitle", "place", "date", "dateRange", "count", "section1", "section2", "story"]
        for b in try loadCatalog().bundles {
            for t in b.templates {
                for x in try t.resolve(format: t.baseFormat).textSlots {
                    if let name = x.bindingName { #expect(known.contains(name), "\(t.id) \(name)") }
                }
            }
        }
    }
}
