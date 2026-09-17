import type { RuntimeServices } from "@sonobe/engine";
import { describe, expect, it } from "vitest";
import { logOnce, resetOnceLog, warnOnce } from "./warn.ts";

function setup() {
  const logs: string[] = [];
  const services = { log: (level: string, ...args: unknown[]) => logs.push(`${level}: ${String(args[0])}`) } as unknown as RuntimeServices;
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
