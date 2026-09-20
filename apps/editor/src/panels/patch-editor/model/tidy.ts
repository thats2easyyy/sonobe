/**
 * Tidy Up in the patch editor: the shared frame-aware tidy from @sonobe/core/graph (planTidy), laid
 * out by ELK's layered algorithm, which loads on first use.
 */

import { createElkGroupLayout, type GroupLayout } from "@sonobe/core/graph";
import type { ELK } from "elkjs/lib/elk-api.js";
import elkBundleUrl from "elkjs/lib/elk.bundled.js?url";

let elkPromise: Promise<ELK> | undefined;

const ELK_MODULE: string = "elkjs/lib/elk.bundled.js";

/**
 * ELK's GWT build needs a sloppy-mode global, so browsers load it as a classic script (bundlers that
 * wrap it as an ES module break it); Node imports it as a module.
 */
function loadElk(): Promise<ELK> {
  elkPromise ??= (async () => {
    const g = globalThis as { ELK?: new () => ELK; location?: { protocol?: string } };
    const browser = typeof document !== "undefined" && import.meta.env?.MODE !== "test" && /^(https?|file|app):$/.test(g.location?.protocol ?? "");
    if (browser) {
      if (!g.ELK) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement("script");
          script.src = elkBundleUrl;
          script.async = true;
          script.onload = () => resolve();
          script.onerror = () => reject(new Error("The layout engine couldn't load."));
          document.head.appendChild(script);
        });
      }
      if (!g.ELK) throw new Error("The layout engine didn't start.");
      return new g.ELK();
    }
    // Node and tests only. The specifier isn't a literal, so browser builds don't emit a second copy of ELK as a chunk.
    const mod = (await import(/* @vite-ignore */ ELK_MODULE)) as unknown as { default: new () => ELK };
    return new mod.default();
  })();
  elkPromise.catch(() => {
    elkPromise = undefined;
  });
  return elkPromise;
}

/** The group layout Tidy Up uses: ELK layered, left to right. */
export async function elkGroupLayout(): Promise<GroupLayout> {
  return createElkGroupLayout(await loadElk());
}
