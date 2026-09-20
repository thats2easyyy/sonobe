/**
 * What the Design with Claude box writes for Claude: the prompt it copies, or opens in Claude Code,
 * for people who don't use the Assistant (for Claude Code on the desktop, which names Sonobe's tools
 * and draws on the canvas as it writes, or for Claude in the browser, which asks for HTML to paste),
 * and the follow-ups its result chips send.
 */

import type { AssistantCanvasContext } from "../assistant/types.ts";

const points = (n: number) => String(Math.round(n * 10) / 10);

/** The live flow: preview_design draws the page on the canvas as Claude writes it, and import_design imports that draft. */
const LIVE_FLOW = `with the page's head and first section as html, then append one part at a time, then import_design with "preview": true`;

export function claudePrompt(input: { docName: string; text: string; context: AssistantCanvasContext; browser: boolean }): string {
  const { docName, context, browser } = input;
  const { component, target, styles } = context;
  const text = input.text.trim();
  const width = points(target ? target.frame[2] : component.size[0]);
  const height = points(target ? target.frame[3] : component.size[1]);
  const opening = target
    ? `In my open Sonobe prototype “${docName}”, redesign “${target.name}” (layer ${target.id}, ${width} × ${height} in “${component.name}”): ${text}`
    : `In my open Sonobe prototype “${docName}”, design a new screen for “${component.name}”: ${text}`;
  const withStyles = (lead: string, intro: string) => (styles ? `${lead}${lead ? " " : ""}${intro}\n${styles}` : lead);

  if (browser) {
    return [
      opening,
      withStyles(target ? "" : "Match what's already there.", "The styles the prototype uses now:"),
      `Write it as one complete HTML file ${width} points wide, with data-name on everything I'll wire and the top safe area empty, that I can paste into Sonobe's File → Import Design → Paste HTML.`,
    ]
      .filter(Boolean)
      .join("\n\n");
  }
  if (target) {
    return [
      opening,
      withStyles(`Keep its layer names so its wiring survives: write it as one static HTML page whose body is just that layer at ${width} × ${height}, and show it on this canvas as you write: preview_design (replace "${target.id}", component "${component.id}") ${LIVE_FLOW}.`, "The styles the prototype uses now:"),
    ].join("\n\n");
  }
  return [
    opening,
    withStyles("Match what's already there, and my app's theme files in this folder if it has them.", `The styles the prototype uses now (get_outline with detail "styles" shows them again):`),
    `Write it as one static HTML page ${width} points wide, with data-name on everything I'll wire and the top safe area empty, and show it on this canvas as you write: preview_design (component "${component.id}") ${LIVE_FLOW}. Then iterate the same way with replace.`,
  ].join("\n\n");
}

export type DesignFollowUpKind = "interactive" | "knobs" | "darker";

/** The message a result chip sends about the screen Claude just made. */
export function designFollowUp(kind: DesignFollowUpKind, name: string): string {
  switch (kind) {
    case "interactive":
      return `Make “${name}” interactive: wire its buttons and controls with patches so they respond, and tell me what you wired.`;
    case "knobs":
      return `Turn the main colors, corner radius and spacing of “${name}” into knobs I can tune, and link its layers to them. Group them under “${name}”.`;
    case "darker":
      return `Try a darker version of “${name}”.`;
  }
}
