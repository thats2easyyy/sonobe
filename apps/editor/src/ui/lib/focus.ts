/** Focus utilities for overlays: finding focusable descendants and trapping Tab inside a container. */

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable]:not([contenteditable="false"])',
].join(",");

/** Visible, enabled, tabbable descendants in DOM order. */
export function getFocusable(container: Element | null | undefined): HTMLElement[] {
  if (!container) return [];
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.getAttribute("tabindex") !== "-1" && !el.closest("[inert]") && el.getClientRects().length > 0,
  );
}

/** Keep Tab / Shift+Tab cycling inside `container`. Call from a keydown handler. */
export function trapFocus(event: { key: string; shiftKey: boolean; preventDefault(): void }, container: HTMLElement | null): void {
  if (event.key !== "Tab" || !container) return;
  const items = getFocusable(container);
  if (items.length === 0) {
    event.preventDefault();
    container.focus();
    return;
  }
  const first = items[0]!;
  const last = items[items.length - 1]!;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === container)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

export function isFocusVisible(el: Element): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    return true;
  }
}

const NON_TEXT_INPUTS = new Set(["button", "checkbox", "radio", "range", "color", "file", "image", "reset", "submit"]);

/** Fields that match :focus-visible after a mouse click because the caret needs to show. */
export function isTextEntry(el: Element): boolean {
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(el.type);
  return el instanceof HTMLElement && el.isContentEditable;
}
