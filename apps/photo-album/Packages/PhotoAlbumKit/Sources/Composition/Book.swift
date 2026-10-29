import Catalog
import Foundation
import Library

public typealias PhotoRef = PhotoID

/// Where a Collage stands.
public enum CollageStatus: String, Codable, Hashable, Sendable { case draft, accepted, exported }

/// One Template, rendered in its Book's Page Format and filled with Book Photos. It refers to
/// its Template by ID and to its Photos by Photo ID, and never copies Template data.
public struct Collage: Codable, Hashable, Sendable, Identifiable {
    public var id: UUID
    /// `<theme>/<template>`.
    public var templateID: String
    /// The Theme and the version the Collage was made with. Rendering uses exactly this
    /// version while it is available, so a Theme update never silently changes the page.
    public var theme: ThemeRef
    public var palette: String
    /// The photo count the Template was resolved for, which decides the Optional Slots.
    public var photoCount: Int
    /// Slot ID → Placement.
    public var placements: [String: Placement]
    /// Slot ID → Fit.
    public var fits: [String: Fit]
    /// Text Slot ID → text the user typed. Missing means the Default Text.
    public var texts: [String: String]
    public var status: CollageStatus

    public init(id: UUID = UUID(), templateID: String, theme: ThemeRef, palette: String = "default", photoCount: Int,
                placements: [String: Placement], fits: [String: Fit], texts: [String: String] = [:],
                status: CollageStatus = .draft) {
        self.id = id
        self.templateID = templateID
        self.theme = theme
        self.palette = palette
        self.photoCount = photoCount
        self.placements = placements
        self.fits = fits
        self.texts = texts
        self.status = status
    }

    public var placedPhotos: [PhotoID] { placements.values.map(\.photo) }
}

public enum CompositionError: Error, CustomStringConvertible, Equatable {
    case alreadyPlaced(PhotoID)
    case notInBook(PhotoID)
    case placedCannotBeExcluded(PhotoID)
    case unknownCollage(UUID)

    public var description: String {
        switch self {
        case .alreadyPlaced(let p): "Photo \(p) is already placed in this Book"
        case .notInBook(let p): "Photo \(p) is not in this Book"
        case .placedCannotBeExcluded(let p): "Photo \(p) is placed; remove it from its Slot first"
        case .unknownCollage(let id): "No Collage \(id)"
        }
    }
}

/// The aggregate root and the user's saved unit of work. A Photo is placed at most once in a
/// Book; only the Book adds or moves Placements, so it can enforce that.
public struct Book: Codable, Hashable, Sendable, Identifiable {
    public var id: UUID
    public var title: String
    public var pageFormat: PageFormat
    public var created: Date
    /// Book Photos by ID: placed or Unplaced.
    public private(set) var photos: [PhotoID: Photo]
    /// The Excluded list.
    public private(set) var excluded: Set<PhotoID>
    /// In Book Order.
    public private(set) var collages: [Collage]

    public init(id: UUID = UUID(), title: String, pageFormat: PageFormat, created: Date = .now) {
        self.id = id
        self.title = title
        self.pageFormat = pageFormat
        self.created = created
        photos = [:]
        excluded = []
        collages = []
    }

    // MARK: Queries

    public var placed: Set<PhotoID> { Set(collages.flatMap(\.placedPhotos)) }

    /// Book Photos without a Placement, oldest first (the Tray).
    public var unplaced: [Photo] {
        let p = placed
        return photos.values.filter { !p.contains($0.id) }
            .sorted { ($0.captureDate ?? .distantPast) < ($1.captureDate ?? .distantPast) }
    }

    /// Whether a Group should leave this Photo out: it is in the Book or Excluded from it.
    public func containsOrExcludes(_ id: PhotoID) -> Bool { photos[id] != nil || excluded.contains(id) }

    public func collage(_ id: UUID) -> Collage? { collages.first { $0.id == id } }

    // MARK: Commands

    /// Adds Photos as Unplaced Book Photos. Excluded Photos are skipped.
    public mutating func add(_ newPhotos: [Photo]) {
        for p in newPhotos where !excluded.contains(p.id) { photos[p.id] = p }
    }

    /// Excludes a Photo from the Book. An Unplaced Book Photo leaves the Book.
    public mutating func exclude(_ id: PhotoID) throws {
        if placed.contains(id) { throw CompositionError.placedCannotBeExcluded(id) }
        photos[id] = nil
        excluded.insert(id)
    }

    public mutating func restore(_ id: PhotoID) { excluded.remove(id) }

    /// Adds a Collage. Every placed Photo must be a Book Photo placed nowhere else.
    public mutating func addCollage(_ collage: Collage) throws {
        try checkPlacements(collage, ignoring: nil)
        collages.append(collage)
    }

    /// Replaces a Collage after an edit, re-checking the invariant.
    public mutating func update(_ collage: Collage) throws {
        guard let i = collages.firstIndex(where: { $0.id == collage.id }) else {
            throw CompositionError.unknownCollage(collage.id)
        }
        try checkPlacements(collage, ignoring: collage.id)
        collages[i] = collage
    }

    /// Remove Collage. Its Photos become Unplaced.
    public mutating func removeCollage(_ id: UUID) {
        collages.removeAll { $0.id == id }
    }

    public mutating func setStatus(_ status: CollageStatus, of id: UUID) {
        if let i = collages.firstIndex(where: { $0.id == id }) { collages[i].status = status }
    }

    private func checkPlacements(_ collage: Collage, ignoring: UUID?) throws {
        let elsewhere = Set(collages.filter { $0.id != ignoring }.flatMap(\.placedPhotos))
        var seen = Set<PhotoID>()
        for p in collage.placedPhotos {
            guard photos[p] != nil else { throw CompositionError.notInBook(p) }
            if elsewhere.contains(p) || !seen.insert(p).inserted { throw CompositionError.alreadyPlaced(p) }
        }
    }
}
