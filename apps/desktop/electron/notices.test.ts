/** The third-party notices a packaged app ships (scripts/notices.ts), read from what the bundlers report. */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { afterAll, describe, expect, it } from "vitest";
import {
  metafileInputs,
  npmPackageDirs,
  readNoticePackage,
  renderNotices,
  sourceMapInputs,
} from "../scripts/notices.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
/** An installed package's folder, wherever npm hoisted it. */
const installed = (name: string) => {
  const entry = require.resolve(name).replaceAll("\\", "/");
  return entry.slice(0, entry.lastIndexOf(`/node_modules/${name}/`)) + `/node_modules/${name}`;
};

const temp = mkdtempSync(path.join(tmpdir(), "sonobe-notices-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

describe("npmPackageDirs", () => {
  it("maps bundled files to their package folders, once each, and leaves this repository's code out", () => {
    expect(
      npmPackageDirs([
        "/repo/node_modules/zod/v4/core/index.js",
        "/repo/node_modules/zod/index.js",
        "/repo/node_modules/@anthropic-ai/sdk/client.mjs",
        // A package's own nested dependency is that dependency's folder.
        "/repo/node_modules/qrcode/node_modules/pngjs/lib/png.js",
        "C:\\repo\\node_modules\\ws\\lib\\websocket.js",
        "/repo/packages/core/src/document.ts",
        "/repo/node_modules/@sonobe/core/src/index.ts",
        "/repo/node_modules/@scope",
      ]),
    ).toEqual([
      "/repo/node_modules/@anthropic-ai/sdk",
      "/repo/node_modules/qrcode/node_modules/pngjs",
      "/repo/node_modules/zod",
      "C:/repo/node_modules/ws",
    ]);
  });

  it("finds the packages in a real bundle through esbuild's metafile", async () => {
    // The scene page bundles lottie-web; the preload bundles no package at all.
    const bundle = (entry: string) =>
      build({
        absWorkingDir: root,
        entryPoints: [entry],
        bundle: true,
        write: false,
        metafile: true,
        platform: "node",
        external: ["electron"],
        logLevel: "silent",
      });
    const scene = npmPackageDirs(metafileInputs((await bundle("scene/scene.ts")).metafile, root));
    expect(scene).toContain(installed("lottie-web"));
    expect(scene.every((dir) => path.isAbsolute(dir) && !dir.includes("@sonobe"))).toBe(true);
    expect(
      npmPackageDirs(metafileInputs((await bundle("electron/preload.ts")).metafile, root)),
    ).toEqual([]);
  }, 30_000);

  it("finds the packages in a Vite build through its source maps", () => {
    const assets = path.join(temp, "dist", "assets");
    mkdirSync(assets, { recursive: true });
    const sources = ["../../../node_modules/react/index.js", "../../src/App.tsx"];
    writeFileSync(path.join(assets, "index.js.map"), JSON.stringify({ version: 3, sources }));
    writeFileSync(path.join(assets, "index.js"), "");
    expect(npmPackageDirs(sourceMapInputs(path.join(temp, "dist")))).toEqual([
      path.join(path.dirname(temp), "node_modules", "react").replaceAll("\\", "/"),
    ]);
    expect(sourceMapInputs(path.join(temp, "missing"))).toEqual([]);
  });
});

describe("the notices file", () => {
  const packages = ["zod", "ws", "elkjs", "@anthropic-ai/sdk"].map((name) =>
    readNoticePackage(installed(name)),
  );

  it("reads each package's name, license and license text from its folder", () => {
    for (const pkg of packages) {
      expect(pkg.version, pkg.name).toMatch(/^\d+\.\d+\.\d+/);
      expect(pkg.license, pkg.name).not.toBe("UNKNOWN");
      expect(pkg.text?.length ?? 0, pkg.name).toBeGreaterThan(200);
    }
    expect(packages.map((pkg) => pkg.name)).toEqual(["zod", "ws", "elkjs", "@anthropic-ai/sdk"]);
    expect(packages[0]).toMatchObject({
      license: "MIT",
      repository: expect.stringMatching(/^https:/),
    });
  });

  it("lists them sorted, the same way every time, each with its license text", () => {
    const { text, missing } = renderNotices(packages);
    expect(missing).toEqual([]);
    expect(renderNotices([...packages].reverse()).text).toBe(text);
    expect(text).toContain("4 packages");
    const order = packages.map((pkg) => text.indexOf(`\n${pkg.name} ${pkg.version}\n`));
    expect(order.every((at) => at > 0)).toBe(true);
    // @anthropic-ai/sdk, elkjs, ws, zod.
    expect([order[3], order[2], order[1], order[0]]).toEqual([...order].sort((a, b) => a - b));
    for (const pkg of packages) {
      expect(text).toContain(`License: ${pkg.license}`);
      expect(text).toContain(pkg.text!);
    }
  });

  it("says so when a package ships no license file, and names it", () => {
    const bare = path.join(temp, "node_modules", "bare");
    mkdirSync(bare, { recursive: true });
    const pkg = {
      name: "bare",
      version: "1.0.0",
      license: "ISC",
      repository: { url: "git+https://example.com/bare.git" },
    };
    writeFileSync(path.join(bare, "package.json"), JSON.stringify(pkg));
    const read = readNoticePackage(bare);
    expect(read).toEqual({
      name: "bare",
      version: "1.0.0",
      license: "ISC",
      repository: "https://example.com/bare",
      text: undefined,
    });
    const { text, missing } = renderNotices([read]);
    expect(missing).toEqual(["bare"]);
    expect(text).toContain("This package ships no license file. It is licensed under ISC");
    expect(text).toContain("Source: https://example.com/bare");
  });
});
