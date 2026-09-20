/**
 * What clients actually see. Claude Code gives the model only structuredContent when a result
 * has it, so structuredContent must carry the complete text; and SDK clients validate
 * structuredContent against outputSchema (the v1 SDK even for isError results), so teaching
 * errors must fit the declared schema instead of surfacing as -32602.
 */

import path from "node:path";
import { Client as ClientV1 } from "@modelcontextprotocol/sdk/client/index.js";
import { Client as ClientV2 } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TOOL_NAMES, type ToolName } from "./server.ts";
import { tempProject, type TempProject } from "./test-helpers.ts";
import { serveStdioHost, type StdioHandle } from "./transports.ts";

type Result = {
  content?: { type: string; text?: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

interface AnyClient {
  listTools(): Promise<{ tools: { name: string; outputSchema?: Record<string, unknown> }[] }>;
  callTool(params: { name: string; arguments?: Record<string, unknown> }): Promise<unknown>;
  close(): Promise<void>;
}

async function connect(
  project: TempProject,
  kind: "v1" | "v2-legacy" | "v2-modern",
): Promise<{ client: AnyClient; handle: StdioHandle }> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const handle = serveStdioHost(project.host, { version: "0.1.0-test", transport: serverSide });
  const client =
    kind === "v1"
      ? new ClientV1({ name: "claude-code", version: "2.1.273" })
      : new ClientV2(
          { name: "claude-code", version: "2.1.273" },
          kind === "v2-modern" ? { versionNegotiation: { mode: "auto" } } : {},
        );
  await (client as { connect(t: unknown): Promise<void> }).connect(clientSide);
  return { client: client as unknown as AnyClient, handle };
}

const textOf = (r: Result) =>
  (r.content ?? [])
    .map((c) => (c.type === "text" ? (c.text ?? "") : ""))
    .filter(Boolean)
    .join("\n");

let project: TempProject;

beforeAll(async () => {
  project = await tempProject({ template: "photo-zoom" });
});

afterAll(async () => {
  await project.cleanup();
});

describe("structuredContent carries the complete payload", () => {
  it("for every tool, success or error", async () => {
    const { client, handle } = await connect(project, "v1");
    await client.listTools();
    const seen = new Set<ToolName>();
    let simId = "";
    const call = async (name: ToolName, args: Record<string, unknown> = {}) => {
      seen.add(name);
      const r = (await client.callTool({ name, arguments: args })) as Result;
      const text = textOf(r);
      expect(text, `${name} has text`).not.toBe("");
      if (r.structuredContent !== undefined)
        expect(r.structuredContent.text, `${name} structuredContent.text`).toBe(text);
      if ((r.content ?? []).some((c) => c.type === "image"))
        expect(r.structuredContent, `${name} keeps images visible`).toBeUndefined();
      return r;
    };
    await call("get_guide", { topic: "start-here" });
    await call("get_guide", { topic: "nope" });
    await call("list_patch_types", { query: "spring" });
    await call("describe_patch_types", { types: ["popAnimation"] });
    await call("describe_layer_types", { types: ["rectangle"] });
    await call("list_value_types");
    await call("list_examples", { query: "swipe" });
    await call("get_example", { id: "01-tap-to-grow", detail: "ops" });
    await call("get_example", { id: "nope" });
    await call("list_documents");
    await call("open_document", { ref: "test" });
    await call("create_document", {
      path: path.join(project.dir, "Other.sonobe"),
      open: false,
    });
    await call("get_document_info");
    await call("save_document");
    const outline = await call("get_outline", { detail: "compact" });
    expect(outline.structuredContent!.text).toContain("patch zoomed switch");
    await call("get_layers");
    await call("get_patches");
    await call("get_items", { ids: ["photo", "zoomed"] });
    await call("find", { patchType: "interaction" });
    await call("get_selection");
    await call("get_diagnostics");
    const explained = await call("explain", {});
    expect((explained.structuredContent!.text as string).length).toBeGreaterThan(40);
    await call("apply_ops", { ops: [{ op: "addLayer", layer: { type: "oval", name: "Dot" } }] });
    await call("add_layers", { layers: [{ type: "oval", name: "Badge" }] });
    await call("add_patches", { patches: [{ type: "switch", name: "Other Switch" }] });
    await call("connect", { connections: [{ from: "zoom_scale.output", to: "@dot.scale" }] });
    await call("set_values", { updates: [{ target: "zoom_spring.bounciness", value: 6 }] });
    await call("update_layers", { updates: [{ ids: ["dot"], props: { opacity: 0.5 } }] });
    await call("rename", { updates: [{ id: "dot", name: "Dot Two" }] });
    await call("create_component", { name: "Badge Piece", layerIds: ["badge"] });
    await call("tidy_graph");
    const knobs = await call("set_knobs", {
      presets: [{ name: "Proposal" }, { name: "Shipped app", locked: true }],
      knobs: [{ name: "Zoom Bounce", connect: ["zoom_spring.bounciness"], values: { "Shipped app": 3 } }],
    });
    expect(knobs.isError).not.toBe(true);
    await call("get_knobs");
    await call("apply_knob_preset", { preset: "Shipped app" });
    await call("import_design", {
      capture: {
        format: "sonobe.design-capture",
        version: 1,
        source: { kind: "html" },
        viewport: { width: 402, height: 874 },
        root: { kind: "frame", name: "Receipt", box: [0, 0, 402, 200], fill: "#FFFFFFFF", children: [] },
        images: {},
      },
    });
    await call("delete_items", { ids: ["other_switch"] });
    const reset = await call("sim_reset");
    simId = reset.structuredContent!.simId as string;
    await call("sim_dispatch", { simId, events: [{ kind: "tap", target: "@photo" }] });
    await call("sim_step", { simId, until: "idle" });
    const trace = await call("sim_trace", { simId, targets: ["@photo.scale"], durationMs: 300 });
    expect(trace.structuredContent!.text).toContain("t_ms");
    await call("sim_get_values", { simId, targets: ["@photo.scale"] });
    const override = await call("sim_override", {
      simId,
      set: [{ target: "@caption.opacity", value: 0 }],
    });
    expect(override.structuredContent!.text).toContain("@caption.opacity = 0");
    await call("get_screenshot");
    await call("begin_work", { intent: "checking payloads", ids: ["photo"] });
    await call("finish_work");
    await call("reveal", { ids: ["photo"] });
    await call("restart_viewer");
    await call("list_history");
    await call("undo");
    expect([...seen].sort()).toEqual([...TOOL_NAMES].sort());
    await client.close();
    await handle.close();
  });
});

/** Failing calls on tools that declare an outputSchema, one per shape of failure. */
const FAILURES: { name: ToolName; args: Record<string, unknown>; code?: string }[] = [
  { name: "get_document_info", args: { docId: "nope" }, code: "unknown_document" },
  { name: "open_document", args: { ref: "/definitely/not/a/project" }, code: "not_a_project" },
  { name: "sim_step", args: { simId: "sim_99" }, code: "unknown_sim" },
  { name: "sim_get_values", args: { simId: "sim_99", targets: ["@photo.scale"] } },
  { name: "sim_trace", args: { simId: "sim_99", targets: ["@photo.scale"], durationMs: 100 } },
  { name: "sim_dispatch", args: { simId: "sim_99", events: [{ kind: "tap", target: "@photo" }] } },
  { name: "sim_reset", args: { docId: "nope" }, code: "unknown_document" },
  {
    name: "sim_override",
    args: { simId: "sim_99", set: [{ target: "@photo.opacity", value: 0 }] },
    code: "unknown_sim",
  },
  { name: "apply_ops", args: { ops: [{ op: "addPatch", patch: { type: "swich" } }] } },
  { name: "add_patches", args: { patches: [{ type: "popAnimaton" }] } },
  {
    name: "connect",
    args: { connections: [{ from: "zoomed.on", to: "zoom_scale.progress" }] },
    code: "already_connected",
  },
  {
    name: "set_values",
    args: { updates: [{ target: "zoom_scale.progress", value: 1 }] },
    code: "all_ignored",
  },
  { name: "update_layers", args: { updates: [{ ids: ["nope"], props: { opacity: 1 } }] } },
  { name: "rename", args: { updates: [{ id: "nope", name: "Nope" }] } },
  { name: "tidy_graph", args: { component: "nope" } },
  { name: "set_knobs", args: { knobs: [{ name: "Label", connect: ["zoomed.flip"] }] }, code: "invalid_knob" },
  { name: "apply_knob_preset", args: { preset: "Nope" }, code: "unknown_knob_preset" },
  {
    name: "apply_ops",
    args: { ops: [{ op: "rename", id: "photo", name: "Hero" }], dryrun: true },
    code: "unknown_field",
  },
  { name: "sim_step", args: { simID: "sim_1" }, code: "unknown_field" },
];

describe("teaching errors survive output-schema validation", () => {
  for (const kind of ["v1", "v2-legacy", "v2-modern"] as const) {
    it(`with the ${kind} client`, async () => {
      const { client, handle } = await connect(project, kind);
      const { tools } = await client.listTools();
      for (const tool of tools.filter((t) => t.outputSchema)) {
        expect(tool.outputSchema, tool.name).toMatchObject({ type: "object" });
        expect((tool.outputSchema as { anyOf?: unknown[] }).anyOf, tool.name).toHaveLength(2);
      }
      for (const failure of FAILURES) {
        expect(
          tools.find((t) => t.name === failure.name)?.outputSchema,
          `${failure.name} declares an outputSchema`,
        ).toBeDefined();
        const r = (await client.callTool({
          name: failure.name,
          arguments: failure.args,
        })) as Result;
        expect(r.isError, `${failure.name}: ${textOf(r)}`).toBe(true);
        expect(textOf(r), failure.name).toMatch(/Error |Nothing changed|failed/);
        expect(r.structuredContent?.ok, failure.name).toBe(false);
        expect(r.structuredContent?.text, failure.name).toBe(textOf(r));
        if (failure.code)
          expect(
            (r.structuredContent?.error as { code?: string } | undefined)?.code,
            failure.name,
          ).toBe(failure.code);
      }
      // Successful results still validate against the same schemas.
      const info = (await client.callTool({ name: "get_document_info", arguments: {} })) as Result;
      expect(info.structuredContent).toMatchObject({ docId: "test" });
      await client.close();
      await handle.close();
    });
  }
});
