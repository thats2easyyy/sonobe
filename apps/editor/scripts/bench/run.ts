// The editor benchmark: boot and first opens, then the interaction suite on a bundled example and on
// a generated stress document, in headless Chromium against the production build. Prints a table.
//
//   npm run bench -w @sonobe/editor                          build this checkout into a temp folder, serve it, measure it
//   npm run bench -w @sonobe/editor -- --baseline <url>      also measure another build, taking turns, and print the difference
//
//   --url <url>         measure a build that's already served (`npx vite preview --outDir <dist> --port <port>`)
//   --reps <n>          runs of each measurement (default 5)
//   --only <parts>      boot, example or stress, comma separated (default all three)
//   --filter <names>    only interactions whose name contains one of these, comma separated ("scrub,dragLayer")
//   --throttle <rate>   Chromium's CPU throttle; 4 stands in for a machine about four times slower
//   --profile <dir>     also write one CPU profile per interaction (open them in DevTools)
//   --trace             also print the timeline's busiest events per interaction (Layerize, Layout, Paint)
//   --json <file>       write every run's numbers
//   --port <port>       where to serve this checkout's build (default 5290)
//
// It runs by hand, not in CI: the numbers depend on the machine and on what else it's doing. Compare
// builds with --baseline in one run, never against numbers from another day.
import type { Browser } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build, preview } from "vite";
import { BOOT_RUNS, type Sample } from "./boot.ts";
import { runScenario, type DocumentName, type Run } from "./interactions.ts";
import { launch, REPO, stats } from "./lib.ts";

const OPTIONS = ["baseline", "url", "reps", "only", "filter", "throttle", "profile", "trace", "json", "port"];
const args = process.argv.slice(2);
const stray = args.find((arg) => arg.startsWith("--") && !OPTIONS.includes(arg.slice(2)));
if (stray !== undefined) {
  console.error(`"${stray}" isn't an option of the benchmark. It takes ${OPTIONS.map((name) => `--${name}`).join(", ")}${/\s/.test(stray) ? ", each as an argument of its own" : ""}.`);
  process.exit(1);
}
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => (flag(name) ? args[args.indexOf(`--${name}`) + 1] : undefined);
const list = (name: string) => (option(name) ?? "").split(",").filter(Boolean);

const reps = Number(option("reps") ?? 5);
const only = list("only");
const parts = (["boot", "example", "stress"] as const).filter((p) => only.length === 0 || only.includes(p));
const unknown = only.filter((p) => !["boot", "example", "stress"].includes(p));
if (unknown.length || !(reps >= 1)) {
  console.error(unknown.length ? `--only takes boot, example or stress, not "${unknown.join(", ")}".` : "--reps takes a number of runs, 1 or more.");
  process.exit(1);
}

interface Build {
  name: string;
  url: string;
}

/** Build the editor into a temp folder and serve it. Never apps/editor/dist, which a running Sonobe may be showing. */
async function serveThisCheckout(): Promise<{ url: string; close: () => Promise<void> }> {
  const root = path.join(REPO, "apps/editor");
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "sonobe-bench-"));
  console.log("Building the editor…");
  try {
    await build({ root, logLevel: "warn", build: { outDir, emptyOutDir: true } });
  } catch {
    fs.rmSync(outDir, { recursive: true, force: true });
    console.error("The editor didn't build, so there's nothing to measure. Run `npm run build -w @sonobe/editor` to see why.");
    process.exit(1);
  }
  const server = await preview({ root, logLevel: "warn", build: { outDir }, preview: { port: Number(option("port") ?? 5290), host: "localhost" } });
  const url = server.resolvedUrls?.local[0]?.replace(/\/$/, "");
  const close = async () => {
    await server.close();
    fs.rmSync(outDir, { recursive: true, force: true });
  };
  if (!url) {
    await close();
    throw new Error("The preview server didn't start. Serve a build yourself and pass it with --url.");
  }
  return { url, close };
}

// ---------- Tables ----------

const round = (x: number, digits = 0) => (Number.isFinite(x) ? x.toFixed(digits) : "–");
const spread = (values: number[], digits = 0) => {
  const s = stats(values);
  return s.n === 0 ? "–" : s.n === 1 ? round(s.median, digits) : `${round(s.median, digits)} [${round(s.min, digits)}–${round(s.max, digits)}]`;
};
const change = (before: number[], after: number[]) => {
  const a = stats(before).median;
  const b = stats(after).median;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return "";
  if (a === 0) return b === 0 ? "0" : `+${round(b)}`;
  const pct = Math.round((100 * (b - a)) / a);
  return `${pct > 0 ? "+" : ""}${pct}%`;
};

function printTable(rows: string[][]): void {
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length)));
  for (const row of rows) console.log(row.map((cell, i) => cell.padEnd(widths[i]!)).join("   ").trimEnd());
}

function printBoot(builds: Build[], samples: Map<string, Sample[]>): void {
  const names = [...new Set([...samples.values()].flatMap((list) => list.flatMap((s) => Object.keys(s))))];
  const column = (build: Build, name: string) => (samples.get(build.name) ?? []).map((s) => s[name]).filter((v): v is number => v !== undefined);
  const digits = (name: string) => (/KB/.test(name) ? 0 : 1);
  console.log(`\nBoot and first opens: median [min–max] of ${reps} runs, in ms`);
  printTable([
    ["", ...builds.map((b) => b.name), ...(builds.length > 1 ? ["change"] : [])],
    ...names.map((name) => [name, ...builds.map((b) => spread(column(b, name), digits(name))), ...(builds.length > 1 ? [change(column(builds[0]!, name), column(builds[1]!, name))] : [])]),
  ]);
}

function printInteractions(doc: DocumentName, builds: Build[], runs: Map<string, Map<string, Run[]>>): void {
  const keys = [...new Set(builds.flatMap((b) => [...(runs.get(b.name)?.keys() ?? [])]))];
  const of = (build: Build, key: string) => runs.get(build.name)?.get(key) ?? [];
  const perSecond = (build: Build, key: string) => of(build, key).map((r) => (1000 * r.taskMs) / r.wallMs);
  const pooled = (build: Build, key: string) => of(build, key).flatMap((r) => r.deltas);
  const over25 = (build: Build, key: string) => {
    const deltas = pooled(build, key);
    return deltas.length ? `${round((100 * deltas.filter((d) => d > 25).length) / deltas.length, 1)}%` : "–";
  };
  const long = (build: Build, key: string) => String(of(build, key).reduce((n, r) => n + r.longTasks, 0));
  const median = (pick: (r: Run) => number) => (build: Build, key: string) => round(stats(of(build, key).map(pick)).median);
  const each = (cell: (build: Build, key: string) => string, key: string) => builds.map((b) => cell(b, key)).join(" / ");
  const title = doc === "example" ? "examples/02-like-toggle" : "the stress document (302 patches, 302 layers)";
  console.log(`\nInteractions on ${title}: ${reps} run${reps === 1 ? "" : "s"} each${builds.length > 1 ? `, ${builds.map((b) => b.name).join(" / ")}` : ""}`);
  printTable([
    ["", ...builds.map((b) => `main thread ms/s, ${b.name}`), ...(builds.length > 1 ? ["change"] : []), "rAF/s", "steps/s", "frame p95 ms", "frames over 25 ms", "long tasks"],
    ...keys.map((key) => [
      key,
      ...builds.map((b) => spread(perSecond(b, key))),
      ...(builds.length > 1 ? [change(perSecond(builds[0]!, key), perSecond(builds[1]!, key))] : []),
      each(median((r) => r.rafPerSec), key),
      each(median((r) => r.stepsPerSec), key),
      each((b, k) => round(stats(pooled(b, k)).p95, 1), key),
      each(over25, key),
      each(long, key),
    ]),
  ]);
  if (!flag("trace")) return;
  for (const key of keys) for (const b of builds) console.log(`  ${key}, ${b.name}: ${(of(b, key)[0]?.trace ?? []).map((e) => `${e.name} ${e.msPerSec}`).join(", ")} (ms/s)`);
}

// ---------- Run ----------

let served: Awaited<ReturnType<typeof serveThisCheckout>> | null = null;
let browser: Browser | null = null;
try {
  const url = option("url")?.replace(/\/$/, "") ?? (served = await serveThisCheckout()).url;
  const baseline = option("baseline")?.replace(/\/$/, "");
  const builds: Build[] = [...(baseline ? [{ name: "baseline", url: baseline }] : []), { name: "this build", url }];
  browser = await launch();
  const output: Record<string, unknown> = { when: new Date().toISOString(), reps, builds };

  if (parts.includes("boot")) {
    const samples = new Map<string, Sample[]>(builds.map((b) => [b.name, []]));
    // One throwaway load each, then the builds take turns.
    for (const b of builds) await BOOT_RUNS[0]!(browser, b.url);
    for (let i = 0; i < reps; i++) for (const measure of BOOT_RUNS) for (const b of builds) samples.get(b.name)!.push(await measure(browser, b.url));
    printBoot(builds, samples);
    output.boot = Object.fromEntries(samples);
  }

  for (const doc of ["example", "stress"] as const) {
    if (!parts.includes(doc)) continue;
    const runs = new Map<string, Map<string, Run[]>>(builds.map((b) => [b.name, new Map()]));
    const scenario = { filter: list("filter"), throttle: Number(option("throttle") ?? 1), profileDir: option("profile") ? path.resolve(option("profile")!) : null, trace: flag("trace") };
    // Alone, one page runs each interaction `reps` times. Against a baseline, the builds take turns:
    // a fresh page each per round, every gesture once to warm up and once recorded.
    const rounds = builds.length > 1 ? reps : 1;
    for (let round = 0; round < rounds; round++) {
      for (const b of builds) {
        const first = round === 0;
        const result = await runScenario(browser, b.url, doc, { ...scenario, reps: builds.length > 1 ? 1 : reps, warm: builds.length > 1, label: b.name.replace(/\s+/g, "-"), profileDir: first ? scenario.profileDir : null, trace: first && scenario.trace });
        for (const [key, list] of result) runs.get(b.name)!.set(key, [...(runs.get(b.name)!.get(key) ?? []), ...list]);
      }
    }
    printInteractions(doc, builds, runs);
    output[doc] = Object.fromEntries([...runs].map(([name, byKey]) => [name, Object.fromEntries(byKey)]));
  }

  const json = option("json");
  if (json) fs.writeFileSync(path.resolve(json), JSON.stringify(output));
} finally {
  await browser?.close();
  await served?.close();
}
