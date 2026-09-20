# Sonobe for Claude Desktop

A Desktop Extension (`.mcpb` bundle) that connects Claude Desktop to the running Sonobe app.

Inside the bundle is the `sonobe mcp` relay, packaged as one Node script. Claude Desktop ships Node, so there's nothing else to install. The relay reads the connection file the app writes on launch (`~/.sonobe/mcp.json`, readable only by your user account), checks the app is alive, and forwards Claude's requests to the app's local endpoint (`127.0.0.1` only, token required).

You sign in to Claude inside Claude Desktop with your own plan. Sonobe never sees your Claude credentials.

## Build the extension

From a Sonobe checkout, with dependencies installed:

```sh
node integrations/claude-desktop/build.ts
npx @anthropic-ai/mcpb pack integrations/claude-desktop/dist sonobe.mcpb
```

`build.ts` builds the single-file CLI with `packages/cli/scripts/bundle.ts` (the same bundle npm installs) into `dist/server/sonobe.mjs`. It also copies the agent guides, the examples' READMEs and tests (for `list_examples` and `get_example`), the manifest and the license. `mcpb pack` validates the manifest and zips the folder.

## Install

1. Open `sonobe.mcpb` with Claude Desktop, or go to **Settings → Extensions → Advanced settings → Install Extension…** and pick the file.
2. Claude Desktop shows what the extension runs. Confirm.
3. Leave **Sonobe settings folder** at its default unless you launch Sonobe with `SONOBE_HOME`.
4. Open Sonobe, then ask Claude: "List the documents open in Sonobe."

Sonobe's tools appear under **Connectors**. The prompts `import_screen`, `prototype_interaction`, `debug_interaction` and `explain_prototype` are available from the prompt menu.

Updating: build and pack a new version, then install it the same way. Privately distributed extensions don't update automatically.

## Manual configuration

If you'd rather not use an extension, build the CLI bundle (`npm run build -w @sonobe/cli` writes `packages/cli/dist/sonobe.mjs`) and add it to `claude_desktop_config.json`: **Settings → Developer → Edit Config**. Claude Desktop doesn't read your shell's PATH, so use absolute paths, then fully quit and restart Claude Desktop.

```json
{
  "mcpServers": {
    "sonobe": {
      "command": "/usr/local/bin/node",
      "args": ["/Users/you/sonobe/packages/cli/dist/sonobe.mjs", "mcp"]
    }
  }
}
```

To work on a project folder without the app (editing, simulation, screenshots and saving):

```json
{
  "mcpServers": {
    "sonobe-headless": {
      "command": "/usr/local/bin/node",
      "args": [
        "/Users/you/sonobe/packages/cli/dist/sonobe.mjs",
        "mcp",
        "--headless",
        "/Users/you/Prototypes/Checkout Flow.sonobe"
      ]
    }
  }
}
```

Headless screenshots are drawn without the app: text uses approximate font metrics, and video, Lottie and shaders show placeholders. They need the native rasterizer `@resvg/resvg-js`. `build.ts` copies the one installed for your platform into `dist/server/node_modules`, so build the extension on the platform it runs on.

## Troubleshooting

- **The extension fails to start** with "the Sonobe app isn't running": open Sonobe first, then toggle the extension off and on.
- **"rejected the token"**: the connection file is from an earlier launch. Quit and reopen Sonobe.
- **Logs**:
  - macOS: `~/Library/Logs/Claude/mcp-server-Sonobe.log`
  - Windows: `%APPDATA%\Claude\logs`
  - The relay writes its diagnostics to stderr, which lands in these logs.
