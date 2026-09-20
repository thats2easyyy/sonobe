# Sonobe Roadmap

Sonobe ships in stages. Each stage ends when typecheck and tests pass, the app runs, and an adversarial review finds no blocking issues.

A checked item is done. An unchecked item marked "partial" says what's left.

## Next steps

1. **Signing.** Developer ID signing and notarization for macOS, code signing for Windows, and TestFlight for the Sonobe Viewer iPhone app, so builds can be shared.
2. **Windows and Linux.** Build and verify the installers that are configured but untested.
3. **Figma plugin, verified.** Run the Sonobe Capture plugin inside Figma against real files, fix what it finds, and publish it.
4. **Origami JSON import.** Open existing Origami prototypes as Sonobe documents.
5. **Collaboration.** Several people, and Claude, working in one document.

The first two finish Stage 4. The rest are Stage 5.

## Stage 1: Foundations
- [x] `@sonobe/core`: document model, ops and inverse, history, diagnostics, canonical file format, outline
- [x] `@sonobe/engine` building blocks: springs (Rebound-exact), curves, decay/momentum, matrices, layout, hit testing, gestures
- [x] `@sonobe/renderer`: DOM renderer for every layer type, input capture, text measurer, CSS device frames
- [x] Editor design system, app shell, and widget kit
- [x] Electron shell: menus, file IO bridge, RPC bridge, localhost MCP endpoint skeleton
- [x] Patch catalog: specs for all supported patches (ports, behavior, docs, tiers)
- [x] Concept guides

## Stage 2: The engine comes alive
- [x] Runtime evaluator: topological evaluation, back edges, pulses, loops with per-index state, component instances, variables
- [x] Patch implementations: tier 1 (ISAT core and everyday patches), then tier 2 and tier 3. All 199 patches have real implementations, and none falls back to a placeholder
- [x] MCP server: discovery (with the verified examples as patterns), read, write, knobs, simulate, screenshot, presence, history tools; headless host; stdio relay
- [x] CLI: `sonobe new | validate | fmt | outline | describe | sim | mcp`
- [x] Editor integration: store and history, layer list, inspector, patch editor (xyflow), patch picker, viewer running the engine and renderer

## Stage 3: Parity and polish
- [x] Patch editor power features: link-drag search, knife cut, ⌘-drag splice onto a wire, option-drag duplicate, single-key inserts, Tidy Up (within each comment frame), comments, components (enter/exit, publish ports), variables, live values on hover, pulse sparks, loop badges
- [x] Patch editor arrivals: a graph opens in a wave that follows the signal flow, with cables drawing from their outputs; nodes and cables added later (by the person, by undo, by Claude) animate in once, and what the person placed themselves (option-drag copies, a cable dragged into link search) stays put; a first fit waiting on an idle page shows skeleton nodes; large graphs and reduced motion fade
- [x] Canvas: direct manipulation, snapping, insert shapes and text, alignment tools
- [x] Layer ↔ patch bridges: Touch button, inspector property links, drag a cable onto a property
- [x] Viewer: device picker, frame, restart, hit-target overlay, pop-out window, LAN web player with QR code
- [ ] Viewer recording and replay export (partial: the runtime already records every input since the last restart and replays it exactly for traces; recording the pop-out viewer at device size as a video to trim and share, and exporting a session's input as a replay, remain. A replay is exact only where network requests, device motion and media replay too)
- [ ] Native iPhone preview: Sonobe Viewer (`apps/ios`) plays the LAN web player full screen with real haptics. Haptic and Vibrate reach UIFeedbackGenerator and Core Haptics over a small bridge, the app scans the Preview on Phone code, and `npm run test:ios` runs its tests on a simulator. Android phones vibrate in the browser. The phone gets the viewer's sound, network requests and links, restarts when Sonobe does, opens a menu with a three-finger tap, and reports the phone's appearance, safe area and rotation to Device Info (partial: tested only in the Simulator; on a real iPhone, touch latency and frame pacing, which WKWebView likely holds at 60 Hz even on ProMotion screens, are unmeasured; and it's built from source until TestFlight)
- [ ] Camera, microphone, location and iPhone motion on the phone (partial: the camera and microphone work in the desktop viewer and the pop-out window, which loads from localhost; browsers allow these only on secure pages, and Preview on Phone's address is plain http://, so the phone needs an HTTPS preview server or a native bridge in Sonobe Viewer)
- [x] Assets: images, video, sound, fonts, Lottie (drag and drop)
- [ ] Alpha masks, Origami style: a layer masks the one above it, and looped masks pair with looped layers by index (partial: groups clip their contents to their bounds and corner radius, and images take corner radii; masking by another layer's alpha remains)
- [ ] Interface Orientation in the viewer and on phones (partial: the patch computes Orientation and Landscape from the device's rotation, and the web player reports the phone's real rotation, but neither the viewer nor the web player turns the interface from the patch yet)
- [x] Knobs and presets: named values with sliders and soft ranges in the Inspector's Knobs tab, presets such as a locked "Shipped app" to flip between while the prototype runs (⌘'), knob chips in the patch editor, and `set_knobs`, `apply_knob_preset` and simulation presets for Claude. A tune reaches the viewer and phones live
- [ ] Steady nodes: a running prototype doesn't resize patch nodes. Live values sit in slots as wide as the longest text their type prints, ending in "…" past it and short of cutting a label, and knob chips keep the room of their slider's or fields' longest value, in the patch editor and in the headless size model alike (partial: the header's "×N" loop badge gaining a digit still widens a node whose header sets its width, and a knob value typed or fine-tuned with ⌥ past its slider's step still widens its chip)
- [ ] Preset switching on the phone (partial: a phone runs whichever preset the editor or Claude switched to, and tunes reach it live; picking a preset from the phone's three-finger menu remains)
- [ ] WebSocket Connection Headers (partial: Sec-WebSocket-Protocol reaches the server everywhere, and other headers warn; sending them needs the desktop app to open sockets from the Electron main process instead of the viewer's browser WebSocket)
- [x] Drafts: unsaved work survives a crash, a quit or a killed process, and comes back from the welcome screen or through Claude; `save_document` saves without a dialog
- [x] Examples: 16 canonical recipes as runnable projects with scripted tests
- [x] Learn panel: 5 interactive lessons, the guides, the examples, and the patch reference
- [x] Welcome screen: new blank prototype, lessons, templates from the examples, recent files
- [x] Connect Claude screen: Claude Code command, Claude Desktop config and `.mcpb` build steps, status
- [x] AI Activity panel: what Claude is working on, and one row per change with its op count and Undo
- [x] Headless screenshots: the scene, a single layer, or any component's patch graph or canvas, drawn as SVG and rasterized without the app
- [ ] Headless graph drawings sized for Windows and Linux fonts (partial: node boxes and labels are sized from a table measured in SF Pro and SF Mono on a Mac, so where the drawing uses other fonts, long labels can come out cut short with an ellipsis; tables for the fonts those systems draw with remain)
- [x] Optional in-app assistant (BYO Anthropic API key, kept in the OS keychain)
- [x] Usability study: a real Claude Code session completed four tasks (a beginner's like button, a designer's bottom sheet, debugging, explaining) using only MCP tools, and the problems it found are fixed
- [x] Behavioral evals: `node evals/run.ts` runs Claude Code headless on repeatable cases (the examples with their patches removed, the study's tasks, and regressions from test sessions) and checks what it built by simulation, with turns, tokens and error recovery per run. It runs by hand with your Claude account

## Stage 4: Distribution
- [x] macOS packaging: `npm run package -w @sonobe/desktop` builds an arm64 DMG with the CLI inside, and `package:verify` launches it muted and checks the MCP endpoint, the editor, and the CLI
- [x] Claude Code plugin and Claude Desktop extension build from a checkout, and their manifests list exactly the server's tools and prompts
- [ ] Signing: Developer ID identity, hardened runtime, and notarization on macOS; code signing on Windows; TestFlight for Sonobe Viewer (partial: local builds are ad-hoc signed with hardened runtime off, which runs only on the Mac that built them, and Sonobe Viewer installs only from Xcode with your own team)
- [ ] Windows and Linux packaging verification (partial: electron-builder targets exist for NSIS, AppImage, and deb on x64 and arm64, and Connect Claude handles Windows paths and quoting, but none of those builds has been run and verified; the Intel macOS DMG is untested too)
- [ ] Downloads: release builds, a prebuilt `.mcpb`, and a plugin marketplace listing (partial: all three build locally, but nothing is published, and a marketplace copy must ship the plugin's built `dist/`)
- [ ] Publish the CLI to npm (partial: the bundle is self-contained, but the package is still private and lists workspace packages as dependencies)
- [ ] Docs site generated from the patch catalog and guides (partial: `generate-docs.ts` writes the Markdown patch reference, and the Learn drawer shows the guides and reference in the app; a website remains)

## Stage 5: Bring work in, build together
- [x] Import designs from code: `@sonobe/import` reads a rendered page (computed layout and styles, so any framework and any CSS) into a neutral design capture and converts it into layers, image assets, text fields and Scroll patches. The desktop app renders URLs and HTML in a hidden sandboxed window (File → Import Design…), the browser editor renders HTML in a sandboxed iframe, headless servers use Playwright, and pasting a capture imports it. Claude imports with `import_design` from a dev server, from HTML it writes from any codebase, or from a capture
- [x] Import fidelity: web fonts come along as font assets that every renderer registers
- [x] Import hologram: the Import Design dialog shows a hologram scanner while it captures, and every import (the dialog, a pasted capture, Claude's `import_design`) lands on the canvas as a hologram whose laser traces the wireframe div by div, then materializes the design, with the screen's selection held back until it lands and a crossfade under reduced motion
- [x] SF Symbols in imports: `<svg data-sf-symbol="heart.fill">` in imported HTML becomes the real symbol as an SVG image, drawn on the person's Mac by a small SwiftUI helper the app ships (macOS 13 or later; headless servers use it through `SONOBE_SFSYMBOL`). Elsewhere it stays a gray placeholder with a note
- [ ] Insert → SF Symbol picker: search the symbols in the editor and insert one as a layer, drawn by the same helper (partial: symbols arrive only through imported HTML today)
- [ ] Rich text layers (partial: an imported paragraph that mixes styles becomes a group of single-style runs per line, which looks right but edits in pieces; paragraphs over 16 lines flatten to their main style)
- [x] Chrome extension (`integrations/chrome-extension`): copy a page, or pick an element, with the same DOM walker, and paste it into Sonobe. Built and loaded unpacked from a checkout (partial: not published to the Chrome Web Store)
- [ ] Figma import (partial: `integrations/figma-plugin` copies a selection as a design capture that pastes into Sonobe; the mapping has unit tests and the bundle runs against a stand-in API, but it hasn't been verified inside Figma or published)
- [ ] Origami JSON import (stretch): map layers and patches onto their Sonobe equivalents, using the Origami names the patch catalog already records
- [ ] Collaboration: several people and Claude in one document, building on today's per-author history, presence, and conflict checks

## Origami parity checklist (tracked)

| Area | Items |
|---|---|
| Panels | Layers, Canvas, Patch Editor, Inspector, Viewer, Patch Library, Bottom HUD (console, performance) |
| Layer types | group, rectangle, oval, text, image, video, shape, color fill, gradient, hit area, text field, lottie, shader, clone, component instance |
| Layout | row / column / grid, spacing modes, padding, alignment, auto / grow / percent sizing, absolute children |
| Patch categories | interaction, animation, state, logic, math, loops, text, color, data, device, media, shapes, layers, utility, components, scripting |
| Semantics | pulses (consecutive-frame capable), rising-edge inference, loops (max+wrap, per-index state), back edges with 1-frame latency, Rebound springs, retargeting with velocity |
| Components | patch/layer components, published ports, loop behavior per input, container components, libraries |
| Scripting | JavaScript patch (inputs/outputs/evaluate/loopAware/variants), math expression, shader layer |
| Organization | comments, variables (local/global), Tidy Up, align, rename, replace with, reset to defaults, search by layer |
| Viewer | device presets, frame, restart, 120fps, recording, phone preview |
