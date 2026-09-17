# Contributing to Sonobe

Thanks for helping make interaction prototyping open to everyone. Bug reports, patches, recipes, and guides are all welcome, whether you write the change yourself or build it with an AI assistant.

## Setup

```bash
npm install
npm run dev        # editor in the browser (http://localhost:5199)
npm run desktop    # Electron app
npm test           # unit tests (Vitest)
npm run typecheck
npm run e2e        # Playwright end-to-end tests
```

Node 22.18+ is required. Node 24 is what CI uses.

## Read this first

[ARCHITECTURE.md](ARCHITECTURE.md) is the contract. The most important rules:

1. **Every document change goes through `applyOps()`.** The UI, MCP tools, CLI, and scripts all use the same op engine, so every change can be undone, validated, and attributed.
2. **Declarations drive everything.** A patch type is declared once in `packages/patches/catalog/*.json`: ports, types, defaults, docs, and behavior. The runtime, inspector, picker, docs, and MCP schemas are generated from that declaration.
3. **The engine stays headless.** `@sonobe/engine` has no DOM. Anything visual belongs in `@sonobe/renderer` or `apps/editor`.
4. **Keep it deterministic.** Given the same document and the same input events, the engine must produce the same frames. Use `services.random()` and `services.now()`, never `Math.random()` or `Date.now()`, inside patches.

## Adding or fixing a patch

1. Find the entry in `packages/patches/catalog/<category>-<n>.json` and follow [CONVENTIONS.md](packages/patches/catalog/CONVENTIONS.md).
   - The `behavior` field is the implementation spec.
   - The `docs` field is what users read.
2. Implement it in `packages/patches/src/<category>/<type>.ts` with `definePatch(type, { state, evaluate })`, then add it to that category's `index.ts`.
3. Test it in `<type>.test.ts` with the harness in `@sonobe/engine/testing`. Cover pulses, loops (per-index state), and edge cases.
4. Regenerate the reference docs with `node packages/patches/scripts/generate-docs.ts`.

## Code style

- TypeScript, strict ESM. Relative imports use explicit `.ts`/`.tsx` extensions.
- Import types with `import type`. Don't use enums, namespaces, or parameter properties, because the code runs under Node type stripping.
- Keep doc comments short on public APIs and skip filler comments.
- Format with Prettier (`npm run format`).

## Clean-room policy

Sonobe reimplements interaction-prototyping concepts from public documentation and observable behavior.

- Don't contribute code, assets, icons, device imagery, or text copied from Origami Studio, Meta, Apple, or any other proprietary product.
- Describe behavior in your own words.
- Mention other products only to describe compatibility (for example, the `origami` mapping fields in the catalog).

## Pull requests

- Keep PRs focused. Update docs and tests alongside the code.
- `npm run typecheck && npm test` must pass.
- For UI changes, attach a screenshot or short recording.
- Be kind. People of every experience level contribute here, and helping beginners is part of the mission.
