# Sonobe Viewer for iPhone

Sonobe Viewer plays the prototype you have open in Sonobe, full screen on your iPhone, with real haptics. Safari can't play haptics, so in the browser the Haptic and Vibrate patches do nothing on an iPhone. In Sonobe Viewer they tap and buzz the way the finished app would.

The app is a small shell around the same web player that Preview on Phone serves. It loads the player in a WKWebView and adds a bridge that the player uses for Haptic and Vibrate, and for the menu's Open Another Prototype. Everything else, including new patch features, sound, network requests and the camera, reaches the phone through the web player with no change to the app. The camera, the microphone and location need a secure (https) link, in Safari and in the app alike, because Preview on Phone serves plain http.

It isn't on the App Store or TestFlight yet, so you build it yourself with Xcode.

## Use it

1. In Sonobe on your computer, choose **Viewer → Preview on Phone**.
2. In Sonobe Viewer, tap **Scan Code** and point the camera at the code, or paste the link.
3. The first time, iOS asks to let Sonobe Viewer find devices on your local network. Choose **Allow**; that's how it reaches your computer.

Your phone and your computer need to be on the same Wi-Fi. Tap the screen with three fingers for the menu: Restart Prototype, Reload, and Open Another Prototype, which goes back to scanning. Three-finger touches never reach the prototype; every other touch does. A tip teaches the gesture the first time. Restarting the prototype in Sonobe restarts it on the phone too.

Sonobe makes a new link each time Preview on Phone starts. If the app says the link has expired, scan the new code. A `sonobe-viewer://open?url=<preview link>` link also opens a preview in the app. A link to an address outside your local network, such as an https tunnel you set up, asks first and names the address.

## Requirements

- A Mac with Xcode 26 or later. The project is tested with Xcode 26.6.
- An iPhone or iPad with iOS 17 or later, or the iOS Simulator.

## Build and run in the Simulator

Simulator builds need no signing:

```bash
cd apps/ios
xcodebuild -project SonobeViewer.xcodeproj -scheme SonobeViewer -sdk iphonesimulator \
  -derivedDataPath build CODE_SIGNING_ALLOWED=NO build
xcrun simctl install booted build/Build/Products/Debug-iphonesimulator/SonobeViewer.app
xcrun simctl launch booted dev.sonobe.viewer -SonobePlayerURL http://127.0.0.1:52345/p/<token>/
```

Boot a simulator first, for example with `open -a Simulator`. `-SonobePlayerURL` opens a preview link straight away. The Simulator reaches your Mac at 127.0.0.1, so use the port and token from Sonobe's preview link. The Simulator has no Taptic Engine, so haptics show up only in the app's log:

```bash
xcrun simctl spawn booted log stream --info --predicate 'subsystem == "dev.sonobe.viewer"'
```

You can also open `SonobeViewer.xcodeproj` in Xcode and press Run.

## Install on your iPhone

Signing settings live in a file that Git ignores, so your team ID never lands in a commit:

1. Copy `Config/Local.xcconfig.example` to `Config/Local.xcconfig`.
2. Set `DEVELOPMENT_TEAM` to your Team ID. Xcode shows it in **Settings → Accounts**. A free Apple Account works.
3. Set `SONOBE_BUNDLE_ID` to a bundle id of your own, such as `com.yourname.sonobe-viewer`. Bundle ids are unique across Apple's developer accounts, so the default one won't sign for you.
4. Connect the phone, open `SonobeViewer.xcodeproj`, pick the phone as the run destination, and press Run.

On the phone, turn on **Settings → Privacy & Security → Developer Mode** when iOS asks. With a free account, also trust your certificate in **Settings → General → VPN & Device Management**. Apps signed with a free account stop opening after 7 days; press Run again to reinstall.

## Test

```bash
npm run test:ios
```

This needs macOS with Xcode and isn't part of CI. The script (`scripts/test.mjs`):

1. Serves a test prototype, Haptic Check, with the real web player and preview server (`apps/desktop/player/testing.ts`).
2. Runs the Swift unit tests (link parsing, which hosts are on the local network, bridge messages, vibration limits, the remembered tip) and the UI tests (taps reach the prototype, the three-finger menu, deep links, a link off the local network, expired links, bad links) on a simulator, with no signing.
3. Reads the app's log to check what three taps played: Notification Success at start, then three Impact Medium haptics and three 50 ms vibrations. In the menu test, the three-finger taps play nothing and Restart plays Notification Success again.

It uses a booted iPhone simulator, or the first available one. Set `SONOBE_IOS_SIMULATOR` to a simulator's name or UDID to choose. The full `xcodebuild` output goes to `build/test.log`.

The web player's side of the bridge is tested with the rest of the repo in `npm test` (`apps/desktop/player/platform.test.ts` and `player.browser.test.ts`).

## How it works

| File | What it does |
|---|---|
| `SonobeViewer/SonobeViewerApp.swift` | The app, what the player menu asks of it, the banner that explains a failed load, and the question before opening a link off the local network |
| `SonobeViewer/ConnectView.swift` | Scan (VisionKit), paste, and the most recent link |
| `SonobeViewer/ViewerModel.swift` | Accepts only preview links: `http(s)://<computer>:<port>/p/<token>/` or `sonobe-viewer://open?url=…`, and holds one whose host is off the local network until the person confirms it |
| `SonobeViewer/PlayerView.swift` | The full-screen WKWebView, pinned to the preview's address; other links open in Safari. It routes the bridge's messages |
| `SonobeViewer/Haptics.swift` | The bridge's announcement and messages: UIFeedbackGenerator for the Haptic types, Core Haptics for Custom Pattern and Vibrate |
| `SonobeViewer-Info.plist` | Local network access, the camera, microphone and location prompts, and the `sonobe-viewer` URL scheme |
| `Config/Base.xcconfig` | Shared build settings; includes your `Local.xcconfig` |
| `scripts/icon.mjs` | Renders the app icon from `assets/brand/sonobe-mark.svg` |

The bridge is one-way. At document start, the app defines a read-only `window.sonobeNative` (bridge version 2) with the haptic types it can play, the menu actions it takes, and whether it already showed the three-finger tip. The player posts `{ kind: "haptic", type, pattern? }` or `{ kind: "vibrate", pattern }` to the `sonobe` message handler, and the app plays what it recognizes. The player's menu posts `{ kind: "openAnother" }` to go back to the connect screen, and `{ kind: "menuTipSeen" }` once the tip has shown, which the app remembers because its web view keeps nothing between launches. The menu itself, with Restart and Reload, is the web player's. The app accepts messages only from the player page on the preview's address, ignores unknown kinds and types, and limits a vibration to 10 seconds. [ARCHITECTURE.md §9.2](../../ARCHITECTURE.md) has the full contract.

## Limits

- The app has only been tested in the Simulator. How the haptics feel, the Local Network prompt, and QR scanning need a real iPhone.
- Frame pacing is WKWebView's, which is likely 60 Hz even on ProMotion iPhones. The app adds haptics, not 120 Hz.
- The trackpad Haptic types (Alignment, Level Change) have no iPhone equivalent and do nothing.
