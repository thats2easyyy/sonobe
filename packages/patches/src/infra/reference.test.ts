import type { PatchSpec } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { PATCH_TYPES, SPECS } from "../specs.ts";
import { REFERENCE_BANNER, formatDefault, headingAnchor, renderPatchReference, renderReferenceFiles, renderReferenceIndex } from "./reference.ts";

const glow: PatchSpec = {
  type: "mockGlow",
  name: "Mock Glow",
  category: "layers",
  tier: 2,
  status: "web-limited",
  statusReason: "Needs WebGPU, which some browsers lack.",
  platforms: ["desktop", "web"],
  aliases: ["glow", "shine"],
  summary: "Adds a glow to a layer.",
  docs: "## How it works\nIt glows.",
  inputs: [
    { key: "layer", name: "Layer", type: "layer", default: null, description: "The layer." },
    { key: "radius", name: "Radius", type: "number", subtype: "distance", default: 12, min: 0, max: 100, step: 1, description: "How far | the glow spreads." },
    { key: "tint", name: "Tint", type: "variant", default: 0, description: "Tint." },
    { key: "mode", name: "Mode", type: "enum", default: "soft", enumOptions: [{ key: "soft", name: "Soft", description: "Gentle." }, { key: "hard", name: "Hard" }], description: "Glow mode." },
    { key: "curve", name: "Curve", type: "enum", default: "linear", enumOptions: [{ key: "linear", name: "Linear" }, { key: "cubicIn", name: "Cubic In" }], description: "Easing.", advanced: true },
  ],
  outputs: [{ key: "effect", name: "Effect", type: "layerEffect", description: "The effect." }],
  variants: ["number", "color"],
  variantDefaults: { color: { tint: "#FFFFFFFF" } },
  shortcut: "Shift+G",
  pairsWellWith: ["switch", "notAPatch"],
  commonMistakes: ["It doesn't glow: Radius is 0. Raise it."],
  examples: [{ title: "Glow on tap", description: "Tap to glow.", outline: "patch glow mockGlow radius=20" }],
  settings: [{ key: "quality", name: "Quality", type: "enum", default: "high", enumOptions: [{ key: "high", name: "High" }, { key: "low", name: "Low" }], description: "Render quality." }],
  origami: { id: "builtin.glow", name: "Glow" },
};

describe("renderPatchReference", () => {
  const page = renderPatchReference(glow, {
    specs: { switch: SPECS.switch! },
    behavior: { behavior: "Stateless.", importAliases: ["builtin.oldGlow"], origamiPorts: { radius: "Glow Radius" } },
  });

  it("renders the header, docs, and facts", () => {
    expect(page.startsWith(`${REFERENCE_BANNER}\n\n# Mock Glow\n\nAdds a glow to a layer.\n\n`)).toBe(true);
    expect(page).toContain("| Type key | `mockGlow` |");
    expect(page).toContain("| Category | [Layers & Effects](README.md#layers--effects) |");
    expect(page).toContain("| Tier | 2 (breadth) |");
    expect(page).toContain("| Status | Web-limited |");
    expect(page).toContain("| Shortcut | <kbd>Shift</kbd>+<kbd>G</kbd> |");
    expect(page).toContain("| Search terms | glow, shine |");
    expect(page).toContain("## How it works\nIt glows.");
    expect(page.endsWith("\n")).toBe(true);
    expect(page.endsWith("\n\n")).toBe(false);
  });

  it("renders ports, options, settings, and types", () => {
    expect(page).toContain("| **Radius**<br>`radius` | `number` (distance) | `12` | How far \\| the glow spreads. Range 0 to 100, step 1. |");
    expect(page).toContain("| **Layer**<br>`layer` | `layer` | none | The layer. |");
    expect(page).toContain("| **Curve**<br>`curve` | `enum` · advanced | `linear` | Easing. Options: Linear (`linear`), Cubic In (`cubicIn`). |");
    expect(page).toContain("**Mode options**\n\n- **Soft** (`soft`): Gentle.\n- **Hard** (`hard`)");
    expect(page).toContain("| **Effect**<br>`effect` | `layerEffect` | The effect. |");
    expect(page).toContain("## Settings");
    expect(page).toContain("| **Quality**<br>`quality` | `enum` | `high` | Render quality. Options: High (`high`), Low (`low`). |");
    expect(page).toContain("`number` (default), `color`.");
    expect(page).toContain("| `color` | `tint` | `#FFFFFFFF` |");
  });

  it("renders examples, mistakes, pairings, availability, and Origami mapping", () => {
    expect(page).toContain("### Glow on tap\n\nTap to glow.\n\n```text\npatch glow mockGlow radius=20\n```");
    expect(page).toContain("## Common mistakes\n\n- It doesn't glow: Radius is 0. Raise it.");
    expect(page).toContain(`- [Switch](switch.md): ${SPECS.switch!.summary}`);
    expect(page).toContain("- `notAPatch`");
    expect(page).toContain("**Web-limited.** Needs WebGPU, which some browsers lack.");
    expect(page).toContain("Works in the desktop app and the web player in desktop browsers.");
    const everywhere = renderPatchReference({ ...glow, platforms: ["desktop", "web", "mobile"] }, { specs: {} });
    expect(everywhere).toContain("Works in the desktop app, the web player in desktop browsers, and the web player on phones and tablets.");
    expect(page).toContain("- **Origami patch:** Glow (`builtin.glow`)\n- **Also imports:** `builtin.oldGlow`");
    expect(page).toContain("| `radius` | Glow Radius |");
  });

  it("covers native patches, empty ports, and variadic outputs", () => {
    const { origami: _origami, ...native } = glow;
    const sender: PatchSpec = {
      ...native,
      inputs: [],
      outputs: [],
      variadic: { key: "option", name: "Option", type: "variant", min: 2, max: 32, defaultCount: 2, startIndex: 0, direction: "outputs", description: "Per option." },
    };
    const text = renderPatchReference(sender, { specs: {} });
    expect(text).toContain("Sonobe-native: Origami has no matching patch.");
    expect(text).toContain("This patch has no fixed inputs.");
    expect(text).toContain("### Repeating outputs\n\n**Option 0, Option 1, …** (`option0`, `option1`, …) · `variant`");
    expect(text).toContain("A patch can have 2 to 32 of these, and a new patch starts with 2.");
  });
});

describe("reference helpers", () => {
  it("formats defaults", () => {
    expect(formatDefault(undefined, "pulse")).toBe("—");
    expect(formatDefault(null, "image")).toBe("none");
    expect(formatDefault({ loop: [] }, "number")).toBe("empty loop");
    expect(formatDefault({ loop: [1, 2] }, "number")).toBe("loop `[1,2]`");
    expect(formatDefault("smooth", "enum")).toBe("`smooth`");
    expect(formatDefault("On", "text")).toBe('`"On"`');
    expect(formatDefault("#FFFFFFFF", "variant")).toBe("`#FFFFFFFF`");
    expect(formatDefault([0, 0], "point")).toBe("`[0, 0]`");
    expect(formatDefault({}, "json")).toBe("`{}`");
    expect(formatDefault(true, "boolean")).toBe("`true`");
  });

  it("builds GitHub anchors", () => {
    expect(headingAnchor("State & Time")).toBe("state--time");
    expect(headingAnchor("Data & Network")).toBe("data--network");
  });

  it("indexes patches by category", () => {
    const index = renderReferenceIndex([glow, SPECS.switch!]);
    expect(index).toContain("**2 patches** in 2 categories: 1 everyday essentials (tier 1), 1 for breadth (tier 2), and 0 hardware and platform-specific patches (tier 3).");
    expect(index.indexOf("## State & Time")).toBeLessThan(index.indexOf("## Layers & Effects"));
    expect(index).toContain("| [Mock Glow](mockGlow.md) | `mockGlow` | Adds a glow to a layer. | 2 | Web-limited |");
    expect(index).toContain("| [State & Time](#state--time) |");
    expect(index).toContain("| Web-limited | Works only on some platforms or browsers, or needs a permission, a tap first, a secure page, or special hardware. | 1 |");
  });
});

describe("renderReferenceFiles", () => {
  it("renders a page for every catalog patch with working links", () => {
    const files = renderReferenceFiles();
    expect(Object.keys(files).sort()).toEqual(["README.md", ...PATCH_TYPES.map((t) => `${t}.md`)].sort());
    const readme = files["README.md"]!;
    const anchors = new Set([...readme.matchAll(/^## (.+)$/gm)].map((m) => headingAnchor(m[1]!)));
    const problems: string[] = [];
    for (const m of readme.matchAll(/\]\(#([a-z0-9-]+)\)/g)) if (!anchors.has(m[1]!)) problems.push(`README.md: broken anchor #${m[1]}`);
    for (const [name, content] of Object.entries(files)) {
      if (!content.startsWith(REFERENCE_BANNER)) problems.push(`${name}: missing banner`);
      if (!content.endsWith("\n") || content.endsWith("\n\n")) problems.push(`${name}: should end with exactly one newline`);
      for (const m of content.matchAll(/\]\(([A-Za-z0-9]+\.md)(?:#([a-z0-9-]+))?\)/g)) {
        if (!Object.hasOwn(files, m[1]!)) problems.push(`${name}: broken link ${m[1]}`);
        if (m[2] && m[1] === "README.md" && !anchors.has(m[2])) problems.push(`${name}: broken anchor ${m[2]}`);
      }
      if (name !== "README.md") {
        for (const heading of ["## Inputs", "## Outputs", "## Availability", "## Origami mapping"]) {
          if (!content.includes(`\n${heading}\n`)) problems.push(`${name}: missing ${heading}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
