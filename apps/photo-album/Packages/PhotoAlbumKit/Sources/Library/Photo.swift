import CoreGraphics
import Foundation

/// The kind of Source a Photo comes from.
public enum SourceKind: String, Codable, Hashable, Sendable {
    case photosLibrary, folder, imported
}

/// A stable Photo ID: the Source plus the identifier within it (for the Photos Library, the
/// `PHAsset.localIdentifier`).
public struct PhotoID: Codable, Hashable, Sendable, CustomStringConvertible {
    public var source: SourceKind
    public var local: String

    public init(source: SourceKind, local: String) {
        self.source = source
        self.local = local
    }

    public var description: String { "\(source.rawValue):\(local)" }
}

/// One still image from a Source. The user's content, never template artwork.
public struct Photo: Codable, Hashable, Sendable, Identifiable {
    public var id: PhotoID
    public var captureDate: Date?
    /// Pixel size of the Original.
    public var pixelWidth: Int
    public var pixelHeight: Int
    /// A place name, when one is known (reverse geocoding is not wired yet).
    public var place: String?
    public var isFavorite: Bool

    public init(id: PhotoID, captureDate: Date?, pixelWidth: Int, pixelHeight: Int,
                place: String? = nil, isFavorite: Bool = false) {
        self.id = id
        self.captureDate = captureDate
        self.pixelWidth = pixelWidth
        self.pixelHeight = pixelHeight
        self.place = place
        self.isFavorite = isFavorite
    }

    public var aspect: Double {
        pixelHeight > 0 ? Double(pixelWidth) / Double(pixelHeight) : 1
    }
}

/// What the user has allowed in the Photos Library.
public enum Access: String, Sendable, Hashable {
    case notDetermined, full, limited, denied, restricted
}

/// Where Photos come from. The rest of the app does not know which kind it is dealing with.
public protocol PhotoSource: Sendable {
    var kind: SourceKind { get }
    /// Photos captured in `[interval.start, interval.end)`, oldest first.
    func photos(in interval: DateInterval) async throws -> [Photo]
    /// Capture dates of every Photo, for listing Periods with counts.
    func captureDates() async throws -> [Date]
    /// An Image of at least `pixelSize` (aspect-filled), downloading the Original if needed.
    func image(for id: PhotoID, pixelSize: CGSize) async throws -> CGImage
}

public enum LibraryError: Error, CustomStringConvertible {
    case notFound(PhotoID)
    case noImage(PhotoID)
    case accessDenied

    public var description: String {
        switch self {
        case .notFound(let id): "Photo \(id) is no longer in its Source"
        case .noImage(let id): "No image for Photo \(id)"
        case .accessDenied: "Photo Album cannot read the Photos Library"
        }
    }
}
