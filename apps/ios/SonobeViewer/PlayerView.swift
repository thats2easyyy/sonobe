import SwiftUI
import WebKit

/// The LAN web player in a full-screen WKWebView, pinned to the preview's origin, with the haptics bridge.
struct PlayerContainer: UIViewControllerRepresentable {
    let url: URL
    let reloads: Int
    let onMenu: () -> Void
    let onFailure: (String) -> Void

    func makeUIViewController(context: Context) -> PlayerViewController {
        PlayerViewController(url: url, onMenu: onMenu, onFailure: onFailure)
    }

    func updateUIViewController(_ controller: PlayerViewController, context: Context) {
        controller.onMenu = onMenu
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
    var onMenu: () -> Void
    var onFailure: (String) -> Void
    private let haptics = Haptics()
    private var webView: WKWebView!

    static let expiredLink = "This preview link has expired. Sonobe makes a new link each time Preview on Phone starts, so scan the code it shows now."

    init(url: URL, onMenu: @escaping () -> Void, onFailure: @escaping (String) -> Void) {
        self.url = url
        self.onMenu = onMenu
        self.onFailure = onFailure
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func loadView() {
        let content = WKUserContentController()
        content.addUserScript(WKUserScript(source: haptics.announcementScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        content.add(MessageRelay { [weak self] message in self?.received(message) }, name: "sonobe")

        let config = WKWebViewConfiguration()
        config.userContentController = content
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.websiteDataStore = .nonPersistent()

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

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        becomeFirstResponder()
    }

    override var canBecomeFirstResponder: Bool { true }
    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { .all }

    /// Shake (Device → Shake in the simulator) opens Reload / Disconnect, so every touch belongs to the prototype.
    override func motionEnded(_ motion: UIEvent.EventSubtype, with event: UIEvent?) {
        if motion == .motionShake { onMenu() } else { super.motionEnded(motion, with: event) }
    }

    func load(_ next: URL) {
        Haptics.log.info("load \(next.absoluteString, privacy: .public)")
        url = next
        webView.load(URLRequest(url: next))
    }

    func reload() {
        webView.load(URLRequest(url: url))
    }

    /// Only the player page itself, on the preview's origin, reaches the haptics.
    private func received(_ message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, Self.sameOrigin(message.frameInfo.securityOrigin, url) else { return }
        haptics.handle(message.body)
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
        if Self.sameOrigin(target, url) { return decisionHandler(.allow) }
        if action.navigationType == .linkActivated { openOutside(target) }
        decisionHandler(.cancel)
    }

    /// The preview server answers 404 for a token it didn't issue: the link is from an earlier session.
    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if response.isForMainFrame, (response.response as? HTTPURLResponse)?.statusCode == 404 {
            Haptics.log.info("expired link \(self.url.absoluteString, privacy: .public)")
            onFailure(Self.expiredLink)
            return decisionHandler(.cancel)
        }
        decisionHandler(.allow)
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
