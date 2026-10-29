import Foundation

/// Where Usage data lives on disk.
///
/// Everything sits under the app's Application Support folder, resolved through
/// `FileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)`. In the
/// sandboxed app that call returns the container's folder, so the real paths are:
///
/// ```
/// ~/Library/Containers/<bundle-id>/Data/Library/Application Support/PhotoAlbum/
///   UsageLog/usage-log.json      the Usage Log (raw signals; never read by the routine)
///   usage/usage-YYYY-MM.json     the monthly Usage Reports (read by the monthly routine)
/// ```
///
/// Outside the sandbox (`swift test`, a debug build without the entitlement) the same code
/// resolves to `~/Library/Application Support/PhotoAlbum/`. The routine must read the
/// container path, not that one.
///
/// If the user picks a folder for the reports (the fallback in docs/06, for when reading the
/// container is not approved), pass it as `reportsDirectory`. The app owns the
/// security-scoped bookmark and must call `startAccessingSecurityScopedResource()` around
/// writes. The Usage Log itself always stays in the container.
public struct UsageLocation: Hashable, Sendable {
    /// The folder name inside Application Support.
    public static let defaultAppFolderName = "PhotoAlbum"
    /// The reports folder name the routine looks for.
    public static let reportsFolderName = "usage"

    /// `…/Application Support/PhotoAlbum`.
    public let root: URL
    /// Where `usage-YYYY-MM.json` files go. `root/usage` unless the user picked a folder.
    public let reportsDirectory: URL

    public init(root: URL, reportsDirectory: URL? = nil) {
        self.root = root
        self.reportsDirectory = reportsDirectory
            ?? root.appending(path: Self.reportsFolderName, directoryHint: .isDirectory)
    }

    /// The standard location, through `FileManager`'s Application Support URL (sandbox-aware).
    /// Creates nothing.
    public static func standard(
        fileManager: FileManager = .default,
        appFolderName: String = defaultAppFolderName,
        reportsDirectory: URL? = nil
    ) throws -> UsageLocation {
        let support = try fileManager.url(
            for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: false)
        return UsageLocation(
            root: support.appending(path: appFolderName, directoryHint: .isDirectory),
            reportsDirectory: reportsDirectory)
    }

    /// The Usage Log file, kept apart from the reports folder and from Books.
    public var logFile: URL {
        root.appending(path: "UsageLog", directoryHint: .isDirectory)
            .appending(path: "usage-log.json", directoryHint: .notDirectory)
    }

    public func reportFile(for month: UsageMonth) -> URL {
        reportsDirectory.appending(path: month.reportFileName, directoryHint: .notDirectory)
    }

    /// True inside the App Sandbox (the system sets this variable for sandboxed processes).
    public static var isSandboxed: Bool {
        ProcessInfo.processInfo.environment["APP_SANDBOX_CONTAINER_ID"] != nil
    }

    /// The reports folder as the monthly routine sees it from outside the app, for a given
    /// bundle ID: `~/Library/Containers/<bundle-id>/Data/Library/Application Support/PhotoAlbum/usage`.
    public static func containerReportsDirectory(
        bundleID: String, home: URL = FileManager.default.homeDirectoryForCurrentUser,
        appFolderName: String = defaultAppFolderName
    ) -> URL {
        home.appending(path: "Library/Containers/\(bundleID)/Data/Library/Application Support", directoryHint: .isDirectory)
            .appending(path: appFolderName, directoryHint: .isDirectory)
            .appending(path: reportsFolderName, directoryHint: .isDirectory)
    }
}
