import Foundation

/// Writes `usage-YYYY-MM.json` files into one folder.
public struct UsageReportWriter: Sendable {
    public let directory: URL
    public let appVersion: String

    public init(directory: URL, appVersion: String) {
        self.directory = directory
        self.appVersion = appVersion
    }

    public func url(for month: UsageMonth) -> URL {
        directory.appending(path: month.reportFileName, directoryHint: .notDirectory)
    }

    public func write(_ report: UsageReport) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try report.encoded().write(to: url(for: report.period), options: [.atomic])
    }

    /// Deletes every `usage-YYYY-MM.json` in the folder and nothing else (the folder may be
    /// one the user picked).
    public func removeAll() throws {
        let manager = FileManager.default
        guard let names = try? manager.contentsOfDirectory(atPath: directory.path) else { return }
        for name in names where Self.isReportFileName(name) {
            try manager.removeItem(at: directory.appending(path: name, directoryHint: .notDirectory))
        }
    }

    static func isReportFileName(_ name: String) -> Bool {
        guard name.hasPrefix("usage-"), name.hasSuffix(".json") else { return false }
        return UsageMonth(String(name.dropFirst("usage-".count).dropLast(".json".count))) != nil
    }
}

/// The local store of Usage Signals on this Mac (research/jargon.md, "Usage Log").
///
/// Recording a signal saves the log and rewrites the Usage Report of every month the signal
/// affects, so the monthly files are always current; there is no export step.
public actor UsageLog {
    private let store: any UsageStore
    private let reportWriter: UsageReportWriter?
    private let now: @Sendable () -> Date
    private let timeZone: @Sendable () -> TimeZone
    private var cached: UsageLogSnapshot?

    /// - Parameters:
    ///   - store: the Usage Log's own store.
    ///   - reportWriter: where monthly reports go; `nil` writes none (tests, previews).
    ///   - now, timeZone: injected for tests. A signal's month is taken in `timeZone()` at the
    ///     moment it is recorded.
    public init(
        store: any UsageStore,
        reportWriter: UsageReportWriter? = nil,
        now: @escaping @Sendable () -> Date = { Date() },
        timeZone: @escaping @Sendable () -> TimeZone = { .current }
    ) {
        self.store = store
        self.reportWriter = reportWriter
        self.now = now
        self.timeZone = timeZone
    }

    /// The app's log at the standard, sandbox-aware location (see `UsageLocation`).
    public static func standard(appVersion: String, reportsDirectory: URL? = nil) throws -> UsageLog {
        let location = try UsageLocation.standard(reportsDirectory: reportsDirectory)
        return UsageLog(
            store: FileUsageStore(location: location),
            reportWriter: UsageReportWriter(directory: location.reportsDirectory, appVersion: appVersion))
    }

    // MARK: Recording

    /// Records one Usage Signal.
    public func record(_ signal: UsageSignal) throws {
        var snapshot = try loaded()
        let date = now()
        let entry = UsageEntry(
            sequence: (snapshot.entries.last?.sequence ?? -1) + 1,
            date: date,
            month: UsageMonth(containing: date, in: timeZone()),
            signal: signal)
        let affected = affectedMonths(by: entry, in: snapshot.entries)
        snapshot.entries.append(entry)
        try save(snapshot)
        try writeReports(for: affected, entries: snapshot.entries)
    }

    /// All recorded signals, oldest first.
    public func entries() throws -> [UsageEntry] {
        try loaded().entries
    }

    // MARK: Quick Rating

    /// Whether to show the Quick Rating over `collage`. Call once, when the Collage first
    /// appears on the results screen; later calls for the same Collage return `false`.
    public func shouldOfferQuickRating(for collage: CollageRef) throws -> Bool {
        var snapshot = try loaded()
        let offer = snapshot.sampler.shouldOffer(collage)
        try save(snapshot)
        return offer
    }

    /// The user tapped 👍 or 👎.
    public func recordQuickRating(_ rating: QuickRating, for collage: CollageRef, variant: Variant) throws {
        var snapshot = try loaded()
        snapshot.sampler.recordRating()
        try save(snapshot)
        try record(.quickRated(collage: collage, variant: variant, rating: rating))
    }

    /// The user closed the Quick Rating without rating. Future offers back off.
    public func recordQuickRatingDismissed(for collage: CollageRef) throws {
        var snapshot = try loaded()
        snapshot.sampler.recordDismissal()
        try save(snapshot)
        try record(.quickRatingDismissed(collage: collage))
    }

    public func samplerState() throws -> QuickRatingSampler {
        try loaded().sampler
    }

    // MARK: Reading

    /// Months that have at least one signal.
    public func months() throws -> [UsageMonth] {
        Set(try loaded().entries.map(\.month)).sorted()
    }

    public func report(for month: UsageMonth) throws -> UsageReport {
        UsageReport.aggregate(try loaded().entries, month: month, appVersion: reportWriter?.appVersion ?? "")
    }

    /// Rewrites every month's report, e.g. after the user picks a new reports folder.
    public func writeAllReports() throws {
        let entries = try loaded().entries
        try writeReports(for: Set(entries.map(\.month)), entries: entries)
    }

    /// Preferences for Suggestion, derived from the whole log.
    public func preferences() throws -> Preferences {
        Preferences.derive(from: try loaded().entries)
    }

    // MARK: Reset

    /// "Reset usage data": erases the Usage Log, the Quick Rating sampler's state and every
    /// monthly report. Preferences return to `.none`.
    public func reset() throws {
        try store.erase()
        try reportWriter?.removeAll()
        cached = UsageLogSnapshot()
    }

    // MARK: Private

    private func loaded() throws -> UsageLogSnapshot {
        if let cached { return cached }
        let snapshot = try store.load() ?? UsageLogSnapshot()
        cached = snapshot
        return snapshot
    }

    private func save(_ snapshot: UsageLogSnapshot) throws {
        try store.save(snapshot)
        cached = snapshot
    }

    /// The new signal's month, plus the months of the Collage's earlier keeps:
    /// Change Template, Remove Collage or a new keep can take "kept" away from them.
    private func affectedMonths(by entry: UsageEntry, in entries: [UsageEntry]) -> Set<UsageMonth> {
        var months: Set<UsageMonth> = [entry.month]
        guard let collage = entry.signal.collage else { return months }
        switch entry.signal.kind {
        case .templateChanged, .collageRemoved, .accepted, .exported:
            for earlier in entries where earlier.signal.collage == collage {
                switch earlier.signal.kind {
                case .accepted, .exported: months.insert(earlier.month)
                default: break
                }
            }
        default:
            break
        }
        return months
    }

    private func writeReports(for months: Set<UsageMonth>, entries: [UsageEntry]) throws {
        guard let reportWriter else { return }
        for month in months.sorted() {
            try reportWriter.write(UsageReport.aggregate(entries, month: month, appVersion: reportWriter.appVersion))
        }
    }
}
