# Sonobe

Sonobe is an open-source interaction prototyping app: layers, a patch graph and a live viewer in an Electron and React editor, a headless TypeScript engine, and an MCP server that Claude builds through.

Read these before changing code:

- [ARCHITECTURE.md](ARCHITECTURE.md) is the contract. When the code and it disagree, fix one of them in the same change.
- [CONTRIBUTING.md](CONTRIBUTING.md) has setup, code style, and the steps for common changes: patches, MCP tools, patch editor node sizes, Sonobe Viewer and the evals.
- [ROADMAP.md](ROADMAP.md) says what's done and what's left. Check off what you finish, and say what's left of anything partial.

The rules that matter most:

- Every document change goes through `applyOps()` in `@sonobe/core`, from the UI, MCP, the CLI and scripts alike.
- The engine stays headless and deterministic: no DOM, and no `Math.random()` or `Date.now()` in patches.
- A patch is declared once, in its catalog entry, and everything else is generated from it.
- Errors teach: a message written for people, plus a hint or a suggested fix.

## Checks

```sh
npm run typecheck
npm test                              # Vitest over the whole repo
npx vitest run packages/core          # one package or folder
npm run e2e                           # Playwright in Chromium; SONOBE_E2E_PORT=<port> for a server of your own
```

CI runs these three (`.github/workflows/ci.yml`). The e2e run rewrites the screenshots in `apps/editor/screenshots`; keep only the ones your change meant to change.

Docs are checked too: `packages/cli/src/docs.test.ts` and `apps/desktop/electron/architecture.test.ts` compare the README, ARCHITECTURE, ROADMAP and the guides with the code, and `packages/mcp/src/guides.test.ts` runs the agent guides' examples and holds them to a line limit. Update docs in the same change, and trim rather than raise a limit.

Generated files are rebuilt, never edited by hand:

```sh
node packages/patches/scripts/generate-docs.ts   # docs/patches, from the patch catalog
node examples/build.ts                           # the example projects, from examples/recipes (--check to compare)
node packages/import/scripts/build-walker.ts     # the DOM walker and SF Symbols bundles
node apps/editor/scripts/measure-node-fonts.ts   # the patch editor's node font table (macOS)
```

These run by hand, outside CI:

```sh
npm run smoke -w @sonobe/desktop   # the muted Electron end-to-end run
npm run test:ios                   # Sonobe Viewer on an iOS Simulator (Xcode)
node evals/run.ts                  # Claude builds each eval case (uses your Claude account)
```

The desktop build packages `packages/cli/dist` when it's there, and the evals run it, so run `npm run build -w @sonobe/cli` before either. The Electron run rewrites the screenshots in `apps/desktop/screenshots`; keep only the ones you meant to change.

`apps/editor/src/state/document.ts` has a NUL byte inside a template literal. Edit that file byte for byte.
