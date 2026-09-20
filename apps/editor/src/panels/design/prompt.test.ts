import { describe, expect, it } from "vitest";
import type { AssistantCanvasContext } from "../assistant/types.ts";
import { claudePrompt, designFollowUp } from "./prompt.ts";

const styles = "styles main (64 layers)\ncolors #111118FF text×12 · #FFFFFFFF fill×9\nradii 24×3 · 12×5";
const newScreen: AssistantCanvasContext = { component: { id: "main", name: "Main", size: [402, 874] }, screens: [{ id: "home", name: "Home" }], styles };
const redesign: AssistantCanvasContext = { ...newScreen, target: { id: "focus_card", name: "Focus Card", type: "group", frame: [24, 164, 354, 200], screen: { id: "home", name: "Home" } } };

describe("claudePrompt", () => {
  it("asks Claude Code for a new screen through import_design", () => {
    expect(claudePrompt({ docName: "Placemark", text: " a checkout with Apple Pay ", context: newScreen, browser: false })).toBe(
      `In my open Sonobe prototype “Placemark”, design a new screen for “Main”: a checkout with Apple Pay

Match what's already there, and my app's theme files in this folder if it has them. The styles the prototype uses now (get_outline with detail "styles" shows them again):
${styles}

Write it as one static HTML page 402 points wide, with data-name on everything I'll wire and the top safe area empty, and import it with import_design (component "main"). Then iterate by importing again with replace.`,
    );
  });

  it("asks Claude Code to redesign the picked layer with replace", () => {
    expect(claudePrompt({ docName: "Placemark", text: "make it darker", context: redesign, browser: false })).toBe(
      `In my open Sonobe prototype “Placemark”, redesign “Focus Card” (layer focus_card, 354 × 200 in “Main”): make it darker

Keep its layer names so its wiring survives: write it as one static HTML page whose body is just that layer at 354 × 200, and import it with import_design using replace "focus_card" and component "main". The styles the prototype uses now:
${styles}`,
    );
  });

  it("asks Claude in the browser for HTML to paste, naming no tools", () => {
    const prompt = claudePrompt({ docName: "Placemark", text: "a profile screen", context: newScreen, browser: true });
    expect(prompt).toBe(
      `In my open Sonobe prototype “Placemark”, design a new screen for “Main”: a profile screen

Match what's already there. The styles the prototype uses now:
${styles}

Write it as one complete HTML file 402 points wide, with data-name on everything I'll wire and the top safe area empty, that I can paste into Sonobe's File → Import Design → Paste HTML.`,
    );
    const redesignPrompt = claudePrompt({ docName: "Placemark", text: "make it darker", context: redesign, browser: true });
    expect(redesignPrompt).toBe(
      `In my open Sonobe prototype “Placemark”, redesign “Focus Card” (layer focus_card, 354 × 200 in “Main”): make it darker

The styles the prototype uses now:
${styles}

Write it as one complete HTML file 354 points wide, with data-name on everything I'll wire and the top safe area empty, that I can paste into Sonobe's File → Import Design → Paste HTML.`,
    );
    for (const text of [prompt, redesignPrompt]) expect(text).not.toMatch(/import_design|get_outline|get_screenshot|replace "/);
  });

  it("leaves out the styles when the context has none", () => {
    const { styles: _styles, ...bare } = newScreen;
    expect(claudePrompt({ docName: "Placemark", text: "a checkout", context: bare, browser: false })).toBe(
      `In my open Sonobe prototype “Placemark”, design a new screen for “Main”: a checkout

Match what's already there, and my app's theme files in this folder if it has them.

Write it as one static HTML page 402 points wide, with data-name on everything I'll wire and the top safe area empty, and import it with import_design (component "main"). Then iterate by importing again with replace.`,
    );
    const { styles: _s, ...bareRedesign } = redesign;
    expect(claudePrompt({ docName: "Placemark", text: "make it darker", context: bareRedesign, browser: true })).not.toContain("styles");
  });
});

describe("designFollowUp", () => {
  it("writes the result chips' messages", () => {
    expect(designFollowUp("interactive", "Checkout")).toBe("Make “Checkout” interactive: wire its buttons and controls with patches so they respond, and tell me what you wired.");
    expect(designFollowUp("knobs", "Checkout")).toBe("Turn the main colors, corner radius and spacing of “Checkout” into knobs I can tune, and link its layers to them. Group them under “Checkout”.");
    expect(designFollowUp("darker", "Checkout")).toBe("Try a darker version of “Checkout”.");
  });
});
