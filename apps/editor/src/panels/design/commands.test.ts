import { applyOps, createEmptyDocument } from "@sonobe/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createManualScheduler } from "../../runtime/scheduler.ts";
import { getRegistry } from "../../state/registry.ts";
import { createEditorSession, type EditorSession } from "../../state/session.ts";
import { commandDisabledReason, type Command } from "../../ui/commands/commandRegistry.ts";
import { designCommands } from "./commands.ts";
import { designStore, initialDesignData } from "./designStore.ts";

let session: EditorSession;
let commands: Record<string, Command>;

beforeEach(() => {
  designStore.setState(initialDesignData());
  const built = applyOps(
    createEmptyDocument({ name: "Shop" }),
    [
      { op: "addLayer", layer: { id: "home", type: "group", name: "Home" } },
      { op: "addLayer", layer: { id: "card", type: "rectangle", name: "Card" } },
      { op: "addComponent", component: { id: "logic", name: "Logic", kind: "patchComponent" } },
    ],
    { registry: getRegistry() },
  );
  expect(built.ok).toBe(true);
  session = createEditorSession({ host: null, document: built.doc, autoplay: false, scheduler: createManualScheduler(), textMeasurer: "approximate" });
  commands = Object.fromEntries(designCommands(session).map((c) => [c.id, c]));
});

afterEach(() => session.dispose());

describe("designCommands", () => {
  it("lists Design with Claude and Redesign with Claude in the Canvas category", () => {
    expect(commands["ai.design"]).toMatchObject({ title: "Design with Claude…", category: "Canvas", description: "Describe a screen and watch Claude draw it on the canvas" });
    expect(commands["ai.redesign"]).toMatchObject({ title: "Redesign with Claude…", category: "Canvas", description: "Describe what should change in the selected layer" });
  });

  it("opens the box, which follows the selection", async () => {
    await commands["ai.design"]!.run({});
    expect(designStore.getState().open).toBe(true);
  });

  it("redesigns only one selected layer, and un-pins a new screen", async () => {
    const redesign = commands["ai.redesign"]!;
    expect(redesign.when?.({})).toBe(false);
    expect(commandDisabledReason(redesign)).toBe("Select one layer to redesign");
    session.selection.getState().select({ layers: ["home", "card"] });
    expect(redesign.when?.({})).toBe(false);
    session.selection.getState().select({ layers: ["card"] });
    expect(redesign.when?.({})).toBe(true);

    designStore.getState().setNewScreen(true);
    await redesign.run({});
    expect(designStore.getState()).toMatchObject({ open: true, newScreen: false });
  });

  it("hides the preview Claude Code is drawing, only while there is one", async () => {
    const hide = commands["ai.hidePreview"]!;
    expect(hide).toMatchObject({ title: "Hide Design Preview", category: "Canvas" });
    expect(hide.when?.({})).toBe(false);
    designStore.setState({
      drafts: [{ source: "mcp", key: "mcp:cc-1", runId: "", turn: 0, toolUseId: "", html: "<p>Hi</p>", fields: {}, status: "writing", since: Date.now(), progress: null, error: null, resync: false, mcp: { author: { kind: "agent", name: "Claude" }, client: null, revision: 1, touchedAt: Date.now(), addingFrom: null } }],
    });
    expect(hide.when?.({})).toBe(true);
    await hide.run({});
    expect(designStore.getState().drafts[0]?.status).toBe("stopped");
    expect(hide.when?.({})).toBe(false);
  });

  it("can't design in a patch component", () => {
    expect(commands["ai.design"]!.when?.({})).toBe(true);
    session.selection.getState().enterComponent("logic");
    expect(commands["ai.design"]!.when?.({})).toBe(false);
    expect(commandDisabledReason(commands["ai.design"]!)).toBe("Patch components have no layers to design");
    expect(commands["ai.redesign"]!.when?.({})).toBe(false);
  });
});
