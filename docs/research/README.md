# Research

These reports record the research behind Sonobe's design. They were written in September 2026, when Origami Studio was at version 228.

| Report | What it covers |
|---|---|
| [release-notes.md](release-notes.md) | Origami Studio's release history, current feature inventory, and where the official docs are stale |
| [semantics.md](semantics.md) | How patch graphs evaluate: pulses, loops, springs (Rebound formulas), interactions, components |
| [gap-fill.md](gap-fill.md) | Corrections to the other reports and runtime decisions (R1–R12) |
| [ui-controls.md](ui-controls.md) | Origami's panels, controls, and keyboard shortcuts |
| [blender-nodes.md](blender-nodes.md) | Blender's node editor UX patterns worth adopting |
| [learning-painpoints.md](learning-painpoints.md) | Why Origami is hard to learn and what beginners need |
| [ai-native-design-tools.md](ai-native-design-tools.md) | What makes design tools AI-friendly (Paper, Figma MCP, and others) and a proposed MCP surface |
| [claude-byo.md](claude-byo.md) | Bringing your own Claude subscription through MCP, and the MCP spec state of the art |
| [file-format-interop.md](file-format-interop.md) | Origami's file format and our document format decision |
| [stack-prior-art.md](stack-prior-art.md) | Technology stack evaluation and open-source prior art |
| [ai-usability-study.md](ai-usability-study.md) | Claude Code building real prototypes through Sonobe's MCP tools |

Sonobe is a clean-room project. The reports summarize and cite public sources rather than reproducing them. Raw research inputs that quoted third-party documentation at length (a patch census, per-patch notes, and a copy of the release notes) aren't published. The patch catalog in `packages/patches/catalog/` is written in our own words and supersedes them.
