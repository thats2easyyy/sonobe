# What makes a design tool "AI-friendly": Paper, Figma MCP, Pencil/pen.dev, Framer, Rive, tldraw, Excalidraw, Blender, Unity, Penpot, and node-graph tools

Research date: 2026-09-16. Purpose: clean-room input for an open-source, AI-native desktop alternative to Origami Studio (node/patch-based interaction prototyping), designed to be driven by Claude via MCP and learnable by designers and non-designers.

Legend: **[VERIFIED]** = seen directly in a primary source (web page, official repo, public config, or the locally installed app bundle, read-only). **[INFERRED]** = my reasoning or synthesis, not stated in a source. Where sources disagree, a **CONFLICT** note is given.

Method notes:
- Paper.app 0.5.8 is installed at `/Applications/Paper.app`. I inspected it read-only: `Info.plist`, the `app.asar` header and a handful of main-process TypeScript files (MCP server, bridge, auth, CLI install), plus strings from the bundled Go CLI binary. I did not copy code. I only describe behavior.
- Paper's full MCP tool definitions (34 tools, JSON Schemas, server `instructions`) are served publicly at `https://app.paper.design/mcp/desktop/config.json`. I fetched it: HTTP 200, 67,202 bytes. This is the file the Paper CLI relay uses to list tools, so it is the ground truth for the live tool surface **[VERIFIED]**.
- Nothing was installed. No MCP tools were called against the running apps. For the Blender MCP server that is connected in this session, I only loaded tool schemas, which is read-only.

---

## 0. Executive summary (decision-relevant)

1. **Paper's core bet: the canvas medium is a language LLMs already speak.** The canvas is real HTML/CSS (flexbox, CSS filters, OKLCH, P3). Agents write designs with `write_html` (inline-styled HTML fragments) and read them back as JSX/Tailwind, computed CSS, compact tree summaries, and screenshots [VERIFIED: paper.design/compare/figma, config.json]. Stephen Haney's framing: "if you build a great handoff for humans, you've also built a great handoff for agents" [VERIFIED: search snippet of Haney interviews]. For a patch-graph tool, the equivalent is an interaction graph that round-trips to a familiar code-like text form (JSON or TS-like reactive code), not an opaque binary [INFERRED].
2. **Paper's MCP server is a local Streamable-HTTP server inside the desktop app.** It listens on `http://127.0.0.1:29979/mcp`, supports multiple concurrent agent sessions, blocks browser origins and DNS rebinding, and proxies every tool call into the editor renderer [VERIFIED: bundle `src/mcp/server.ts`, `bridge.ts`]. Tool definitions live in the web client bundle and are fetched at runtime, so the tool surface ships with the web app rather than the desktop binary. A Go CLI (`~/.paper/bin/paper mcp`) provides a stdio relay for clients that need it [VERIFIED].
3. **Paper's docs are out of date relative to the live surface.** `paper.design/docs/mcp` lists 21 tools. The live config has **34**. Missing from the docs: `open_file`, `list_files`, `create_file`, `create_page`, `find_nodes`, the four comment-thread tools, `export_combined_pdf`, `get_tokens`, `create_tokens`, `set_tokens` [VERIFIED]. The build log (release notes) is the better source: April 2026 layer reorder/reparent tools, May 2026 file creation and page navigation, June 2026 tokens, August 2026 comments and background-tab agents.
4. **The common pattern across AI-friendly tools**, which the product should adopt [VERIFIED across sources; synthesis INFERRED]:
   - A **guide/schema tool the agent must read first**: Paper `get_guide("paper-mcp-instructions")`, Excalidraw `read_me`, Pencil `get_guidelines`, Blender `search_api_docs`, n8n `get_node(detail)`.
   - **Batch writes** with per-item results: Paper `update_styles`, `move_nodes`, `create_tokens`; Pencil `batch_design`; n8n `n8n_update_partial_workflow` diff ops.
   - **Stable IDs returned from writes**: Paper `duplicate_nodes` returns a `descendantIdMap` and `move_nodes` "preserves node identity"; Figma's skill requires returning all created and mutated IDs.
   - **Cheap structural readback before visual readback**: Paper `get_tree_summary` is "much cheaper than getJSX"; Figma `get_metadata` returns sparse XML; Pencil `snapshot_layout`.
   - **Screenshots for visual QA only, never as the source of truth for measurements.**
   - **Visible, incremental agent work**: Paper says "The user sees you write on the canvas in real-time"; tldraw streams actions; Excalidraw streams elements and moves the camera.
   - **An explicit end-of-work signal**: Paper's `finish_working_on_nodes` clears the "working indicator".
   - **Guardrails**: MCP annotations `readOnlyHint`/`destructiveHint`, Paper's extra `consequentialHint` on `delete_nodes`, Framer branches, Unity per-tool enablement and client approval, Blender "do not destructively modify objects without confirmation".
5. **Emerging trend: MCP plus CLI plus Skills.**
   - Unity's official docs now say **"Unity MCP server is deprecated. Use the Unity command-line interface (CLI) instead"** [VERIFIED: com.unity.ai.assistant@2.18 docs].
   - Framer 3.0 (June 16, 2026) connects external agents via `npx @framer/agent setup`, which installs Skills with "no separate MCP server" [VERIFIED].
   - Paper ships both a Go CLI relay and agent plugins/Skills. Figma pairs its MCP server with Skills [VERIFIED].
   - Recommendation: one operation core exposed through MCP, a CLI, and Skills/guides, with identical semantics [INFERRED].
6. **What the design tools lack and a prototyping tool needs: simulation.** None of the design-tool MCP servers studied expose deterministic time stepping or input dispatch for interactive prototypes. The closest analogs are n8n `n8n_test_workflow`, TouchDesigner `get_top_image` and `get_td_node_errors`, and Unity camera capture tools [VERIFIED as tools; the gap is INFERRED]. This is the strongest differentiator available: `sim_reset`, `sim_dispatch` (tap/drag/scroll), `sim_step` (frames or until settled), `sim_trace` (columnar values over time), and screenshot-at-time. A full proposed surface is in section 17.

---

## 1. Paper (paper.design): positioning and marketing claims

- **Tagline and positioning.** "A connected canvas for teams shipping with agents": design, code, and data on one workspace built on web standards. The site claims "Design exports as code. nothing gets lost in translation." It connects "IDEs, CLI tools, and AI agents through Model Context Protocol (MCP)" and supports designing with live data "from databases, APIs, and cloud services rather than placeholder text" [VERIFIED: https://paper.design, fetched 2026-09-16].
- **Anti-slop framing.** Agents take the repetitive work (responsive variants, style variations) so humans focus on creative decisions [VERIFIED: https://paper.design]. Haney: "The human designer figured out the design, but they need to ship it in eight different ways, and there's a lot of boilerplate in that. Let's save them eight hours." [VERIFIED: https://designerfounders.substack.com/p/paper-stephen-haney, July 23, 2026]
- **Why HTML/CSS.** "AI agents work in a language they already understand, editing designs by generating HTML instead of translating between formats while keeping token costs low." [VERIFIED: same interview] Haney on demand: "I didn't think designers would be in the terminal prompting away in a CLI, but they were." [VERIFIED]
- **Blog, "A real space to design in the age of agents"** (Agu Seguí, Feb 27, 2026) [VERIFIED: https://paper.design/blog/a-real-space-to-design-in-the-age-of-agents]:
  - "If the canvas is built on the same standards as the product—html, css, dom—then you're not drawing a metaphor of a UI."
  - Bidirectional design and code: "go from design to code and back whenever you want."
  - Agents "read and write html to Paper."
  - Canvas as "a thinking tool" and "visual interface for collaborating with people, teams and their personal agents."
  - Against pure AI design: agents are best at "boilerplate, refactoring, tedious responsive adjustments."
- **Compare page** [VERIFIED: https://paper.design/compare/figma]:
  - Paper: "Real HTML/CSS — web-native, no translation step." Figma: "Proprietary model (WebGL-based canvas)."
  - Paper: "Real CSS styles, outlines, shadows, filters, plus… shaders." Figma: borders and shadows "as abstracted properties — require translation to CSS."
  - Color: Paper supports "sRGB and Display P3 simultaneously" plus OkLCH/Oklab. Figma has a file-wide sRGB/P3 toggle and an HSB/HSL picker.
- **Plugin README claim:** "Because Paper is based on web technology and LLMs are fluent in HTML/CSS, your agent can read and write to your design files with high fidelity — turning your canvas into a live collaboration surface between you and your agent." [VERIFIED: github.com/paper-design/agent-plugins `plugins/paper-desktop/README.md`]
- **Funding:** $34M Series A from Accel and ICONIQ, noted around July 2026 [VERIFIED: paper.design homepage summary].

## 2. Paper: how the canvas is built

- **Real DOM/CSS canvas.** Paper's own materials say the canvas is HTML/CSS [VERIFIED: compare page, blog]. The MCP write rules are consistent with a DOM-based node model where layers are HTML elements [VERIFIED: config.json `write_html` description]:
  - Flex is the primary layout.
  - "Do NOT use: margin, display: inline, display: grid, HTML tables."
  - "Assume border-box sizing everywhere."
  - `layer-name` attribute sets layer names.
  - Text nodes have component type `"Text"`, and "Rich text isn't supported."
- **It is a restricted subset of HTML/CSS, not arbitrary web pages** [VERIFIED: `write_html` rules; INFERRED interpretation]. Unsupported or inert styles are dropped, and their keys come back as `ignoredStyles` from `update_styles` [VERIFIED]. The agent gets feedback instead of silent failure.
- **Desktop shell.** Electron app packaged with ToDesktop: bundle id `com.todesktop.2601167vjw8xe`, `CFBundleShortVersionString` 0.5.8, build `260910c6c61cnhq` [VERIFIED: Info.plist]. The window loads the web client (`https://app.paper.design`) in tabs, and the desktop layer adds MCP, auth, CLI install, PDF export, and deep links [VERIFIED: asar file list and `src/`].
- **html-in-canvas.** `main.ts` enables Chromium's experimental `CanvasDrawElement` Blink feature (WICG html-in-canvas), with a code comment saying it is used "for video export on desktop" [VERIFIED: bundle `src/main.ts`]. The background-throttling module notes that "html-in-canvas" must snapshot "newly created capture elements" and that a never-shown view "has no compositor surface" [VERIFIED]. So DOM content is rasterized into a canvas for export and capture [INFERRED: likely also used for screenshots].
- **Sync.** Real-time multiplayer: cursors, "cursor following", comments. The app uses a "Paper sync server" in its auth flow (README: "we use the Paper sync server to exchange the code + code verifier") [VERIFIED: bundle README, build log].
- **Other capabilities** [VERIFIED: https://paper.design/build-log]:
  - Paper Snapshot: "copy any webpage into Paper as editable layers" (April 2026).
  - Figma copy/paste (May 2026).
  - Tokens (June 2026).
  - Pen tool for vectors (June 2026).
  - Shaders (Halftone CMYK, Liquid Metal).
  - AI image generation via `paper-gen://` URLs inside HTML/styles.

## 3. Paper MCP server: architecture (from the installed bundle)

All items [VERIFIED] from `/Applications/Paper.app/Contents/Resources/app.asar` (`package.json`, `src/mcp/server.ts`, `bridge.ts`, `index.ts`, `mcp-body-schema.ts`, `self-capture-hold.ts`, `src/auth/auth-through-mcp.ts`, `src/cli/install.ts`, `src/main.ts`, `src/window/lib/background-throttling.ts`, `src/window/paper-tab.ts`) and CLI binary strings, unless marked otherwise.

### 3.1 Transport and stack
- Dependencies: `@modelcontextprotocol/sdk` 1.26.0, `@hono/mcp` 0.2.3 (`StreamableHTTPTransport`), `hono` 4.12.30, `@hono/node-server` 1.19.9, `zod` 4.3.6, `@workos-inc/node` 8.0.0 (auth), `posthog-node` (telemetry), `pdf-lib`.
- Port `29979`, endpoint `/mcp`, bound to `127.0.0.1` only. Server name `paper-desktop`, version = app version. Capabilities advertised: `tools` only, no resources or prompts. Server-level `instructions` come from the client config.
- **Tools are proxied, not defined in the desktop binary.** On each new session the server fetches `getMCPServerConfig` from the renderer (tools and instructions) through the bridge. `ListTools` returns those definitions. `CallTool` forwards `handleToolCall(sessionId, name, args, clientInfo)` into the renderer. Any thrown error becomes a tool result with `isError: true` and the message text.
- **Bridge mechanism.** The main process calls `webContents.executeJavaScript` to reach `window.resolveMCPHandlers` in the editor tab. It waits up to 10 s, polling every 50 ms, for handlers to exist. Failures produce "Could not find Paper. Is it running?"; unknown methods produce `Tool call "<name>" does not exist.`
- **Sessions.** Multiple concurrent sessions ("e.g. Cursor + Claude Code"), keyed by the `mcp-session-id` header. A session is created on demand for any POST, including after a server restart ("resurrection"), with no `initialize` gate. DELETE ends a session and calls `removeAgent` to "Remove agent from file data" (agent presence is part of the file state; INFERRED to mean the presence indicator). GET serves SSE for an existing session.
- **Client identification.** Client info is parsed from `params._meta["io.modelcontextprotocol/clientInfo"]` or from `initialize.clientInfo` [VERIFIED: `mcp-body-schema.ts`]. Used for attributing agents [INFERRED].

### 3.2 Security hardening
- Rejects CORS preflight `OPTIONS` (403), rejects any request carrying an `Origin` header ("browsers send this, MCP clients don't"), and validates `Host` against `127.0.0.1:29979`/`localhost:29979` to prevent DNS rebinding.
- Client-compatibility shims:
  - Adds the missing `Accept: application/json, text/event-stream` header, because some clients (Claude Code) omit it and got 406 errors they misread as auth failures (comment references claude-code issue #42470).
  - Returns bare 404s on `/.well-known/oauth-*` and `openid-configuration`.
  - Deliberately avoids OAuth-shaped JSON field names (`error`, `error_description`) in the 401 and not-found bodies so Claude Code does not start OAuth discovery.
  - Not-found hint text: "Route not found. The MCP endpoint is /mcp. Try restarting your agent and Paper."
- **Headless mode** (`PAPER_HEADLESS_MCP=true`): bearer-token middleware. The first token is validated against Paper's API `/auth/me` and then "locks the process to a single Paper user". Tokens are compared by SHA-256 plus `timingSafeEqual`. Headless requires that the desktop app is not already running (single-instance lock message). An "auth-through-MCP" flow exists with a `waiting-for-mcp-auth.html` template.
  - Observation [INFERRED from code reading]: after the first validated token, a non-matching token is accepted as a presumed refresh without re-validation. For our product, validate refreshes too.

### 3.3 Routing agent calls to files and tabs (multi-file, background tabs)
- `bridge.ts` keeps a per-agent **session binding** `{windowId, tabId, fileId?}`:
  - The first call without `fileId` latches onto the focused window's active tab. If that tab is a file, the binding becomes sticky to that file; if it is Home, the binding stays provisional.
  - `open_file` with `fileId` re-homes the session.
  - Any other tool with `fileId` is a one-off routing hint that leaves the session untouched, "so the agent isn't dragged along by a quick look at another file."
  - An invalid `fileId` fails loudly: "a provided-but-invalid fileId must fail loudly. Treating it as absent would silently route the call (often a write) to… a different file."
  - Calls route to whichever window already has the file open. A closed tab is revived from the file id. It never falls back to "whatever the user is currently viewing" for writes.
- During a tool call the tab's **background throttling is disabled**, and inactive tabs are briefly shown so rendering and capture work. On Linux/Wayland the tab self-captures via `getDisplayMedia` at 2x2 px and 1 fps so frames keep flowing when the window is occluded. Tabs in state `'agent-busy'` are not unloaded.
- When a tool call needs a new window, "we prefer creating a headless window so it doesn't steal focus from the user" (`main.ts`).
- Build-log cross-check: "Desktop tabs for simultaneous multi-file work; agents operate across background tabs" (August 2026) [VERIFIED].

### 3.4 CLI relay, plugins, bundles
- A Go binary ships inside the app at `app.asar.unpacked/dist/cli-bin/darwin-arm64/paper`. The app installs it to `~/.paper/bin/paper` with an atomic replace, "so a `paper mcp` spawning mid-install never execs a half-written binary."
- CLI strings: `mcp — Start the MCP stdio relay`, `relayToMCPServer`, `http://127.0.0.1:29979`, `/mcp/desktop/config.json`, `https://app.paper.design`, "Timed out waiting for a response from the Paper MCP server", and "Paper MCP tools were unable to be discovered. You MUST tell the user that Paper MCP tools could not be discovered and they should try restarting Paper and their agent harness, then try again."
  - Interpretation [INFERRED]: the relay lists tools from the live local config when Paper is running, else from the CDN config, so the client sees tools even before Paper starts. Errors are phrased as instructions to the model.
- Plugins [VERIFIED: https://github.com/paper-design/agent-plugins]:
  - Claude Code: `/plugin marketplace add paper-design/agent-plugins`, then `/plugin install paper-desktop@paper`. The plugin's `mcp.claude.json` runs `${HOME}/.paper/bin/paper mcp` (stdio). Plugin version 0.2.1, MIT.
  - Cursor: `/add-plugin paper-desktop`.
  - Codex: plugin JSON in the same repo.
  - Claude Desktop: `.mcpb` bundle (manifest_version 0.4, `"tools_generated": true`, server type `binary`).
- Manual config [VERIFIED: https://paper.design/docs/mcp]: `claude mcp add paper --transport http http://127.0.0.1:29979/mcp --scope user`. Equivalent configs are documented for Claude Desktop (`npx mcp-remote`), Codex, VS Code Copilot, Antigravity, and OpenCode.
- **CONFLICT:** the docs say "opening a file in the app will automatically start the MCP server." In code, `initMcpServer` runs at app startup after the first window is created, and file binding happens lazily per call [VERIFIED code; INFERRED that the docs simplify].

## 4. Paper MCP tool catalog (live config, 34 tools)

Source: `https://app.paper.design/mcp/desktop/config.json` [VERIFIED]. Almost every file-scoped tool also takes an optional `fileId` (string): "Pass it to reliably target a specific file when several are open at once (e.g. multiple agents from the same session working in parallel). Omit to use the most recently opened file in the session." In the tables, `*` means required. Annotations are exactly as declared.

### 4.1 Files and pages
| Tool | Annotations | Args | Behavior / returns |
|---|---|---|---|
| `open_file` | readOnlyHint | `fileId*` (bare id, `/file/<id>` route, or full URL), `pageId` | Opens the file (optionally a page). Subsequent calls without `fileId` target it. Returns the same as `get_basic_info`. |
| `list_files` | readOnlyHint | `limit` (int, default 50) | Files the user has open, then recent team files, sorted by `updatedAt` desc. |
| `create_file` | destructiveHint | `cloneFileId`, `name` | Creates a file in the active team and returns its id. Does not open it. |
| `create_page` | destructiveHint | `name` (default "Page N") | Returns the page id. Does not switch pages. |

### 4.2 Read and readback
| Tool | Annotations | Args | Behavior / returns |
|---|---|---|---|
| `get_basic_info` | readOnly | (fileId) | File name, page name, node count, artboards with dimensions, font families used, a compact token list. `worldX/worldY` = world position; `x/y` = relative to parent. "Call get_basic_info first." |
| `get_selection` | readOnly | (fileId) | Selected nodes: IDs, names, component types, size, artboard. |
| `get_node_info` | readOnly | `nodeId*` | Size, visibility, lock state, parent, children IDs, text, world and relative positions. For generated images: `imageGeneration.status` (processing/ready/error) and `.output` (raster/svg), which the agent polls. Errors if the node is missing. |
| `get_children` | readOnly | `nodeId*` | Direct children with id, name, component type, child count, positions. |
| `get_tree_summary` | readOnly | `nodeId*`, `depth` (default 3, max 10) | Indented tree (type, name, id, dimensions). "Much cheaper than getJSX… use this for orientation." Nodes past the depth show a child-count hint. |
| `get_screenshot` | readOnly | `nodeId*`, `scale` (1 default; 2 "only when you need to read small text") | Base64 image, "automatically capped to fit API size limits". "Capture child nodes when needing higher resolution." |
| `get_jsx` | readOnly | `nodeId*`, `format` enum `tailwind` (default, with inline fallback) \| `inline-styles` | JSX for the subtree. |
| `get_computed_styles` | readOnly | `nodeIds*` (string[]) | Map of nodeId to CSSProperties. Batch. |
| `get_fill_image` | readOnly | `nodeId*` | Base64 JPEG "optimized for AI consumption", auto-resized, plus the original URL in metadata. Tells the agent to use `get_jsx` for SVGs and to poll `get_node_info` while generating. |
| `find_nodes` | readOnly | `nodeId` (scope), `textValue` (case-insensitive, `*` wildcard anchored to the whole value), `filters[]` `{styleName?, styleValue?}` (AND; `*` wildcards; colors match by equivalence, e.g. "#ccc" == "rgb(204, 204, 204)"; a literal color also finds token-bound usages, reported as `var(--token)`) | Results carry id, name, component, and a `matched[]` array explaining why each matched. Designed for "locating everything using a given token… before a bulk update." |
| `get_font_family_info` | readOnly | `familyNames*` (string[]) | Availability (local machine or Google Fonts), weights and styles. The instructions require calling it before the first typographic styling. |
| `get_guide` | readOnly | `topic*`: `paper-mcp-instructions`, `mobile-status-bar`, `figma-import`, `image-generation` | Long-form guides. The server instructions say "You MUST load the full guide before other Paper tools… call again if a long thread may have compressed or dropped guide text." |
| `get_tokens` | readOnly | `types[]` (enum below), `namePattern` (glob on the CSS variable name), `format` `json` (default) \| `css` (`:root{}`) \| `tailwind` (Tailwind v4 `@theme{}`) | Lists design tokens. |

### 4.3 Comments
| Tool | Annotations | Args | Behavior |
|---|---|---|---|
| `list_comment_threads` | readOnly | `pageId`, `currentPageOnly`, `nodeId`, `status` (`open` default \| `resolved` \| `all`), `search`, `searchScope` (`first-message` \| `all-messages` default), `participantUserId` / `threadAuthorUserId` (accept `"current-user"`; "never guess user IDs"), `sortField` (`page` default \| `createdAt` \| `updatedAt`), `sortDirection` (`asc` default), `limit` (50), `offset` (0), `previewLength` (240) | Compact summaries. "If you are tasked and fully addressing a thread's feedback, mark it done with set_comment_thread_status." |
| `get_comment_thread` | readOnly | `commentThreadId*` | Full replies, reactions, attachments, page and node context. |
| `list_comment_thread_authors` | readOnly | `pageId` | Users with ids and activity counts, for resolving names to ids. |
| `set_comment_thread_status` | destructiveHint | `commentThreadId*`, `status*` `open` \| `resolved` | Resolve or reopen. |

### 4.4 Export
| Tool | Annotations | Args | Behavior |
|---|---|---|---|
| `export` | readOnlyHint | `type` `image` (default) \| `video`; `nodes*` = either `"nodes-with-exports-only"` or a record keyed by nodeId → array of `{format*: avif\|jpg\|mp4\|pdf\|png\|svg\|webm\|webp, scale*: /^\d+(\.\d+)?(x\|w\|h\|p)$/ (e.g. "0.5x", "720p", "512w", "512h"), durationSeconds (default 10, 1–300), pdfQuality (low\|medium\|high default), pdfResampling (detailed default \| basic)}`. An empty array means use defaults. | "Unless the user specifies, do not override the default export settings." SVG only for SVG nodes. mp4 is opaque; webm is transparent. |
| `export_combined_pdf` | readOnlyHint | `nodeIds*` | One PDF, one page per node, auto-ordered top-to-bottom then left-to-right. |

### 4.5 Write
| Tool | Annotations | Args | Behavior / notable description text |
|---|---|---|---|
| `write_html` | destructiveHint | `html*`, `targetNodeId*`, `mode*` `insert-children` \| `replace` | "IMPORTANT: Write incrementally. The user sees you write on the canvas in real-time. Show them visual progress every few seconds. Each write_html call should create one visual item…" Prefers cloning existing nodes with an `<x-paper-clone node-id="…" style="…"/>` element. Rules: inline styles only; tokens as CSS variables; all Google and local fonts available; any CSS color format; flex primary; absolute OK for decoration; no margin, inline, grid, or tables; border-box; `<pre>` for code; no emoji icons; single-color code blocks (no rich text); `layer-name` attribute; local images via `paper-asset:///abs/path`; `paper-gen://` for AI images "ONLY if the user asked". |
| `create_artboard` | destructiveHint | `name*`, `styles*` (camelCase JSON; width and height required, whole px) | Returns the node id. Defaults `display:flex; flexDirection:column`. Auto-placed "in the best empty spot". Default sizes: Desktop 1440x900, Tablet 768x1024, Mobile 390x844 (include a status bar via the guide). Leave 80px between artboards. When clipping, switch to `height:"fit-content"` "instead of guessing". |
| `set_text_content` | destructiveHint | `updates*[{nodeId, textContent}]` | Batch. Only "Text" nodes. "Use this instead of writeHTML replace when you only need to change text." |
| `rename_nodes` | destructiveHint | `updates*[{nodeId, name}]` | Batch. Names over 50 chars are truncated. |
| `update_styles` | destructiveHint | `updates*[{nodeIds[], styles{camelCase: string\|number}}]` | Batch, many nodes per style set. Artboard `top`/`left` moves it on the canvas. Inert styles are dropped and returned as `ignoredStyles`. |
| `duplicate_nodes` | destructiveHint | `nodes*[{id, parentId?}]` | Deep clone. Returns source and new ids plus a `descendantIdMap` "so you can… immediately reference any cloned node… without any intermediate lookups." |
| `move_nodes` | destructiveHint | `moves*[]` (minItems 1), each one of `{nodeId, before}` \| `{nodeId, after}` \| `{nodeId, parentId ('root' shortcut), index? clamped [0, childCount]}` | "Preserves node identity (IDs stay the same)." Applied sequentially. Layout-intent styles may be adjusted so a node does not collapse in its new parent. Returns the resolved `parentId`/`index` and `affectedParents` (post-batch child lists) "to refresh your mental model of the tree without a follow-up get_children." |
| `delete_nodes` | destructiveHint **+ consequentialHint** | `nodeIds*` | Deletes descendants too. "IMPORTANT: Before deleting nodes that you think have an incorrect parent verify using get_node_info first." |
| `finish_working_on_nodes` | readOnlyHint | `nodeIds?` | "MUST call this when done working. Remove the working indicator from artboards you were editing." No args releases all. |
| `create_tokens` | destructiveHint | `tokens*[{type (breakpoint\|color\|container\|fontFamily\|fontSize\|fontWeight\|letterSpacing\|lineHeight\|radius\|spacing), name (/^--[a-zA-Z0-9_-]+$/), value (string\|number; aliases via `var(--x)`), description? ≤1024}]` | Per-entry `{name, result:"created"}` or `{result:"error", message}` in-band. Ordering guidance: semantic colors before palette, neutrals first; other types smallest value first. "Prefer reusing design tokens before creating new ones." |
| `set_tokens` | destructiveHint | `tokens*[{name*, newName?, value?, description?, delete?: boolean}]` | Rename, update, or delete, applied sequentially, with per-entry results in-band. |

### 4.6 Server `instructions` (sent at initialize) [VERIFIED; paraphrased with short quotes]
- "You MUST load the full guide before other Paper tools: get_guide({ topic: "paper-mcp-instructions" })."
- Context: `get_basic_info` first; `get_selection` for user focus.
- Typography: MUST call `get_font_family_info` before the first typographic styling. px for font size, em for letter-spacing, px for line-height.
- New designs: "generate a brief (palette, type scale, spacing, direction)" before writing HTML, unless a design system exists.
- "each write_html call should add roughly one visual group; prefer duplicate_nodes with update_styles and set_text_content when it is faster than rewriting HTML."
- Quality: `get_screenshot` "after meaningful changes"; fit-content rather than guessed heights.
- Repeated rows: fixed-width slots (`flexShrink: 0`); "do not rely on gap alone to align columns."
- "When done creating or editing, you MUST call finish_working_on_nodes."
- "User-facing output: do not include raw node IDs."
- Export to code: use `get_jsx`, `get_computed_styles`, `get_fill_image` "for exact values — do not read sizes or colors from screenshots alone."

### 4.7 Docs vs release notes vs live config (flagged changes)
| Item | Docs (/docs/mcp) | Release notes (/build-log) | Live config (2026-09-16) |
|---|---|---|---|
| Tool count | 21 listed | Tools added incrementally | **34** |
| File and page tools | absent | May 2026: "Agent toolcalls expanded (file creation, page navigation)" | `open_file`, `list_files`, `create_file`, `create_page` |
| Reorder / reparent | `move_nodes` listed | April 2026: "MCP tools for layer ordering/reparenting" | `move_nodes` with sibling-relative and parent-absolute shapes |
| Tokens | Tokens page says agents can create tokens from CSS variables | June 2026: tokens "using the MCP"; Aug 2026: in-app token creation "(previously MCP-only)" | `get_tokens`, `create_tokens`, `set_tokens` (absent from the MCP docs tool list) |
| Comments | absent | Aug 2026: comments with threading and resolution | 4 comment tools |
| Multi-file agents | absent | Aug 2026: "agents operate across background tabs" | `fileId` on every tool; sticky session binding in the bridge |
| `find_nodes` | absent | not called out | present |
| `export_combined_pdf` | absent | May 2026: PDF export for frames and multi-frame | present |
| Third-party review claims "24 tools" | — | — | Outdated (banani.co review snippet) |

### 4.8 Takeaways from Paper [INFERRED synthesis]
1. **Medium = model = interchange.** Writes are fragments in a language the model knows, and readback comes in the same language (JSX/CSS).
2. **Fine-grained, well-described tools.** 34 narrow tools beat one generic "execute code" tool when descriptions carry the design rules: incremental writes, fit-content, verify before delete.
3. **Every write returns what the next step needs**: ids, `descendantIdMap`, `affectedParents`, `ignoredStyles`, per-entry results.
4. **Presence and working indicators are first-class**, and an explicit "finish" call ends them.
5. **Tool knowledge ships with the web client** and is served as JSON, so tools can evolve without a desktop release.
6. **Robustness engineering for real clients**: header shims, avoiding OAuth-shaped errors, session resurrection, and never misrouting a write to the tab the user is viewing.

---

## 5. Figma MCP server (Dev Mode MCP and remote MCP)

### 5.1 Topology
- **Remote server (recommended):** `https://mcp.figma.com/mcp`, with OAuth. "Only clients listed in the Figma MCP Catalog… can connect." Claude Code: `claude plugin install figma@claude-plugins-official` (bundles the MCP config and Skills), or `claude mcp add --transport http figma https://mcp.figma.com/mcp` [VERIFIED: https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/].
- **Desktop server:** `http://127.0.0.1:3845/mcp`. Enable it in the Figma desktop app's Dev Mode (Shift+D) inspect panel under "Enable desktop MCP server". Supports **selection-based prompting**: "help you implement your current selection" [VERIFIED: …/local-server-installation/]. Figma for Government supports the desktop server only [VERIFIED: …/figma-mcp-server/].
- **Rate limits** [VERIFIED: …/rate-limits-access/]:
  - View/Collab seats: 20/month on Starter, 6/month on Pro, Org, and Enterprise.
  - Dev/Full seats: Starter 200/day and 10/min; Pro 200/day and 15/min; Org and Enterprise 600/day and 20/min.
  - Exempt tools: `add_code_connect_map`, `create_new_file`, `whoami`. `generate_figma_design` is "exempt from standard rate limits" [VERIFIED: tools page].
- **Launch of write-to-canvas:** blog "Agents, Meet the Figma Canvas", Matt Colyer, **March 24, 2026**. Free during beta; will become "a usage-based paid feature." Skills are "written as markdown files." Supported clients: Augment, Claude Code, Codex, Copilot CLI, Copilot in VS Code, Cursor, Factory, Firebender, Warp. "AI agents haven't had this context, which is why so many designs created by AI often feel unfamiliar and generic." Self-healing: agents "take a screenshot and iterate on what does not match" [VERIFIED: https://www.figma.com/blog/the-figma-canvas-is-now-open-to-agents/]. The launch skills named include `/figma-use`, `/figma-generate-library`, `/figma-generate-design`, `/apply-design-system`, `/sync-figma-token`, `/multi-agent` [VERIFIED as listed by the fetch; list may be partial].

### 5.2 Tools (from the tools and prompts page) [VERIFIED: https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/]
- **Design to code (read):**
  - `get_design_context(nodeId)`: default output React + Tailwind, customizable by prompt.
  - `get_metadata(nodeId?)`: "sparse XML outline" (ids, names, types, positions, sizes; page list if no nodeId).
  - `get_screenshot`: "Recommended to keep on: only turn it off if concerned about token limits."
  - `download_assets(nodeIds ≤20, defaultFormat, defaultScale 0.01–4)`: remote-only; sets `rawImagesTruncated: true` when capped.
  - `get_variable_defs`: variables and styles used.
  - `get_motion_context(nodeId, recursive=false)`: keyframe tracks, CSS `@keyframes`, and motion.dev snippets. Relevant to prototyping.
  - `get_figjam`: XML plus screenshots.
- **Design system and Code Connect:**
  - `get_libraries` and `search_design_system(queries[])` (remote-only).
  - `get_code_connect_map` (node id → `{componentName, source, snippet, version, label}`) and `add_code_connect_map`.
  - Figma-prompted `get_code_connect_suggestions`, `get_context_for_code_connect`, `send_code_connect_mappings`.
- **Write (code to design, all remote-only):**
  - `use_figma`: general create, edit, delete, and inspect across Design, FigJam, and Slides.
  - `generate_figma_design`: live web UI to layers.
  - `create_new_file`, `upload_assets` (≤10 MB per asset), `generate_diagram` (Mermaid or natural language → FigJam).
- **Generative plugins and shaders:** `list_generative_plugins`, `get_generative_plugin`, `create_generative_plugin(name, description, planKey)`, `update_generative_plugin(id, commitMessage*, files[code.ts|ui.html], metadata?)`, `list_shaders`, `get_shader`, `list_file_shaders(fileKey)`, `create_shader(kind effect|fill)`, `update_shader`. Scaffold-then-update pattern with commit messages and versioning.
- **Account:** `whoami` returns email and plans with `planKey`.
- **Weave (workflows):** `weave_list_tools`, `weave_get_tool_inputs` (input contract with nodeId, name, type, required, options, range, default), `weave_upload_asset`, `weave_run_tool(recipeId, inputs, numberOfRuns 1–10, acknowledgedCost)`, `weave_get_tool_run_output` (RUNNING/COMPLETED/FAILED/CANCELED), `weave_cancel_tool_run`. Notable: **a cost gate returned as a status** (`cost_confirmation_required`, `inputs_required`) rather than an error.
- **Prompt:** `create_design_system_rules`, which writes a rules file for agents.

### 5.3 How agents actually write: `use_figma` executes Plugin API JavaScript
- The local `figma-use` skill (plugin v2.2.111) states: "Use the `use_figma` tool to execute JavaScript in Figma files via the Plugin API" [VERIFIED: `~/.claude/plugins/cache/claude-plugins-official/figma/2.2.111/skills/figma-use/SKILL.md`].
  - **CONFLICT:** the fetched blog summary paraphrased it as "rather than executing Plugin API JavaScript directly". The skill file is authoritative for mechanics. The blog likely meant it runs inside Figma's security sandbox [INFERRED].
- Skill rules that generalize [VERIFIED: skill file]:
  - Top-level `await`/`return`; "The agent sees ONLY the value you return."
  - "Work incrementally in small steps… This is the single most important practice for avoiding bugs."
  - "MUST `return` ALL created/mutated node IDs", e.g. `{createdNodeIds, mutatedNodeIds}`.
  - On error, obey **`safeToRetryWithoutCanvasRead`**: if true, fix and retry; if false, read the canvas to see what changed first. This is a partial-failure contract.
  - Position new top-level nodes away from (0,0).
  - Page context resets between calls. Fan out multi-page work as N parallel tool calls in one message.
  - Efficient APIs: `node.query(selector)` (CSS-like selectors: `FRAME > TEXT`, `[name^=Header]`, `:nth-child`, `[fills.0.type=SOLID]`) and `node.set(props)` with priority ordering (e.g. `layoutMode` applied before width/height).
  - Validation: after each step, check structure with `get_metadata` and visuals with `get_screenshot`; "Write a targeted fix script that modifies only the broken parts — don't recreate everything."
  - "Always inspect the Figma file before creating anything… match what's already there."
  - Error self-correction table mapping exact error strings to causes and fixes.

## 6. Pencil → pen.dev

- **Rename:** `https://www.pencil.dev/` returns 307 to `https://www.pen.dev/` [VERIFIED].
- **Claims** [VERIFIED: https://www.pen.dev/]:
  - "Agentic canvas for building bold ideas."
  - Custom WebGL pipeline for "thousands of layers."
  - Works with Claude, OpenAI, Grok, Qwen, Gemini, Kimi, Deepseek, and Minimax, via subscription, API key, MCP, WebMCP, CLI, or a Chrome capture extension.
  - HTML/CSS/Tailwind export. Components with overrides and slots, flex layout, variables, mesh gradients, shaders, slides mode.
  - Backed by a16z speedrun.
- **`.pen` format** [VERIFIED: https://docs.pen.dev/for-developers/the-pen-format]:
  - "just a JSON file that allows agents to work with it natively. Schema fully opened" (homepage). The document is "an object tree, not unlike HTML or SVG."
  - Root: `version` (currently "2.18"), `themes`, `imports` (other .pen files), `variables`, `children`.
  - Node types: Frame, Group, Rectangle, Ellipse, Polygon, Path, Text, **Note, Prompt, Context**, Icon, **Script, Browser**, Ref. Every node needs `id` (no slashes) and `type`.
  - Size: number, `"fit_content"`, or `"fill_container"`. Layout: `layout: none|vertical|horizontal`, `gap`, `padding`, `justifyContent`, `alignItems`.
  - Components: `reusable: true`. Instances: `type:"ref"`, `ref:<id>`, with `descendants` overrides keyed by **ID paths** (e.g. `"button/label"`). Supports property overrides, full replacement (with `type`), or children replacement. `slot: [...]` marks replaceable frames.
  - Variables with themed values: `[{value, theme:{mode:"light"}}, …]`, referenced as `$variable-name`.
  - "we reserve the right to introduce breaking changes."
- **Design as code:** commit `.pen` files, "View diffs in Git (text-based format)", "Branch and merge designs with code" [VERIFIED: https://docs.pen.dev/core-concepts/design-as-code].
- **MCP exposure:** local, via the pen.dev desktop app or an IDE extension. Enabled in Settings → MCP [VERIFIED: https://docs.pen.dev/getting-started/ai-integration].
- **Tool surface CONFLICT (churn):**
  - Current docs list `get_style`, `read_skill`, `get_app_state`, `execute`, `browser` (desktop only), and `spawn_agents` (needs a startup flag), and advise checking "the client's live tool list for the tools in your installed version" [VERIFIED].
  - A widely used community skill documents the older Pencil tool set [VERIFIED: https://github.com/unliftedq/skills/blob/main/skills/pencil-dev/SKILL.md]:
    - `get_editor_state` ("active .pen file, selection, and schema")
    - `open_document`
    - `get_guidelines(topic: design-system, web-app, mobile-app, landing-page, slides, table, code, tailwind)`
    - `get_style_guide_tags`, `get_style_guide`
    - `get_variables`, `set_variables`
    - `batch_get` ("read nodes, search for components… in as few calls as possible")
    - `batch_design`: insert, copy, update, replace, move, delete, using a compact operation DSL, e.g. `rect=Insert(document,{type:"rectangle",…})` that binds a handle name to the new node [VERIFIED example in a search snippet]
    - `find_empty_space_on_canvas`
    - `snapshot_layout` ("catch clipping, overlap, and layout issues")
    - `get_screenshot` ("Visual QA only, never the primary source of structure")
    - `search_all_unique_properties`, `replace_all_matching_properties`, `export_nodes`
  - Interpretation [INFERRED]: pen.dev consolidated many specific tools into a code-execution tool (`execute`) plus skills. That matches the Anthropic "code execution with MCP" direction (section 13).
- **Parallel agents:** "Split Work" (agents do different parts), "Side by Side" (alternatives), "Let it Cook" (successive variants in Layout or Style modes). Custom `SKILL.md` files load via the `/` menu [VERIFIED: https://docs.pen.dev/core-concepts/ai-agents].

## 7. Framer

- **Framer 3.0, launched June 16, 2026:** in-canvas **Framer Agents**, **Branching** ("isolated copies of your live site"), **External Agents**, AI Credits pricing [VERIFIED: https://alternativeto.net/news/2026/6/framer-3-0-launches-ai-agents-branching-external-agents-and-a-redesigned-community/ and multiple review posts].
- **External agents** [VERIFIED: https://www.framer.com/agents/external/, https://www.framer.com/help/articles/use-external-agents-with-framer/]:
  - "Framer doesn't require a separate MCP server." Setup is `npx @framer/agent setup`, which installs Skills into the agent's skills directories. Then run `/framer` in the agent and authorize in the browser. The first use adds an API key.
  - Works with "any AI that can run a terminal command or call an MCP tool."
  - Access is project-scoped and revocable. Agents cannot touch account settings or billing.
  - **"Every external agent change automatically occurs on a separate branch"**, and changes "only go live when you choose to publish them yourself."
  - Limitations: cannot modify project settings, assign component overrides, or read analytics.
- **Workshop:** natural language to code components inside the editor. **Wireframer:** text to layout [VERIFIED: framer.com dictionary pages].
- Lessons [INFERRED]: branching is the strongest guard against destructive agent edits. CLI plus Skills avoids MCP client-compatibility issues.

## 8. Rive (interactive animation: closest domain match)

- **Local MCP** bundled in the desktop editor at **`http://127.0.0.1:9791/mcp`**. Claude Code: `claude mcp add --transport http rive http://127.0.0.1:9791/mcp` [VERIFIED: https://rive.app/docs/editor/ai/mcp].
- **Capabilities** [VERIFIED: same page]:
  - Artboards: add, rename, resize, arrange, focus.
  - Hierarchy: query, select, update properties, duplicate, reorder, reparent, delete.
  - Shapes, paths, layouts, component instances, asset-based elements.
  - **Linear animations, state machines, states, transitions, conditions, keyframes.**
  - **Data binding: view models, properties, instances, bindings, custom property groups.**
  - Luau scripts and WGSL shaders with diagnostics and compilation.
  - Usage flow: open a file, prompt, and type "End Prompt" to allow modifications.
- **Timeline:** MCP Early Access announced around May 2025 ("handle repetitive tasks, like creating complex View Models, State Machines, Layouts, Shapes") [VERIFIED: https://x.com/rive_app/status/1925573205215035398]. A later "Rive MCP update just landed in Early Access… Connect Claude Code, Codex, Cursor… write scripts, design responsive layouts, build State Machines, work with View Models" [VERIFIED: https://x.com/rive_app/status/2065197395496022108; exact date not captured]. PulseMCP lists the server release as January 9, 2025 [VERIFIED: pulsemcp; CONFLICT with the May 2025 announcement, likely a registry date].
- **Built-in AI coding agent** in the editor, billed via AI credits [VERIFIED: https://community.rive.app/c/announcements/the-ai-coding-agent-is-in-the-rive-editor (title only) and search snippets].
- **Status CONFLICT:** a community discussion says the MCP was "phased out in favor of the built in AI Agent", and a GitHub issue requests "Re-enable MCP Access to Rive Editor" (rive-runtime #87). The official docs page has no deprecation notice [VERIFIED docs; community claim unverified]. Treat Rive MCP availability as volatile.
- Lessons [INFERRED]: state machines and view models are exactly the "logic graph" layer an Origami alternative needs. Rive's decision to expose them to agents as structured objects, not code only, validates typed graph ops.

## 9. tldraw (make real, tldraw computer, agent starter kit)

- **Make Real** (repository archived Feb 20, 2026) [VERIFIED: https://github.com/tldraw/make-real]. Its prompt files show the loop:
  - A screenshot of the selected wireframes goes to a vision model, which replies with "a high-fidelity working prototype as a single HTML file."
  - On iteration, the previous code goes back as `HISTORY… (Trust this over the screenshot quality)`.
  - "Treat anything in the color red as an annotation rather than part of the design."
  - The model is told to "fill in the blanks" [VERIFIED: `app/prompt.ts`].
  - Lessons: annotation conventions on the canvas, and **code beats screenshot** as the source of truth.
- **tldraw computer** (launched around Dec 2024) [VERIFIED: https://x.com/tldraw/status/1869401069849379109; description via https://www.hackscience.education/the-computer-you-draw-inside-tldraws-natural-language-os/]: a canvas of nodes (text, image, prompt) connected by arrows, where "The 'code' is the diagram." The tagline is roughly "the best interface for AI isn't a chat window, but a map." A natural-language node-graph precedent.
- **Agent starter kit** [VERIFIED: https://tldraw.dev/starter-kits/agent]:
  - Dual context: screenshots plus structured shapes in three fidelities. **BlurryShape** (bounds, id, type, text) for viewport shapes. **FocusedShape** (full props) for shapes under focus. **PeripheralShapeCluster** (grouped off-screen shapes with counts). This is level-of-detail context.
  - Actions: create, update, delete, freehand draw, batch align/distribute/stack/rotate/resize, `think`, message, todo list, viewport move, schedule further work and reviews.
  - Each action has validation, execution, and chat-panel presentation.
  - "Shapes get created, updated, and deleted incrementally as each action finishes streaming."
  - **Modes** define what the agent perceives ("parts") and can do ("actions").
  - Sanitization corrects model mistakes (id validation, type coercion). Offset management normalizes coordinates.
- **Docs** [VERIFIED: https://tldraw.dev/docs/ai]: "sending both [screenshot and structured data] to the model works best."

## 10. Excalidraw MCP (official)

[VERIFIED: https://github.com/excalidraw/excalidraw-mcp, `CLAUDE.md` and `src/server.ts`; remote at https://mcp.excalidraw.com]
- An **MCP App**: the tool result renders an interactive widget in the chat (Claude, ChatGPT, VS Code, Goose).
- **Model-facing tools:**
  - `read_me`: cheat sheet. The response begins "Thanks for calling read_me! Do NOT call it again in this conversation — you will not see anything new."
  - `create_view(elements: JSON string)`: "Keep compact. Call read_me first."
  - `export_to_excalidraw(json)`: upload to excalidraw.com.
- **App-only tools** (widget visibility): `save_checkpoint(id, data)` and `read_checkpoint(id)`.
- **Standard format, no extensions:** "Standard format means any `.excalidraw` file's elements array works as input." The cheat sheet adds `label` shorthand on shapes because it "Saves tokens vs separate text elements."
- **Pseudo-elements in the same stream:**
  - `cameraUpdate{x,y,width,height}`, which "MUST be 4:3", animates the viewport to guide attention.
  - `delete{ids:"a,b"}`: "Never reuse a deleted id."
  - `restoreCheckpoint{id}`.
- **Streaming UX:** partial JSON is parsed during `ontoolinputpartial`, the last incomplete element is dropped, the view re-renders when the element count changes, and morphdom diffs SVG so only new elements animate. Drawing order guidance: "Emit progressively: background → shape → its label → its arrows → next shape."
- **Model sees its output:** after the final render, the SVG is captured as a **512px-max PNG** and sent via `app.updateModelContext()`, debounced 1.5 s.
- **Checkpoints:** every `create_view` returns a `checkpointId` (18-char UUID fragment). "Server resolves checkpoints so the model never needs to re-send full element arrays." User edits in fullscreen sync back to the checkpoint, so human edits merge into the agent's next turn.
- **Errors that teach:** input over `MAX_INPUT_BYTES` returns "Reduce the number of elements or use checkpoints to build incrementally."
- **Animation mode:** delete and replace with camera nudges to create transformations during streaming. Directly relevant to demonstrating interactions [INFERRED].

## 11. Blender MCP

### 11.1 Official Blender Lab MCP server
- Blender Lab project, v1.0.3, requires Blender 5.1+. Architecture: a Blender add-on plus a separate MCP server process talking over a TCP socket. Installable as `.mcpb` or from source [VERIFIED: https://www.blender.org/lab/mcp-server/; https://projects.blender.org/lab/blender_mcp].
- Warning: "The MCP server will execute LLM generated code in Blender without any guards in place to protect your data from removal or being sent to a remote location" [VERIFIED].
- **Server instructions** observed in this session [VERIFIED]:
  - "Respect existing structure and naming conventions. NEVER assume missing values - inspect the scene first. Do not destructively modify objects without confirmation."
  - "`execute_blender_code` is a last resort." Bundled RST manuals: "Search and read them directly."
  - Advice on mode, active object and selection being distinct, and updating the dependency graph before reading computed values.
- **Tool schemas** loaded read-only in this session [VERIFIED]:
  - `execute_blender_code(code)`: return data by assigning a JSON-serializable dict to `result`.
  - `get_objects_summary()`: collection hierarchy with name, type, parent, data name, selection, visibility.
  - `get_object_detail_summary(name)`: transforms, modifiers, constraints, materials, collections.
  - `get_screenshot_of_window_as_json()`: layout, areas, active object, selection as JSON. A "screenshot" rendered as structure.
  - `get_screenshot_of_area_as_image(area_ui_type enum [VIEW_3D, ShaderNodeTree, GeometryNodeTree, DOPESHEET_EDITOR, GRAPH_EDITOR, OUTLINER, …], size_limit_in_bytes=0 → MCP message limit)`.
  - `jump_to_view3d_object_by_name(name, allow_edits=false)`: may unhide only if `allow_edits`.
  - `render_viewport_to_path(output_path)`, `render_thumbnail_to_path`.
  - `get_blendfile_summary_usage_guess()`: use cases scored 0–100 with certainty. Other `get_blendfile_summary_*` tools cover datablocks, missing files, linked libraries, and path info.
  - `search_api_docs(query, context=0, index?, max_results=20)`: ranked hits with path, text, breadcrumb, score.
  - `get_python_api_docs(identifier)`: kinds exact, namespace, definition, partial. Files over 32 KB are replaced with a summary. `*` and `X.*` discovery.
  - `search_manual_docs`, `jump_to_tab_by_name`, `jump_to_tab_by_space_type`.
  - `*_for_cli` variants for background mode.

### 11.2 Community blender-mcp (ahujasid)
- Add-on TCP server on port 9876 (`BLENDER_PORT`), JSON messages. Tools include `execute_blender_code`, `export_scene` (GLB/FBX), API/node-schema lookup, and asset integrations: Poly Haven, Sketchfab, Poly Pizza, Hyper3D Rodin, Hunyuan3D [VERIFIED: https://github.com/ahujasid/blender-mcp].
- Security: "The addon's socket server has no authentication or encryption." `BLENDER_MCP_SAFE_MODE=1` validates scripts, "blocking file access, network calls, and persistence exploits." Telemetry is on by default (`DISABLE_TELEMETRY=true`) [VERIFIED].

## 12. Unity MCP

- **Official** (`com.unity.ai.assistant`) [VERIFIED: https://docs.unity3d.com/Packages/com.unity.ai.assistant@2.0/manual/unity-mcp-overview.html]:
  - Architecture: AI client → **relay binary** (`~/.unity/relay/`, run with `--mcp`) → Editor bridge (`McpToolRegistry`) over local IPC (named pipes on Windows, Unix sockets on macOS/Linux).
  - **Gateway connections auto-approved; direct connections require user approval** in Project Settings, and approved clients are remembered.
  - Per-tool enable/disable under Edit > Project Settings > AI > Unity MCP.
  - Custom tools "detected and registered automatically at editor startup."
- **Built-in tools** [VERIFIED only via a third-party reference: https://gamedevllm.com/en/unity-mcp-builtin-tools-reference-en/]: 51 tools in 5 groups (Core 18, Assets 12, Assistant 1, Debug & Diagnostics 14, Editor 7). **Only 7 are enabled by default:** `Unity.RunCommand` (C# execution), `Unity.GetConsoleLogs`, `Unity.Camera.Capture`, `Unity.SceneView.Capture2DScene`, `Unity.SceneView.CaptureMultiAngleSceneView`, `Unity.AssetGeneration.GenerateAsset`, `Unity.AssetGeneration.GetModels`. Registered via an `[McpTool]` attribute.
- **CONFLICT / change:** in package docs 2.18.0-pre.2: "Unity MCP server is deprecated. Use the Unity command-line interface (CLI) instead. Unity CLI provides faster iteration times, improved stability, and the ability to target runtime and the Editor." [VERIFIED: https://docs.unity3d.com/Packages/com.unity.ai.assistant@2.18/manual/integration/unity-mcp-overview.html]. Version 2.0 docs have no such note.
- **Community CoplayDev/unity-mcp:** "47 focused MCP tool entrypoints", multi-instance routing, Roslyn-based script validation, tool groups (vfx, animation, ui, testing), Python server via `uv` [VERIFIED: https://github.com/CoplayDev/unity-mcp; per-tool names not captured].

## 13. Penpot (open-source precedent)

[VERIFIED: https://github.com/penpot/penpot/tree/develop/mcp README and `packages/server/src/tools/`]
- **Architecture:** MCP server plus a **Penpot MCP Plugin** connected over WebSocket. "The LLM is free to write and execute arbitrary code snippets within the Penpot Plugin environment." Run with `npx -y @penpot/mcp@latest`.
- **Ports:** `4401` (Streamable HTTP `/mcp`, legacy SSE `/sse`), `4402` (plugin WebSocket), `4403` (REPL, dev).
- **Configuration:** `PENPOT_MCP_TOOL_TIMEOUT_S` default 120. `PENPOT_MCP_REMOTE_MODE=true` disables filesystem access. Multi-user mode uses Redis pub/sub routing.
- **Tools (source files):** `ExecuteCodeTool`, `HighLevelOverviewTool`, `PenpotApiInfoTool`, `ExportShapeTool`, `ImportImageTool`, `ImportPenpotFileTool`, plus dev tools (ClojureScript REPL/compiler, parentheses checker, Taiga issue reader).
- **Guidance:** "use the most capable model… use a vision language model." "Do not close the plugin's UI… keep the Penpot tab active" because browsers suspend tabs. This is the same background-throttling problem Paper engineered around.

## 14. Node-graph tools (closest structural analogs)

### 14.1 n8n-mcp (community)
[VERIFIED: https://github.com/czlonkowski/n8n-mcp README and `src/types/workflow-diff.ts`]
- **Discovery with detail levels:**
  - `search_nodes(query, source, includeExamples)`
  - `get_node(nodeType, detail: minimal ~200 tokens | standard | full ~3000–8000 tokens, mode: info | docs | search_properties | versions | compare | breaking | migrations, propertyQuery, includeExamples)`
  - `search_templates(mode keyword | by_nodes | by_task | by_metadata)` and `get_template(mode nodes_only | structure | full)`
- **Validation:**
  - `validate_node(mode minimal | full, profile minimal | runtime | ai-friendly | strict)`: "errors with auto-fix suggestions".
  - `validate_workflow` (connections, expressions); `n8n_autofix_workflow`.
- **Partial graph diffs** (`n8n_update_partial_workflow`) operation types: `addNode`, `removeNode`, `updateNode`, `moveNode`, `enableNode`, `disableNode`, `patchNodeField`, `addConnection`, `removeConnection`, `rewireConnection`, `updateSettings`, `updateName`, `setNodeGroups`, `addTag`, `removeTag`, `activateWorkflow`, `deactivateWorkflow`, `transferWorkflow`, `moveToFolder`, `cleanStaleConnections`.
- **Testing:** `n8n_test_workflow(method auto | trigger | pinned | direct)`, `n8n_executions`.
- **Warnings:** "Make a copy of your workflow before using AI tools." "Default parameter values are the #1 source of runtime failures." IF-node routing needs `branch:'true'|'false'`.

### 14.2 TouchDesigner MCP (8beeeaaat)
[VERIFIED: https://github.com/8beeeaaat/touchdesigner-mcp]
- **Tools:** `create_td_node`, `delete_td_node`, `describe_td_tools` (manifest), `exec_node_method`, `execute_python_script`, `get_td_class_details`, `get_td_classes`, `get_td_info`, `get_td_module_help`, `get_td_node_errors` (node and children), `get_td_node_parameters`, `get_td_nodes` (under a parent path, filterable), `get_top_image` (captures a TOP's output), `update_td_node_parameters`.
- **Prompts:** "Search node", "Node connection", "Check node errors". Resources: not implemented.
- **API-version compatibility gating:** matching version works silently; an older component gets an "Update Recommended" notice appended to responses; a newer major version stops execution. Guided connection errors (ECONNREFUSED → start the WebServer DAT on port 9981), with failed checks cached for 60 s.

### 14.3 ComfyUI
- **Official Comfy-Org/comfy-mcp:** 40 tools (beta). Each tool shells out to `comfy … --where local --json` and parses comfy-cli's `envelope/1` output. Tools: run a workflow, monitor jobs (wait/watch/cancel, failure verdict), introspect installed nodes, models, and templates ("not a static catalog"), validate a graph, edit template slots, fan out variants, manage the server. A separate remote **Comfy Cloud MCP** at `https://cloud.comfy.org/mcp` [VERIFIED: https://github.com/Comfy-Org/comfy-mcp].
- The community `artokun/comfyui-mcp` claims 178 tools, a sidebar agent that edits the live graph, and a layout engine producing "untangled" workflows [VERIFIED as a claim: search snippets].

## 15. MCP protocol primitives relevant to design

[VERIFIED: https://modelcontextprotocol.io/specification/2025-11-25/server/tools, /server/resources, /server/prompts, /client/elicitation; https://modelcontextprotocol.io/docs/extensions/apps]
- **Tools are model-controlled.** Fields: `name`, `title`, `description`, `inputSchema` (JSON Schema 2020-12 default; no params should be `{type:"object", additionalProperties:false}`), `outputSchema`, `annotations`, `icons`, and `execution.taskSupport` (`forbidden` default \| `optional` \| `required`, for task-augmented long-running execution).
  - Names are 1–128 chars from `[A-Za-z0-9_.-]`.
  - Results: `content[]` (text, image, audio, `resource_link`, embedded `resource`) and `structuredContent`, which should also be serialized as text for backwards compatibility.
  - "Clients MUST consider tool annotations to be untrusted unless they come from trusted servers."
- **Errors:** protocol errors (JSON-RPC) vs **tool execution errors** (`isError: true`) that "contain actionable feedback that language models can use to self-correct and retry."
- **Annotation defaults** [INFERRED from the MCP schema as I know it; not re-fetched]: `readOnlyHint` false, `destructiveHint` true, `idempotentHint` false, `openWorldHint` true. Paper also sends a non-standard `consequentialHint` [VERIFIED].
- **Resources are application-driven:** `resources/list`, `resources/read`, `resources/templates/list` (RFC 6570 URI templates), `resources/subscribe` → `notifications/resources/updated`, `listChanged`. Annotations: `audience` (user/assistant), `priority` 0–1, `lastModified`.
- **Prompts are user-controlled** (e.g. slash commands): `prompts/list`, `prompts/get(name, arguments)` returns messages.
- **Elicitation:** `elicitation/create` in form mode (flat primitive schema; accept/decline/cancel) or URL mode (sensitive, out-of-band). Servers "MUST NOT" collect secrets in form mode. Useful for **confirming destructive batches** where supported [INFERRED].
- **MCP Apps:** a tool declares `_meta.ui.resourceUri` → `ui://` resource (HTML), rendered in a sandboxed iframe. JSON-RPC over postMessage (`ui/initialize`, `tools/call`, model-context updates). CSP via `_meta.ui.csp`. Supported by Claude, Claude Desktop, VS Code Copilot, M365 Copilot, Goose, Postman, MCPJam, and others. Excalidraw is the flagship example.
- **Anthropic tool-writing guidance** [VERIFIED: https://www.anthropic.com/engineering/writing-tools-for-agents]:
  - Consolidate operations. Namespace tools. Return meaningful context, preferring "semantically meaningful names or simple ID schemes" over UUIDs.
  - Offer a `response_format` of `"concise"` or `"detailed"`. Paginate, filter, and truncate with defaults ("For Claude Code, we restrict tool responses to 25,000 tokens by default").
  - Write actionable errors. "Even small refinements to tool descriptions can yield dramatic improvements." Build evaluations.
- **Code execution with MCP** (Nov 4, 2025) [VERIFIED: https://www.anthropic.com/engineering/code-execution-with-mcp]: progressive disclosure of tool definitions, filtering data in the execution environment, "150,000 tokens reduced to 2,000 tokens—a 98.7% reduction", persisted skills. Caveat: needs sandboxing.

---

## 16. Cross-tool pattern matrix

| Capability | Paper | Figma | pen.dev | Framer | Rive | tldraw kit | Excalidraw | Blender Lab | Unity | Penpot | n8n-mcp | TouchDesigner |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Transport | Local HTTP :29979 + stdio relay CLI | Remote HTTPS + desktop :3845 | Local (app / IDE ext), CLI, WebMCP | CLI + Skills, no MCP | Local HTTP :9791 | In-app agent | Remote HTTP / stdio, MCP App | stdio server ↔ TCP add-on | Relay ↔ IPC (deprecated → CLI) | Local HTTP :4401 + WS plugin | stdio/HTTP | HTTP to TD WebServer DAT :9981 |
| Write model | HTML fragments + typed batch tools | Plugin-API JS (`use_figma`) | Op DSL (`batch_design`) → `execute` | Agent CLI | Typed ops | Typed actions | Standard element JSON stream | Python | C# `RunCommand` + tools | JS (Plugin API) | JSON diff ops | CRUD tools + Python |
| Guide / schema tool | `get_guide` (mandatory) | Skills, `create_design_system_rules` | `get_guidelines`, `read_skill` | Skills | — | Mode "parts" | `read_me` | API/manual doc search | — | `penpot_api_info` | `get_node` detail levels | `describe_td_tools`, class help |
| Cheap structure readback | `get_tree_summary`, `get_basic_info` | `get_metadata` (sparse XML) | `batch_get`, `snapshot_layout` | — | Hierarchy query | Blurry/Focused/Peripheral shapes | Checkpoint state | Objects summary, window-as-JSON | — | `high_level_overview` | `get_template(mode)` | `get_td_nodes` |
| Visual readback | `get_screenshot` 1x/2x capped | `get_screenshot` | `get_screenshot` | — | — | Screenshot | 512px PNG to model context | Area screenshot with byte cap; renders | Camera/SceneView capture | `export_shape` | — | `get_top_image` |
| Batch semantics | Arrays, sequential, per-entry results | One script per call | `batch_*` | — | — | Streamed actions | One array per call | One script | — | One script | Diff op list | Per tool |
| ID ergonomics | Stable ids; `descendantIdMap`; `affectedParents` | Must return created/mutated ids | Handle binding (`rect=Insert…`) | — | — | Id sanitization | Unique ids, never reuse | Names | — | — | Node names | Paths |
| Errors that teach | `ignoredStyles`, loud invalid fileId, instruction-style failures | `safeToRetryWithoutCanvasRead`, error table | — | — | Diagnostics | Sanitization | Byte limit → use checkpoints | Docs kinds | — | — | Validation profiles, autofix | Guided connection errors, version gating |
| Human visibility | Real-time canvas, working indicator, presence | Canvas | Canvas, parallel agents | Branch review | Canvas | Streaming | Streaming + camera | Viewport jump | Editor | Canvas | — | Network |
| Destructive guard | `destructiveHint`, `consequentialHint`, verify-before-delete | Catalog, rate limits, cost gates (Weave) | Permission-gated actions | **Branching**, human publish | "End Prompt" | Modes | Checkpoints | "confirm before destructive"; `allow_edits=false` | Client approval, per-tool enable | Remote mode (no fs) | "copy first" | — |
| Simulation / test | Video export only | `get_motion_context` | — | — | State machines (no stepping tool seen) | — | Animation mode | Render | Play mode (not verified) | — | `n8n_test_workflow` | Live TOP output |

---

## 17. Design principles for an AI-native prototyping tool

Each principle lists the evidence (VERIFIED, sections above) and a concrete rule for our app (INFERRED design).

### P1. A text-based, diffable document format that is the real source of truth
- Evidence: pen.dev `.pen` JSON "Schema fully opened", git diffs and branches. Excalidraw insists on the standard format "so any .excalidraw file… works as input". n8n workflows are JSON. Paper's canvas is HTML/CSS.
- Rules:
  - Canonical JSON (or a JSON-compatible text form) with **deterministic serialization**: sorted keys, stable array order (children by z-order, wires sorted by target then source), 2-space indent, one object per line where practical, numbers rounded to a fixed precision (e.g. 4 decimals) so re-saves do not churn.
  - **Separate semantics from layout.** Store node-editor canvas positions (graph layout) in a separate section or file from logic, so tidying the graph does not pollute semantic diffs.
  - Content-hashed assets in `assets/`. A `formatVersion` with explicit migrations. A published JSON Schema.
  - Offer an optional **code-like text view** of the logic graph that LLMs are fluent in (TS-like reactive expressions), round-tripping to the canonical graph. This mirrors Paper's "use a language the model already speaks" [INFERRED]. Example of the kind of view we would design ourselves:
    ```
    tap   = Tap(target: @card)
    press = Spring(input: tap.isDown, bounciness: 8, speed: 12)
    @card.scale = Remap(press.value, from: [0,1], to: [1, 0.95])
    ```

### P2. Stable, semantic identifiers
- Evidence: Paper `move_nodes` "Preserves node identity"; `duplicate_nodes` returns `descendantIdMap`. Figma "MUST return ALL created/mutated node IDs". Excalidraw "Never reuse a deleted id". Anthropic prefers semantic names over UUIDs. Paper tells agents not to show raw ids to users. pen.dev overrides are keyed by ID paths.
- Rules:
  - Every layer, node, port, wire, scene, and component has an immutable internal uid plus a unique, human-readable **handle** (`card`, `tap_card`, `spring_press`), auto-derived and renameable. Tools accept either.
  - Port references read as `node.port`; layer props as `@layer.prop`.
  - IDs are never reused after deletion.
  - **Client-side temp refs in batches**: `{"op":"add_node","ref":"$s", …}` then `{"op":"connect","from":"$s.value", …}`. The result returns the `idMap` from refs to real ids (like Pencil handle binding and Paper `descendantIdMap`).

### P3. Schema discovery and guides
- Evidence: Paper `get_guide` (mandatory, re-call after context compression). Excalidraw `read_me` ("do not call again"). Pencil `get_guidelines`. n8n `get_node(detail)`. TouchDesigner `describe_td_tools` and class help. Blender doc search with truncation to a summary at 32 KB.
- Rules:
  - `get_guide(topic)` with a short "start-here" guide that server `instructions` require on first use.
  - `list_node_types` and `describe_node_type(types[], detail)` return ports (name, direction, value type, default, range, units), behavior notes (e.g. "emits a pulse for one frame"), common pairings, and a 3-line example.
  - The same content powers the in-app help panel for human learners (one doc source for both).

### P4. Batch operations with explicit transaction semantics
- Evidence: Paper `update_styles`, `set_text_content`, `rename_nodes`, `create_tokens` (per-entry in-band results), `move_nodes` ("Moves apply sequentially; later moves… see earlier changes"). n8n diff ops. Pencil `batch_design`. Figma `node.set`.
- Rules:
  - A single `apply_ops` path underlies every write tool.
  - `atomic: true` by default (all-or-nothing with rollback). With `atomic:false`, report per-op results.
  - Ops apply sequentially and see prior ops.
  - `dryRun: true` returns the would-be diff and diagnostics without mutating.
  - `expectedRevision` provides optimistic concurrency against human or other-agent edits.

### P5. Validation and errors that teach
- Evidence: MCP `isError` for self-correction. Paper returns `ignoredStyles`, fails loudly on invalid `fileId`, and phrases errors as instructions to the model. Figma's `safeToRetryWithoutCanvasRead` plus an error-cause table. Excalidraw's byte limit suggests checkpoints. n8n validation profiles and autofix. TouchDesigner guided connection errors.
- Rules:
  - Errors carry `{code, message, hint, safeToRetry, changed: none|partial|all, suggestions:[{description, ops}]}` as `structuredContent` plus human-readable text.
  - Type mismatch example: "Cannot connect `spring_press.value` (Number) to `@card.visible` (Boolean). Try inserting `Compare(>0.5)` or connect to `@card.opacity` (Number). Nothing changed." Include a ready-to-apply `ops` fix.
  - A `get_diagnostics` tool mirrors the human-facing issues panel: cycles, unconnected required inputs, unreachable nodes, NaN or out-of-range outputs, layers bound twice, performance warnings.

### P6. Structural readback first, visual readback for QA
- Evidence: Paper `get_tree_summary` "Much cheaper than getJSX", and "do not read sizes or colors from screenshots alone". Figma `get_metadata` vs `get_screenshot`. Pencil "Visual QA only, never the primary source of structure". tldraw: both work best. make-real: "Trust [code] over the screenshot."
- Rules:
  - Compact tree and graph summaries with `depth` and `detail`.
  - Screenshots default to 1x with a byte cap. Can target the prototype viewer, a layer, or the node-graph area. Can be taken at a simulated time `atMs`.

### P7. Simulation stepping (the differentiator)
- Evidence of the gap: none of the design MCPs expose stepping or input dispatch. Analogs are n8n `n8n_test_workflow`, TouchDesigner `get_top_image`, Unity captures, and Excalidraw animation mode.
- Rules:
  - A deterministic simulation clock (fixed timestep, default 60 fps) and seeded randomness.
  - `sim_dispatch` synthesizes gestures (tap, long-press, drag path with timing, scroll, hover, key, text, device motion/orientation) and reports the hit-test result. If a tap hits nothing interactive, say which layer would have caught it.
  - `sim_step` advances by frames or ms, or `until: "idle"` (all springs and transitions settled) or `until: {target, op, value}`.
  - `sim_trace` returns columnar samples for chosen ports and props plus a summary (settle time, overshoot, min, max) to keep tokens low.
  - Simulation never mutates the document and runs independently of the human's live preview, unless the agent asks to "mirror" it to the viewer for demonstration.

### P8. Undo integrated with human edits
- Evidence: Excalidraw checkpoints merge user edits back. Framer branches plus human publish. n8n "copy first". Paper agent sessions tracked in file data (`removeAgent`).
- Rules:
  - Each tool call (or explicit `label`ed batch) is one **undo group attributed to the agent session**: client name from `clientInfo`, plus an optional agent label.
  - The history panel shows "Claude: added press animation (12 ops)". The human can undo that group even after later human edits, which requires op-based history with inverse ops and conflict detection.
  - Checkpoints (`create_checkpoint`, `restore_checkpoint`), with restore itself undoable.
  - Optional **exploration branches** (scene duplicates, or a doc-level branch like Framer) for large agent changes.

### P9. Live co-editing visible to the human, without stealing focus
- Evidence: Paper "Write incrementally. The user sees you write… every few seconds", the working indicator plus `finish_working_on_nodes`, multiplayer cursors, and headless windows "so it doesn't steal focus". tldraw streaming actions. Excalidraw camera guidance. Blender `jump_to…(allow_edits=false)`.
- Rules:
  - An agent presence avatar and a "working on" badge on affected nodes and layers.
  - Brief highlight flashes on changed items. An agent activity feed.
  - `begin_work`/`finish_work` (auto-begin on first write; auto-expire on session close).
  - The canvas never auto-pans or changes selection unless `reveal({ids, focus:true})` is called and the user setting allows it.
  - Keep rendering unthrottled while an agent call runs, since Paper and Penpot both hit background-tab throttling.

### P10. Guard destructive actions
- Evidence: MCP annotations. Paper `consequentialHint` and "verify… before deleting". Blender "Do not destructively modify objects without confirmation". Unity per-tool enable and client approval. Framer branches. Figma Weave `cost_confirmation_required` status. MCP elicitation.
- Rules:
  - Accurate annotations on every tool.
  - Deletes are soft (trash, restorable for the session). Deleting more than N items (default 10) or a whole scene returns `confirmation_required` with a summary and a one-time `confirmToken`, or uses elicitation when the client supports it.
  - Human-locked layers and nodes cannot be modified by agents without explicit unlock.
  - A per-document "agent permissions" setting: read-only / edit / edit+export+files.
  - Localhost-only binding, Origin and Host checks, a session approval prompt for new clients (Unity-style), and no arbitrary code execution by default. A scripting node runs in a sandbox with no filesystem or network unless granted.

### P11. Token-efficient responses
- Evidence: Paper `get_tree_summary` depth 3/max 10, `affectedParents`, `descendantIdMap`, 1x screenshots, capped images. n8n `detail: minimal` ~200 tokens. Figma sparse XML. Blender 32 KB truncation. Anthropic's 25k default and `response_format`. Excalidraw checkpoints avoid re-sending state, and labels save tokens.
- Rules:
  - Every read tool takes `detail: "ids" | "summary" | "full"`, paginates with `limit`/`cursor`, and states truncation ("412 more nodes; narrow with scope or find").
  - Writes return deltas only (ids, affected parents, new diagnostics), not full state.
  - `get_changes(sinceRevision)` for incremental sync.
  - Traces in columnar CSV-like text. Images capped by bytes.

### P12. Resources vs tools vs prompts
- Evidence: Paper exposes only tools plus `instructions`. Figma exposes one prompt plus Skills (loadable "via an MCP resource"). TouchDesigner has prompts but no resources. Excalidraw uses a `ui://` resource for its App.
- Rules:
  - **Tools** for everything the model must be able to do and read, because they are universally supported by clients.
  - **Resources** mirror stable documents (graph text, layer tree, diagnostics, node-type docs, guides, traces) with URI templates and `subscribe` so capable hosts can attach context and get `notifications/resources/updated` on revision changes.
  - **Prompts** for user-initiated recipes (slash commands).
  - **MCP App** (`ui://viewer`): a live prototype viewer widget for chat hosts.
  - **Skills and CLI** carry the same guides and ops for harnesses that prefer terminal plus skills (Unity, Framer, and pen.dev trend).

### P13. One operation core, many front doors
- Evidence: Paper has an HTTP MCP server, a stdio relay CLI, and plugins for Claude Code, Cursor, and Codex, plus an mcpb bundle. Comfy MCP wraps comfy-cli JSON envelopes. Unity moved to CLI. Framer uses CLI plus Skills.
- Rule: implement ops once (a library inside the app). Expose them via the MCP server (Streamable HTTP on localhost, with a stdio relay), a CLI with `--json` envelopes, and in-app scripting. Ship tool definitions as data (as Paper does with `config.json`) so tools can be listed even when the app is not running.

### P14. Multi-document targeting and concurrency
- Evidence: Paper's `fileId` on every tool, the sticky `open_file` binding, and "never misroute a write". pen.dev `spawn_agents` and parallel modes. Figma parallel fan-out per page.
- Rules:
  - An optional `docId` on every tool. The session binds to the last `open_document`. Invalid ids fail loudly.
  - Per-agent sessions with independent selection and working indicators. Revision-based conflict detection.

### P15. Learnability for humans comes from the same surfaces
- Evidence [INFERRED from the tools above]: Paper comment tools let agents address review threads; the tldraw kit's `think` and message actions make the agent's intent visible.
- Rules:
  - `explain({scope, audience: beginner|designer|engineer})` returns the logic in plain language, and `add_note` pins an explanation sticky to the graph.
  - Diagnostics text is written for humans first. Node-type docs are shared between UI and agent.
  - Comments tools let agents work through design-review threads (like Paper).

---

## 18. Proposed MCP tool surface for the node-graph prototyping app

Server name: `proto` (placeholder). Transport: Streamable HTTP at `http://127.0.0.1:<port>/mcp` plus `proto mcp` stdio relay. Capabilities: `tools` (listChanged), `resources` (subscribe, listChanged), `prompts`. Server `instructions` (short): call `get_guide({topic:"start-here"})` once; call `get_document_info` first; build interactions in small batches; verify with `get_diagnostics` and `sim_*`; call `finish_work` when done; do not show raw ids to users.

Vocabulary (generic, clean-room): **document** → **scenes** (screens/artboards) → **layers** (visual tree) + **nodes** (logic graph units with typed **ports**) connected by **wires**; layer properties can be driven by wires (**bindings**); **components** bundle layers plus nodes; **viewer** = live prototype preview (on screen or device).

Common optional args on document-scoped tools: `docId` (string), `detail` (`ids|summary|full`, default `summary`). Common result fields on writes: `revision` (int), `idMap` (ref → id), `affected` ({layers[], nodes[], wires[]}), `diagnosticsDelta` ({added[], resolved[]}).

### 18.1 Session and document
| Tool | Annotations | Args | Returns |
|---|---|---|---|
| `get_guide` | readOnly, idempotent | `topic*`: `start-here`, `graph-basics`, `gestures`, `animation`, `layout`, `simulation`, `components`, `export-code`, `troubleshooting` | Markdown (≤ ~3k tokens), `relatedTopics[]` |
| `list_documents` | readOnly | `limit=25`, `cursor` | `[{docId, name, path, isOpen, modifiedAt}]`, `nextCursor` |
| `open_document` | readOnly (session binding only) | `docId*` (id, path, or URL), `sceneId` | Same as `get_document_info`; binds the session |
| `create_document` | destructive=false (additive) | `name`, `template` (`blank`\|`phone`\|`tablet`\|`desktop`), `cloneFrom` | `{docId}` (not auto-opened) |
| `get_document_info` | readOnly | `docId` | `{docId, name, revision, formatVersion, scenes[{id, handle, name, size, device}], counts{layers, nodes, wires, components}, selection summary, viewer{playing, device}, diagnostics{errors, warnings}, agentSessions[]}` |

### 18.2 Schema discovery
| Tool | Annotations | Args | Returns |
|---|---|---|---|
| `list_node_types` | readOnly | `query`, `category` (`gesture`\|`animation`\|`logic`\|`math`\|`state`\|`device`\|`data`\|`utility`), `detail` (`names`\|`summary`) | Grouped list `{type, category, summary, inputs["name:Type"], outputs[…]}` |
| `describe_node_type` | readOnly | `types*` (string[]), `detail` (`standard`\|`full`), `includeExamples=true` | Per type: `ports[{name, direction, valueType, default, range, units, description}]`, `behavior` (timing/pulse semantics), `pairsWellWith[]`, `example` (text-graph snippet) |
| `describe_layer_type` | readOnly | `types*` | `props[{name, valueType, default, animatable, bindable}]`, allowed children |
| `list_value_types` | readOnly | — | Type table (Number, Boolean, Pulse, Point, Size, Color, Text, Image, Index, Enum…) with conversion rules and suggested converter nodes |

### 18.3 Read state
| Tool | Annotations | Args | Returns |
|---|---|---|---|
| `get_graph` | readOnly | `scope` ({sceneId}\|{componentId}\|{nodeIds[]}), `format` (`text` default \| `json`), `detail`, `includeLayout=false` | Graph in compact text or JSON plus `revision` |
| `get_layer_tree` | readOnly | `rootId` (default scene root), `depth=3` (max 10) | Indented tree: type, handle, name, size, `boundProps` count; child-count hints past depth |
| `get_items` | readOnly | `ids*` (layers, nodes, or wires), `props` (filter), `detail` | Batch details: for nodes, input values (constant or wired from), outputs; for layers, props and which are bound |
| `find` | readOnly | `text`, `nodeType`, `layerType`, `prop{name, value}` (wildcards, color equivalence), `connectedTo` (id or port), `unconnectedRequired=false`, `scope`, `limit` | Matches `[{id, handle, kind, matched[]}]` |
| `get_selection` | readOnly | — | Selected layers, nodes, wires; focused panel |
| `get_diagnostics` | readOnly | `scope`, `severity` (`error`\|`warning`\|`info`) | `[{code, severity, message, itemIds, port, suggestions[{description, ops[]}]}]` |
| `get_changes` | readOnly | `sinceRevision*`, `limit` | `[{revision, author{kind: human\|agent, name}, label, ops[] (compact)}]` |

### 18.4 Write (single op engine; atomic by default)
| Tool | Annotations | Args | Returns |
|---|---|---|---|
| `apply_ops` | destructiveHint | `ops*[]`, `atomic=true`, `dryRun=false`, `expectedRevision`, `label` | `{revision, results[{index, ok, error?}], idMap, affected, diagnosticsDelta}`; with `dryRun`, the diff plus diagnostics only |
| `add_layers` | destructive=false | `parent*`, `layers*[{ref?, type, name?, props{}, children?[]}]` (nested), `index` | ids, `idMap` |
| `write_graph` | destructiveHint | `code*` (text-graph notation), `scope`, `mode` (`merge`\|`replace`) | `idMap`, `affected`, parse errors with line/column and hints |
| `add_nodes` | destructive=false | `nodes*[{ref?, type, name?, inputs{port: constant \| "$ref.port" \| "node.port"}, position?}]`, `wires[]` | ids, `idMap`, `diagnosticsDelta` |
| `connect` | destructive=false | `wires*[{from:"node.port", to:"node.port"\|"@layer.prop"}]`, `replaceExisting=false` | wire ids; per-wire errors with converter suggestions |
| `set_values` | destructiveHint (overwrites) | `updates*[{target: "node.port"\|"@layer.prop", value}]` | Per-entry results; `ignored[]` (e.g. a prop that is wire-driven) |
| `update_layers` | destructiveHint | `updates*[{ids[], props{}}]` | Per-entry results, `ignoredProps` |
| `move_layers` | destructiveHint | `moves*[{id, before\|after\|parent, index?}]` (sequential) | Resolved parent/index, `affectedParents` |
| `rename` | destructiveHint | `updates*[{id, handle?, name?}]` | Handles (uniquified) |
| `disconnect` | destructiveHint | `wireIds[]` or `targets[]` | Removed wire ids |
| `delete_items` | destructiveHint, consequentialHint | `ids*`, `reason`, `confirmToken` | Soft delete to trash; over the threshold returns `{status:"confirmation_required", summary, confirmToken}` |
| `create_component` | destructive=false | `ids*` (layers + nodes), `name*`, `exposedInputs[]` | Component id, instance id |
| `tidy_graph` | idempotent (layout only) | `scope`, `direction` (`LR`\|`TB`) | Moved node count (positions only, no semantic change) |

`apply_ops` op kinds (the other write tools compile to these): `add_layer`, `update_layer`, `move_layer`, `remove_layer`, `add_node`, `update_node`, `remove_node`, `connect`, `disconnect`, `rewire`, `set_value`, `rename`, `group_nodes`, `ungroup`, `create_component`, `instantiate_component`, `add_scene`, `update_scene`, `set_node_position`.

### 18.5 Simulation (never mutates the document)
| Tool | Annotations | Args | Returns |
|---|---|---|---|
| `sim_reset` | idempotent | `sceneId`, `device` (preset), `seed=0`, `state{}` (initial port overrides) | `{simId, timeMs:0, frame:0}` |
| `sim_dispatch` | readOnly (doc) | `simId`, `events*[{kind: tap\|longPress\|drag\|scroll\|hover\|key\|text\|deviceMotion\|orientation, target?: "@layer" \| {x,y}, path?: [[x,y,tMs]], durationMs?, key?, value?, atMs?}]` | Per event: `{hitLayer, handledBy[nodeIds], warnings}`; if nothing is hit, the nearest interactive layer |
| `sim_step` | readOnly (doc) | `simId`, `frames` \| `ms` \| `until` (`"idle"` \| {target, op, value}), `fps=60`, `maxMs=10000` | `{timeMs, frame, settled, changed[{target, from, to}] (capped), timedOut}` |
| `sim_get_values` | readOnly | `simId`, `targets*[]` | `{target: value}` at the current time |
| `sim_trace` | readOnly | `simId`, `targets*[]`, `durationMs*`, `sampleEveryMs=16.67`, `events[]` (scheduled) | Columnar text `t,port1,port2…` (auto-downsampled to ≤ N rows) plus `summary{settleMs, overshoot, min, max}` per target |
| `get_screenshot` | readOnly | `target`: `viewer` \| `graph` \| `canvas` \| {layerId}; `simId`, `atMs`, `scale=1`, `maxBytes` | Image content plus `{width, height, timeMs}` |
| `sim_record` | readOnly (writes a file) | `simId`, `durationMs*`, `fps=30`, `format` (`gif`\|`mp4`\|`frames`), `events[]` | `resource_link` to the file |
| `mirror_to_viewer` | readOnly (doc) | `simId`, `enable` | Plays the agent's simulation in the human's viewer for demonstration |

### 18.6 Presence, collaboration, explanation
| Tool | Annotations | Args | Returns |
|---|---|---|---|
| `begin_work` | readOnly (UI) | `ids`, `intent` (short text shown to the human) | Session badge on |
| `finish_work` | readOnly (UI) | `ids` (omit = all) | Clears indicators. Instructions say MUST call. |
| `reveal` | readOnly (UI) | `ids*`, `focus=false` (only pans if the user allows) | Whether it was revealed |
| `list_comments` | readOnly | `status=open`, `scope`, `limit`, `offset` | Thread summaries |
| `get_comment_thread` | readOnly | `threadId*` | Messages and pinned item context |
| `reply_comment` | destructive=false | `threadId*`, `text*` | Message id |
| `set_comment_status` | destructiveHint | `threadId*`, `status*` (`open`\|`resolved`) | New status |
| `add_note` | destructive=false | `near*` (id), `text*` | Note id (sticky explanation on the graph) |
| `explain` | readOnly | `scope*`, `audience` (`beginner`\|`designer`\|`engineer`) | Plain-language description of logic (generated from the graph deterministically; the model can refine) |

### 18.7 History and safety
| Tool | Annotations | Args | Returns |
|---|---|---|---|
| `create_checkpoint` | destructive=false | `label*` | `{checkpointId, revision}` |
| `list_history` | readOnly | `limit=20`, `author` (`human`\|`agent`\|name) | `[{txnId, label, author, revision, opsCount, at}]` |
| `revert` | destructiveHint | `txnId` \| `checkpointId`, `confirmToken` | New revision (revert is undoable), conflicts list if later edits overlap |
| `restore_deleted` | destructive=false | `ids*` | Restored ids |

### 18.8 Assets, tokens, export
| Tool | Annotations | Args | Returns |
|---|---|---|---|
| `import_asset` | destructive=false | `path` \| `url`, `name` | `{assetId, width, height}` |
| `get_tokens` / `set_tokens` | readOnly / destructive | Filters; `[{name, type, value, delete?}]` | Per-entry results |
| `export_code` | readOnly | `scope*`, `target` (`react`\|`swiftui`\|`css-animations`\|`json-spec`), `detail` | Code text or `resource_link`; springs and curves as exact parameters |
| `export_media` | readOnly (writes files) | `targets*`, `format` (`png`\|`svg`\|`pdf`\|`mp4`\|`gif`), `scale` (`1x`\|`512w`\|`720p`) | File paths |

### 18.9 Resources (mirrors; subscribable)
- `proto://documents`: document list.
- `proto://doc/{docId}/graph.txt` and `…/graph.json`: current logic graph (updates on revision).
- `proto://doc/{docId}/layers.txt`: layer tree.
- `proto://doc/{docId}/diagnostics.json`
- `proto://doc/{docId}/history.json`
- `proto://node-types/{type}.md`, `proto://guides/{topic}.md`
- `proto://sim/{simId}/trace/{traceId}.csv`
- `ui://viewer`: MCP App with a live prototype viewer that the model can drive via `sim_*`.

### 18.10 Prompts (user-controlled recipes)
- `prototype_interaction(description, scene?)`: plan → nodes → wires → simulate → screenshot → finish.
- `sketch_to_prototype(imageResource)`: make-real style, but outputs graph plus layers instead of HTML.
- `debug_interaction(symptom, scene?)`: diagnostics → trace → minimal fix.
- `explain_prototype(scope, audience)`
- `tidy_and_document(scope)`: tidy graph, rename handles, add notes.
- `address_review_comments()`: list open threads → fix → resolve.

### 18.11 Example agent loop (token-lean)
1. `get_guide("start-here")` (once) → `get_document_info` → `get_layer_tree(depth:2)`.
2. `describe_node_type(["Tap","Spring","Remap"], detail:"standard")`.
3. `begin_work({ids:["card"], intent:"Press-to-shrink card"})`.
4. `add_nodes({nodes:[{ref:"$t", type:"Tap", inputs:{target:"@card"}}, {ref:"$s", type:"Spring", inputs:{input:"$t.isDown", bounciness:8}}, {ref:"$r", type:"Remap", inputs:{value:"$s.value", toLow:1, toHigh:0.95}}], wires:[{from:"$r.value", to:"@card.scale"}]})` → `idMap`, no errors.
5. `sim_reset` → `sim_dispatch([{kind:"longPress", target:"@card", durationMs:300}])` → `sim_trace({targets:["@card.scale"], durationMs:800})` returns the summary `settleMs: 420, min: 0.95`.
6. `get_screenshot({target:"viewer", simId, atMs:150})`, visual QA only.
7. `finish_work()`, then reply to the user without raw ids.

---

## 19. Open questions and risks
1. **The contents of Paper's `get_guide("paper-mcp-instructions")`** live in the web client and were not retrieved. They may hold more workflow rules (INFERRED to exist; not read).
2. **Pen.dev's current tool semantics** (`execute`, `get_app_state`, `spawn_agents`) are not documented in detail. The move from typed batch tools to code execution suggests a trade-off to evaluate: typed ops (safer, teachable errors) vs code (flexible, token-efficient).
   - **Decided (2026-09): Sonobe keeps typed ops as the language the model writes.** The strongest evidence came from Stitch, an open-source (GPL-3.0) node-based prototyping app, whose source we read for behavior only in September 2026 and copied nothing from **[VERIFIED]**. Its AI started with a typed step list and moved to having the model edit the graph as restricted SwiftUI, which a parser turns back into nodes. That cost a prompt of about 347 KB on every request, dozens of rules forbidding ordinary SwiftUI, a parser of more than 5,000 lines, silent rewrites that change meaning (a ternary kept only its false branch), layers that can't be printed as code dropped, every edit replacing the whole graph, and retries that never saw the validation error.
   - Stitch's step list hit a ceiling for reasons Sonobe doesn't share **[INFERRED]**: ids were UUIDs the model had to invent, ports were numbered by position, errors didn't teach, and the model generated once instead of working in a loop. Sonobe's ops have readable ids, named ports, `$ref`s, atomic batches with inverses, errors with a did-you-mean and ready-to-apply ops (an unknown field fails instead of being dropped), and a deterministic simulator that checks behavior. Each batch is one partial, attributed, undoable edit, and nothing is rewritten quietly.
   - The model's knowledge of code is used as input instead: the graph-basics guide's "From code to patches" table maps idioms (a tap handler, `useState`, a ternary, `ForEach`, `withSpring`) to patches, `import_design` takes HTML the model writes from any codebase (the DOM walker reads the rendered layout, so no parser reads code), and the JavaScript patch holds logic no patch expresses.
3. **MCP vs CLI+Skills trend** (Unity deprecation, Framer). Check how Claude Code, Claude Desktop, and other hosts handle long-running local MCP sessions. Paper's docs list disconnects in long sessions as a known issue.
4. **Rive MCP status** is ambiguous (docs present; community says phased out). If the Rive editor MCP remains, study its state-machine op design more closely. It is the closest domain analog.
5. **Undo attribution across human and agent edits** needs an op-log CRDT or OT-like design. No studied tool documents agent-grouped undo explicitly [INFERRED gap].
6. **Client support for resources, subscriptions, elicitation, and MCP Apps varies.** Tools must remain the complete surface. Resources and elicitation are enhancements.
7. **Annotations are untrusted hints** per spec, so real guards (soft delete, confirm tokens, locks, branches) must live in the server.
8. **Headless mode security:** if we offer a headless or CI mode, validate every token and bind to localhost. Paper's refresh path accepts unvalidated replacement tokens after the first (INFERRED observation).

---

## 20. Source index
- Paper: https://paper.design · https://paper.design/docs/mcp · https://paper.design/docs · https://paper.design/docs/tokens · https://paper.design/build-log · https://paper.design/blog/a-real-space-to-design-in-the-age-of-agents · https://paper.design/compare/figma · https://designerfounders.substack.com/p/paper-stephen-haney · https://github.com/paper-design/agent-plugins · https://app.paper.design/mcp/desktop/config.json · local read-only: `/Applications/Paper.app/Contents/Info.plist`, `/Applications/Paper.app/Contents/Resources/app.asar` (`package.json`, `README.md`, `src/main.ts`, `src/mcp/{server,bridge,index,mcp-body-schema,self-capture-hold}.ts`, `src/auth/auth-through-mcp.ts`, `src/cli/install.ts`, `scripts/build-cli.ts`, `src/window/lib/background-throttling.ts`, `src/window/paper-tab.ts`), `/Applications/Paper.app/Contents/Resources/app.asar.unpacked/dist/cli-bin/darwin-arm64/paper` (strings)
- Figma: https://developers.figma.com/docs/figma-mcp-server/ · https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/ · https://developers.figma.com/docs/figma-mcp-server/local-server-installation/ · https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/ · https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/ · https://www.figma.com/blog/the-figma-canvas-is-now-open-to-agents/ · local skill `~/.claude/plugins/cache/claude-plugins-official/figma/2.2.111/skills/figma-use/SKILL.md`
- pen.dev (Pencil): https://www.pen.dev/ · https://docs.pen.dev · https://docs.pen.dev/for-developers/the-pen-format · https://docs.pen.dev/core-concepts/ai-agents · https://docs.pen.dev/getting-started/ai-integration · https://docs.pen.dev/core-concepts/design-as-code · https://github.com/unliftedq/skills/blob/main/skills/pencil-dev/SKILL.md
- Framer: https://www.framer.com/agents/external/ · https://www.framer.com/help/articles/use-external-agents-with-framer/ · https://alternativeto.net/news/2026/6/framer-3-0-launches-ai-agents-branching-external-agents-and-a-redesigned-community/
- Rive: https://rive.app/docs/editor/ai/mcp · https://x.com/rive_app/status/1925573205215035398 · https://x.com/rive_app/status/2065197395496022108 · https://community.rive.app/c/announcements/the-ai-coding-agent-is-in-the-rive-editor · https://github.com/rive-app/rive-runtime/issues/87 · https://www.pulsemcp.com/servers/rive-editor
- tldraw: https://tldraw.dev/starter-kits/agent · https://tldraw.dev/docs/ai · https://github.com/tldraw/make-real (`app/prompt.ts`) · https://x.com/tldraw/status/1869401069849379109 · https://www.hackscience.education/the-computer-you-draw-inside-tldraws-natural-language-os/
- Excalidraw: https://github.com/excalidraw/excalidraw-mcp (`CLAUDE.md`, `src/server.ts`)
- Blender: https://www.blender.org/lab/mcp-server/ · https://projects.blender.org/lab/blender_mcp · https://github.com/ahujasid/blender-mcp · Blender MCP tool schemas and server instructions observed in this session
- Unity: https://docs.unity3d.com/Packages/com.unity.ai.assistant@2.0/manual/unity-mcp-overview.html · https://docs.unity3d.com/Packages/com.unity.ai.assistant@2.18/manual/integration/unity-mcp-overview.html · https://gamedevllm.com/en/unity-mcp-builtin-tools-reference-en/ · https://github.com/CoplayDev/unity-mcp
- Penpot: https://github.com/penpot/penpot/tree/develop/mcp · https://help.penpot.app/mcp/
- Node-graph MCPs: https://github.com/czlonkowski/n8n-mcp · https://github.com/8beeeaaat/touchdesigner-mcp · https://github.com/Comfy-Org/comfy-mcp · https://docs.comfy.org/agent-tools/mcp
- MCP spec: https://modelcontextprotocol.io/specification/2025-11-25/server/tools · https://modelcontextprotocol.io/specification/2025-11-25/server/resources · https://modelcontextprotocol.io/specification/2025-11-25/server/prompts · https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation · https://modelcontextprotocol.io/docs/extensions/apps
- Anthropic: https://www.anthropic.com/engineering/writing-tools-for-agents · https://www.anthropic.com/engineering/code-execution-with-mcp
