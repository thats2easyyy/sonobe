# @sonobe/mcp

Sonobe's MCP surface (ARCHITECTURE §10). It provides:

- tools, resources and prompts over a `SonobeHost`
- `HeadlessHost` for project folders on disk
- Streamable HTTP and stdio transports

One server factory serves 2026-07-28 clients (per-request envelopes) and 2025-era clients (`initialize`).

## Hosts

`SonobeHost` (`src/host.ts`) is everything the tools need: documents, `apply` (core `applyOps` + History, attributed to an author), cached diagnostics, selection, screenshots, presence, simulation and history.

- **The desktop app** implements it over the live editor.
- **`createHeadlessHost({ registry?, autosave? })`** implements it over folders, through `@sonobe/core/node`:
  - `createDocument({ path, template })` and `openDocument(pathOrDocId)`
  - saving on request, or after every write with `autosave`
  - deterministic simulations
  - presence recorded but not shown
  - `screenshot` throws `HostError("screenshots_unavailable")` with a hint to open the app

Browser-safe building blocks for other hosts:

- `createDocumentSession(doc, { docId, registry })`: history, revision, id reservations, diagnostics deltas, undo that won't discard human edits.
- `createSimulationManager({ registry, getDocument })`: `sim_*` sessions.

## Server and transports

```ts
import {
  createHeadlessHost,
  createHttpHandler,
  createSonobeMcpServer,
  serveStdioHost,
} from "@sonobe/mcp";

const host = createHeadlessHost({ autosave: true });
await host.openDocument("./Checkout Flow.sonobe");

serveStdioHost(host, { version: "0.1.0" }); // stdio (log to stderr only)

const handler = createHttpHandler(host, { version: "0.1.0" }); // Node (req, res)
mcpServerHandle.setHandler(handler); // desktop startMcpServer guards Host/Origin/token
```

- `createHttpHandler` creates one `McpServer` per request and performs no auth itself; mount it behind a guard.
- `createSonobeMcpServer(host, { version })` returns the bare `McpServer`, for custom transports.

### Resource notifications

When a document gets a new revision, `sonobe://documents/{docId}/outline` and `.../diagnostics` publish `resources/updated`. Opening or closing a document publishes `resources/list_changed`.

- **2026-07-28 clients** receive them on `subscriptions/listen` streams, over HTTP and stdio.
- **2025-era stdio clients** get `list_changed` unsolicited, and `resources/updated` for URIs they `resources/subscribe` to. 2025-era HTTP traffic is stateless, so there's no session to push to.

Hosts that implement `onDocumentChange(listener)` (HeadlessHost does) are subscribed automatically by `createHttpHandler` and `serveStdioHost`. App hosts without it call the hook themselves:

```ts
mcpHandler.documentChanged({ kind: "revision", docId, revision });
mcpHandler.documentChanged({ kind: "opened", docId }); // or "closed"
```

## Tools

The tools are listed in `TOOL_NAMES`.

| Group                | Tools                                                                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Discovery            | `get_guide`, `list_patch_types`, `describe_patch_types`, `describe_layer_types`, `list_value_types`                                            |
| Documents            | `list_documents`, `open_document`, `create_document`, `get_document_info`, `save_document`                                                     |
| Read                 | `get_outline`, `get_layers`, `get_patches`, `get_items`, `find`, `get_selection`, `get_diagnostics`, `explain`                                 |
| Write                | `apply_ops`, `add_layers`, `add_patches`, `connect`, `set_values`, `update_layers`, `delete_items`, `rename`, `create_component`, `tidy_graph` |
| Simulate             | `sim_reset`, `sim_dispatch`, `sim_step`, `sim_trace`, `sim_get_values`, `get_screenshot`                                                       |
| Presence and history | `begin_work`, `finish_work`, `reveal`, `list_history`, `undo`                                                                                  |

Conventions:

- **Results.** Each returns concise text plus `structuredContent`; writes, simulation and document info also declare `outputSchema`.
- **`structuredContent.text`** always holds the complete text, as the first field. Some clients (Claude Code) give the model only `structuredContent`, so metadata alone would hide the outline, guide or trace. `get_screenshot` returns no `structuredContent`, so clients keep the image.
- **Writes** return `revision`, `txnId`, created ids, `idMap` and diagnostics `{ added, resolved, totals }`.
- **Errors** are `isError` results with `{ code, message, hint, suggestions: [{ description, ops }], changed }`. Every `outputSchema` is `{ type: "object", anyOf: [success, teaching error] }` (`toolOutputSchema`), so SDK clients that validate error results (the v1 SDK does) show the teaching error instead of -32602. The wrapper drops any error `structuredContent` that wouldn't validate.
- **Reads** paginate with `cursor` and truncate with explicit notes.

### Simulation addressing

- `patchId.port`, `@layerId.prop`, `#n` for one loop copy.
- Inside component instances: `like_button_2/liked.on`, `@card#2/badge.scale`, and `@like_button_2/like_button` as a tap target. `get_items` takes `like_button_2/liked`.
- Inputs resolve their targets and compute hit reports when they fire. Traces on a copy replay the session's input log into a clone, so they report the same way. Trace times count frames.
- `SimulationManager.scene(simId)` returns a session's current `SceneFrame`, for simulation screenshots.

Resources: `sonobe://guides/{topic}`, `sonobe://patches/{type}`, `sonobe://documents/{docId}/outline`, `sonobe://documents/{docId}/diagnostics`.

Prompts: `prototype_interaction`, `debug_interaction`, `explain_prototype`.

## Guides

`guides/*.md` holds the agent guides served by `get_guide`: start-here, graph-basics, gestures, animation, layout, loops, components, simulation and troubleshooting. `SONOBE_GUIDES_DIR` overrides the folder for bundles.

Every `json tool:<name>` example block runs through the real tools in `src/guides.test.ts`, and every `text outline` block must match real output. Keep examples passing when editing.

## Other exports

- `explain(doc, { registry, audience })`: a deterministic plain-language description at beginner, designer or engineer level.
- `tidyOps(component)`: layered patch layout.
- `TEMPLATES` / `createTemplateDocument`: starter documents.
- `SimEventSchema` / `parseSimEvents`: simulated input shapes.
- `traceTable` / `summaryText`: trace formatting (shared with the CLI).
