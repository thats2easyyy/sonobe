/**
 * The Design with Claude box's status line: what Claude is doing right now (thinking, a tool step,
 * writing the page, adding the layers), what it made, and what went wrong, with the action that helps.
 */

import type { AssistantData } from "../assistant/assistantStore.ts";
import type { DesignData } from "./designStore.ts";

export interface DesignStatusLine { text: string; tone: "busy" | "done" | "info" | "warn" | "error"; action?: "api_key" | "new_chat" | "settings" }

export function designStatusLine(_design: DesignData, _assistant: AssistantData, _now: number): DesignStatusLine | null {
  throw new Error("not implemented");
}

/** A tool step in words ("Reading your prototype…"). */
export function toolStatusText(_chip: { name: string; title: string; detail: string }): string {
  throw new Error("not implemented");
}
