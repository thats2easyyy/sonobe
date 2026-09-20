/**
 * The prompt the Design with Claude box copies when the Assistant isn't available: for Claude Code on
 * the desktop (it names Sonobe's tools), or for Claude in the browser (it asks for HTML to paste).
 */

import type { AssistantCanvasContext } from "../assistant/types.ts";

export function claudePrompt(_input: { docName: string; text: string; context: AssistantCanvasContext; browser: boolean }): string {
  throw new Error("not implemented");
}
