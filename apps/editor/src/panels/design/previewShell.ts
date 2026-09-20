/**
 * The live design preview's sandboxed page: a srcdoc shell whose CSP meta comes first in its head, and
 * a nonce bootstrap that swaps in the HTML Claude is writing. Claude's own scripts never run; only
 * Tailwind's CDN script is recreated. The preview only paints: it captures and writes nothing.
 */

/** The only script sources the preview recreates (Tailwind's CDN builds). */
export const PREVIEW_SCRIPT_PREFIXES: readonly string[] = ["https://cdn.tailwindcss.com", "https://cdn.jsdelivr.net/npm/@tailwindcss/browser"];

export function previewCsp(_nonce: string): string {
  throw new Error("not implemented");
}

export function previewShellHtml(_nonce: string): string {
  throw new Error("not implemented");
}

/** The shell's bootstrap script (plain JS): accepts the parent's nonce'd messages and swaps in the parsed page. Not written yet. */
export const PREVIEW_BOOTSTRAP: string = "";

/** The part of a partial page that renders cleanly: no unclosed script, a closed style, no half tag. */
export function renderablePrefix(_html: string): string {
  throw new Error("not implemented");
}
