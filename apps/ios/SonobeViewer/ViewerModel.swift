import Foundation
import Observation

/// Which preview the viewer shows. A preview link is the player URL from Sonobe's Preview on Phone,
/// http://<computer>:<port>/p/<token>/, or a sonobe-viewer://open?url=<preview link> deep link.
@Observable
final class ViewerModel {
    var playerURL: URL?
    var failure: String?
    var inputError: String?
    /// A preview link to a host outside the local network (a tunnel, or someone else's page), waiting
    /// for the person to confirm it: Sonobe itself only serves previews on this network.
    private(set) var pendingLink: URL?
    private(set) var recent: URL?
    /// The player taught its three-finger menu once (a tip, or the person opened it); the page keeps no storage between launches.
    var menuTipSeen: Bool {
        didSet { defaults.set(menuTipSeen, forKey: Self.menuTipKey) }
    }
    private let defaults: UserDefaults

    private static let recentKey = "recentPlayerURL"
    /// `-menuTipSeen NO` in launch arguments shows the tip again (UI tests).
    private static let menuTipKey = "menuTipSeen"
    /// `xcrun simctl launch booted <bundle id> -SonobePlayerURL http://…` opens a preview directly.
    private static let launchKey = "SonobePlayerURL"

    static let notAPreviewLink = "That isn't a Sonobe preview link. In Sonobe on your computer, choose Viewer → Preview on Phone. The link looks like http://192.168.1.20:52345/p/…/"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        menuTipSeen = defaults.bool(forKey: Self.menuTipKey)
        recent = defaults.string(forKey: Self.recentKey).flatMap(Self.playerURL(from:))
        if let launch = defaults.string(forKey: Self.launchKey).flatMap(Self.playerURL(from:)) { show(launch) }
    }

    /// A pasted or scanned link, or a deep link. One to a host outside the local network waits for confirmPendingLink.
    func open(text: String) {
        guard let url = Self.playerURL(from: text) else {
            inputError = Self.notAPreviewLink
            return
        }
        if Self.isLocalNetwork(url) {
            show(url)
        } else {
            inputError = nil
            pendingLink = url
        }
    }

    /// The person chose to open the link to a host outside the local network.
    func confirmPendingLink(_ url: URL) {
        pendingLink = nil
        show(url)
    }

    func cancelPendingLink() {
        pendingLink = nil
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

    /// Where Preview on Phone serves from: loopback, private, link-local and shared (100.64/10, which
    /// VPNs such as Tailscale use) addresses, and .local or single-label names.
    nonisolated static func isLocalNetwork(_ url: URL) -> Bool {
        guard let host = url.host(percentEncoded: false)?.lowercased(), !host.isEmpty else { return false }
        if host.contains(":") { return host == "::1" || host.hasPrefix("fe80:") || host.hasPrefix("fc") || host.hasPrefix("fd") }
        let octets = host.split(separator: ".", omittingEmptySubsequences: false).map { UInt8($0) }
        if octets.count == 4, !octets.contains(nil) {
            let a = octets[0]!, b = octets[1]!
            return a == 127 || a == 10 || (a == 172 && (16...31).contains(b)) || (a == 192 && b == 168) || (a == 169 && b == 254) || (a == 100 && (64...127).contains(b))
        }
        return host.hasSuffix(".local") || !host.contains(".")
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
