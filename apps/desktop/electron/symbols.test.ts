/**
 * The app's SF Symbols renderer: when it's available, and (on a Mac with Xcode's command line tools)
 * the real sfsymbol helper, built into a temp folder the way scripts/build.mjs builds it.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SymbolRequest } from "@sonobe/import";
import { afterAll, describe, expect, it } from "vitest";
import { buildSymbolHelper } from "../scripts/sfsymbol.ts";
import { desktopSymbols, symbolHelperPath } from "./symbols.ts";

const base = { packaged: false, resourcesPath: "/App/Contents/Resources", mainDir: "/repo/apps/desktop/dist", platform: "darwin", systemVersion: "15.6.1", exists: () => true };

describe("desktop SF Symbols", () => {
  it("finds the helper in Resources/bin when packaged and in dist/bin in development", () => {
    expect(symbolHelperPath({ ...base, packaged: true })).toBe(path.join("/App/Contents/Resources", "bin", "sfsymbol"));
    expect(symbolHelperPath(base)).toBe(path.join("/repo/apps/desktop/dist", "bin", "sfsymbol"));
  });

  it("draws on macOS 13 or later with the helper, and says why not elsewhere", () => {
    expect(desktopSymbols(base).unavailable).toBeUndefined();
    expect(desktopSymbols({ ...base, platform: "win32" }).unavailable).toBe("SF Symbols come with macOS, so Sonobe draws them only on a Mac.");
    expect(desktopSymbols({ ...base, systemVersion: "12.7.4" }).unavailable).toBe("Drawing SF Symbols needs macOS 13 or later, and this Mac has macOS 12.7.4.");
    expect(desktopSymbols({ ...base, exists: () => false }).unavailable).toMatch(/isn't built\. Install Xcode's command line tools \(xcode-select --install\), then run node apps\/desktop\/scripts\/build\.mjs/);
    expect(desktopSymbols({ ...base, packaged: true, exists: () => false }).unavailable).toMatch(/missing its SF Symbols helper .*Reinstall Sonobe/);
  });
});

// mainDir/bin/sfsymbol, as in a development build.
const dir = mkdtempSync(path.join(tmpdir(), "sonobe-sfsymbol-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const built = process.platform === "darwin" ? buildSymbolHelper({ out: path.join(dir, "bin", "sfsymbol") }) : { skipped: "not a Mac", path: undefined };
const helper = built.path;
const renderer = () => desktopSymbols({ packaged: false, resourcesPath: dir, mainDir: dir, platform: process.platform, systemVersion: "26.0", exists: existsSync });

const request = (name: string, extra: Partial<SymbolRequest> = {}): SymbolRequest => ({ name, size: 17, weight: "regular", scale: "medium", colors: ["#000000FF"], ...extra });

/** Alpha channel of an SVG rasterized by resvg (what Sonobe's headless screenshots use) at `width` pixels. */
async function alpha(svg: string, width: number): Promise<{ width: number; height: number; a: Uint8Array }> {
  const { Resvg } = await import("@resvg/resvg-js");
  const image = new Resvg(svg, { fitTo: { mode: "width", value: width } }).render();
  const a = new Uint8Array(image.width * image.height);
  for (let i = 0; i < a.length; i++) a[i] = image.pixels[i * 4 + 3]!;
  return { width: image.width, height: image.height, a };
}

describe.skipIf(!helper)(`the sfsymbol helper${built.skipped ? ` (skipped: ${built.skipped})` : ""}`, () => {
  it("draws heart.fill as an SVG that matches SwiftUI's own 3x bitmap within a pixel", async () => {
    const [drawing] = await renderer().render([request("heart.fill", { colors: ["#F24D47FF"] })]);
    expect(drawing).toMatchObject({ ok: true, width: 21, height: 18 });
    if (!drawing?.ok || !drawing.svg) throw new Error("no SVG");
    expect(drawing.svg).toContain('fill="#F24D47"');
    const png = execFileSync(helper!, ["heart.fill", "--size", "17", "--format", "png"]);
    const reference = await alpha(`<svg xmlns="http://www.w3.org/2000/svg" width="63" height="54"><image href="data:image/png;base64,${png.toString("base64")}" width="63" height="54"/></svg>`, 63);
    const drawn = await alpha(drawing.svg, 63);
    expect([drawn.width, drawn.height]).toEqual([reference.width, reference.height]);
    // SwiftUI snaps its bitmap to whole pixels; allow a shift of up to one pixel.
    let best = Infinity;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        let off = 0;
        let ink = 0;
        for (let y = 0; y < reference.height; y++) {
          for (let x = 0; x < reference.width; x++) {
            const r = reference.a[y * reference.width + x]!;
            const sx = x + dx;
            const sy = y + dy;
            const d = sx >= 0 && sy >= 0 && sx < drawn.width && sy < drawn.height ? drawn.a[sy * drawn.width + sx]! : 0;
            if (r || d) ink++;
            if (Math.abs(r - d) > 64) off++;
          }
        }
        best = Math.min(best, off / ink);
      }
    }
    expect(best).toBeLessThan(0.01);
  });

  it("names close symbols for one this Mac doesn't have", async () => {
    let stderr = "";
    try {
      execFileSync(helper!, ["heart.filled"], { stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      expect((err as { status: number }).status).toBe(1);
      stderr = String((err as { stderr: Buffer }).stderr);
    }
    expect(stderr).toMatch(/“heart\.filled” isn't an SF Symbol on this Mac \(macOS [\d.]+\)\. Did you mean heart\.fill/);
    const [missing] = await renderer().render([request("close")]);
    expect(missing).toMatchObject({ ok: false, suggestions: expect.arrayContaining(["xmark"]) });
  });

  it("draws symbols with masks inside masks as a 3x PNG, and passes on Apple's restrictions", async () => {
    const [nested, restricted, palette] = await renderer().render([request("heart.slash.circle.fill", { size: 24 }), request("airplay.audio"), request("person.crop.circle.badge.plus", { colors: ["#0A84FFFF", "#34C759FF"] })]);
    expect(nested).toMatchObject({ ok: true, fallback: "masks inside masks", png: expect.stringMatching(/^iVBORw0KGgo/) });
    expect(restricted).toMatchObject({ ok: true, restriction: expect.stringContaining("AirPlay"), svg: expect.stringContaining("<svg") });
    // Palette colors reach the drawing.
    expect(palette).toMatchObject({ ok: true, svg: expect.stringMatching(/#0A84FF[\s\S]*#34C759|#34C759[\s\S]*#0A84FF/) });
  });

  it("lists every symbol this Mac has", () => {
    const names = execFileSync(helper!, ["--list"], { encoding: "utf8" }).trim().split("\n");
    expect(names.length).toBeGreaterThan(8000);
    expect(names).toContain("heart.fill");
  });
});
