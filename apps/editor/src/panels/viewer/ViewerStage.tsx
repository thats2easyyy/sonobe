/**
 * ViewerStage: the running prototype in a CSS device frame, scaled to fit or shown 1:1, with outlines
 * for hovered and selected layers, the hit target overlay, and empty and error states. Pointer and
 * key input goes straight to the prototype.
 */

import type { Diagnostic, Id } from "@sonobe/core";
import type { SceneFrame } from "@sonobe/engine";
import { createDeviceFrame, type DeviceFrame, type DeviceFrameLayout } from "@sonobe/renderer";
import { CircleAlert, Layers } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import type { ViewerHandle } from "../../runtime/runtimeHost.ts";
import { currentComponentId, itemKindOf } from "../../state/selection.ts";
import type { EditorSession } from "../../state/session.ts";
import { Button } from "../../ui/Button.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { cx } from "../../ui/lib/cx.ts";
import { useLatest } from "../../ui/lib/hooks.ts";
import { useElementSize } from "../../ui/lib/useElementSize.ts";
import { watchPressedCopy } from "../patch-editor/api.ts";
import { registerBoundsProvider } from "./hostBridge.ts";
import { fitScale, interactiveLayerIds, layerScreenRect, nodesForLayers, outlinePoints, presetForDevice, sceneKeysForLayers, type HighlightScope, type ViewerZoom } from "./viewerModel.ts";
import "./viewer.css";

export interface ViewerStageProps {
  session: EditorSession;
  showFrame: boolean;
  zoom: ViewerZoom;
  showHitTargets: boolean;
  /** Answer viewer bounds (MCP screenshots) from this stage. Default true. */
  primary?: boolean;
  /** The effective scale, whenever it changes. */
  onScaleChange?: (scale: number) => void;
  className?: string;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const STAGE_PADDING = 20;

interface HighlightTargets {
  selected: ReadonlySet<Id>;
  hovered: Id | null;
  scope: HighlightScope;
}

interface HighlightOverlay {
  setTargets(targets: HighlightTargets): void;
  render(scene: SceneFrame | null): void;
  dispose(): void;
}

/** Outlines for highlighted layers, drawn in prototype coordinates on top of the renderer's stage. */
function createHighlightOverlay(container: HTMLElement): HighlightOverlay {
  const svg = container.ownerDocument.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "sb-vw-highlight");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("preserveAspectRatio", "none");
  container.appendChild(svg);
  const pool: SVGPolygonElement[] = [];
  let targets: HighlightTargets = { selected: new Set(), hovered: null, scope: "root" };
  /** null forces the next render to redraw (an empty key means "draw nothing"). */
  let lastKey: string | null = null;
  let lastSize = "";

  return {
    setTargets(next) {
      targets = next;
      lastKey = null;
    },
    render(scene) {
      if (!scene) return;
      const size = `0 0 ${scene.size[0]} ${scene.size[1]}`;
      if (size !== lastSize) {
        lastSize = size;
        svg.setAttribute("viewBox", size);
      }
      const selected = targets.selected.size ? nodesForLayers(scene, targets.selected, targets.scope) : [];
      const hovered = targets.hovered && !targets.selected.has(targets.hovered) ? nodesForLayers(scene, new Set([targets.hovered]), targets.scope) : [];
      const items: [string, string][] = [...hovered.map((n): [string, string] => ["hover", outlinePoints(n)]), ...selected.map((n): [string, string] => ["selected", outlinePoints(n)])];
      const key = items.map((i) => i.join(":")).join("|");
      if (key === lastKey) return;
      lastKey = key;
      while (pool.length < items.length) {
        const polygon = container.ownerDocument.createElementNS(SVG_NS, "polygon");
        svg.appendChild(polygon);
        pool.push(polygon);
      }
      pool.forEach((polygon, i) => {
        const item = items[i];
        if (!item) {
          polygon.style.display = "none";
          return;
        }
        polygon.style.display = "";
        polygon.setAttribute("data-kind", item[0]);
        polygon.setAttribute("points", item[1]);
      });
    },
    dispose() {
      svg.remove();
    },
  };
}

export function ViewerStage({ session, showFrame, zoom, showHitTargets, primary = true, onScaleChange, className }: ViewerStageProps) {
  const device = useStore(session.document, (s) => s.doc.project.device);
  const rootExists = useStore(session.document, (s) => !!s.doc.components[s.doc.project.root]);
  const empty = useStore(session.document, (s) => (s.doc.components[s.doc.project.root]?.layers.length ?? 0) === 0);
  const diagnostics = useStore(session.runtime.state, (s) => s.diagnostics);
  const errors = useMemo(() => diagnostics.filter((d) => d.severity === "error"), [diagnostics]);
  const preset = useMemo(() => presetForDevice(device), [device]);
  const orientation = device.orientation ?? "portrait";

  const [scrollRef, box] = useElementSize<HTMLDivElement>();
  const hostRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<DeviceFrame | null>(null);
  const viewerRef = useRef<ViewerHandle | null>(null);
  const overlayRef = useRef<HighlightOverlay | null>(null);
  const [layout, setLayout] = useState<DeviceFrameLayout | null>(null);
  const initial = useLatest({ preset, showFrame, orientation, primary });

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const { preset: p, showFrame: frameOn, orientation: o, primary: isPrimary } = initial.current;
    const frame = createDeviceFrame(host, p, { showFrame: frameOn, orientation: o });
    frameRef.current = frame;
    setLayout(frame.layout);
    // Pressing one copy of a looped layer watches it in the patch editor and the inspector, as on the canvas.
    const viewer = session.runtime.attachRenderer(frame.screen, { primary: isPrimary, scale: 1, onPress: (hits) => watchPressedCopy(session, hits) });
    frame.screen.setAttribute("aria-label", "Prototype. Click or tap to interact.");
    viewerRef.current = viewer;
    const overlay = createHighlightOverlay(frame.screen);
    overlayRef.current = overlay;
    const unsubscribe = session.runtime.subscribeFrame((scene) => overlay.render(scene));
    return () => {
      unsubscribe();
      overlay.dispose();
      viewer.dispose();
      frame.dispose();
      frameRef.current = null;
      viewerRef.current = null;
      overlayRef.current = null;
    };
  }, [session, initial]);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    frame.update(preset, { showFrame, orientation });
    setLayout(frame.layout);
  }, [preset, showFrame, orientation]);

  const scale = layout ? (zoom === "actual" ? 1 : fitScale([layout.width, layout.height], [box.width, box.height], STAGE_PADDING)) : 0.3;

  useLayoutEffect(() => {
    const el = frameRef.current?.element;
    if (el) el.style.transform = scale === 1 ? "" : `scale(${scale})`;
  }, [scale, layout]);

  const onScale = useLatest(onScaleChange);
  useEffect(() => {
    onScale.current?.(scale);
  }, [scale, onScale]);

  // Screenshots of one layer (MCP get_screenshot): the union of the layer's visible copies on screen,
  // from the live scene. Scene keys, and layers this stage can't find, go to the viewer's own measure.
  useEffect(() => {
    if (!primary) return;
    const registration = registerBoundsProvider(session, "viewer.layerBounds", (params) => {
      const p = (params && typeof params === "object" ? params : {}) as { layerId?: unknown; id?: unknown; key?: unknown };
      const viewer = viewerRef.current;
      if (!viewer) return null;
      const key = typeof p.key === "string" ? p.key : null;
      const layerId = typeof params === "string" ? params : typeof p.layerId === "string" ? p.layerId : typeof p.id === "string" ? p.id : null;
      const measureElement = () => (typeof viewer.layerBounds === "function" && (key || layerId) ? viewer.layerBounds({ ...(layerId ? { layerId } : {}), ...(key ? { key } : {}) }) : null);
      if (key || !layerId) return measureElement();
      const r = viewer.renderer.stage.getBoundingClientRect();
      return layerScreenRect(session.runtime.scene(), layerId, { x: r.left, y: r.top, width: r.width, height: r.height }) ?? measureElement();
    });
    return registration.dispose;
  }, [session, primary]);

  // Outline hovered and selected layers of the component being edited.
  useEffect(() => {
    const apply = () => {
      const s = session.selection.getState();
      const doc = session.document.getState().doc;
      const component = currentComponentId(s);
      const hovered = s.hovered && s.hovered.kind === "layer" && s.hovered.component === component && s.hovered.source !== "viewer" ? s.hovered.id : null;
      overlayRef.current?.setTargets({ selected: new Set(s.layers), hovered, scope: component === doc.project.root ? "root" : "instance" });
      overlayRef.current?.render(session.runtime.scene());
    };
    apply();
    return session.selection.subscribe(apply);
  }, [session]);

  // Tint layers that receive touches (Hit Areas plus layers wired to interaction patches).
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (!showHitTargets) {
      viewer.setShowHitTargets(false);
      return;
    }
    let lastKeys: string | null = null;
    const refresh = () => {
      const keys = sceneKeysForLayers(session.runtime.scene(), interactiveLayerIds(session.document.getState().doc));
      const joined = keys.join("\n");
      if (joined === lastKeys) return;
      lastKeys = joined;
      viewer.setShowHitTargets(true, keys);
    };
    refresh();
    const timer = setInterval(refresh, 400);
    return () => clearInterval(timer);
  }, [showHitTargets, session]);

  const reveal = (d: Diagnostic) => {
    const doc = session.document.getState().doc;
    const component = doc.components[d.component];
    const sel = session.selection.getState();
    if (currentComponentId(sel) !== d.component) sel.setComponentPath([doc.project.root]);
    const layers = d.itemIds.filter((id) => itemKindOf(component, id) === "layer");
    const patches = d.itemIds.filter((id) => itemKindOf(component, id) === "patch");
    session.selection.getState().select({ layers, patches, comments: [] });
    session.selection.getState().requestReveal(d.component, d.itemIds);
  };

  const screen = layout?.screen;
  const firstError = errors[0];

  return (
    <div className={cx("sb-vw__viewport", className)}>
      <div ref={scrollRef} className="sb-vw__scroll" data-zoom={zoom}>
        <div className="sb-vw__fit" style={{ width: layout ? layout.width * scale : 0, height: layout ? layout.height * scale : 0, visibility: rootExists ? undefined : "hidden" }}>
          <div ref={hostRef} className="sb-vw__device" />
          {rootExists && empty && screen && (
            <div className="sb-vw__empty" style={{ left: screen.x * scale, top: screen.y * scale, width: screen.width * scale, height: screen.height * scale }}>
              <div className="sb-vw__empty-card">
                <Layers size={18} strokeWidth={1.75} aria-hidden />
                <strong>Nothing to show yet</strong>
                <span>Draw a layer on the Canvas, or ask Claude to build something.</span>
              </div>
            </div>
          )}
        </div>
      </div>
      {!rootExists && (
        <EmptyState
          className="sb-vw__error"
          icon={<CircleAlert size={20} />}
          title="This prototype can't run"
          description="Its root component is missing. Undo the last change, or open another project."
        />
      )}
      {rootExists && firstError && (
        <div className="sb-vw__issue" role="status">
          <CircleAlert size={14} aria-hidden />
          <span className="sb-vw__issue-text" title={firstError.message}>
            {firstError.message}
            {errors.length > 1 ? ` (+${errors.length - 1} more)` : ""}
          </span>
          {firstError.itemIds.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => reveal(firstError)}>
              Show
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
