import SwiftUI
import UI

@main
struct PhotoAlbumApp: App {
    @State private var model = AppModel(
        themesDirectory: Bundle.main.resourceURL!.appending(path: "themes"),
        appVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0")

    var body: some Scene {
        Window("Photo Album", id: "main") {
            RootView(model: model)
                .frame(minWidth: 900, minHeight: 640)
                .task {
                    if let month = SmokeRun.requestedMonth { await SmokeRun.run(model, month: month) }
                }
        }
        .defaultSize(width: 1200, height: 820)
    }
}
