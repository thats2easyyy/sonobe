/**
 * What the Assistant runs on, app-wide: the experimental subscription switch (Settings → Claude, off
 * by default and awaiting Anthropic's permission) and the person's pick in the Assistant's setup. The
 * main process keeps them in userData/assistant-connection.json (0600) and enforces them; the renderer
 * only asks (setConnection).
 */

import { readFileSync } from "node:fs";
import { atomicWriteFileSync } from "../fs-utils.ts";
import type { AssistantConnection, AssistantConnectionUpdate, AssistantProvider } from "./protocol.ts";

export interface ConnectionStore {
  get(): AssistantConnection;
  /** Applies the fields it knows, with well-formed values, and saves them when they changed. */
  update(patch: AssistantConnectionUpdate): AssistantConnection;
}

export interface ConnectionStoreOptions {
  /** Where it's kept. Without one, it lasts until Sonobe quits. */
  file?: string;
  log?(level: "info" | "warn" | "error", message: string): void;
}

type Stored = Omit<AssistantConnection, "active">;

const DEFAULTS: Stored = { subscriptionEnabled: false, provider: "api_key" };

const isProvider = (value: unknown): value is AssistantProvider => value === "api_key" || value === "subscription";

/** The fields a patch or a file gives, well formed, over `base`. */
function sanitize(raw: unknown, base: Stored): Stored {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    subscriptionEnabled: typeof o.subscriptionEnabled === "boolean" ? o.subscriptionEnabled : base.subscriptionEnabled,
    provider: isProvider(o.provider) ? o.provider : base.provider,
  };
}

/** The pick counts only while the switch is on. */
export function withActive(stored: Stored): AssistantConnection {
  return { ...stored, active: stored.subscriptionEnabled && stored.provider === "subscription" ? "subscription" : "api_key" };
}

export function createConnectionStore(options: ConnectionStoreOptions): ConnectionStore {
  const log = options.log ?? (() => undefined);
  const file = options.file;
  let stored = DEFAULTS;
  try {
    if (file) stored = sanitize(JSON.parse(readFileSync(file, "utf8")), DEFAULTS);
  } catch {
    // Missing or malformed: the defaults, with the switch off.
  }
  return {
    get: () => withActive(stored),
    update(patch) {
      const next = sanitize(patch, stored);
      if (next.subscriptionEnabled !== stored.subscriptionEnabled || next.provider !== stored.provider) {
        stored = next;
        try {
          if (file) atomicWriteFileSync(file, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
        } catch (err) {
          // It still applies until Sonobe quits.
          log("warn", `Couldn't save the Assistant's connection settings: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      return withActive(stored);
    },
  };
}
