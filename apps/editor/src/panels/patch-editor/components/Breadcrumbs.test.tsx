// @vitest-environment happy-dom
import { applyOps, createEmptyDocument, type Op } from "@sonobe/core";
import { act, Profiler } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createManualScheduler } from "../../../runtime/scheduler.ts";
import { getRegistry } from "../../../state/registry.ts";
import { createEditorSession, type EditorSession } from "../../../state/session.ts";
import { PatchEditorBreadcrumbs } from "./Breadcrumbs.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const registry = getRegistry();
let container: HTMLDivElement;
let root: Root;
let session: EditorSession;
let renders = 0;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const ops: Op[] = [
    { op: "addLayer", layer: { id: "card", type: "rectangle", name: "Card" } },
    { op: "addComponent", component: { id: "swipe", name: "Swipe", kind: "patchComponent" } },
  ];
  const built = applyOps(createEmptyDocument(), ops, { registry });
  if (!built.ok) throw new Error(built.errors.map((e) => e.message).join("\n"));
  session = createEditorSession({ host: null, registry, document: built.doc, autoplay: false, scheduler: createManualScheduler(), textMeasurer: "approximate" });
  act(() =>
    root.render(
      <Profiler id="crumbs" onRender={() => renders++}>
        <PatchEditorBreadcrumbs session={session} />
      </Profiler>,
    ),
  );
  act(() => session.selection.getState().enterComponent("swipe"));
  renders = 0;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  session.dispose();
});

const apply = (ops: Op[]) => act(() => void session.document.getState().apply(ops, { label: "Test change" }));
const names = () => [...container.querySelectorAll(".sb-pe-crumbs__item")].map((item) => item.textContent);

describe("PatchEditorBreadcrumbs", () => {
  it("shows the path by name and follows a rename", () => {
    expect(names()).toEqual(["Main", "Swipe"]);
    apply([{ op: "updateComponent", id: "swipe", name: "Swipe to dismiss" }]);
    expect(names()).toEqual(["Main", "Swipe to dismiss"]);
    expect(renders).toBeGreaterThan(0);
  });

  it("doesn't render for an edit that changes no name on the path", () => {
    apply([{ op: "updateLayer", component: "main", id: "card", props: { opacity: 0.5 } }]);
    apply([{ op: "addPatch", component: "swipe", patch: { id: "sum", type: "add", typeParam: "number" } }]);
    apply([{ op: "addComponent", component: { id: "other", name: "Other", kind: "patchComponent" } }]);
    expect(renders).toBe(0);
  });

  it("goes back up when a crumb is pressed", () => {
    act(() => container.querySelector<HTMLButtonElement>(".sb-pe-crumbs__item button")!.click());
    expect(session.selection.getState().componentPath).toEqual(["main"]);
    expect(names()).toEqual(["Main"]);
  });
});
