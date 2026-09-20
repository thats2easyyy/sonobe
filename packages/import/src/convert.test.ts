import { applyOps, createEmptyDocument, createIdLedger, findLayer, type LayerNode } from "@sonobe/core";
import { createPatchRegistry } from "@sonobe/patches";
import { describe, expect, it } from "vitest";
import { parseCapture, type CaptureFrame, type DesignCapture } from "./capture.ts";
import { planImport, sniffImageMime, type ResolvedImage } from "./convert.ts";
import { decodeDataUrl, resolveCaptureFiles } from "./resolve.ts";

const registry = createPatchRegistry();
const PNG = decodeDataUrl("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==")!;

function capture(root: Partial<CaptureFrame> & { children: CaptureFrame["children"] }, extra: Partial<DesignCapture> = {}): DesignCapture {
  return {
    format: "sonobe.design-capture",
    version: 1,
    source: { kind: "html", title: "Screen" },
    viewport: { width: 402, height: 874 },
    root: { kind: "frame", name: "Screen", box: [0, 0, 402, 874], fill: "#FFFFFFFF", clip: true, ...root },
    images: {},
    ...extra,
  };
}

async function imported(c: DesignCapture, images: Map<string, ResolvedImage | null> = new Map(), options = {}) {
  const doc = createEmptyDocument({ name: "Test" });
  const plan = await planImport(c, doc, images, options);
  const result = applyOps(doc, plan.ops, { registry });
  expect(result.errors, JSON.stringify(result.errors)).toEqual([]);
  const main = result.doc.components[result.doc.project.root]!;
  const layer = (id: string): LayerNode => findLayer(main.layers, id)!.layer;
  return { plan, doc: result.doc, main, layer, idMap: result.idMap };
}

describe("planImport", () => {
  it("maps frames, text and uniform borders onto groups, rectangles and text layers", async () => {
    const { layer, plan, idMap } = await imported(
      capture({
        children: [
          {
            kind: "frame",
            name: "Card",
            nameRank: 5,
            box: [16, 100, 370, 200],
            fill: "#FFFFFFFF",
            radii: [24, 24, 24, 24],
            border: { widths: [1, 1, 1, 1], colors: ["#E5E7EBFF", "#E5E7EBFF", "#E5E7EBFF", "#E5E7EBFF"] },
            shadows: [
              { x: 0, y: 1, blur: 2, spread: 0, color: "#00000014" },
              { x: 0, y: 10, blur: 30, spread: 0, color: "#1118271F" },
            ],
            children: [
              { kind: "text", name: "Title", text: "Ava Chen", box: [36, 120, 102, 28], style: { fontFamily: "Inter, sans-serif", fontSize: 24, fontWeight: 700, color: "#141822FF", lineHeight: 28 } },
              { kind: "text", name: "Label", text: "Follow", box: [150, 260, 50, 16], style: { fontFamily: "system-ui", fontSize: 13, fontWeight: 600, color: "#FFFFFFFF", align: "center", lineHeight: 16 } },
              { kind: "text", name: "Bio", text: "A long paragraph that wraps", box: [36, 160, 330, 44], wraps: true, style: { fontFamily: "system-ui", fontSize: 15, fontWeight: 400, color: "#141822FF", lineHeight: 22 } },
            ],
          },
          { kind: "frame", name: "Dot", box: [300, 20, 10, 10], fill: "#34C759FF", radii: [5, 5, 5, 5], children: [] },
        ],
      }),
    );
    expect(idMap.screen).toBe("screen");
    const card = layer("card");
    expect(card.type).toBe("group");
    expect(card.props).toMatchObject({ position: [16, 100], size: [370, 200], color: "#FFFFFFFF", cornerRadius: 24, strokeWidth: 1, strokeColor: "#E5E7EBFF", shadowRadius: 30, shadowOffset: [0, 10], shadowColor: "#111827FF" });
    expect(layer("title").props).toMatchObject({ position: [20, 20], text: "Ava Chen", fontWeight: 700, lineHeight: 28, widthMode: "auto" });
    // A centered single line hugs its text and grows from its center.
    expect(layer("label").props).toMatchObject({ anchor: [0.5, 0], position: [159, 160], textAlignment: "center" });
    expect(layer("bio").props).toMatchObject({ widthMode: "fixed", size: [331, 44] });
    expect(layer("dot").type).toBe("rectangle");
    expect(plan.summary).toMatchObject({ texts: 3, images: 0, scrolls: 0 });
  });

  it("draws one-sided borders, gradients and background images as child layers", async () => {
    const c = capture(
      {
        children: [
          {
            kind: "frame",
            name: "Row",
            box: [0, 0, 402, 44],
            border: { widths: [0, 0, 0.5, 0], colors: ["#00000000", "#00000000", "#3C3C434AFF".slice(0, 9), "#00000000"] },
            gradients: [{ kind: "linear", stops: [[0, "#FF9A62FF"], [1, "#7C3AEDFF"]], start: [0, 0], end: [1, 1] }],
            backgroundImage: { image: "img1", fit: "cover" },
            children: [{ kind: "text", text: "Wi-Fi", box: [16, 12, 40, 20], style: { fontFamily: "system-ui", fontSize: 17, fontWeight: 400, color: "#000000FF", lineHeight: 20 } }],
          },
        ],
      },
      { images: { img1: { url: "https://example.com/photo.png", name: "photo" } } },
    );
    const { main, layer, plan, doc } = await imported(c, new Map([["img1", { bytes: PNG.bytes, mime: "image/png", width: 1, height: 1 }]]));
    const row = layer("row");
    expect(row.children!.map((l) => l.name)).toEqual(["Gradient", "Background Image", "Border Bottom", "Wi-Fi"]);
    expect(layer("border_bottom").props).toMatchObject({ position: [0, 43.5], size: [402, 0.5] });
    expect(plan.files).toHaveLength(1);
    expect(plan.files[0]!.file).toMatch(/^[0-9a-f]{64}\.png$/);
    expect(Object.values(doc.assets)).toMatchObject([{ id: "photo", kind: "image", mime: "image/png" }]);
    expect(main.layers).toHaveLength(1);
  });

  it("reuses an asset with the same bytes and falls back to the URL when a download failed", async () => {
    const c = capture(
      { children: [{ kind: "image", name: "Hero", image: "img1", fit: "cover", box: [0, 0, 402, 200] }, { kind: "image", name: "Avatar", image: "img2", fit: "cover", box: [0, 0, 40, 40], radii: [20, 20, 20, 20] }] },
      { images: { img1: { url: "https://example.com/hero.png" }, img2: { url: "https://example.com/avatar.png" } } },
    );
    const images = new Map<string, ResolvedImage | null>([["img1", { bytes: PNG.bytes, mime: "application/octet-stream" }], ["img2", null]]);
    const first = await imported(c, images);
    expect(first.layer("hero").props.image).toEqual({ asset: "image" });
    expect(first.layer("avatar").props).toMatchObject({ image: "https://example.com/avatar.png", cornerRadius: 20 });
    const again = await planImport(c, first.doc, images);
    expect(again.files).toEqual([]);
    expect(again.ops.filter((op) => op.op === "addAsset")).toEqual([]);
  });

  it("makes long pages and scroll containers scroll with Scroll patches", async () => {
    const c = capture({
      children: [
        {
          kind: "frame",
          name: "Content",
          nameRank: 5,
          keep: true,
          scrollContent: true,
          box: [0, 0, 402, 2000],
          children: [
            {
              kind: "frame",
              name: "Carousel",
              box: [0, 100, 402, 120],
              clip: true,
              scroll: { x: true, y: false },
              children: [0, 1, 2, 3].map((i) => ({ kind: "frame" as const, name: `Card ${i + 1}`, box: [16 + i * 200, 100, 180, 120] as [number, number, number, number], fill: "#EEEEEEFF", children: [] })),
            },
          ],
        },
        { kind: "frame", name: "Tab Bar", box: [0, 790, 402, 84], fill: "#FFFFFFFF", children: [] },
      ],
    });
    const { main, layer, plan } = await imported(c);
    expect(plan.summary.scrolls).toBe(2);
    const scrolls = Object.values(main.patches).filter((p) => p.type === "scroll");
    expect(scrolls.map((p) => p.name).sort()).toEqual(["Scroll Carousel", "Scroll Content"]);
    expect(layer("content").props.position).toEqual({ link: "scroll_content.position" });
    const carousel = layer("carousel");
    expect(carousel.children!.map((l) => l.name)).toEqual(["Carousel Content"]);
    expect(layer("carousel_content").props.size).toEqual([796, 120]);
    expect(scrolls.find((p) => p.name === "Scroll Carousel")!.inputs).toMatchObject({ scrollX: "free", scrollY: "off" });
    const none = await planImport(c, createEmptyDocument(), new Map(), { scrolling: false });
    expect(none.ops.some((op) => op.op === "addPatch")).toBe(false);
  });

  it("turns inputs into text fields and empty tap targets into hit areas", async () => {
    const { layer } = await imported(
      capture({
        children: [
          { kind: "input", name: "Email Field", value: "ava@example.com", placeholder: "Email", placeholderColor: "#8E8E93FF", keyboard: "email", box: [16, 100, 370, 22], style: { fontFamily: "system-ui", fontSize: 17, fontWeight: 400, color: "#000000FF", lineHeight: 22 } },
          { kind: "frame", name: "Close Button", interactive: true, box: [350, 50, 44, 44], children: [] },
        ],
      }),
    );
    expect(layer("email_field")).toMatchObject({ type: "textField", props: { text: "ava@example.com", placeholder: "Email", keyboardType: "email" } });
    expect(layer("close_button").type).toBe("hitArea");
  });

  it("names the screen and places it where asked", async () => {
    const { layer, plan } = await imported(capture({ children: [] }), new Map(), { name: "Home", position: [402, 0] });
    expect(plan.screenName).toBe("Home");
    expect(layer("home").props.position).toEqual([402, 0]);
  });
});

describe("re-importing over an earlier screen", () => {
  const post = (color: string, extra: CaptureFrame[] = []) =>
    capture({
      name: "Post",
      children: [
        {
          kind: "frame",
          name: "Content",
          nameRank: 5,
          keep: true,
          scrollContent: true,
          box: [0, 0, 402, 1600],
          children: [
            { kind: "frame", name: "Like Button", nameRank: 5, box: [16, 400, 110, 40], fill: color, radii: [20, 20, 20, 20], children: [{ kind: "text", text: "Like", box: [36, 410, 40, 20], style: { fontFamily: "system-ui", fontSize: 15, fontWeight: 600, color: "#FFFFFFFF", lineHeight: 20 } }] },
            { kind: "frame", name: "Icon", box: [16, 20, 20, 20], fill: "#000000FF", children: [] },
            ...extra,
          ],
        },
      ],
    });

  it("keeps ids, links and connections of layers found again, and doesn't add a second Scroll patch", async () => {
    const first = await imported(post("#FF3B30FFFF".slice(0, 9)));
    // Wire the imported button, like a person or Claude would.
    const wired = applyOps(first.doc, [
      { op: "addPatch", patch: { ref: "tap", type: "interaction", name: "Tap Like", inputs: { layer: { layer: "like_button" } } } },
      { op: "addPatch", patch: { ref: "grow", type: "transition", name: "Like Scale", typeParam: "number", inputs: { start: 1, end: 1.1 } } },
      { op: "connect", from: "$grow.output", to: "@like_button.scale" },
      { op: "addPatch", patch: { ref: "watch", type: "interaction", name: "Tap Icon", inputs: { layer: { layer: "icon" } } } },
    ], { registry });
    expect(wired.errors).toEqual([]);

    const again = await planImport(post("#34C759FF", [{ kind: "frame", name: "Icon", box: [40, 20, 20, 20], fill: "#111111FF", children: [] }]), wired.doc, new Map(), { replace: "post" });
    expect(again.ops.filter((op) => op.op === "addPatch")).toEqual([]);
    const result = applyOps(wired.doc, again.ops, { registry });
    expect(result.errors).toEqual([]);
    const main = result.doc.components.main!;
    const button = findLayer(main.layers, "like_button")!.layer;
    expect(button.props).toMatchObject({ color: "#34C759FF", scale: { link: "like_scale.output" } });
    expect(main.patches.tap_like!.inputs.layer).toEqual({ layer: "like_button" });
    expect(findLayer(main.layers, "content")!.layer.props.position).toEqual({ link: "scroll_content.position" });
    expect(Object.values(main.patches).filter((p) => p.type === "scroll")).toHaveLength(1);
    // The second "Icon" is new; the first kept its id and its interaction.
    expect(main.patches.tap_icon!.inputs.layer).toEqual({ layer: "icon" });
    expect(main.layers.map((l) => l.id)).toEqual(["post"]);
    expect(again.summary.kept).toBeGreaterThanOrEqual(4);
  });

  it("explains a missing screen", async () => {
    await expect(planImport(post("#000000FF"), createEmptyDocument(), new Map(), { replace: "nope" })).rejects.toThrow('no layer "nope"');
  });
});

describe("web fonts", () => {
  it("adds a font asset per downloaded face and reports the rest", async () => {
    const woff2 = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 1, 2, 3, 4]);
    const c = capture({ children: [] }, { fonts: [{ family: "Inter Variable", url: "http://localhost:5311/inter.woff2", weight: "100 900", unicodeRange: "U+0-FF" }, { family: "Brand Sans", url: "http://localhost:5311/brand.woff2" }] });
    const { doc, plan } = await imported(c, new Map([["font:0", { bytes: woff2, mime: "font/woff2" }], ["font:1", null]]));
    expect(Object.values(doc.assets)).toMatchObject([{ id: "inter_variable_100_900", kind: "font", name: "Inter Variable", mime: "font/woff2", font: { family: "Inter Variable", weight: "100 900", unicodeRange: "U+0-FF" } }]);
    expect(plan.files[0]!.file).toMatch(/\.woff2$/);
    expect(plan.summary.fonts).toBe(1);
    expect(plan.notes.join(" ")).toContain("“Brand Sans” couldn't be downloaded");
  });
});

describe("captures from outside", () => {
  it("validates with readable issues", () => {
    expect(() => parseCapture("nope")).toThrow("isn't JSON");
    expect(() => parseCapture({ format: "other" })).toThrow('needs "format"');
    expect(() => parseCapture({ ...capture({ children: [] }), root: { kind: "frame", box: [0, 0], children: [] } })).toThrow("root.box");
    expect(parseCapture(JSON.stringify(capture({ children: [] }))).root.name).toBe("Screen");
  });

  it("decodes data: images and skips what can't be downloaded", async () => {
    const c = capture({ children: [] }, { images: { a: { url: "data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E" }, b: { url: "https://example.com/x.png" } } });
    const images = await resolveCaptureFiles(c, { fetch: async () => null });
    expect(sniffImageMime(images.get("a")!.bytes)).toBe("image/svg+xml");
    expect(images.get("b")).toBeNull();
  });
});

describe("re-import edge cases", () => {
  const screen = (names: string[]) =>
    capture({ name: "Tabs", children: names.map((name, i) => ({ kind: "frame" as const, name, nameRank: 5, box: [0, i * 50, 100, 40] as [number, number, number, number], fill: "#EEEEEEFF", children: [] })) });

  it("drops links to layers the new screen doesn't have instead of failing", async () => {
    const first = await imported(screen(["A", "B"]));
    const wired = applyOps(first.doc, [{ op: "connect", from: "@b.rotation", to: "@a.rotation" }], { registry });
    expect(wired.errors).toEqual([]);
    const again = await planImport(screen(["A", "C"]), wired.doc, new Map(), { replace: "tabs" });
    const result = applyOps(wired.doc, again.ops, { registry });
    expect(result.errors).toEqual([]);
    expect(findLayer(result.doc.components.main!.layers, "a")!.layer.props.rotation).toBeUndefined();
    expect(again.summary.lostConnections).toBe(1);
    expect(again.notes.join(" ")).toContain("removed: @a.rotation.");
  });

  const place = (text: { name: string; nameRank: number; text: string }[]) =>
    capture({
      name: "Discover",
      children: [
        {
          kind: "frame",
          name: "Card 1",
          nameRank: 5,
          box: [16, 100, 370, 200],
          fill: "#FFFFFFFF",
          children: text.map((t, i) => ({ kind: "text" as const, ...t, box: [32, 120 + i * 30, 300, 20] as [number, number, number, number], style: { fontFamily: "system-ui", fontSize: 15, fontWeight: 400, color: "#000000FF", lineHeight: 20 } })),
        },
      ],
    });

  it("finds text an earlier import named by its words, now named by its element, and keeps its id and link", async () => {
    // Imports before text took its element's name called it by its words.
    const first = await imported(place([{ name: "Leonard's Bakery", nameRank: 1, text: "Leonard's Bakery" }, { name: "933 Kapahulu Ave, Honolulu", nameRank: 1, text: "933 Kapahulu Ave, Honolulu" }]));
    const wired = applyOps(first.doc, [
      { op: "addPatch", patch: { ref: "upper", type: "changeCase", name: "Upper", inputs: { text: "Kapahulu" } } },
      { op: "connect", from: "$upper.output", to: "@text_933_kapahulu_ave_honolulu.text" },
    ], { registry });
    expect(wired.errors).toEqual([]);

    const again = await planImport(place([{ name: "Card 1 Name", nameRank: 5, text: "Leonard's Bakery" }, { name: "Card 1 Address", nameRank: 5, text: "933 Kapahulu Ave, Honolulu" }]), wired.doc, new Map(), { replace: "discover" });
    const result = applyOps(wired.doc, again.ops, { registry });
    expect(result.errors).toEqual([]);
    const card = findLayer(result.doc.components.main!.layers, "card_1")!.layer;
    expect(card.children!.map((l) => [l.id, l.name])).toEqual([["leonard_s_bakery", "Card 1 Name"], ["text_933_kapahulu_ave_honolulu", "Card 1 Address"]]);
    expect(card.children![1]!.props.text).toEqual({ link: "upper.output" });
    expect(again.summary).toMatchObject({ kept: 4, lostConnections: 0 });
  });

  it("counts and names a connection into a layer the new screen doesn't have", async () => {
    const first = await imported(place([{ name: "Open until 9 PM", nameRank: 1, text: "Open until 9 PM" }]));
    const wired = applyOps(first.doc, [
      { op: "addPatch", patch: { ref: "upper", type: "changeCase", name: "Upper", inputs: { text: "Open" } } },
      { op: "connect", from: "$upper.output", to: "@open_until_9_pm.text" },
    ], { registry });
    expect(wired.errors).toEqual([]);
    // The copy changed, so nothing finds the old text again.
    const again = await planImport(place([{ name: "Open until 10 PM", nameRank: 1, text: "Open until 10 PM" }]), wired.doc, new Map(), { replace: "discover" });
    expect(applyOps(wired.doc, again.ops, { registry }).errors).toEqual([]);
    expect(again.summary.lostConnections).toBe(1);
    expect(again.notes.join(" ")).toContain("1 connection to layers the new screen doesn't have was removed: @open_until_9_pm.text.");
  });

  it("doesn't give a layer that moved to another parent its old id without its connections", async () => {
    const shop = (parent: string) =>
      capture({ name: "Shop", children: [{ kind: "frame", name: parent, nameRank: 5, box: [0, 0, 402, 200], fill: "#EEEEEEFF", children: [{ kind: "frame", name: "Buy Button", nameRank: 5, box: [16, 100, 120, 44], fill: "#0A84FFFF", children: [] }] }] });
    const first = await imported(shop("Card"));
    const wired = applyOps(first.doc, [
      { op: "addPatch", patch: { ref: "tap", type: "interaction", name: "Tap Buy", inputs: { layer: { layer: "buy_button" } } } },
      { op: "addPatch", patch: { ref: "grow", type: "transition", name: "Buy Scale", typeParam: "number", inputs: { start: 1, end: 1.1 } } },
      { op: "connect", from: "$grow.output", to: "@buy_button.scale" },
    ], { registry });
    expect(wired.errors).toEqual([]);
    // The button moved into a footer, so it isn't found at its name path.
    const again = await planImport(shop("Footer"), wired.doc, new Map(), { replace: "shop" });
    const result = applyOps(wired.doc, again.ops, { registry });
    expect(result.errors).toEqual([]);
    const main = result.doc.components.main!;
    // The address the note calls gone really is gone, instead of naming a new layer that lost its wiring.
    expect(findLayer(main.layers, "buy_button")).toBeUndefined();
    expect(findLayer(main.layers, "buy_button_2")!.layer.props.scale).toBeUndefined();
    expect(again.summary.lostConnections).toBe(2);
    expect(again.notes.join(" ")).toContain("removed: tap_buy.layer, @buy_button.scale.");
  });

  it("gives new layers ids that aren't retired this session", async () => {
    const first = await imported(screen(["A", "B"]));
    const ids = createIdLedger(first.doc);
    const removed = applyOps(first.doc, [{ op: "removeLayer", id: "b" }], { registry, seenIds: ids });
    ids.observe(removed.doc, removed.affected.components);
    // Without isRetired, the new "B" claims the retired id b and the whole import is refused.
    const blind = await planImport(screen(["A", "B"]), removed.doc, new Map(), { replace: "tabs" });
    expect(applyOps(removed.doc, blind.ops, { registry, seenIds: ids }).errors[0]?.code).toBe("id_retired");
    const again = await planImport(screen(["A", "B"]), removed.doc, new Map(), { replace: "tabs", isRetired: (id) => ids.isRetired(removed.doc, "main", id) });
    const result = applyOps(removed.doc, again.ops, { registry, seenIds: ids });
    expect(result.errors).toEqual([]);
    expect(findLayer(result.doc.components.main!.layers, "a")).toBeDefined();
    expect(findLayer(result.doc.components.main!.layers, "b_2")).toBeDefined();
  });

  it("doesn't let a new layer take a kept id", async () => {
    // "Tab 2" outside the screen pushes the imported one to tab_3; an unmatched "Tab 2" comes first next time.
    const doc = applyOps(createEmptyDocument(), [{ op: "addLayer", layer: { type: "rectangle", name: "Tab 2" } }], { registry }).doc;
    const plan = await planImport(screen(["Tab 2"]), doc, new Map(), {});
    const first = applyOps(doc, plan.ops, { registry });
    expect(findLayer(first.doc.components.main!.layers, "tab_3")).toBeDefined();
    const again = await planImport(capture({ name: "Tabs", children: [{ kind: "frame", name: "Group", box: [0, 0, 402, 100], children: [{ kind: "frame", name: "Tab 2", nameRank: 5, box: [0, 0, 50, 40], fill: "#000000FF", children: [] }] }, { kind: "frame", name: "Tab 2", nameRank: 5, box: [0, 100, 100, 40], fill: "#EEEEEEFF", children: [] }] }), first.doc, new Map(), { replace: "tabs" });
    const result = applyOps(first.doc, again.ops, { registry });
    expect(result.errors).toEqual([]);
  });
});
