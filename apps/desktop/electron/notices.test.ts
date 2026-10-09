/** The third-party notices a packaged app ships (scripts/notices.ts), read from what the bundlers report. */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { afterAll, describe, expect, it } from "vitest";
import {
  carriedPackages,
  installedPackageDir,
  metafileInputs,
  noticePackages,
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

describe("packages carried inside another package's published files", () => {
  // A package whose dist already holds two others, as its own bundler left them: one from a pnpm
  // store, one from a plain node_modules. Its map also names its own sources, in and out of its folder.
  const modules = path.join(temp, "carried", "node_modules");
  const carrier = path.join(modules, "@acme", "carrier");
  const bundle = path.join(carrier, "dist", "index.mjs");
  const write = (file: string, text: string) => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  write(
    path.join(carrier, "package.json"),
    JSON.stringify({ name: "@acme/carrier", version: "2.0.0", license: "MIT" }),
  );
  write(path.join(carrier, "LICENSE"), "MIT License\n\nCopyright (c) Acme");
  write(bundle, "");
  const sources = [
    "../src/index.ts",
    "../../shared/src/util.ts",
    "../../../node_modules/.pnpm/inner@1.2.3/node_modules/inner/index.js",
    "../../../node_modules/.pnpm/inner@1.2.3/node_modules/inner/lib/more.js",
    "../../../node_modules/.pnpm/@scope+peered@4.0.0_inner@1.2.3/node_modules/@scope/peered/index.js",
    "../node_modules/ghost/index.js",
  ];
  write(`${bundle}.map`, JSON.stringify({ version: 3, sources }));
  // Installed here in another version than the carried one, as ajv is.
  write(
    path.join(modules, "inner", "package.json"),
    JSON.stringify({ name: "inner", version: "1.3.0", license: "BSD-3-Clause" }),
  );
  write(
    path.join(modules, "inner", "LICENSE"),
    "Redistribution and use in source and binary forms…",
  );
  write(
    path.join(modules, "@scope", "peered", "package.json"),
    JSON.stringify({ name: "@scope/peered", version: "4.0.0", license: "ISC" }),
  );
  write(path.join(modules, "@scope", "peered", "LICENSE.md"), "ISC License");
  const within = carrier.replaceAll("\\", "/");

  it("are named by the source map beside a bundled file, with the version a pnpm store path gives", () => {
    expect(carriedPackages([bundle, path.join(temp, "src", "own.ts")])).toEqual([
      { name: "@scope/peered", version: "4.0.0", within },
      { name: "inner", version: "1.2.3", within },
      { name: "ghost", version: undefined, within },
    ]);
    // A file without a map beside it carries nothing that can be known.
    expect(carriedPackages([path.join(carrier, "package.json")])).toEqual([]);
    expect(installedPackageDir("inner", carrier)).toBe(path.join(modules, "inner"));
    expect(installedPackageDir("ghost", carrier)).toBeUndefined();
  });

  it("get a notice with the carried version and the installed copy's license text", () => {
    const packages = noticePackages([bundle]);
    expect(packages.map((pkg) => `${pkg.name} ${pkg.version} ${pkg.license}`)).toEqual([
      "@acme/carrier 2.0.0 MIT",
      "@scope/peered 4.0.0 ISC",
      "inner 1.2.3 BSD-3-Clause",
      "ghost  UNKNOWN",
    ]);
    expect(packages[2]!.text).toBe("Redistribution and use in source and binary forms…");
    // Not installed, so there is nothing to read: the notice says where its code is, and the build warns.
    expect(packages[3]).toMatchObject({ text: undefined, carriedBy: "@acme/carrier" });
    const { text, missing } = renderNotices(packages);
    expect(missing).toEqual(["ghost"]);
    expect(text).toContain(
      "This package's code is inside @acme/carrier's published files, without its license",
    );
    expect(text).not.toContain("shared");
    // Bundled directly as well, in the carried version: one notice.
    write(
      path.join(modules, "inner", "package.json"),
      JSON.stringify({ name: "inner", version: "1.2.3", license: "BSD-3-Clause" }),
    );
    const names = noticePackages([bundle, path.join(modules, "inner", "index.js")]).map(
      (pkg) => pkg.name,
    );
    expect(names.filter((name) => name === "inner")).toHaveLength(1);
  });

  it("finds ajv and the rest inside the MCP SDK, which the app and the CLI bundle", async () => {
    const result = await build({
      absWorkingDir: root,
      stdin: {
        contents: 'export * from "@modelcontextprotocol/server";',
        resolveDir: path.join(root, "../../packages/mcp"),
      },
      bundle: true,
      write: false,
      metafile: true,
      platform: "node",
      logLevel: "silent",
    });
    const files = metafileInputs(result.metafile, root);
    // esbuild sees only the SDK's own files.
    expect(npmPackageDirs(files).map((dir) => path.basename(dir))).not.toContain("ajv");
    const packages = noticePackages(files);
    for (const [name, license] of [
      ["ajv", "MIT"],
      ["ajv-formats", "MIT"],
      ["fast-deep-equal", "MIT"],
      ["fast-uri", "BSD-3-Clause"],
      ["json-schema-traverse", "MIT"],
    ]) {
      const pkg = packages.find((candidate) => candidate.name === name);
      expect(pkg, name).toMatchObject({
        license,
        version: expect.stringMatching(/^\d+\.\d+\.\d+$/),
      });
      expect(pkg!.text?.length ?? 0, name).toBeGreaterThan(200);
    }
    // The SDK's own workspace folders, outside the published package, aren't packages.
    expect(packages.every((pkg) => !pkg.carriedBy && !pkg.name.includes("core-internal"))).toBe(
      true,
    );
  }, 30_000);
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
