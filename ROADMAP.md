# Sonobe Roadmap

Sonobe ships in stages. Each stage ends when typecheck and tests pass, the app runs, and an adversarial review finds no blocking issues.

## Stage 1: Foundations
- [ ] `@sonobe/core`: document model, ops and inverse, history, diagnostics, canonical file format, outline
- [ ] `@sonobe/engine` building blocks: springs (Rebound-exact), curves, decay/momentum, matrices, layout, hit testing, gestures
- [ ] `@sonobe/renderer`: DOM renderer for every layer type, input capture, text measurer, CSS device frames
- [ ] Editor design system, app shell, and widget kit
- [ ] Electron shell: menus, file IO bridge, RPC bridge, localhost MCP endpoint skeleton
- [ ] Patch catalog: specs for all supported patches (ports, behavior, docs, tiers)
- [ ] Concept guides

## Stage 2: The engine comes alive
- [ ] Runtime evaluator: topological evaluation, back edges, pulses, loops with per-index state, component instances, variables
- [ ] Patch implementations: tier 1 (ISAT core and everyday patches), then tier 2 and tier 3
- [ ] MCP server: discovery, read, write, simulate, screenshot, presence, history tools; headless host; stdio relay
- [ ] CLI: `sonobe validate | fmt | sim | mcp | new`
- [ ] Editor integration: store and history, layer list, inspector, patch editor (xyflow), patch picker, viewer running the engine and renderer

## Stage 3: Parity and polish
- [ ] Patch editor power features: link-drag search, knife cut, drop-on-wire insert, option-drag duplicate, single-key inserts, Tidy Up, comments, components (enter/exit, publish ports), variables, live values on hover, pulse sparks, loop badges
- [ ] Canvas: direct manipulation, snapping, insert shapes and text, alignment tools
- [ ] Layer ↔ patch bridges: Touch button, inspector property links, drag a cable onto a property
- [ ] Viewer: device picker, frame, restart, hit-target overlay, pop-out, recording, LAN web player with QR code
- [ ] Assets: images, video, sound, fonts, Lottie (drag and drop)
- [ ] Examples: 15 canonical recipes as runnable projects with scripted tests
- [ ] Learn panel: interactive lessons, recipes, patch reference
- [ ] Connect Claude screen: Claude Code command, Claude Desktop `.mcpb`, status
- [ ] Optional in-app assistant (BYO Anthropic API key)

## Stage 4: Distribution
- [ ] Packaging: signed macOS DMG, Windows NSIS, Linux AppImage/deb
- [ ] Claude Code plugin and Claude Desktop extension
- [ ] Docs site generated from the patch catalog and guides
- [ ] Import: Figma frames (plugin/REST), Origami JSON (stretch)

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
