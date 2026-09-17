/** Headless screenshots: SceneFrame → SVG → PNG through the real tools, checked pixel by pixel. */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { createHeadlessHost } from "./headless.ts";
import { rasterizeSvg, renderSceneScreenshot } from "./screenshot.ts";
import {
  buildGrowCard,
  connectClient,
  tempProject,
  type CallResult,
  type TempProject,
  type TestClient,
} from "./test-helpers.ts";

/** Decode an 8-bit RGBA PNG (what resvg writes). */
function decodePng(base64: string): {
  width: number;
  height: number;
  pixel(x: number, y: number): number[];
} {
  const buf = Buffer.from(base64, "base64");
  expect([...buf.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("latin1", offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect([data[8], data[9], data[12]]).toEqual([8, 6, 0]);
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1);
    const filter = raw[start]!;
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? out[y * stride + x - 4]! : 0;
      const b = y > 0 ? out[(y - 1) * stride + x]! : 0;
      const c = x >= 4 && y > 0 ? out[(y - 1) * stride + x - 4]! : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const predictor = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][
        filter
      ]!;
      out[y * stride + x] = (raw[start + 1 + x]! + predictor) & 255;
    }
  }
  return {
    width,
    height,
    pixel: (x, y) => [...out.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)],
  };
}

const png = (r: CallResult) => {
  expect(r.isError, r.text).toBe(false);
  const block = r.content.find((c) => c.type === "image");
  expect(block?.mimeType).toBe("image/png");
  return decodePng(block!.data!);
};
const isRed = (px: number[]) => px[0]! > 200 && px[1]! < 70 && px[2]! < 70 && px[3]! > 200;

let project: TempProject | undefined;
let client: TestClient | undefined;

afterEach(async () => {
  await client?.close();
  await project?.cleanup();
  client = undefined;
  project = undefined;
});

async function setup() {
  project = await tempProject();
  client = await connectClient(project.host);
  return client;
}

describe("headless screenshots", () => {
  it("draws the prototype screen and single layers as PNGs", async () => {
    const c = await setup();
    const added = await c.call("add_layers", {
      layers: [
        {
          type: "rectangle",
          name: "Card",
          props: { position: [20, 40], size: [100, 60], color: "#FF0000FF", cornerRadius: 12 },
        },
        {
          type: "oval",
          name: "Dot",
          props: { position: [200, 40], size: [40, 40], color: "#0000FFFF" },
        },
        {
          type: "text",
          name: "Label",
          props: { position: [20, 200], text: "Hello", textColor: "#000000FF" },
        },
      ],
    });
    expect(added.isError, added.text).toBe(false);
    const { doc } = await project!.host.getDocument();
    const shot = await c.call("get_screenshot", {});
    expect(shot.structured).toEqual({});
    const screen = png(shot);
    const size = doc.components[doc.project.root]!.size!;
    expect([screen.width, screen.height]).toEqual([
      Math.min(size[0], 800),
      Math.round(size[1] * Math.min(1, 800 / size[0])),
    ]);
    expect(isRed(screen.pixel(70, 70))).toBe(true);
    const blue = screen.pixel(220, 60);
    expect(blue[2]! > 200 && blue[0]! < 70).toBe(true);
    expect(isRed(screen.pixel(21, 41))).toBe(false);
    expect(shot.text).toContain("viewer · ");
    expect(shot.text).toContain("after start-up animations settle");
    expect(shot.text).toContain("Note: Text uses approximate font metrics");

    const card = png(await c.call("get_screenshot", { target: "@card", scale: 2 }));
    expect([card.width, card.height]).toEqual([200, 120]);
    expect(isRed(card.pixel(100, 60))).toBe(true);
    expect(isRed(card.pixel(1, 1))).toBe(false);
    expect(png(await c.call("get_screenshot", { maxWidth: 100 })).width).toBe(100);
  }, 30_000);

  it("draws a simulation's frame, later frames on a copy, and teaches bad requests", async () => {
    const c = await setup();
    await buildGrowCard(c);
    await c.call("set_values", { updates: [{ target: "@card.color", value: "#FF0000FF" }] });
    const simId = (await c.call("sim_reset", {})).structured.simId as string;
    await c.call("sim_dispatch", { simId, events: [{ kind: "tap", target: "@card" }] });
    const before = (await c.call("sim_get_values", { simId, targets: ["@card.scale"] })).structured;

    const later = await c.call("get_screenshot", { simId, atMs: 1500 });
    expect(isRed(png(later).pixel(15, 410))).toBe(true);
    expect(later.text).toContain(`${simId} + 1500 ms (session not advanced)`);
    const now = png(await c.call("get_screenshot", { simId }));
    expect(isRed(now.pixel(15, 410))).toBe(false);
    expect(isRed(now.pixel(40, 410))).toBe(true);
    const after = (await c.call("sim_get_values", { simId, targets: ["@card.scale"] })).structured;
    expect(after.frame).toBe(before.frame);
    expect(after.values).toEqual(before.values);

    const canvas = await c.call("get_screenshot", { target: "canvas" });
    expect(canvas.structured.error).toMatchObject({ code: "target_unavailable" });
    const missing = await c.call("get_screenshot", { target: "@nope" });
    expect(missing.structured.error).toMatchObject({ code: "not_found" });
    const badTarget = await c.call("get_screenshot", { target: "card" });
    expect(badTarget.structured.error).toMatchObject({ code: "invalid_target" });
    const badSim = await c.call("get_screenshot", { simId: "sim_99" });
    expect(badSim.structured.error).toMatchObject({ code: "unknown_sim" });
  }, 30_000);

  it("draws image assets from the project folder and notes placeholders", async () => {
    const c = await setup();
    const green = await rasterizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="#00ff00"/></svg>',
      { hasText: false },
    );
    await mkdir(path.join(project!.project, "assets"), { recursive: true });
    await writeFile(path.join(project!.project, "assets", "photo.png"), green.png);
    const r = await c.call("apply_ops", {
      ops: [
        {
          op: "addAsset",
          asset: {
            id: "photo",
            kind: "image",
            name: "Photo",
            file: "photo.png",
            width: 4,
            height: 4,
          },
        },
        {
          op: "addLayer",
          layer: {
            type: "image",
            name: "Hero",
            props: { size: [100, 100], image: { asset: "photo" }, fillMode: "stretch" },
          },
        },
        {
          op: "addLayer",
          layer: { type: "video", name: "Clip", props: { position: [0, 200], size: [100, 100] } },
        },
      ],
    });
    expect(r.isError, r.text).toBe(false);
    const shot = await c.call("get_screenshot", {});
    const px = png(shot).pixel(50, 50);
    expect(px[1]).toBeGreaterThan(200);
    expect(px[0]).toBeLessThan(70);
    expect(shot.text).toContain("Note: Video layers show a dark placeholder");
  }, 30_000);

  it("keeps drawing after the native renderer crashes", async () => {
    // resvg 2.6 panics, aborting its process, on a layer far outside the canvas. Rasterizing in a separate process keeps the server alive.
    const crashing =
      '<svg xmlns="http://www.w3.org/2000/svg" width="402" height="874"><g transform="translate(901 246)" opacity="0.5"><ellipse cx="46" cy="46" rx="46" ry="46" fill="#ffffff"/></g></svg>';
    await expect(rasterizeSvg(crashing, { hasText: false })).rejects.toMatchObject({
      code: "screenshot_renderer_crashed",
    });
    const ok = await rasterizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" width="3" height="2"><rect width="3" height="2" fill="#f00"/></svg>',
      { hasText: false },
    );
    expect([ok.width, ok.height]).toEqual([3, 2]);
  }, 30_000);

  it("draws a canonical example whose cards sit off screen", async () => {
    const host = createHeadlessHost();
    try {
      const { docId } = await host.openDocument(
        fileURLToPath(new URL("../../../examples/04-carousel-paging", import.meta.url)),
      );
      const shot = await host.screenshot({ kind: "viewer" }, { docId, maxWidth: 800 });
      expect([shot.width, shot.height]).toEqual([402, 874]);
      const card = await host.screenshot({ kind: "layer", layerId: "trip_4" }, { docId });
      expect([card.width, card.height]).toEqual([320, 480]);

      // The palette's tiles fade in after launch: by default the screenshot waits for that.
      const palette = await host.openDocument(
        fileURLToPath(new URL("../../../examples/15-grid-with-loops", import.meta.url)),
      );
      // Tile #01 is #E25050 once it has faded in; at launch the light background shows through.
      const reddish = (px: number[]) => px[0]! > 180 && px[1]! < 130 && px[2]! < 130;
      const settledTile = decodePng(
        (await host.screenshot({ kind: "layer", layerId: "tile#0" }, { docId: palette.docId }))
          .data,
      );
      expect(
        reddish(
          settledTile.pixel(Math.floor(settledTile.width / 2), Math.floor(settledTile.height / 2)),
        ),
      ).toBe(true);
      const launch = decodePng(
        (
          await host.screenshot(
            { kind: "layer", layerId: "tile#0" },
            { docId: palette.docId, atMs: 0 },
          )
        ).data,
      );
      expect(
        reddish(launch.pixel(Math.floor(launch.width / 2), Math.floor(launch.height / 2))),
      ).toBe(false);
    } finally {
      await host.close();
    }
  }, 30_000);

  it("redraws smaller to stay under the byte cap", async () => {
    const scene = {
      frame: 0,
      time: 0.5,
      size: [400, 400] as [number, number],
      background: { r: 1, g: 1, b: 1, a: 1 },
      roots: Array.from({ length: 40 }, (_, i) => ({
        key: `n${i}`,
        layerId: `n${i}`,
        type: "gradient",
        parentKey: null,
        x: 0,
        y: i * 10,
        width: 400,
        height: 10,
        transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, i * 10, 0, 1],
        worldTransform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, i * 10, 0, 1],
        opacity: 1,
        visible: true,
        clip: false,
        props: {
          gradient: {
            kind: "angular",
            stops: [
              { offset: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
              { offset: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
            ],
            start: [0.3, 0.5],
            end: [0.3, 0],
          },
        },
        children: [],
      })),
    };
    const full = await renderSceneScreenshot({ scene, target: { kind: "viewer" } });
    expect([full.width, full.height, full.timeMs]).toEqual([400, 400, 500]);
    const capped = await renderSceneScreenshot({
      scene,
      target: { kind: "viewer" },
      maxBytes: Math.floor(Buffer.from(full.data, "base64").byteLength / 3),
    });
    expect(capped.width).toBeLessThan(400);
    await expect(
      renderSceneScreenshot({ scene, target: { kind: "viewer" }, maxBytes: 10 }),
    ).rejects.toMatchObject({ code: "image_too_large" });
  }, 30_000);
});
