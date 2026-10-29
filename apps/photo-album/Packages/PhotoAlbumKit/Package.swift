// swift-tools-version: 6.2
import PackageDescription

// Module names and dependency direction follow research/jargon.md ("Bounded contexts").
let package = Package(
    name: "PhotoAlbumKit",
    platforms: [.macOS(.v26)],
    products: [
        .library(name: "Catalog", targets: ["Catalog"]),
        .library(name: "Library", targets: ["Library"]),
        .library(name: "Grouping", targets: ["Grouping"]),
        .library(name: "Insights", targets: ["Insights"]),
        .library(name: "Composition", targets: ["Composition"]),
        .library(name: "Suggestion", targets: ["Suggestion"]),
        .library(name: "Rendering", targets: ["Rendering"]),
        .library(name: "Export", targets: ["Export"]),
        .library(name: "Usage", targets: ["Usage"]),
        .library(name: "UI", targets: ["UI"]),
        .executable(name: "parity", targets: ["Parity"]),
    ],
    targets: [
        // Themes and Templates: Codable models, Tokens, Page Format overrides, Optional Slots.
        .target(name: "Catalog"),
        // Access to Photos from a Source (PhotoKit for now).
        .target(name: "Library"),
        // Periods and the transient Group.
        .target(name: "Grouping", dependencies: ["Library"]),
        // What the app knows about a Photo's content. A centre-focus stub for now.
        .target(name: "Insights", dependencies: ["Library"]),
        // The Book aggregate: Book Photos, Excluded, Collages, Placements and Fits.
        .target(name: "Composition", dependencies: ["Catalog", "Library", "Insights"]),
        // Template Suggestion, the Matcher and the Fit Suggestion.
        .target(name: "Suggestion", dependencies: ["Catalog", "Library", "Insights", "Composition"]),
        // One Core Graphics renderer for preview and export.
        .target(name: "Rendering", dependencies: ["Catalog", "Composition"]),
        // PNG and PDF writers.
        .target(name: "Export", dependencies: ["Rendering", "Catalog"]),
        // The local record of the user's own choices (research/jargon.md, "Usage").
        .target(name: "Usage"),
        // SwiftUI feature views per flow step.
        .target(name: "UI", dependencies: [
            "Catalog", "Library", "Grouping", "Insights", "Composition", "Suggestion",
            "Rendering", "Export", "Usage",
        ]),
        // Renders every Template × Page Format with stand-in photos for the parity check.
        .executableTarget(name: "Parity", dependencies: ["Catalog", "Composition", "Insights", "Suggestion", "Rendering", "Export"]),
        .testTarget(
            name: "UsageTests",
            dependencies: ["Usage"],
            resources: [.copy("Fixtures")]),
        .testTarget(name: "CatalogTests", dependencies: ["Catalog"]),
        .testTarget(
            name: "RenderingTests",
            dependencies: ["Catalog", "Composition", "Insights", "Suggestion", "Rendering", "Export", "Grouping", "Library"]),
    ],
    swiftLanguageModes: [.v6]
)
