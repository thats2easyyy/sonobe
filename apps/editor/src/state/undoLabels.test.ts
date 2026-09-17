import { describe, expect, it } from "vitest";
import { historyAction, historyStepTitle, undoMenuTitle } from "./undoLabels.ts";

describe("undo titles", () => {
  it("say what Undo and Redo will revert, without your name or an op count", () => {
    expect(undoMenuTitle("Undo", null)).toBe("Undo");
    expect(undoMenuTitle("Redo", undefined)).toBe("Redo");
    expect(undoMenuTitle("Undo", "You: Mute Card Shadow")).toBe("Undo Mute Card Shadow");
    expect(undoMenuTitle("Redo", "You: Align 2 items left (4 ops)")).toBe("Redo Align 2 items left");
    expect(undoMenuTitle("Undo", "Claude: renamed shadow (12 ops)")).toBe("Undo Claude: renamed shadow");
    expect(historyAction("Outside Sonobe: Reloaded from disk")).toBe("Outside Sonobe: Reloaded from disk");
  });

  it("trims long titles with an ellipsis", () => {
    const title = undoMenuTitle("Undo", "You: Rename Photo Scale Transition to Something Very Much Longer");
    expect(title.length).toBeLessThanOrEqual(40);
    expect(title.endsWith("…")).toBe(true);
    expect(title.startsWith("Undo Rename Photo Scale")).toBe(true);
  });

  it("describes a finished step for the status toast", () => {
    expect(historyStepTitle("Undo", "You: Mute Card Shadow")).toBe("Undid Mute Card Shadow");
    expect(historyStepTitle("Redo", "Claude: renamed shadow (3 ops)")).toBe("Redid Claude: renamed shadow");
  });
});
