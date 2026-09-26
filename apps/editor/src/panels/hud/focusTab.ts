/** Moves focus to the HUD's selected tab, for when the control that had it is about to leave the DOM. */
export function focusSelectedTab(from: Element): void {
  from.closest<HTMLElement>(".sb-hudx")?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
}
