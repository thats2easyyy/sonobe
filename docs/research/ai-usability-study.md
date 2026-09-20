# AI usability study: Claude Code building with Sonobe

**Date:** September 2026 · **Client:** Claude Code 2.1.273 in headless mode (`claude -p`) · **Server:** `sonobe mcp --headless <project>`

This study checked whether Claude could build, debug, and explain real prototypes using **only Sonobe's MCP tools**. Claude Code's file and shell tools were disabled, so every task had to go through the MCP surface. Each run started from a fresh project copy and used the person's own Claude plan. No API key was involved.

## Setup

```bash
claude -p "<task prompt>" \
  --mcp-config mcp.json --strict-mcp-config \
  --allowedTools "mcp__sonobe" \
  --disallowedTools "Bash" "Read" "Edit" "Write" "Glob" "Grep" "WebFetch" "WebSearch" \
  --output-format stream-json --verbose
```

`mcp.json` starts `sonobe mcp --headless <project folder>`. `--mcp-config` and `--strict-mcp-config` apply only to that invocation and leave the person's Claude configuration untouched.

The tasks are now repeatable eval cases (`evals/cases/study-*`), which `node evals/run.ts` runs this way and checks by simulation. See [evals/README.md](../../evals/README.md).

## Results

| Task | Prompt (summary) | Time | Turns | Tool errors | Outcome |
|---|---|---|---|---|---|
| Smoke | "Read this prototype and tell me what it does" | — | 5 | 0 | Correct description from `get_guide`, `get_document_info`, `get_outline` |
| Beginner | "I've never prototyped. Make a big heart like button that pops bigger with a bounce and turns red; tapping again un-likes it. Check it works." | 88 s | 18 | 0 | Built a heart shape plus a tap → switch → spring → transition chain, with a separate no-bounce spring for color. Verified with `sim_dispatch` + `sim_trace`. Explained it for a beginner. |
| Designer | "iOS-style bottom sheet: peeks, drag up to open, flick down to close, snaps with springs, dims the background. Verify with a simulated drag." | 210 s | 27 | 1 (recovered) | Maps-style sheet with velocity-based snapping, a spring handoff at release velocity, a dim overlay, and tap-to-close. Verified 4 drag scenarios. |
| Debug | Bottom sheet example with Gesture Velocity disconnected: "It feels dead when I flick it. Find out why and fix it." | 94 s | 19 | 0 | Diagnosed the missing Gesture Velocity from release-frame traces, fixed it with one `connect`, and showed a before/after frame table plus two regression checks. |
| Explain + tweak | Carousel example: "Explain how it works to someone new, then make the snapping bouncier." | 149 s | 30 | 0 | Accurate beginner explanation. Changed the springs and confirmed they still settle. |

## Issues the study found, and fixes

1. **Claude Code shows the model only `structuredContent` for tools that declare an output schema.** Sonobe put guide text, outlines, and layer lists in plain text content, so Claude saw only counts and fell back to reading files. *Fixed:* every tool now puts its full payload in `structuredContent`, and a regression test covers all tools.
2. **Batches had to define `$ref`s before using them.** The designer run hit `unknown_ref` once and recovered from the error message. *Fixed:* refs resolve regardless of order within a batch.
3. **Headless projects had no screenshots.** *Fixed:* the headless host renders the scene to SVG and rasterizes it (`@resvg/resvg-js`), so `get_screenshot` works without the app.
4. **Several guides meant several calls.** *Fixed:* `get_guide` accepts `topics: [...]`.
5. **Intentional feedback loops read like problems.** *Fixed:* loops broken by Delay One Frame or pulse-gated inputs are now reported calmly as intentional; accidental loops are warnings.
