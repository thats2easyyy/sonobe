/**
 * Every eval case is well formed and fair: it loads, its expectations name layers the start project
 * has, the untouched start fails its checks, and its reference solution passes them when played over
 * MCP against the headless host.
 */

import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { findLayer, type SonobeDocument } from "@sonobe/core";
import { createHeadlessHost, serveStdioHost } from "@sonobe/mcp";
import { createPatchRegistry } from "@sonobe/patches";
import { afterAll, describe, expect, it } from "vitest";
import {
  buildStartDocument,
  CASES_DIR,
  listCaseIds,
  loadCase,
  targetLayer,
  writeStartProject,
  type EvalCase,
} from "./lib/cases.ts";
import { checkProject, failureLines } from "./lib/checks.ts";
import { playSolution, solutionFor, type ToolResultLike } from "./lib/fake.ts";
import { serveFile } from "./lib/serve.ts";
import { summarizeSession } from "./lib/transcript.ts";

const registry = createPatchRegistry();
const ids = listCaseIds();
const temps: string[] = [];

afterAll(async () => {
  await Promise.all(temps.map((dir) => rm(dir, { recursive: true, force: true })));
});

/** The start saved the way the runner saves it. */
async function saveStart(evalCase: EvalCase, doc: SonobeDocument): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "sonobe-eval-test-"));
  temps.push(dir);
  const project = path.join(dir, "Prototype.sonobe");
  await writeStartProject(evalCase, doc, project);
  return project;
}

/** Every "@layer" an expectation or an event names. */
function namedLayers(evalCase: EvalCase): string[] {
  const names = new Set<string>();
  for (const s of evalCase.test?.scenarios ?? []) {
    for (const e of s.expect) names.add(targetLayer(e.target)!);
    for (const ev of s.events) {
      for (const t of [
        (ev as { target?: unknown }).target,
        (ev as { from?: unknown }).from,
        (ev as { to?: unknown }).to,
      ])
        if (typeof t === "string" && targetLayer(t)) names.add(targetLayer(t)!);
    }
  }
  return [...names].sort();
}

describe("eval cases", () => {
  it("has cases from the examples, the usability study and the retro", () => {
    expect(ids.filter((id) => id.startsWith("example-"))).toHaveLength(15);
    expect(ids.filter((id) => id.startsWith("study-")).length).toBeGreaterThanOrEqual(4);
    expect(ids.filter((id) => id.startsWith("retro-")).length).toBeGreaterThanOrEqual(6);
  });
});

for (const id of ids) {
  describe(id, () => {
    const evalCase = loadCase(path.join(CASES_DIR, id));

    it("names only layers the start project has", async () => {
      if (evalCase.serve) return; // Its layers come from the import.
      const start = await buildStartDocument(evalCase, registry);
      const root = start.components[start.project.root]!;
      expect(namedLayers(evalCase).filter((layer) => !findLayer(root.layers, layer))).toEqual([]);
    });

    it("saves its start project with every asset file", async () => {
      const start = await buildStartDocument(evalCase, registry);
      const project = await saveStart(evalCase, start);
      const missing = Object.values(start.assets)
        .map((asset) => asset.file)
        .filter((file) => !existsSync(path.join(project, "assets", file)));
      expect(missing, "asset records whose files the start doesn't have").toEqual([]);
    });

    it("fails its checks before Claude has done anything", async () => {
      const start = await buildStartDocument(evalCase, registry);
      const report = await checkProject(evalCase, await saveStart(evalCase, start), {
        registry,
        startDoc: start,
      });
      expect(report.pass, "the start already passes, so the case checks nothing").toBe(false);
    });

    it("passes its checks with the reference solution", async (ctx) => {
      const solution = solutionFor(evalCase);
      expect(solution, "add a solution.json").toBeDefined();
      const start = await buildStartDocument(evalCase, registry);
      const project = await saveStart(evalCase, start);
      const host = createHeadlessHost({ registry, autosave: true });
      await host.openDocument(project);
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      const handle = serveStdioHost(host, { version: "0.0.0-evals", transport: serverSide });
      const client = new Client({ name: "sonobe-evals-test", version: "1.0.0" });
      await client.connect(clientSide as never);
      const served = evalCase.serve
        ? await serveFile(path.join(evalCase.dir, evalCase.serve))
        : undefined;
      const events: Record<string, unknown>[] = [];
      try {
        await playSolution(
          async (name, args) =>
            (await client.callTool({ name, arguments: args })) as ToolResultLike,
          solution,
          served ? { url: served.url } : {},
          (e) => events.push(e),
        );
      } finally {
        await client.close();
        await handle.close();
        await host.close();
        await served?.close();
      }
      const session = summarizeSession(events);
      const unavailable = session.errors.find((e) => e.code === "design_capture_unavailable");
      if (unavailable)
        return ctx.skip(`Rendering the design needs Playwright's Chromium: ${unavailable.message}`);
      const failed = session.toolCalls.filter((c) => c.ok === false);
      expect(failed.map((c) => `${c.tool}: ${c.code} ${c.message}`)).toEqual([]);
      const report = await checkProject(evalCase, project, {
        registry,
        startDoc: start,
        answer: session.answer,
      });
      expect(report.pass, failureLines(report).join("\n")).toBe(true);
    });
  });
}
