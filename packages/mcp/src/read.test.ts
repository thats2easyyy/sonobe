import { fileURLToPath } from "node:url";
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

  it("digests the styles a prototype uses instead of the outline", async () => {
    const card = await client.call("get_outline", { detail: "styles" });
    expect(card.text).toBe("revision 2\nstyles main (1 layer)\ncolors #FFFFFFFF fill×1\nradii 24×1");

    const { docId } = await project.host.openDocument(
      fileURLToPath(new URL("../../../examples/05-tab-bar", import.meta.url)),
    );
    const styles = await client.call("get_outline", { docId, detail: "styles" });
    expect(styles.isError, styles.text).toBe(false);
    expect(styles.text).toBe(
      [
        "revision 0",
        "styles main (92 layers)",
        "colors #111118FF fill,text×16 · #000000FF shadow×14 · #FFFFFFFF fill,text×12 · #5F5F6BFF text×9 · #FFFFFFB3 text×8 · #8B5CF6FF gradient×3 · #11111859 fill,stroke×2 · #FDE68AFF gradient×2 · #FF3D71FF gradient×2 · #0284C7FF gradient×1 · #0E0F1AFF gradient×1 · #14B8A6FF gradient×1",
        'fonts "Inter" 400,600,700 ×39',
        "font sizes 17×13 · 13×12 · 15×5 · 11×4 · 34×4 · 22×1",
        "radii 24×8 · 1×5 · 18×5 · 12×4 · 3×3 · 2×1",
        "shadows #00000014 r18 0,6 ×13 · #0000000F r16 0,-4 ×1",
      ].join("\n"),
    );
    expect((await client.call("get_outline", { docId, detail: "styles" })).text).toBe(styles.text);
    expect(
      (await client.call("get_outline", { docId, detail: "styles", component: "main" })).text,
    ).toBe(styles.text);
    const bad = await client.call("get_outline", { docId, detail: "styles", component: "mian" });
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
    // The card's scale is driven, so it has a node in the graph: automatic until someone places it.
    expect(items.text).toMatch(
      /graph node: \d+,\d+ · \d+×\d+, placed automatically next to its drivers \(not saved\)/,
    );
    const card = () =>
      (items.structured.items as { id: string; graphNode?: unknown }[]).find(
        (i) => i.id === "card",
      );
    expect(card()?.graphNode).toMatchObject({ position: null, box: { measured: false } });
    // Patches show the box the editor draws them in, live values included, so nobody estimates sizes.
    const spring = (items.structured.items as { id: string; box?: Record<string, number> }[]).find(
      (i) => i.id === "grow_spring",
    )!;
    expect(spring.box).toMatchObject({ x: expect.any(Number), width: expect.any(Number) });
    expect(spring.box!.width).toBeGreaterThanOrEqual(164);
    expect(items.text).toContain(
      `· ui ${spring.box!.x},${spring.box!.y} · ${spring.box!.width}×${spring.box!.height}`,
    );
    expect(items.text).toContain("Node sizes are estimated as the editor draws them");
    await client.call("apply_ops", {
      ops: [{ op: "setNodePositions", positions: { "@card": [900, 40] } }],
    });
    const placed = await client.call("get_items", { ids: ["card"] });
    expect(placed.text).toMatch(
      /graph node: 900,40 · \d+×\d+ \(saved; move it with setNodePositions\)/,
    );
    expect((placed.structured.items as { graphNode?: unknown }[])[0]?.graphNode).toMatchObject({
      position: [900, 40],
      box: { x: 900, y: 40 },
    });

    // A comment lists the nodes it frames (the ones under whose title bar it is).
    const tap = spring.box!;
    await client.call("apply_ops", {
      ops: [
        {
          op: "addComment",
          comment: {
            id: "motion",
            text: "MOTION",
            rect: [tap.x - 20, tap.y - 44, tap.width + 40, tap.height + 64],
          },
        },
      ],
    });
    const frame = await client.call("get_items", { ids: ["motion"] });
    expect(frame.text).toContain("frames 1 node: grow_spring");
    expect((frame.structured.items as { members?: string[] }[])[0]?.members).toEqual([
      "grow_spring",
    ]);

    // Placing a node on top of another shows on both, with their boxes, and on the frame (D23).
    await client.call("apply_ops", {
      ops: [{ op: "addPatch", patch: { id: "stacked", type: "switch", name: "Stacked", ui: { x: tap.x + 10, y: tap.y + 10 } } }],
    });
    const over = await client.call("get_items", { ids: ["grow_spring", "stacked", "motion"] });
    const stacked = (over.structured.items as { id: string; box?: { x: number; y: number; width: number; height: number } }[]).find((i) => i.id === "stacked")!.box!;
    expect(over.text).toContain(
      `  overlaps: stacked (${stacked.x},${stacked.y} ${stacked.width}×${stacked.height}). tidy_graph separates them, or move one (updatePatch ui).`,
    );
    expect(over.text).toContain(`  overlaps: grow_spring (${tap.x},${tap.y} ${tap.width}×${tap.height})`);
    expect(over.text).toContain(
      `  overlapping: grow_spring (${tap.x},${tap.y} ${tap.width}×${tap.height}) × stacked (${stacked.x},${stacked.y} ${stacked.width}×${stacked.height}). tidy_graph({ "frames": ["motion"] }) lays this frame out.`,
    );
    expect((over.structured.items as { id: string; overlaps?: string[]; overlapping?: string[][] }[]).map((i) => i.overlaps ?? i.overlapping)).toEqual([
      ["stacked"],
      ["grow_spring"],
      [["grow_spring", "stacked"]],
    ]);
    const tidyPreview = await client.call("tidy_graph", { dryRun: true });
    expect(tidyPreview.text).toContain(
      `Overlapping before: grow_spring (${tap.x},${tap.y} ${tap.width}×${tap.height}) × stacked (${stacked.x},${stacked.y} ${stacked.width}×${stacked.height})`,
    );
    expect(tidyPreview.structured.overlapping).toContainEqual(["grow_spring", "stacked"]);

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
