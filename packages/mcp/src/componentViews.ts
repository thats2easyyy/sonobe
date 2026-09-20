/**
 * Component views drawn from the document, for get_screenshot with `component` when no editor shows
 * it: the canvas (the component alone on its artboard at frame 0 with authored values, as the
 * editor's canvas draws it) and the patch graph (graphToSvg over the node boxes geometry.ts
 * resolves, with the live values of a deterministic runtime after a second). Headless hosts
 * rasterize these; the app draws them in its hidden scene window. Browser-safe.
 */

import { allLayers, artboardSize, componentDocument, type Id, type SonobeDocument } from "@sonobe/core";
import { deriveGraph } from "@sonobe/core/graph";
import { createRuntime, type EngineRegistry, type SceneFrame } from "@sonobe/engine";
import { graphToSvg } from "@sonobe/renderer/svg";
import { withLiveValues, type GraphGeometry } from "./geometry.ts";

/** Longest edge of a graph drawing in pixels (the screenshot cap). */
const MAX_EDGE = 2048;

/** The component on its own artboard at frame 0, with authored values: what the editor's canvas shows. */
export function designScene(doc: SonobeDocument, registry: EngineRegistry, componentId: Id): SceneFrame {
  const runtime = createRuntime(componentDocument(doc, componentId), {
    registry,
    deterministic: true,
    platform: {},
  });
  try {
    return runtime.step();
  } finally {
    runtime.dispose();
  }
}

const nameOf = (doc: SonobeDocument, componentId: Id) => doc.components[componentId]?.name ?? componentId;

/** What a canvas drawing shows, for the screenshot's notes. */
export function canvasNotes(doc: SonobeDocument, componentId: Id): string[] {
  if (componentId === doc.project.root)
    return ['Frame 0 with authored values, as the canvas shows it; target "viewer" shows the running prototype.'];
  const [w, h] = artboardSize(doc, componentId);
  return [`${nameOf(doc, componentId)} on its own ${w}×${h} artboard at frame 0 with authored values, as the canvas shows it.`];
}

/**
 * What a graph drawing shows, for the screenshot's notes. `offscreen`: the app drew it because its
 * patch editor isn't showing the component.
 */
export function graphNotes(doc: SonobeDocument, componentId: Id, drawing: GraphDrawing, offscreen: boolean): string[] {
  const name = nameOf(doc, componentId);
  const notes = offscreen
    ? [`The patch editor isn't showing ${name}, so this is drawn from the document the way it lays graphs out (node sizes are estimates). reveal with focus: true opens it for the person; then get_screenshot captures the editor itself.`]
    : ["Drawn from the document the way the patch editor lays it out: node sizes are estimates, and text uses this machine's fonts."];
  if (drawing.empty) notes.unshift(`${name}'s graph is empty: it has no patches, and no layer that a cable drives or reads.`);
  return notes;
}

export interface GraphDrawing {
  svg: string;
  /** Output size in pixels. */
  width: number;
  height: number;
  hasText: boolean;
  /** The graph has no nodes: no patches and no layer that a cable drives or reads. */
  empty: boolean;
}

/**
 * A component's patch graph as SVG, with every node where `geometry` puts it, sized to `scale`
 * pixels per point (default 1, at most 3) within `maxWidth` and the screenshot edge cap, in the
 * editor's dark theme unless `theme` says light.
 */
export function drawComponentGraph(
  doc: SonobeDocument,
  registry: EngineRegistry,
  componentId: Id,
  geometry: GraphGeometry,
  options: { scale?: number; maxWidth?: number; theme?: "dark" | "light" } = {},
): GraphDrawing {
  const model = deriveGraph({ doc, componentId, registry });
  const names = new Map(allLayers(doc.components[componentId]?.layers ?? []).map((l) => [l.id, l.name]));
  const layerName = (id: string) => names.get(id);
  const theme = options.theme ?? "dark";
  const draw = (scale: number, live?: (address: string) => unknown) =>
    graphToSvg(model, { boxes: geometry.nodes, layerName, scale, theme, ...(live ? { live } : {}) });
  return withLiveValues(doc, registry, componentId, (live) => {
    // Size the drawing once at 1 pt per pixel, then pick the scale that fits.
    const natural = draw(1, live);
    let scale = typeof options.scale === "number" && options.scale > 0 ? Math.min(options.scale, 3) : 1;
    if (options.maxWidth && natural.viewBox.width * scale > options.maxWidth)
      scale = options.maxWidth / natural.viewBox.width;
    const edge = Math.max(natural.viewBox.width, natural.viewBox.height) * scale;
    if (edge > MAX_EDGE) scale *= MAX_EDGE / edge;
    const drawing = scale === 1 ? natural : draw(scale, live);
    return {
      svg: drawing.svg,
      width: drawing.width,
      height: drawing.height,
      hasText: drawing.hasText,
      empty: geometry.nodes.size === 0,
    };
  });
}
