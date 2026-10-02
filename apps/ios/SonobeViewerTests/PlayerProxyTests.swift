import Foundation
import Testing
@testable import SonobeViewer

struct PlayerAddressTests {
    @Test(arguments: [
        ("http://192.168.1.20:52345/p/token/", "sonobe-player://192.168.1.20:52345/p/token/"),
        ("http://macbook.local/p/token/", "sonobe-player://macbook.local/p/token/"),
        // A tunnel's page is already one WebKit trusts.
        ("https://tunnel.example/p/token/", "https://tunnel.example/p/token/"),
    ])
    func loadsAnHttpPreviewFromTheAppsScheme(preview: String, page: String) throws {
        #expect(PlayerAddress.page(for: try #require(URL(string: preview))).absoluteString == page)
    }

    @Test func findsTheComputerBehindAPage() throws {
        let page = try #require(URL(string: "sonobe-player://192.168.1.20:52345/p/token/assets/clip.mp4?v=2"))
        #expect(PlayerAddress.server(for: page)?.absoluteString == "http://192.168.1.20:52345/p/token/assets/clip.mp4?v=2")
        for other in ["http://192.168.1.20:52345/p/token/", "https://tunnel.example/p/token/", "sonobe-viewer://open?url=x", "sonobe-player:///p/token/"] {
            #expect(PlayerAddress.server(for: try #require(URL(string: other))) == nil, "\(other)")
        }
    }
}

struct PlayerProxyTests {
    private let preview = URL(string: "http://192.168.1.20:52345/p/token/")!

    @Test func asksTheComputerForWhatThePageAsked() throws {
        var request = URLRequest(url: try #require(URL(string: "sonobe-player://192.168.1.20:52345/p/token/assets/clip.mp4")))
        request.setValue("bytes=0-1023", forHTTPHeaderField: "Range")
        request.setValue("gzip, deflate", forHTTPHeaderField: "Accept-Encoding")
        let upstream = try #require(PlayerProxy.upstream(for: request, preview: preview))
        #expect(upstream.url?.absoluteString == "http://192.168.1.20:52345/p/token/assets/clip.mp4")
        #expect(upstream.httpMethod == "GET")
        #expect(upstream.value(forHTTPHeaderField: "Range") == "bytes=0-1023")
        // The server's own bytes, so its lengths and ranges hold.
        #expect(upstream.value(forHTTPHeaderField: "Accept-Encoding") == "identity")
    }

    @Test(arguments: [
        "sonobe-player://192.168.1.99:52345/p/token/player.js",
        "sonobe-player://192.168.1.20:8080/p/token/player.js",
        "sonobe-player://192.168.1.20:52345/p/other/player.js",
        "sonobe-player://192.168.1.20:52345/favicon.ico",
        "sonobe-player://192.168.1.20:52345/p/token/../other/player.js",
        "http://192.168.1.20:52345/p/token/player.js",
    ])
    func servesOnlyThePreview(page: String) throws {
        #expect(PlayerProxy.upstream(for: URLRequest(url: try #require(URL(string: page))), preview: preview) == nil)
    }

    @Test func servesNothingBeforeAPreviewLoads() throws {
        #expect(PlayerProxy.upstream(for: URLRequest(url: try #require(URL(string: "sonobe-player://192.168.1.20:52345/p/token/"))), preview: nil) == nil)
    }
}
