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
