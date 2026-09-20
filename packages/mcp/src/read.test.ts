import { createPatchRegistry } from "@sonobe/patches";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { explain } from "./explain.ts";
import {
  buildGrowCard,
  connectClient,
  tempProject,
  type TempProject,
  type TestClient,
} from "./test-helpers.ts";

let project: TempProject;
let client: TestClient;

beforeEach(async () => {
  project = await tempProject();
  client = await connectClient(project.host);
  await buildGrowCard(client);
});

afterEach(async () => {
  await client.close();
  await project.cleanup();
});

describe("read tools", () => {
  it("reports document info", async () => {
    const r = await client.call("get_document_info", {});
    expect(r.isError).toBe(false);
    expect(r.structured).toMatchObject({
      docId: "test",
      name: "Test",
      revision: 2,
      dirty: true,
      root: "main",
      diagnostics: { errors: 0, warnings: 0 },
    });
    expect(r.text).toContain("Device: iPhone 17 Pro 402×874");
    expect(r.text).toContain('main "Main" (prototype; 1 layer, 4 patches, 4 connections)');
    expect(r.text).toContain("call save_document to write to disk");
  });

  it("truncates long outlines explicitly", async () => {
    const r = await client.call("get_outline", { maxLines: 10, detail: "compact" });
    expect(r.text).toContain("component main");
    const short = await client.call("get_outline", { maxLines: 10, offset: 5, detail: "full" });
    expect(short.text).toContain("ui=");
    const bad = await client.call("get_outline", { component: "mian" });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain('Did you mean "main"');
  });

  it("lists layers and patches with links", async () => {
    await client.call("add_layers", {
      layers: [
        {
          type: "group",
          name: "Panel",
          children: [
            { type: "text", name: "Title", props: { text: "Hello" } },
            { type: "group", name: "Inner", children: [{ type: "rectangle", name: "Deep" }] },
          ],
        },
      ],
    });
    const layers = await client.call("get_layers", { depth: 2 });
    expect(layers.text).toContain('card rectangle "Card" @22,300 358x220 scale←card_scale.output');
    expect(layers.text).toContain('  title text "Title" "Hello"');
    expect(layers.text).toContain('inner group "Inner" · 1 children (pass parent: "inner")');
    const inner = await client.call("get_layers", { parent: "inner", detail: "ids" });
    expect(inner.text).toContain("deep (rectangle)");

    const patches = await client.call("get_patches", {});
    expect(patches.text).toContain(
      'card_grown switch "Card Grown" flip←tap_card.tap · on→grow_spring.number',
    );
    const full = await client.call("get_patches", { type: "popAnimation", detail: "full" });
    expect(full.text).toContain("bounciness: number = 5");
    expect(full.text).toContain("output: number → card_scale.progress");
  });

  it("gets items and finds things", async () => {
    const items = await client.call("get_items", { ids: ["card", "grow_spring", "nope_1"] });
    expect(items.text).toContain("referenced by: tap_card (interaction)");
    expect(items.text).toContain("number: number = ←card_grown.on");
    expect(items.text).toContain("nope_1: not found");
    expect(items.structured.missing).toEqual(["nope_1"]);

    const find = await client.call("find", { patchType: "interaction" });
    expect(find.text).toContain("patch tap_card interaction");
    const connected = await client.call("find", { connectedTo: "card_grown" });
    expect((connected.structured.matches as { id: string }[]).map((m) => m.id).sort()).toEqual([
      "grow_spring",
      "tap_card",
    ]);
    const text = await client.call("find", { text: "spring" });
    expect((text.structured.matches as { id: string }[]).map((m) => m.id)).toEqual(["grow_spring"]);
    expect((await client.call("find", {})).isError).toBe(true);
  });

  it("reports diagnostics with fix ops", async () => {
    await client.call("apply_ops", {
      ops: [{ op: "setInput", target: "grow_spring.number", value: { link: "tap_card.tap" } }],
    });
    const r = await client.call("get_diagnostics", { severity: "warning" });
    expect(r.text).toContain("warning pulse_into_state");
    expect(r.text).toContain("Insert a Switch");
    expect(r.text).toContain('"op":"addPatch"');
  });

  it("adds the live viewer's runtime problems when the host has a live viewer", async () => {
    const documentOnly = project.host.diagnostics.bind(project.host);
    const warning = {
      code: "empty_loop",
      severity: "warning" as const,
      message:
        'Layer "Card" has 0 copies because "Pick" (Loop Select) returned an empty loop: index 3 is past the end of its 1-item Loop.',
      hint: "An empty loop wins over every other loop.",
      component: "main",
      itemIds: ["card"],
      suggestions: [
        {
          description:
            'Set Out of Range to Clamp: an index past the end takes the last item. It changes "Pick" (Loop Select).',
          ops: [{ op: "setInput" as const, target: "pick.outOfRange", value: "clamp" }],
        },
      ],
    };
    project.host.diagnostics = async (docId) => ({
      ...(await documentOnly(docId)),
      runtime: { frame: 1234, playing: true, diagnostics: [warning] },
    });
    const r = await client.call("get_diagnostics", {});
    expect(r.text).toContain("No diagnostics at revision");
    expect(r.text).toContain("Live viewer (frame 1,234, playing): 1 runtime problem:");
    expect(r.text).toContain(
      'warning empty_loop [main · card]: Layer "Card" has 0 copies because "Pick" (Loop Select) returned an empty loop',
    );
    expect(r.text).toContain('"target":"pick.outOfRange"');
    expect(r.structured.runtime).toEqual({ frame: 1234, playing: true, diagnostics: [warning] });
    const errors = await client.call("get_diagnostics", { severity: "error" });
    expect(errors.text).toContain("Live viewer (frame 1,234, playing): no runtime problems.");
  });

  it("returns an empty headless selection with a note", async () => {
    const r = await client.call("get_selection", {});
    expect(r.text).toContain("Headless mode has no editor");
  });
});

describe("explain", () => {
  it("describes the same graph at three audience levels", async () => {
    const beginner = await client.call("explain", { audience: "beginner" });
    expect(beginner.text).toContain('"Main" has 1 layer');
    expect(beginner.text).toContain("It watches for touches on Card");
    expect(beginner.text).toContain("tapping Card flips it");
    expect(beginner.text).toContain("a springy animation glides to match it");
    expect(beginner.text).toContain("That drives Card's scale.");
    expect(beginner.text).not.toContain("card_grown");

    const designer = await client.call("explain", {});
    expect(designer.text).toContain("Flow 1 (drives Card › Scale)");
    expect(designer.text).toContain(
      "Card Grown (Switch) holds on/off and flips on Tap Card › Tap.",
    );
    expect(designer.text).toContain(
      "Grow Spring (Pop Animation) springs toward Card Grown › On (speed 12).",
    );
    expect(designer.text).toContain("→ Card › Scale ← Card Scale › Output");

    const engineer = await client.call("explain", { audience: "engineer" });
    expect(engineer.text).toContain("component main (prototype)");
    expect(engineer.text).toContain("card_grown (switch): flip←tap_card.tap.");
    expect(engineer.text).toContain("@card.scale ← card_scale.output");
    expect(engineer.text).toContain("Switch precedence turnOff > turnOn > flip");
  });

  it("is deterministic and scopes to ids", async () => {
    const snap = await project.host.getDocument();
    const registry = createPatchRegistry();
    const a = explain(snap.doc, { registry, audience: "designer" });
    expect(explain(snap.doc, { registry, audience: "designer" })).toBe(a);
    await client.call("add_patches", { patches: [{ type: "time", name: "Clock" }] });
    const all = await client.call("explain", {});
    expect(all.text).toContain("Unconnected: Clock (Time).");
    const scoped = await client.call("explain", { ids: ["clock"] });
    expect(scoped.text).not.toContain("Flow 1");
    expect(scoped.text).toContain("Unconnected: Clock (Time).");
  });
});
