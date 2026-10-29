import AppKit
import Catalog
import Composition
import Export
import Rendering
import SwiftUI
import UniformTypeIdentifiers

/// The app's root: the Book picker, or the open Book.
public struct RootView: View {
    @Bindable var model: AppModel

    public init(model: AppModel) {
        self.model = model
    }

    public var body: some View {
        Group {
            if let book = model.openBook {
                BookView(model: model, book: book)
            } else {
                BookPickerView(model: model)
            }
        }
        .alert("Something went wrong", isPresented: Binding(
            get: { model.lastError != nil }, set: { if !$0 { model.lastError = nil } })) {
            Button("OK") { model.lastError = nil }
        } message: {
            Text(model.lastError ?? "")
        }
    }
}

/// Opens an ongoing Book or starts a new one with its Page Format.
struct BookPickerView: View {
    @Bindable var model: AppModel
    @State private var title = ""
    @State private var format: CatalogPageFormat = .square

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            Form {
                Section("Start a Book") {
                    TextField("Title", text: $title, prompt: Text("Summer 2026"))
                    Picker("Page Format", selection: $format) {
                        ForEach(CatalogPageFormat.allCases) { Text($0.displayName).tag($0) }
                    }
                    .pickerStyle(.radioGroup)
                    Button("Start Book") { model.startBook(title: title, format: format) }
                        .keyboardShortcut(.defaultAction)
                }
            }
            .formStyle(.grouped)
            .frame(width: 340)
            Divider()
            List {
                Section("Open a Book") {
                    if model.books.isEmpty { Text("No Books yet").foregroundStyle(.secondary) }
                    ForEach(model.books) { book in
                        Button {
                            model.openBookID = book.id
                        } label: {
                            VStack(alignment: .leading) {
                                Text(book.title).font(.headline)
                                Text("\(book.pageFormat.displayName) · \(book.collages.count) Collages · \(book.photos.count) Photos")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("open-book-\(book.title)")
                    }
                }
            }
        }
        .navigationTitle("Photo Album")
    }
}

/// The Book overview: its Collages and the Collage being looked at.
struct BookView: View {
    @Bindable var model: AppModel
    let book: Book

    var body: some View {
        NavigationSplitView {
            List(selection: $model.selectedCollageID) {
                Section("Collages") {
                    ForEach(Array(book.collages.enumerated()), id: \.element.id) { i, c in
                        VStack(alignment: .leading) {
                            Text("\(i + 1). \(model.catalog.template(c.templateID)?.1.displayName ?? c.templateID)")
                            Text("\(c.placements.count) Photos · \(c.status.rawValue)")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        .tag(c.id)
                    }
                }
                Section("Tray") {
                    Text("\(book.unplaced.count) Unplaced Photos").foregroundStyle(.secondary)
                }
            }
            .navigationSplitViewColumnWidth(min: 220, ideal: 260)
        } detail: {
            if let id = model.selectedCollageID, let collage = book.collage(id) {
                CollageView(model: model, book: book, collage: collage).id(collage.id)
            } else {
                ContentUnavailableView {
                    Label(book.collages.isEmpty ? "No Collages yet" : "Pick a Collage", systemImage: "rectangle.3.group")
                } description: {
                    Text("Add Photos from a month, then choose a Template.")
                } actions: {
                    Button("Add Photos…") { model.isAddingPhotos = true }
                }
            }
        }
        .navigationTitle(book.title)
        .navigationSubtitle(book.pageFormat.displayName)
        .toolbar {
            ToolbarItem(placement: .navigation) {
                Button { model.openBookID = nil; model.selectedCollageID = nil } label: { Label("Books", systemImage: "books.vertical") }
            }
            ToolbarItem {
                Button { model.isAddingPhotos = true } label: { Label("Add Photos", systemImage: "photo.badge.plus") }
            }
            ToolbarItem {
                Button { exportBook() } label: { Label("Export Book PDF", systemImage: "book.pages") }
                    .disabled(book.collages.isEmpty)
            }
        }
        .sheet(isPresented: $model.isAddingPhotos) {
            AddPhotosView(model: model, book: book) { newCollage in
                model.isAddingPhotos = false
                if let newCollage { model.selectedCollageID = newCollage.id }
            }
            .frame(minWidth: 820, minHeight: 620)
        }
    }

    private func exportBook() {
        guard let url = savePanel(name: "\(book.title).pdf", type: .pdf) else { return }
        Task {
            do { try await model.exportBookPDF(to: url) } catch { model.lastError = "\(error)" }
        }
    }
}

@MainActor
func savePanel(name: String, type: UTType) -> URL? {
    let panel = NSSavePanel()
    panel.nameFieldStringValue = name
    panel.allowedContentTypes = [type]
    panel.canCreateDirectories = true
    return panel.runModal() == .OK ? panel.url : nil
}

/// One Collage: the Preview (the same renderer as the Export), Accept and Export.
struct CollageView: View {
    @Bindable var model: AppModel
    let book: Book
    let collage: Collage
    @State private var preview: CGImage?
    @State private var working: String?

    var body: some View {
        VStack(spacing: 12) {
            ZStack {
                if let preview {
                    Image(decorative: preview, scale: 2)
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .shadow(radius: 6, y: 2)
                        .accessibilityIdentifier("collage-preview")
                } else {
                    ProgressView("Rendering…")
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding()
            HStack {
                if let working { ProgressView().controlSize(.small); Text(working).foregroundStyle(.secondary) }
                Spacer()
                Button("Accept") { model.accept(collage) }
                    .disabled(collage.status != .draft)
                Button("Export PNG…") { export(.png) }
                Button("Export PDF…") { export(.pdf) }
                    .keyboardShortcut("e")
            }
            .padding([.horizontal, .bottom])
        }
        .task(id: collage) { await render() }
    }

    private var baseName: String {
        "\(book.title) – \(model.catalog.template(collage.templateID)?.1.displayName ?? "Collage")"
    }

    private func render() async {
        do {
            let size = CollageRenderer.previewSize(for: book.pageFormat, longSide: 1600)
            let scene = try await model.scene(for: collage, in: book, pagePixels: size, preview: true)
            preview = try CollageRenderer().image(scene, pixelSize: size)
        } catch {
            model.lastError = "Could not render the Collage: \(error)"
        }
    }

    private func export(_ format: ExportFormat) {
        guard let url = savePanel(name: "\(baseName).\(format.fileExtension)", type: format.contentType) else { return }
        working = "Exporting \(format.rawValue.uppercased())…"
        Task {
            defer { working = nil }
            do { try await model.export(collage, as: format, to: url) } catch { model.lastError = "Export failed: \(error)" }
        }
    }
}
