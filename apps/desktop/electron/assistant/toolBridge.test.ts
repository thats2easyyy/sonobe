/**
 * The tool bridge against a real SonobeHost (HeadlessHost over a temp project): Sonobe's MCP tools run
 * in process, and edits are attributed to "Assistant" in history. The agent test at the end drives the
 * whole loop with a scripted Anthropic client (no network).
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHeadlessHost, TOOL_NAMES, type DesignCaptureRequest, type HeadlessHost, type HostCallControl } from "@sonobe/mcp";
import { createPatchRegistry } from "@sonobe/patches";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAssistantAgent } from "./agent.ts";
import type { AssistantEvent } from "./protocol.ts";
import { ASSISTANT_AUTHOR_NAME, createMcpToolBridge, describeToolInput, describeToolResult, toAnthropicTools, toolResultContent, type ToolBridge } from "./toolBridge.ts";
import { scriptedClient } from "./testing.ts";

let dir: string;
let host: HeadlessHost;
let bridge: ToolBridge;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "sonobe-assistant-"));
  host = createHeadlessHost({ registry: createPatchRegistry() });
  await host.createDocument({ path: path.join(dir, "Assistant Test.sonobe"), template: "photo-zoom" });
  bridge = createMcpToolBridge({ host, version: "0.1.0-test" });
});

afterEach(async () => {
  await bridge.close();
  await host.close();
  await rm(dir, { recursive: true, force: true });
});

describe("MCP tool bridge", () => {
  it("lists every Sonobe tool in registration order, with titles and read-only hints", async () => {
    const tools = await bridge.tools();
    expect(tools.map((t) => t.name)).toEqual([...TOOL_NAMES]);
    expect(tools.find((t) => t.name === "get_outline")).toMatchObject({ readOnly: true, title: expect.any(String) });
    expect(tools.find((t) => t.name === "delete_items")?.readOnly).toBe(false);
    expect(await bridge.instructions()).toContain("get_guide");

    const defs = toAnthropicTools(tools);
    for (const def of defs) {
      expect(def.input_schema.type).toBe("object");
      expect(def.input_schema).not.toHaveProperty("$schema");
      expect(def.eager_input_streaming).toBe(true);
    }
  });

  it("edits the document with the author Assistant", async () => {
    const outline = await bridge.call("get_outline", {});
    expect(outline.isError).toBeFalsy();
    expect(outline.content.map((c) => c.text ?? "").join("\n")).toMatch(/component main/);
    expect(describeToolResult(outline)).toMatch(/^revision \d+/);

    const renamed = await bridge.call("rename", { updates: [{ id: "photo", name: "Hero Photo" }], label: "renamed the photo" });
    expect(renamed.isError).toBeFalsy();

    const snap = await host.getDocument();
    const photo = snap.doc.components[snap.doc.project.root]!.layers.find((l) => l.id === "photo");
    expect(photo?.name).toBe("Hero Photo");
    const [latest] = await host.history.list({ limit: 1 });
    expect(latest?.author).toEqual({ kind: "agent", name: ASSISTANT_AUTHOR_NAME });
  });

  it("returns teaching errors as isError results", async () => {
    const result = await bridge.call("rename", { updates: [{ id: "no_such_layer", name: "X" }] });
    expect(result.isError).toBe(true);
    expect(toolResultContent(result)[0]).toMatchObject({ type: "text" });
  });

  it("drives a whole Assistant reply over the real tools", async () => {
    const api = scriptedClient([
      { content: [{ type: "text", text: "Renaming it." }, { type: "tool_use", id: "tu_rename", name: "rename", input: { updates: [{ id: "caption", name: "Photo Caption" }] } }] },
      { content: [{ type: "text", text: "Done: the caption is now called Photo Caption." }] },
    ]);
    const agent = createAssistantAgent({ tools: () => bridge, apiKey: async () => "sk-ant-test-key-1234", createClient: () => api.client });
    const events: AssistantEvent[] = [];
    const result = await agent.run("w1", { text: "Rename the caption" }, (e) => events.push(e));

    expect(result.outcome).toBe("completed");
    expect(events.find((e) => e.type === "tool_finished")).toMatchObject({ name: "rename", status: "done", changedDocument: true });
    const snap = await host.getDocument();
    expect(snap.doc.components[snap.doc.project.root]!.layers.find((l) => l.id === "caption")?.name).toBe("Photo Caption");
    expect((await host.history.list({ limit: 1 }))[0]?.author.name).toBe("Assistant");
    // The system prompt carries the MCP server's instructions.
    expect(JSON.stringify(api.requests[0]!.system)).toContain("get_guide");
    expect(api.requests[0]!.tools).toHaveLength(TOOL_NAMES.length);
  });
});

describe("MCP tool bridge: long calls", () => {
  it("passes a long call's progress on, and Stop cancels it before it changes anything", async () => {
    const captures: { aborted: boolean }[] = [];
    const slow = Object.create(host) as HeadlessHost;
    Object.defineProperty(slow, "captureDesign", {
      value: (_request: DesignCaptureRequest, control: HostCallControl = {}) => {
        const capture = { aborted: false };
        captures.push(capture);
        control.progress?.({ message: "Reading the page's layers" });
        return new Promise<never>((_resolve, reject) =>
          control.signal?.addEventListener("abort", () => {
            capture.aborted = true;
            reject(new Error("aborted"));
          }),
        );
      },
    });
    const slowBridge = createMcpToolBridge({ host: slow, version: "0.1.0-test" });
    const before = (await host.history.list({})).length;
    const progress: string[] = [];
    const controller = new AbortController();
    const call = slowBridge.call("import_design", { html: "<p>slow</p>" }, { signal: controller.signal, onProgress: (message) => progress.push(message) });
    const end = Date.now() + 2000;
    while (!progress.includes("Reading the page's layers") && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(progress).toEqual(expect.arrayContaining(["Rendering the HTML", "Reading the page's layers"]));
    controller.abort();
    await expect(call).rejects.toThrow();
    while (!captures[0]?.aborted && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(captures[0]?.aborted).toBe(true);
    expect((await host.history.list({})).length).toBe(before);
    await slowBridge.close();
  });
});

describe("tool descriptions for activity chips", () => {
  it("summarises common inputs", () => {
    expect(describeToolInput({ intent: "Add a press animation" })).toBe("Add a press animation");
    expect(describeToolInput({ layers: [{ name: "Card" }, { name: "Title" }] })).toBe("Card, Title");
    expect(describeToolInput({ patches: [{ type: "switch" }] })).toBe("switch");
    expect(describeToolInput({ ops: [{}, {}] })).toBe("2 ops");
    expect(describeToolInput({ ids: ["a"] })).toBe("1 item");
    expect(describeToolInput({ query: "spring" })).toBe("“spring”");
    expect(describeToolInput(null)).toBe("");
  });

  it("keeps long results readable and says when it cut them", () => {
    const blocks = toolResultContent({ content: [{ type: "text", text: "x".repeat(50) }] }, 20);
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as { text: string }).text).toMatch(/^x{20}\n… \(cut off after 20 characters/);
    expect(toolResultContent({ content: [], structuredContent: { ok: true } })).toEqual([{ type: "text", text: '{"ok":true}' }]);
    expect(toolResultContent({ content: [] })).toEqual([{ type: "text", text: "Done." }]);
    expect(describeToolResult({ content: [{ type: "image", data: "", mimeType: "image/png" }] })).toBe("Screenshot");
  });
});
