import { describe, expect, it } from "vitest";
import type { TextMeasurer } from "../types.ts";
import { computeLayout, type LayoutNode, type LayoutProps } from "./computeLayout.ts";

/** Deterministic monospace measurer: each glyph is fontSize × 0.5 wide; greedy word wrap. */
const mono: TextMeasurer = {
  measure(text, style, maxWidth) {
    const cw = style.fontSize * 0.5 + style.letterSpacing;
    const lh = style.lineHeight > 0 ? style.lineHeight : style.fontSize * 1.2;
    let lines = 0;
    let widest = 0;
    for (const para of text.split("\n")) {
      if (maxWidth === null) {
        lines++;
        widest = Math.max(widest, para.length * cw);
        continue;
      }
      let chars = 0;
      for (const word of para.split(" ")) {
        const need = chars > 0 ? chars + 1 + word.length : word.length;
        if (chars > 0 && need * cw > maxWidth) {
          lines++;
          widest = Math.max(widest, chars * cw);
          chars = word.length;
        } else {
          chars = need;
        }
      }
      lines++;
      widest = Math.max(widest, chars * cw);
    }
    return { width: widest, height: Math.max(1, lines) * lh };
  },
};

function n(
  key: string,
  type: string,
  props: LayoutProps = {},
  children: LayoutNode[] = [],
): LayoutNode {
  return { key, type, props, children };
}

function frame(results: ReturnType<typeof computeLayout>, key: string) {
  const r = results.get(key);
  if (!r) throw new Error(`no layout for ${key}`);
  return [r.x, r.y, r.width, r.height];
}

const box = (key: string, w: number, h: number, extra: LayoutProps = {}) =>
  n(key, "rectangle", { size: [w, h], ...extra });

describe("absolute positioning and size modes", () => {
  it("position is the anchor point from the parent's top-left", () => {
    const root = n("root", "group", {}, [
      box("card", 100, 50, { position: [200, 100], anchor: [0.5, 0.5] }),
    ]);
    const out = computeLayout(root, mono, [400, 800]);
    expect(frame(out, "root")).toEqual([0, 0, 400, 800]);
    expect(frame(out, "card")).toEqual([150, 75, 100, 50]);
  });

  it("the root fills rootSize regardless of its own props", () => {
    const root = n("root", "group", { size: [10, 10], position: [99, 99], widthMode: "auto" });
    expect(frame(computeLayout(root, mono, [390, 844]), "root")).toEqual([0, 0, 390, 844]);
  });

  it("percent sizes use the parent's inner size", () => {
    const root = n("root", "group", {}, [
      n("panel", "group", { size: [220, 120], padding: [10, 10, 10, 10] }, [
        box("half", 50, 25, { widthMode: "percent", heightMode: "percent", position: [10, 10] }),
      ]),
    ]);
    const out = computeLayout(root, mono, [400, 800]);
    expect(frame(out, "half")).toEqual([10, 10, 100, 25]);
  });

  it("grow fills the parent's inner size without layout", () => {
    const root = n("root", "group", { padding: 20 }, [
      box("fill", 0, 0, { widthMode: "grow", heightMode: "grow" }),
    ]);
    expect(frame(computeLayout(root, mono, [400, 300]), "fill")).toEqual([0, 0, 360, 260]);
  });

  it("colorFill always fills its parent", () => {
    const root = n("root", "group", {}, [
      n("row", "group", { size: [300, 100], layout: "row", padding: 10, spacing: 10 }, [
        n("bg", "colorFill"),
        box("a", 50, 50),
        box("b", 50, 50),
      ]),
    ]);
    const out = computeLayout(root, mono, [400, 800]);
    expect(frame(out, "bg")).toEqual([0, 0, 300, 100]);
    expect(frame(out, "a")).toEqual([10, 10, 50, 50]);
    expect(frame(out, "b")).toEqual([70, 10, 50, 50]);
  });

  it("tolerates missing and invalid props", () => {
    const root = n("root", "group", {}, [
      n("weird", "rectangle", {
        position: "nope" as unknown as number[],
        widthMode: "banana",
        size: [-5, 20],
      }),
    ]);
    expect(frame(computeLayout(root, mono, [400, 800]), "weird")).toEqual([0, 0, 0, 20]);
  });
});

describe("row and column layout", () => {
  it("row: grow shares remaining main-axis space", () => {
    const root = n("root", "group", {}, [
      n("row", "group", { size: [300, 50], layout: "row", padding: [5, 5, 5, 5], spacing: 10 }, [
        box("a", 50, 20),
        box("b", 0, 20, { widthMode: "grow" }),
        box("c", 70, 20),
      ]),
    ]);
    const out = computeLayout(root, mono, [400, 800]);
    expect(frame(out, "a")).toEqual([5, 5, 50, 20]);
    expect(frame(out, "b")).toEqual([65, 5, 150, 20]);
    expect(frame(out, "c")).toEqual([225, 5, 70, 20]);
  });

  it("row: several growers split equally; grow on the cross axis stretches", () => {
    const root = n("root", "group", {}, [
      n("row", "group", { size: [300, 60], layout: "row", spacing: 10, padding: 10 }, [
        box("a", 0, 20, { widthMode: "grow", heightMode: "grow" }),
        box("b", 0, 20, { widthMode: "grow" }),
        box("c", 70, 20),
      ]),
    ]);
    const out = computeLayout(root, mono, [400, 800]);
    // inner 280 − fixed 70 − two gaps 20 = 190, shared by two growers
    expect(frame(out, "a")).toEqual([10, 10, 95, 40]);
    expect(frame(out, "b")).toEqual([115, 10, 95, 20]);
    expect(frame(out, "c")).toEqual([220, 10, 70, 20]);
  });

  it("column: stretch on the cross axis and grow on the main axis", () => {
    const root = n("root", "group", {}, [
      n("col", "group", { size: [200, 300], layout: "column", spacing: 10 }, [
        box("header", 0, 40, { widthMode: "grow" }),
        box("body", 80, 0, { heightMode: "grow" }),
        box("footer", 80, 30),
      ]),
    ]);
    const out = computeLayout(root, mono, [400, 800]);
    expect(frame(out, "header")).toEqual([0, 0, 200, 40]);
    expect(frame(out, "body")).toEqual([0, 50, 80, 210]);
    expect(frame(out, "footer")).toEqual([0, 270, 80, 30]);
  });

  it("padding plus 9-point alignment positions the children block", () => {
    const root = n("root", "group", {}, [
      n(
        "col",
        "group",
        {
          size: [200, 200],
          layout: "column",
          padding: [10, 20, 30, 40],
          spacing: 5,
          alignment: "bottomRight",
        },
        [box("a", 50, 20), box("b", 80, 30)],
      ),
    ]);
    const out = computeLayout(root, mono, [400, 800]);
    expect(frame(out, "a")).toEqual([130, 115, 50, 20]);
    expect(frame(out, "b")).toEqual([100, 140, 80, 30]);
  });

  it("row alignment center centers the block and each child on the cross axis", () => {
    const root = n("root", "group", {}, [
      n("row", "group", { size: [300, 100], layout: "row", spacing: 10, alignment: "center" }, [
        box("a", 40, 40),
        box("b", 60, 20),
      ]),
    ]);
    const out = computeLayout(root, mono, [400, 800]);
    expect(frame(out, "a")).toEqual([95, 30, 40, 40]);
    expect(frame(out, "b")).toEqual([145, 40, 60, 20]);
  });

  it("spacing modes: between and evenly", () => {
    const kids = () => [box("a", 50, 50), box("b", 50, 50), box("c", 50, 50)];
    const between = computeLayout(
      n("root", "group", {}, [
        n("row", "group", { size: [300, 50], layout: "row", spacingMode: "between" }, kids()),
      ]),
      mono,
      [400, 800],
    );
    expect([between.get("a")!.x, between.get("b")!.x, between.get("c")!.x]).toEqual([0, 125, 250]);
    const evenly = computeLayout(
      n("root", "group", {}, [
        n("row", "group", { size: [300, 50], layout: "row", spacingMode: "evenly" }, kids()),
      ]),
      mono,
      [400, 800],
    );
    expect([evenly.get("a")!.x, evenly.get("b")!.x, evenly.get("c")!.x]).toEqual([
      37.5, 125, 212.5,
    ]);
    const single = computeLayout(
      n("root", "group", {}, [
        n(
          "row",
          "group",
          { size: [300, 50], layout: "row", spacingMode: "between", alignment: "right" },
          [box("a", 50, 50)],
        ),
      ]),
      mono,
      [400, 800],
    );
    expect(single.get("a")!.x).toBe(250);
  });

  it("absolute children ignore the flow; disabled children take no space", () => {
    const root = n("root", "group", {}, [
      n("row", "group", { size: [300, 100], layout: "row" }, [
        box("a", 50, 50),
        box("badge", 20, 20, { positioning: "absolute", position: [290, 90], anchor: [1, 1] }),
        box("hidden", 80, 50, { enabled: false }),
        box("b", 50, 50),
      ]),
    ]);
    const out = computeLayout(root, mono, [400, 800]);
    expect(frame(out, "a")).toEqual([0, 0, 50, 50]);
    expect(frame(out, "b")).toEqual([50, 0, 50, 50]);
    expect(frame(out, "badge")).toEqual([270, 70, 20, 20]);
  });
});

describe("grid layout", () => {
  const cells = (count: number, extra: (i: number) => LayoutProps = () => ({})) =>
    Array.from({ length: count }, (_, i) => box(`c${i}`, 70, 40, extra(i)));

  it("wraps by inner width with spacing on both axes", () => {
    const root = n("root", "group", {}, [
      n("grid", "group", { size: [250, 200], layout: "grid", spacing: 10 }, cells(5)),
    ]);
    const out = computeLayout(root, mono, [400, 800]);
    expect([0, 1, 2, 3, 4].map((i) => [out.get(`c${i}`)!.x, out.get(`c${i}`)!.y])).toEqual([
      [0, 0],
      [80, 0],
      [160, 0],
      [0, 50],
      [80, 50],
    ]);
    expect(out.get("grid")!.contentSize).toEqual([230, 90]);
  });

  it("aligns each line and the block", () => {
    const root = n("root", "group", {}, [
      n(
        "grid",
        "group",
        { size: [250, 200], layout: "grid", spacing: 10, alignment: "center" },
        cells(5),
      ),
    ]);
    const out = computeLayout(root, mono, [400, 800]);
    expect([0, 1, 2, 3, 4].map((i) => [out.get(`c${i}`)!.x, out.get(`c${i}`)!.y])).toEqual([
      [10, 55],
      [90, 55],
      [170, 55],
      [50, 105],
      [130, 105],
    ]);
  });

  it("grow items take the rest of their line", () => {
    const root = n("root", "group", {}, [
      n(
        "grid",
        "group",
        { size: [250, 200], layout: "grid", spacing: 10, padding: 0 },
        cells(5, (i) => (i === 1 ? { widthMode: "grow", heightMode: "grow" } : {})),
      ),
    ]);
    const out = computeLayout(root, mono, [400, 800]);
    expect(frame(out, "c1")).toEqual([80, 0, 90, 40]);
    expect(frame(out, "c2")).toEqual([180, 0, 70, 40]);
  });

  it("hugging grid width stays on one line", () => {
    const root = n("root", "group", {}, [
      n(
        "grid",
        "group",
        { layout: "grid", spacing: 10, widthMode: "auto", heightMode: "auto" },
        cells(4),
      ),
    ]);
    const out = computeLayout(root, mono, [400, 800]);
    expect(frame(out, "grid")).toEqual([0, 0, 310, 40]);
  });
});

describe("auto sizing (hug)", () => {
  it("row hugs children plus padding and spacing", () => {
    const root = n("root", "group", {}, [
      n(
        "chip",
        "group",
        {
          layout: "row",
          widthMode: "auto",
          heightMode: "auto",
          padding: [8, 12, 8, 12],
          spacing: 6,
        },
        [box("icon", 40, 20), box("label", 60, 30)],
      ),
    ]);
    const out = computeLayout(root, mono, [400, 800]);
    expect(frame(out, "chip")).toEqual([0, 0, 130, 46]);
    expect(frame(out, "label")).toEqual([58, 8, 60, 30]);
  });

  it("column hugs; no-layout groups hug their children's bounds", () => {
    const root = n("root", "group", {}, [
      n("col", "group", { layout: "column", widthMode: "auto", heightMode: "auto", spacing: 6 }, [
        box("a", 40, 20),
        box("b", 60, 30),
      ]),
      n("free", "group", { widthMode: "auto", heightMode: "auto" }, [
        box("p", 50, 50, { position: [10, 10] }),
        box("q", 20, 80, { position: [100, 0] }),
      ]),
    ]);
    const out = computeLayout(root, mono, [400, 800]);
    expect(frame(out, "col")).toEqual([0, 0, 60, 56]);
    expect(frame(out, "free")).toEqual([0, 0, 120, 80]);
  });

  it("nested hugging containers propagate sizes", () => {
    const root = n("root", "group", {}, [
      n(
        "outer",
        "group",
        { layout: "column", widthMode: "auto", heightMode: "auto", padding: 10, spacing: 4 },
        [
          n(
            "inner",
            "group",
            { layout: "row", widthMode: "auto", heightMode: "auto", spacing: 2 },
            [box("x", 30, 10), box("y", 30, 12)],
          ),
          box("z", 20, 20),
        ],
      ),
    ]);
    const out = computeLayout(root, mono, [400, 800]);
    expect(frame(out, "inner")).toEqual([10, 10, 62, 12]);
    expect(frame(out, "z")).toEqual([10, 26, 20, 20]);
    expect(frame(out, "outer")).toEqual([0, 0, 82, 56]);
  });

  it("grow children keep their size when the parent hugs; percent children don't count", () => {
    const root = n("root", "group", {}, [
      n("row", "group", { layout: "row", widthMode: "auto", heightMode: "auto" }, [
        box("g", 40, 20, { widthMode: "grow" }),
        box("f", 60, 20),
        box("p", 50, 100, { widthMode: "percent", heightMode: "percent" }),
      ]),
    ]);
    const out = computeLayout(root, mono, [400, 800]);
    expect(frame(out, "row")).toEqual([0, 0, 100, 20]);
    expect(frame(out, "g")).toEqual([0, 0, 40, 20]);
    expect(frame(out, "p")).toEqual([100, 0, 50, 20]);
  });
});

describe("text", () => {
  const text = (key: string, value: string, extra: LayoutProps = {}) =>
    n(key, "text", { text: value, fontSize: 20, ...extra });

  it("auto width and height hug the measured single line", () => {
    const out = computeLayout(
      n("root", "group", {}, [text("t", "Hello world", { position: [10, 20] })]),
      mono,
      [400, 800],
    );
    expect(frame(out, "t")).toEqual([10, 20, 110, 24]);
    expect(out.get("t")!.contentSize).toEqual([110, 24]);
  });

  it("fixed width with auto height wraps", () => {
    const out = computeLayout(
      n("root", "group", {}, [
        text("t", "Hello world again", { widthMode: "fixed", size: [60, 0] }),
      ]),
      mono,
      [400, 800],
    );
    expect(frame(out, "t")).toEqual([0, 0, 60, 72]);
    expect(out.get("t")!.contentSize).toEqual([50, 72]);
  });

  it("grow width in a column wraps at the container width and the container hugs the height", () => {
    const root = n("root", "group", {}, [
      n(
        "card",
        "group",
        { layout: "column", size: [200, 0], heightMode: "auto", padding: [0, 10, 0, 10] },
        [text("body", "aaaa bbbb cccc dddd", { widthMode: "grow" })],
      ),
    ]);
    const out = computeLayout(root, mono, [400, 800]);
    expect(frame(out, "body")).toEqual([10, 0, 180, 48]);
    expect(frame(out, "card")).toEqual([0, 0, 200, 48]);
  });

  it("maxLines limits auto height; explicit line height is used", () => {
    const out = computeLayout(
      n("root", "group", {}, [
        text("clamped", "Hello world again", { widthMode: "fixed", size: [60, 0], maxLines: 2 }),
        text("tall", "Hi", { lineHeight: 30 }),
      ]),
      mono,
      [400, 800],
    );
    expect(out.get("clamped")!.height).toBe(48);
    expect(out.get("tall")!.height).toBe(30);
  });

  it("uses the default approximate measurer when none is given", () => {
    const out = computeLayout(n("root", "group", {}, [n("t", "text", { text: "Hello" })]));
    const t = out.get("t")!;
    expect(t.width).toBeGreaterThan(20);
    expect(t.height).toBeCloseTo(17 * 1.2, 9);
    expect(frame(out, "root")).toEqual([0, 0, 390, 844]);
  });
});

describe("content size", () => {
  it("reports scrollable content extent including padding", () => {
    const rows = Array.from({ length: 10 }, (_, i) => box(`row${i}`, 390, 100));
    const out = computeLayout(
      n("root", "group", {}, [
        n(
          "list",
          "group",
          { size: [390, 844], layout: "column", spacing: 10, padding: [20, 0, 20, 0] },
          rows,
        ),
      ]),
      mono,
      [390, 844],
    );
    expect(out.get("list")!.contentSize).toEqual([390, 1130]);
    expect(out.get("row9")!.y).toBe(20 + 9 * 110);
  });

  it("leaf content size is its own size; empty groups report padding", () => {
    const out = computeLayout(
      n("root", "group", {}, [
        box("r", 30, 40),
        n("empty", "group", { layout: "row", padding: [1, 2, 3, 4] }),
      ]),
      mono,
      [400, 800],
    );
    expect(out.get("r")!.contentSize).toEqual([30, 40]);
    expect(out.get("empty")!.contentSize).toEqual([6, 4]);
  });
});
