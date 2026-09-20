import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { WalkOptions } from "./dom/walk.ts";
import { CAPTURE_BUDGETS, createCaptureRun } from "./run.ts";
import { symbolHelper } from "./sfsymbol.ts";
import { symbolNotes, unavailableSymbols, walkPage, type SymbolPaint, type SymbolRequest, type SymbolSlot } from "./symbols.ts";

const dir = mkdtempSync(path.join(tmpdir(), "sonobe-sfsymbol-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A stand-in for the sfsymbol helper: a Node script that answers --batch requests. */
function fakeHelper(name: string, body: string): string {
  const file = path.join(dir, name);
  writeFileSync(file, `#!/usr/bin/env node\nconst lines = require("fs").readFileSync(0, "utf8").trim().split("\\n").map((l) => JSON.parse(l));\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}

const request = (name: string, extra: Partial<SymbolRequest> = {}): SymbolRequest => ({ name, size: 17, weight: "regular", scale: "medium", colors: ["#000000FF"], ...extra });

describe("the sfsymbol helper client", () => {
  it("sends one JSON line per request and returns the answers in order", async () => {
    const helper = fakeHelper(
      "ok",
      `if (process.argv[2] !== "--batch") process.exit(9);
      // Answer out of order, to check results follow the ids.
      for (const r of lines.reverse()) console.log(JSON.stringify(r.name === "nope" ? { id: r.id, ok: false, error: "no", suggestions: ["yes"] } : { id: r.id, ok: true, svg: "<svg>" + r.name + " " + r.weight + " " + r.colors.join() + "</svg>", width: r.size, height: 18, restriction: r.name === "facetime" ? "Only FaceTime." : undefined }));`,
    );
    const drawn: number[] = [];
    const results = await symbolHelper(helper).render([request("heart.fill", { weight: "bold", colors: ["#F24D47FF"] }), request("nope"), request("facetime")], { onDrawn: (done) => drawn.push(done) });
    expect(results).toEqual([
      { ok: true, svg: "<svg>heart.fill bold #F24D47FF</svg>", width: 17, height: 18 },
      { ok: false, error: "no", suggestions: ["yes"] },
      { ok: true, svg: "<svg>facetime regular #000000FF</svg>", width: 17, height: 18, restriction: "Only FaceTime." },
    ]);
    expect(drawn).toEqual([1, 2, 3]);
  });

  it("explains a missing helper, and one that stops early", async () => {
    await expect(symbolHelper(path.join(dir, "missing")).render([request("heart")])).rejects.toThrow(`the SF Symbols helper isn't at ${path.join(dir, "missing")}`);
    const crashing = fakeHelper("crash", `console.error("sfsymbol: ran out of paper"); process.exit(3);`);
    await expect(symbolHelper(crashing).render([request("heart")])).rejects.toThrow("the SF Symbols helper stopped (exit code 3): sfsymbol: ran out of paper");
  });

  it("stops the helper when the capture is cancelled", async () => {
    const slow = fakeHelper("slow", "setTimeout(() => {}, 60_000);");
    const controller = new AbortController();
    const drawing = symbolHelper(slow).render([request("heart")], { signal: controller.signal });
    setTimeout(() => controller.abort(), 100);
    const started = Date.now();
    await expect(drawing).rejects.toThrow("drawing was cancelled");
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

describe("walkPage", () => {
  afterEach(() => vi.useRealTimers());

  /** A page stand-in: answers the collect, apply and walker scripts. */
  function fakePage(slots: SymbolSlot[]) {
    const applied: SymbolPaint[][] = [];
    const walked: WalkOptions[] = [];
    const evaluate = async (script: string): Promise<unknown> => {
      if (script.startsWith("window.__sonobeCollectSymbols(")) return slots;
      const apply = /window\.__sonobeApplySymbols\((.*)\)$/s.exec(script);
      if (apply) return applied.push(JSON.parse(apply[1]!) as SymbolPaint[]);
      const walk = /^window\.__sonobeCapture\((.*)\)$/s.exec(script);
      if (walk) return (walked.push(JSON.parse(walk[1]!) as WalkOptions), { format: "sonobe.design-capture" });
      return undefined;
    };
    return { evaluate, applied, walked };
  }

  it("skips drawing when the page has no placeholders, and doesn't wait twice", async () => {
    const page = fakePage([]);
    const renderer = { render: vi.fn(async () => []) };
    const run = createCaptureRun();
    await walkPage(page.evaluate, { run, walk: { waitFor: "#ready", waitMs: 500, selector: "#card" }, symbols: renderer });
    run.dispose();
    expect(renderer.render).not.toHaveBeenCalled();
    expect(page.applied).toEqual([]);
    expect(page.walked).toEqual([{ selector: "#card", settleMs: 0 }]);
  });

  it("gives up on a renderer that doesn't answer within its budget: placeholders, a note, and the capture goes on", async () => {
    vi.useFakeTimers();
    const page = fakePage([{ slot: 0, request: request("heart.fill", { size: 20 }) }]);
    let stopped = false;
    const renderer = {
      render: (_requests: readonly SymbolRequest[], options?: { signal?: AbortSignal }) =>
        new Promise<never>(() => options?.signal?.addEventListener("abort", () => (stopped = true))),
    };
    const run = createCaptureRun();
    const walking = walkPage(page.evaluate, { run, walk: {}, symbols: renderer });
    await vi.advanceTimersByTimeAsync(CAPTURE_BUDGETS.symbols);
    const { notes } = await walking;
    run.dispose();
    expect(stopped).toBe(true);
    expect(page.applied).toEqual([[{ slot: 0, width: 20, height: 20 }]]);
    expect(notes).toEqual(["The SF Symbol “heart.fill” is a gray placeholder: Sonobe couldn't draw SF Symbols within 20 seconds. Try the import again."]);
    expect(page.walked).toHaveLength(1);
  });
});

describe("SF Symbol notes", () => {
  it("groups placeholders by reason, and lists at most five names", async () => {
    const names = ["a", "b", "c", "d", "e", "f", "g"];
    const reason = "Sonobe draws SF Symbols only on a Mac.";
    const results = await unavailableSymbols(reason).render(names.map((n) => request(n)));
    expect(results.every((r) => !r.ok && r.error === reason)).toBe(true);
    expect(symbolNotes(names.map((n) => request(n)), results)).toEqual([`The SF Symbols “a”, “b”, “c”, “d”, “e” and 2 more are gray placeholders: ${reason}`]);
  });

  it("reports a failed drawing for every symbol, bitmaps and restrictions once per reason", () => {
    const requests = [request("x"), request("y")];
    expect(symbolNotes(requests, [], "Sonobe couldn't draw SF Symbols (the SF Symbols helper stopped).")).toEqual(["The SF Symbols “x” and “y” are gray placeholders: Sonobe couldn't draw SF Symbols (the SF Symbols helper stopped)."]);
    const drawn = [
      { ok: true as const, png: "AA", width: 1, height: 1, fallback: "masks inside masks", restriction: "Only AirPlay." },
      { ok: true as const, png: "AA", width: 1, height: 1, fallback: "masks inside masks", restriction: "Only AirPlay." },
    ];
    expect(symbolNotes(requests, drawn)).toEqual(["“x” and “y” are 3x bitmaps rather than vectors (they use masks inside masks), so they blur when scaled up.", "Apple restricts “x” and “y”: Only AirPlay."]);
  });
});
