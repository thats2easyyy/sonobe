import Foundation
import Observation

/// Which preview the viewer shows. A preview link is the player URL from Sonobe's Preview on Phone,
/// http://<computer>:<port>/p/<token>/, or a sonobe-viewer://open?url=<preview link> deep link.
@Observable
final class ViewerModel {
    var playerURL: URL?
    var failure: String?
    var inputError: String?
    private(set) var recent: URL?
    private let defaults: UserDefaults

    private static let recentKey = "recentPlayerURL"
    /// `xcrun simctl launch booted <bundle id> -SonobePlayerURL http://…` opens a preview directly.
    private static let launchKey = "SonobePlayerURL"

    static let notAPreviewLink = "That isn't a Sonobe preview link. In Sonobe on your computer, choose Viewer → Preview on Phone. The link looks like http://192.168.1.20:52345/p/…/"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        recent = defaults.string(forKey: Self.recentKey).flatMap(Self.playerURL(from:))
        if let launch = defaults.string(forKey: Self.launchKey).flatMap(Self.playerURL(from:)) { show(launch) }
    }

    /// A pasted or scanned link, or a deep link.
    func open(text: String) {
        guard let url = Self.playerURL(from: text) else {
            inputError = Self.notAPreviewLink
            return
        }
        show(url)
    }

    func open(deepLink: URL) {
        Haptics.log.info("deep link \(deepLink.absoluteString, privacy: .public)")
        open(text: deepLink.absoluteString)
    }

    func openRecent() {
        if let recent { show(recent) }
    }

    func close() {
        playerURL = nil
        failure = nil
    }

    private func show(_ url: URL) {
        inputError = nil
        failure = nil
        playerURL = url
        recent = url
        defaults.set(url.absoluteString, forKey: Self.recentKey)
    }

    /// The preview link in `text` (a player URL or a sonobe-viewer://open?url= deep link), ending in "/", or nil.
    nonisolated static func playerURL(from text: String) -> URL? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let parts = URLComponents(string: trimmed), let scheme = parts.scheme?.lowercased() else { return nil }
        if scheme == "sonobe-viewer" {
            guard parts.host?.lowercased() == "open", let inner = parts.queryItems?.first(where: { $0.name == "url" })?.value else { return nil }
            return previewURL(from: inner)
        }
        return previewURL(from: trimmed)
    }

    /// An http(s) player URL whose path is exactly /p/<token>/, without query or fragment.
    private nonisolated static func previewURL(from text: String) -> URL? {
        guard var parts = URLComponents(string: text.trimmingCharacters(in: .whitespacesAndNewlines)),
              let scheme = parts.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = parts.host, !host.isEmpty,
              parts.path.range(of: #"^/p/[A-Za-z0-9_-]{1,128}/?$"#, options: .regularExpression) != nil
        else { return nil }
        if !parts.path.hasSuffix("/") { parts.path += "/" }
        parts.query = nil
        parts.fragment = nil
        return parts.url
    }
}
