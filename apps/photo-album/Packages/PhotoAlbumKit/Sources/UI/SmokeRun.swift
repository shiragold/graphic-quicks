import AppKit
import Catalog
import Composition
import Export
import Foundation
import Grouping
import Library
import SwiftUI
import Suggestion

/// An end-to-end run of the walking skeleton through the same model calls the UI makes,
/// started with `-smoke-run [yyyy-MM]`: start a Book, get Photos access, open a real month of
/// the Photos Library, exclude one Photo, pick the first suggested Template, and export one
/// PNG, one PDF and the Book PDF. Window snapshots are saved along the way. Results go to
/// `Application Support/PhotoAlbum/SmokeRun/` (inside the sandbox container).
@MainActor
public enum SmokeRun {
    public static var requestedMonth: String? {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: "-smoke-run") else { return nil }
        return i + 1 < args.count && !args[i + 1].hasPrefix("-") ? args[i + 1] : ""
    }

    public static func run(_ model: AppModel, month: String) async {
        var log: [String] = []
        func note(_ s: String) { log.append("\(Date.now.formatted(.iso8601)) \(s)"); print("smoke:", s) }
        let base = (try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true))!
        let out = base.appending(path: "PhotoAlbum/SmokeRun")
        try? FileManager.default.removeItem(at: out)
        try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        defer {
            try? log.joined(separator: "\n").appending("\n").write(to: out.appending(path: "smoke.log"), atomically: true, encoding: .utf8)
            print("smoke: done →", out.path)
        }
        do {
            try await pause(1)
            snapshot(to: out.appending(path: "1-book-picker.png"))
            model.startBook(title: "Smoke run", format: .a4Portrait)
            note("started Book, A4 portrait")

            if model.access == .notDetermined { note("asking for Photos access"); await model.requestAccess() }
            note("access: \(model.access.rawValue)")
            guard model.access == .full || model.access == .limited else { note("FAIL no access"); return }

            let months = PeriodIndex.months(of: try await model.source.captureDates())
            note("library months: \(months.count)")
            let wanted = months.first { m in
                month.isEmpty ? m.photoCount >= 3 : m.period.interval.start.formatted(.iso8601.year().month()) == month
            }
            guard let summary = wanted else { note("FAIL month \(month) not found"); return }
            let period = summary.period
            let photos = try await model.source.photos(in: period.interval)
            guard let book = model.openBook else { return }
            let group = Grouping.Group(period: period, photos: photos, isInBook: book.containsOrExcludes)
            note("Group \(period.title()): \(group.photos.count) Photos")

            // Exclude the first Photo, keep the rest (at most what one Template can take).
            let excluded = group.photos.count > 1 ? [group.photos[0]] : []
            let kept = Array(group.photos.dropFirst(excluded.count))
            model.addPhotosRequest = (period, Set(excluded.map(\.id)))
            model.isAddingPhotos = true
            try await pause(4)
            snapshot(to: out.appending(path: "2-group.png"), sheet: true)
            model.isAddingPhotos = false
            try await pause(1)

            let candidates = TemplateSuggester.candidates(in: model.catalog, photoCount: kept.count)
            note("Template candidates for \(kept.count) Photos: \(candidates.prefix(5).map(\.id))")
            guard let pick = candidates.first else { note("FAIL no Template"); return }
            snapshotView(TemplatePicker(model: model, format: book.pageFormat, photoCount: kept.count) { _, _ in }
                .frame(width: 900, height: 640), to: out.appending(path: "3-templates.png"))

            let collage = try await model.makeCollage(template: pick.template, position: 0, kept: kept, excluded: excluded)
            note("Collage \(pick.id): placements \(collage.placements.count), photoCount \(collage.photoCount)")
            let after = model.openBook!
            note("Book: \(after.photos.count) Book Photos, \(after.unplaced.count) Unplaced, \(after.excluded.count) Excluded, \(after.collages.count) Collages")
            model.selectedCollageID = collage.id
            try await pause(6)
            snapshot(to: out.appending(path: "4-collage.png"))

            let png = out.appending(path: "collage.png"), pdf = out.appending(path: "collage.pdf"), bookPDF = out.appending(path: "book.pdf")
            try await model.export(collage, as: .png, to: png)
            note("exported PNG \(size(png))")
            try await model.export(collage, as: .pdf, to: pdf)
            note("exported PDF \(size(pdf))")
            try await model.exportBookPDF(to: bookPDF)
            note("exported Book PDF \(size(bookPDF))")
            note("status: \(model.openBook!.collage(collage.id)!.status.rawValue)")
            note("PASS")
        } catch {
            note("FAIL \(error)")
        }
    }

    private static func pause(_ s: Double) async throws { try await Task.sleep(for: .seconds(s)) }

    private static func size(_ url: URL) -> String {
        let n = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int) ?? 0
        return "\(url.lastPathComponent) \(n / 1024) KB"
    }

    /// Saves the main window (or its sheet) as the app draws it. Needs no screen-recording
    /// permission because it reads the app's own views.
    private static func snapshot(to url: URL, sheet: Bool = false) {
        guard let main = NSApp.windows.first(where: { $0.isVisible && $0.sheetParent == nil && $0.contentView != nil }),
              case let window = sheet ? (main.attachedSheet ?? main) : main,
              let view = window.contentView?.superview ?? window.contentView else { return }
        write(view, to: url)
    }

    private static func snapshotView<V: View>(_ view: V, to url: URL) {
        let host = NSHostingView(rootView: view)
        host.frame = NSRect(origin: .zero, size: host.fittingSize)
        host.layoutSubtreeIfNeeded()
        // Give async thumbnails a moment to render.
        RunLoop.main.run(until: .now + 2)
        write(host, to: url)
    }

    private static func write(_ view: NSView, to url: URL) {
        guard let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return }
        view.cacheDisplay(in: view.bounds, to: rep)
        try? rep.representation(using: .png, properties: [:])?.write(to: url)
    }
}
