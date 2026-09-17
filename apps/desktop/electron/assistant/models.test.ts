import { describe, expect, it } from "vitest";
import { addUsage, DEFAULT_MODEL, emptyUsage, estimateCostUsd, isModelId, modelInfos, MODELS, resolveModel } from "./models.ts";

describe("model catalog", () => {
  it("offers Sonnet 5 by default, plus Opus 5 and Haiku 4.5", () => {
    expect(DEFAULT_MODEL).toBe("claude-sonnet-5");
    expect(MODELS.map((m) => m.id)).toEqual(["claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5-20251001"]);
    expect(modelInfos()[0]).toEqual({ id: "claude-sonnet-5", label: "Claude Sonnet 5", description: expect.any(String), pricing: { input: 2, output: 10 } });
  });

  it("uses adaptive thinking only where it's supported, and fallbacks for Opus 5", () => {
    expect(resolveModel("claude-haiku-4-5-20251001")).toMatchObject({ adaptiveThinking: false, fallbacks: false });
    expect(resolveModel("claude-opus-5")).toMatchObject({ adaptiveThinking: true, fallbacks: true });
    expect(resolveModel("claude-sonnet-5")).toMatchObject({ adaptiveThinking: true, fallbacks: false });
  });

  it("falls back to the default for unknown ids", () => {
    expect(resolveModel("gpt-5").id).toBe(DEFAULT_MODEL);
    expect(resolveModel(undefined).id).toBe(DEFAULT_MODEL);
    expect(isModelId("claude-opus-5")).toBe(true);
    expect(isModelId("claude-opus-4-8")).toBe(false);
  });
});

describe("usage", () => {
  it("accumulates tokens and a list-price estimate with cache pricing", () => {
    const sonnet = resolveModel("claude-sonnet-5");
    let totals = emptyUsage();
    totals = addUsage(totals, { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 20_000, cache_read_input_tokens: 0 }, sonnet);
    totals = addUsage(totals, { input_tokens: 200, output_tokens: 100, cache_creation_input_tokens: null, cache_read_input_tokens: 20_000 }, sonnet);
    expect(totals).toMatchObject({ inputTokens: 1200, outputTokens: 600, cacheWriteTokens: 20_000, cacheReadTokens: 20_000, totalTokens: 41_800, requests: 2 });
    // (1200×2 + 20000×2×1.25 + 20000×2×0.1 + 600×10) / 1M
    expect(totals.estimatedCostUsd).toBeCloseTo((2400 + 50_000 + 4000 + 6000) / 1_000_000, 10);
  });

  it("prices Opus 5 above Haiku 4.5 for the same usage", () => {
    const usage = { input_tokens: 10_000, output_tokens: 2000 };
    expect(estimateCostUsd(usage, resolveModel("claude-opus-5"))).toBeGreaterThan(estimateCostUsd(usage, resolveModel("claude-haiku-4-5-20251001")));
  });

  it("counts a request without usage", () => {
    expect(addUsage(emptyUsage(), null, resolveModel("claude-sonnet-5")).requests).toBe(1);
  });
});
