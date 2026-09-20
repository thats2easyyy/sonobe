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
- [x] MCP server: discovery, read, write, simulate, screenshot, presence, history tools; headless host; stdio relay
- [x] CLI: `sonobe new | validate | fmt | outline | describe | sim | mcp`
- [x] Editor integration: store and history, layer list, inspector, patch editor (xyflow), patch picker, viewer running the engine and renderer

## Stage 3: Parity and polish
- [x] Patch editor power features: link-drag search, knife cut, ⌘-drag splice onto a wire, option-drag duplicate, single-key inserts, Tidy Up, comments, components (enter/exit, publish ports), variables, live values on hover, pulse sparks, loop badges
- [x] Canvas: direct manipulation, snapping, insert shapes and text, alignment tools
- [x] Layer ↔ patch bridges: Touch button, inspector property links, drag a cable onto a property
- [ ] Viewer: device picker, frame, restart, hit-target overlay, pop-out window, LAN web player with QR code, recording (partial: recording remains)
- [ ] Native iPhone preview: Sonobe Viewer (`apps/ios`) plays the LAN web player full screen with real haptics. Haptic and Vibrate reach UIFeedbackGenerator and Core Haptics over a small bridge, the app scans the Preview on Phone code, and `npm run test:ios` runs its tests on a simulator. Android phones vibrate in the browser. The phone gets the viewer's sound, network requests, links and camera, restarts when Sonobe does, and opens a menu with a three-finger tap (partial: tested only in the Simulator, and built from source until TestFlight)
- [x] Assets: images, video, sound, fonts, Lottie (drag and drop)
- [x] Examples: 16 canonical recipes as runnable projects with scripted tests
- [x] Learn panel: 5 interactive lessons, the guides, the examples, and the patch reference
- [x] Welcome screen: new blank prototype, lessons, templates from the examples, recent files
- [x] Connect Claude screen: Claude Code command, Claude Desktop config and `.mcpb` build steps, status
- [x] AI Activity panel: what Claude is working on, and one row per change with its op count and Undo
- [x] Headless screenshots: the scene drawn as SVG and rasterized without the app
- [x] Optional in-app assistant (BYO Anthropic API key, kept in the OS keychain)
- [x] Usability study: a real Claude Code session completed four tasks (a beginner's like button, a designer's bottom sheet, debugging, explaining) using only MCP tools, and the problems it found are fixed

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
- [x] SF Symbols in imports: `<svg data-sf-symbol="heart.fill">` in imported HTML becomes the real symbol as an SVG image, drawn on the person's Mac by a small SwiftUI helper the app ships (macOS 13 or later; headless servers use it through `SONOBE_SFSYMBOL`). Elsewhere it stays a gray placeholder with a note. Next: an Insert → SF Symbol picker
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
