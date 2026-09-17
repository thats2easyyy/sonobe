# Technology Stack and Open-Source Prior Art for an AI-Native, Open-Source Origami Studio Alternative (2026)

Research date: **2026-09-16**. Target environment: macOS arm64, Node 26.5.0 / npm 11.17.0 (VERIFIED locally), no Rust toolchain, TypeScript-first agents.

Legend: **[VERIFIED]** = seen in a primary source or the npm registry / GitHub API during this session. **[INFERRED]** = my engineering judgment, derived reasoning, or knowledge not re-verified in this session.

Method notes:
- Package versions come straight from the npm registry (`npm view`, run 2026-09-16), and repo licenses, stars, and archive status come from the GitHub REST API (`gh api repos/...`). Both are [VERIFIED] as of the date above.
- The web-search budget for the session ran out partway through. After that, all verification went through direct page fetches, the npm registry, the GitHub API, and DNS lookups. A few product-conflict checks for names are marked as incomplete for this reason.
- **Doc-vs-release-notes discrepancies found** (the brief said to flag these):
  1. Origami Studio's "Previewing & Sharing" documentation (https://origami.design/documentation/workflow/previewsharing) only covers USB mirroring and has old app links. The App Store listing describes USB **or Wi-Fi**, and the release notes (https://origami.design/releases/) show much newer features: v226 (08/19/2026) font embedding into prototypes and variable fonts, v221 JS Patch LLM generation plus a CLI that converts Origami files to JSON, v223 Shader Layer LLM generation, v227 (08/31/2026) a higher token limit for JS Patch and Layer Shader "when using Anthropic provider", and v228 (09/07/2026) as the latest. [VERIFIED]
  2. A fetch of Electron's `electron-timelines` doc page returned an obviously stale or garbled table ("Electron 45 / Chromium 130"). I discarded it and used https://releases.electronjs.org/schedule plus the release blog posts instead. [VERIFIED]
  3. Tauri's release page lists `updater` plugin **v2.10.1 (Apr 4, 2026)**, while npm has `@tauri-apps/plugin-updater` **2.11.0**. The Rust crate and the JS guest package are versioned separately, so they don't match. [VERIFIED both numbers]
  4. Motion's spring docs page (https://motion.dev/docs/spring) lists `stiffness` default **1**. I remember the source default (`springDefaults.stiffness`) as **100**. Check the `motion-dom` source before relying on either number. [page VERIFIED; conflict INFERRED]

---

## 0. TL;DR — Recommended stack (September 2026)

| Layer | Choice | Version (npm, 2026-09-16) | Why (short) |
|---|---|---|---|
| Desktop shell | **Electron** | `electron` 44.4.1 (44.0.0 stable 2026-08-24; **45 stable 2026-10-19**) | Bundled Chromium gives the same rendering on mac, win, and linux. Node in main makes a local MCP server and LAN server trivial. No Rust needed. Signing and auto-update are mature. |
| Build tool | **electron-vite** | 5.0.0 (peer `vite ^5‖^6‖^7`); 6.0.0-beta.1 adds `^8` | HMR for renderer, hot reload for main and preload, one config. |
| Bundler | **Vite 7.3.6** now, Vite 8.3.0 once electron-vite 6 is stable | `vite` 7.3.6 / 8.3.0 | electron-vite 5 does not accept Vite 8. |
| React plugin | `@vitejs/plugin-react` **5.2.0** | 5.2.0 (supports vite 4–8). 6.1.1 needs `vite ^8` | Compatibility with electron-vite 5 plus Vite 7. |
| Packaging / updates | **electron-builder + electron-updater** | 26.15.3 / 6.8.9 | NSIS, DMG+ZIP, AppImage/deb/rpm/pacman updates. Staged rollouts. GitHub/S3/R2/generic providers. |
| Signing | `@electron/notarize` (via builder), Azure Artifact Signing on Windows | `@electron/notarize` 3.1.1, `@electron/fuses` 2.1.3 | Apple notarization. EV or cloud signing on Windows. |
| UI framework | **React 19** | `react` 19.3.0 | Largest ecosystem, and React Flow depends on it. |
| Node editor | **React Flow (`@xyflow/react`)** behind our own graph model | 12.11.6 (MIT) | DOM nodes are accessible and testable by agents. Built-in keyboard a11y, MiniMap, `onlyRenderVisibleElements`. Keep an escape hatch to a canvas renderer. |
| Auto-layout | `elkjs` | 0.12.0 | Layered layout for "tidy up" and AI-generated graphs. |
| Prototype renderer | **Our own layer-tree → DOM/CSS renderer**, plus WebGL2/WebGPU canvases for shader layers | (custom); PixiJS 8.20.1 optional | Best text quality, the same engine desktop and phone, composite-only transforms. |
| Physics | **Own `@app/physics` package**: rebound-compatible RK4 plus analytic closed form | (custom) | Origami parity (tension/friction, bounciness/speed) and deterministic stepping. |
| Editor-chrome motion | `motion` | 13.4.0 (MIT) | Polished UI transitions. `MotionGlobalConfig.skipAnimations` / `instantAnimations` / `useManualTiming` for tests. |
| Document CRDT | **Yjs** | `yjs` 13.6.32 (MIT) | Mature. `Y.UndoManager` with `trackedOrigins` gives per-actor (human vs AI) undo. |
| View store | **Zustand** | 5.0.15 | Selector-based React subscriptions derived from the Y.Doc. |
| Schema | **zod 4** → JSON Schema 2020-12 | `zod` 4.6.5 | One source of truth for the doc format, runtime validation, and MCP `inputSchema`. |
| Ordering | `fractional-indexing` | 4.0.0 | Figma-style sibling order for layers. |
| MCP | **`@modelcontextprotocol/server` v2** + `@modelcontextprotocol/node` | 2.0.0 (spec 2026-07-28) | Stateless spec. Standard Schema (zod v4). Streamable HTTP plus stdio. |
| MCP distribution | `.mcpb` bundle (`@anthropic-ai/mcpb`) | 2.1.2 | One-click install in Claude Desktop, which has built-in Node. |
| LAN live preview | Node `http` + `ws` + `bonjour-service` + `qrcode` | 8.21.3 / 1.4.4 / 1.5.4 | "Live" web player on a phone over Wi-Fi. |
| Monorepo | **npm workspaces + Turborepo** | `turbo` 2.10.13 | Native to the environment. Turbo supports npm workspaces. |
| Unit tests | **Vitest 5** | 5.0.1 (Node ≥22.12, Vite ≥6.4) | Fast. Browser mode with trace view. |
| E2E | **Playwright `_electron`** | 1.63.0 | Drives the real app. The API is marked experimental. |
| TS compiler | **TypeScript 7.0** for type checking; lint with **oxlint** or **Biome** (or pin `typescript@6.0.3` for typescript-eslint) | `typescript` 7.0.2; `oxlint` 1.83.0; `@biomejs/biome` 2.5.14 | TS 7 (Go) is about 10x faster but has no stable programmatic API until 7.1. |

Top-level rationale: **use one engine everywhere.** Electron (Chromium) on desktop and a web player on the phone both run the *same* TypeScript runtime and DOM renderer. The document is a CRDT with origins, so human edits and AI edits are both first-class, attributable, and undoable. zod schemas generate the JSON Schemas that the MCP tools expose. Physics and the patch runtime are pure functions of `(state, t, dt)`, which keeps tests deterministic.

---

## 1. Desktop shell

### 1.1 Electron — current state [VERIFIED unless marked]

- **Latest:** `electron` **44.4.1** on npm (modified 2026-09-16). Electron 44.0.0 came out **2026-08-25** (blog) / stable 2026-08-24 (schedule) with **Chromium 152.0.7977.54, V8 15.2, Node v24.18.1**. https://www.electronjs.org/blog/electron-44-0
- Electron 44 features: W3C-style async clipboard with `ClipboardItem`; cross-platform **window state persistence** (position, size, display modes); Linux badge and progress without libunity.
- Electron 44 breaking changes: **macOS 12 dropped (macOS 13+ required)**; clipboard module **no longer accessible from renderer** (use `navigator.clipboard`); **Windows x86 and Linux armv7l builds discontinued**; ANGLE statically linked everywhere; Unity DE support removed. Electron 41.x reached end of support.
- **Schedule** (https://releases.electronjs.org/schedule):

| Version | Alpha | Beta | Stable | EOL | Chromium | Node |
|---|---|---|---|---|---|---|
| 46.0.0 | 2026-10-21 | 2026-11-30 | 2027-01-04 | 2027-06-21 | M160 | 24.21.0 |
| 45.0.0 | 2026-08-26 | 2026-09-28 | **2026-10-19** | 2027-04-26 | M156 | 24.21.0 |
| 44.0.0 | 2026-07-01 | 2026-07-27 | 2026-08-24 | 2027-03-01 | M152 | 24.18.1 |
| 43.0.0 | 2026-05-06 | 2026-06-01 | 2026-06-29 | 2027-01-04 | M150 | 24.17.0 |
| 42.0.0 | 2026-03-11 | 2026-04-06 | 2026-05-04 | 2026-10-19 | M148 | 24.15.0 |

- Cadence: **8-week majors**. Policy: "The latest three *stable* major versions are supported." (Electron timelines doc, and 44 blog post.)
- Recent majors: 41 (2026-03-10; ASAR integrity digest, Wayland improvements, **MSIX auto-updater support**), 40 (2026-01-13; Chromium 144, Node 24.11.1), 39 (2025-10-28; **ASAR integrity stable**), 38 (2025-09-09). Blog post "How Electron went Wayland-native" (2026-03-17). https://www.electronjs.org/blog
- **`utilityProcess.fork(modulePath, args, options)`** starts a Node child process through Chromium's Services API with `MessagePort`s. Options: `serviceName`, `stdio` (`pipe`/`ignore`/`inherit`, default `inherit`), `execArgv`, `env`, `allowLoadingUnsignedLibraries` (macOS), `respondToAuthRequestsFromMainProcess`. The child talks to the parent over `process.parentPort`. https://www.electronjs.org/docs/latest/api/utility-process
- **Code signing** (https://www.electronjs.org/docs/latest/tutorial/code-signing):
  - macOS: `@electron/osx-sign` plus `@electron/notarize`. You need an Apple Developer Program membership. `safeStorage`, `app.setLoginItemSettings()`, cookie encryption, and `autoUpdater` **require** signing and notarization.
  - Windows: the doc says "since June 2023, Microsoft requires software to be signed with an 'extended validation' certificate", and OV/authenticode certs "no longer provide benefits". EV keys must live in FIPS 140 Level 2 HSMs. **Azure Artifact Signing (formerly Azure Trusted Signing)** is the cheaper cloud option, and `jsign` can sign from macOS or Linux.
  - Forge integrates `@electron/windows-sign`. electron-builder has its own signing implementation.

### 1.2 Build and packaging tooling [VERIFIED]

| Tool | Version | Status / facts | Fit |
|---|---|---|---|
| **electron-vite** (alex8088, MIT, 5.6k★) | 5.0.0 latest; 6.0.0-beta.1 | Docs v5.0.0: "instant HMR for renderer processes", hot reloading for main and preload, **V8 bytecode source protection**, **isolated build mode** for sandbox. Node `^20.19.0 ‖ >=22.12.0`. Peer: **v5 `vite ^5‖^6‖^7`**, **v6-beta `vite ^6‖^7‖^8`**. Scaffold: `npm create @quick-start/electron@latest my-app -- --template react-ts`. https://electron-vite.org/guide/ | **Recommended** for dev and build. |
| **Electron Forge** (official, MIT, 7.1k★) | `@electron-forge/cli` 7.11.2 latest; **8.0.0-alpha.10** (2026-07-02) | "As of Electron Forge v7.5.0, Vite support ... has been marked as **experimental**" and minor releases may break it. https://www.electronforge.io/templates/vite. The Electron docs call Forge "recommended" for signing. | Good official option, but its Vite plugin is still experimental. |
| **electron-builder** (MIT, 14.7k★) | 26.15.3; `electron-updater` 6.8.9 | Auto-update targets: **macOS DMG (needs ZIP target for `latest-mac.yml`)**, **Windows NSIS only (no Squirrel.Windows)**, **Linux AppImage, DEB, Pacman, RPM**. Providers: GitHub Releases, S3, DigitalOcean Spaces, **Cloudflare R2**, Keygen, generic HTTP(S). **Staged rollouts** via `stagingPercentage` in `latest.yml`. "macOS application must be signed in order for auto updating to work." Minimal code: `import { autoUpdater } from "electron-updater"; autoUpdater.checkForUpdatesAndNotify()`. Security defaults noted: `disableWebInstaller: true`, `allowUnverifiedLinuxPackages`. https://www.electron.build/docs/features/auto-update/ | **Recommended** for packaging and updates. |

**Compatibility trap [VERIFIED]:** `@vitejs/plugin-react` 6.1.1 needs `vite ^8.0.0`, and electron-vite 5.0.0 only accepts up to Vite 7. Coherent stable set: **electron-vite 5.0.0 + vite 7.3.6 + @vitejs/plugin-react 5.2.0**. Switch to electron-vite 6 + Vite 8.3.0 + plugin-react 6 once electron-vite 6 is stable. Vitest 5 accepts `vite ^6.4‖^7‖^8`, so it works with either set.

Vite 8.0 (2026-03-12): Rolldown is the single Rust bundler, "up to 10-30x faster builds", Node 20.19+/22.12+, about 15 MB larger install, built-in devtools and TS path aliases. https://vite.dev/blog/announcing-vite8 [VERIFIED]

### 1.3 Tauri 2 [VERIFIED unless marked]

- Versions: `tauri` crate **2.11.5** (2026-07-01), `tauri-cli` 2.11.4, `@tauri-apps/cli` 2.11.4 (npm), `@tauri-apps/api` 2.11.1, `tauri-bundler` 2.9.4, `tauri-runtime-wry` 2.11.4. https://tauri.app/release/ (Apache-2.0/MIT, 111k★).
- **System webviews:** WKWebView on macOS, WebView2 (Chromium) on Windows, **WebKitGTK on Linux** (confirmed in the Electrobun docs and Tauri's Linux graphics page). So the desktop preview engine differs by OS: WebKit on mac, Chromium on Windows. For a pixel-sensitive prototyping tool that is a real product risk [INFERRED].
- **Linux graphics** (https://v2.tauri.app/develop/debug/linux-graphics/): blank or white windows, flicker, crashes on resize, DMABUF errors, mostly on NVIDIA. Workarounds: `__NV_DISABLE_EXPLICIT_SYNC=1`, `WEBKIT_DISABLE_DMABUF_RENDERER=1`, and as a last resort `WEBKIT_DISABLE_COMPOSITING_MODE=1`. The page warns: "WebGL and canvas content can silently land on a slow path while the rest of the app looks fine" and recommends non-WebGL fallbacks on Linux. That is a direct problem for a canvas-heavy app.
- **Node sidecar** (https://v2.tauri.app/learn/sidecar-nodejs/): compile the JS into a standalone binary (`pkg`, bun or deno compile), name it `my-sidecar-{target-triple}` (the guide uses `rustc --print host-tuple`), add it under `bundle.externalBin`, grant the shell plugin permission `"sidecar": true`, and call `Command.sidecar()`. Desktop only. This means the MCP server ships as a separately compiled binary per platform, and builds need the Rust toolchain.
- **Updater** (https://v2.tauri.app/plugin/updater/): signatures are mandatory ("This cannot be disabled"), using minisign keys. Artifacts: AppImage + `.sig`, macOS `.app.tar.gz`, Windows MSI/NSIS. Static JSON or dynamic endpoints with `{{current_version}}`, `{{target}}`, `{{arch}}`.
- Pros [INFERRED]: small bundles, low memory, strong capability-based security, mobile targets.
- Cons for us [INFERRED]: webview inconsistency across OSes, the Linux WebGL slow path, Rust build chain in CI, Node sidecar packaging friction, and less mature Playwright-style E2E.

### 1.4 Other shells (brief)

- **Electrobun** [VERIFIED from search snippets: blackboard.sh/electrobun, Founderland]: v1 landed on GitHub **Feb 6 (2026)**. Bun backend, native bindings in C++/ObjC/Zig, system webview by default with **optional bundled CEF**, claims about 14 MB bundles, under 50 ms launch, and 14 KB diff updates. Changelog shows v1.18.0. Promising, but young, and it depends on Bun (not Node 26) [INFERRED].
- NW.js, Wails (Go), Neutralino [INFERRED, not re-verified]: none beats Electron on a consistent Chromium engine plus a Node ecosystem with signing and updates, and Wails needs Go.

### 1.5 Bundling a local MCP server in Electron [design, INFERRED on top of VERIFIED APIs]

Recommended topology:

```
┌──────────────── Electron main process ────────────────┐
│  DocumentService (authoritative Y.Doc per open file)   │
│   ├─ ops API (validated by zod)                         │
│   ├─ MessagePortMain ⇄ renderer windows (Yjs updates)   │
│   ├─ LiveServer: http + ws on LAN (opt-in, token)       │
│   └─ McpHost: Streamable HTTP on 127.0.0.1:<rand>       │
│        (@modelcontextprotocol/server 2.0 + /node)       │
│        writes lockfile {port, token} to userData        │
└────────────────────────────────────────────────────────┘
        ▲ localhost HTTP (bearer token)
        │
  `app-mcp` stdio shim (tiny Node script, shipped in app resources and as .mcpb)
        ▲ stdio
  Claude Code / Claude Desktop / any MCP client
```

- Put the MCP tool implementations **in the main process or a `utilityProcess`** so they share the same ops layer as the UI. The `utilityProcess` + `MessagePort` pattern keeps heavy tool work (rendering previews, layout) off the main thread.
- Offer **two transports.** (a) **Streamable HTTP on loopback** for clients that support URLs. `@modelcontextprotocol/node` provides the Node HTTP transport, and the express/fastify/hono middlewares include **Host header validation**, which you should use to block DNS-rebinding. (b) A **stdio shim** for clients that launch commands. The shim reads the lockfile and proxies to the running app, launching the app if it isn't running.
- The shim can run via the Electron binary with `ELECTRON_RUN_AS_NODE`. That conflicts with hardening the `runAsNode` fuse through `@electron/fuses`, so ship the shim as a plain Node script inside a **`.mcpb` bundle** instead. Claude Desktop "includes a built-in Node.js environment" for bundles [VERIFIED: MCP blog / Claude help center snippets]. `.mcpb` is a ZIP with `manifest.json` plus server code, and it replaced `.dxt` in late 2025. https://blog.modelcontextprotocol.io/posts/2025-11-20-adopting-mcpb/
- Implement tools against spec **2026-07-28** (see §7).

### 1.6 Verdict

**Electron 44 → 45** with electron-vite and electron-builder. The deciding factors are the same Chromium on all three OSes (matching our web player's engine on Android and near-matching Safari on iOS), direct Node for MCP, LAN, and file I/O, no Rust, and mature signing and updates. Cost: about 100 MB+ bundles and higher memory [INFERRED], which is acceptable for a pro design tool (Figma, Linear, and VS Code are all Electron [INFERRED]).

---

## 2. Node editor foundations

### 2.1 React Flow / xyflow [VERIFIED]

- `@xyflow/react` **12.11.6** (2026-09-01), `@xyflow/svelte` 1.6.6, `@xyflow/system` 0.0.82. MIT, 38.4k★. Peer `react >=17`.
- Recent perf work (https://reactflow.dev/whats-new): **12.11.2** "Only create an `XYDrag` instance for draggable nodes", MiniMap re-render optimizations, "Viewport transform applied imperatively for single render". **12.11.3** middle-mouse panning with selection rectangles and touch selection-box fixes. **12.11.0** `autoPanOnSelection` and improved `useKeyPress`. **12.7.0 (June 2025)** `ariaRole`, `ariaLabelConfig`, `domAttributes`, `autoPanOnNodeFocus`. **March 2026** llms.txt doc endpoints. UI components updated for React 19 and Tailwind 4.
- Accessibility (https://reactflow.dev/learn/advanced-use/accessibility): Tab cycles nodes and edges; Enter/Space selects; Escape clears; **arrow keys move selected nodes** (Shift accelerates); Delete removes. Props: `nodesFocusable`, `edgesFocusable` (default true), `disableKeyboardA11y`, `autoPanOnNodeFocus`, `ariaLabelConfig`. Nodes and edges get `role="group"`. There is an `aria-live="assertive"` A11yDescriptions region.
- `onlyRenderVisibleElements?: boolean` is present in the 12.11.6 type definitions (checked in the package tarball).
- Performance guidance (https://reactflow.dev/learn/advanced-use/performance): memoize components passed as props (`React.memo` or declare them outside), and "One of the most common performance pitfalls in React Flow is directly accessing the `nodes` or `edges` in the components or the viewport". Also collapse large trees and simplify CSS (shadows, animations, gradients).
- Scale limits: maintainer answer (2023-04-18) in https://github.com/xyflow/xyflow/discussions/3003: "React Flow is not intended to be used in that kind of scale (really depends on the complexity of your nodes though)", and "a canvas based approach would be better". A 2025-12-16 comment reports trouble at 200+ nodes with 4000+ edges.
- Quantitative benchmark (Synergy Codes webbook, **100 nodes**, baseline 60 FPS): an unmemoized `onNodeClick={() => {}}` dropped drag to **10 FPS** (light nodes) or **2 FPS** (heavy DataGrid nodes); filtering node arrays in selectors gave 12 / 2 FPS; `React.memo` brought light nodes back to **60 FPS** and heavy nodes to 30 FPS. https://www.synergycodes.com/webbook/guide-to-optimize-react-flow-project-performance
- Why it fits us [INFERRED]: DOM nodes are readable by Playwright and accessibility tooling, easy to screenshot for AI vision checks, support text inputs and inline widgets (patch parameters), and are well documented (llms.txt helps agents write code). Origami patch graphs are organized hierarchically in groups, so most views hold tens to a few hundred patches. 500 nodes is a stress target, not the typical case.

### 2.2 Rete.js v2 [VERIFIED]

- `rete` **2.0.6** (2025-06-30; previous 2.0.5 in 2024-08). MIT, 12.3k★, repo pushed 2026-09-13. Plugins: `rete-area-plugin` 2.3.2, `rete-minimap-plugin` 2.0.3, `rete-react-plugin` 2.1.2, `rete-history-plugin` 2.2.0.
- Architecture (https://retejs.org/docs): modular plugins; render plugins for **React, Vue, Angular, Svelte, Lit** (mixable); **dataflow and control-flow engines** that can be combined; Area, Minimap, Readonly, Auto-arrange, and History plugins. TypeScript-first.
- Fit [INFERRED]: the engines are nice, but we need our own evaluation runtime (pulses, per-frame values, springs). The core release pace is slow and the community is smaller than React Flow's. Also DOM-based, so the same scale caveats apply.

### 2.3 litegraph.js and the ComfyUI fork [VERIFIED]

- Original `jagenjo/litegraph.js`: MIT, 8.1k★, last push 2024-08-01. npm `litegraph.js` 0.7.18 (2024-01). Canvas2D editor plus an engine that runs in browser or Node.
- `Comfy-Org/litegraph.js`: **archived**, README: "As of August 5, 2025, Comfy-Org/litegraph.js is now part of the ComfyUI Frontend monorepo" (`src/lib/litegraph`), "largely incompatible with the original". npm `@comfyorg/litegraph` 0.17.2. The **ComfyUI_frontend repo is GPL-3.0** (2k★), so newer changes live in a GPL codebase; the archived MIT fork is frozen.
- ComfyUI "**Nodes 2.0**" moves node rendering from LiteGraph canvas to **Vue DOM components** because "Canvas2D and Litegraph have taken ComfyUI incredibly far, but they're hitting real limits" (https://blog.comfy.org/p/comfyui-node-2-0). The frontend now has dual rendering modes, and issues show missing parity, such as Vue nodes bypassing snap-to-grid (#5684).
- Lesson [INFERRED]: pure canvas node editors scale better but lose accessibility, rich widgets, and easy styling. The most-used node editor in AI tooling is moving *toward* DOM nodes.

### 2.4 BaklavaJS [VERIFIED]

- `baklavajs` / `@baklavajs/core` **2.8.1** (2025-11-02). MIT, 2.1k★, pushed 2026-09-16. Vue 3 renderer (`@baklavajs/renderer-vue`), engine, interface types with auto-conversion, themes. TypeScript. https://github.com/newcat/baklavajs
- Fit: Vue-only renderer. Not a match if we pick React [INFERRED].

### 2.5 Custom canvas / WebGL editor [INFERRED]

- Pros: thousands of nodes at 60 fps, full control over wire rendering (bundled bezier batches), zoom levels of detail.
- Cons: you rebuild text input, IME, focus, accessibility, selection, context menus, and scrolling inside nodes; screenshots and DOM queries get harder for agents; much more engineering.
- Middle path: a **DOM for nodes plus a single canvas (or one SVG `<path>` per wire batch) for edges**, with LOD (below about 0.35 zoom, render nodes as flat colored rects with just a title). This is essentially React Flow plus custom edge and LOD layers.

### 2.6 Performance plan for 500+ nodes [INFERRED, built on VERIFIED APIs]

1. Keep the graph model in Yjs and Zustand, **not** in React Flow's internal store as the source of truth. React Flow gets `nodes` and `edges` through selectors that return **stable references** (per-node memoized objects).
2. Wrap every custom node in `React.memo`. Declare `nodeTypes` and `edgeTypes` at module scope, and wrap all callbacks in `useCallback`.
3. Turn on `onlyRenderVisibleElements` for large groups. Add a LOD mode through `useStore(s => s.transform[2] < 0.4)` that renders a lightweight node body.
4. Keep node CSS cheap: no blur, no animated shadows, and a static wire style during drag.
5. Live-value "port previews" (Origami shows values flowing) should update through **refs or imperative DOM writes at rAF**, not React state, for 500 nodes × 60 Hz.
6. Benchmark gate in CI (Playwright + Electron): 500 nodes / 800 edges, drag 50 selected nodes, p95 frame under 16.7 ms on an M1. If it fails, swap the edge layer to canvas first, then consider a PixiJS node layer.
7. Minimap: React Flow `<MiniMap>` (recent re-render fixes). Auto-layout: `elkjs` 0.12.0 (layered) or `@dagrejs/dagre` 3.1.1.

### 2.7 Verdict

**React Flow 12** with a strict model/view split and the perf discipline above. Rete v2 is a reasonable second choice. Avoid building on litegraph: the original is unmaintained, the Comfy fork is archived and merged into GPL code, and Comfy itself is moving to DOM nodes.

---

## 3. Prototype renderer and "Live" preview

### 3.1 Options compared

| Renderer | Text quality | Perf profile | Effects | Phone web player | Notes |
|---|---|---|---|---|---|
| **DOM + CSS transforms** | **Native OS text rendering** (system fonts, variable fonts, emoji, RTL) [INFERRED] | Excellent for tens to hundreds of layers when animating composite-only props (`transform`, `opacity`) [INFERRED] | `filter: blur()`, `backdrop-filter`, `border-radius`, `clip-path`, video, masks | Same code runs in mobile Safari and Chrome | Accessible and inspectable. Layout must be computed by us for determinism. |
| **Canvas2D** | Decent, but no subpixel control and manual line breaking [INFERRED] | Good for custom drawing; you redraw everything | Filters limited; `colorSpace: 'display-p3'` supported (Safari 26 fix note) | Yes | Good for shapes and paths layers, not whole UIs. |
| **PixiJS v8** (8.20.1, MIT, 48k★) | Three systems: `Text` (canvas-rasterized, "Full CSS-like font control", avoid per-frame updates), `BitmapText` ("High rendering speed", needs predefined characters), `HTMLText` (HTML markup, emoji, RTL; avoid many instances) [VERIFIED https://pixijs.com/8.x/guides/components/scene-objects/text] | WebGL renderer "Well supported and stable / Recommended"; **WebGPU renderer "Experimental"**, "It is recommended to use the WebGL renderer for production"; Canvas renderer "Coming-soon" [VERIFIED https://pixijs.com/8.x/guides/components/renderers] | Filters, shaders, particles | Yes | `@pixi/react` 8.0.5 (peer `pixi.js ^8.2.6`, `react >=19`). |
| **Skia CanvasKit** (`canvaskit-wasm` 0.42.0, BSD-3) | Skia Paragraph shaping; same everywhere once fonts are loaded | GPU via WebGL surface | Full Skia (paths, shaders, image filters), Lottie (Skottie) [VERIFIED skia.org] | **Heavy:** `bin/canvaskit.wasm` 7.3 MB, `full` 8.2 MB, `profiling` 9.6 MB (from the npm tarball) [VERIFIED] | Best for offline or export rendering consistency, poor for quick phone loads. |
| **WebGPU (raw)** | n/a | Top | Custom shaders | **Safari 26.0 ships WebGPU on macOS, iOS, iPadOS, visionOS**: "WebGPU supersedes WebGL on macOS, iOS, iPadOS, and visionOS and is preferred for new sites" [VERIFIED https://webkit.org/blog/17333/webkit-features-in-safari-26-0/] | For Shader Layers (Origami v223 added Shader Layer LLM generation). |

### 3.2 Recommended renderer architecture [INFERRED]

- `packages/runtime`: a pure-TS evaluation engine. `evaluate(graph, prevState, inputs, t, dt) → { layerProps, outputs, nextState }`, with no DOM access and a deterministic injectable clock.
- `packages/layout`: our own frame computation. Layers carry absolute or relative frames; layout groups (stack, grid) are computed in TS, so positions are identical on desktop and phone. Only text measurement is platform-dependent. Measure through a `TextMeasurer` interface backed by the DOM and cache it. Flag potential cross-device line-break differences as a known limitation.
- `packages/renderer-dom`: a keyed reconciler from layer tree to absolutely positioned `div`s. It writes `transform: translate3d() rotate() scale()`, `opacity`, `border-radius`, `box-shadow`, and `filter` imperatively per frame (no React re-render per frame). Text layers are `div`s with `font-variation-settings`. Image and video layers are native elements.
- `packages/renderer-gl`: shader layers as individual `<canvas>` elements using WebGPU where available (Safari 26+, Chromium) with a WebGL2 fallback. Optionally PixiJS for particles.
- **Export and video:** step the runtime at a fixed `dt` and capture frames with `webContents.capturePage()` or offscreen rendering [INFERRED, verify before building]. CanvasKit is optional later for exact exports.

### 3.3 Origami Live reference [VERIFIED]

- Origami Live connects an iPhone or iPad to Origami Studio on the Mac **over USB (docs) or Wi-Fi (App Store listing)**. Changes are reflected "immediately... without needing to restart". Android Live over USB needs data cables. Prototypes can be exported to the device or shared by email, Dropbox, or AirDrop. Custom fonts don't transfer during mirroring according to the docs, **but release v226 (2026-08-19) added font embedding into prototypes**, so that part of the docs is out of date. Relevant recent releases: v216 120 fps prototypes; v223 iPhone 17 Pro default device; v191 WebSocket patches. https://origami.design/documentation/workflow/previewsharing, https://origami.design/releases/

### 3.4 Our "Live": LAN web player [design INFERRED; constraints VERIFIED where marked]

1. When the user turns on Live, the main process starts `http` plus `ws` (8.21.3) on `0.0.0.0:<port>`, advertises over mDNS with `bonjour-service` 1.4.4, and shows a **QR code** (`qrcode` 1.5.4) encoding `http://<lan-ip>:<port>/p/<docId>#token=<random>`.
2. The phone opens the **player bundle** (the same `runtime` + `renderer-dom` packages). It receives a snapshot (compiled graph + assets + fonts), then **incremental Yjs updates or op patches** over WebSocket. Runtime state is preserved across edits, matching Origami's "without restart" behavior.
3. Sensors and permissions: `DeviceMotionEvent.requestPermission()` on iOS **requires a secure context (HTTPS)** and **transient user activation** (a tap) [VERIFIED MDN via search]. Plain `http://192.168.x.x` is **not** a secure context [INFERRED; standard secure-context rules], so motion and orientation patches won't work over plain LAN HTTP on iOS. Options:
   - (a) A local CA like **mkcert** (BSD-3-Clause, 59.6k★) [VERIFIED license], but the user must install and trust a profile on the phone, which is friction.
   - (b) An optional relay or tunnel with a real TLS cert.
   - (c) A later thin native companion shell (Capacitor or Expo) for sensors, haptics, and camera [INFERRED].
4. Fullscreen: a PWA manifest with `display: standalone` so "Add to Home Screen" hides browser chrome [INFERRED].
5. Security: token required, list connected devices, auto-stop on quit, loopback-only unless Live is on. Windows shows a firewall prompt on first bind [INFERRED].
6. Frame rate: whether mobile Safari runs rAF at 120 Hz on ProMotion devices needs a device test. Origami's native player supports 120 fps (v216) [VERIFIED for Origami; web behavior is an open question].

### 3.5 Verdict

A **DOM renderer with runtime-owned layout**, GPU canvases for shader layers, and the **same player bundle on a phone over LAN** (HTTP for basic prototypes, HTTPS or companion app for sensors). Keep CanvasKit out of the phone path.

---

## 4. Springs and animation

### 4.1 rebound-js (Facebook) — exact behavior [VERIFIED from source https://github.com/facebookarchive/rebound-js/tree/master/src]

- License: **BSD-3-Clause** (LICENSE: "BSD License For the rebound-js software, Copyright (c) 2014, Facebook, Inc."). The README says "We also provide an additional patent grant." Repo **archived** (2021-02-02 per GitHub page; last push 2020-12-11). npm `rebound` 0.1.0 (license BSD-3-Clause).
- **OrigamiValueConverter** (`src/OrigamiValueConverter.js`):
  - `tensionFromOrigamiValue(o) = (o - 30.0) * 3.62 + 194.0`
  - `origamiValueFromTension(t) = (t - 194.0) / 3.62 + 30.0`
  - `frictionFromOrigamiValue(o) = (o - 8.0) * 3.0 + 25.0`
  - `origamiFromFriction(f) = (f - 25.0) / 3.0 + 8.0`
- **SpringConfig** (`src/SpringConfig.js`):
  - `DEFAULT_ORIGAMI_SPRING_CONFIG = fromOrigamiTensionAndFriction(40, 7)` → tension `(40-30)*3.62+194 = 230.2`, friction `(7-8)*3+25 = 22` (arithmetic INFERRED from VERIFIED formulas).
  - `fromOrigamiTensionAndFriction(tension, friction)` applies the converters.
  - `fromBouncinessAndSpeed(bounciness, speed)` → `BouncyConversion` → `fromOrigamiTensionAndFriction(bouncyTension, bouncyFriction)`.
  - `coastingConfigWithOrigamiFriction(friction)` → tension 0.
- **BouncyConversion** (`src/BouncyConversion.js`):
  - `b = normalize(bounciness / 1.7, 0, 20.0)`; `b = projectNormal(b, 0.0, 0.8)`
  - `s = normalize(speed / 1.7, 0, 20.0)`
  - `bouncyTension = projectNormal(s, 0.5, 200)`
  - `bouncyFriction = quadraticOutInterpolation(b, b3Nobounce(bouncyTension), 0.01)`
  - `normalize(v, a, b) = (v - a) / (b - a)`; `projectNormal(n, a, b) = a + n*(b - a)`
  - `linearInterpolation(t, start, end) = t*end + (1 - t)*start`; `quadraticOutInterpolation(t, s, e) = linearInterpolation(2t - t², s, e)`
  - `b3Friction1(x) = 0.0007x³ - 0.031x² + 0.64x + 1.28`
  - `b3Friction2(x) = 0.000044x³ - 0.006x² + 0.36x + 2`
  - `b3Friction3(x) = 0.00000045x³ - 0.000332x² + 0.1078x + 5.84`
  - `b3Nobounce(t)`: `t <= 18 → b3Friction1`; `18 < t <= 44 → b3Friction2`; else `b3Friction3`
  - Worked example [INFERRED, hand-computed; confirm in a unit test]: bounciness 5, speed 10 → bouncyTension ≈ 59.18, bouncyFriction ≈ 8.683 → tension ≈ 299.62, friction ≈ 27.05 (damping ratio ≈ 0.78).
- **Spring integrator** (`src/Spring.js`):
  - `MAX_DELTA_TIME_SEC = 0.064` (frame delta clamp), `SOLVER_TIMESTEP_SEC = 0.001` (fixed 1 ms substeps), `_restSpeedThreshold = 0.001`, `_displacementFromRestThreshold = 0.001`, `_overshootClampingEnabled = false`.
  - Implicit mass 1; acceleration `= tension * (endValue - x) - friction * v`.
  - **RK4** per 1 ms step with a time accumulator. The leftover fraction is interpolated between previous and current state (`_interpolate(accumulator / SOLVER_TIMESTEP_SEC)`).
  - **Source quirk worth matching for exact parity:** the first RK4 stage computes `aAcceleration = tension * (this._endValue - tempPosition) - friction * velocity`, using the *previous step's temp position* rather than `position`. Numerically small, but it matters for bit-level golden tests.
  - At rest or on overshoot clamp with `tension > 0`, position snaps to `endValue` and velocity is set to 0. With `tension == 0` (coasting), `endValue` becomes the current position.
- **Loopers** (`src/Loopers.js`): `AnimationLooper` (rAF with `performanceNow()`), `SimulationLooper(timestep = 16.667)` (runs until idle), and **`SteppingSimulationLooper.step(timestep)`**, which advances `springSystem.loop(time += timestep)`. This is the deterministic test hook.
- Reuse: these are math formulas and constants, and BSD-3 permits reuse with attribution. For clean-room safety, **reimplement from the formulas above** in our own code and include a NOTICE attribution for parity with "rebound/Origami spring semantics" [INFERRED policy]. That Origami Studio's Pop Animation (Bounciness/Speed) and Classic spring (Tension/Friction) patches use these same conversions is historically well known but **not re-verified in this session** [INFERRED]. Validate against recorded Origami outputs if any exist.

### 4.2 Motion (motion.dev) [VERIFIED]

- `motion` / `framer-motion` **13.4.0** (MIT, 33.6k★). **13.0.0 (2026-08-05)** removed the optional `@emotion/is-prop-valid` dependency in favor of `<MotionConfig isValidProp={...}>`. 12.43.0 added hardware acceleration for `backgroundColor` and SVG.
- `spring()` docs (https://motion.dev/docs/spring): options `duration` (default 800 ms), `visualDuration`, `bounce` (default 0.25), `stiffness`, `damping` (10), `mass` (1), `velocity`, `restSpeed` (0.1), `restDelta` (0.01), `keyframes`. "the spring can be sampled in a non-linear fashion, meaning you can sample the spring at any time". The generator `next(t)` returns `{ value, done }`. It can also generate CSS `linear()` transitions. (See the stiffness default discrepancy flagged at the top.)
- `MotionGlobalConfig` in `motion-utils` types has **`skipAnimations?`, `instantAnimations?`, `useManualTiming?`**, and `motion-dom`'s frameloop reads `MotionGlobalConfig.useManualTiming` [VERIFIED from the package tarballs].
- Use for editor chrome (panels, popovers, inspector transitions), not for the prototype runtime [INFERRED].

### 4.3 react-spring [VERIFIED]

- `@react-spring/web` **10.1.2** (MIT, 29.1k★).
- `packages/core/src/constants.ts` presets: **default `{tension:170, friction:26}`**, gentle `{120,14}`, wobbly `{180,12}`, stiff `{210,20}`, slow `{280,60}`, molasses `{280,120}`; mass default 1.
- `@react-spring/shared` types: `frameLoop` (from `Rafz['frameLoop']`) and `skipAnimation: boolean`. `@react-spring/rafz` types: `advance: () => void` and `frameLoop === 'demand'` docs. So `Globals.assign({ frameLoop: 'demand' })` plus `raf.advance()` gives manual stepping [API names VERIFIED; exact usage INFERRED].

### 4.4 popmotion [VERIFIED]

- `popmotion` 11.0.5 (npm last modified 2022-08-15), MIT. The repo has no license detected by the API but package.json says MIT; last push 2024-03. It is effectively superseded by Motion. Don't use it [INFERRED].

### 4.5 Deterministic stepping design [INFERRED]

- `@app/physics`:
  - `stepRK4(state, config, dt)` reproduces rebound exactly (1 ms substeps, 0.064 s clamp, rest thresholds, optional quirk flag).
  - `analyticSpring(d0, v0, k, c, m, t)` is a closed form for arbitrary-time sampling:
    - `ω0 = √(k/m)`, `ζ = c / (2√(k·m))`, `d = x - target`.
    - Underdamped (ζ<1): `d(t) = e^{-ζω0 t} [ d0 cos ωd t + ((v0 + ζω0 d0)/ωd) sin ωd t ]`, with `ωd = ω0√(1-ζ²)`.
    - Critical (ζ=1): `d(t) = e^{-ω0 t} [ d0 + (v0 + ω0 d0) t ]`.
    - Overdamped (ζ>1): `r1,2 = -ω0(ζ ∓ √(ζ²-1))`, `C1 = (v0 - r2·d0)/(r1 - r2)`, `C2 = d0 - C1`, `d(t) = C1 e^{r1 t} + C2 e^{r2 t}`.
  - Converters: `fromOrigami`, `fromBouncinessSpeed`, and `fromBounceDuration` (Motion-style, for newcomers).
- Runtime clock: `Clock { now(): number }`. Production uses `performance.now()`. Tests and exports use a `ManualClock` stepped at `dt = 1/120` or `1/60`.
- Tests: step N frames and snapshot numeric traces (Vitest `toMatchInlineSnapshot` with rounding). Property tests check that the analytic and RK4 versions agree within ε.

---

## 5. State, document format, co-editing

### 5.1 Libraries [VERIFIED]

| Library | Version | Key facts |
|---|---|---|
| **Zustand** | 5.0.15 (MIT, 58.7k★) | Peers: `react >=18`, optional `immer >=9.0.6`, `use-sync-external-store`. |
| **Immer** | 11.1.18 (MIT) | `enablePatches()`, `produceWithPatches()` → `[nextState, patches, inversePatches]`, `applyPatches()`. Patch `{op: "replace"‖"remove"‖"add", path: (string‖number)[], value}` (path is an **array**, unlike RFC-6902 strings). "Immer does not guarantee the generated set of patches will be optimal." https://immerjs.github.io/immer/patches |
| **Yjs** | 13.6.32 (MIT, 22.8k★) | `Y.UndoManager(type, { captureTimeout = 500ms, trackedOrigins: Set, deleteFilter, captureTransaction })`; `undo()`, `redo()`, `stopCapturing()`; events `stack-item-added` / `-popped` / `-updated` with `stackItem.meta` for storing cursor or selection. Example: `new Y.UndoManager(ytext, { trackedOrigins: new Set([userIdA, userIdB]) })`. https://docs.yjs.dev/api/undo-manager. Ecosystem: `y-websocket` 3.1.0, `@y/websocket-server` 0.1.5, `y-indexeddb` 9.0.12, `zustand-middleware-yjs` 1.3.1, `@syncedstore/core` 0.6.0, `valtio-yjs` 0.7.0. |
| **Automerge** | `@automerge/automerge` 3.5.0 (MIT, 6.6k★) | 3.0 (July 2025): memory "by over 10x" (Moby Dick 700 MB → 1.3 MB), load example 17 h → 9 s. Same file format as v2. `next` API becomes default. `Text` class removed, `RawString` → `ImmutableString`. `automerge-repo` ≥2.1.0. No undo manager mentioned in the post. https://automerge.org/blog/automerge-3/ |
| **Loro** | `loro-crdt` 1.16.1 (MIT, 6.1k★) | "Loro 1.0 is out". Rich text, **Movable Tree**, **Movable List**, LWW Map, time travel, shallow snapshots. `class UndoManager` with `excludeOriginPrefixes?: string[]`, `mergeInterval?`, `maxUndoSteps?` (default 100) (from the npm tarball types). |
| **zod** | 4.6.5 (MIT, 44k★) | `z.toJSONSchema(schema, { target: draft-2020-12 (default)‖draft-7‖draft-4‖openapi-3.0, io: "output"‖"input", unrepresentable: "throw"‖"any"‖fn, cycles: "ref"‖"throw", reused: "inline"‖"ref" })`. `.meta()` registers in `z.globalRegistry` (title, description, examples flow into JSON Schema). `z.fromJSONSchema()` is experimental. Unrepresentable: bigint, symbol, undefined, void, date, map, set, transform, nan. https://zod.dev/json-schema |
| `fractional-indexing` | 4.0.0 | Sibling ordering keys. |
| `zundo` | 2.3.0 | Zustand undo middleware (for non-CRDT local UI state only). |

### 5.2 Figma's multiplayer lessons [VERIFIED https://www.figma.com/blog/how-figmas-multiplayer-technology-works/]

- Server-authoritative. It rejected OTs as "unnecessarily complex for our problem space" and doesn't use true CRDTs, but applies CRDT ideas.
- **Per-property last-writer-wins** on `(objectId, property)`, and the client trusts its own unacknowledged changes to avoid flicker.
- Client-generated object IDs embed the client ID.
- **Reparenting: the parent is a property of the child.** The server rejects cycles.
- **Fractional indexing** for child order.
- Undo principle: "if you undo a lot, copy something, and redo back to the present, the document should not change."

### 5.3 Recommended document architecture [INFERRED]

- **Authoritative Y.Doc per open document in Electron main (`DocumentService`).** Renderer windows hold replicas synced through `MessagePortMain` binary updates. The MCP host and Live server apply changes through the same ops API.
- **Flat, Figma-style schema inside Yjs**:
  - `nodes: Y.Map<id, Y.Map>` (patch instances: `type`, `groupId`, `position`, `params` Y.Map).
  - `edges: Y.Map<id, Y.Map>` (`from: {node, port}`, `to: {node, port}`).
  - `layers: Y.Map<id, Y.Map>` (`type`, `parentId`, `order: fractional key`, props).
  - `groups`, `assets`, `meta` (`schemaVersion`, device, fonts).
  - Reparenting = set `parentId`, with a cycle check in the ops layer. This avoids tree-move CRDT anomalies without Loro.
- **Origins:** every transaction carries `origin = { actor: "user:<id>" | "agent:<sessionId>", tool?: string }`.
  - One `Y.UndoManager` per window tracks the local user's origin, with `stopCapturing()` at gesture boundaries (drag end, slider release).
  - An agent-scoped UndoManager (`trackedOrigins: {agentOrigin}`) powers **"Undo AI change"** and a reviewable AI changeset. `stack-item-added` meta stores the tool name and a summary.
- **Ops layer** (`applyOps(doc, ops, origin)`): every op is a zod-validated discriminated union (`addPatch`, `connect`, `setParam`, `addLayer`, `setLayerProp`, `group`, ...). Both the UI and MCP call it, which gives consistent validation errors for AI and an audit log.
- **Zustand** holds the *view* store (selection, viewport, hover, panel state, derived per-node snapshots fed by `observeDeep`). React components subscribe with narrow selectors.
- **Save format:** a folder or zip `*.<ext>` with `document.json` (stable key order, `schemaVersion`, migrations), `assets/`, and an optional `history.yjsupdate`. The JSON is canonical so it stays diffable, agent-readable, and git-friendly. Origami itself added a **CLI to convert Origami files to JSON** in v221 [VERIFIED], which confirms the demand.
- **JSON Schema export:** `z.toJSONSchema(DocumentSchema)` for the file format docs, and per-op schemas for MCP `inputSchema`. MCP 2026-07-28 allows "any JSON Schema 2020-12 keywords", matching zod's default target [VERIFIED].
- When to consider **Loro** instead: if we need native movable lists or trees, version checkout ("compare with 10 minutes ago"), or Git-like branching of prototypes. Its UndoManager with `excludeOriginPrefixes` covers per-actor undo too [INFERRED tradeoff: smaller ecosystem than Yjs].
- **Automerge 3**: excellent memory, but no built-in selective undo manager surfaced in the docs we checked. Skip for v1 [INFERRED].

---

## 6. Monorepo, TypeScript, testing

### 6.1 Monorepo [VERIFIED facts, INFERRED structure]

- **npm workspaces** (root `package.json` `"workspaces": ["apps/*", "packages/*"]`) with **Turborepo 2.10.13**. Turborepo docs show npm among supported package managers, recommend `apps/` and `packages/`, and describe **Just-in-Time internal packages** (export TS directly) vs compiled packages. https://turborepo.dev/docs/crafting-your-repository/structuring-a-repository
- Alternatives: pnpm 12.4.2, nx 23.2.1 (not needed).
- Suggested layout:
  ```
  apps/desktop        electron-vite: main / preload / renderer (editor UI)
  apps/player         web player (Live + shareable static export)
  packages/schema     zod doc + op schemas, JSON Schema generation, migrations
  packages/doc        Y.Doc model, ops API, origins, undo policies
  packages/runtime    patch evaluation engine (pure TS, ManualClock)
  packages/physics    springs (RK4 rebound-compatible + analytic), easing
  packages/patches    patch library: definitions, port types, docs (single source for editor, runtime, MCP)
  packages/layout     frame/stack layout + TextMeasurer interface
  packages/renderer-dom, packages/renderer-gl
  packages/graph-editor  React Flow custom nodes/edges/LOD
  packages/mcp        MCP tools/resources (server v2) over packages/doc
  packages/mcp-shim   stdio → localhost bridge; .mcpb packaging
  packages/live       LAN server + protocol
  ```

### 6.2 TypeScript and lint [VERIFIED]

- **TypeScript 7.0** (the Go-native compiler): announced 2025-03-11, RC 2026-06-18, **stable 2026-07-08** (InfoQ/InfoWorld, via search). npm `typescript` 7.0.2. Speedups of 8–12x on full builds (VS Code 125.7 s → 10.6 s). **No stable programmatic API until 7.1**, so tools that need the TS JS API (typescript-eslint, some framework tooling) can't use it yet. `typescript@6.0.3` is still available.
- Recommendation [INFERRED]: typecheck with TS 7 (`tsc -b --noEmit`), and lint with **oxlint 1.83.0** or **Biome 2.5.14**. If typed lint rules are essential, pin `typescript@6.0.3` for `typescript-eslint` 8.70.0 (ESLint 10.10.0) in lint jobs only.

### 6.3 Testing [VERIFIED]

- **Vitest 5.0.1** (2026-09-03): up to 53% faster, **trace view** for Browser Mode (DOM snapshots per step), nested projects with config inheritance, `vi.when()`, benchmarks as fixtures, **unawaited async assertions now fail**. Requires **Vite ≥ 6.4.0 and Node ≥ 22.12.0** (engines `^22.12.0 ‖ ^24.0.0 ‖ >=26.0.0`). Peer includes `@vitest/browser-playwright`. https://vitest.dev/blog/vitest-5
- **Playwright 1.63.0** `_electron` (https://playwright.dev/docs/api/class-electron): **experimental**; `const { _electron } = require('playwright')`; `electron.launch({ args, executablePath, cwd, env, recordVideo... })`; `firstWindow()`; `evaluate()` in main. Native dialogs are **not** intercepted, so stub `dialog.showOpenDialog` via `evaluate()`. **Don't disable the `nodeCliInspect` fuse** or launch times out.
- Test pyramid [INFERRED]:
  1. Vitest unit: physics traces, runtime per-patch semantics, ops validation, migrations, MCP tools through an in-memory client.
  2. Vitest browser mode: renderer-dom visual snapshots at fixed `t`.
  3. Playwright Electron E2E: graph editing, keyboard flows, 500-node perf gate, Live preview via a second browser context.
  4. Agent evals: scripted MCP sessions against fixtures ("build a bottom sheet with a spring").

---

## 7. MCP specifics (because we are AI-native) [VERIFIED]

- TypeScript SDK repo `main` is **v2**: packages `@modelcontextprotocol/server` and `@modelcontextprotocol/client` **2.0.0 (2026-07-27)**, implementing **spec 2026-07-28**. "v2 is the stable release line"; v1.x (`@modelcontextprotocol/sdk` 1.30.0, still npm `latest`) gets fixes "for at least 6 months after v2's release". Tool and prompt schemas use **Standard Schema** (zod v4, Valibot, ArkType). `@modelcontextprotocol/server` depends on `zod ^4.2.0` and `@modelcontextprotocol/core` 2.0.0. Middleware: `@modelcontextprotocol/node`, `express`, `fastify`, `hono` (Host header validation). License transitioning **MIT → Apache-2.0**. https://github.com/modelcontextprotocol/typescript-sdk
- Spec **2026-07-28** changes (https://modelcontextprotocol.io/specification/2026-07-28/changelog):
  - Protocol-level **sessions and `Mcp-Session-Id` removed**.
  - **Stateless:** no `initialize` handshake; each request carries protocol version and capabilities in `_meta`.
  - **`server/discover`** is required.
  - `subscriptions/listen` replaces GET and resource subscribe.
  - `ping` and `logging/setLevel` removed.
  - Tasks moved to an extension.
  - **Multi Round-Trip Requests** (`resultType: "input_required"`) replace server-initiated sampling, elicitation, and roots requests.
  - Results require `resultType`.
  - SSE resumability removed.
  - `tools/list` should be **deterministically ordered** (prompt-cache friendly).
  - `ttlMs` / `cacheScope` required on list results.
  - `inputSchema` / `outputSchema` allow any JSON Schema 2020-12.
  - **Deprecated: Roots, Sampling, Logging**, HTTP+SSE transport, and Dynamic Client Registration.
- Design implications [INFERRED]:
  - Because the spec is stateless, the "current document" can't be implicit session state. Tools take explicit `documentId` handles (for example from `documents.list` / `documents.open`).
  - Keep tool order stable.
  - Expose the patch library as resources (per-patch docs and port types), plus tools like `graph.applyOps`, `graph.query`, `prototype.render(t)` (returns a PNG), `prototype.simulate(inputs, frames)` (numeric trace), `live.status`.
  - Return structured content and use `stack-item` meta for undo.

---

## 8. Open-source prior art — licenses and what to borrow

| Project | License [VERIFIED] | Status [VERIFIED] | Borrow (concepts) | Avoid |
|---|---|---|---|---|
| **facebookarchive/origami** (Origami for Quartz Composer) | **Custom Facebook license**: use and copy, and "reproduce and distribute ... as part of your own framework"; "Facebook reserves all rights not expressly granted"; requires notice "Copyright (c) 2013-2014, Facebook, Inc." Not OSI. | Archived (GitHub page says 2022-01-13; last push 2016-11-15), 3.2k★ | Historical patch vocabulary and interaction concepts (interaction → state → animation → layer property), the QC patch-editor paradigm | Copying code or assets (Obj-C, iPhone images with Apple trademark notes), the "Origami" name |
| **rebound-js** | BSD-3-Clause (+ patent grant mention) | Archived 2021, 1.7k★ | Spring math and constants (§4.1), `SteppingSimulationLooper` idea | Depending on the unmaintained npm package; reimplement with attribution |
| **Quartz Composer** (Apple) | Proprietary | Deprecated in macOS 10.15 Catalina (Apple docs: framework "deprecated ... remains present for compatibility"; recommends Core Image, SceneKit, Metal) | Macro patches, published inputs and outputs, iterator patches | n/a |
| **Noodl → OpenNoodl / Fluxscape** | **Editor GPL-3.0; runtimes MIT** (`noodl-runtime`, `noodl-viewer-cloud`, `noodl-viewer-react`); app source MIT | Noodl open-sourced 2023–24 (open-core); `noodlapp/noodl` last push 2024-07 (551★); **Fluxscape** fork (83★, pushed 2026-01) | License split pattern (GPL editor, MIT runtime); a React runtime driven by a node graph; node docs UX | Copying GPL editor code into our MIT codebase |
| **cables.gl** | **MIT** (`cables` package.json `"license": "MIT"`; open-sourced around Aug 2024; CDM article) | Active (push 2026-09-16); standalone 0.11.0 (Jun 25, 2026) | `op.schema.json` (op metadata schema), **trigger vs value ports** (like Origami pulses), op docs, subpatches, standalone desktop build | Its WebGL-centric runtime (different domain) |
| **Nodes.io** (Variable) | **No license file** (default all rights reserved; issue #11 "License") | Last push 2021-02, 1.0.0-beta.2 | Code-in-node notebook UX, npm-powered nodes | Any code |
| **Vuo** | **LGPL-2.1+** for compiler, editor, SDK; **MIT** for non-Pro nodes and examples | Pushed 2026-01 (157★) | Event vs data port distinction, input editors in ports, node descriptions, "drawers" | Linking LGPL C/C++ (different stack anyway) |
| **ProtoPie** | Proprietary | Active; Player (free) plus **Connect**; pricing Free / Team $50/mo / Pro $67/mo (May 2026, per aggregators) | **Trigger → Response** mental model as a *beginner lens* over the patch graph; hardware and multi-device Connect idea | n/a |
| **Haiku Animator** | **AGPL-3.0** (2021) | Last push 2022-03 (1.8k★) | Timeline plus Lottie export concepts | AGPL code |
| **Motion Canvas** | MIT | Active 2026-07 (19.1k★); `@motion-canvas/core` 3.17.2 | Generator-based deterministic time, editor/player split, frame export pipeline | n/a (MIT, safe) |
| **Theatre.js** | **Core Apache-2.0; Studio AGPL-3.0** | Public repo last push 2024-08; README: dev "temporarily moved ... to a private repo" for 1.0 | Sequence and keyframe editor UX, a deterministic core separate from the studio | AGPL studio code |
| **tldraw** | **tldraw license (not OSS)**: dev use allowed; "Not to use the Software in Production Environments" without a trial or commercial license key; license-key and **watermark** enforcement; may collect usage data | Very active (v5.4.2, 50.4k★) | Editor API design (imperative editor object, reactive store), agent-friendly SDK patterns, UX polish | Embedding in an OSS product (licensing) |
| **litegraph.js** | MIT (original and archived Comfy fork); ComfyUI_frontend is **GPL-3.0** | Original stale since 2024; Comfy fork archived 2025-08-05 | Canvas LOD and subgraph ideas, Comfy's "Nodes 2.0" lessons | Newer GPL frontend code |
| **Graphite** | Apache-2.0 (27.3k★, active) | Active | "Layers are nodes" dual view (layer panel ⇄ node graph), procedural node engine UX | Rust/wasm stack (not ours) |
| **React Flow / Rete / Baklava** | MIT | Active | See §2 | n/a |

Licensing strategy [INFERRED]: publish **MIT or Apache-2.0** for everything, especially the runtime and player so exported prototypes carry no copyleft. Keep a strict "no GPL/AGPL code" contribution rule and a `THIRD_PARTY_NOTICES` file (rebound formula attribution).

---

## 9. Project name candidates and conflict checks

Checks run on 2026-09-16:
- npm registry (`npm view <name>`).
- GitHub repo search by name (top results by stars) and `gh api users/<name>`.
- DNS lookups (`dig`, A and NS records) for a few TLDs. A resolving name or NS record means the domain is registered; no records suggests it may be available but doesn't confirm it.
- Web searches where the budget allowed.

**None of these replace a USPTO/EUIPO/WIPO trademark search, which I did not do.**

| # | Name | Meaning | npm | GitHub | Domains | Prominent products | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | **Crease** | fold line | **taken**: `crease` 1.0.2 (CSS-by-JS module) | user `crease` exists (0 repos); `liamcain/obsidian-creases` 299★; `mwalczyk/crease` (origami crease-pattern editor, 9★) | `crease.app` **registered** (resolves; Spaceship NS); `crease.design` and `getcrease.com` no DNS | No design tool named Crease found in a 2026 design-tools search | **Moderate.** Short and evocative; needs a scoped npm org (`@crease/*`) and a domain other than .app. |
| 2 | **Fold** | | **taken**: `fold` 0.12.0 = **FOLD file format for origami models / crease patterns** (semantic collision) | 107k repos match | `fold.app` registered (Cloudflare) | **Fold Inc. (NASDAQ: FLD)** bitcoin app with ™ products | **Avoid.** |
| 3 | **Pleat** | | **taken**: `pleat` 0.9.1 | `bp-studio/box-pleating-studio` 89★; `imagirom/pleat` (origami tessellations) | `pleat.app` and `pleat.design` **registered** (Akamai) | Several unrelated "Pleat" products (saree pleating app, dry-cleaner SaaS getpleat.com, AI MVP agency) | **Crowded.** Avoid. |
| 4 | **Tsuru** (crane) | | **taken**: `tsuru` 0.8.1 | **`tsuru/tsuru` PaaS 5.3k★** (BSD-3), org `tsuru` (126 repos) | `tsuru.app` registered (Google NS) | tsuru PaaS | **Avoid.** |
| 5 | **Senbazuru** (thousand cranes) | | **free** | small repos only (org `senbazuru` 22 repos, top 2★) | `senbazuru.app` and `.dev` no DNS | None found (historical 1797 book *Hiden Senbazuru Orikata*) | **Clear**, but long, hard to spell, and culturally significant (memorial / Sadako association); use with care [INFERRED]. |
| 6 | **Orikata** (folding methods) | | **taken**: `orikata` 0.1.1 ("Pseudo-3D origami/folding effects for DOM elements", 2026) | `orikata-bio` org (Orikata Bio), `bkmashiro/orikata` | `orikata.app` registered (GoDaddy NS) | Orikata Bio (company) | **Moderate conflict.** |
| 7 | **Kirigami** | | **taken**: `kirigami` 0.0.5 | **KDE/kirigami** (one of the 70 KDE Frameworks), `kirigami.el` 161★ | `kirigami.app` registered (Vercel) | **KDE Kirigami UI framework** | **Avoid** (as expected). |
| 8 | **Unfold** | | **taken**: `unfold` 0.4.2 | `unfoldadmin/django-unfold` 3.7k★; org `Unfold` (90 repos) | `unfold.app` on **Squarespace DNS** | **Squarespace's Unfold** story app (acquired 2019) | **Avoid.** |
| 9 | **Sonobe** (modular origami unit; fits "modular patches") | | **free** (`sonobe`, `sonobe-js`) | `ethereum/sonobe` 285★ ("Experimental folding schemes library", cryptography) | `sonobe.app` no DNS; `sonobe.dev` registered (Cloudflare) | None found in design | **Mild conflict** (crypto library in a different domain). **Shortlist.** |
| 10 | **Origata** (ceremonial paper wrapping/folding) | | **free** | tiny repos | `origata.app` registered (Cloudflare); `origata.dev` no DNS | None found | Free, but **shares the "Ori-" prefix with Origami**, so a possible confusion argument for Meta. **Not recommended** [INFERRED]. |
| 11 | **Valleyfold** | | **free** (`valleyfold`, `valley-fold`) | **0 repos** | `valleyfold.app` and `.dev` registered (Porkbun) | None found (not web-searched; budget exhausted) | **Clear on code registries**; domains taken. Shortlist as "Valley". |
| 12 | **Papercrane** | | **free** | small repos | (not checked) | Multiple companies "Paper Crane" (geospatial AI acquired by Avalara, agencies, protein design) | **Crowded.** Avoid. |
| 13 | **Foldwork** | | **free** | (not searched) | `foldwork.app` registered | (not searched) | Neutral; unverified. |
| 14 | **Plié** (French *plier* = to fold) | | **free** (`plie`) | no notable repos | `plie.app` registered | (not searched) | Neutral; ballet association. |

Recommendation [INFERRED]: shortlist **Sonobe** (modular origami units combine into bigger forms, which matches patches and groups; npm-free; `sonobe.app` has no DNS) and **Crease** (short and memorable; use the `@crease` scope and an alternate TLD). **Valleyfold** is the backup. Before committing, run USPTO/EUIPO searches in classes 9 and 42 and check app-store names; web search for Sonobe, Valleyfold, and Crease products was only partly completed because of the budget.

---

## 10. Risks and open questions

1. **React Flow at 500+ nodes with live value previews**: needs a benchmark spike in week 1 (§2.6). The fallback is a canvas edge layer and LOD nodes.
2. **iOS web-player limits**: HTTPS requirement for motion sensors, no guarantee of 120 Hz rAF, haptics (Vibration API support on iOS is doubtful [INFERRED]), keyboard and safe-area quirks. Decide early whether a native companion shell is on the roadmap.
3. **Exact Origami spring parity**: this needs recorded ground truth from Origami Studio. Not re-verified that Origami Studio still uses rebound's converters.
4. **Text measurement consistency** between desktop Chromium and mobile Safari when fonts are embedded (Origami v226 added font embedding).
5. **Tooling churn**: electron-vite 6 (Vite 8) is in beta; TS 7 has no API until 7.1; MCP v2 just shipped (July 2026). Pin versions and upgrade in scheduled batches.
6. **Windows signing cost and process** (EV HSM vs Azure Artifact Signing eligibility).
7. **CRDT choice**: Yjs flat maps vs Loro movable tree. Prototype concurrent reparent plus AI bulk edits in a spike.
8. **Electron 45 lands 2026-10-19**, so start on 44 and upgrade within weeks. Note macOS 13+ is required as of Electron 44.

---

## 11. Source index (primary unless noted)

- Electron blog: https://www.electronjs.org/blog · Electron 44: https://www.electronjs.org/blog/electron-44-0 · Schedule: https://releases.electronjs.org/schedule · utilityProcess: https://www.electronjs.org/docs/latest/api/utility-process · Code signing: https://www.electronjs.org/docs/latest/tutorial/code-signing
- electron-vite: https://electron-vite.org/guide/ · Forge Vite template: https://www.electronforge.io/templates/vite · Forge releases: https://github.com/electron/forge/releases · electron-builder auto-update: https://www.electron.build/docs/features/auto-update/
- Tauri releases: https://tauri.app/release/ · Node sidecar: https://v2.tauri.app/learn/sidecar-nodejs/ · Linux graphics: https://v2.tauri.app/develop/debug/linux-graphics/ · Updater: https://v2.tauri.app/plugin/updater/
- Electrobun (search snippets): https://blackboard.sh/electrobun/ · https://www.founderland.ai/articles/electrobun-v1-challenges-electron-with-14mb-bundles-and-type-mluy3tzh
- React Flow what's new: https://reactflow.dev/whats-new · Performance: https://reactflow.dev/learn/advanced-use/performance · Accessibility: https://reactflow.dev/learn/advanced-use/accessibility · Scale discussion: https://github.com/xyflow/xyflow/discussions/3003 · Synergy Codes benchmark: https://www.synergycodes.com/webbook/guide-to-optimize-react-flow-project-performance
- Rete.js docs: https://retejs.org/docs · Comfy litegraph (archived README): https://github.com/Comfy-Org/litegraph.js · ComfyUI Nodes 2.0: https://blog.comfy.org/p/comfyui-node-2-0 · BaklavaJS: https://github.com/newcat/baklavajs
- PixiJS text: https://pixijs.com/8.x/guides/components/scene-objects/text · Renderers: https://pixijs.com/8.x/guides/components/renderers · CanvasKit: https://skia.org/docs/user/modules/canvaskit/ · Safari 26 WebGPU: https://webkit.org/blog/17333/webkit-features-in-safari-26-0/ · DeviceMotion permission (MDN): https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent
- Origami releases: https://origami.design/releases/ · Previewing docs: https://origami.design/documentation/workflow/previewsharing · Origami Live App Store: https://apps.apple.com/us/app/origami-live/id942636206
- rebound-js source: https://github.com/facebookarchive/rebound-js (src/OrigamiValueConverter.js, SpringConfig.js, BouncyConversion.js, Spring.js, Loopers.js) · facebookarchive/origami: https://github.com/facebookarchive/origami
- Motion spring: https://motion.dev/docs/spring · Motion changelog: https://github.com/motiondivision/motion/blob/main/CHANGELOG.md · react-spring constants: https://github.com/pmndrs/react-spring/blob/main/packages/core/src/constants.ts
- Yjs UndoManager: https://docs.yjs.dev/api/undo-manager · Immer patches: https://immerjs.github.io/immer/patches · Automerge 3: https://automerge.org/blog/automerge-3/ · Loro: https://github.com/loro-dev/loro · zod JSON Schema: https://zod.dev/json-schema · Figma multiplayer: https://www.figma.com/blog/how-figmas-multiplayer-technology-works/
- MCP TS SDK: https://github.com/modelcontextprotocol/typescript-sdk · Spec changelog 2026-07-28: https://modelcontextprotocol.io/specification/2026-07-28/changelog · MCPB: https://blog.modelcontextprotocol.io/posts/2025-11-20-adopting-mcpb/ · https://github.com/modelcontextprotocol/mcpb
- Vite 8: https://vite.dev/blog/announcing-vite8 · Vitest 5: https://vitest.dev/blog/vitest-5 · Playwright Electron: https://playwright.dev/docs/api/class-electron · Turborepo structure: https://turborepo.dev/docs/crafting-your-repository/structuring-a-repository · TypeScript 7 (secondary): https://www.infoq.com/news/2026/08/typescript-7-released/ · https://www.infoworld.com/article/4196378/go-based-typescript-7-0-arrives.html
- Prior art: Fluxscape https://github.com/fluxscape/fluxscape · OpenNoodl https://github.com/The-Low-Code-Foundation/opennoodl · cables https://github.com/cables-gl/cables, https://cdm.link/cables-gl-open-offline/ · Nodes.io https://github.com/nodes-io/nodes-io · Vuo https://github.com/vuo/vuo · Haiku Animator https://github.com/HaikuTeam/animator · Motion Canvas https://github.com/motion-canvas/motion-canvas · Theatre.js https://github.com/theatre-js/theatre · tldraw https://github.com/tldraw/tldraw · Graphite https://github.com/GraphiteEditor/Graphite · Quartz Composer https://developer.apple.com/documentation/quartz/quartz-composer · ProtoPie (secondary) https://www.getapp.com/development-tools-software/a/protopie/
- Names: Squarespace Unfold https://newsroom.squarespace.com/blog/squarespace-unfold · Fold Inc https://foldapp.com/ · KDE Kirigami https://develop.kde.org/docs/getting-started/kirigami/ · tsuru https://github.com/tsuru/tsuru · Pleat products https://getpleat.com/ · Senbazuru Orikata history https://www.origamiheaven.com/senbazuruorikata.htm · OpenFold https://openfold.io/ · Paper Crane https://papercrane.io/
