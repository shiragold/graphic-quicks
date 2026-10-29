import Foundation
import Synchronization

/// Everything the Usage Log persists: the signals and the Quick Rating sampler's state.
public struct UsageLogSnapshot: Hashable, Codable, Sendable {
    public static let currentVersion = 1

    public var version: Int
    public var entries: [UsageEntry]
    public var sampler: QuickRatingSampler

    public init(entries: [UsageEntry] = [], sampler: QuickRatingSampler = QuickRatingSampler()) {
        self.version = Self.currentVersion
        self.entries = entries
        self.sampler = sampler
    }
}

/// The Usage Log's own store, separate from Books.
public protocol UsageStore: Sendable {
    /// The saved snapshot, or `nil` when nothing was saved yet.
    func load() throws -> UsageLogSnapshot?
    func save(_ snapshot: UsageLogSnapshot) throws
    func erase() throws
}

/// A single JSON file, rewritten atomically on every save. A Usage Log holds a few thousand
/// small signals at most, so this stays well under a megabyte and needs no database.
public struct FileUsageStore: UsageStore {
    public let url: URL

    public init(url: URL) {
        self.url = url
    }

    public func load() throws -> UsageLogSnapshot? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        do {
            return try JSONDecoder().decode(UsageLogSnapshot.self, from: data)
        } catch {
            // Never lose the user's app over usage data: set the unreadable file aside and
            // start a fresh log.
            let aside = url.deletingPathExtension().appendingPathExtension("unreadable.json")
            try? FileManager.default.removeItem(at: aside)
            try FileManager.default.moveItem(at: url, to: aside)
            return nil
        }
    }

    public func save(_ snapshot: UsageLogSnapshot) throws {
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        try encoder.encode(snapshot).write(to: url, options: [.atomic])
    }

    public func erase() throws {
        let manager = FileManager.default
        for file in [url, url.deletingPathExtension().appendingPathExtension("unreadable.json")]
        where manager.fileExists(atPath: file.path) {
            try manager.removeItem(at: file)
        }
    }
}

extension FileUsageStore {
    public init(location: UsageLocation) {
        self.init(url: location.logFile)
    }
}

/// For tests and previews.
public final class InMemoryUsageStore: UsageStore {
    private let state: Mutex<UsageLogSnapshot?>

    public init(_ snapshot: UsageLogSnapshot? = nil) {
        state = Mutex(snapshot)
    }

    public func load() throws -> UsageLogSnapshot? { state.withLock { $0 } }
    public func save(_ snapshot: UsageLogSnapshot) throws { state.withLock { $0 = snapshot } }
    public func erase() throws { state.withLock { $0 = nil } }
}
