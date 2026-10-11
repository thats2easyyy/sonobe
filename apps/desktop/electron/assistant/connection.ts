/**
 * What the Assistant runs on, app-wide: the experimental subscription switch (Settings → Claude, off
 * by default and awaiting Anthropic's permission) and the person's pick in the Assistant's setup. The
 * main process keeps them in userData/assistant-connection.json (0600) and enforces them; the renderer
 * only asks (setConnection).
 *
 * Whether this build offers the switch at all is offersSubscription(): Sonobe run from a checkout does,
 * and a packaged app, which every release is, only when that file carries PACKAGED_OPT_IN set to true.
 * A person sets that key by hand, on their own computer (CONTRIBUTING.md says how, ARCHITECTURE.md §10
 * why the default stays off). Sonobe reads it once, at launch. Nothing in Sonobe sets it: update() doesn't
 * know the key, and a save writes it only when the file itself has it as true at that moment, never from
 * what this launch remembers. A file Sonobe can't read is ignored at launch and left as it is at a save.
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
 * person opted in by hand. Both sides are exact, so a missing or malformed answer offers nothing.
 * packages/cli/src/docs.test.ts pins this rule; widen it there first, on purpose.
 */
export function offersSubscription(build: { packaged: boolean; optedIn: boolean }): boolean {
  return build.packaged === false || build.optedIn === true;
}

/** What the log says about a packaged app's gate, or null when there's nothing to say. It never says how to opt in. */
export function packagedOfferNote(build: { packaged: boolean; optedIn: boolean }, saved: { subscriptionEnabled: boolean }): string | null {
  if (build.packaged === false) return null;
  if (build.optedIn === true) return `This packaged Sonobe offers the experimental Claude subscription switch: assistant-connection.json has "${PACKAGED_OPT_IN}": true, set by hand.`;
  if (saved.subscriptionEnabled) return "assistant-connection.json has the Claude subscription switch on, but a packaged Sonobe doesn't offer it, so the Assistant uses your Anthropic API key.";
  return null;
}

/** The settings as saved: everything but whether this build offers the switch. */
export type SavedConnection = Omit<AssistantConnection, "available">;

export interface ConnectionStore {
  get(): SavedConnection;
  /**
   * Applies the fields it knows, with well-formed values, and saves them when they changed. Never PACKAGED_OPT_IN:
   * the save keeps that key only when the file has it as true at that moment.
   */
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

const isRecord = (raw: unknown): raw is Record<string, unknown> => !!raw && typeof raw === "object" && !Array.isArray(raw);

/** The fields a patch or a file gives, well formed, over `base`. */
function sanitize(raw: unknown, base: Stored): Stored {
  const o = isRecord(raw) ? raw : {};
  return {
    subscriptionEnabled: typeof o.subscriptionEnabled === "boolean" ? o.subscriptionEnabled : base.subscriptionEnabled,
    provider: isProvider(o.provider) ? o.provider : base.provider,
  };
}

/** The pick counts only while the switch is on. */
export function withActive(stored: Stored): SavedConnection {
  return { ...stored, active: stored.subscriptionEnabled && stored.provider === "subscription" ? "subscription" : "api_key" };
}

/**
 * What the file holds: its JSON object; "missing" when there is no file, or nothing in it; "unreadable" when
 * it can't be read or isn't one JSON object, with what's wrong and what to do about it. Neither names the key.
 */
type Saved = { state: "read"; raw: Record<string, unknown> } | { state: "missing" } | { state: "unreadable"; problem: string; hint: string };

function readSaved(file: string): Saved {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // No such file, or no such folder to hold one.
    return code === "ENOENT" || code === "ENOTDIR" ? { state: "missing" } : { state: "unreadable", problem: `couldn't be read (${code ?? (err instanceof Error ? err.message : String(err))})`, hint: "Check that your account may read it, or delete it." };
  }
  if (!text.trim()) return { state: "missing" };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { state: "unreadable", problem: "isn't valid JSON", hint: "Check it for a missing or trailing comma and for curly quotes, or delete it." };
  }
  return isRecord(raw) ? { state: "read", raw } : { state: "unreadable", problem: "isn't a JSON object", hint: "It has to be one object in braces. Fix it, or delete it." };
}

export function createConnectionStore(options: ConnectionStoreOptions): ConnectionStore {
  const log = options.log ?? (() => undefined);
  const file = options.file;
  let stored = DEFAULTS;
  // Only `true` opts in. Anything else counts as absent.
  let optedIn = false;
  const saved: Saved = file ? readSaved(file) : { state: "missing" };
  // Missing or unreadable: the defaults, with the switch off and no opt-in. A person edits this file by hand, so say when it's ignored.
  if (saved.state === "unreadable") log("warn", `assistant-connection.json ${saved.problem}, so Sonobe ignores it: the Assistant's connection settings start from their defaults. ${saved.hint}`);
  if (saved.state === "read") {
    stored = sanitize(saved.raw, DEFAULTS);
    const value = saved.raw[PACKAGED_OPT_IN];
    optedIn = value === true;
    if (value !== undefined && typeof value !== "boolean") log("warn", `assistant-connection.json has "${PACKAGED_OPT_IN}" set to something other than true or false, so it's ignored.`);
  }
  /**
   * Writes the switch and the pick, and the key only when the file has it as true right now: a save neither
   * drops what the person added while Sonobe ran nor puts back what they took out, and never takes the key
   * from what this launch read. A file that can't be read may be a person's edit, half done or slipped, so it
   * stays as it is and the log says so.
   */
  const save = (to: string): void => {
    const now = readSaved(to);
    if (now.state === "unreadable") {
      log("warn", `assistant-connection.json ${now.problem}, so Sonobe left it as it is and this change lasts only until Sonobe quits. ${now.hint}`);
      return;
    }
    const keep = now.state === "read" && now.raw[PACKAGED_OPT_IN] === true;
    atomicWriteFileSync(to, `${JSON.stringify({ ...stored, ...(keep ? { [PACKAGED_OPT_IN]: true } : {}) }, null, 2)}\n`, { mode: 0o600 });
  };
  // Frozen, so nothing that holds the store can swap its answers.
  return Object.freeze({
    get: () => withActive(stored),
    packagedOptIn: () => optedIn,
    update(patch) {
      const next = sanitize(patch, stored);
      if (next.subscriptionEnabled !== stored.subscriptionEnabled || next.provider !== stored.provider) {
        stored = next;
        try {
          if (file) save(file);
        } catch (err) {
          // It still applies until Sonobe quits.
          log("warn", `Couldn't save the Assistant's connection settings: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      return withActive(stored);
    },
  } satisfies ConnectionStore);
}
