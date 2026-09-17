/**
 * "Warn once per restart" logging (CONVENTIONS.md §16.7). Warnings are remembered per runtime
 * services object and patch instance, and forgotten when the frame counter goes backwards,
 * which is what a restart looks like from inside a patch.
 */

import type { PatchContext, RuntimeServices } from "@sonobe/engine";

type LogLevel = "log" | "warn" | "error";

/** The parts of a PatchContext the once-helpers read. */
export type OnceContext = Pick<PatchContext, "id" | "componentPath" | "frame" | "services">;

interface Ledger {
  lastFrame: number;
  logged: Set<string>;
}

const ledgers = new WeakMap<RuntimeServices, Ledger>();

/**
 * Log `message` at most once per patch instance and `key` until the prototype restarts.
 * Returns true when it logged.
 */
export function logOnce(ctx: OnceContext, level: LogLevel, key: string, message: string): boolean {
  let ledger = ledgers.get(ctx.services);
  if (!ledger) {
    ledger = { lastFrame: ctx.frame, logged: new Set() };
    ledgers.set(ctx.services, ledger);
  }
  if (ctx.frame < ledger.lastFrame) ledger.logged.clear();
  ledger.lastFrame = ctx.frame;
  const id = `${ctx.componentPath}/${ctx.id}#${level}:${key}`;
  if (ledger.logged.has(id)) return false;
  ledger.logged.add(id);
  ctx.services.log(level, message);
  return true;
}

/** `ctx.services.log("warn", message)` at most once per patch instance and `key` per restart. */
export function warnOnce(ctx: OnceContext, key: string, message: string): boolean {
  return logOnce(ctx, "warn", key, message);
}

/** Forget every once-message logged through `services` (for hosts that restart without resetting frames). */
export function resetOnceLog(services: RuntimeServices): void {
  ledgers.delete(services);
}
