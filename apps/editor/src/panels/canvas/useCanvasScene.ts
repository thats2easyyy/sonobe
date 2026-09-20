/**
 * The scene the canvas draws: the component being edited at frame 0 (a private deterministic
 * runtime, re-run on every document change), or the live prototype's latest frame.
 */

import { artboardSize, componentDocument, type Id } from "@sonobe/core";
import { createRuntime, type SceneFrame, type SonobeRuntime } from "@sonobe/engine";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import type { EditorSession } from "../../state/session.ts";

/** "design": frame 0 with authored values. "live": the running prototype (root component only). */
export type SceneSource = "design" | "live";

export interface CanvasSceneState {
  scene: SceneFrame | null;
  size: [number, number];
  /** Showing the live prototype instead of frame 0. */
  live: boolean;
}

const LIVE_INTERVAL_MS = 50;

export function useCanvasScene(session: EditorSession, componentId: Id, source: SceneSource): CanvasSceneState {
  const doc = useStore(session.document, (s) => s.doc);
  const live = source === "live" && componentId === doc.project.root;
  const runtimeRef = useRef<SonobeRuntime | null>(null);

  useEffect(
    () => () => {
      runtimeRef.current?.dispose();
      runtimeRef.current = null;
    },
    [],
  );

  const designScene = useMemo(() => {
    if (live) return null;
    const derived = componentDocument(doc, componentId);
    if (!derived.components[derived.project.root]) return null;
    try {
      let rt = runtimeRef.current;
      if (!rt) {
        rt = createRuntime(derived, {
          registry: session.registry,
          deterministic: true,
          platform: {},
          resolveAssetUrl: session.resolveAssetUrl,
          ...(session.runtime.textMeasurer ? { textMeasurer: session.runtime.textMeasurer } : {}),
        });
        runtimeRef.current = rt;
      } else {
        rt.updateDocument(derived);
        rt.restart();
      }
      return rt.step();
    } catch {
      return null;
    }
  }, [doc, componentId, live, session]);

  const [liveScene, setLiveScene] = useState<SceneFrame | null>(null);
  useEffect(() => {
    if (!live) return;
    setLiveScene(session.runtime.scene());
    let last = -Infinity;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let latest: SceneFrame | null = null;
    const flush = () => {
      timer = undefined;
      last = performance.now();
      setLiveScene(latest);
    };
    const unsubscribe = session.runtime.subscribeFrame((scene) => {
      latest = scene;
      if (performance.now() - last >= LIVE_INTERVAL_MS) flush();
      else timer ??= setTimeout(flush, LIVE_INTERVAL_MS);
    });
    return () => {
      unsubscribe();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [live, session]);

  const size = useMemo(() => artboardSize(doc, componentId), [doc, componentId]);
  return { scene: live ? liveScene : designScene, size, live };
}
