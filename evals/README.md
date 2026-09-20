# Evals

How well does Claude build prototypes with Sonobe? Each eval case gives Claude Code a prompt and a start project, lets it work through Sonobe's MCP tools alone, then simulates the prototype it built and checks layer properties, the same way the examples' `test.json` files do. The checks never look at Claude's own patch ids or wiring, only at what the prototype does.

The runner records, for every run: pass or fail, how the session ended, turns, tokens, time, the tools Claude called, and every error code with whether Claude recovered after it. It writes them to `results.json` and a short `summary.md`.

These runs use your Claude account and take minutes each, so they aren't part of `npm test` or CI. Run them by hand when you change the tools, their descriptions, the guides or the server instructions, and compare the summaries. The runner's own code is tested in `npm test` (`evals/**/*.test.ts`), including a check that every case is fair: its start fails and its reference solution passes.

## Running

You need the built CLI (the MCP server Claude talks to) and Claude Code on your PATH, logged in:

```sh
npm run build -w @sonobe/cli
node evals/run.ts --list
node evals/run.ts --case study-smoke-read --model haiku            # one quick case
node evals/run.ts --case "retro-*" --model sonnet --runs 3          # the retro regressions, three times each
node evals/run.ts --model opus --jobs 3                             # everything, three at a time
```

| Option | Does |
|---|---|
| `--case <id>` | A case id, or a prefix ending in `*`. Repeat it or comma-separate. Default: every case. |
| `--model <name>` | The Claude model (`haiku`, `sonnet`, `opus`, or a full name). Default: Claude Code's. |
| `--runs <n>` | Runs per case (default 1). Claude isn't deterministic, so pass rates need several. |
| `--max-turns <n>`, `--timeout <s>` | The turn and time budget per run. Default: the case's own, else 50 turns and 600 s. |
| `--budget-usd <n>` | Stop a run past this estimated cost. |
| `--jobs <n>` | Runs at the same time (default 1). |
| `--client fake` | Play each case's reference solution instead of running Claude (see below). |
| `--check <dir>` | Check a project folder against one `--case`, without Claude. |
| `--sonobe <path>` | The Sonobe CLI to serve (default `packages/cli/dist/sonobe.mjs`; `packages/cli/src/main.ts` runs the sources). |
| `--claude <path>` | The `claude` command. |
| `--user-config` | Load your own Claude Code settings and `CLAUDE.md`. They're left out by default so runs on different machines compare. Skills stay off either way. |
| `--out <dir>`, `--keep` | Where results go (default `evals/results/<time>`, ignored by git), and keep each run's working folder. |

It exits 0 when every run passed, 1 when some failed, and 2 on a usage error. The import case renders its design with Playwright's Chromium (`npx playwright install chromium`).

### What a run does

1. Copies the case's start project, with its asset files, into a temporary folder and writes an `mcp.json` that starts `sonobe mcp --headless` on it.
2. Runs `claude -p` with the prompt on stdin, `--output-format stream-json`, `--mcp-config` with `--strict-mcp-config`, `--tools ""` (no files, shell, web or Skill tool: only Sonobe's tools), `--allowedTools mcp__sonobe`, `--disable-slash-commands` (no skills), `--no-session-persistence`, and the turn budget. The runner stops it at the time budget.
3. Opens the finished project with the headless host and runs the case's checks.
4. Saves the transcript and the finished project under `<results>/<case>/run-<n>/`, so you can open what Claude built in the app.

Cases built from an example also pass `--disallowedTools` for `list_examples` and `get_example`, so Claude can't copy the answer.

### Reading the results

`summary.md` has one row per run (or per case with `--runs`), the tool errors by code, and what failed in each run. `results.json` has everything: each run's checks with their numbers, the tools called, each error with its message, and Claude's final reply.

An error counts as **recovered** when the next call to the same tool succeeded, and **retried** when Claude called that tool again at all. That makes the teaching errors measurable: an error code with a low recovery rate needs a better message or hint. Codes are Sonobe's own (`unknown_ref`, `preset_locked`…), `invalid_params` for arguments the server's schema refused, and `client_invalid_input` when Claude Code refused a call before it reached Sonobe (arguments that weren't valid JSON).

## Cases

Each case is a folder in `evals/cases/`:

```text
evals/cases/retro-knob-presets/
├── case.json       what the case is, where it starts, what else to check, its budget
├── prompt.md       what the person says
├── start/          the start project, with fixed layer ids (open it in the app)
├── test.json       scenarios on layer properties
└── solution.json   a reference solution: the tool calls that solve it
```

The seed cases:

- `example-*`: the 16 examples with their patches removed, and a prompt written from each README. The layers are there and Claude builds the logic. For the Placemark Deck, that's the imported Discover screen with its four cards. Their checks are the example's own `test.json` expectations on layer properties.
- `study-*`: the tasks from the [usability study](../docs/research/ai-usability-study.md): read a prototype, a beginner's like button, a designer's bottom sheet, debugging a flick, and explaining a carousel before changing it.
- `retro-*`: regressions from the Placemark test session's retro: a looped deck that must survive its last card (no empty loops), copy 0 on top through Z Position, rebuilding a component in one batch without stale ports or `_2` ids, a Repeat count on a layer driven by its own press, knobs with two presets, and an import in dark mode followed by a press animation.

### case.json

| Field | Meaning |
|---|---|
| `title`, `about`, `tags` | What the case is and why it exists. |
| `start` | `{ "project": "start" }`, a folder in the case; or `{ "example": "01-tap-to-grow", "patches": false }`, an example's layers built from its recipe, after its design import when it starts from one (`patches` defaults to true: the whole example). Either can take `ops` to apply first, like unwiring an input for a debugging case. |
| `test` | `{ "example": "<folder>" }` adds that example's layer expectations to the case's own `test.json`. |
| `checks` | Facts about the finished document: `unchanged`; `interface` (a component's ports: `without` keys, exact `outputs` or `inputs` names); `keepsIds` (no removed id came back as `<id>_2`); `presets` (knob presets by name, `locked` when given). |
| `answer` | `{ "mentions": [["tap"], ["grow", "bigger"]] }`: the final reply has a word from each group. For explaining tasks. |
| `serve` | A file in the case folder served on 127.0.0.1 while the run lasts; `{{url}}` in the prompt is its address. |
| `budget` | `{ "maxTurns": 40, "timeoutSec": 600 }`. |
| `examples` | `true` lets Claude read the examples even when the case starts from one. |
| `allowErrorDiagnostics` | By default a finished document with error diagnostics fails. |

`test.json` has the format of the examples' tests ([examples/README.md](../examples/README.md#testjson)), with one rule: every target is a layer property (`@card.scale`, `@card.position#2`, `@card#1/badge.opacity`). A scenario fails on hit warnings and runtime issues too, such as an `empty_loop` warning. Name the numbers the checks read in the prompt, since a designer would give them.

### Adding a case

1. Make the start project in the app (or with Claude) and save it as `start/` in a new case folder. Give the layers the checks will read clear ids.
2. Write `prompt.md` the way a person would ask, with the numbers the checks need.
3. Write `test.json` and `case.json`.
4. Build the answer yourself and check it: `node evals/run.ts --case <id> --check <your project>`. Then save the calls that build it as `solution.json` (for example one `apply_ops` with its ops).
5. `npx vitest run evals` checks that the start fails, that `solution.json` passes, and that every layer the checks name exists.

## The fake client

`--client fake` plays each case's `solution.json` (or, for an example without its patches, the recipe's patch ops) over MCP against the same headless server, and writes a transcript shaped like Claude Code's. Every case should pass with it. Use it to try the runner, a new case, or a change to the checks without spending a Claude run.
