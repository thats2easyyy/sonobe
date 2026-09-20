/**
 * Live camera feeds in video layers. A Camera patch hands the prototype a live reference
 * (`{ live: "camera/<key>" }`); the browser platform holds its MediaStream, and these overlays show
 * it as a muted, inline <video> inside the video layer's element, fitted like the layer's fill mode.
 * The editor's viewers and the web player both use it.
 */

import type { AssetRef } from "@sonobe/core";
import type { SceneFrame, SceneNode } from "@sonobe/engine";
import { liveKeyOf } from "./platform.ts";

/** The streams behind live references (BrowserPlatform has both). */
export interface LiveStreams {
  liveSources(): string[];
  liveStream(live: string): MediaStream | undefined;
}

export interface LiveVideoOverlays {
  /** Add, move and remove overlays to match the scene. */
  sync(scene: SceneFrame): void;
  dispose(): void;
}

const FIT: Record<string, string> = { fill: "cover", fit: "contain", stretch: "fill", tile: "none" };

/** A video prop's live reference key, if it holds one. */
function liveKeyOfProp(value: unknown): string | undefined {
  if (typeof value === "string") return liveKeyOf({ url: value });
  return value && typeof value === "object" ? liveKeyOf(value as AssetRef) : undefined;
}

export function createLiveVideoOverlays(renderer: { elementForKey(key: string): HTMLElement | undefined }, streams: LiveStreams): LiveVideoOverlays {
  const overlays = new Map<string, { el: HTMLVideoElement; live: string }>();
  const remove = (key: string, overlay: { el: HTMLVideoElement }) => {
    overlay.el.srcObject = null;
    overlay.el.remove();
    overlays.delete(key);
  };
  return {
    sync(scene) {
      const sources = streams.liveSources();
      if (!sources.length && !overlays.size) return;
      const wanted = new Map<string, { live: string; node: SceneNode }>();
      if (sources.length) {
        const stack: SceneNode[] = [...scene.roots];
        while (stack.length) {
          const node = stack.pop()!;
          stack.push(...node.children);
          if (node.type !== "video") continue;
          const live = liveKeyOfProp(node.props.video);
          if (live && streams.liveStream(live)) wanted.set(node.key, { live, node });
        }
      }
      for (const [key, overlay] of overlays) {
        if (wanted.get(key)?.live === overlay.live && overlay.el.isConnected) continue;
        remove(key, overlay);
      }
      for (const [key, { live, node }] of wanted) {
        const host = renderer.elementForKey(key);
        if (!host) continue;
        let overlay = overlays.get(key);
        if (!overlay) {
          const el = host.ownerDocument.createElement("video");
          el.className = "sonobe-media";
          el.setAttribute("data-sonobe-live", live);
          el.muted = true;
          el.playsInline = true;
          el.autoplay = true;
          el.srcObject = streams.liveStream(live) ?? null;
          (host.querySelector(".sonobe-body") ?? host).appendChild(el);
          void el.play?.()?.catch?.(() => undefined);
          overlay = { el, live };
          overlays.set(key, overlay);
        }
        const fit = FIT[String(node.props.fillMode ?? "fill")] ?? "cover";
        if (overlay.el.style.objectFit !== fit) overlay.el.style.objectFit = fit;
      }
    },
    dispose() {
      for (const [key, overlay] of [...overlays]) remove(key, overlay);
    },
  };
}
