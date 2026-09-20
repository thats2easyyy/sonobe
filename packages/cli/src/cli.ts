/**
 * The `sonobe` command: new, validate, fmt, outline, describe, sim, and mcp (relay or headless).
 * runCli takes injectable IO so commands run in-process in tests. Node only.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { parseArgs, type ParseArgsConfig } from "node:util";
import {
  didYouMean,
  didYouMeanText,
  getDiagnostics,
  getOutline,
  joinPath,
  ProjectFormatError,
  serializeDocument,
  staleProjectFiles,
  type Diagnostic,
} from "@sonobe/core";
import { createNodeFs, loadProjectFromDisk, saveProjectToDisk } from "@sonobe/core/node";
import { createPatchRegistry } from "@sonobe/patches";
import {
  createHeadlessHost,
  describeLayerType,
  describePatchType,
  parseSimEvents,
  patchTypeData,
  serveStdioHost,
  summaryText,
  TEMPLATES,
  traceTable,
  type SimEvent,
} from "@sonobe/mcp";
import pkg from "../package.json" with { type: "json" };
import { runRelay, sonobeHome, type TextSink } from "./relay.ts";

export const VERSION: string = (pkg as { version?: string }).version ?? "0.0.0";

/** A path for hints: relative when it stays under cwd, absolute otherwise. */
function displayPath(cwd: string, dir: string): string {
  const rel = path.relative(cwd, dir);
  if (!rel) return ".";
  return rel.startsWith("..") || path.isAbsolute(rel) ? dir : rel;
}

export interface CliIo {
  stdout: TextSink;
  stderr: TextSink;
  stdin: Readable;
  env: Record<string, string | undefined>;
  cwd: string;
  fetch: typeof fetch;
}

export const HELP = `sonobe ${VERSION}: build interaction prototypes with layers and patches.

Usage: sonobe <command> [options]

Commands:
  new <dir>              Create a project folder (--template blank|photo-zoom)
  validate <dir>         Check files and diagnostics; exits 1 when there are errors
  fmt <dir>              Rewrite project files in canonical form (--check to only report)
  outline <dir>          Print the compact outline of a project
  describe <type>        Describe a patch type or layer type
  sim <dir>              Simulate input and trace values over time
  mcp                    Connect Claude to the running Sonobe app (stdio relay)
  mcp --headless <dir>   Serve a project folder over MCP without the app

Options:
  -h, --help             Show help (also: sonobe <command> --help)
  -v, --version          Print the version

Examples:
  sonobe new "Photo Zoom.sonobe" --template photo-zoom
  sonobe sim "Photo Zoom.sonobe" --events tap.json --trace @photo.scale --duration 800
  claude mcp add --scope user sonobe -- sonobe mcp
`;

const COMMAND_HELP: Record<string, string> = {
  new: `Usage: sonobe new <dir> [--template blank|photo-zoom] [--name <name>] [--device <preset>]

Creates a project folder you can open in Sonobe or edit with Claude.
  --template   ${TEMPLATES.map((t) => `${t.id} (${t.description})`).join("\n               ")}
  --name       Project name (default: the folder name)
  --device     Device preset, e.g. iphone-17-pro (default), iphone-se, android-large, desktop`,
  validate: `Usage: sonobe validate <dir> [--strict] [--json]

Loads the project (schema and format checks), then runs diagnostics.
Exits 1 when there are errors (or warnings, with --strict).
  --strict     Treat warnings as failures
  --json       Print a JSON report`,
  fmt: `Usage: sonobe fmt <dir> [--check]

Rewrites every file in canonical form (sorted keys, one-line leaf objects, trailing newline).
  --check      Report files that would change and exit 1 instead of writing`,
  outline: `Usage: sonobe outline <dir> [--component <id>] [--detail compact|normal|full]

Prints the compact text projection: layers with non-default props and links, then patches in dataflow order.`,
  describe: `Usage: sonobe describe <type> [--full] [--json]

Describes a patch type (ports, defaults, pairings, examples) or a layer type (props, outputs).
  --full       Include advanced ports, docs and evaluation behavior
  --json       Print the declaration as JSON`,
  sim: `Usage: sonobe sim <dir> --trace <addresses> [--events <file>] [--duration <ms>] [--fps 60|120] [--seed <n>] [--rows <n>] [--json]

Starts a deterministic simulation, dispatches the events, and prints every traced value per frame with a summary.
  --trace      Comma-separated addresses, e.g. @photo.scale,zoom_spring.output
  --events     JSON file: [{ "kind": "tap", "target": "@photo", "atMs": 0 }, ...] (or { "events": [...] })
  --duration   Milliseconds to trace (default 1000)
  --rows       Rows to print, evenly sampled (default 40; 0 prints every frame)
  --json       Print the full trace as JSON`,
  mcp: `Usage: sonobe mcp
       sonobe mcp --headless <dir> [--no-autosave]

Without --headless: a stdio relay to the running Sonobe app. It reads ~/.sonobe/mcp.json
(SONOBE_HOME overrides the folder) and forwards MCP messages with the app's token. It tells the
app which session it is (the client's name and CLAUDE_PROJECT_DIR, or its working folder), so
Connect Claude lists connected sessions.

With --headless: serves a project folder directly (editing, simulation, saving, and screenshots
drawn without the app).
Changes are saved after every edit unless --no-autosave.

Claude Code:     claude mcp add --scope user sonobe -- sonobe mcp
                 (--scope user: every project gets the tools, not just the current folder)
Claude Desktop:  install integrations/claude-desktop (see its README)`,
};

class UsageError extends Error {
  readonly command: string | undefined;

  constructor(message: string, command?: string) {
    super(message);
    this.name = "UsageError";
    this.command = command;
  }
}

function parse<T extends ParseArgsConfig["options"]>(command: string, args: string[], options: T) {
  try {
    return parseArgs({
      args,
      options: { help: { type: "boolean", short: "h" }, ...options },
      allowPositionals: true,
      strict: true,
    });
  } catch (err) {
    throw new UsageError(
      err instanceof Error ? err.message.replace(/^.*?: /, "") : String(err),
      command,
    );
  }
}

function requireDir(command: string, positionals: string[], cwd: string): string {
  const dir = positionals[0];
  if (!dir) throw new UsageError("Pass a project folder.", command);
  if (positionals.length > 1)
    throw new UsageError(
      `Unexpected argument "${positionals[1]}". Quote paths that contain spaces.`,
      command,
    );
  return path.resolve(cwd, dir);
}

async function loadOrReport(
  dir: string,
  io: CliIo,
): Promise<Awaited<ReturnType<typeof loadProjectFromDisk>> | undefined> {
  try {
    return await loadProjectFromDisk(dir);
  } catch (err) {
    if (err instanceof ProjectFormatError) {
      io.stderr.write(`${err.message}\n`);
      if (!existsSync(path.join(dir, "project.json")))
        io.stderr.write(`Create a project with: sonobe new "${path.basename(dir)}"\n`);
      return undefined;
    }
    throw err;
  }
}

function diagnosticLine(d: Diagnostic): string {
  const where = [d.component, ...d.itemIds].join("/") + (d.port ? `.${d.port}` : "");
  return `${d.severity.padEnd(7)} ${d.code.padEnd(22)} ${where}  ${d.message}`;
}

async function cmdNew(args: string[], io: CliIo): Promise<number> {
  const { values, positionals } = parse("new", args, {
    template: { type: "string" },
    name: { type: "string" },
    device: { type: "string" },
  });
  if (values.help) return help("new", io);
  const dir = requireDir("new", positionals, io.cwd);
  const host = createHeadlessHost();
  try {
    const created = await host.createDocument({
      path: dir,
      ...(values.template ? { template: values.template } : {}),
      ...(values.name ? { name: values.name } : {}),
      ...(values.device ? { device: values.device } : {}),
    });
    io.stdout.write(
      `Created "${created.name}" at ${dir}${values.template ? ` from the ${values.template} template` : ""}.\n\nNext:\n  sonobe outline "${displayPath(io.cwd, dir)}"\n  sonobe mcp --headless "${displayPath(io.cwd, dir)}"   (let Claude edit it)\n`,
    );
    return 0;
  } catch (err) {
    const e = err as { message?: string; hint?: string };
    io.stderr.write(`${e.message ?? String(err)}\n${e.hint ? `${e.hint}\n` : ""}`);
    return 1;
  } finally {
    await host.close();
  }
}

async function cmdValidate(args: string[], io: CliIo): Promise<number> {
  const { values, positionals } = parse("validate", args, {
    strict: { type: "boolean" },
    json: { type: "boolean" },
  });
  if (values.help) return help("validate", io);
  const dir = requireDir("validate", positionals, io.cwd);
  let doc;
  try {
    doc = await loadProjectFromDisk(dir);
  } catch (err) {
    if (!(err instanceof ProjectFormatError)) throw err;
    if (values.json)
      io.stdout.write(
        `${JSON.stringify({ ok: false, formatError: { code: err.code, message: err.message, issues: err.issues } }, null, 2)}\n`,
      );
    else io.stderr.write(`${err.message}\n`);
    return 1;
  }
  const diagnostics = getDiagnostics(doc, createPatchRegistry());
  const totals = { errors: 0, warnings: 0, info: 0 };
  for (const d of diagnostics)
    totals[d.severity === "error" ? "errors" : d.severity === "warning" ? "warnings" : "info"]++;
  const failed = totals.errors > 0 || (values.strict === true && totals.warnings > 0);
  if (values.json) {
    io.stdout.write(`${JSON.stringify({ ok: !failed, totals, diagnostics }, null, 2)}\n`);
    return failed ? 1 : 0;
  }
  const order = { error: 0, warning: 1, info: 2 };
  for (const d of [...diagnostics].sort((a, b) => order[a.severity] - order[b.severity])) {
    io.stdout.write(`${diagnosticLine(d)}\n`);
    const fix = d.suggestions?.[0];
    if (fix && d.severity !== "info") io.stdout.write(`        fix: ${fix.description}\n`);
  }
  io.stdout.write(
    `${doc.project.name}: ${totals.errors} error${totals.errors === 1 ? "" : "s"}, ${totals.warnings} warning${totals.warnings === 1 ? "" : "s"}, ${totals.info} info${failed ? "" : " · OK"}\n`,
  );
  return failed ? 1 : 0;
}

async function cmdFmt(args: string[], io: CliIo): Promise<number> {
  const { values, positionals } = parse("fmt", args, { check: { type: "boolean" } });
  if (values.help) return help("fmt", io);
  const dir = requireDir("fmt", positionals, io.cwd);
  const doc = await loadOrReport(dir, io);
  if (!doc) return 1;
  if (values.check) {
    const fs = createNodeFs();
    const files = serializeDocument(doc);
    const changed: string[] = [];
    for (const [rel, text] of Object.entries(files)) {
      const at = joinPath(dir, rel);
      if (!(await fs.exists(at)) || (await fs.readText(at)) !== text) changed.push(rel);
    }
    // The same rule `sonobe fmt` removes stale files by, so the check and the real run agree.
    for (const rel of await staleProjectFiles(fs, dir, files)) changed.push(`${rel} (stale)`);
    if (!changed.length) {
      io.stdout.write("Already formatted.\n");
      return 0;
    }
    io.stdout.write(
      `Would reformat:\n${changed.map((f) => `  ${f}`).join("\n")}\nRun: sonobe fmt "${displayPath(io.cwd, dir)}"\n`,
    );
    return 1;
  }
  const r = await saveProjectToDisk(dir, doc);
  if (!r.written.length && !r.removed.length) io.stdout.write("Already formatted.\n");
  else
    io.stdout.write(
      `${r.written.length ? `Formatted:\n${r.written.map((f) => `  ${f}`).join("\n")}\n` : ""}${r.removed.length ? `Removed stale files:\n${r.removed.map((f) => `  ${f}`).join("\n")}\n` : ""}`,
    );
  return 0;
}

async function cmdOutline(args: string[], io: CliIo): Promise<number> {
  const { values, positionals } = parse("outline", args, {
    component: { type: "string" },
    detail: { type: "string" },
  });
  if (values.help) return help("outline", io);
  const dir = requireDir("outline", positionals, io.cwd);
  const detail = values.detail ?? "normal";
  if (!["compact", "normal", "full"].includes(detail))
    throw new UsageError(`--detail must be compact, normal or full (got "${detail}").`, "outline");
  const doc = await loadOrReport(dir, io);
  if (!doc) return 1;
  if (values.component !== undefined && !doc.components[values.component]) {
    io.stderr.write(
      `There's no component "${values.component}".${didYouMeanText(didYouMean(values.component, Object.keys(doc.components)))}\n`,
    );
    return 1;
  }
  io.stdout.write(
    `${getOutline(doc, values.component, { detail: detail as "compact" | "normal" | "full", registry: createPatchRegistry() })}\n`,
  );
  return 0;
}

async function cmdDescribe(args: string[], io: CliIo): Promise<number> {
  const { values, positionals } = parse("describe", args, {
    full: { type: "boolean" },
    json: { type: "boolean" },
  });
  if (values.help) return help("describe", io);
  const type = positionals[0];
  if (!type)
    throw new UsageError(
      "Pass a patch type or layer type, e.g. popAnimation or rectangle.",
      "describe",
    );
  const registry = createPatchRegistry();
  const spec = registry.patches.get(type);
  if (spec) {
    io.stdout.write(
      values.json
        ? `${JSON.stringify(patchTypeData(registry, spec), null, 2)}\n`
        : `${describePatchType(registry, spec, { detail: values.full ? "full" : "standard" })}\n`,
    );
    return 0;
  }
  const layer = registry.layers.get(type);
  if (layer) {
    io.stdout.write(
      values.json
        ? `${JSON.stringify(layer, null, 2)}\n`
        : `${describeLayerType(layer, values.full ? "full" : "standard")}\n`,
    );
    return 0;
  }
  const candidates = [
    ...[...registry.patches.values()].map((s) => ({
      value: s.type,
      aliases: [s.name, ...(s.aliases ?? [])],
    })),
    ...[...registry.layers.values()].map((s) => ({ value: s.type, aliases: [s.name] })),
  ];
  io.stderr.write(
    `There's no patch or layer type "${type}".${didYouMeanText(didYouMean(type, candidates))}\nSearch the library in Sonobe's patch picker, or ask Claude to use list_patch_types.\n`,
  );
  return 1;
}

async function cmdSim(args: string[], io: CliIo): Promise<number> {
  const { values, positionals } = parse("sim", args, {
    events: { type: "string" },
    trace: { type: "string" },
    duration: { type: "string" },
    fps: { type: "string" },
    seed: { type: "string" },
    rows: { type: "string" },
    json: { type: "boolean" },
  });
  if (values.help) return help("sim", io);
  const dir = requireDir("sim", positionals, io.cwd);
  if (!values.trace)
    throw new UsageError(
      "Pass --trace with the values to watch, e.g. --trace @photo.scale.",
      "sim",
    );
  const targets = values.trace
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const number = (name: string, raw: string | undefined, fallback: number) => {
    if (raw === undefined) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0)
      throw new UsageError(`--${name} must be a number (got "${raw}").`, "sim");
    return n;
  };
  const durationMs = number("duration", values.duration, 1000);
  const fps = number("fps", values.fps, 60);
  if (fps !== 60 && fps !== 120) throw new UsageError("--fps must be 60 or 120.", "sim");
  let events: SimEvent[] = [];
  if (values.events) {
    const file = path.resolve(io.cwd, values.events);
    let json: unknown;
    try {
      json = JSON.parse(await readFile(file, "utf8"));
    } catch (err) {
      io.stderr.write(
        `Couldn't read events from ${file}: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      return 1;
    }
    const parsed = parseSimEvents(json);
    if (!parsed.ok) {
      io.stderr.write(`${file} has invalid events: ${parsed.message}\n`);
      return 1;
    }
    events = parsed.events;
  }
  const host = createHeadlessHost();
  try {
    await host.openDocument(dir);
    const state = await host.sim.reset({
      fps: fps as 60 | 120,
      seed: number("seed", values.seed, 1),
    });
    const r = await host.sim.trace(state.simId, { targets, durationMs, events, advance: true });
    if (values.json) {
      io.stdout.write(
        `${JSON.stringify({ targets: r.targets, times: r.times, values: r.values, summaries: r.summaries, events: r.events, issues: [...state.issues, ...r.issues] }, null, 2)}\n`,
      );
      return 0;
    }
    const rows = number("rows", values.rows, 40);
    for (const e of r.events)
      for (const w of e.warnings) io.stderr.write(`event ${e.index} (${e.kind}): ${w}\n`);
    io.stdout.write(
      `${traceTable(r.times, r.targets, r.values, rows === 0 ? r.times.length : rows).text}\n\nSummaries:\n${r.targets.map((t) => `  ${t}: ${summaryText(r.summaries[t] ?? null)}`).join("\n")}\n`,
    );
    for (const issue of [...state.issues, ...r.issues])
      io.stderr.write(
        `runtime ${issue.severity}${issue.patchId ? ` (${issue.patchId})` : ""}: ${issue.message}\n`,
      );
    return 0;
  } catch (err) {
    const e = err as { message?: string; hint?: string };
    io.stderr.write(`${e.message ?? String(err)}\n${e.hint ? `${e.hint}\n` : ""}`);
    return 1;
  } finally {
    await host.close();
  }
}

/**
 * SIGINT and SIGTERM stop the relay like stdin closing does. Claude Code ends stdio servers with
 * SIGINT, and without this the relay died before its goodbye, so the session stayed listed for 75 s.
 * A second signal still kills the process.
 */
function stopOnSignals(): { signal: AbortSignal; dispose(): void } {
  const controller = new AbortController();
  const stop = () => controller.abort();
  const signals = ["SIGINT", "SIGTERM"] as const;
  for (const name of signals) process.once(name, stop);
  return {
    signal: controller.signal,
    dispose() {
      for (const name of signals) process.removeListener(name, stop);
      // stdin is still open when a signal stopped the relay; let the process exit.
      if (controller.signal.aborted) process.stdin.destroy();
    },
  };
}

async function cmdMcp(args: string[], io: CliIo): Promise<number> {
  const { values, positionals } = parse("mcp", args, {
    headless: { type: "string" },
    "no-autosave": { type: "boolean" },
  });
  if (values.help) return help("mcp", io);
  if (positionals.length)
    throw new UsageError(
      `Unexpected argument "${positionals[0]}". Did you mean --headless "${positionals[0]}"?`,
      "mcp",
    );
  if (values.headless === undefined) {
    const signals = io.stdin === process.stdin ? stopOnSignals() : null;
    try {
      return await runRelay({
        home: sonobeHome(io.env),
        stdin: io.stdin,
        stdout: io.stdout,
        stderr: io.stderr,
        fetch: io.fetch,
        env: io.env,
        cwd: io.cwd,
        version: VERSION,
        ...(signals ? { stop: signals.signal } : {}),
      });
    } finally {
      signals?.dispose();
    }
  }
  const dir = path.resolve(io.cwd, values.headless);
  const autosave = !values["no-autosave"];
  const host = createHeadlessHost({ autosave });
  try {
    await host.openDocument(dir);
  } catch (err) {
    const e = err as { message?: string; hint?: string };
    io.stderr.write(`sonobe mcp: ${e.message ?? String(err)}\n${e.hint ? `${e.hint}\n` : ""}`);
    return 1;
  }
  const handle = serveStdioHost(host, {
    version: VERSION,
    onError: (error) => io.stderr.write(`sonobe mcp: ${error.message}\n`),
  });
  io.stderr.write(
    `sonobe mcp: serving ${dir} headless (${autosave ? "changes save automatically" : "call save_document to write changes"})\n`,
  );
  await new Promise<void>((resolve) => {
    io.stdin.once("end", resolve);
    io.stdin.once("close", resolve);
  });
  await handle.close();
  await host.close();
  return 0;
}

function help(command: string | undefined, io: CliIo): number {
  io.stdout.write(`${command && COMMAND_HELP[command] ? COMMAND_HELP[command] : HELP}\n`);
  return 0;
}

const COMMANDS: Record<string, (args: string[], io: CliIo) => Promise<number>> = {
  new: cmdNew,
  validate: cmdValidate,
  fmt: cmdFmt,
  outline: cmdOutline,
  describe: cmdDescribe,
  sim: cmdSim,
  mcp: cmdMcp,
};

/** Run the CLI; resolves to the exit code. */
export async function runCli(
  argv: readonly string[],
  overrides: Partial<CliIo> = {},
): Promise<number> {
  const io: CliIo = {
    stdout: overrides.stdout ?? process.stdout,
    stderr: overrides.stderr ?? process.stderr,
    stdin: overrides.stdin ?? process.stdin,
    env: overrides.env ?? process.env,
    cwd: overrides.cwd ?? process.cwd(),
    fetch: overrides.fetch ?? fetch,
  };
  const [command, ...rest] = argv;
  if (!command || command === "-h" || command === "--help" || command === "help")
    return help(rest[0], io);
  if (command === "-v" || command === "--version" || command === "version") {
    io.stdout.write(`${VERSION}\n`);
    return 0;
  }
  const run = COMMANDS[command];
  if (!run) {
    io.stderr.write(
      `Unknown command "${command}".${didYouMeanText(didYouMean(command, Object.keys(COMMANDS)))}\n\n${HELP}`,
    );
    return 2;
  }
  try {
    return await run(rest, io);
  } catch (err) {
    if (err instanceof UsageError) {
      io.stderr.write(`${err.message}\n\n${COMMAND_HELP[err.command ?? ""] ?? HELP}\n`);
      return 2;
    }
    io.stderr.write(`sonobe ${command}: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}
