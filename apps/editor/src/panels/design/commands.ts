/** The Design with Claude commands for the command palette: design a new screen, or redesign the selected layer. */

import { findLayer } from "@sonobe/core";
import { Sparkles } from "lucide-react";
import type { EditorSession } from "../../state/session.ts";
import type { Command } from "../../ui/commands/commandRegistry.ts";
import { sharedAssistantController } from "../assistant/controller.ts";
import { designStore } from "./designStore.ts";

const KEYWORDS = ["ai", "claude", "assistant", "generate", "vibe", "screen", "html", "ui"];

/** ai.design and ai.redesign; both open the canvas's Design with Claude box. */
export function designCommands(session: EditorSession): Command[] {
  /** The component on the canvas, when it has layers to design. */
  const designable = () => {
    const current = session.document.getState().doc.components[session.currentComponentId()];
    return current && current.kind !== "patchComponent" ? current : null;
  };
  const canDesign = () => designable() !== null;
  const oneLayer = () => {
    const current = designable();
    const { layers } = session.selection.getState();
    return current !== null && layers.length === 1 && findLayer(current.layers, layers[0]!) !== undefined;
  };
  const open = () => {
    void sharedAssistantController().refresh();
    designStore.getState().openBox();
  };
  return [
    {
      id: "ai.design",
      title: "Design with Claude…",
      category: "Canvas",
      description: "Describe a screen and watch Claude draw it on the canvas",
      icon: Sparkles,
      keywords: [...KEYWORDS, "design", "new screen"],
      when: canDesign,
      disabledReason: "Patch components have no layers to design",
      run: open,
    },
    {
      id: "ai.redesign",
      title: "Redesign with Claude…",
      category: "Canvas",
      description: "Describe what should change in the selected layer",
      icon: Sparkles,
      keywords: [...KEYWORDS, "redesign", "change", "restyle"],
      when: oneLayer,
      disabledReason: "Select one layer to redesign",
      run: () => {
        // The box follows the selection again, even after × pinned it to a new screen.
        designStore.getState().setNewScreen(false);
        open();
      },
    },
  ];
}
