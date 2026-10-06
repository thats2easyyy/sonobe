import SwiftUI
import WebKit

/// What the player's menu (a three-finger tap in the page) asks of the app through the bridge.
enum PlayerAction {
    case openAnother
    case menuTipSeen
}

/// The LAN web player in a full-screen WKWebView, pinned to the preview's origin, with the haptics bridge.
/// An http:// preview loads through PlayerProxy, so the page can use the camera, the microphone,
/// location and device motion.
struct PlayerContainer: UIViewControllerRepresentable {
    let url: URL
    let reloads: Int
    /// The player already taught its three-finger menu in this app, so the page skips the tip.
    let menuTipSeen: Bool
    let onAction: (PlayerAction) -> Void
    let onFailure: (String) -> Void

    func makeUIViewController(context: Context) -> PlayerViewController {
        PlayerViewController(url: url, menuTipSeen: menuTipSeen, onAction: onAction, onFailure: onFailure)
    }

    func updateUIViewController(_ controller: PlayerViewController, context: Context) {
        controller.onAction = onAction
        controller.onFailure = onFailure
        if controller.url != url { controller.load(url) }
        if controller.reloads != reloads {
            controller.reloads = reloads
            controller.reload()
        }
    }
}

final class PlayerViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private(set) var url: URL
    var reloads = 0
    var onAction: (PlayerAction) -> Void
    var onFailure: (String) -> Void
    private let menuTipSeen: Bool
    private let haptics = Haptics()
    private let proxy = PlayerProxy()
    private var webView: WKWebView!
    /// The address the web view shows for `url` (PlayerAddress).
    private var page: URL { PlayerAddress.page(for: url) }

    static let expiredLink = "This preview link has expired. Sonobe makes a new link each time Preview on Phone starts, so scan the code it shows now."

    init(url: URL, menuTipSeen: Bool, onAction: @escaping (PlayerAction) -> Void, onFailure: @escaping (String) -> Void) {
        self.url = url
        self.menuTipSeen = menuTipSeen
        self.onAction = onAction
        self.onFailure = onFailure
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    deinit { proxy.stop() }

    override func loadView() {
        let content = WKUserContentController()
        content.addUserScript(WKUserScript(source: haptics.announcementScript(menuTipSeen: menuTipSeen), injectionTime: .atDocumentStart, forMainFrameOnly: true))
        content.add(MessageRelay { [weak self] message in self?.received(message) }, name: "sonobe")

        let config = WKWebViewConfiguration()
        config.userContentController = content
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.websiteDataStore = .nonPersistent()
        config.setURLSchemeHandler(proxy, forURLScheme: PlayerAddress.scheme)
        proxy.onExpired = { [weak self] in self?.expired() }

        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsLinkPreview = false
        web.allowsBackForwardNavigationGestures = false
        web.isOpaque = false
        web.backgroundColor = .black
        web.scrollView.isScrollEnabled = false
        web.scrollView.bounces = false
        web.scrollView.contentInsetAdjustmentBehavior = .never
        #if DEBUG
        web.isInspectable = true
        #endif
        webView = web
        view = web
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        haptics.prepare()
        load(url)
    }

    // The menu is the web player's own (a three-finger tap): shaking belongs to Device Motion prototypes.
    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { .all }

    func load(_ next: URL) {
        Haptics.log.info("load \(next.absoluteString, privacy: .public)")
        url = next
        reload()
    }

    func reload() {
        proxy.preview = url
        webView.load(URLRequest(url: page))
    }

    /// Only the player page itself, on the preview's origin, reaches the haptics and the menu's actions.
    private func received(_ message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, Self.sameOrigin(message.frameInfo.securityOrigin, page) else { return }
        guard let bridged = Haptics.message(from: message.body) else {
            Haptics.log.info("ignored a message the player sent")
            return
        }
        switch bridged {
        case .openAnother:
            Haptics.log.info("menu openAnother")
            onAction(.openAnother)
        case .menuTipSeen:
            Haptics.log.info("menu tipSeen")
            onAction(.menuTipSeen)
        default:
            haptics.play(bridged)
        }
    }

    private static func sameOrigin(_ origin: WKSecurityOrigin, _ url: URL) -> Bool {
        let port = url.port ?? (url.scheme == "https" ? 443 : 80)
        return origin.protocol == url.scheme && origin.host == url.host() && (origin.port == 0 ? port == 80 || port == 443 : origin.port == port)
    }

    private static func sameOrigin(_ a: URL, _ b: URL) -> Bool {
        a.scheme == b.scheme && a.host() == b.host() && a.port == b.port
    }

    // MARK: Navigation stays on the preview; links open in Safari.

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let target = action.request.url else { return decisionHandler(.cancel) }
        if Self.sameOrigin(target, page) { return decisionHandler(.allow) }
        if action.navigationType == .linkActivated { openOutside(target) }
        decisionHandler(.cancel)
    }

    /// The preview server answers 404 for a token it didn't issue: the link is from an earlier session.
    /// An http:// preview hears it from the proxy instead (onExpired).
    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if response.isForMainFrame, (response.response as? HTTPURLResponse)?.statusCode == 404 {
            expired()
            return decisionHandler(.cancel)
        }
        decisionHandler(.allow)
    }

    private func expired() {
        Haptics.log.info("expired link \(self.url.absoluteString, privacy: .public)")
        onFailure(Self.expiredLink)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let target = action.request.url { openOutside(target) }
        return nil
    }

    private func openOutside(_ target: URL) {
        guard let scheme = target.scheme?.lowercased(), ["http", "https", "mailto", "tel", "sms"].contains(scheme) else { return }
        UIApplication.shared.open(target)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: any Error) {
        let error = error as NSError
        // A newer load replaced this one, or the 404 check above cancelled it.
        if error.domain == NSURLErrorDomain, error.code == NSURLErrorCancelled { return }
        if error.domain == "WebKitErrorDomain", error.code == 102 { return }
        onFailure("Can't reach Sonobe at \(url.host() ?? "your computer"). Check that Preview on Phone is still on, that this phone is on the same Wi-Fi, and that Sonobe Viewer has Local Network access in Settings. (\(error.localizedDescription))")
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        Haptics.log.info("loaded \(webView.url?.absoluteString ?? "", privacy: .public)")
        #if DEBUG
        // What `npm run test:ios` checks: the page is one WebKit trusts with the camera and the sensors.
        webView.evaluateJavaScript("[window.isSecureContext === true, !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)]") { result, _ in
            let flags = result as? [Bool] ?? []
            Haptics.log.info("page secure=\(flags.first ?? false, privacy: .public) media=\(flags.last ?? false, privacy: .public)")
        }
        #endif
    }

    // MARK: The preview's own page uses the camera, the microphone and motion without WebKit asking on every load; iOS still asks once.

    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(frame.isMainFrame && Self.sameOrigin(origin, page) ? .grant : .deny)
    }

    func webView(_ webView: WKWebView, requestDeviceOrientationAndMotionPermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(frame.isMainFrame && Self.sameOrigin(origin, page) ? .grant : .deny)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        reload()
    }
}

/// WKUserContentController keeps its handlers alive; the relay keeps it from retaining the controller.
private final class MessageRelay: NSObject, WKScriptMessageHandler {
    let deliver: (WKScriptMessage) -> Void
    init(_ deliver: @escaping (WKScriptMessage) -> Void) { self.deliver = deliver }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        deliver(message)
    }
}
