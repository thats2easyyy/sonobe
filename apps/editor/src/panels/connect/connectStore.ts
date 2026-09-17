/** App-wide open state for the Connect Claude dialog, so the menu, toolbar, HUD, and Learn can all open it. */

import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";

export type ConnectTab = "code" | "desktop";

/** What was copied from the dialog: the Claude Code command, the Claude Desktop config, or a starter prompt. */
export type CopiedKind = "setup" | "config" | "prompt";

export interface ConnectClaudeState {
  open: boolean;
  tab: ConnectTab;
  /** How many times the dialog has been opened this session (lessons watch it). */
  openCount: number;
  /** When each kind of text was last copied (Date.now()), this session. */
  copied: Partial<Record<CopiedKind, number>>;
  /** Open, optionally on a tab. */
  show: (tab?: ConnectTab) => void;
  hide: () => void;
  setOpen: (open: boolean) => void;
  markCopied: (kind: CopiedKind) => void;
}

export function createConnectClaudeStore(now: () => number = () => Date.now()): StoreApi<ConnectClaudeState> {
  return createStore<ConnectClaudeState>()((set) => ({
    open: false,
    tab: "code",
    openCount: 0,
    copied: {},
    show: (tab) => set((s) => ({ open: true, tab: tab ?? s.tab, openCount: s.open ? s.openCount : s.openCount + 1 })),
    hide: () => set({ open: false }),
    setOpen: (open) => set((s) => ({ open, openCount: open && !s.open ? s.openCount + 1 : s.openCount })),
    markCopied: (kind) => set((s) => ({ copied: { ...s.copied, [kind]: now() } })),
  }));
}

export const connectClaudeStore = createConnectClaudeStore();

export function useConnectClaude<T>(selector: (state: ConnectClaudeState) => T): T {
  return useStore(connectClaudeStore, selector);
}
