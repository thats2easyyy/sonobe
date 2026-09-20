import Foundation
import Testing
@testable import SonobeViewer

struct BridgeMessageTests {
    @Test func readsHapticTypes() {
        #expect(Haptics.message(from: ["kind": "haptic", "type": "impactMedium"]) == .haptic("impactMedium"))
        #expect(Haptics.message(from: ["kind": "haptic", "type": "selection", "pattern": NSNull()]) == .haptic("selection"))
        let ahap: NSDictionary = ["Pattern": [["Event": ["EventType": "HapticTransient", "Time": 0]]]]
        #expect(Haptics.message(from: ["kind": "haptic", "type": "customPattern", "pattern": ahap]) == .customPattern(ahap))
    }

    @Test(arguments: [
        ["kind": "haptic", "type": "alignment"],
        ["kind": "haptic", "type": "levelChange"],
        ["kind": "haptic", "type": "IMPACTMEDIUM"],
        ["kind": "haptic"],
        ["kind": "haptic", "type": "customPattern"],
        ["kind": "haptic", "type": "customPattern", "pattern": "[]"],
        ["kind": "sound", "type": "impactMedium"],
        ["type": "impactMedium"],
        ["kind": "vibrate"],
        ["kind": "vibrate", "pattern": "400"],
        ["kind": "vibrate", "pattern": [400, "off", 400]],
        ["kind": "vibrate", "pattern": true],
    ] as [[String: Any]])
    func ignoresUnknownMessages(body: [String: Any]) {
        #expect(Haptics.message(from: body) == nil)
    }

    @Test func readsTheMenusMessages() {
        #expect(Haptics.message(from: ["kind": "openAnother"]) == .openAnother)
        #expect(Haptics.message(from: ["kind": "menuTipSeen"]) == .menuTipSeen)
        #expect(Haptics.message(from: ["kind": "openanother"]) == nil)
    }

    @Test func ignoresBodiesThatArentObjects() {
        #expect(Haptics.message(from: "impactMedium") == nil)
        #expect(Haptics.message(from: [["kind": "haptic", "type": "impactMedium"]]) == nil)
    }

    @Test func readsVibratePatterns() {
        #expect(Haptics.message(from: ["kind": "vibrate", "pattern": 400]) == .vibrate([400]))
        #expect(Haptics.message(from: ["kind": "vibrate", "pattern": [15, 80, 25]]) == .vibrate([15, 80, 25]))
        // 0 or [] stops the buzz.
        #expect(Haptics.message(from: ["kind": "vibrate", "pattern": 0]) == .vibrate([]))
        #expect(Haptics.message(from: ["kind": "vibrate", "pattern": [Any]()]) == .vibrate([]))
    }

    @Test func clampsVibrationToTenSeconds() {
        #expect(Haptics.vibrationSpans(60_000) == [10_000])
        #expect(Haptics.vibrationSpans([5_000, 1_000, 8_000, 500, 500]) == [5_000, 1_000, 4_000])
        #expect(Haptics.vibrationSpans([-20, 100, Double.nan, Double.infinity]) == [0, 100, 0, 0])
        let total = Haptics.vibrationSpans(Array(repeating: 900.0, count: 40))!.reduce(0, +)
        #expect(total == 10_000)
    }

    @Test func turnsOnOffListsIntoBuzzes() {
        let events = Haptics.vibrationEvents([15, 80, 25])
        #expect(events.map(\.start) == [0, 0.095])
        #expect(events.map(\.duration) == [0.015, 0.025])
        #expect(Haptics.vibrationEvents([0, 100, 200]).map(\.start) == [0.1])
        #expect(Haptics.vibrationEvents([]).isEmpty)
    }

    @MainActor
    @Test(arguments: [false, true])
    func announcesWhatThePlayerReads(menuTipSeen: Bool) throws {
        let script = Haptics().announcementScript(menuTipSeen: menuTipSeen)
        let start = try #require(script.range(of: "Object.freeze(")?.upperBound)
        let end = try #require(script.range(of: ") });", options: .backwards)?.lowerBound)
        let info = try #require(try JSONSerialization.jsonObject(with: Data(script[start..<end].utf8)) as? [String: Any])
        #expect(info["version"] as? Int == 2)
        #expect(info["platform"] as? String == "ios")
        #expect(info["vibrate"] as? Bool == true)
        #expect(info["actions"] as? [String] == ["openAnother"])
        #expect(info["menuTipSeen"] as? Bool == menuTipSeen)
        let haptics = try #require(info["haptics"] as? [String])
        #expect(haptics.contains("impactMedium"))
        #expect(haptics.allSatisfy(Haptics.feedbackTypes.contains))
        #expect(!haptics.contains("alignment"))
    }
}
