import AppKit
import Photos

/// The user's System Photo Library, read through PhotoKit.
public final class PhotoKitSource: PhotoSource, @unchecked Sendable {
    // PHCachingImageManager is thread-safe; the class holds no other mutable state.
    private let thumbnails = PHCachingImageManager()

    public init() {}

    public var kind: SourceKind { .photosLibrary }

    // MARK: Access

    public static var access: Access { map(PHPhotoLibrary.authorizationStatus(for: .readWrite)) }

    /// Asks for read-write access. Returns at once when the user already decided.
    public static func requestAccess() async -> Access {
        map(await PHPhotoLibrary.requestAuthorization(for: .readWrite))
    }

    private static func map(_ status: PHAuthorizationStatus) -> Access {
        switch status {
        case .authorized: return .full
        case .denied: return .denied
        case .restricted: return .restricted
        case .notDetermined: return .notDetermined
        default:
            // `.limited` (raw value 4) is declared iOS-only in the SDK headers, but the user
            // can still limit an app to selected Photos; treat any other value that way.
            return status.rawValue == 4 ? .limited : .denied
        }
    }

    /// System Settings › Privacy & Security › Photos, where the user widens limited access.
    /// The limited-library picker is not available on macOS.
    public static let privacySettingsURL =
        URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Photos")!

    // MARK: Fetching

    private func fetchOptions(_ predicate: NSPredicate?) -> PHFetchOptions {
        let options = PHFetchOptions()
        let image = NSPredicate(format: "mediaType == %d", PHAssetMediaType.image.rawValue)
        options.predicate = predicate.map { NSCompoundPredicate(andPredicateWithSubpredicates: [image, $0]) } ?? image
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: true)]
        return options
    }

    public func captureDates() async throws -> [Date] {
        var dates: [Date] = []
        PHAsset.fetchAssets(with: fetchOptions(nil)).enumerateObjects { asset, _, _ in
            if let d = asset.creationDate { dates.append(d) }
        }
        return dates
    }

    public func photos(in interval: DateInterval) async throws -> [Photo] {
        let predicate = NSPredicate(format: "creationDate >= %@ AND creationDate < %@",
                                    interval.start as NSDate, interval.end as NSDate)
        var photos: [Photo] = []
        PHAsset.fetchAssets(with: fetchOptions(predicate)).enumerateObjects { asset, _, _ in
            photos.append(Photo(
                id: PhotoID(source: .photosLibrary, local: asset.localIdentifier),
                captureDate: asset.creationDate, pixelWidth: asset.pixelWidth,
                pixelHeight: asset.pixelHeight, isFavorite: asset.isFavorite))
        }
        return photos
    }

    private func asset(_ id: PhotoID) throws -> PHAsset {
        guard let a = PHAsset.fetchAssets(withLocalIdentifiers: [id.local], options: nil).firstObject else {
            throw LibraryError.notFound(id)
        }
        return a
    }

    // MARK: Images

    /// A full-quality Image sized for a Slot; downloads the iCloud Original if needed.
    public func image(for id: PhotoID, pixelSize: CGSize) async throws -> CGImage {
        let asset = try asset(id)
        let options = PHImageRequestOptions()
        options.deliveryMode = .highQualityFormat
        options.resizeMode = .exact
        options.isNetworkAccessAllowed = true
        options.isSynchronous = false
        return try await request(asset, size: pixelSize, options: options, manager: PHImageManager.default(), id: id)
    }

    /// A grid thumbnail, from the caching manager. Fast, may be degraded.
    public func thumbnail(for id: PhotoID, pixelSize: CGSize) async throws -> CGImage {
        let asset = try asset(id)
        let options = PHImageRequestOptions()
        options.deliveryMode = .opportunistic
        options.resizeMode = .fast
        options.isNetworkAccessAllowed = true
        return try await request(asset, size: pixelSize, options: options, manager: thumbnails, id: id, acceptDegraded: false)
    }

    private func request(_ asset: PHAsset, size: CGSize, options: PHImageRequestOptions,
                         manager: PHImageManager, id: PhotoID, acceptDegraded: Bool = false) async throws -> CGImage {
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<CGImage, Error>) in
            let once = ResumeOnce(cont)
            manager.requestImage(for: asset, targetSize: size, contentMode: .aspectFill, options: options) { image, info in
                if let error = info?[PHImageErrorKey] as? Error { return once.resume(throwing: error) }
                if (info?[PHImageCancelledKey] as? Bool) == true { return once.resume(throwing: CancellationError()) }
                let degraded = (info?[PHImageResultIsDegradedKey] as? Bool) == true
                if degraded && !acceptDegraded { return }
                guard let cg = image?.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
                    return once.resume(throwing: LibraryError.noImage(id))
                }
                once.resume(returning: cg)
            }
        }
    }
}

/// Resumes a continuation once; PhotoKit can call its handler more than once.
private final class ResumeOnce: @unchecked Sendable {
    private let lock = NSLock()
    private var cont: CheckedContinuation<CGImage, Error>?
    init(_ c: CheckedContinuation<CGImage, Error>) { cont = c }
    func resume(returning v: CGImage) { take()?.resume(returning: v) }
    func resume(throwing e: Error) { take()?.resume(throwing: e) }
    private func take() -> CheckedContinuation<CGImage, Error>? {
        lock.lock(); defer { lock.unlock() }
        let c = cont; cont = nil; return c
    }
}
