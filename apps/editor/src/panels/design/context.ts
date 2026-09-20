/**
 * What the Design with Claude box tells the Assistant about the canvas: the component, its screens,
 * the layer the person picked to redesign, and the style digest of what's there.
 */

import { artboardSize, findLayer, formatStyleDigest, styleDigest, type InputValue, type LayerNode } from "@sonobe/core";
import type { EditorSession } from "../../state/session.ts";
import type { AssistantCanvasContext } from "../assistant/types.ts";
import type { DesignData } from "./designStore.ts";

export interface DesignTarget { id: string; name: string; type: string; isResult: boolean }

const MAX_SCREENS = 30;
const MAX_STYLES_CHARS = 1500;

/** One selected layer (unless newScreen), else null. isResult: it's the screen Claude just made. */
export function designTarget(session: EditorSession, design: Pick<DesignData, "newScreen" | "result">): DesignTarget | null {
  if (design.newScreen) return null;
  const layers = session.selection.getState().layers;
  if (layers.length !== 1) return null;
  const componentId = session.currentComponentId();
  const component = session.document.getState().doc.components[componentId];
  const layer = component ? findLayer(component.layers, layers[0]!)?.layer : undefined;
  if (!layer) return null;
  return { id: layer.id, name: layer.name, type: layer.type, isResult: design.result?.layerId === layer.id && design.result.component === componentId };
}

const pair = (value: InputValue | undefined): [number, number] | null => (Array.isArray(value) && value.length === 2 && value.every((n) => typeof n === "number" && Number.isFinite(n)) ? [value[0] as number, value[1] as number] : null);
const round = (n: number) => Math.round(n * 100) / 100;

/** The layer's rect in the component, as the canvas measures it; else from its own props (relative to its parent, when the canvas can't say). */
function frameOf(layer: LayerNode, bounds: (id: string) => { x: number; y: number; width: number; height: number } | null): [number, number, number, number] {
  const rect = bounds(layer.id);
  if (rect) return [round(rect.x), round(rect.y), round(rect.width), round(rect.height)];
  const [w, h] = pair(layer.props.size) ?? [0, 0];
  const [x, y] = pair(layer.props.position) ?? [0, 0];
  const [ax, ay] = pair(layer.props.anchor) ?? [0, 0];
  return [round(x - ax * w), round(y - ay * h), round(w), round(h)];
}

export function canvasContext(session: EditorSession, target: DesignTarget | null, bounds: (id: string) => { x: number; y: number; width: number; height: number } | null): AssistantCanvasContext {
  const { doc } = session.document.getState();
  const componentId = session.currentComponentId();
  const component = doc.components[componentId];
  const layers = component?.layers ?? [];
  const context: AssistantCanvasContext = {
    component: { id: componentId, name: component?.name ?? componentId, size: artboardSize(doc, componentId) },
    // Layer-list order: the front-most screen first.
    screens: layers
      .slice()
      .reverse()
      .slice(0, MAX_SCREENS)
      .map((l) => ({ id: l.id, name: l.name })),
  };
  const loc = target ? findLayer(layers, target.id) : undefined;
  if (loc) {
    const screen = loc.path.length > 1 ? layers.find((l) => l.id === loc.path[0]) : undefined;
    context.target = { id: loc.layer.id, name: loc.layer.name, type: loc.layer.type, frame: frameOf(loc.layer, bounds), ...(screen ? { screen: { id: screen.id, name: screen.name } } : {}) };
  }
  const styles = formatStyleDigest(styleDigest(doc, componentId)).slice(0, MAX_STYLES_CHARS);
  if (styles) context.styles = styles;
  return context;
}
