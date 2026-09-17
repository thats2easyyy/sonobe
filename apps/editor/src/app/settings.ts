/**
 * App settings: motion, the default device for new prototypes, what Claude may do over MCP, the
 * welcome screen on launch, and projects trusted to run JavaScript patches. Persisted per viewer in
 * localStorage (storage failures are ignored); the theme lives in ThemeProvider.
 */

import { DEFAULT_DEVICE, DEVICE_PRESETS } from "@sonobe/core";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import { readJSON, writeJSON } from "../ui/lib/storage.ts";

/** "system" follows the OS setting; "reduce" turns interface animation off; "full" keeps it on. */
export type MotionPreference = "system" | "reduce" | "full";

/** What Claude (or any MCP client) may do with the open prototype. */
export type AgentPermission = "edit" | "readOnly";

export interface AppSettings {
  motion: MotionPreference;
  /** Device preset id for New Blank. */
  defaultDevice: string;
  agentPermission: AgentPermission;
  /** Show the welcome screen every time Sonobe starts (it always shows on the first launch). */
  showWelcomeOnLaunch: boolean;
  /** Project paths whose JavaScript patches may run without asking. */
  trustedProjects: string[];
}

export interface SettingsActions {
  update: (patch: Partial<AppSettings>) => void;
  trustProject: (path: string) => void;
  revokeProject: (path: string) => void;
  isTrusted: (path: string | null | undefined) => boolean;
  reset: () => void;
}

export type SettingsState = AppSettings & SettingsActions;

export const SETTINGS_STORAGE_KEY = "sonobe.settings.v1";

export const DEFAULT_SETTINGS: AppSettings = {
  motion: "system",
  defaultDevice: DEFAULT_DEVICE,
  agentPermission: "edit",
  showWelcomeOnLaunch: false,
  trustedProjects: [],
};

const MOTIONS: readonly MotionPreference[] = ["system", "reduce", "full"];

/** Coerce anything (stale or hand-edited storage) into valid settings. */
export function sanitizeSettings(input: unknown): AppSettings {
  const src = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const device = typeof src.defaultDevice === "string" && DEVICE_PRESETS.some((d) => d.id === src.defaultDevice) ? src.defaultDevice : DEFAULT_SETTINGS.defaultDevice;
  const trusted = Array.isArray(src.trustedProjects) ? [...new Set(src.trustedProjects.filter((p): p is string => typeof p === "string" && p.length > 0))] : [];
  return {
    motion: MOTIONS.includes(src.motion as MotionPreference) ? (src.motion as MotionPreference) : DEFAULT_SETTINGS.motion,
    defaultDevice: device,
    agentPermission: src.agentPermission === "readOnly" ? "readOnly" : "edit",
    showWelcomeOnLaunch: typeof src.showWelcomeOnLaunch === "boolean" ? src.showWelcomeOnLaunch : DEFAULT_SETTINGS.showWelcomeOnLaunch,
    trustedProjects: trusted.slice(-200),
  };
}

export function pickSettings(state: AppSettings): AppSettings {
  const { motion, defaultDevice, agentPermission, showWelcomeOnLaunch, trustedProjects } = state;
  return { motion, defaultDevice, agentPermission, showWelcomeOnLaunch, trustedProjects };
}

export interface SettingsStoreOptions {
  /** null disables persistence. */
  storageKey?: string | null;
}

export function createSettingsStore(options: SettingsStoreOptions = {}): StoreApi<SettingsState> {
  const key = options.storageKey === undefined ? SETTINGS_STORAGE_KEY : options.storageKey;
  const initial = key ? sanitizeSettings(readJSON(key, (v): v is unknown => v !== null)) : DEFAULT_SETTINGS;
  const store = createStore<SettingsState>()((set, get) => ({
    ...initial,
    update: (patch) => set((s) => sanitizeSettings({ ...pickSettings(s), ...patch })),
    trustProject: (path) => set((s) => (s.trustedProjects.includes(path) ? s : { trustedProjects: [...s.trustedProjects, path] })),
    revokeProject: (path) => set((s) => ({ trustedProjects: s.trustedProjects.filter((p) => p !== path) })),
    isTrusted: (path) => !!path && get().trustedProjects.includes(path),
    reset: () => set({ ...DEFAULT_SETTINGS }),
  }));
  if (key) store.subscribe((state) => writeJSON(key, pickSettings(state)));
  return store;
}

/** The editor's settings. */
export const settingsStore = createSettingsStore();

export function useSettings<T>(selector: (state: SettingsState) => T): T {
  return useStore(settingsStore, selector);
}

/** Whether interface animation should be reduced for a preference and the OS setting. */
export function shouldReduceMotion(preference: MotionPreference, systemPrefersReduced: boolean): boolean {
  return preference === "reduce" || (preference === "system" && systemPrefersReduced);
}

/**
 * Apply a motion preference to <html data-motion="reduce" | "full">, following the OS while it's
 * "system". Returns a function that stops listening.
 */
export function applyMotionPreference(preference: MotionPreference, root: HTMLElement | undefined = typeof document === "undefined" ? undefined : document.documentElement): () => void {
  if (!root) return () => undefined;
  const query = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  const sync = () => root.setAttribute("data-motion", shouldReduceMotion(preference, !!query?.matches) ? "reduce" : "full");
  sync();
  if (preference !== "system" || !query) return () => undefined;
  query.addEventListener?.("change", sync);
  return () => query.removeEventListener?.("change", sync);
}
