import { getDiagnostics, getOutline } from "@sonobe/core";
import { createRuntime, type InputEvent } from "@sonobe/engine";
import { MOCK_DEFINITIONS } from "@sonobe/engine/testing";
import { createPatchRegistry } from "@sonobe/patches";
import { describe, expect, it } from "vitest";
import { createDemoDocument, DEMO_DOCUMENT_NAME } from "./demoDocument.ts";
import { getRegistry } from "./registry.ts";

describe("Photo Zoom demo document", () => {
  it("builds with zero error diagnostics", () => {
    const doc = createDemoDocument();
    const errors = getDiagnostics(doc, getRegistry()).filter((d) => d.severity === "error");
    expect(errors).toEqual([]);
    expect(doc.project).toMatchObject({ name: DEMO_DOCUMENT_NAME, device: { preset: "iphone-17-pro" } });
    const main = doc.components.main!;
    expect(main.layers.map((l) => l.id)).toEqual(["background", "status_bar", "title", "subtitle", "card", "like_button", "next_card"]);
    expect(Object.keys(main.patches)).toHaveLength(10);
    expect(getOutline(doc, "main", { registry: getRegistry() })).toContain('patch photo_scale transition<number> "Photo Scale" progress←zoom_spring.output start=1 end=1.18');
  });

  it("compiles and runs without runtime errors", () => {
    const rt = createRuntime(createDemoDocument(), { registry: getRegistry(), deterministic: true });
    for (let i = 0; i < 5; i++) rt.step();
    expect(rt.issues().filter((i) => i.severity === "error")).toEqual([]);
    expect(rt.scene().roots.length).toBeGreaterThan(0);
    rt.dispose();
  });

  it("zooms the photo on tap and likes on heart tap (with reference evaluators)", () => {
    const registry = createPatchRegistry({ definitions: MOCK_DEFINITIONS });
    const rt = createRuntime(createDemoDocument(), { registry, deterministic: true });
    const tapAt = (x: number, y: number) => {
      const events: InputEvent[][] = [[{ kind: "pointer", phase: "down", pointerId: 1, x, y }], [{ kind: "pointer", phase: "up", pointerId: 1, x, y }]];
      for (const batch of events) {
        rt.dispatch(batch);
        rt.step();
      }
    };
    rt.step();
    tapAt(200, 260);
    for (let i = 0; i < 90; i++) rt.step();
    expect(rt.getValue("zoomed.on")).toBe(true);
    expect(rt.getValue("liked.on")).toBe(false);
    expect(rt.getValue("@photo.scale") as number).toBeCloseTo(1.18, 2);

    tapAt(346, 186);
    for (let i = 0; i < 90; i++) rt.step();
    expect(rt.getValue("liked.on")).toBe(true);
    expect(rt.getValue("zoomed.on")).toBe(true);
    expect(rt.getValue("@heart.textColor")).toMatchObject({ r: 1 });
    rt.dispose();
  });
});
