# @sonobe/cli

The `sonobe` command. It runs on Node 22.18+ with type stripping: `node packages/cli/src/main.ts <command>`. You can also run `npm link -w @sonobe/cli` to put `sonobe` on your PATH.

| Command                                                                                                 | Does                                                                    |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `sonobe new <dir> [--template blank\|photo-zoom] [--name] [--device]`                                   | create a project folder                                                 |
| `sonobe validate <dir> [--strict] [--json]`                                                             | schema and format checks, then diagnostics; exits 1 on errors           |
| `sonobe fmt <dir> [--check]`                                                                            | rewrite files canonically; `--check` exits 1 when anything would change |
| `sonobe outline <dir> [--component] [--detail compact\|normal\|full]`                                   | print the outline                                                       |
| `sonobe describe <patchOrLayerType> [--full] [--json]`                                                  | declarations, defaults, pairings, examples                              |
| `sonobe sim <dir> --trace <a,b> [--events <file>] [--duration <ms>] [--fps] [--seed] [--rows] [--json]` | deterministic simulation with a columnar trace and summaries            |
| `sonobe mcp`                                                                                            | stdio relay to the running app                                          |
| `sonobe mcp --headless <dir> [--no-autosave]`                                                           | MCP over stdio for a folder, without the app                            |

## Event files

An events file is a JSON array of simulated inputs, or `{ "events": [...] }`. Each input takes the same shapes as `sim_dispatch`:

```json
[
  { "kind": "tap", "target": "@photo", "atMs": 100 },
  { "kind": "drag", "from": "@knob", "to": [300, 422], "atMs": 800 }
]
```

## The relay

`sonobe mcp`:

1. Reads `~/.sonobe/mcp.json` (the `SONOBE_HOME` folder overrides it).
2. Checks `/health` with the bearer token.
3. Forwards each JSON-RPC line from stdin as its own POST and streams JSON or SSE responses back.

It covers both protocol eras:

- **2026-07-28:** sets `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name` from the request envelope.
- **2025-era:** replays the negotiated protocol version header.

`notifications/cancelled` aborts the in-flight request. When the app isn't running, or the token is stale, it explains how to start the app or use `--headless`, then exits 1.

`runCli(argv, io)` runs any command in-process with injectable streams (see `src/cli.test.ts`).
