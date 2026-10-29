import Foundation

/// Saves each Book as one JSON file. The minimal persistence for the walking skeleton; the
/// tech-stack doc plans SwiftData.
public struct BookStore: Sendable {
    public let directory: URL

    public init(directory: URL) {
        self.directory = directory
    }

    /// `Application Support/PhotoAlbum/Books` (inside the sandbox container in the app).
    public static func standard(appFolderName: String = "PhotoAlbum") throws -> BookStore {
        let base = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                               appropriateFor: nil, create: true)
        return BookStore(directory: base.appending(path: appFolderName).appending(path: "Books"))
    }

    public func load() throws -> [Book] {
        let fm = FileManager.default
        guard fm.fileExists(atPath: directory.path) else { return [] }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try fm.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "json" }
            .compactMap { try? decoder.decode(Book.self, from: Data(contentsOf: $0)) }
            .sorted { $0.created > $1.created }
    }

    public func save(_ book: Book) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(book).write(to: directory.appending(path: "\(book.id.uuidString).json"), options: .atomic)
    }

    public func delete(_ id: UUID) throws {
        try FileManager.default.removeItem(at: directory.appending(path: "\(id.uuidString).json"))
    }
}
