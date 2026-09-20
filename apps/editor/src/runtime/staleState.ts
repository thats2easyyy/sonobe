/**
 * The restart offer. Edits hot-swap into the running prototype and keep its state, which is what
 * people want while tuning. But when a layer draws no copies (an empty_loop warning) and an edit
 * doesn't bring them back, the edit may have fixed the wiring while the prototype still holds state
 * from before it: a counter that already counted down, a switch that's on. A fresh copy of the new
 * document, stepped for two frames, tells the two apart. If it draws the layer, restarting helps, and
 * the viewer says "The prototype kept state from before your edit" with a Restart button. If the fresh
 * copy draws nothing either, the wiring empties the loop and the warning's own fixes apply.
 */

import { findLayer, layerDisplayName, type AssetRef, type Diagnostic, type Id, type SonobeDocument } from "@sonobe/core";
import { createRuntime, type EngineRegistry, type MediaInfo, type RuntimeIssue, type TextMeasurer } from "@sonobe/engine";
import { componentIdForInstancePath } from "./instances.ts";

/** A layer the live prototype draws no copies of, but a fresh start of the same document does. */
export interface StaleState {
  layerId: Id;
  /** Instance path of the layer's component instance ("main/card#2"); absent at the root. */
  componentPath?: string;
  /** Copies the fresh start drew. */
  copies: number;
}

export interface FreshStartOptions {
  registry: EngineRegistry;
  textMeasurer?: TextMeasurer;
  resolveAssetUrl?: (assetId: Id) => string | undefined;
  mediaInfo?: (ref: AssetRef) => MediaInfo | undefined;
  /** Frames the fresh copy runs. Default 2: one frame alone may be a list on its way to empty. */
  frames?: number;
}

const isEmptyLoop = (issue: RuntimeIssue) => issue.code === "empty_loop";
const sameSite = (a: RuntimeIssue, b: RuntimeIssue) => a.layerId === b.layerId && a.patchId === b.patchId && (a.componentPath ?? "") === (b.componentPath ?? "");

/**
 * The first layer with an empty_loop warning in `live` that a fresh start of `doc` draws, or null.
 * The fresh copy runs without platform services (no sound, network or haptics) and is thrown away.
 */
export function freshStartDraws(doc: SonobeDocument, live: readonly RuntimeIssue[], options: FreshStartOptions): StaleState | null {
  const empty = live.filter((issue) => isEmptyLoop(issue) && issue.layerId !== undefined);
  if (!empty.length) return null;
  const fresh = createRuntime(doc, {
    registry: options.registry,
    platform: {},
    deterministic: true,
    ...(options.textMeasurer ? { textMeasurer: options.textMeasurer } : {}),
    ...(options.resolveAssetUrl ? { resolveAssetUrl: options.resolveAssetUrl } : {}),
    ...(options.mediaInfo ? { mediaInfo: options.mediaInfo } : {}),
  });
  try {
    for (let i = 0; i < (options.frames ?? 2); i++) fresh.step();
    const stillEmpty = fresh.issues().filter(isEmptyLoop);
    for (const issue of empty) {
      if (stillEmpty.some((other) => sameSite(other, issue))) continue;
      // Any property reads the layer's copy count; every layer has opacity.
      const copies = fresh.inspect(`@${issue.componentPath ? `${issue.componentPath}/` : ""}${issue.layerId}.opacity`).copies ?? 0;
      if (copies > 0) return { layerId: issue.layerId!, ...(issue.componentPath ? { componentPath: issue.componentPath } : {}), copies };
    }
    return null;
  } catch {
    // A document the fresh copy can't run tells nothing either way.
    return null;
  } finally {
    fresh.dispose();
  }
}

/** Whether the live prototype still has the empty_loop warning behind `stale`. */
export function stillStale(stale: StaleState, live: readonly RuntimeIssue[]): boolean {
  return live.some((issue) => isEmptyLoop(issue) && issue.layerId === stale.layerId && (issue.componentPath ?? "") === (stale.componentPath ?? ""));
}

/** The layer's display name, from its component. */
export function staleLayerName(stale: StaleState, doc: SonobeDocument): string {
  const component = doc.components[componentIdForInstancePath(doc, stale.componentPath) ?? doc.project.root];
  const layer = component ? findLayer(component.layers, stale.layerId)?.layer : undefined;
  return layer ? layerDisplayName(layer) : stale.layerId;
}

/** The offer as a diagnostic, for get_diagnostics' Live viewer section (the viewer.diagnostics RPC). */
export function staleStateDiagnostic(stale: StaleState, doc: SonobeDocument): Diagnostic {
  const name = staleLayerName(stale, doc);
  const copies = `${stale.copies} ${stale.copies === 1 ? "copy" : "copies"}`;
  return {
    code: "stale_state",
    severity: "info",
    message: `The live prototype kept state from before the last edit: it draws no copies of Layer "${name}", but started fresh the same document draws ${copies}.`,
    hint: "Restart the prototype (restart_viewer, or Restart Prototype ⌘R in Sonobe) to see the edit from its first frame.",
    component: componentIdForInstancePath(doc, stale.componentPath) ?? doc.project.root,
    itemIds: [stale.layerId],
  };
}
