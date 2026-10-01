/** Focus utilities for overlays: finding focusable descendants, trapping Tab inside a container, and holding focus in a modal. */

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

/**
 * Whether an open modal dialog covers `el`. Overlays portal to the end of <body> in the order they open, so a
 * modal later in the document than `el` is over it; one that holds `el`, or opened before it, is not.
 */
export function isBehindModal(el: Element): boolean {
  for (const modal of el.ownerDocument.querySelectorAll('[aria-modal="true"]')) {
    if (modal.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING) return true;
  }
  return false;
}

/**
 * Keep focus in an open modal. Focus that lands behind it (a panel underneath focusing a field a frame late)
 * goes back to where it was in the modal, or to `fallback()`. What the modal opened (a menu, a dialog over it)
 * and the toaster keep theirs. Returns a function that stops it.
 */
export function holdFocus(modal: HTMLElement, fallback: () => HTMLElement): () => void {
  const doc = modal.ownerDocument;
  let last = modal.contains(doc.activeElement) ? (doc.activeElement as HTMLElement) : null;
  const onFocusIn = (event: FocusEvent) => {
    const target = event.target as Element | null;
    if (!target || typeof target.closest !== "function") return;
    if (modal.contains(target)) {
      last = target as HTMLElement;
      return;
    }
    if (!(modal.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_PRECEDING) || target.closest("[data-layer-ignore]")) return;
    (last && modal.contains(last) ? last : fallback()).focus({ preventScroll: true });
  };
  doc.addEventListener("focusin", onFocusIn, true);
  return () => doc.removeEventListener("focusin", onFocusIn, true);
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
