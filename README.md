# Sonobe

**Interaction prototyping for everyone. Layers, patches, a live viewer, and Claude as your co-builder.**

Sonobe is an open-source desktop app for building high-fidelity interactive prototypes. You design with layers, then bring them to life with *patches*: small visual building blocks that you wire together. Taps, springs, scrolling, state, loops, data, and sensors are all available.

If you've used Meta's Origami Studio, it will feel familiar. Sonobe is built so you never need a Facebook group to learn it:

- **AI-native.** Sonobe runs a local [MCP](https://modelcontextprotocol.io) server, so Claude Desktop or Claude Code can build, simulate, explain, and debug prototypes with you. Use your own Claude subscription; you don't need an API key.
- **Learnable.** Pulses light up as they travel. Every patch has plain-language docs and examples. Errors tell you how to fix them. Guides go from "never prototyped" to expert.
- **Open.** MIT licensed. Runs on macOS, Windows, and Linux. Preview on your phone in a browser. Documents are readable JSON that works with git.

> **Status: early development.** The architecture and foundations are being built in the open. Expect rough edges and breaking changes until 1.0.

---

## How it works

```
Layers                    Patches (the logic)                         Viewer
┌───────────┐   tap ┌─────────────┐ flip ┌────────┐  on  ┌───────────────┐ progress ┌────────────┐
│ ▢ Card    │──────▶│ Interaction │─────▶│ Switch │─────▶│ Pop Animation │─────────▶│ Transition │──▶ Card.scale
│   T Title │       └─────────────┘      └────────┘      └───────────────┘          └────────────┘
└───────────┘
```

The core pattern is **Interaction → Switch → Animation → Transition**. Tap something, remember the state, animate with a spring, and map the animation onto a property. Start there and add the rest when you need it: loops, components, data, and gestures.

## Working with Claude

Sonobe runs an MCP server on `127.0.0.1`. Connect a client once:

```bash
# Claude Code
claude mcp add sonobe -- npx sonobe mcp

# Claude Desktop: open Sonobe → Help → Connect Claude → "Install in Claude Desktop"
```

Then ask for things like:

- *"Make the card expand into a detail view with a bouncy spring when I tap it."*
- *"Why doesn't my bottom sheet close when I drag down fast?"*
- *"Explain this patch graph like I'm new to prototyping."*

Claude reads the document structure, applies typed operations you can undo, simulates taps and drags to verify the result, and takes screenshots. Your edits and Claude's show up in the same history.

## Getting started (development)

```bash
npm install
npm run dev          # editor in the browser at http://localhost:5199
npm run desktop      # Electron app
npm test             # unit tests
npm run typecheck
```

## Repository layout

| Path | What's inside |
|---|---|
| `packages/core` | Document model, operations, history, diagnostics, file format |
| `packages/engine` | Runtime: patch evaluation, springs, layout, hit testing, gestures |
| `packages/patches` | The built-in patch library, with specs, behavior, and docs |
| `packages/renderer` | DOM renderer and input capture for the viewer |
| `packages/mcp` | MCP server: the tools Claude uses |
| `packages/cli` | `sonobe` CLI: validate, format, simulate, MCP relay |
| `apps/editor` | The editor UI (React) |
| `apps/desktop` | The Electron shell |
| `docs/guides` | Concept guides and recipes |
| `docs/research` | Research notes behind the design |

Read [ARCHITECTURE.md](ARCHITECTURE.md) before contributing code.

## Learn

Start with [docs/guides](docs/guides/README.md): your first prototype, states vs pulses, springs and feel, gestures, loops, components, debugging, and working with Claude.

## Contributing

Issues and pull requests are welcome. Good first contributions are patch implementations, recipes, and guide improvements.

## License

[MIT](LICENSE)

*Sonobe is an independent open-source project. It is not affiliated with or endorsed by Meta. "Origami Studio" is a trademark of its respective owner and is mentioned only to describe compatibility and familiarity.*
