import Foundation
import Testing
@testable import Usage

@Suite("Usage Log")
struct UsageLogTests {
    @Test("Signals are recorded in order with their date and month")
    func recordsInOrder() async throws {
        let clock = TestClock(date("2026-10-05T08:00:00Z"))
        let log = UsageLog(store: InMemoryUsageStore(), now: { clock.now }, timeZone: { utc })
        for (index, signal) in zip(0..., everySignal) {
            clock.set(date("2026-10-05T08:00:00Z").addingTimeInterval(Double(index) * 60))
            try await log.record(signal)
        }
        let entries = try await log.entries()
        #expect(entries.map(\.signal) == everySignal)
        #expect(entries.map(\.sequence) == Array(0..<everySignal.count))
        #expect(entries.last?.date == date("2026-10-05T08:00:00Z").addingTimeInterval(Double(everySignal.count - 1) * 60))
        #expect(Set(entries.map(\.month)) == [month("2026-10")])
    }

    @Test("The log persists to its own file and reloads")
    func persists() async throws {
        let dir = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let location = UsageLocation(root: dir)
        let first = UsageLog(store: FileUsageStore(location: location), now: { date("2026-10-05T08:00:00Z").addingTimeInterval(0.25) })
        for signal in everySignal { try await first.record(signal) }
        _ = try await first.shouldOfferQuickRating(for: collage(7))

        let second = UsageLog(store: FileUsageStore(location: location))
        #expect(try await second.entries() == first.entries())
        #expect(try await second.samplerState() == first.samplerState())
        #expect(location.logFile.path.hasSuffix("UsageLog/usage-log.json"))
        #expect(!location.logFile.path.contains("/usage/"))
    }

    @Test("An unreadable log is set aside and a fresh one starts")
    func unreadableLog() async throws {
        let dir = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = FileUsageStore(url: dir.appending(path: "usage-log.json"))
        try Data("not json".utf8).write(to: store.url)
        let log = UsageLog(store: store)
        #expect(try await log.entries().isEmpty)
        try await log.record(.bookStarted(format: .square))
        #expect(FileManager.default.fileExists(atPath: dir.appending(path: "usage-log.unreadable.json").path))
        #expect(try await UsageLog(store: store).entries().count == 1)
    }

    @Test("Reset erases the log, the sampler and the monthly reports, and nothing else")
    func reset() async throws {
        let dir = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let location = UsageLocation(root: dir)
        let other = location.reportsDirectory.appending(path: "notes.txt")
        let log = UsageLog(
            store: FileUsageStore(location: location),
            reportWriter: UsageReportWriter(directory: location.reportsDirectory, appVersion: "1.0"),
            now: { date("2026-10-05T08:00:00Z") }, timeZone: { utc })
        try await log.record(.templatePicked(collage: collage(1), variant: Fixtures.a, source: .search))
        try await log.record(.accepted(collage: collage(1), variant: Fixtures.a, optionalSlot: .none))
        try await log.recordQuickRatingDismissed(for: collage(1))
        try Data("keep me".utf8).write(to: other)
        #expect(try await log.preferences() != .none)

        try await log.reset()

        #expect(try await log.entries().isEmpty)
        #expect(try await log.preferences() == .none)
        #expect(try await log.samplerState() == QuickRatingSampler())
        #expect(!FileManager.default.fileExists(atPath: location.logFile.path))
        #expect(!FileManager.default.fileExists(atPath: location.reportFile(for: month("2026-10")).path))
        #expect(FileManager.default.fileExists(atPath: other.path))
        // A fresh log on the same files is empty too.
        #expect(try await UsageLog(store: FileUsageStore(location: location)).entries().isEmpty)
        // And recording works again.
        try await log.record(.bookStarted(format: .square))
        #expect(try await log.entries().map(\.sequence) == [0])
    }

    @Test("Recording from many tasks at once loses nothing")
    func concurrentRecording() async throws {
        let log = UsageLog(store: InMemoryUsageStore())
        try await withThrowingTaskGroup(of: Void.self) { group in
            for n in 0..<50 {
                group.addTask { try await log.record(.swapped(collage: collage(UInt8(n)), variant: Fixtures.a)) }
            }
            try await group.waitForAll()
        }
        let entries = try await log.entries()
        #expect(entries.count == 50)
        #expect(entries.map(\.sequence) == Array(0..<50))
    }
}

@Suite("Usage location")
struct UsageLocationTests {
    @Test("The standard location comes from FileManager's Application Support")
    func standard() throws {
        let location = try UsageLocation.standard()
        let support = try FileManager.default.url(
            for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: false)
        #expect(location.root == support.appending(path: "PhotoAlbum", directoryHint: .isDirectory))
        #expect(location.reportsDirectory.path.hasSuffix("Library/Application Support/PhotoAlbum/usage"))
        #expect(location.reportFile(for: month("2026-10")).lastPathComponent == "usage-2026-10.json")
        if UsageLocation.isSandboxed {
            #expect(location.root.path.contains("/Library/Containers/"))
        }
    }

    @Test("The routine's view of the sandboxed path")
    func containerPath() {
        let home = URL(filePath: "/Users/someone", directoryHint: .isDirectory)
        #expect(UsageLocation.containerReportsDirectory(bundleID: "com.example.photo-album", home: home).path
            == "/Users/someone/Library/Containers/com.example.photo-album/Data/Library/Application Support/PhotoAlbum/usage")
    }

    @Test("A user-picked reports folder replaces only the reports folder")
    func pickedFolder() {
        let root = URL(filePath: "/c/Application Support/PhotoAlbum", directoryHint: .isDirectory)
        let picked = URL(filePath: "/Users/someone/Documents/photo-album-usage", directoryHint: .isDirectory)
        let location = UsageLocation(root: root, reportsDirectory: picked)
        #expect(location.reportFile(for: month("2026-10")).path == "/Users/someone/Documents/photo-album-usage/usage-2026-10.json")
        #expect(location.logFile.path == "/c/Application Support/PhotoAlbum/UsageLog/usage-log.json")
    }
}
