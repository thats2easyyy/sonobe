/**
 * The user docs agree with the code: README.md, ARCHITECTURE.md, ROADMAP.md, the guides and the example
 * READMEs. Each test checks one kind of claim against the thing it describes, so docs can't drift from
 * the product without a test failing.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VALUE_TYPES, type PatchSpec } from "@sonobe/core";
import { estimateSettleTime, fromBouncinessSpeed, fromDurationBounce, sampleSpringCurve, SPRING_PRESETS, summarizeSeries, toResponseDampingFraction } from "@sonobe/engine";
import { createHeadlessHost } from "@sonobe/mcp";
import { BEHAVIORS, SPECS } from "@sonobe/patches";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCli } from "./cli.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const lines = (text: string) => text.split("\n");
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "release", "research", "screenshots", "test-results", "playwright-report", "build", "_probe"]);

/** Every Markdown file people read, outside dependencies, build output and research notes. */
function markdownFiles(dir = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...markdownFiles(rel));
    } else if (entry.name.endsWith(".md")) out.push(rel);
  }
  return out;
}

/** From the first heading that starts with `title` to the next heading at the same level or above. */
function section(markdown: string, title: string): string {
  const all = lines(markdown);
  let fenced = false;
  let start = -1;
  let level = 0;
  for (let i = 0; i < all.length; i++) {
    const line = all[i]!;
    if (line.startsWith("```")) fenced = !fenced;
    if (fenced) continue;
    const heading = /^(#{1,6}) (.*)$/.exec(line);
    if (!heading) continue;
    if (start < 0) {
      if (heading[2]!.startsWith(title)) {
        start = i;
        level = heading[1]!.length;
      }
    } else if (heading[1]!.length <= level) return all.slice(start, i).join("\n");
  }
  if (start < 0) throw new Error(`No heading starts with "${title}"`);
  return all.slice(start).join("\n");
}

/** Table rows as trimmed cells, without separator rows. */
function tableRows(markdown: string): string[][] {
  return lines(markdown)
    .filter((line) => line.startsWith("|") && !/^\|[-| :]+\|$/.test(line))
    .map((line) => line.slice(1, line.endsWith("|") ? -1 : undefined).split("|").map((cell) => cell.trim()));
}

function fences(markdown: string): { lang: string; body: string }[] {
  return [...markdown.matchAll(/^```(\w*)\n([\s\S]*?)^```$/gm)].map((m) => ({ lang: m[1]!, body: m[2]! }));
}

async function cli(cwd: string, args: string[]) {
  let stdout = "";
  let stderr = "";
  const code = await runCli(args, { cwd, env: {}, stdout: { write: (s: string) => (stdout += s) }, stderr: { write: (s: string) => (stderr += s) } });
  return { code, stdout, stderr };
}

const GUIDES = readdirSync(path.join(ROOT, "docs/guides"))
  .filter((f) => f.endsWith(".md"))
  .sort()
  .map((f) => ({ file: `docs/guides/${f}`, text: read(`docs/guides/${f}`) }));

const EXAMPLES = readdirSync(path.join(ROOT, "examples"), { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(path.join(ROOT, "examples", e.name, "project.json")))
  .map((e) => e.name)
  .sort();

const EXAMPLE_DOCS = [{ file: "examples/README.md", text: read("examples/README.md") }, ...EXAMPLES.map((name) => ({ file: `examples/${name}/README.md`, text: read(`examples/${name}/README.md`) }))];

const SPEC_LIST = Object.values(SPECS);
const SPEC_BY_NAME = new Map(SPEC_LIST.map((spec) => [spec.name, spec]));
/** Longest first, so "Spring Animation" wins over any shorter name inside it. */
const PATCH_NAMES = [...SPEC_BY_NAME.keys()].sort((a, b) => b.length - a.length);
const portNames = (spec: PatchSpec) => [...spec.inputs, ...spec.outputs].map((p) => p.name);

// ---------------------------------------------------------------------------------------------------
// Claude setup
// ---------------------------------------------------------------------------------------------------

const CLI_PKG = JSON.parse(read("packages/cli/package.json")) as { private?: boolean; bin: Record<string, string>; scripts: Record<string, string> };
const CLI_BUNDLE = `packages/cli/${CLI_PKG.bin.sonobe!.replace(/^\.\//, "")}`;
const APP_CLI = "/Applications/Sonobe.app/Contents/Resources/cli/sonobe";

/** `claude mcp add [--scope s] <name> -- <launch>` lines: their scope, name and launch command. */
const claudeAdds = (text: string) =>
  [...text.matchAll(/^\s*claude mcp add (?:(?:--scope|-s) (\S+) )?(\S+) -- (.+)$/gm)].map((m) => ({ scope: m[1] ?? "local", name: m[2]!, launch: m[3]!.trim() }));
const claudeCommands = (text: string) => claudeAdds(text).map((c) => c.launch);
const tokens = (command: string) => [...command.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]!);

describe("Claude setup in the README and guide 11", () => {
  const docs = [
    { file: "README.md", text: read("README.md") },
    { file: "docs/guides/11-working-with-claude.md", text: read("docs/guides/11-working-with-claude.md") },
  ];

  it("never runs an npm package called sonobe, which the project doesn't publish", () => {
    expect(CLI_PKG.private).toBe(true);
    const files = markdownFiles();
    expect(files.length).toBeGreaterThan(50);
    expect(files.filter((file) => /\bnpx (?:-y |--yes )?sonobe\b/.test(read(file)))).toEqual([]);
  });

  it("launches the relay with something the documented steps install", () => {
    const builder = read("apps/desktop/electron-builder.yml");
    const desktopBuild = read("apps/desktop/scripts/build.mjs");
    for (const { file, text } of docs) {
      const commands = claudeCommands(text);
      expect(commands.length, file).toBeGreaterThan(0);
      for (const command of commands) {
        const [program = "", ...args] = tokens(command);
        expect(args, `${file}: ${command}`).toContain("mcp");
        if (program === "node") {
          expect(args[0], `${file}: ${command}`).toMatch(new RegExp(`^/.+/${escapeRe(CLI_BUNDLE)}$`));
          expect(text, file).toContain("npm run build -w @sonobe/cli");
          expect(CLI_PKG.scripts.build).toBeDefined();
        } else if (program === APP_CLI) {
          expect(builder).toMatch(/- from: dist\/cli\s+to: cli/);
          expect(desktopBuild).toContain('path.join(out, "sonobe")');
        } else if (program === "sonobe") {
          expect(text, `${file} runs a bare sonobe`).toContain("npm link -w @sonobe/cli");
        } else {
          throw new Error(`${file}: "${command}" launches ${program}, which no documented step installs`);
        }
      }
    }
    expect(read("README.md")).toContain("claude --plugin-dir ./integrations/claude-code");
    expect(existsSync(path.join(ROOT, "integrations/claude-code/.mcp.json"))).toBe(true);
  });

  it("installs the relay for every project, and headless servers for one", () => {
    const files = [...docs, { file: "integrations/claude-code/README.md", text: read("integrations/claude-code/README.md") }, { file: "packages/cli/src/cli.ts", text: read("packages/cli/src/cli.ts") }];
    for (const { file, text } of files) {
      const adds = claudeAdds(text);
      expect(adds.length, file).toBeGreaterThan(0);
      for (const add of adds) {
        // A local entry works in one folder only, which is how a session elsewhere ended up without Sonobe.
        if (add.launch.includes("--headless")) expect([add.name, add.scope], `${file}: ${add.launch}`).toEqual(["sonobe-headless", "local"]);
        else expect([add.name, add.scope], `${file}: ${add.launch}`).toEqual(["sonobe", "user"]);
      }
    }
  });

  it("gives Claude Desktop full paths, since it doesn't read the shell's PATH", () => {
    let servers = 0;
    for (const { file, text } of docs) {
      for (const { body } of fences(text).filter((f) => f.lang === "json")) {
        const config = JSON.parse(body) as { mcpServers?: Record<string, { command: string }> };
        for (const [name, server] of Object.entries(config.mcpServers ?? {})) {
          servers++;
          expect(server.command, `${file} ${name}`).toMatch(/^(\/|[A-Za-z]:\\)/);
        }
      }
    }
    expect(servers).toBeGreaterThan(0);
  });

  it("describes the Connect Claude screen and the extension as they are", () => {
    const dialog = read("apps/editor/src/panels/connect/ConnectClaudeDialog.tsx");
    const desktopReadme = read("integrations/claude-desktop/README.md");
    for (const { file, text } of [...docs, { file: "ARCHITECTURE.md", text: read("ARCHITECTURE.md") }]) {
      if (!dialog.includes("Install in Claude Desktop")) expect(text, file).not.toContain("Install in Claude Desktop");
      expect(text, file).not.toMatch(/one-click/i);
      expect(text, file).not.toMatch(/Sonobe gives you its extension/);
      for (const m of text.matchAll(/^(node integrations\/claude-desktop\/build\.ts|npx @anthropic-ai\/mcpb pack .+)$/gm)) expect(desktopReadme, m[1]).toContain(m[1]);
    }
  });

  it("says headless servers take screenshots, as the headless host does", () => {
    expect(createHeadlessHost().capabilities.screenshots).toBe(true);
    const headless = lines(section(read("ARCHITECTURE.md"), "10.")).find((line) => line.includes("--headless <project>"))!;
    expect(headless).toMatch(/screenshots drawn from the SceneFrame/);
    expect(read("docs/guides/11-working-with-claude.md")).toContain("with editing, simulation, saving and screenshots");
    const stale = markdownFiles().filter((file) => /Screenshots need the app|no screenshots\)|aren't available in headless mode/.test(read(file)));
    expect(stale).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------
// Patch and port names
// ---------------------------------------------------------------------------------------------------

interface PortReference {
  where: string;
  patch: string;
  port: string;
}

/** "Gesture . Velocity X" and "Switch's On output": a patch picker name, " . " or "'s ", then a Title Case run. */
function portReferences(file: string, text: string): PortReference[] {
  const out: PortReference[] = [];
  lines(text).forEach((line, index) => {
    const taken: [number, number][] = [];
    for (const name of PATCH_NAMES) {
      const re = new RegExp(`(?<![\\w'])${escapeRe(name)}(?: \\. |'s )([A-Z][\\w/]*(?: [A-Z0-9][\\w/]*)*)`, "g");
      for (const m of line.matchAll(re)) {
        const at = m.index!;
        if (taken.some(([a, b]) => at < b && at + name.length > a)) continue;
        taken.push([at, at + name.length]);
        out.push({ where: `${file}:${index + 1} ${line.trim()}`, patch: name, port: m[1]! });
      }
    }
  });
  return out;
}

/** True when the run starts with a port name at a word boundary ("Velocity X" names Velocity's X part). */
function namesPort(spec: PatchSpec, run: string): boolean {
  const names = portNames(spec);
  const words = run.split(" ");
  for (let k = words.length; k > 0; k--) if (names.includes(words.slice(0, k).join(" "))) return true;
  return false;
}

/** Origami's names that Sonobe renamed and people still type by habit: patches with digits, ports with a slash. */
const ORIGAMI_ONLY_PATCHES = SPEC_LIST.map((spec) => spec.origami?.name).filter((name): name is string => !!name && !SPEC_BY_NAME.has(name) && /\d/.test(name));
const ORIGAMI_SLASH_PORTS = Object.values(BEHAVIORS).flatMap((behavior) => Object.values(behavior.origamiPorts ?? {}).filter((label) => label.includes("/")));
const STALE_NAMES = [...new Set([...ORIGAMI_ONLY_PATCHES, ...ORIGAMI_SLASH_PORTS.flatMap((label) => [label, label.replace(/ \/ /g, "/")]), "If Else", "Loop Index"])];

/** Title Case, allowing the small words patch names use ("Sample and Hold", "Pulse on Change"). */
const isNameLike = (text: string) => text.split(" ").every((word) => /^[A-Z0-9/&]/.test(word) || ["and", "on", "of", "to", "at"].includes(word));

function examplePatchTypes(example: string): Map<string, string> {
  const dir = path.join(ROOT, "examples", example, "components");
  const types = new Map<string, string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const component = JSON.parse(readFileSync(path.join(dir, file), "utf8")) as { patches?: Record<string, { type: string }> };
    for (const [id, patch] of Object.entries(component.patches ?? {})) types.set(id, patch.type);
  }
  return types;
}

describe("patch and port names in the guides and example READMEs", () => {
  it("Patch . Port and Patch's Port name real ports", () => {
    const refs = [...GUIDES, ...EXAMPLE_DOCS].flatMap((doc) => portReferences(doc.file, doc.text));
    expect(refs.length).toBeGreaterThan(40);
    expect(refs.filter((r) => !namesPort(SPEC_BY_NAME.get(r.patch)!, r.port)).map((r) => `${r.patch} → "${r.port}" at ${r.where}`)).toEqual([]);
  });

  it("use Sonobe's names, keeping Origami's only where Origami is the subject", () => {
    expect(STALE_NAMES).toEqual(expect.arrayContaining(["Delay 1", "On/Off"]));
    const hits: string[] = [];
    for (const doc of [...GUIDES, ...EXAMPLE_DOCS]) {
      lines(doc.text).forEach((line, index) => {
        if (/Origami/.test(line)) return;
        // Guide 10's tables put Origami's names in the first column.
        const checked = doc.file.endsWith("10-coming-from-origami.md") && line.startsWith("|") ? line.split("|").slice(2).join("|") : line;
        for (const name of STALE_NAMES) if (new RegExp(`(?<![\\w/])${escapeRe(name)}(?![\\w/])`).test(checked)) hits.push(`"${name}" at ${doc.file}:${index + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it("guide 10 maps each Origami patch to the Sonobe patch that declares that Origami name", () => {
    const rows = tableRows(section(read("docs/guides/10-coming-from-origami.md"), "Patches")).slice(1);
    let mapped = 0;
    const wrong: string[] = [];
    for (const [origami = "", sonobe = ""] of rows) {
      for (const origamiName of origami.split(", ")) {
        const spec = SPEC_LIST.find((s) => s.origami?.name === origamiName);
        if (!spec) continue;
        mapped++;
        const ok = sonobe === "Same names" ? spec.name === origamiName : sonobe.includes(spec.name);
        if (!ok) wrong.push(`${origamiName} is ${spec.name} in Sonobe, but the guide says "${sonobe}"`);
      }
    }
    expect(mapped).toBeGreaterThan(20);
    expect(wrong).toEqual([]);
  });

  it("example READMEs call each patch by its type's picker name", () => {
    const wrong: string[] = [];
    let checked = 0;
    for (const example of EXAMPLES) {
      const types = examplePatchTypes(example);
      const nameOf = (id: string) => {
        const type = types.get(id);
        return type ? SPECS[type]?.name : undefined;
      };
      const text = read(`examples/${example}/README.md`);
      for (const row of tableRows(text)) {
        const ids = [...(row[0] ?? "").matchAll(/`([A-Za-z_]\w*)`/g)].map((m) => m[1]!);
        if (!ids.length || !ids.every((id) => nameOf(id))) continue;
        const said = (row[1] ?? "").split(", ").map((s) => s.trim());
        if (said.length !== ids.length && said.length !== 1) continue;
        // A label like "Loop and friends" summarizes several patches instead of naming one.
        if (said.length === 1 && ids.length > 1 && !isNameLike(said[0]!)) continue;
        ids.forEach((id, i) => {
          checked++;
          const claimed = said.length === 1 ? said[0]! : said[i]!;
          if (claimed !== nameOf(id)) wrong.push(`${example}: \`${id}\` is ${nameOf(id)}, the table says ${claimed}`);
        });
      }
      for (const m of text.matchAll(/\b[Aa]n? ([A-Z][^()`\n]*?)(?: patch)? \(`([A-Za-z_]\w*)`/g)) {
        const expected = nameOf(m[2]!);
        if (!expected) continue;
        checked++;
        // "a Switch named Liked (`liked`)" and "an Interaction on Heart Button (`tap_heart`)" qualify the name.
        if (m[1] !== expected && !m[1]!.startsWith(`${expected} `)) wrong.push(`${example}: "${m[0]}", but \`${m[2]}\` is ${expected}`);
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(wrong).toEqual([]);
  });

  it("the examples index lists real patches", () => {
    const rows = tableRows(read("examples/README.md")).filter((row) => /^\d+$/.test(row[0] ?? ""));
    expect(rows.length).toBe(EXAMPLES.length);
    // "Scroll (paging)" names Scroll with a setting.
    const names = (row: string[]) => row.at(-1)!.split(", ").map((name) => name.replace(/ \([^)]*\)$/, ""));
    expect(rows.flatMap((row) => names(row).filter((name) => !SPEC_BY_NAME.has(name)).map((name) => `${row[1]}: ${name}`))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------
// ARCHITECTURE.md and ROADMAP.md
// ---------------------------------------------------------------------------------------------------

const helpCommands = (stdout: string) => [...new Set(stdout.split("Commands:\n")[1]!.split("\n\n")[0]!.split("\n").map((line) => line.trim().split(/\s+/)[0]!))];

describe("ARCHITECTURE.md contract lists", () => {
  const architecture = read("ARCHITECTURE.md");

  it("§2 lists the CLI's commands and the docs folders that exist", async () => {
    const help = await cli(ROOT, ["--help"]);
    const commands = helpCommands(help.stdout);
    expect(commands).toEqual(["new", "validate", "fmt", "outline", "describe", "sim", "mcp"]);
    const cliLine = lines(architecture).find((line) => /cli\/\s+@sonobe\/cli/.test(line))!;
    expect(/CLI: ([^(]+)/.exec(cliLine)![1]!.split(",").map((s) => s.trim())).toEqual(commands);
    const roadmap = read("ROADMAP.md");
    expect(/CLI: `sonobe ([^`]+)`/.exec(roadmap)![1]!.split(" | ")).toEqual(commands);

    const docsLine = lines(architecture).find((line) => line.startsWith("└── docs/"))!;
    const listed = [...docsLine.matchAll(/(\w+)\//g)].map((m) => m[1]!).filter((name) => name !== "docs");
    const folders = readdirSync(path.join(ROOT, "docs"), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    expect([...listed].sort()).toEqual([...folders].sort());
  });

  it("§4 lists every value type", () => {
    const list = /`(number, boolean, [^`]+)`/.exec(section(architecture, "4."))![1]!;
    expect(list.split(", ")).toEqual([...VALUE_TYPES]);
  });

  it("§5.5 lists the gesture patches' real outputs", () => {
    const line = lines(section(architecture, "5.5")).find((l) => l.startsWith("- Recognizers:"))!;
    const listed = [...line.matchAll(/(\w+) \(([\w/]+)\)/g)];
    expect(listed.map((m) => m[1])).toEqual(["interaction", "gesture", "drag"]);
    for (const [, type, ports] of listed) expect(ports!.split("/"), type).toEqual(SPECS[type!]!.outputs.map((p) => p.key));
  });

  it("§6 shows definePatch as it's called, with the spec in the catalog", () => {
    const six = section(architecture, "6.");
    expect(six).not.toMatch(/definePatch\(\{/);
    const [catalog, module] = fences(six);
    const normalize = (s: string) => lines(s).map((l) => l.trim()).filter(Boolean).join("\n");
    expect(normalize(read("packages/patches/src/state/switch.ts"))).toContain(normalize(module!.body));
    const spec = SPECS.switch!;
    const field = (key: string) => new RegExp(`"${key}": ("[^"]*"|\\d+)`).exec(catalog!.body)?.[1];
    expect([field("type"), field("name"), field("category"), field("tier"), field("summary")]).toEqual([JSON.stringify(spec.type), JSON.stringify(spec.name), JSON.stringify(spec.category), String(spec.tier), JSON.stringify(spec.summary)]);
    const ports = [...catalog!.body.matchAll(/\{ "key": "(\w+)", "name": "([^"]+)", "type": "(\w+)"/g)].map((m) => [m[1], m[2], m[3]]);
    expect(ports).toEqual([...spec.inputs, ...spec.outputs].map((p) => [p.key, p.name, p.type]));
  });
});

describe("ROADMAP.md", () => {
  const roadmap = read("ROADMAP.md");

  it("checks off finished work, and says what's left of anything partial", () => {
    for (const stage of ["Stage 1", "Stage 2", "Stage 3"]) {
      const items = lines(section(roadmap, stage)).filter((line) => /^- \[[ x]\]/.test(line));
      expect(items.length, stage).toBeGreaterThan(3);
      for (const item of items) if (item.startsWith("- [ ]")) expect(item, stage).toMatch(/\(partial: .+\)/);
    }
  });

  it("counts the example projects that exist", () => {
    expect(/Examples: (\d+) canonical recipes/.exec(roadmap)![1]).toBe(String(EXAMPLES.length));
    expect(existsSync(path.join(ROOT, "apps/editor/src/panels/connect/ConnectClaudeDialog.tsx"))).toBe(true);
    expect(existsSync(path.join(ROOT, "apps/editor/src/panels/learn/LearnDrawer.tsx"))).toBe(true);
  });

  it("is what the README's status line points to", () => {
    const status = lines(read("README.md")).find((line) => line.startsWith("> **Status"))!;
    expect(status).toContain("ROADMAP.md");
    expect(status).not.toMatch(/early development|being built/);
  });
});

// ---------------------------------------------------------------------------------------------------
// Spring and trace numbers
// ---------------------------------------------------------------------------------------------------

describe("spring numbers in guides 01 and 05", () => {
  const guide05 = read("docs/guides/05-springs-and-feel.md");
  const traced = (config: ReturnType<typeof fromBouncinessSpeed>) => {
    const curve = sampleSpringCurve(config, 3, 60);
    return summarizeSeries(curve.times, curve.values)!;
  };

  it("the tuning table matches the engine, timed from when the spring starts", () => {
    const rows = tableRows(section(guide05, "Tuning by feel")).filter((row) => /^\d+ \/ \d+$/.test(row[0]!));
    expect(rows.length).toBe(4);
    for (const [pair = "", response, damping = "", overshoot, settles] of rows) {
      const [bounciness, speed] = pair.split(" / ").map(Number);
      const config = fromBouncinessSpeed(bounciness!, speed!);
      const perceptual = toResponseDampingFraction(config);
      const summary = traced(config);
      expect(response, pair).toBe(`${perceptual.response.toFixed(2)} s`);
      expect(damping, pair).toBe(perceptual.dampingFraction.toFixed(damping.split(".")[1]!.length));
      expect(overshoot, pair).toBe(`${Math.round(summary.overshoot * 100)}%`);
      expect(settles, pair).toBe(`${summary.settleTime!.toFixed(2)} s`);
    }
  });

  it("the presets table matches SPRING_PRESETS", () => {
    const rows = tableRows(section(guide05, "Start with a preset")).slice(1);
    expect(rows.map((row) => row[0])).toEqual(SPRING_PRESETS.map((preset) => preset.name));
    for (const [name, , , response, damping, overshoot = "", settles] of rows) {
      const preset = SPRING_PRESETS.find((p) => p.name === name)!;
      const summary = traced(fromDurationBounce(preset.duration, preset.bounce));
      const percent = summary.overshoot * 100;
      expect(response, name).toBe(`${preset.duration} s`);
      expect(Number(damping), name).toBeCloseTo(1 - preset.bounce, 9);
      if (overshoot === "0%") expect(percent, name).toBeLessThan(0.05);
      else if (overshoot === "under 1%") expect(percent, name).toBeLessThan(1);
      else expect(Math.abs(percent - Number(/^about (\d+)%$/.exec(overshoot)![1])), name).toBeLessThanOrEqual(1);
      expect(settles, name).toBe(`about ${summary.settleTime!.toFixed(2)} s`);
    }
  });

  it("quotes the inspector's stricter settle time", () => {
    expect(guide05).toContain(`It shows ${estimateSettleTime(fromBouncinessSpeed(5, 10))!.toFixed(2)} s for the default spring`);
  });

  it("guide 01's curve samples match Pop Animation's default spring", () => {
    const rows = tableRows(section(read("docs/guides/01-first-prototype.md"), "Pop Animation")).filter((row) => /^\d\.\d s$/.test(row[0]!));
    const curve = sampleSpringCurve(fromBouncinessSpeed(5, 10), 0.6, 60);
    expect(rows.length).toBe(6);
    for (const [time = "", output] of rows) expect(output, time).toBe(curve.values[Math.round(parseFloat(time) * 60)]!.toFixed(2));
  });
});

describe("the trace in guide 09", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "sonobe-docs-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("is real `sonobe sim` output for guide 01's card", async () => {
    expect((await cli(dir, ["new", "card.sonobe", "--template", "blank"])).code).toBe(0);
    const main = path.join(dir, "card.sonobe", "components", "main.json");
    const component = JSON.parse(await readFile(main, "utf8")) as Record<string, unknown>;
    component.layers = [{ id: "card", type: "rectangle", name: "Card", props: { position: [16, 120], size: [358, 220], cornerRadius: 24, color: "#FFFFFFFF", scale: { link: "grow.output" } }, children: [] }];
    component.patches = {
      tap_card: { type: "interaction", inputs: { layer: { layer: "card" } }, ui: { x: 40, y: 60 } },
      toggle: { type: "switch", inputs: { flip: { link: "tap_card.tap" } }, ui: { x: 220, y: 60 } },
      pop: { type: "popAnimation", inputs: { number: { link: "toggle.on" }, bounciness: 5, speed: 10 }, ui: { x: 400, y: 60 } },
      grow: { type: "transition", typeParam: "number", inputs: { progress: { link: "pop.output" }, start: 1, end: 1.08 }, ui: { x: 580, y: 60 } },
    };
    await writeFile(main, JSON.stringify(component, null, 2));
    await writeFile(path.join(dir, "tap.json"), JSON.stringify([{ kind: "tap", target: "@card", atMs: 0 }]));
    const sim = await cli(dir, ["sim", "card.sonobe", "--events", "tap.json", "--trace", "toggle.on,pop.output,@card.scale", "--duration", "1000", "--rows", "0"]);
    expect(sim.code, sim.stderr).toBe(0);

    const squash = (line: string) => line.trim().split(/\s+/).join(" ");
    const output = sim.stdout.split("\n").map(squash);
    const shown = fences(section(read("docs/guides/09-debugging.md"), "Ask for a trace"))[0]!.body.split("\n").map(squash).filter(Boolean);
    expect(shown.length).toBeGreaterThan(6);
    for (const line of shown) expect(output, line).toContain(line);

    const popSettle = /pop\.output: .*settled by (\d+) ms/.exec(sim.stdout)![1];
    expect(read("docs/guides/05-springs-and-feel.md")).toContain(`reads ${popSettle} ms there`);
  });
});
