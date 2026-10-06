import Foundation
import WebKit

/// Where the player page loads from. Preview on Phone serves plain http://, and WebKit gives the
/// camera, the microphone, location and device motion only to pages it trusts. A page the app serves
/// through a scheme of its own is one, so an http:// preview loads as sonobe-player://<host>:<port>/p/<token>/
/// and PlayerProxy fetches each request from the computer. An https:// link (a tunnel) loads as it is.
enum PlayerAddress {
    static let scheme = "sonobe-player"

    /// The address the web view loads for a preview link.
    static func page(for preview: URL) -> URL {
        guard preview.scheme?.lowercased() == "http", var parts = URLComponents(url: preview, resolvingAgainstBaseURL: false) else { return preview }
        parts.scheme = scheme
        return parts.url ?? preview
    }

    /// The http:// address on the computer behind a sonobe-player:// one, or nil for any other URL.
    static func server(for page: URL) -> URL? {
        guard page.scheme?.lowercased() == scheme, var parts = URLComponents(url: page, resolvingAgainstBaseURL: false), parts.host?.isEmpty == false else { return nil }
        parts.scheme = "http"
        return parts.url
    }
}

/// Serves sonobe-player:// from the preview server: each request goes to the computer over http and
/// its answer streams back with its status and headers. Only the preview's own host, port and
/// /p/<token>/ folder are served.
final class PlayerProxy: NSObject, WKURLSchemeHandler, URLSessionDataDelegate {
    /// The preview being played, http://<host>:<port>/p/<token>/.
    var preview: URL?
    /// The computer answered 404 for the preview's page: it didn't issue the link's token.
    var onExpired: (() -> Void)?
    private var loads: [Int: (page: any WKURLSchemeTask, fetch: URLSessionDataTask)] = [:]
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.httpShouldSetCookies = false
        config.timeoutIntervalForRequest = 30
        // WebKit takes the answers on the main thread.
        return URLSession(configuration: config, delegate: self, delegateQueue: .main)
    }()

    /// The request to send the computer for one the page made, or nil when it isn't the preview's.
    static func upstream(for request: URLRequest, preview: URL?) -> URLRequest? {
        guard let preview, let page = request.url, let target = PlayerAddress.server(for: page)?.standardized,
              target.host()?.lowercased() == preview.host()?.lowercased(), target.port == preview.port, target.path().hasPrefix(preview.path())
        else { return nil }
        var upstream = URLRequest(url: target)
        upstream.httpMethod = request.httpMethod
        upstream.httpBody = request.httpBody
        for (name, value) in request.allHTTPHeaderFields ?? [:] { upstream.setValue(value, forHTTPHeaderField: name) }
        // Bytes as they are on disk, so lengths and ranges (video, sound) stay the server's.
        upstream.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        return upstream
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: any WKURLSchemeTask) {
        guard let upstream = Self.upstream(for: urlSchemeTask.request, preview: preview) else {
            urlSchemeTask.didFailWithError(URLError(.unsupportedURL))
            return
        }
        let fetch = session.dataTask(with: upstream)
        loads[fetch.taskIdentifier] = (urlSchemeTask, fetch)
        fetch.resume()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: any WKURLSchemeTask) {
        // WebKit raises an exception when a stopped task hears anything more.
        guard let id = loads.first(where: { $0.value.page === urlSchemeTask })?.key else { return }
        loads.removeValue(forKey: id)?.fetch.cancel()
    }

    func stop() {
        loads.removeAll()
        session.invalidateAndCancel()
    }

    // MARK: URLSessionDataDelegate

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let task = loads[dataTask.taskIdentifier]?.page, let page = task.request.url else { return completionHandler(.cancel) }
        if let http = response as? HTTPURLResponse {
            // The navigation delegate's 404 check doesn't fire for a page the app serves, so say it here.
            if http.statusCode == 404, PlayerAddress.server(for: page) == preview {
                loads[dataTask.taskIdentifier] = nil
                task.didFailWithError(URLError(.cancelled))
                onExpired?()
                return completionHandler(.cancel)
            }
            var headers: [String: String] = [:]
            for (name, value) in http.allHeaderFields {
                if let name = name as? String, let value = value as? String { headers[name] = value }
            }
            task.didReceive(HTTPURLResponse(url: page, statusCode: http.statusCode, httpVersion: "HTTP/1.1", headerFields: headers) ?? response)
        } else {
            task.didReceive(response)
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        loads[dataTask.taskIdentifier]?.page.didReceive(data)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: (any Error)?) {
        guard let load = loads.removeValue(forKey: task.taskIdentifier)?.page else { return }
        if let error { load.didFailWithError(error) } else { load.didFinish() }
    }

    /// The page asked for this address, so it gets this address's answer: a redirect is the page's to follow.
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
