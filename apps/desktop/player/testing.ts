/**
 * The web player served from source, for tests: bundles player.ts the way scripts/build.mjs does and
 * runs the real LAN preview server (electron/lan-preview.ts) on one document. Used by
 * player.browser.test.ts and the Sonobe Viewer iPhone tests (apps/ios/scripts/test.mjs). Node only.
 */

import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SonobeDocument } from "@sonobe/core";
import { buildDoc } from "@sonobe/engine/testing";
import { createPatchRegistry } from "@sonobe/patches";
import { build, type BuildOptions } from "esbuild";
import { startLanPreview } from "../electron/lan-preview.ts";
import { externalLottiePlugin, leanCatalogPlugin } from "../scripts/player-bundle.ts";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The token in test player URLs: http://<host>:<port>/p/haptic-check/ */
export const TEST_PLAYER_TOKEN = "haptic-check";

/**
 * "Haptic Check": a full-screen tap target and a tap counter. Notification Success plays once at start;
 * every tap plays Impact Medium and a 50 ms Vibrate.
 */
export function hapticCheckDocument(): SonobeDocument {
  return buildDoc(
    {
      name: "Haptic Check",
      device: "iphone-17-pro",
      layers: [
        { id: "surface", type: "rectangle", name: "Tap Anywhere", props: { position: [0, 0], size: [402, 874], color: "#1c1c22" } },
        { id: "count", type: "text", name: "Tap Count", props: { position: [24, 380], size: [354, 60], text: { link: "count_text.text" }, fontSize: 34, textColor: "#ffffff" } },
      ],
      patches: {
        start: { type: "whenPrototypeStarts" },
        hello: { type: "haptic", inputs: { play: { link: "start.started" }, type: "notificationSuccess" } },
        touch: { type: "interaction", inputs: { layer: { layer: "surface" } } },
        tick: { type: "haptic", inputs: { play: { link: "touch.tap" }, type: "impactMedium" } },
        buzz: { type: "vibrate", inputs: { vibrate: { link: "touch.tap" }, duration: 0.05 } },
        taps: { type: "counter", inputs: { increase: { link: "touch.tap" } } },
        count_text: { type: "formatNumber", inputs: { value: { link: "taps.count" } } },
      },
    },
    createPatchRegistry(),
  );
}

/** Bundles the player (player.js, lottie.js, index.html, player.css) into `outDir`. */
export async function buildPlayer(outDir: string): Promise<void> {
  const page: BuildOptions = {
    absWorkingDir: desktopRoot,
    bundle: true,
    platform: "browser",
    format: "iife",
    target: ["es2022", "safari16"],
    minify: true,
    logLevel: "silent",
    define: { __SONOBE_VERSION__: JSON.stringify("test") },
  };
  await build({ ...page, entryPoints: ["player/player.ts"], outfile: path.join(outDir, "player.js"), plugins: [leanCatalogPlugin(), externalLottiePlugin()] });
  await build({ ...page, entryPoints: ["player/lottie.ts"], outfile: path.join(outDir, "lottie.js") });
  for (const file of ["index.html", "player.css"]) cpSync(path.join(desktopRoot, "player", file), path.join(outDir, file));
}

export interface TestPlayerServer {
  /** The player URL on `host`. */
  url: string;
  port: number;
  close(): Promise<void>;
}

/** Builds the player and serves `doc` on http://<host>:<port>/p/<token>/ (default 127.0.0.1, a free port). */
export async function servePlayer(options: { doc: SonobeDocument; host?: string; port?: number; token?: string }): Promise<TestPlayerServer> {
  const playerRoot = mkdtempSync(path.join(tmpdir(), "sonobe-player-"));
  try {
    await buildPlayer(playerRoot);
    const host = options.host ?? "127.0.0.1";
    const token = options.token ?? TEST_PLAYER_TOKEN;
    const handle = await startLanPreview({
      playerRoot,
      host,
      port: options.port ?? 0,
      token,
      version: "test",
      getDocument: async () => ({ docId: "doc_test", name: options.doc.project.name, revision: 1, doc: options.doc }),
    });
    return {
      url: `http://${host}:${handle.port}/p/${token}/`,
      port: handle.port,
      async close() {
        await handle.close();
        rmSync(playerRoot, { recursive: true, force: true });
      },
    };
  } catch (err) {
    rmSync(playerRoot, { recursive: true, force: true });
    throw err;
  }
}
