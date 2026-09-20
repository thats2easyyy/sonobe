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

    /// A three-finger tap opens the web player's menu without reaching the prototype (the tap count stays
    /// put), Restart Prototype starts it over, and Open Another Prototype goes back to the connect screen.
    /// The script checks the log: one Impact Medium (the single tap; three three-finger taps play none), and
    /// Notification Success again after Restart.
    func testThreeFingerTapOpensTheMenu() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-SonobePlayerURL", try playerURL(), "-menuTipSeen", "NO"]
        app.launch()

        let web = app.webViews.firstMatch
        XCTAssertTrue(web.staticTexts["0"].waitForExistence(timeout: 15), "the prototype didn't draw its tap count")
        XCTAssertTrue(web.staticTexts["Tap with three fingers for the menu"].waitForExistence(timeout: 5), "the player didn't teach its menu")
        web.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.7)).tap()
        XCTAssertTrue(web.staticTexts["1"].waitForExistence(timeout: 5), "a tap didn't reach the prototype")

        // Aimed at the count: XCUITest can't find a hit point for the whole web view.
        web.staticTexts["1"].tap(withNumberOfTaps: 1, numberOfTouches: 3)
        let cancel = web.buttons["Cancel"]
        XCTAssertTrue(cancel.waitForExistence(timeout: 5), "a three-finger tap didn't open the menu")
        XCTAssertTrue(web.buttons["Restart Prototype"].exists)
        XCTAssertTrue(web.buttons["Open Another Prototype"].exists)
        // The open menu is a modal dialog, which hides the page from accessibility: read the count after closing it.
        cancel.tap()
        XCTAssertTrue(web.staticTexts["1"].waitForExistence(timeout: 5), "the three-finger tap reached the prototype")

        web.staticTexts["1"].tap(withNumberOfTaps: 1, numberOfTouches: 3)
        let restart = web.buttons["Restart Prototype"]
        XCTAssertTrue(restart.waitForExistence(timeout: 5), "the menu didn't open again")
        restart.tap()
        XCTAssertTrue(web.staticTexts["0"].waitForExistence(timeout: 5), "Restart Prototype didn't start the prototype over")

        web.staticTexts["0"].tap(withNumberOfTaps: 1, numberOfTouches: 3)
        let another = web.buttons["Open Another Prototype"]
        XCTAssertTrue(another.waitForExistence(timeout: 5), "the menu didn't open again")
        another.tap()
        XCTAssertTrue(app.navigationBars["Sonobe Viewer"].waitForExistence(timeout: 5), "Open Another Prototype didn't return to the connect screen")
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
