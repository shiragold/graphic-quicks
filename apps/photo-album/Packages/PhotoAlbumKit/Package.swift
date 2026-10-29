// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "PhotoAlbumKit",
    platforms: [.macOS(.v26)],
    products: [
        .library(name: "Usage", targets: ["Usage"]),
        .library(name: "UI", targets: ["UI"]),
    ],
    targets: [
        // The local record of the user's own choices (research/jargon.md, "Usage").
        .target(name: "Usage"),
        // SwiftUI feature views. For now only the Quick Rating control.
        .target(name: "UI", dependencies: ["Usage"]),
        .testTarget(
            name: "UsageTests",
            dependencies: ["Usage"],
            resources: [.copy("Fixtures")]),
    ],
    swiftLanguageModes: [.v6]
)
