import type { RuntimeServices } from "@sonobe/engine";
import { describe, expect, it } from "vitest";
import { logOnce, resetOnceLog, warnOnce } from "./warn.ts";

function setup(extra: Record<string, unknown> = {}) {
  const logs: string[] = [];
  const services = { log: (level: string, ...args: unknown[]) => logs.push(`${level}: ${String(args[0])}`) } as unknown as RuntimeServices;
  Object.defineProperties(services, Object.getOwnPropertyDescriptors(extra));
  const ctx = (frame: number, id = "divide_1") => ({ id, componentPath: "main", frame, services });
  return { logs, ctx, services };
}

describe("warnOnce", () => {
  it("logs once per patch and key until frames go backwards", () => {
    const { logs, ctx } = setup();
    expect(warnOnce(ctx(0), "zero", "divide_1: Value 2 is 0, so the output is 0.")).toBe(true);
    expect(warnOnce(ctx(1), "zero", "again")).toBe(false);
    expect(warnOnce(ctx(2), "nan", "other key")).toBe(true);
    expect(warnOnce(ctx(3, "divide_2"), "zero", "other patch")).toBe(true);
    expect(warnOnce(ctx(4), "zero", "still quiet")).toBe(false);
    expect(warnOnce(ctx(0), "zero", "after restart")).toBe(true);
    expect(logs).toEqual(["warn: divide_1: Value 2 is 0, so the output is 0.", "warn: other key", "warn: other patch", "warn: after restart"]);
  });

  it("repeats after a restart even when the warning only fires on frame 0", () => {
    const restarts = { count: 0 };
    const { logs, ctx } = setup({
      get restartCount() {
        return restarts.count;
      },
    });
    expect(warnOnce(ctx(0), "start", "launch warning")).toBe(true);
    expect(warnOnce(ctx(0), "start", "same frame, same run")).toBe(false);
    restarts.count = 1;
    expect(warnOnce(ctx(0), "start", "after restart")).toBe(true);
    expect(warnOnce(ctx(12), "start", "later in that run")).toBe(false);
    restarts.count = 2;
    expect(warnOnce(ctx(20), "start", "frames went forward, but the prototype restarted")).toBe(true);
    expect(logs).toEqual(["warn: launch warning", "warn: after restart", "warn: frames went forward, but the prototype restarted"]);
  });

  it("warns through ctx.warnOnce when the context has it", () => {
    const { logs, services } = setup({ restartCount: 0 });
    const delegated: string[] = [];
    const ctx = { id: "p", componentPath: "main", frame: 0, services, warnOnce: (key: string, message: string) => delegated.push(`${key}: ${message}`) };
    expect(warnOnce(ctx, "k", "through the engine")).toBe(true);
    expect(warnOnce(ctx, "k", "deduplicated")).toBe(false);
    expect(logOnce(ctx, "error", "k", "errors still log directly")).toBe(true);
    expect(delegated).toEqual(["k: through the engine"]);
    expect(logs).toEqual(["error: errors still log directly"]);
  });

  it("keeps levels and runtimes separate, and can be reset", () => {
    const a = setup();
    const b = setup();
    expect(logOnce(a.ctx(0), "log", "k", "info")).toBe(true);
    expect(warnOnce(a.ctx(0), "k", "warn")).toBe(true);
    expect(warnOnce(b.ctx(0), "k", "other runtime")).toBe(true);
    expect(logOnce(a.ctx(1), "log", "k", "info")).toBe(false);
    resetOnceLog(a.services);
    expect(logOnce(a.ctx(5), "log", "k", "info again")).toBe(true);
    expect(a.logs).toEqual(["log: info", "warn: warn", "log: info again"]);
    expect(b.logs).toEqual(["warn: other runtime"]);
  });
});
