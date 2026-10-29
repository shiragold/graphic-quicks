import Catalog
import CoreGraphics
import Foundation
import ImageIO
import Rendering
import UniformTypeIdentifiers

/// An Export Format (the user's decision: PNG or PDF).
public enum ExportFormat: String, CaseIterable, Sendable {
    case png, pdf
    public var fileExtension: String { rawValue }
    public var contentType: UTType { self == .png ? .png : .pdf }
}

/// Writes Renders to files.
public enum Exporter {
    /// The default Resolution.
    public static let defaultDPI: Double = 300

    /// One Collage as a PNG at `dpi`, in Display P3 with DPI metadata.
    public static func writePNG(_ scene: RenderScene, to url: URL, dpi: Double = defaultDPI) throws {
        let size = scene.template.format.outputSize(dpi: dpi)
        let image = try CollageRenderer().image(scene, pixelSize: size)
        guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
            throw ExportError.cannotWrite(url)
        }
        let props: [CFString: Any] = [kCGImagePropertyDPIWidth: dpi, kCGImagePropertyDPIHeight: dpi]
        CGImageDestinationAddImage(dest, image, props as CFDictionary)
        guard CGImageDestinationFinalize(dest) else { throw ExportError.cannotWrite(url) }
    }

    /// One Collage per page, at print size. Decorations and text stay vector.
    public static func writePDF(_ scenes: [RenderScene], to url: URL, title: String? = nil) throws {
        guard let first = scenes.first else { throw ExportError.nothingToExport }
        var box = CGRect(origin: .zero, size: first.template.format.printPoints)
        var info: [CFString: Any] = [kCGPDFContextCreator: "Photo Album"]
        if let title { info[kCGPDFContextTitle] = title }
        guard let ctx = CGContext(url as CFURL, mediaBox: &box, info as CFDictionary) else {
            throw ExportError.cannotWrite(url)
        }
        let renderer = CollageRenderer()
        for scene in scenes {
            var page = CGRect(origin: .zero, size: scene.template.format.printPoints)
            let pageInfo = [kCGPDFContextMediaBox: Data(bytes: &page, count: MemoryLayout<CGRect>.size)] as CFDictionary
            ctx.beginPDFPage(pageInfo)
            renderer.draw(scene, in: ctx, size: page.size)
            ctx.endPDFPage()
        }
        ctx.closePDF()
    }
}

public enum ExportError: Error, CustomStringConvertible {
    case cannotWrite(URL)
    case nothingToExport

    public var description: String {
        switch self {
        case .cannotWrite(let u): "Cannot write \(u.lastPathComponent)"
        case .nothingToExport: "There is nothing to export"
        }
    }
}
