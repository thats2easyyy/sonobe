import AudioToolbox
import CoreHaptics
import os
import UIKit

/// A message the player posted to the "sonobe" handler, checked and ready to play.
nonisolated enum BridgeMessage: Equatable {
    /// A Haptic patch Type key other than Custom Pattern.
    case haptic(String)
    /// Custom Pattern's Core Haptics pattern (AHAP JSON).
    case customPattern(NSDictionary)
    /// Vibrate: milliseconds on, off, on, …, clamped to 10 s in total. Empty stops the buzz.
    case vibrate([Double])
}

/// Plays the Haptic patch's feedback types and Vibrate patterns for the player.
///
/// The bridge contract (ARCHITECTURE.md §9.2): the page reads `window.sonobeNative`, which this app
/// defines at document start, and posts `{ kind: "haptic", type, pattern? }` or
/// `{ kind: "vibrate", pattern }` to the "sonobe" message handler. Anything else is ignored.
final class Haptics {
    static let log = Logger(subsystem: "dev.sonobe.viewer", category: "haptics")

    /// Haptic Type keys (packages/patches/catalog/device-1.json) this app plays. The trackpad types
    /// (alignment, levelChange) have no iPhone equivalent; Custom Pattern needs Core Haptics.
    nonisolated static let feedbackTypes = ["vibrate", "selection", "impactLight", "impactMedium", "impactHeavy", "notificationSuccess", "notificationWarning", "notificationError", "customPattern"]

    nonisolated static let maxVibrationMs = 10_000.0

    private let selection = UISelectionFeedbackGenerator()
    private let impacts: [String: UIImpactFeedbackGenerator] = [
        "impactLight": UIImpactFeedbackGenerator(style: .light),
        "impactMedium": UIImpactFeedbackGenerator(style: .medium),
        "impactHeavy": UIImpactFeedbackGenerator(style: .heavy),
    ]
    private let notification = UINotificationFeedbackGenerator()
    private let notifications: [String: UINotificationFeedbackGenerator.FeedbackType] = [
        "notificationSuccess": .success,
        "notificationWarning": .warning,
        "notificationError": .error,
    ]
    private let hasCoreHaptics = CHHapticEngine.capabilitiesForHardware().supportsHaptics
    private var engine: CHHapticEngine?
    private var vibration: CHHapticPatternPlayer?

    /// The types this device plays: every feedback type, less Custom Pattern without Core Haptics.
    var supportedTypes: [String] {
        Self.feedbackTypes.filter { $0 != "customPattern" || hasCoreHaptics }
    }

    /// Runs at document start in the player page; the player reads it in playerPlatform().
    var announcementScript: String {
        let info: [String: Any] = ["version": 1, "platform": "ios", "haptics": supportedTypes, "vibrate": true]
        let json = (try? JSONSerialization.data(withJSONObject: info)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        return "Object.defineProperty(window, \"sonobeNative\", { value: Object.freeze(\(json)) });"
    }

    func prepare() {
        selection.prepare()
        impacts.values.forEach { $0.prepare() }
        notification.prepare()
    }

    /// Plays a message body from the page. Anything unrecognized is ignored.
    func handle(_ body: Any) {
        guard let message = Self.message(from: body) else {
            Self.log.info("ignored a message the player sent")
            return
        }
        switch message {
        case let .haptic(type): play(type)
        case let .customPattern(pattern): playAHAP(pattern)
        case let .vibrate(spans): vibrate(spans)
        }
    }

    // MARK: Reading messages

    /// The message in `body` (a WKScriptMessage body: dictionaries, arrays, strings and NSNumbers), or nil.
    nonisolated static func message(from body: Any) -> BridgeMessage? {
        guard let message = body as? [String: Any], let kind = message["kind"] as? String else { return nil }
        switch kind {
        case "haptic":
            guard let type = message["type"] as? String, feedbackTypes.contains(type) else { return nil }
            if type == "customPattern" {
                guard let pattern = message["pattern"] as? NSDictionary else { return nil }
                return .customPattern(pattern)
            }
            return .haptic(type)
        case "vibrate":
            return vibrationSpans(message["pattern"]).map(BridgeMessage.vibrate)
        default:
            return nil
        }
    }

    /// Vibrate's pattern (a number of milliseconds or an on/off list) clamped to 10 s in total; nil when it isn't one.
    nonisolated static func vibrationSpans(_ raw: Any?) -> [Double]? {
        let values: [Double]
        if let single = number(raw) {
            values = [single]
        } else if let list = raw as? [Any] {
            let numbers = list.compactMap(number)
            guard numbers.count == list.count else { return nil }
            values = numbers
        } else {
            return nil
        }
        var spans: [Double] = []
        var total = 0.0
        for value in values {
            let span = min(value.isFinite ? max(value, 0) : 0, maxVibrationMs - total)
            spans.append(span)
            total += span
            if total >= maxVibrationMs { break }
        }
        return spans.contains(where: { $0 > 0 }) ? spans : []
    }

    /// The buzzes in an on/off list, as (start, duration) in seconds.
    nonisolated static func vibrationEvents(_ spans: [Double]) -> [(start: Double, duration: Double)] {
        var events: [(start: Double, duration: Double)] = []
        var time = 0.0
        for (index, span) in spans.enumerated() {
            if index % 2 == 0, span > 0 { events.append((time / 1000, span / 1000)) }
            time += span
        }
        return events
    }

    /// A JSON number; booleans, which also arrive as NSNumber, don't count.
    private nonisolated static func number(_ value: Any?) -> Double? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        return number.doubleValue
    }

    // MARK: Playing

    private func play(_ type: String) {
        Self.log.info("haptic \(type, privacy: .public)")
        if type == "selection" {
            selection.selectionChanged()
            selection.prepare()
        } else if let impact = impacts[type] {
            impact.impactOccurred()
            impact.prepare()
        } else if let feedback = notifications[type] {
            notification.notificationOccurred(feedback)
            notification.prepare()
        } else if type == "vibrate" {
            AudioServicesPlaySystemSound(kSystemSoundID_Vibrate)
        }
    }

    /// Core Haptics plays AHAP as is, so Custom Pattern keeps its intensities and sharpness.
    private func playAHAP(_ pattern: NSDictionary) {
        Self.log.info("haptic customPattern")
        guard hasCoreHaptics else { return }
        do {
            var keyed: [CHHapticPattern.Key: Any] = [:]
            for (key, value) in pattern {
                if let key = key as? String { keyed[CHHapticPattern.Key(rawValue: key)] = value }
            }
            try start(CHHapticPattern(dictionary: keyed))
        } catch {
            Self.log.error("custom pattern didn't play: \(error.localizedDescription, privacy: .public)")
        }
    }

    /// A new pattern replaces the running one, as navigator.vibrate does; an empty one just stops it.
    private func vibrate(_ spans: [Double]) {
        Self.log.info("vibrate \(spans.map { Int($0) }, privacy: .public)")
        try? vibration?.stop(atTime: CHHapticTimeImmediate)
        vibration = nil
        let events = Self.vibrationEvents(spans)
        guard !events.isEmpty else { return }
        guard hasCoreHaptics else {
            AudioServicesPlaySystemSound(kSystemSoundID_Vibrate)
            return
        }
        let buzzes = events.map { event in
            CHHapticEvent(eventType: .hapticContinuous, parameters: [
                CHHapticEventParameter(parameterID: .hapticIntensity, value: 1),
                CHHapticEventParameter(parameterID: .hapticSharpness, value: 0.3),
            ], relativeTime: event.start, duration: event.duration)
        }
        do {
            vibration = try start(CHHapticPattern(events: buzzes, parameters: []))
        } catch {
            Self.log.error("vibration didn't play: \(error.localizedDescription, privacy: .public)")
        }
    }

    @discardableResult
    private func start(_ pattern: CHHapticPattern) throws -> CHHapticPatternPlayer {
        let engine = try self.engine ?? makeEngine()
        try engine.start()
        let player = try engine.makePlayer(with: pattern)
        try player.start(atTime: CHHapticTimeImmediate)
        return player
    }

    private func makeEngine() throws -> CHHapticEngine {
        let engine = try CHHapticEngine()
        engine.isAutoShutdownEnabled = true
        engine.playsHapticsOnly = true
        self.engine = engine
        return engine
    }
}
