/** Prompts (user-initiated recipes; slash commands in Claude Code): import_screen, prototype_interaction, debug_interaction, explain_prototype. */

import { z } from "zod";
import { explain } from "./explain.ts";
import type { ToolContext } from "./server.ts";

const user = (text: string) => ({
  messages: [{ role: "user" as const, content: { type: "text" as const, text } }],
});

export function registerPrompts(tc: ToolContext): void {
  const { host, server } = tc;

  server.registerPrompt(
    "import_screen",
    {
      title: "Import a screen",
      description: "Bring a screen from the person's app or code into the open Sonobe document as layers, check it against the source, and get it ready to prototype.",
      argsSchema: z.object({
        screen: z.string().describe('Which screen, and where it lives, e.g. "the settings screen, localhost:3000/settings" or "ProfileView.swift".'),
        interaction: z.string().optional().describe('What to prototype on it afterwards, e.g. "the Follow button bounces when tapped".'),
      }),
    },
    async ({ screen, interaction }) =>
      user(
        [
          `Import this screen into Sonobe: ${screen}`,
          ...(interaction ? [`Then prototype: ${interaction}`] : []),
          "",
          "Work like this:",
          '1. get_guide("importing") if you haven\'t this conversation, then get_document_info for the device size.',
          "2. If the screen is part of a web app you can run, find its dev server (package.json scripts; start it if it isn't running) and call import_design with its url. Use selector for a single component and waitFor for data that loads late.",
          "3. Otherwise read the screen's code and theme files and write one faithful static HTML page at the device width (real copy, colors, fonts, spacing, inline SVG icons, data-name on elements to wire), then call import_design with html.",
          "4. Compare get_screenshot with the source (import_design with screenshot: true returns the page). Fix what matters by importing again with replace set to the screen's id.",
          ...(interaction ? ["5. begin_work, wire the interaction onto the imported layer ids, verify it with sim_reset, sim_dispatch and sim_trace, then finish_work."] : []),
          `${interaction ? 6 : 5}. Tell me what came across, what you approximated, and which layers are named for wiring, in plain words.`,
        ].join("\n"),
      ),
  );

  server.registerPrompt(
    "prototype_interaction",
    {
      title: "Prototype an interaction",
      description:
        "Build an interaction in the open Sonobe document, verify it in simulation, and explain the result.",
      argsSchema: z.object({
        description: z
          .string()
          .describe(
            'What should happen, and how it should feel, e.g. "tap the card to grow it with a gentle bounce".',
          ),
        docId: z.string().optional().describe("Document id (default: the active document)."),
      }),
    },
    async ({ description, docId }) =>
      user(
        [
          `Prototype this interaction in Sonobe${docId ? ` (document ${docId})` : ""}: ${description}`,
          "",
          "Work like this:",
          '1. get_guide("start-here") if you haven\'t this conversation, then get_document_info and get_outline.',
          "2. Plan the smallest graph that does it, usually Interaction → Switch → Animation → Transition → layer property. Say the plan in one or two plain sentences.",
          "3. describe_patch_types for every patch type you'll use.",
          "4. begin_work, then build it in small batches with add_layers / add_patches (use refs and connections). Name layers and patches by their effect. Build the numbers I'll want to tune (distances, spring feel, thresholds) as knobs with set_knobs.",
          "5. get_diagnostics and fix anything new.",
          "6. Verify: sim_reset, sim_dispatch the gesture, then sim_trace the layer properties that should move. Check end values, settle time and overshoot against the feel that was asked for; tune and re-trace.",
          "7. finish_work, then tell me what you built in plain words (names, not ids), how you verified it, and which knobs I can tweak.",
        ].join("\n"),
      ),
  );

  server.registerPrompt(
    "debug_interaction",
    {
      title: "Debug an interaction",
      description:
        "Find out why an interaction doesn't behave as expected, using diagnostics and simulation, and propose the minimal fix.",
      argsSchema: z.object({
        symptom: z.string().describe('What goes wrong, e.g. "tapping the heart does nothing".'),
        docId: z.string().optional(),
      }),
    },
    async ({ symptom, docId }) =>
      user(
        [
          `Debug this Sonobe prototype${docId ? ` (document ${docId})` : ""}: ${symptom}`,
          "",
          "Work like this:",
          '1. get_guide("troubleshooting") if you haven\'t this conversation, then get_diagnostics and get_outline.',
          "2. explain with audience engineer on the items involved, to see the flow from gesture to layer property.",
          "3. Reproduce it: sim_reset, sim_dispatch the gesture on the target layer (read the hit report and warnings), then sim_get_values / sim_trace along the chain (interaction output, switch state, animation output, the layer property) to find where the value stops changing.",
          "4. State the root cause in one sentence, then apply the smallest fix (use a diagnostic's suggested ops when one fits).",
          "5. Re-run the same simulation to prove the fix, then summarize the cause and the fix in plain words.",
        ].join("\n"),
      ),
  );

  server.registerPrompt(
    "explain_prototype",
    {
      title: "Explain the prototype",
      description: "Explain what the open prototype does, at the level you choose.",
      argsSchema: z.object({
        audience: z
          .enum(["beginner", "designer", "engineer"])
          .optional()
          .describe("Default designer."),
        docId: z.string().optional(),
      }),
    },
    async ({ audience, docId }) => {
      const level = audience ?? "designer";
      let context = "";
      try {
        const snap = await host.getDocument(docId);
        context = explain(snap.doc, { registry: host.registry, audience: level });
      } catch (err) {
        context = `(Couldn't read the document: ${err instanceof Error ? err.message : String(err)})`;
      }
      return user(
        [
          `Explain this Sonobe prototype for a ${level}. Here's Sonobe's generated description of the graph:`,
          "",
          context,
          "",
          level === "beginner"
            ? "Rewrite it as a short, friendly walkthrough with no jargon: what you can do, what happens, and why. Use layer names, never ids. End with one idea for something to try."
            : level === "designer"
              ? "Turn it into a clear walkthrough of the interaction design: triggers, states, motion and feel (spring or curve values in words), plus anything that looks unfinished. Use names, not ids."
              : "Give a precise technical walkthrough: data flow, state, timing and evaluation details, edge cases, and anything that looks wrong. Ids and ports are fine.",
          "If something is ambiguous, check it with get_items or a quick simulation before explaining it.",
        ].join("\n"),
      );
    },
  );
}
