# Sonobe for Claude Code

A Claude Code plugin that connects Claude to Sonobe and teaches it the prototyping workflow.

- **MCP server** (`.mcp.json`). It runs `sonobe mcp`, a stdio relay to the running Sonobe app. The relay reads the app's connection file (`~/.sonobe/mcp.json`) and sends the app's token itself, so you never paste a token.
- **Skill** (`skills/sonobe/SKILL.md`). How to build in small verified batches, wire real ports, prove behavior in simulation, and talk about results in plain words.

It uses your own Claude plan. Sonobe never sees your Claude credentials.

## Requirements

- Claude Code 2.1.232 or later (for the 2026-07-28 protocol; older versions work over the 2025 protocol).
- The `sonobe` command on your PATH. From a Sonobe checkout:

  ```sh
  npm link -w @sonobe/cli    # adds `sonobe` to your PATH
  sonobe --version
  ```

  If `sonobe` lives somewhere else, set `SONOBE_CLI` to its full path before starting Claude Code. The plugin runs `${SONOBE_CLI:-sonobe} mcp`.

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

Check the connection with `/mcp` in Claude Code; `sonobe` should be connected. Then ask Claude, "What's in my open Sonobe document?"

The tools appear as `mcp__plugin_sonobe_sonobe__<tool>`. The prompts `prototype_interaction`, `debug_interaction` and `explain_prototype` become slash commands.

### Without the plugin

```sh
claude mcp add sonobe -- sonobe mcp
```

## Headless mode

To work on a project folder without the app running, point the server at the folder:

```sh
claude mcp add sonobe-headless -- sonobe mcp --headless "/absolute/path/Checkout Flow.sonobe"
```

- **Works:** editing, validation, simulation and saving. Changes save after every edit; pass `--no-autosave` to keep them in memory until Claude calls `save_document`.
- **Unavailable:** screenshots and the editor selection.

## Troubleshooting

- **"the Sonobe app isn't running"**: open Sonobe, then reconnect with `/mcp` → `sonobe` → Reconnect. Stdio servers don't reconnect automatically.
- **"rejected the token"**: `~/.sonobe/mcp.json` belongs to an earlier launch. Quit and reopen Sonobe.
- **A custom settings folder**: set `SONOBE_HOME` to the folder that holds `mcp.json`.
- **Server logs**: the relay writes diagnostics to stderr, which Claude Code shows in `/mcp` details.
