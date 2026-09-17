# Working with Claude

Any level · Back to [the learning path](README.md)

## What you'll be able to do

- Connect Claude Code or Claude Desktop to Sonobe using your own Claude plan, with no API key.
- Ask Claude to build prototypes, simulate taps and drags, explain graphs and debug problems.
- Write prompts that get good results at your level.
- Know what stays on your machine, and undo anything Claude does.

## How it fits together

```
┌──────────────────────────── your computer ────────────────────────────┐
│                                                                        │
│   Claude Code  or  Claude Desktop      signed in with your Claude plan │
│              │                                                         │
│              │  starts                                                 │
│              ▼                                                         │
│   sonobe mcp (the relay)               reads ~/.sonobe/mcp.json        │
│              │                                                         │
│              │  MCP                                                    │
│              ▼                                                         │
│   Sonobe's MCP server                  127.0.0.1 only, token required  │
│              │                                                         │
│              ▼                                                         │
│   your open document                   same ops, same undo history     │
│                                        as your own clicks              │
└────────────────────────────────────────────────────────────────────────┘
```

MCP, the Model Context Protocol, is an open standard that lets Claude's apps use tools running on your own computer. The Sonobe desktop app runs an MCP server. Claude's app starts a small relay, `sonobe mcp`, which reads the connection file the app writes when it launches and forwards Claude's requests to that server. When you ask Claude for something, it calls Sonobe's tools, like reading the outline, adding patches, simulating a tap or taking a screenshot.

Every change Claude makes goes through the same operation engine your own clicks use. It gets validated the same way, and it lands in the same undo history.

You sign in to Claude inside Claude's own app, never inside Sonobe. Sonobe never asks for your Claude login and never sees your credentials. There's no API key or token to paste.

Claude in a web browser can't reach a server running on your own computer. For a live document, use Claude Code or Claude Desktop.

## Open the Connect Claude screen

Sonobe fills in the setup for your machine, so start here. Any of these opens the screen:

- The **Connect Claude** button at the right end of the toolbar.
- **Help → Connect Claude…** in the menu bar.
- "Connect Claude…" in the command palette (⌘K).
- **Build with Claude** on the welcome screen, or **Connect Claude** in the empty AI Activity panel.

At the top, a status card says whether Sonobe is ready for Claude. Below it, choose **Claude Code** or **Claude Desktop**. A second switch, **How Claude starts Sonobe**, picks what the command runs:

- **Sonobe app** runs the CLI that ships inside the app, by its full path. Nothing has to be on your PATH, and you don't need Node installed.
- **From source** runs the CLI straight from a Sonobe checkout with Node 22.18 or later. Fill in your Node path and your Sonobe folder, and the commands update.

Further down are prompts to try for beginners, designers and engineers, a summary of what stays private, and a button that opens this guide.

If you open the editor in a browser instead of the app, the status card says live editing needs the desktop app. The commands switch to headless mode, which works on a project folder you type in (see [Without the app](#without-the-app-headless-mode)).

## Connect Claude Code

1. On the Connect Claude screen, choose **Claude Code** and copy the command under **Run this in a terminal**.
2. Run it in a terminal. With the Mac app in your Applications folder, it looks like this:

   ```sh
   claude mcp add sonobe -- /Applications/Sonobe.app/Contents/Resources/cli/sonobe mcp
   ```

3. Keep Sonobe open, start Claude Code, and ask, "List the documents open in Sonobe." Run `claude mcp list` anytime to check the connection.

From a source checkout, you can use the CLI bundle instead, one self-contained file that runs on Node 22 or later. Build it once with `npm run build -w @sonobe/cli`, then use its full path:

```sh
claude mcp add sonobe -- node "/path/to/sonobe/packages/cli/dist/sonobe.mjs" mcp
```

A plain `sonobe mcp` works only after you build the CLI and run `npm link -w @sonobe/cli`, which puts `sonobe` on your PATH.

### The Claude Code plugin

The plugin bundles the server connection plus a skill that teaches Claude to build in small verified batches, wire real ports and prove behavior in simulation. It needs Claude Code 2.1.232 or later and Node on your PATH. From a checkout:

```sh
node integrations/claude-code/build.ts
claude --plugin-dir ./integrations/claude-code
```

Check with `/mcp` that `sonobe` is connected. The tools appear as `mcp__plugin_sonobe_sonobe__<tool>`, and Sonobe's three prompts become slash commands.

### Without the app: headless mode

Claude Code can also work on a project without the app open:

```sh
claude mcp add sonobe-headless -- /Applications/Sonobe.app/Contents/Resources/cli/sonobe mcp --headless "/path/to/Checkout Flow.sonobe"
```

Headless mode serves a project folder directly, with editing, simulation, saving and screenshots. Changes save after every edit. Add `--no-autosave` to keep them in memory until Claude calls `save_document`. If the folder changes while Claude works, because you, git or the app wrote to it, saving stops with `disk_changed` instead of writing over it, and Claude asks whether to reload or overwrite.

Headless screenshots are drawn without the app, so text uses approximate font metrics, and video, Lottie and shaders show placeholders. They need a native image library installed beside the CLI. The CLI and plugin builds include it, and if it's missing, Claude is told so and checks the prototype with the outline and simulations instead. Only the app knows what you've selected in the editor.

## Connect Claude Desktop

You can add Sonobe to Claude Desktop's config, which works with the packaged app, or build a Desktop Extension from a source checkout.

### A config entry

1. On the Connect Claude screen, choose **Claude Desktop**. The screen shows a config entry filled in for your machine.
2. In Claude Desktop, open **Settings → Developer → Edit Config**, and add the entry to `claude_desktop_config.json`. On a Mac the file is at `~/Library/Application Support/Claude/claude_desktop_config.json`, and on Windows it's at `%APPDATA%\Claude\claude_desktop_config.json`. If the file already has `mcpServers`, add the `sonobe` entry inside it.
3. Quit Claude Desktop completely and open it again.
4. With Sonobe open, ask Claude, "List the documents open in Sonobe."

With the Mac app in your Applications folder, the entry looks like this:

```json
{
  "mcpServers": {
    "sonobe": { "command": "/Applications/Sonobe.app/Contents/Resources/cli/sonobe", "args": ["mcp"] }
  }
}
```

Claude Desktop doesn't see your terminal's PATH, so the entry uses a full path. That command ships inside the app and runs on the app's own runtime, so you don't need Node installed.

From a source checkout, build the CLI with `npm run build -w @sonobe/cli`. Then use your full Node path as the command (`which node` prints it), with `/path/to/sonobe/packages/cli/dist/sonobe.mjs` and `mcp` as the args. The README in `integrations/claude-desktop` has the details.

### The Desktop Extension

A Desktop Extension is a `.mcpb` bundle that carries the relay, so Claude Desktop runs it with its own Node. When the desktop app loads the editor from the development server (`SONOBE_DEV_URL`), the Claude Desktop tab shows these steps first. From your Sonobe folder, build and pack it:

```sh
node integrations/claude-desktop/build.ts
npx @anthropic-ai/mcpb pack integrations/claude-desktop/dist sonobe.mcpb
```

1. Open the new `sonobe.mcpb` in your Sonobe folder with Claude Desktop, or choose **Settings → Extensions → Advanced settings → Install Extension…** and pick the file.
2. Claude Desktop shows what the extension will run. Confirm.
3. Leave **Sonobe settings folder** at its default, unless you launch Sonobe with `SONOBE_HOME`.
4. Open Sonobe and ask Claude, "List the documents open in Sonobe." Sonobe's tools appear under **Connectors**, and its three prompts are in the prompt menu.

Extensions you build yourself don't update automatically. To update, build and pack again, then install the new file.

## If Claude can't connect

- **"the Sonobe app isn't running."** Open Sonobe first. In Claude Code, reconnect with `/mcp` → `sonobe` → Reconnect. In Claude Desktop, turn the extension off and on, or restart Claude Desktop if you used a config entry.
- **"rejected the token."** The connection file is from an earlier launch. Quit and reopen Sonobe.
- **A custom settings folder.** If you launch Sonobe with `SONOBE_HOME`, set the same variable for the relay, or set the extension's **Sonobe settings folder**.
- **Logs.** The relay writes what went wrong to stderr. Claude Code shows it in the `/mcp` details, and Claude Desktop writes it to its logs folder (`~/Library/Logs/Claude` on a Mac, `%APPDATA%\Claude\logs` on Windows).

## What Claude can do

Sonobe gives Claude 39 tools in six groups: discovery, documents, reading, writing, simulation, and presence and history. Here's what they look like in practice:

| You ask for | Claude uses tools like |
|---|---|
| "What does this prototype do?" | `get_outline`, `find`, `get_selection`, `explain` |
| "Build a long-press menu on the photo." | `describe_patch_types`, `add_layers`, `add_patches`, `connect`, `set_values`, `apply_ops` |
| "Make the title bigger and rename it." | `update_layers`, `rename` |
| "Wrap this into a component." | `create_component`, `tidy_graph` |
| "Tap the Save button and see what happens." | `sim_reset`, `sim_dispatch`, `sim_step`, `sim_get_values`, `get_screenshot` |
| "How long does the sheet take to settle?" | `sim_trace` |
| "Is anything broken?" | `get_diagnostics` |
| "Start a new prototype and save it." | `create_document`, `open_document`, `save_document` |
| "Undo what you just did." | `list_history`, `undo` |

Before building, Claude reads a workflow guide with `get_guide` and looks up patch types with `describe_patch_types`, so it wires real ports with real defaults instead of guessing from memory. While it works, `begin_work`, `reveal` and `finish_work` show you what it's changing.

Claude can see your selection. Select a few patches in the editor and say "explain these," and it knows which ones you mean.

Here's part of the outline Claude reads for example 01, Tap to Grow. It's compact and plain:

```
component main "Main" (prototype) 402x874
layer card group "Card" @201,470 338x440 anchor=0.5,0.5 scale←card_scale.output …
patch tap_card interaction "Tap Card" layer=@card
patch card_zoomed switch "Card Zoomed" flip←tap_card.tap
patch zoom_spring popAnimation<number> "Zoom Spring" number←card_zoomed.on bounciness=6 speed=12
patch card_scale transition<number> "Card Scale" progress←zoom_spring.output start=1 end=1.12
```

Sonobe also offers three ready-made prompts: `prototype_interaction`, `debug_interaction` and `explain_prototype`.

## Watching and undoing

- While Claude works, the AI Activity tab in the bottom HUD shows what it's doing, and the items it's changing are highlighted in the editor.
- Each batch of changes becomes one row in AI Activity with its op count, and one entry in Edit → Undo, labeled with who made it, like "Claude: added press feedback (4 ops)". One undo removes the whole batch, and each row has its own **Undo this** button.
- Batches are all or nothing. If any change in a batch fails validation, none of the batch is applied, so you never end up with half a feature.
- Claude's edits are tied to the version of the document they were based on. If you changed the document in the meantime, Sonobe rejects the edit and Claude re-reads instead of overwriting your work.
- Claude can preview a batch without applying it, to see the resulting changes and any diagnostics first.
- Deleting a lot at once asks Claude to confirm first.
- You can keep working while Claude works. Just avoid editing the exact patches it's changing.

## Prompts for every level

The Connect Claude screen has more of these under **Try asking**. Click one to copy it.

### Level 0: never prototyped

- "Make a card that grows a little when I tap it. Add one patch at a time, and after each one, tell me in a sentence what it does."
- "Explain this prototype as if I've never used a patch editor."

### Level 1: can make one thing move

- "My heart button doesn't do anything when I tap it. Simulate a tap on it and tell me why."
- "Turn this into three tabs with an underline that slides. Use Option Switch and Option Picker, and name each patch by its effect."
- Teach mode: "Don't build it for me. Tell me the next single step, wait until I say done, then check my work with the outline."

### Level 2: making it feel right

- "Build a bottom sheet I can drag down to dismiss. Hand the finger's velocity to the spring when I let go."
- "The sheet feels mushy. Trace @sheet.position for one second after a 1,500 points per second flick, then suggest spring numbers that settle under 400 ms with less than 3% overshoot."

### Level 3: whole flows

- "Wrap the post card into a component with Title, Image and Liked as published ports, then build a ten-post feed from a loop."
- "Tidy the graph, name every patch by its effect, and add a comment frame for each feature."

### Level 4: expert

- "Tap @card, step 60 frames, and confirm @card.scale ends at 1.08 with less than 2% overshoot. Report the settle time."
- "Give me handoff code for every spring in this file, for SwiftUI and Jetpack Compose, as a table."
- "Find patches with no path to any layer. List them before you delete anything."

### Habits that get better results

- Name your layers. "The Save button" beats "the second rectangle".
- Describe how it should feel as well as what it should do. "Snappy, no visible bounce" gives Claude something to aim for.
- Say what done looks like, and ask Claude to prove it with a simulation or a trace.
- Ask for one feature per request, and read the AI Activity row when it's done.
- If you can't explain the graph Claude built, ask it to walk you through it before you move on.

## Privacy

- Sonobe's MCP server listens only on your own computer (127.0.0.1). It rejects requests from web pages, and it requires a token stored in `~/.sonobe/mcp.json`, a file only your user account can read. Other devices on your network can't connect to it. The web player you use for phone previews is a separate server, and you turn it on yourself.
- Sonobe doesn't upload your document anywhere. Anything Claude reads through Sonobe's tools, like the outline, live values or screenshots, becomes part of your conversation with Claude, handled under your Claude plan and its settings. Treat giving Claude access to a confidential file like sharing that file with Claude.
- Layer names, notes and comments are just data. If a file came from someone you don't trust, keep in mind that text inside it could try to steer Claude, and review what Claude proposes.
- Sonobe's optional in-app Assistant drawer is separate from all of this. It runs only in the desktop app and uses your own Anthropic API key, kept in your operating system's keychain, for people who'd rather not use Claude Code or Claude Desktop.

## Try it

1. Connect Claude Code or Claude Desktop, and ask Claude for the outline of your open document.
2. Ask Claude to build the tap-to-grow card from guide 01. Then undo it with a single undo, and check that it's gone.
3. Use teach mode to build an ISAT modal yourself, with Claude checking each step.
4. Break the card on purpose (guide 09 has ideas) and run the `debug_interaction` prompt.
5. Ask Claude for SwiftUI and Compose handoff code for your card's spring, and compare it with the converter in the inspector.

## Common mistakes

- Using Claude in a web browser and expecting it to reach Sonobe. Use Claude Code or Claude Desktop.
- Asking Claude for the open document while Sonobe is closed. Open the app first, or use headless mode on a project folder.
- Vague requests like "make it nicer". Say what should change and how it should feel.
- Accepting a graph you can't explain. Ask for a walkthrough first.
- Pasting tokens or API keys into the chat. Claude never needs the MCP token. The relay handles it.
- Skipping verification. A reply of "done" isn't evidence. Ask for a simulation or a trace.
- Editing the same patches Claude is editing. Your edit wins, Claude's gets rejected, and it has to re-read and try again.
