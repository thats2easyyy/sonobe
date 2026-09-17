/** The bottom HUD's tabs in order, with the labels the tab bar shows. Docs name them the same way. */

import type { HudTabId } from "./Hud.tsx";

export interface HudTabInfo {
  readonly value: HudTabId;
  readonly label: string;
}

export const HUD_TABS: readonly HudTabInfo[] = [
  { value: "console", label: "Console" },
  { value: "diagnostics", label: "Diagnostics" },
  { value: "ai", label: "AI Activity" },
  { value: "performance", label: "Performance" },
];
