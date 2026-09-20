/**
 * The tool bridge against a real SonobeHost (HeadlessHost over a temp project): Sonobe's MCP tools run
 * in process, and edits are attributed to "Assistant" in history. The agent test at the end drives the
 * whole loop with a scripted Anthropic client (no network).
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { createHeadlessHost, IMPORT_META_KEY, TOOL_NAMES, type CapturedDesign, type DesignCaptureRequest, type HeadlessHost, type HostCallControl } from "@sonobe/mcp";
import { createPatchRegistry } from "@sonobe/patches";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAssistantAgent, UNPINNED_TOOLS } from "./agent.ts";
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

  it("classifies every tool: it takes docId, so the Assistant pins it to its window's document, or it's in UNPINNED_TOOLS", async () => {
    const tools = await bridge.tools();
    const unclassified = tools.filter((t) => !UNPINNED_TOOLS.has(t.name) && !Object.hasOwn((t.inputSchema.properties ?? {}) as object, "docId")).map((t) => t.name);
    const pinnedAnyway = tools.filter((t) => UNPINNED_TOOLS.has(t.name) && Object.hasOwn((t.inputSchema.properties ?? {}) as object, "docId")).map((t) => t.name);
    expect(unclassified, "Give these tools docId, or add them to UNPINNED_TOOLS in agent.ts").toEqual([]);
    expect(pinnedAnyway, "These tools take docId, so take them out of UNPINNED_TOOLS").toEqual([]);
    const names = new Set<string>(TOOL_NAMES);
    expect([...UNPINNED_TOOLS].filter((name) => !names.has(name))).toEqual([]);
  });

  it("passes the result's _meta on as meta", async () => {
    const meta = { [IMPORT_META_KEY]: { docId: "assistant_test", screenId: "profile", txnId: "txn_1" } };
    const callTool = vi.spyOn(Client.prototype, "callTool");
    try {
      callTool.mockResolvedValueOnce({ content: [{ type: "text", text: "Imported “Profile”" }], _meta: meta });
      expect(await bridge.call("import_design", { html: "<p>hi</p>" })).toEqual({ content: [{ type: "text", text: "Imported “Profile”" }], meta });
    } finally {
      callTool.mockRestore();
    }
    // Without _meta there's no meta key at all.
    expect(await bridge.call("get_outline", {})).not.toHaveProperty("meta");
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

/** A checkout screen as the capture window would read it (no browser in tests). */
const CHECKOUT_CAPTURE = {
  format: "sonobe.design-capture",
  version: 1,
  source: { kind: "html", title: "Checkout" },
  viewport: { width: 402, height: 874 },
  root: {
    kind: "frame",
    name: "Checkout",
    box: [0, 0, 402, 874],
    fill: "#F5F5F7FF",
    children: [
      { kind: "text", name: "Title", text: "Checkout", box: [20, 80, 200, 40], style: { fontFamily: "system-ui", fontSize: 34, fontWeight: 700, color: "#111118FF", lineHeight: 40 } },
      { kind: "frame", name: "Pay Button", box: [16, 780, 370, 52], fill: "#277FFFFF", radii: [14, 14, 14, 14], children: [] },
    ],
  },
  images: {},
};

/** The headless host with a capture window that reads every page as CHECKOUT_CAPTURE, with a page image when asked. */
function capturingHost(base: HeadlessHost): HeadlessHost {
  const capturing = Object.create(base) as HeadlessHost;
  Object.defineProperty(capturing, "captureDesign", {
    value: async (request: DesignCaptureRequest): Promise<CapturedDesign> => ({
      capture: CHECKOUT_CAPTURE as never,
      images: new Map(),
      ...(request.screenshot ? { screenshot: { data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", mimeType: "image/png" as const, width: 1, height: 1 } } : {}),
    }),
  });
  return capturing;
}

describe("MCP tool bridge: designing on the canvas", () => {
  it("passes import_design's _meta on from the real server, also when a screenshot leaves out structuredContent", async () => {
    const designBridge = createMcpToolBridge({ host: capturingHost(host), version: "0.1.0-test" });
    try {
      const plain = await designBridge.call("import_design", { capture: CHECKOUT_CAPTURE });
      expect(plain.isError, JSON.stringify(plain.content)).toBeFalsy();
      expect(plain.meta?.[IMPORT_META_KEY]).toMatchObject({ dryRun: false, screenId: "checkout", screenName: "Checkout", replaced: null });

      const shot = await designBridge.call("import_design", { html: "<main>Checkout</main>", replace: "checkout", screenshot: true });
      expect(shot.isError, JSON.stringify(shot.content)).toBeFalsy();
      expect(shot.structuredContent).toBeUndefined();
      expect(shot.meta?.[IMPORT_META_KEY]).toMatchObject({ dryRun: false, screenId: "checkout", replaced: "checkout", txnId: expect.any(String) });
    } finally {
      await designBridge.close();
    }
  });

  it("streams the page as drafts, imports it, and asks before replacing a screen the person changed since", async () => {
    const designBridge = createMcpToolBridge({ host: capturingHost(host), version: "0.1.0-test" });
    const { docId } = await host.getDocument();
    const html = '<main data-name="Checkout"><h1 data-name="Title">Pay “now” \\ — ✓ 😀</h1>\n<button data-name="Pay Button">Pay</button></main>';
    const api = scriptedClient([
      { content: [{ type: "tool_use", id: "tu_new", name: "import_design", input: { name: "Checkout", html } }] },
      { content: [{ type: "text", text: "Added a checkout." }] },
      { content: [{ type: "tool_use", id: "tu_replace", name: "import_design", input: { name: "Checkout", replace: "checkout", html } }] },
      { content: [{ type: "text", text: "I kept your version." }] },
    ]);
    const agent = createAssistantAgent({
      tools: () => designBridge,
      apiKey: async () => "sk-ant-test-key-1234",
      createClient: () => api.client,
      documentFor: async () => ({ docId, projectPath: null }),
      readDocument: async (id) => (await host.getDocument(id)).doc,
    });
    const context = { component: { id: "main", name: "Main", size: [402, 874] as [number, number] }, screens: [] };
    try {
      const events: AssistantEvent[] = [];
      expect((await agent.run("w1", { text: "a checkout", context }, (e) => events.push(e))).outcome).toBe("completed");
      const drafts = events.filter((e): e is Extract<AssistantEvent, { type: "design_draft" }> => e.type === "design_draft");
      expect(drafts.length).toBeGreaterThan(1);
      expect(drafts.every((d) => d.toolUseId === "tu_new")).toBe(true);
      expect(drafts.map((d) => d.append).join("")).toBe(html);
      expect(drafts.at(-1)).toMatchObject({ done: true, html, fields: { name: "Checkout" } });
      expect(events.findIndex((e) => e.type === "design_draft" && e.done)).toBeLessThan(events.findIndex((e) => e.type === "tool_started"));
      const imported = events.find((e) => e.type === "tool_finished" && e.name === "import_design");
      expect(imported).toMatchObject({ status: "done", imported: { docId, screenId: "checkout", name: "Checkout", replaced: null } });

      // The person retitles the screen by hand, then Claude wants to replace it: Sonobe asks, naming the change.
      const title = (await host.getDocument()).doc.components.main!.layers.find((l) => l.id === "checkout")!.children!.find((l) => l.name === "Title")!;
      await host.apply([{ op: "updateLayer", component: "main", id: title.id, props: { textColor: "#FF0000FF" } }], { label: "Recolor the title", author: { kind: "human", name: "Tyler" } });
      const revision = (await host.getDocument()).revision;
      const second: AssistantEvent[] = [];
      const run = agent.run("w1", { text: "make it bigger", context }, (e) => {
        second.push(e);
        if (e.type === "confirm_required") queueMicrotask(() => agent.confirm("w1", e.confirmationId, false));
      });
      expect((await run).outcome).toBe("completed");
      expect(second.find((e) => e.type === "confirm_required")).toMatchObject({ kind: "replace", title: "Replace your changes to “Checkout”?", approveLabel: "Replace", declineLabel: "Keep my changes" });
      expect((second.find((e) => e.type === "confirm_required") as { message: string }).message).toMatch(/^You changed Title after Claude made this screen\./);
      expect(second.find((e) => e.type === "tool_finished")).toMatchObject({ toolUseId: "tu_replace", status: "declined", detail: "You kept your changes" });
      expect((await host.getDocument()).revision).toBe(revision);
      expect(JSON.stringify(api.requests[3]!.messages.at(-1))).toContain("The person kept their changes to “Checkout”, so nothing changed.");
    } finally {
      await designBridge.close();
    }
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
    expect(describeToolInput({ path: "src/theme.ts", offset: 1 })).toBe("src/theme.ts");
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
