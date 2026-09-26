// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { createLayoutStore } from "../../../shell/layoutStore.ts";
import { createLessonLayout, LESSON_LAYOUT_KEY, targetsInspector } from "./lessonLayout.ts";

afterEach(() => localStorage.clear());

const shell = () => createLayoutStore({ storageKey: null });

describe("lesson layout", () => {
  it("collapses the Inspector and shows only patches, then restores the layout on leave", () => {
    const layout = shell();
    layout.getState().setViewMode("split");
    const lessons = createLessonLayout({ layout, storageKey: null });
    lessons.enter();
    expect(lessons.getState()).toMatchObject({ active: true, snapshot: { inspectorCollapsed: false, viewMode: "split" } });
    expect(layout.getState().collapsed.inspector).toBe(true);
    expect(layout.getState().viewMode).toBe("patches");

    // Entering again (a re-render, StrictMode) keeps the original snapshot.
    lessons.enter();
    expect(lessons.getState().snapshot).toEqual({ inspectorCollapsed: false, viewMode: "split" });

    lessons.leave();
    expect(lessons.getState()).toEqual({ active: false, snapshot: null, inspectorForStep: false });
    expect(layout.getState().collapsed.inspector).toBe(false);
    expect(layout.getState().viewMode).toBe("split");
    lessons.leave();
    expect(layout.getState().viewMode).toBe("split");
  });

  it("keeps a collapsed Inspector collapsed and a canvas-only view on restore", () => {
    const layout = shell();
    layout.getState().toggleCollapsed("inspector", true);
    layout.getState().setViewMode("canvas");
    const lessons = createLessonLayout({ layout, storageKey: null });
    lessons.enter();
    lessons.leave();
    expect(layout.getState().collapsed.inspector).toBe(true);
    expect(layout.getState().viewMode).toBe("canvas");
  });

  it("shows the Inspector for steps that point at it, and collapses it again afterwards", () => {
    const layout = shell();
    const lessons = createLessonLayout({ layout, storageKey: null });
    lessons.showPanelsFor({ selector: "#sb-inspector" });
    expect(layout.getState().collapsed.inspector).toBe(false);

    lessons.enter();
    lessons.showPanelsFor({ selector: ".sb-pe .react-flow__node" });
    expect(layout.getState().collapsed.inspector).toBe(true);
    lessons.showPanelsFor({ selector: "#sb-inspector" });
    expect(layout.getState().collapsed.inspector).toBe(false);
    expect(lessons.getState().inspectorForStep).toBe(true);
    lessons.showPanelsFor({ selector: "#sb-inspector [data-field]" });
    expect(layout.getState().collapsed.inspector).toBe(false);
    lessons.showPanelsFor(null);
    expect(layout.getState().collapsed.inspector).toBe(true);
    expect(lessons.getState().inspectorForStep).toBe(false);

    // Opened by hand: a later step leaves it alone.
    layout.getState().toggleCollapsed("inspector", false);
    lessons.showPanelsFor({ selector: "#sb-viewer [data-layer=photo]" });
    expect(layout.getState().collapsed.inspector).toBe(false);
  });

  it("restores a layout left behind by a reload", () => {
    const layout = shell();
    const first = createLessonLayout({ layout });
    first.enter();
    expect(JSON.parse(localStorage.getItem(LESSON_LAYOUT_KEY) ?? "null")).toEqual({ inspectorCollapsed: false, viewMode: "split" });

    // A new page: the layout store still holds the lesson layout, and the snapshot comes back from storage.
    const reloaded = createLessonLayout({ layout });
    expect(reloaded.getState()).toMatchObject({ active: false, snapshot: { inspectorCollapsed: false, viewMode: "split" } });
    reloaded.enter();
    expect(reloaded.getState().snapshot).toEqual({ inspectorCollapsed: false, viewMode: "split" });
    reloaded.leave();
    expect(layout.getState().viewMode).toBe("split");
    expect(localStorage.getItem(LESSON_LAYOUT_KEY)).toBeNull();

    // No lesson came back on screen: releaseStale restores it.
    first.enter();
    const stale = createLessonLayout({ layout });
    stale.releaseStale();
    expect(layout.getState().collapsed.inspector).toBe(false);
    expect(layout.getState().viewMode).toBe("split");
    expect(stale.getState().snapshot).toBeNull();
  });

  it("releaseStale leaves an active lesson alone", () => {
    const layout = shell();
    const lessons = createLessonLayout({ layout, storageKey: null });
    lessons.enter();
    lessons.releaseStale();
    expect(lessons.getState().active).toBe(true);
    expect(layout.getState().viewMode).toBe("patches");
  });

  describe("in a narrow window", () => {
    const narrow = (width: number) => {
      const layout = shell();
      const lessons = createLessonLayout({ layout, storageKey: null, viewportWidth: () => width });
      return { layout, lessons };
    };

    it("folds Layers away for steps that don't point at it, and brings it back", () => {
      const { layout, lessons } = narrow(1024);
      lessons.enter();
      lessons.showPanelsFor({ selector: '#sb-layers [data-layer-id="photo"]' });
      expect(layout.getState().collapsed.layers).toBe(false);
      lessons.showPanelsFor({ selector: ".sb-pe .react-flow__node" });
      expect(layout.getState().collapsed.layers).toBe(false);
      lessons.showPanelsFor({ selector: "#sb-inspector" });
      expect(layout.getState().collapsed.layers).toBe(true);
      expect(lessons.getState()).toMatchObject({ snapshot: { layersCollapsed: false } });
      lessons.showPanelsFor({ selector: '#sb-layers [data-layer-id="photo"]' });
      expect(layout.getState().collapsed.layers).toBe(false);
      expect(lessons.getState()).toMatchObject({ snapshot: { inspectorCollapsed: false, viewMode: "split" } });
      expect(lessons.getState().snapshot).not.toHaveProperty("layersCollapsed");
    });

    it("folds Layers for the Viewer step, where the Viewer would squeeze the patch editor", () => {
      const { layout, lessons } = narrow(1024);
      lessons.enter();
      lessons.showPanelsFor({ selector: '#sb-viewer [data-layer="photo"]' });
      expect(layout.getState().collapsed.layers).toBe(true);
    });

    it("restores Layers when the lesson ends on a folded step, also after a reload", () => {
      const layout = shell();
      const first = createLessonLayout({ layout, viewportWidth: () => 1024 });
      first.enter();
      first.showPanelsFor({ selector: "#sb-inspector" });
      expect(JSON.parse(localStorage.getItem(LESSON_LAYOUT_KEY) ?? "null")).toMatchObject({ layersCollapsed: false });

      const reloaded = createLessonLayout({ layout, viewportWidth: () => 1024 });
      reloaded.enter();
      reloaded.showPanelsFor({ selector: "#sb-inspector" });
      expect(reloaded.getState().snapshot).toMatchObject({ layersCollapsed: false });
      reloaded.leave();
      expect(layout.getState().collapsed.layers).toBe(false);
      expect(layout.getState().collapsed.inspector).toBe(false);
      expect(localStorage.getItem(LESSON_LAYOUT_KEY)).toBeNull();
    });

    it("leaves Layers alone when the window has room, or when the person had it collapsed", () => {
      const wide = narrow(1680);
      wide.lessons.enter();
      wide.lessons.showPanelsFor({ selector: "#sb-inspector" });
      expect(wide.layout.getState().collapsed.layers).toBe(false);

      const { layout, lessons } = narrow(1024);
      layout.getState().toggleCollapsed("layers", true);
      lessons.enter();
      lessons.showPanelsFor({ selector: "#sb-inspector" });
      expect(lessons.getState().snapshot).toMatchObject({ layersCollapsed: true });
      lessons.leave();
      expect(layout.getState().collapsed.layers).toBe(true);
    });
  });

  it("recognizes Inspector targets", () => {
    expect(targetsInspector({ selector: "#sb-inspector" })).toBe(true);
    expect(targetsInspector({ selector: " #sb-inspector .sb-field" })).toBe(true);
    expect(targetsInspector({ selector: "#sb-inspector-x" })).toBe(false);
    expect(targetsInspector({ selector: "#sb-layers" })).toBe(false);
    expect(targetsInspector(null)).toBe(false);
  });
});
