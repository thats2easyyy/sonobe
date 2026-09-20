import Foundation
import Testing
@testable import SonobeViewer

struct PreviewLinkTests {
    @Test(arguments: [
        ("http://192.168.1.20:52345/p/AbC_d-9/", "http://192.168.1.20:52345/p/AbC_d-9/"),
        ("http://192.168.1.20:52345/p/AbC_d-9", "http://192.168.1.20:52345/p/AbC_d-9/"),
        ("  https://mac.local:8443/p/token/?from=qr#top \n", "https://mac.local:8443/p/token/"),
        ("sonobe-viewer://open?url=http://192.168.1.20:52345/p/token/", "http://192.168.1.20:52345/p/token/"),
        ("sonobe-viewer://open?url=http%3A%2F%2F192.168.1.20%3A52345%2Fp%2Ftoken%2F", "http://192.168.1.20:52345/p/token/"),
    ])
    func acceptsPreviewLinks(text: String, expected: String) {
        #expect(ViewerModel.playerURL(from: text)?.absoluteString == expected)
    }

    @Test(arguments: [
        "",
        "192.168.1.20:52345/p/token/",
        "ftp://192.168.1.20/p/token/",
        "http:///p/token/",
        "http://192.168.1.20:52345/",
        "http://192.168.1.20:52345/p/",
        "http://192.168.1.20:52345/p/token/player.js",
        "http://192.168.1.20:52345/x/token/",
        "http://192.168.1.20:52345/p/to%20ken/",
        "javascript:alert(1)",
        "sonobe-viewer://open",
        "sonobe-viewer://other?url=http://192.168.1.20:52345/p/token/",
        "sonobe-viewer://open?url=sonobe-viewer://open?url=http://192.168.1.20:52345/p/token/",
    ])
    func rejectsOtherLinks(text: String) {
        #expect(ViewerModel.playerURL(from: text) == nil)
    }

    /// Preview on Phone serves on this network, so only a link elsewhere (a tunnel, or someone else's page) asks first.
    @Test(arguments: [
        ("http://192.168.1.20:52345/p/token/", true),
        ("http://10.0.0.5:52345/p/token/", true),
        ("http://172.20.1.1:52345/p/token/", true),
        ("http://127.0.0.1:52999/p/token/", true),
        ("http://169.254.10.1:52345/p/token/", true),
        ("http://100.101.102.103:52345/p/token/", true),
        ("https://mac.local:8443/p/token/", true),
        ("http://macbook:52345/p/token/", true),
        ("https://evil.example/p/abc/", false),
        ("https://www.instagram.com/p/abc/", false),
        ("sonobe-viewer://open?url=https%3A%2F%2Fattacker.github.io%2Fp%2Fx", false),
        ("http://8.8.8.8:52345/p/token/", false),
        ("http://172.32.0.1:52345/p/token/", false),
        ("http://192.168.1.20.evil.example/p/token/", false),
        ("http://192.168.1.300/p/token/", false),
    ])
    func knowsTheLocalNetwork(text: String, local: Bool) throws {
        #expect(ViewerModel.isLocalNetwork(try #require(ViewerModel.playerURL(from: text))) == local)
    }

    @MainActor
    @Test func asksBeforeOpeningALinkOffTheLocalNetwork() throws {
        let defaults = try #require(UserDefaults(suiteName: "OffNetworkTests"))
        defaults.removePersistentDomain(forName: "OffNetworkTests")
        let model = ViewerModel(defaults: defaults)
        model.open(text: "http://192.168.1.20:52345/p/token/")
        let playing = model.playerURL

        model.open(deepLink: try #require(URL(string: "sonobe-viewer://open?url=https://evil.example/p/abc/")))
        #expect(model.pendingLink?.absoluteString == "https://evil.example/p/abc/")
        #expect(model.playerURL == playing)
        #expect(model.inputError == nil)
        model.cancelPendingLink()
        #expect(model.pendingLink == nil)
        #expect(model.playerURL == playing)
        #expect(ViewerModel(defaults: defaults).recent == playing)

        model.open(text: "https://tunnel.example/p/abc")
        model.confirmPendingLink(try #require(model.pendingLink))
        #expect(model.pendingLink == nil)
        #expect(model.playerURL?.absoluteString == "https://tunnel.example/p/abc/")
        #expect(ViewerModel(defaults: defaults).recent == model.playerURL)
    }

    @MainActor
    @Test func explainsALinkThatIsntAPreview() throws {
        let defaults = try #require(UserDefaults(suiteName: "PreviewLinkTests"))
        defaults.removePersistentDomain(forName: "PreviewLinkTests")
        let model = ViewerModel(defaults: defaults)
        model.open(text: "https://example.com")
        #expect(model.playerURL == nil)
        #expect(model.inputError == ViewerModel.notAPreviewLink)

        model.open(text: "http://192.168.1.20:52345/p/token")
        #expect(model.playerURL?.absoluteString == "http://192.168.1.20:52345/p/token/")
        #expect(model.inputError == nil)
        #expect(ViewerModel(defaults: defaults).recent == model.playerURL)
    }

    @MainActor
    @Test func remembersThatThePlayerTaughtItsMenu() throws {
        let defaults = try #require(UserDefaults(suiteName: "MenuTipTests"))
        defaults.removePersistentDomain(forName: "MenuTipTests")
        let model = ViewerModel(defaults: defaults)
        #expect(model.menuTipSeen == false)
        model.menuTipSeen = true
        #expect(ViewerModel(defaults: defaults).menuTipSeen == true)
    }
}
