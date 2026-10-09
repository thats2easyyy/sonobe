import { describe, expect, it } from "vitest";
import { createDisplayRate } from "./displayRate.ts";

function feed(gaps: number[]) {
  const rate = createDisplayRate();
  let now = 1000;
  rate.tick(now);
  for (const gap of gaps) rate.tick((now += gap));
  return rate;
}

const steady = (ms: number, n = 60) => Array.from({ length: n }, () => ms);

describe("display rate", () => {
  it("reads the rate of steady frames, snapped to a rate displays run at", () => {
    expect(feed(steady(1000 / 120)).hz()).toBe(120);
    expect(feed(steady(16.67)).hz()).toBe(60);
    expect(feed(steady(16.4)).hz()).toBe(60);
    expect(feed(steady(1000 / 144)).hz()).toBe(144);
    expect(feed(steady(1000 / 85)).hz()).toBe(85);
  });

  it("reads 0 until it has seen ten frames", () => {
    expect(createDisplayRate().hz()).toBe(0);
    expect(feed(steady(16.67, 9)).hz()).toBe(0);
    expect(feed(steady(16.67, 10)).hz()).toBe(60);
  });

  it("shows the display, not the loop, when half the frames drop", () => {
    const gaps = Array.from({ length: 120 }, (_, i) => (i % 2 ? 1000 / 60 : 1000 / 120));
    expect(feed(gaps).hz()).toBe(120);
  });

  it("isn't fooled by one early frame or by a long stall", () => {
    expect(feed([...steady(16.67, 40), 3, ...steady(16.67, 40)]).hz()).toBe(60);
    expect(feed([...steady(16.67, 20), 5000, ...steady(16.67, 20)]).hz()).toBe(60);
  });

  it("forgets the gap across a rest, and keeps the rate", () => {
    const rate = feed(steady(1000 / 120));
    rate.reset();
    rate.tick(60_000);
    rate.tick(60_000 + 1000 / 120);
    expect(rate.hz()).toBe(120);
  });

  it("follows a window moved to another display", () => {
    const rate = feed([...steady(1000 / 120, 300), ...steady(1000 / 60, 700)]);
    expect(rate.hz()).toBe(60);
  });
});
