/**
 * "Warn once per restart" logging (CONVENTIONS.md §16.7). Warnings are remembered per runtime
 * services object and patch instance, and forgotten when the prototype restarts: when
 * `services.restartCount` changes, or (for hosts without it) when the frame counter goes backwards.
 * Warnings go through the engine's `ctx.warnOnce` when the context has it, so the runtime's own
 * restart-aware ledger has the last word.
 */

import type { PatchContext, RuntimeServices } from "@sonobe/engine";

type LogLevel = "log" | "warn" | "error";

/** The parts of a PatchContext the once-helpers read. `warnOnce` is used when present. */
export type OnceContext = Pick<PatchContext, "id" | "componentPath" | "frame" | "services"> & { warnOnce?: PatchContext["warnOnce"] };

interface Ledger {
  lastFrame: number;
  restartCount: number | undefined;
  logged: Set<string>;
}

const ledgers = new WeakMap<RuntimeServices, Ledger>();

function restartsOf(services: RuntimeServices): number | undefined {
  const count = (services as { restartCount?: unknown }).restartCount;
  return typeof count === "number" && Number.isFinite(count) ? count : undefined;
}

/**
 * Log `message` at most once per patch instance and `key` until the prototype restarts.
 * Returns true when it logged.
 */
export function logOnce(ctx: OnceContext, level: LogLevel, key: string, message: string): boolean {
  const restartCount = restartsOf(ctx.services);
  let ledger = ledgers.get(ctx.services);
  if (!ledger) {
    ledger = { lastFrame: ctx.frame, restartCount, logged: new Set() };
    ledgers.set(ctx.services, ledger);
  }
  if (restartCount !== ledger.restartCount || ctx.frame < ledger.lastFrame) ledger.logged.clear();
  ledger.restartCount = restartCount;
  ledger.lastFrame = ctx.frame;
  const id = `${ctx.componentPath}/${ctx.id}#${level}:${key}`;
  if (ledger.logged.has(id)) return false;
  ledger.logged.add(id);
  if (level === "warn" && typeof ctx.warnOnce === "function") ctx.warnOnce(key, message);
  else ctx.services.log(level, message);
  return true;
}

/** Warn with `message` at most once per patch instance and `key` per restart (through `ctx.warnOnce` when present). */
export function warnOnce(ctx: OnceContext, key: string, message: string): boolean {
  return logOnce(ctx, "warn", key, message);
}

/** Forget every once-message logged through `services` (for hosts that restart without resetting frames). */
export function resetOnceLog(services: RuntimeServices): void {
  ledgers.delete(services);
}
