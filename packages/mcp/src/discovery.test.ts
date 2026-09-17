import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GUIDE_TOPICS } from "./guides.ts";
import { PROMPT_NAMES, TOOL_NAMES } from "./server.ts";
import { connectClient, tempProject, type TempProject, type TestClient } from "./test-helpers.ts";

let project: TempProject;
let client: TestClient;

beforeAll(async () => {
  project = await tempProject();
  client = await connectClient(project.host);
});

afterAll(async () => {
  await client.close();
  await project.cleanup();
});

describe("server surface", () => {
  it("lists every ARCHITECTURE §10 tool with accurate annotations", async () => {
    const { tools } = await client.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    const byName = new Map(tools.map((t) => [t.name, t]));
    for (const t of tools) {
      expect(t.annotations?.openWorldHint, t.name).toBe(false);
      expect(t.description?.length, t.name).toBeGreaterThan(40);
      expect(t.inputSchema.type).toBe("object");
    }
    for (const name of [
      "get_guide",
      "list_patch_types",
      "get_outline",
      "get_items",
      "find",
      "get_diagnostics",
      "explain",
      "list_history",
      "sim_get_values",
      "get_screenshot",
    ]) {
      expect(byName.get(name)!.annotations?.readOnlyHint, name).toBe(true);
    }
    for (const name of ["apply_ops", "set_values", "update_layers", "delete_items", "undo"]) {
      expect(byName.get(name)!.annotations, name).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
      });
    }
    for (const name of [
      "add_layers",
      "add_patches",
      "connect",
      "create_component",
      "create_document",
    ]) {
      expect(byName.get(name)!.annotations, name).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
      });
    }
    expect(byName.get("apply_ops")!.outputSchema).toBeDefined();
    expect(byName.get("sim_trace")!.outputSchema).toBeDefined();
  });

  it("sends workflow instructions", () => {
    const instructions = client.client.getInstructions() ?? "";
    expect(instructions).toContain('get_guide("start-here")');
    expect(instructions).toContain("get_document_info");
    expect(instructions).toContain("begin_work");
    expect(instructions).toContain("finish_work");
    expect(instructions).toMatch(/not raw ids/);
    expect(instructions).toContain("headless");
  });

  it("lists prompts and resource templates", async () => {
    const { prompts } = await client.client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual([...PROMPT_NAMES].sort());
    const { resourceTemplates } = await client.client.listResourceTemplates();
    expect(resourceTemplates.map((r) => r.uriTemplate).sort()).toEqual([
      "sonobe://documents/{docId}/diagnostics",
      "sonobe://documents/{docId}/outline",
      "sonobe://guides/{topic}",
      "sonobe://patches/{type}",
    ]);
    const { resources } = await client.client.listResources();
    expect(resources.some((r) => r.uri === "sonobe://patches/popAnimation")).toBe(true);
    expect(resources.some((r) => r.uri === "sonobe://guides/start-here")).toBe(true);
    const ref = await client.client.readResource({ uri: "sonobe://patches/popAnimation" });
    expect((ref.contents[0] as { text: string }).text).toContain("Pop Animation");
    const guide = await client.client.readResource({ uri: "sonobe://guides/gestures" });
    expect((guide.contents[0] as { text: string }).text).toMatch(/^# /);
  });
});

describe("discovery tools", () => {
  it("serves every guide topic and teaches unknown topics", async () => {
    for (const topic of GUIDE_TOPICS) {
      const r = await client.call("get_guide", { topic });
      expect(r.isError, topic).toBe(false);
      expect(r.text).toMatch(/^# /);
    }
    const bad = await client.call("get_guide", { topic: "animations" });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain('Did you mean "animation"');
  });

  it("searches patch types by intent", async () => {
    const r = await client.call("list_patch_types", { query: "spring", limit: 5 });
    expect(r.isError).toBe(false);
    const types = (r.structured.types as { type: string }[]).map((t) => t.type);
    expect(types.slice(0, 3)).toContain("popAnimation");
    expect(types).toContain("springAnimation");
    expect(r.text).toContain("pass cursor");
    const all = await client.call("list_patch_types", {
      category: "interaction",
      detail: "names",
      limit: 200,
    });
    expect(all.text).toContain("interaction (Interaction)");
    expect(all.text).not.toContain("popAnimation");
  });

  it("describes patch types with real ports and defaults", async () => {
    const r = await client.call("describe_patch_types", { types: ["popAnimation", "switch"] });
    expect(r.isError).toBe(false);
    expect(r.text).toContain("## popAnimation · Pop Animation");
    expect(r.text).toMatch(/bounciness: number = 5/);
    expect(r.text).toMatch(/flip: pulse/);
    expect(r.text).toContain("typeParam: number | point");
    const data = r.structured.types as { type: string; inputs: { key: string }[] }[];
    expect(data[0]!.inputs.map((p) => p.key)).toEqual(["number", "bounciness", "speed"]);

    const variadic = await client.call("describe_patch_types", { types: ["optionPicker"] });
    expect(variadic.text).toContain('"option0", "option1"');

    const typo = await client.call("describe_patch_types", { types: ["popAnimaton"] });
    expect(typo.isError).toBe(true);
    expect(typo.text).toContain('Did you mean "popAnimation"');
  });

  it("describes layer types and value types", async () => {
    const list = await client.call("describe_layer_types", {});
    expect(list.text).toContain("rectangle · Rectangle");
    const rect = await client.call("describe_layer_types", { types: ["rectangle"] });
    expect(rect.text).toContain("cornerRadius: number = 0");
    expect(rect.text).toContain("@layerId.key");
    const values = await client.call("list_value_types", {});
    expect(values.text).toContain("boolean → pulse: fires when it turns on");
    expect(values.text).toContain('{ "layer": "card" }');
  });
});
