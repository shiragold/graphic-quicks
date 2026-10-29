import AppKit
import Catalog
import Composition
import Export
import Foundation
import Grouping
import Insights
import Library
import Observation
import Rendering
import Suggestion
import Usage

/// The app's state: the Catalog, the saved Books, the Photos Library and the Usage Log.
@MainActor @Observable
public final class AppModel {
    /// All Theme versions from every source; `catalog` is the newest compatible version of each.
    public let themes: ThemeCatalog
    public var catalog: Catalog { themes.catalog }
    public let source = PhotoKitSource()
    let insights: any InsightProvider = CentreFocusInsights()
    private let store: BookStore?
    private let usage: UsageLog?
    private var assetsByTheme: [ThemeRef: ThemeAssets] = [:]

    public private(set) var books: [Book] = []
    public var openBookID: UUID?
    /// The Collage shown in the open Book.
    public var selectedCollageID: UUID?
    public var isAddingPhotos = false
    /// Opens Add Photos directly on a Period, with some Photos already Excluded.
    var addPhotosRequest: (period: Period, excluded: Set<PhotoID>)?
    public private(set) var access: Access = PhotoKitSource.access
    public var lastError: String?

    /// - Parameter themesDirectory: the folder of built-in Theme bundles.
    public init(themesDirectory: URL, appVersion: String) {
        // One source today. A hosted catalog becomes a second element here (see ThemeSource.swift).
        themes = ThemeCatalog(sources: [BundledThemeSource(directory: themesDirectory)],
                              compatibility: ThemeCompatibility(appVersion: ThemeVersion(appVersion)))
        if themes.catalog.bundles.isEmpty {
            lastError = "No Themes could be loaded: \(themes.skipped.map(\.description).joined(separator: "; "))"
        }
        store = try? BookStore.standard()
        usage = try? UsageLog.standard(appVersion: appVersion)
        books = (try? store?.load()) ?? []
    }

    // MARK: Books

    public var openBook: Book? { books.first { $0.id == openBookID } }

    public func startBook(title: String, format: CatalogPageFormat) {
        let book = Book(title: title.isEmpty ? "Untitled Book" : title, pageFormat: format)
        books.insert(book, at: 0)
        save(book)
        openBookID = book.id
        if let f = Usage.PageFormat(rawValue: format.rawValue) { record(.bookStarted(format: f)) }
    }

    func save(_ book: Book) {
        if let i = books.firstIndex(where: { $0.id == book.id }) { books[i] = book }
        do { try store?.save(book) } catch { lastError = "Could not save the Book: \(error)" }
    }

    func mutateOpenBook(_ change: (inout Book) throws -> Void) rethrows {
        guard var book = openBook else { return }
        try change(&book)
        save(book)
    }

    // MARK: Access

    public func requestAccess() async {
        access = await PhotoKitSource.requestAccess()
    }

    public func openPrivacySettings() {
        NSWorkspace.shared.open(PhotoKitSource.privacySettingsURL)
    }

    // MARK: Catalog

    /// Assets of the newest version of a Theme.
    func assets(for themeID: String) -> ThemeAssets? {
        catalog.bundle(themeID).map(assets)
    }

    func assets(_ bundle: ThemeBundle) -> ThemeAssets {
        if let a = assetsByTheme[bundle.theme.ref] { return a }
        let a = ThemeAssets(bundle: bundle)
        assetsByTheme[bundle.theme.ref] = a
        return a
    }

    /// The exact Theme version a Collage was made with, or the newest one plus a note when
    /// that version is no longer available.
    func themeBundle(for collage: Collage) -> (bundle: ThemeBundle, note: String?)? {
        if let exact = themes.bundle(for: collage.theme) { return (exact, nil) }
        guard let newest = themes.newest(collage.theme.id) else { return nil }
        return (newest, "Made with \(collage.theme); \(collage.theme.version) is no longer installed, so this preview uses \(newest.theme.version).")
    }

    // MARK: Add Photos → Collage

    /// Adds the Group's kept Photos to the Book, remembers the Excluded ones, and makes one
    /// Collage from the picked Template with suggested Placements and Fits.
    func makeCollage(template: Template, position: Int, kept: [Photo], excluded: [Photo]) async throws -> Collage {
        guard let book = openBook else { throw CompositionError.unknownCollage(UUID()) }
        var matchable: [MatchablePhoto] = []
        for p in kept { matchable.append(MatchablePhoto(id: p.id, aspect: p.aspect, insight: await insights.insight(for: p))) }
        guard let bundle = catalog.bundle(template.themeID) else { throw CatalogError.unknownAsset(template.themeID) }
        let collage = try CollageMaker.make(template: template, theme: bundle.theme.ref, format: book.pageFormat, photos: matchable)
        try mutateOpenBook { b in
            b.add(kept)
            for p in excluded { try b.exclude(p.id) }
            try b.addCollage(collage)
        }
        if let v = variant(of: collage, in: book) {
            record(.templatePicked(collage: CollageRef(collage.id), variant: v, source: .suggestion(position: position)))
        }
        return collage
    }

    func accept(_ collage: Collage) {
        mutateOpenBook { $0.setStatus(.accepted, of: collage.id) }
        if let book = openBook, let v = variant(of: collage, in: book) {
            record(.accepted(collage: CollageRef(collage.id), variant: v, optionalSlot: optionalOutcome(collage, book)))
        }
    }

    // MARK: Rendering and Export

    /// A Render scene for a Collage, with Images loaded at `pagePixels` page size.
    func scene(for collage: Collage, in book: Book, pagePixels: CGSize, preview: Bool) async throws -> RenderScene {
        guard let (bundle, _) = themeBundle(for: collage), let template = bundle.template(collage.templateID) else {
            throw CatalogError.unknownAsset(collage.templateID)
        }
        let assets = assets(bundle)
        let resolved = try template.resolve(format: book.pageFormat, photoCount: collage.photoCount)
        var images: [String: SlotImage] = [:]
        for slot in resolved.slots {
            guard let placement = collage.placements[slot.id], let photo = book.photos[placement.photo] else { continue }
            let n = resolved.normalized(slot.frame)
            let need = CGSize(width: max(64, n.width * pagePixels.width * 1.1),
                              height: max(64, n.height * pagePixels.height * 1.1))
            let image = try await source.image(for: photo.id, pixelSize: need)
            images[slot.id] = SlotImage(image: image, aspect: photo.aspect, fit: collage.fits[slot.id] ?? Fit())
        }
        var sections: [Int: [Photo]] = [:]
        for slot in resolved.slots {
            if let s = slot.section, let p = collage.placements[slot.id].flatMap({ book.photos[$0.photo] }) {
                sections[s, default: []].append(p)
            }
        }
        let placed = collage.placedPhotos.compactMap { book.photos[$0] }
        return RenderScene(template: resolved, assets: assets, palette: bundle.theme.palette(named: collage.palette),
                           images: images, texts: collage.texts,
                           bindings: DefaultText.values(for: placed, sections: sections),
                           showsTextPlaceholders: preview)
    }

    func export(_ collage: Collage, as format: ExportFormat, to url: URL) async throws {
        guard let book = openBook else { return }
        let dpi = Exporter.defaultDPI
        let scene = try await scene(for: collage, in: book, pagePixels: book.pageFormat.outputSize(dpi: dpi), preview: false)
        switch format {
        case .png: try Exporter.writePNG(scene, to: url, dpi: dpi)
        case .pdf: try Exporter.writePDF([scene], to: url, title: book.title)
        }
        mutateOpenBook { $0.setStatus(.exported, of: collage.id) }
        if let v = variant(of: collage, in: book) {
            record(.exported(collage: CollageRef(collage.id), variant: v, optionalSlot: optionalOutcome(collage, book)))
        }
    }

    /// The Book PDF: every Collage in Book Order, one per page.
    func exportBookPDF(to url: URL) async throws {
        guard let book = openBook else { return }
        var scenes: [RenderScene] = []
        for c in book.collages {
            scenes.append(try await scene(for: c, in: book, pagePixels: book.pageFormat.outputSize(dpi: Exporter.defaultDPI), preview: false))
        }
        try Exporter.writePDF(scenes, to: url, title: book.title)
        for c in book.collages {
            mutateOpenBook { $0.setStatus(.exported, of: c.id) }
            if let v = variant(of: c, in: book) {
                record(.exported(collage: CollageRef(c.id), variant: v, optionalSlot: optionalOutcome(c, book)))
            }
        }
    }

    // MARK: Usage

    private func variant(of collage: Collage, in book: Book) -> Variant? {
        guard let t = themeBundle(for: collage)?.bundle.template(collage.templateID),
              let theme = ThemeID(t.themeID), let template = TemplateID(t.localID),
              let format = Usage.PageFormat(rawValue: book.pageFormat.rawValue) else { return nil }
        return Variant(theme: theme, template: template, format: format, palette: PaletteID(collage.palette) ?? .default,
                       themeVersion: ThemeVersionID(collage.theme.version))
    }

    private func optionalOutcome(_ collage: Collage, _ book: Book) -> OptionalSlotOutcome {
        guard let t = themeBundle(for: collage)?.bundle.template(collage.templateID),
              let r = try? t.resolve(format: book.pageFormat, photoCount: collage.photoCount) else { return .none }
        if r.hasEmptyOptionalSlot { return .empty }
        return r.hasOptionalSlot ? .filled : .none
    }

    private func record(_ signal: UsageSignal) {
        guard let usage else { return }
        Task {
            do { try await usage.record(signal) } catch { await MainActor.run { self.lastError = "Usage: \(error)" } }
        }
    }
}
