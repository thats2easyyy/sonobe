import SwiftUI

/// Sonobe Viewer plays the prototype open in Sonobe on your computer, full screen, with real haptics.
/// It loads the same web player as Preview on Phone (a WKWebView on the LAN preview URL) and adds a
/// native bridge the player uses for Haptic and Vibrate, and its menu for Open Another Prototype.
@main
struct SonobeViewerApp: App {
    @State private var model = ViewerModel()

    var body: some Scene {
        WindowGroup {
            RootView(model: model)
                .onOpenURL { model.open(deepLink: $0) }
        }
    }
}

struct RootView: View {
    @Bindable var model: ViewerModel
    @State private var reloads = 0

    var body: some View {
        if let url = model.playerURL {
            PlayerContainer(url: url, reloads: reloads, menuTipSeen: model.menuTipSeen, onAction: act, onFailure: { model.failure = $0 })
                .ignoresSafeArea()
                .background(Color.black)
                .statusBarHidden()
                .persistentSystemOverlays(.hidden)
                .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
                .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
                .overlay(alignment: .bottom) {
                    if let failure = model.failure {
                        FailureBanner(message: failure, retry: { model.failure = nil; reloads += 1 }, disconnect: { model.close() })
                    }
                }
        } else {
            ConnectView(model: model)
        }
    }

    /// The player's own menu (a three-finger tap) restarts and reloads by itself and asks the app for the rest.
    private func act(_ action: PlayerAction) {
        switch action {
        case .openAnother: model.close()
        case .menuTipSeen: model.menuTipSeen = true
        }
    }
}

private struct FailureBanner: View {
    let message: String
    let retry: () -> Void
    let disconnect: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(message).font(.callout)
            HStack {
                Button("Try Again", action: retry).buttonStyle(.borderedProminent)
                Button("Disconnect", action: disconnect).buttonStyle(.bordered)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .padding(16)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("failure")
    }
}
