# Working with Claude

Any level · Back to [the learning path](README.md)

## What you'll be able to do

- Connect Claude Desktop or Claude Code to Sonobe using your own Claude plan, with no API key.
- Ask Claude to build prototypes, simulate taps, explain graphs and debug problems.
- Write prompts that get good results at your level.
- Know what stays on your machine, and undo anything Claude does.

## How it fits together

```
┌──────────────────────────── your computer ────────────────────────────┐
│                                                                        │
│   Claude Desktop  or  Claude Code      signed in with your Claude plan │
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

MCP, the Model Context Protocol, is an open standard that lets Claude's apps use tools running on your own computer. Sonobe's desktop app runs an MCP server. When you ask Claude for something, it calls Sonobe's tools, like reading the outline, adding patches, simulating a tap or taking a screenshot.

Every change Claude makes goes through the same operation engine your own clicks use. It gets validated the same way, and it lands in the same undo history.

You sign in to Claude inside Claude's own app, never inside Sonobe. Sonobe never asks for your Claude login and never sees your credentials. There's no API key to paste.

Claude in a web browser can't reach a server running on your own computer. For a live document, use Claude Desktop or Claude Code.

## Connect Claude Desktop

1. In Sonobe, open the Connect Claude screen. You'll find it in the command palette (⌘K).
2. Choose Claude Desktop. Sonobe gives you its extension, a `.mcpb` bundle. Open it, and Claude Desktop shows an install dialog describing what it will run. Confirm.
3. Restart Claude Desktop if it asks. Sonobe now appears in Claude's connectors.
4. Test it by asking Claude, "List the documents open in Sonobe."

If you'd rather configure it by hand, the Connect Claude screen shows the exact setup for your machine. It runs the `sonobe mcp` relay, which forwards Claude's requests to the running app. It looks something like this:

```json
{
  "mcpServers": {
    "sonobe": { "command": "sonobe", "args": ["mcp"] }
  }
}
```

## Connect Claude Code

Claude Code works through a plugin or a one-line command. The Connect Claude screen shows both, filled in for your machine.

The plugin bundles the server connection plus skills that teach Claude Sonobe's patch vocabulary and how to check its own work. The command version looks like this:

```sh
claude mcp add sonobe -- sonobe mcp
```

Claude Code can also work on a project without the app open. `sonobe mcp --headless "Checkout Flow.sonobe"` serves a project folder directly, with editing, simulation and saving. Screenshots need the app, so they aren't available in headless mode.

## What Claude can do

| You ask for | Claude uses tools like |
|---|---|
| "What does this prototype do?" | `get_outline`, `find`, `get_selection`, `explain` |
| "Build a long-press menu on the photo." | `add_layers`, `add_patches`, `connect`, `set_values`, `apply_ops` |
| "Wrap this into a component." | `create_component`, `tidy_graph` |
| "Tap the Save button and see what happens." | `sim_reset`, `sim_dispatch`, `sim_step`, `sim_get_values`, `get_screenshot` |
| "How long does the sheet take to settle?" | `sim_trace` |
| "Is anything broken?" | `get_diagnostics` |
| "Undo what you just did." | `list_history`, `undo` |

Before building, Claude looks up patch types with `describe_patch_types`, so it wires real ports with real defaults instead of guessing from memory.

Claude can see your selection. Select a few patches in the editor and say "explain these," and it knows which ones you mean.

Here's the kind of outline Claude reads, compact and plain (illustrative):

```
component main "Main" (prototype) 402x874
layer card rectangle "Card" @16,120 358x220 scale←grow.output
patch tap_card interaction layer=@card
patch toggle switch flip←tap_card.tap
patch pop popAnimation number←toggle.on bounciness=5 speed=10
patch grow transition<number> progress←pop.output start=1 end=1.08
```

Sonobe also offers three ready-made prompts: `prototype_interaction`, `debug_interaction` and `explain_prototype`. In Claude Code they appear as slash commands.

## Watching and undoing

- While Claude works, the AI Activity panel in the bottom HUD shows what it's doing, and the items it's changing are highlighted in the editor.
- Each batch of changes becomes one history entry, labeled with who made it, like "Claude: added press animation (12 ops)". One undo removes the whole batch.
- Batches are all or nothing. If any change in a batch fails validation, none of the batch is applied, so you never end up with half a feature.
- Claude's edits are tied to the version of the document they were based on. If you changed the document in the meantime, Sonobe rejects the edit and Claude re-reads instead of overwriting your work.
- Claude can preview a batch without applying it, to see the resulting changes and any diagnostics first.
- You can keep working while Claude works. Just avoid editing the exact patches it's changing.

## Prompts for every level

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
- Ask for one feature per request, and read the history entry when it's done.
- If you can't explain the graph Claude built, ask it to walk you through it before you move on.

## Privacy

- Sonobe's MCP server listens only on your own computer (127.0.0.1). It rejects requests from web pages, and it requires a token stored in `~/.sonobe/mcp.json`, a file only your user account can read. Other devices on your network can't connect to it. The web player you use for phone previews is a separate server, and you turn it on yourself.
- Sonobe doesn't upload your document anywhere. Anything Claude reads through Sonobe's tools, like the outline, live values or screenshots, becomes part of your conversation with Claude, handled under your Claude plan and its settings. Treat giving Claude access to a confidential file like sharing that file with Claude.
- Layer names, notes and comments are just data. If a file came from someone you don't trust, keep in mind that text inside it could try to steer Claude, and review what Claude proposes.
- Sonobe's optional in-app Assistant drawer is separate from all of this. It uses your own Anthropic API key, for people who'd rather not use Claude Desktop or Claude Code.

## Try it

1. Connect Claude Desktop or Claude Code, and ask Claude for the outline of your open document.
2. Ask Claude to build the tap-to-grow card from guide 01. Then undo it with a single undo, and check that it's gone.
3. Use teach mode to build an ISAT modal yourself, with Claude checking each step.
4. Break the card on purpose (guide 09 has ideas) and run the `debug_interaction` prompt.
5. Ask Claude for SwiftUI and Compose handoff code for your card's spring, and compare it with the converter in the inspector.

## Common mistakes

- Using Claude in a web browser and expecting it to reach Sonobe. Use Claude Desktop or Claude Code.
- Vague requests like "make it nicer". Say what should change and how it should feel.
- Accepting a graph you can't explain. Ask for a walkthrough first.
- Pasting tokens or API keys into the chat. Claude never needs the MCP token. The connection handles it.
- Skipping verification. A reply of "done" isn't evidence. Ask for a simulation or a trace.
- Editing the same patches Claude is editing. Your edit wins, Claude's gets rejected, and it has to re-read and try again.
