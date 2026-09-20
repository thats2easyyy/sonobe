# Contributing to Sonobe

Thanks for helping make interaction prototyping open to everyone. Bug reports, patches, recipes, and guides are all welcome, whether you write the change yourself or build it with an AI assistant.

## Setup

```bash
npm install
npm run dev        # editor in the browser (http://localhost:5199)
npm run desktop    # Electron app
npm test           # unit tests (Vitest)
npm run typecheck
npm run e2e        # Playwright end-to-end tests
npm run test:ios   # Sonobe Viewer on an iOS Simulator (macOS with Xcode)
```

Node 22.18+ is required. Node 24 is what CI uses.

## Read this first

[ARCHITECTURE.md](ARCHITECTURE.md) is the contract. The most important rules:

1. **Every document change goes through `applyOps()`.** The UI, MCP tools, CLI, and scripts all use the same op engine, so every change can be undone, validated, and attributed.
2. **Declarations drive everything.** A patch type is declared once in `packages/patches/catalog/*.json`: ports, types, defaults, docs, and behavior. The runtime, inspector, picker, docs, and MCP schemas are generated from that declaration.
3. **The engine stays headless.** `@sonobe/engine` has no DOM. Anything visual belongs in `@sonobe/renderer` or `apps/editor`.
4. **Keep it deterministic.** Given the same document and the same input events, the engine must produce the same frames. Use `services.random()` and `services.now()`, never `Math.random()` or `Date.now()`, inside patches.

## Adding or fixing a patch

1. Find the entry in `packages/patches/catalog/<category>-<n>.json` and follow [CONVENTIONS.md](packages/patches/catalog/CONVENTIONS.md).
   - The `behavior` field is the implementation spec.
   - The `docs` field is what users read.
2. Implement it in `packages/patches/src/<category>/<type>.ts` with `definePatch(type, { state, evaluate })`, then add it to that category's `index.ts`.
3. Test it in `<type>.test.ts` with the harness in `@sonobe/engine/testing`. Cover pulses, loops (per-index state), and edge cases.
4. Regenerate the reference docs with `node packages/patches/scripts/generate-docs.ts`.

## Working on Sonobe Viewer (iPhone)

`apps/ios` is a small Swift app built with Xcode, not npm. It plays the web player (`apps/desktop/player`) in a WKWebView and adds a haptics bridge, so player changes reach it without Swift changes. [apps/ios/README.md](apps/ios/README.md) has the details.

- Build for the Simulator, no signing needed: `xcodebuild -project apps/ios/SonobeViewer.xcodeproj -scheme SonobeViewer -sdk iphonesimulator -derivedDataPath apps/ios/build CODE_SIGNING_ALLOWED=NO build`.
- Test with `npm run test:ios`. It serves a test prototype with the real player, runs the Swift unit and UI tests on a simulator, and checks the haptics the app played. It isn't part of CI, so run it when you change the app, the player, or the bridge.
- To run on your own iPhone, copy `apps/ios/Config/Local.xcconfig.example` to `Local.xcconfig` and set your team and a bundle id of your own. Git ignores `Local.xcconfig`. Never commit a team ID, a bundle id of your own, or other signing settings to the project.
- The bridge has two sides: `apps/desktop/player/platform.ts` and `apps/ios/SonobeViewer/Haptics.swift`. Change them together, and update ARCHITECTURE.md §9.2. A player test checks that the app's haptic types exist in the catalog.

## Code style

- TypeScript, strict ESM. Relative imports use explicit `.ts`/`.tsx` extensions.
- Import types with `import type`. Don't use enums, namespaces, or parameter properties, because the code runs under Node type stripping.
- Keep doc comments short on public APIs and skip filler comments.
- Format with Prettier (`npm run format`).

## Clean-room policy

Sonobe reimplements interaction-prototyping concepts from public documentation and observable behavior.

- Don't contribute code, assets, icons, device imagery, or text copied from Origami Studio, Meta, Apple, or any other proprietary product.
- Describe behavior in your own words.
- Mention other products only to describe compatibility (for example, the `origami` mapping fields in the catalog).

## Pull requests

- Keep PRs focused. Update docs and tests alongside the code.
- `npm run typecheck && npm test` must pass.
- For UI changes, attach a screenshot or short recording.
- Be kind. People of every experience level contribute here, and helping beginners is part of the mission.
