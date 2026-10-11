/**
 * What the Assistant runs on, app-wide: the experimental subscription switch (Settings → Claude, off
 * by default and awaiting Anthropic's permission) and the person's pick in the Assistant's setup. The
 * main process keeps them in userData/assistant-connection.json (0600) and enforces them; the renderer
 * only asks (setConnection).
 *
 * Whether this build offers the switch at all is offersSubscription(): Sonobe run from a checkout does,
 * and a packaged app, which every release is, only when that file carries PACKAGED_OPT_IN set to true.
 * A person sets that key by hand, on their own computer (CONTRIBUTING.md says how, ARCHITECTURE.md §10
 * why the default stays off). Sonobe reads it once, at launch, and carries it through a save as the file
 * has it. Nothing in Sonobe sets or clears it: update() doesn't know the key.
 */

import { readFileSync } from "node:fs";
import { atomicWriteFileSync } from "../fs-utils.ts";
import type { AssistantConnection, AssistantConnectionUpdate, AssistantProvider } from "./protocol.ts";

/**
 * The key a person adds to assistant-connection.json, set to true, for a packaged Sonobe to offer the
 * switch. It names what it allows and where, it means nothing in a checkout, and it isn't the switch:
 * `subscriptionEnabled`, which Settings writes, is never enough in a packaged app.
 */
export const PACKAGED_OPT_IN = "subscriptionInPackagedApp";

/**
 * Whether this build offers the experimental switch. Run from a checkout: yes. Packaged: only when the
 * person opted in by hand. packages/cli/src/docs.test.ts pins this rule; widen it there first, on purpose.
 */
export function offersSubscription(build: { packaged: boolean; optedIn: boolean }): boolean {
  return !build.packaged || build.optedIn === true;
}

/** What the log says about a packaged app's gate, or null when there's nothing to say. It never says how to opt in. */
export function packagedOfferNote(build: { packaged: boolean; optedIn: boolean }, saved: { subscriptionEnabled: boolean }): string | null {
  if (!build.packaged) return null;
  if (build.optedIn === true) return `This packaged Sonobe offers the experimental Claude subscription switch: assistant-connection.json has "${PACKAGED_OPT_IN}": true, set by hand.`;
  if (saved.subscriptionEnabled) return "assistant-connection.json has the Claude subscription switch on, but a packaged Sonobe doesn't offer it, so the Assistant uses your Anthropic API key.";
  return null;
}

/** The settings as saved: everything but whether this build offers the switch. */
export type SavedConnection = Omit<AssistantConnection, "available">;

export interface ConnectionStore {
  get(): SavedConnection;
  /** Applies the fields it knows, with well-formed values, and saves them when they changed. Never PACKAGED_OPT_IN. */
  update(patch: AssistantConnectionUpdate): SavedConnection;
  /** The file had PACKAGED_OPT_IN set to true when Sonobe started. A later edit counts from the next launch. */
  packagedOptIn(): boolean;
}

export interface ConnectionStoreOptions {
  /** Where it's kept. Without one, it lasts until Sonobe quits. */
  file?: string;
  log?(level: "info" | "warn" | "error", message: string): void;
}

type Stored = Omit<SavedConnection, "active">;

const DEFAULTS: Stored = { subscriptionEnabled: false, provider: "api_key" };

const isProvider = (value: unknown): value is AssistantProvider => value === "api_key" || value === "subscription";

const record = (raw: unknown): Record<string, unknown> => (raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {});

/** The fields a patch or a file gives, well formed, over `base`. */
function sanitize(raw: unknown, base: Stored): Stored {
  const o = record(raw);
  return {
    subscriptionEnabled: typeof o.subscriptionEnabled === "boolean" ? o.subscriptionEnabled : base.subscriptionEnabled,
    provider: isProvider(o.provider) ? o.provider : base.provider,
  };
}

/** The pick counts only while the switch is on. */
export function withActive(stored: Stored): SavedConnection {
  return { ...stored, active: stored.subscriptionEnabled && stored.provider === "subscription" ? "subscription" : "api_key" };
}

/** What the file holds: its JSON, "missing" when there is no file, "unreadable" when it can't be read or parsed. */
function readSaved(file: string): { state: "read"; raw: unknown } | { state: "missing" } | { state: "unreadable" } {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ENOENT" ? { state: "missing" } : { state: "unreadable" };
  }
  try {
    return { state: "read", raw: JSON.parse(text) };
  } catch {
    return { state: "unreadable" };
  }
}

export function createConnectionStore(options: ConnectionStoreOptions): ConnectionStore {
  const log = options.log ?? (() => undefined);
  const file = options.file;
  let stored = DEFAULTS;
  // Only `true` opts in. Anything else counts as absent.
  let optedIn = false;
  const saved = file ? readSaved(file) : { state: "missing" as const };
  // Missing or malformed: the defaults, with the switch off.
  if (saved.state === "read") {
    stored = sanitize(saved.raw, DEFAULTS);
    const value = record(saved.raw)[PACKAGED_OPT_IN];
    optedIn = value === true;
    if (value !== undefined && typeof value !== "boolean") log("warn", `assistant-connection.json has "${PACKAGED_OPT_IN}" set to something other than true or false, so it's ignored.`);
  }
  /**
   * The key as the file has it now, so a save neither drops what the person added while Sonobe ran nor
   * puts back what they took out. A file that can't be read keeps what this launch started with.
   */
  const optInToKeep = (): boolean => {
    if (!file) return false;
    const now = readSaved(file);
    return now.state === "read" ? record(now.raw)[PACKAGED_OPT_IN] === true : now.state === "unreadable" && optedIn;
  };
  return {
    get: () => withActive(stored),
    packagedOptIn: () => optedIn,
    update(patch) {
      const next = sanitize(patch, stored);
      if (next.subscriptionEnabled !== stored.subscriptionEnabled || next.provider !== stored.provider) {
        stored = next;
        try {
          if (file) atomicWriteFileSync(file, `${JSON.stringify({ ...stored, ...(optInToKeep() ? { [PACKAGED_OPT_IN]: true } : {}) }, null, 2)}\n`, { mode: 0o600 });
        } catch (err) {
          // It still applies until Sonobe quits.
          log("warn", `Couldn't save the Assistant's connection settings: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      return withActive(stored);
    },
  };
}
