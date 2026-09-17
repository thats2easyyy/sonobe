import { applyOps, createEmptyDocument } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { getRegistry } from "../../state/registry.ts";
import { itemDisplayName } from "./itemNames.ts";

const registry = getRegistry();

describe("itemDisplayName", () => {
  it("shows a patch's type name when it has no custom name, and a variable's name", () => {
    const doc = applyOps(
      createEmptyDocument(),
      [
        { op: "addPatch", patch: { id: "variableReceiver", type: "variableReceiver", ui: { x: 0, y: 0 } } },
        { op: "addPatch", patch: { id: "liked", type: "variableBroadcaster", settings: { name: "isLiked" }, ui: { x: 0, y: 200 } } },
        { op: "addPatch", patch: { id: "photo_scale", type: "transition", name: "Photo Scale", ui: { x: 0, y: 400 } } },
      ],
      { registry },
    ).doc;
    expect(itemDisplayName(doc, "main", "variableReceiver", registry)).toBe("Variable Receiver");
    expect(itemDisplayName(doc, "main", "liked", registry)).toBe("isLiked");
    expect(itemDisplayName(doc, "main", "photo_scale", registry)).toBe("Photo Scale");
    expect(itemDisplayName(doc, "main", "variableReceiver")).toBe("variableReceiver");
    expect(itemDisplayName(doc, "main", "nothing", registry)).toBe("nothing");
  });
});
