import XCTest

/// The viewer against a real preview server. `npm run test:ios` (apps/ios/scripts/test.mjs) serves the
/// Haptic Check prototype and passes its URL as SONOBE_PLAYER_URL; the tests that need it skip without
/// it. The haptics the taps play are logged under subsystem dev.sonobe.viewer, which the script checks.
final class ViewerUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private func playerURL() throws -> String {
        guard let url = ProcessInfo.processInfo.environment["SONOBE_PLAYER_URL"], !url.isEmpty else {
            throw XCTSkip("No preview server. Run npm run test:ios, or set TEST_RUNNER_SONOBE_PLAYER_URL for xcodebuild.")
        }
        return url
    }

    func testExplainsALinkThatIsntAPreview() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.navigationBars["Sonobe Viewer"].waitForExistence(timeout: 10), "the connect screen didn't appear")

        let field = app.textFields["previewLink"]
        field.tap()
        field.typeText("https://example.com\n")
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH %@", "That isn't a Sonobe preview link")).firstMatch.waitForExistence(timeout: 5), "no explanation for a link that isn't a preview")
        XCTAssertFalse(app.webViews.firstMatch.exists)
    }

    func testTapsReachThePrototype() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SonobePlayerURL", try playerURL()]
        app.launch()

        let web = app.webViews.firstMatch
        XCTAssertTrue(web.waitForExistence(timeout: 15), "the player's web view didn't appear")
        XCTAssertTrue(web.staticTexts["0"].waitForExistence(timeout: 15), "the prototype didn't draw its tap count")

        for _ in 0..<3 {
            web.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.7)).tap()
        }
        XCTAssertTrue(web.staticTexts["3"].waitForExistence(timeout: 5), "three taps didn't reach the prototype")
    }

    /// sonobe-viewer://open?url=<preview link>, what a QR code for the app carries, opens the preview.
    func testDeepLinkOpensThePreview() throws {
        let link = try playerURL()
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.navigationBars["Sonobe Viewer"].waitForExistence(timeout: 10), "the connect screen didn't appear")

        var parts = URLComponents(string: "sonobe-viewer://open")!
        parts.queryItems = [URLQueryItem(name: "url", value: link)]
        app.open(parts.url!)
        let confirm = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons["Open"]
        if confirm.waitForExistence(timeout: 3) { confirm.tap() }

        XCTAssertTrue(app.webViews.firstMatch.staticTexts["0"].waitForExistence(timeout: 15), "the deep link didn't open the preview")
    }

    /// The server only knows the token of the current session, so an old link explains what to do.
    func testExplainsAnExpiredLink() throws {
        let current = try XCTUnwrap(URL(string: try playerURL()))
        let expired = current.deletingLastPathComponent().appendingPathComponent("expired-token", isDirectory: true)
        let app = XCUIApplication()
        app.launchArguments = ["-SonobePlayerURL", expired.absoluteString]
        app.launch()

        let banner = app.otherElements["failure"]
        XCTAssertTrue(banner.waitForExistence(timeout: 15), "no failure banner for an expired link")
        XCTAssertTrue(banner.staticTexts.containing(NSPredicate(format: "label BEGINSWITH %@", "This preview link has expired")).firstMatch.exists)
        banner.buttons["Disconnect"].tap()
        XCTAssertTrue(app.navigationBars["Sonobe Viewer"].waitForExistence(timeout: 5), "Disconnect didn't return to the connect screen")
    }
}
