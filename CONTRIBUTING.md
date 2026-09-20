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

`apps/ios` is a small Swift app built with Xcode, not npm. It plays the web player (`apps/desktop/player`) in a WKWebView and adds a native bridge for haptics and the player menu's Open Another Prototype, so player changes reach it without Swift changes. [apps/ios/README.md](apps/ios/README.md) has the details.

- Build for the Simulator, no signing needed: `xcodebuild -project apps/ios/SonobeViewer.xcodeproj -scheme SonobeViewer -sdk iphonesimulator -derivedDataPath apps/ios/build CODE_SIGNING_ALLOWED=NO build`.
- Test with `npm run test:ios`. It serves a test prototype with the real player, runs the Swift unit and UI tests on a simulator, and checks the haptics the app played. It isn't part of CI, so run it when you change the app, the player, or the bridge.
- To run on your own iPhone, copy `apps/ios/Config/Local.xcconfig.example` to `Local.xcconfig` and set your team and a bundle id of your own. Git ignores `Local.xcconfig`. Never commit a team ID, a bundle id of your own, or other signing settings to the project.
- The bridge has two sides: `apps/desktop/player/platform.ts` and `apps/ios/SonobeViewer/Haptics.swift` (with `PlayerView.swift`, which acts on the menu's messages). Change them together, bump the bridge version when you add a message, and update ARCHITECTURE.md §9.2. A player test checks that the app's haptic types exist in the catalog.
- The player's other services are the editor viewer's own (`packages/renderer/src/platform.ts`), so a service added there reaches phones too. Check it against the player page's CSP in `apps/desktop/electron/lan-preview.ts`, and loosen the policy only as far as the service needs.

## Changing how patch editor nodes look

Tidy Up, MCP `tidy_graph` and `add_patches`, and automatic node placement size nodes without a DOM, from the model in `packages/core/src/graph/nodeSize.ts`, which follows `apps/editor/src/panels/patch-editor/patch-editor.css`. When you change the node CSS (padding, gaps, fonts, chips, inline values):

1. Update `NODE_BOX` or `NODE_FONTS` in `nodeSize.ts` to match, and the shapes in `nodeShape.ts` when a node shows something new. When a live value or a knob value can print something longer, raise its reserve in `format.ts` (`formatValueReserve`, `knobValueReserve`), which keeps nodes from resizing while the prototype runs; a live value past its reserve ends in "…".
2. On macOS, regenerate the font table with `node apps/editor/scripts/measure-node-fonts.ts`.
3. Run `npx playwright test e2e/node-sizes.spec.ts`. It compares the estimate against the drawn nodes. With `SONOBE_UPDATE_NODE_SIZES=1` it also rewrites `packages/mcp/fixtures/node-sizes`, which `packages/mcp/src/geometry.test.ts` checks the headless estimate against. Knob chips (`.sb-pe-value--knob`) are checked in `e2e/knobs.spec.ts`.
4. Rebuild the examples with `node examples/build.ts`. Their graphs are laid out from the estimated sizes, so wider nodes get the room they need, and `examples/run.test.ts` fails when two patch nodes come within 12 pt of each other.

## Adding an MCP tool

Claude sees a tool in several places, and tests check that they agree:

1. Register it in `packages/mcp/src/tools/` with `tc.tool(name, config, handler)`, and add its name to `TOOL_NAMES` in `packages/mcp/src/server.ts`, next to its group. Give it a description that says when to use it, annotations (read-only, destructive or UI only) and, for writes and simulation, an `outputSchema`.
2. Keep its input a closed `z.object`. The tool wrapper refuses fields a tool doesn't take, with the closest field it does (`packages/mcp/src/inputs.ts`), and `inputs.test.ts` calls every tool with a made-up field. Use `z.looseObject` or `z.record` only where values really pass through.
3. Add it to `integrations/claude-desktop/manifest.json` in `TOOL_NAMES` order, to the tool tables in `packages/mcp/README.md` and ARCHITECTURE.md §10, and to the tool count in README.md and guide 11. `integrations.test.ts` and `packages/cli/src/docs.test.ts` fail until they match.
4. Call it in `payload.test.ts`, which calls every tool once, and add it to the annotation checks in `discovery.test.ts`.
5. Teach it where Claude learns the workflow: the agent guides in `packages/mcp/guides`, the server instructions in `server.ts` when it changes the steps, and the Claude Code skill (`integrations/claude-code/skills/sonobe/SKILL.md`).

## Adding an MCP tool that can take long

Tools register in `packages/mcp/src/tools/` with `tc.tool(name, config, async (args, ctx, work) => …)`. When a call can take more than a second or two (loading a page, waiting on the person), use `work` (`packages/mcp/src/progress.ts`, ARCHITECTURE §10 "Long calls"):

1. Wrap each slow host call in a step: `work.step("Loading the page", (control) => host.captureDesign(request, control), { deadlineMs })`. The step sends its message as progress, repeats it while the host works (until the deadline), and rejects at once when the call is cancelled.
2. Pass the step's `control` on. A host method that can run long takes it as a trailing `control?: HostCallControl` argument, keeps its request plain data, reports stages with `control.progress`, and stops and frees what it holds when `control.signal` aborts. Keep the host's own deadline shorter than the step's, so its error, which says more, comes first.
3. Pass `signal: work.signal` (or `tc.signal(ctx)`) to `host.apply` and `history.undo`, so a cancelled call never changes the document. Call `work.throwIfCancelled()` between steps. In a long synchronous loop, `await work.checkpoint()` now and then.
4. Test it with a v1 SDK client: `client.callTool(params, undefined, { onprogress, resetTimeoutOnProgress: true, timeout: 500 })` for progress, and `{ signal }` to cancel. `packages/mcp/src/import.test.ts` has examples.

## Changing the in-app Assistant

The Assistant's main-process side (`apps/desktop/electron/assistant`) and the editor (`apps/editor/src/panels/assistant`, `panels/design`) talk over IPC:

1. A new request field or event goes in four places: `protocol.ts`, the editor's mirror in `panels/assistant/types.ts`, the preload (`assistant/preload.ts`) and main's sanitizer (`register.ts`, or `sanitizeCanvasContext` in `assistant/design.ts` for the canvas's context). The last two drop fields they don't know.
2. The Assistant's own tools (the code folder's `list_code_files`, `search_code` and `read_code_file`) aren't MCP tools: keep them out of `TOOL_NAMES`, the tool tables and the counts. An MCP tool the API-key path shouldn't have goes in `ASSISTANT_HIDDEN_TOOLS` (`toolBridge.ts`) with what it does instead, as `preview_design` does, since the canvas already draws the Assistant's `import_design` html as it streams. The bridge leaves out the instruction lines, input properties and description clauses that name it, and adds that note to a result that does (a guide). The subscription path's bridge hides nothing, because Claude Code draws through `preview_design`.
3. A new document tool takes `docId`, or goes in `UNPINNED_TOOLS` (`agent.ts`); `toolBridge.test.ts` fails until it does. Both engines call tools through `toolRunner.ts`, so pinning, the replace guard and confirmations change there once. On the subscription path, a tool that reaches outside the window's prototype goes in `ASKING_TOOLS` (`acp/engine.ts`), as `save_document`, `open_document` and `create_document` do: it stays out of the session's `allowedTools`, so Claude Code asks first, and Sonobe asks itself when Claude Code didn't.
4. Test with fakes: `scriptedClient` and `fakeBridge` (`assistant/testing.ts`), `fakeAssistantHost` in the editor, and `e2e/fakeAssistant.ts` for Playwright. The subscription path's tests run `apps/desktop/tests/fake-claude-agent.mjs`, a fake ACP agent, in place of Claude's agent adapter, by pointing `SONOBE_CLAUDE_AGENT` at it. It calls the per-chat tool endpoint the way the adapter does, a word in the message picks what it does (`design`, `save`, `crash`, `sessionend`, `limit`, `hang` and the others its header lists), `FAKE_CLAUDE_MODE` picks the permission mode its sessions start in, and `FAKE_CLAUDE_LOG=<file>` records what it was sent. No test uses an API key, starts the real adapter or needs a Claude account.

The subscription path is experimental and off by default. Only the app run from a checkout offers its switch: `electron/main.ts` sets the connection's `available` to `!app.isPackaged`, so no packaged build, and so no release, can offer it, and no environment variable changes that ([ARCHITECTURE.md](ARCHITECTURE.md) §10). Keep that gate until Anthropic agrees. To try it on your own machine:

1. Install the adapter with `npm install -g @agentclientprotocol/claude-agent-acp` (it needs Node.js 22 or later). It draws on your Claude plan's usage limits.
2. Run the desktop app from a checkout: `npm run desktop` (or `npm run start -w @sonobe/desktop`). A DMG from `npm run package -w @sonobe/desktop` doesn't offer the switch.
3. Turn on **Use my Claude subscription in the Assistant** in Settings → Claude, and choose **Claude subscription** in the Assistant. If Claude isn't signed in, **Sign in…** opens Terminal for it, or run `claude-agent-acp --cli auth login` yourself.
4. To use another copy of the adapter, or the fake agent without a Claude account, start the app with `SONOBE_CLAUDE_AGENT` set to its absolute path.

## Measuring how well Claude builds with Sonobe

`evals/` holds behavioral evals: Claude Code gets a prompt and a start project, builds through Sonobe's MCP tools alone, and the runner simulates the result and checks layer properties. It records pass or fail, turns, tokens, time, tools, and each error code with whether Claude recovered. Runs use your Claude account, so they're not part of `npm test` or CI.

1. When you change tools, tool descriptions, guides or server instructions, run the affected cases before and after: `npm run build -w @sonobe/cli`, then `node evals/run.ts --case "retro-*" --model sonnet --runs 3`. Compare the two `summary.md` files.
2. Add a case when you fix something Claude kept getting wrong: a start project, a prompt, a `test.json` on layer properties, and a `solution.json`. `npx vitest run evals` checks that the start fails and the solution passes.

[evals/README.md](evals/README.md) has the case format and the options.

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
- SF Symbols are Apple's. The sfsymbol helper (`apps/desktop/native/sfsymbol`) draws them on the person's Mac when they import, from their copy of macOS. Never commit symbol artwork, exported symbol SVGs or PNGs, or Apple's symbol lists, not even as test fixtures: tests draw what they need at run time.

## Pull requests

- Keep PRs focused. Update docs and tests alongside the code.
- `npm run typecheck && npm test` must pass. CI (`.github/workflows/ci.yml`) runs them and `npm run e2e` on every pull request.
- For UI changes, attach a screenshot or short recording.
- Be kind. People of every experience level contribute here, and helping beginners is part of the mission.
