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
  /** Opened by keyboard focus, so the card's hint speaks of keys, not the pointer. */
  keyboard?: true;
}

/** Why a cable was refused, shown where it was dropped. */
export interface ConnectHintState {
  /** Where the cable was released, in viewport pixels. */
  client: { x: number; y: number };
  reason: string;
  hint?: string;
  converter?: { label: string; insert: () => void };
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
  connectHint: ConnectHintState | null;
  /** A cable picked up from its input end. */
  detaching: DetachState | null;
  /** Type of the port a cable is being dragged from (connection line color). */
  draggingType: ValueType | null;
  /** The node that cable started from, and which end the person holds (a picked-up cable is held by its output). */
  draggingFrom: string | null;
  draggingSide: PortSide | null;
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
  /** The view is zoomed far out (FAR_ZOOM): port text isn't painted, so output rows follow only what still shows of their live value. */
  farZoom: boolean;
  set: (partial: Partial<Omit<PatchEditorUiState, "set">>) => void;
}

export type UiStore = StoreApi<PatchEditorUiState>;

export function createUiStore(initial: { minimap?: boolean } = {}): UiStore {
  return createStore<PatchEditorUiState>()((set) => ({
    armed: null,
    hoverPort: null,
    connectHint: null,
    detaching: null,
    draggingType: null,
    draggingFrom: null,
    draggingSide: null,
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
    farZoom: false,
    // The keyboard card on an input reads "Arm an output first" once nothing is armed, so it goes when the arm ends.
    set: (partial) =>
      set((state) => {
        const armEnded = state.armed !== null && partial.armed === null;
        const staleCard = state.hoverPort?.keyboard === true && state.hoverPort.side === "in";
        return armEnded && staleCard && !("hoverPort" in partial) ? { ...partial, hoverPort: null } : partial;
      }),
  }));
}

export type { Id };
