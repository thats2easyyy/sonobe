/**
 * The live preview over the artboard: the page Claude is writing, drawn in a sandboxed iframe where
 * the screen will land, with a pill saying what Claude is doing. It fades out onto the real layers.
 */

import type { JSX } from "react";
import type { Rect } from "../canvas/geometry.ts";
import type { Viewport } from "../canvas/viewport.ts";
import type { DesignTarget } from "./context.ts";
import type { DesignDraft } from "./designStore.ts";

export function DesignPreview(_props: { viewport: Viewport; bounds(id: string): Rect | null; componentId: string; rootId: string; artboard: [number, number]; box?: DesignTarget | null }): JSX.Element | null {
  throw new Error("not implemented");
}

/** Where a draft draws, in artboard points: over the layer it replaces, else at its position at its size; null when it's for another component. */
export function previewFrame(_draft: DesignDraft, _o: { componentId: string; rootId: string; artboard: [number, number]; bounds(id: string): Rect | null; fallbackReplace: string | null }): Rect | null {
  throw new Error("not implemented");
}
