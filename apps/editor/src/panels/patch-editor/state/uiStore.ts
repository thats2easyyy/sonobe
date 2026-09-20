/** Transient patch editor UI state: armed ports, hover cards, cable drags, knife strokes, ghosts. */

import type { Id, ValueType } from "@sonobe/core";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Point, Rect } from "../model/geometry.ts";
import type { PortSide } from "../model/types.ts";

export interface ArmedPort {
  nodeId: string;
  handleId: string;
  address: string;
  type: ValueType;
  label: string;
}

export interface HoverPort {
  nodeId: string;
  address: string;
  side: PortSide;
  /** Viewport rect of the row. */
  rect: { x: number; y: number; width: number; height: number };
}

export interface DetachState {
  edgeId: string;
  from: string;
  to: string;
  sourceNode: string;
  sourceHandle: string;
  sourceType: ValueType;
}

export interface PatchEditorUiState {
  /** An output clicked for shift-click fan-out. */
  armed: ArmedPort | null;
  hoverPort: HoverPort | null;
  /** A cable picked up from its input end. */
  detaching: DetachState | null;
  /** Type of the port a cable is being dragged from (connection line color). */
  draggingType: ValueType | null;
  /** Cable highlighted for splicing while dragging a patch with ⌘ held. */
  spliceEdge: string | null;
  /** Knife stroke in canvas-local screen coordinates. */
  knife: readonly Point[] | null;
  /** Where Option-drag copies will land from (flow coordinates). */
  ghosts: readonly Rect[] | null;
  selectedEdges: readonly string[];
  minimap: boolean;
  /** Node whose title is being edited. */
  editingTitle: string | null;
  /** An input row flashed to draw the eye (a property you asked to drive). */
  highlightPort: string | null;
  /** The port under the pointer right now (⌥P publishes it). */
  pointerPort: { nodeId: string; address: string; side: PortSide } | null;
  /** The component just created: committing `editingTitle` names the component, not the patch. */
  namingComponent: Id | null;
  /** The most items a looped live value shown here has (0 when none is a loop): what the watched copy steps through. */
  loopCopies: number;
  set: (partial: Partial<Omit<PatchEditorUiState, "set">>) => void;
}

export type UiStore = StoreApi<PatchEditorUiState>;

export function createUiStore(initial: { minimap?: boolean } = {}): UiStore {
  return createStore<PatchEditorUiState>()((set) => ({
    armed: null,
    hoverPort: null,
    detaching: null,
    draggingType: null,
    spliceEdge: null,
    knife: null,
    ghosts: null,
    selectedEdges: [],
    minimap: initial.minimap ?? false,
    editingTitle: null,
    highlightPort: null,
    pointerPort: null,
    namingComponent: null,
    loopCopies: 0,
    set: (partial) => set(partial),
  }));
}

export type { Id };
