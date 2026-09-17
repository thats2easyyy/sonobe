import { describe, expect, it } from "vitest";
import { budgetFraction, formatCost, formatTokens, validateApiKey } from "./format.ts";

describe("formatTokens", () => {
  it("abbreviates thousands and millions", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(1000)).toBe("1K");
    expect(formatTokens(12_345)).toBe("12K");
    expect(formatTokens(1_250)).toBe("1.3K");
    expect(formatTokens(1_500_000)).toBe("1.5M");
    expect(formatTokens(Number.NaN)).toBe("0");
  });
});

describe("formatCost", () => {
  it("shows cents, tiny amounts, and whole dollars", () => {
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(0.004)).toBe("<$0.01");
    expect(formatCost(0.4219)).toBe("$0.42");
    expect(formatCost(12.6)).toBe("$13");
  });
});

describe("budgetFraction", () => {
  it("clamps to 0–1", () => {
    expect(budgetFraction(750_000, 1_500_000)).toBe(0.5);
    expect(budgetFraction(2_000_000, 1_500_000)).toBe(1);
    expect(budgetFraction(10, 0)).toBe(0);
  });
});

describe("validateApiKey", () => {
  it("accepts Anthropic keys and trims them", () => {
    expect(validateApiKey("  sk-ant-api03-abcdef123456\n")).toEqual({ ok: true, value: "sk-ant-api03-abcdef123456" });
  });

  it("rejects empty, spaced, and Admin keys", () => {
    expect(validateApiKey("   ")).toMatchObject({ ok: false, error: "Paste your API key." });
    expect(validateApiKey("sk-ant-api03 abc")).toMatchObject({ ok: false });
    expect(validateApiKey("sk-ant-admin01-xyz")).toMatchObject({ ok: false, error: expect.stringContaining("Admin API key") });
  });

  it("warns about unusual formats without blocking", () => {
    expect(validateApiKey("custom-proxy-key")).toMatchObject({ ok: true, warning: expect.stringContaining("sk-ant-") });
  });
});
