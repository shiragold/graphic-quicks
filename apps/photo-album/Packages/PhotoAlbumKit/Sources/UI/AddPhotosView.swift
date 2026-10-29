import Catalog
import Composition
import Grouping
import Library
import Rendering
import Suggestion
import SwiftUI

/// Add Photos: Access → Period → the Group, where the user excludes Photos → a Template.
struct AddPhotosView: View {
    @Bindable var model: AppModel
    let book: Book
    /// Called with the new Collage, or nil when cancelled.
    let done: (Collage?) -> Void

    enum Step: Hashable { case periods, group(Period), templates(Period) }

    @State private var step: Step = .periods
    @State private var months: [PeriodSummary]?
    @State private var group: Grouping.Group?
    @State private var excluded: Set<PhotoID> = []
    @State private var loading = false

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            content.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .task { await start() }
    }

    // MARK: Header

    private var header: some View {
        HStack {
            if step != .periods {
                Button { back() } label: { Label("Back", systemImage: "chevron.left") }
            }
            Text(title).font(.title3.bold())
            Spacer()
            if case .group(let period) = step, let group {
                Text("\(group.photos.count - excluded.count) of \(group.photos.count) kept")
                    .foregroundStyle(.secondary)
                Button("Choose Template…") { step = .templates(period) }
                    .keyboardShortcut(.defaultAction)
                    .disabled(group.photos.count == excluded.count)
            }
            Button("Cancel") { done(nil) }.keyboardShortcut(.cancelAction)
        }
        .padding()
    }

    private var title: String {
        switch step {
        case .periods: "Add Photos"
        case .group(let p): p.title()
        case .templates: "Choose a Template"
        }
    }

    private func back() {
        switch step {
        case .periods: break
        case .group: step = .periods; group = nil; excluded = []
        case .templates(let p): step = .group(p)
        }
    }

    // MARK: Content

    @ViewBuilder private var content: some View {
        switch model.access {
        case .notDetermined:
            ProgressView("Asking for access to Photos…")
        case .denied, .restricted:
            ContentUnavailableView {
                Label("No access to Photos", systemImage: "lock")
            } description: {
                Text("Photo Album needs access to your Photos Library to add Photos. Allow it in System Settings › Privacy & Security › Photos.")
            } actions: {
                Button("Open System Settings") { model.openPrivacySettings() }
            }
        case .full, .limited:
            VStack(spacing: 0) {
                if model.access == .limited { limitedBanner }
                switch step {
                case .periods: periodList
                case .group: groupGrid
                case .templates: templateList
                }
            }
        }
    }

    private var limitedBanner: some View {
        HStack {
            Image(systemName: "info.circle")
            Text("Photo Album sees only the Photos you selected for it.")
            Spacer()
            Button("Change in System Settings") { model.openPrivacySettings() }
        }
        .padding(10)
        .background(.yellow.opacity(0.15))
    }

    private var periodList: some View {
        SwiftUI.Group {
            if let months {
                if months.isEmpty {
                    ContentUnavailableView("No Photos", systemImage: "photo.on.rectangle",
                                           description: Text("The Photos Library has no Photos this app can see."))
                } else {
                    List(months) { m in
                        Button {
                            Task { await open(m.period) }
                        } label: {
                            HStack {
                                Text(m.period.title())
                                Spacer()
                                Text("\(m.photoCount)").foregroundStyle(.secondary)
                                Image(systemName: "chevron.right").foregroundStyle(.tertiary)
                            }
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .padding(.vertical, 4)
                        .accessibilityIdentifier("period-\(m.period.title())")
                    }
                }
            } else {
                ProgressView("Reading the Photos Library…")
            }
        }
    }

    private var groupGrid: some View {
        SwiftUI.Group {
            if let group, !loading {
                if group.photos.isEmpty {
                    ContentUnavailableView("Nothing new in this month", systemImage: "checkmark.circle",
                                           description: Text("Every Photo of this month is already in the Book or Excluded."))
                } else {
                    ScrollView {
                        Text("Click a Photo to exclude it; click again to keep it.")
                            .font(.callout).foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), spacing: 8)], spacing: 8) {
                            ForEach(group.photos) { photo in
                                PhotoTile(source: model.source, photo: photo, excluded: excluded.contains(photo.id))
                                    .onTapGesture {
                                        if excluded.contains(photo.id) { excluded.remove(photo.id) } else { excluded.insert(photo.id) }
                                    }
                            }
                        }
                    }
                    .padding()
                }
            } else {
                ProgressView()
            }
        }
    }

    private var keptPhotos: [Photo] { group?.photos.filter { !excluded.contains($0.id) } ?? [] }

    private var templateList: some View {
        TemplatePicker(model: model, format: book.pageFormat, photoCount: keptPhotos.count) { template, position in
            Task {
                do {
                    let excludedPhotos = group?.photos.filter { excluded.contains($0.id) } ?? []
                    let collage = try await model.makeCollage(template: template, position: position,
                                                              kept: keptPhotos, excluded: excludedPhotos)
                    done(collage)
                } catch {
                    model.lastError = "Could not make the Collage: \(error)"
                }
            }
        }
    }

    // MARK: Loading

    private func start() async {
        if model.access == .notDetermined { await model.requestAccess() }
        guard model.access == .full || model.access == .limited else { return }
        do {
            let dates = try await model.source.captureDates()
            months = PeriodIndex.months(of: dates)
        } catch {
            model.lastError = "\(error)"
            months = []
        }
        if let request = model.addPhotosRequest {
            model.addPhotosRequest = nil
            await open(request.period)
            excluded = request.excluded
        }
    }

    private func open(_ period: Period) async {
        loading = true
        step = .group(period)
        defer { loading = false }
        do {
            let photos = try await model.source.photos(in: period.interval)
            let current = model.openBook ?? book
            group = Grouping.Group(period: period, photos: photos, isInBook: current.containsOrExcludes)
            excluded = []
        } catch {
            model.lastError = "\(error)"
        }
    }
}

/// A Group thumbnail. Excluded Photos are dimmed and crossed out.
struct PhotoTile: View {
    let source: PhotoKitSource
    let photo: Photo
    let excluded: Bool
    @State private var image: CGImage?

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Rectangle().fill(.quaternary)
                .aspectRatio(1, contentMode: .fit)
                .overlay {
                    if let image {
                        Image(decorative: image, scale: 1).resizable().aspectRatio(contentMode: .fill)
                    }
                }
                .clipShape(.rect(cornerRadius: 6))
                .opacity(excluded ? 0.3 : 1)
            if excluded {
                Image(systemName: "xmark.circle.fill")
                    .font(.title2).foregroundStyle(.white, .red).padding(4)
            }
        }
        .contentShape(.rect)
        .accessibilityLabel(excluded ? "Excluded Photo" : "Photo")
        .accessibilityAddTraits(.isButton)
        .task(id: photo.id) {
            image = try? await source.thumbnail(for: photo.id, pixelSize: CGSize(width: 300, height: 300))
        }
    }
}

/// Templates that fit the photo count, with a small Preview of each (empty Slots).
struct TemplatePicker: View {
    @Bindable var model: AppModel
    let format: CatalogPageFormat
    let photoCount: Int
    let pick: (Template, Int) -> Void
    @State private var theme: String = ""

    var body: some View {
        let candidates = TemplateSuggester.candidates(in: model.catalog, photoCount: photoCount, theme: theme.isEmpty ? nil : theme)
        VStack(alignment: .leading) {
            HStack {
                Picker("Theme", selection: $theme) {
                    Text("All Themes").tag("")
                    ForEach(model.catalog.bundles) { Text($0.theme.name).tag($0.id) }
                }
                .frame(maxWidth: 280)
                Spacer()
                Text("\(photoCount) Photos").foregroundStyle(.secondary)
            }
            if candidates.isEmpty {
                ContentUnavailableView("No Template fits \(photoCount) Photos", systemImage: "square.dashed")
            } else {
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 180), spacing: 16)], spacing: 16) {
                        ForEach(Array(candidates.enumerated()), id: \.element.id) { i, c in
                            Button { pick(c.template, i) } label: {
                                VStack(alignment: .leading, spacing: 4) {
                                    TemplateThumbnail(model: model, template: c.template, format: format, photoCount: photoCount)
                                    Text(c.template.displayName).font(.headline)
                                    Text(caption(c)).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("template-\(c.template.localID)")
                        }
                    }
                }
            }
        }
        .padding()
    }

    private func caption(_ c: TemplateCandidate) -> String {
        let range = c.template.photoCount.min == c.template.photoCount.max
            ? "\(c.template.photoCount.max)" : "\(c.template.photoCount.min)–\(c.template.photoCount.max)"
        let extra = c.fitsExactly ? "" : " · \(photoCount - c.template.photoCount.max) stay Unplaced"
        return "\(c.theme) · \(range) Photos\(extra)"
    }
}

struct TemplateThumbnail: View {
    let model: AppModel
    let template: Template
    let format: CatalogPageFormat
    let photoCount: Int
    @State private var image: CGImage?

    var body: some View {
        let c = format.canvas
        Rectangle().fill(.quaternary)
            .aspectRatio(c.width / c.height, contentMode: .fit)
            .overlay { if let image { Image(decorative: image, scale: 2).resizable() } }
            .shadow(radius: 2, y: 1)
            .task(id: "\(template.id)-\(photoCount)") {
                guard let assets = model.assets(for: template.themeID),
                      let r = try? template.resolve(format: format, photoCount: photoCount) else { return }
                let scene = RenderScene(template: r, assets: assets, palette: assets.bundle.theme.palette(),
                                        images: [:], bindings: .init(strings: assets.bundle.theme.sampleData ?? [:], date: .now))
                image = try? CollageRenderer().image(scene, pixelSize: CollageRenderer.previewSize(for: format, longSide: 400))
            }
    }
}
