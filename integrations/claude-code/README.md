# Sonobe for Claude Code

A Claude Code plugin that connects Claude to Sonobe and teaches it the prototyping workflow.

- **MCP server** (`.mcp.json`). It runs the bundled `sonobe` CLI (`dist/sonobe.mjs`) as `sonobe mcp`, a stdio relay to the running Sonobe app. The relay reads the app's connection file (`~/.sonobe/mcp.json`) and sends the app's token itself, so you never paste a token.
- **Skill** (`skills/sonobe/SKILL.md`). How to build in small verified batches, wire real ports, prove behavior in simulation, and talk about results in plain words.

It uses your own Claude plan. Sonobe never sees your Claude credentials.

## Requirements

- Claude Code 2.1.232 or later (for the 2026-07-28 protocol; older versions work over the 2025 protocol).
- Node 22 or later on your PATH.
- The plugin's server bundle. From a Sonobe checkout with dependencies installed:

  ```sh
  node integrations/claude-code/build.ts
  ```

  This writes `integrations/claude-code/dist/sonobe.mjs`: the whole CLI in one file, with the agent guides beside it. `.mcp.json` runs it with `node ${CLAUDE_PLUGIN_ROOT}/dist/sonobe.mjs mcp`, so nothing else has to be on your PATH.

- The Sonobe app, running. Or use headless mode (below).

## Install

Try it from a checkout without installing:

```sh
claude --plugin-dir ./integrations/claude-code
```

Or install it from a plugin marketplace that lists it:

```text
/plugin marketplace add <owner>/<marketplace-repo>
/plugin install sonobe@<marketplace-name>
```

A marketplace copy must include the built `dist/` folder.

Check the connection with `/mcp` in Claude Code; `sonobe` should be connected. Then ask Claude, "What's in my open Sonobe document?"

The tools appear as `mcp__plugin_sonobe_sonobe__<tool>`. The prompts `prototype_interaction`, `debug_interaction` and `explain_prototype` become slash commands.

### Without the plugin

Build the CLI bundle once (`npm run build -w @sonobe/cli` writes `packages/cli/dist/sonobe.mjs`), then, from any folder:

```sh
claude mcp add --scope user sonobe -- node "/absolute/path/to/sonobe/packages/cli/dist/sonobe.mjs" mcp
```

`--scope user` gives every project the tools; without it, Claude Code adds the server to the current folder only. Or put `sonobe` on your PATH with `npm link -w @sonobe/cli` (after building) and run `claude mcp add --scope user sonobe -- sonobe mcp`.

## Headless mode

To work on a project folder without the app running, point the server at the folder. It serves one prototype, so add it in the folder where you start Claude:

```sh
claude mcp add --scope local sonobe-headless -- node "/absolute/path/to/sonobe/packages/cli/dist/sonobe.mjs" mcp --headless "/absolute/path/Checkout Flow.sonobe"
```

- **Works:** editing, validation, simulation, screenshots and saving. Changes save after every edit; pass `--no-autosave` to keep them in memory until Claude calls `save_document`. If the folder changes outside the session (the app, git, you), saving stops with `disk_changed` instead of writing over it, and Claude asks whether to reload or overwrite.
- **Screenshots** are drawn without the app. Text uses approximate font metrics, and video, Lottie and shaders show placeholders. They need the native rasterizer `@resvg/resvg-js`: the build copies the one installed for your platform into `dist/node_modules`, so build the plugin on the platform it runs on.
- **Unavailable:** the editor selection.

## Troubleshooting

- **"Cannot find module …/dist/sonobe.mjs"**: the plugin's server isn't built yet. Run `node integrations/claude-code/build.ts`, then reconnect with `/mcp`.
- **"the Sonobe app isn't running"**: open Sonobe, then reconnect with `/mcp` → `sonobe` → Reconnect. Stdio servers don't reconnect automatically.
- **"rejected the token"**: `~/.sonobe/mcp.json` belongs to an earlier launch. Quit and reopen Sonobe.
- **A custom settings folder**: set `SONOBE_HOME` to the folder that holds `mcp.json`.
- **No Sonobe tools in one project**: `claude mcp list` there shows no `sonobe`, because an earlier setup added it to another folder only. Add it with `--scope user`. An old entry with local scope wins in its own folder; remove it there with `claude mcp remove --scope local sonobe`.
- **The session isn't listed in Connect Claude**: the app lists sessions that go through `sonobe mcp`. A client connected to the app's URL directly, or an older copy of the relay, can't say which session it is and shows as "Unidentified MCP client". An app from before session lists makes the relay log "doesn't list connected sessions" once and keep working.
- **Server logs**: the relay writes diagnostics to stderr, which Claude Code shows in `/mcp` details.
