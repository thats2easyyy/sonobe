import { describe, expect, it } from "vitest";
import { cableControlOffset, cablePath } from "./geometry.ts";

describe("cableControlOffset", () => {
  it("keeps a cable between neighbouring nodes from swinging back over them", () => {
    expect(cableControlOffset(250, 252)).toBe(11);
    expect(cableControlOffset(250, 290)).toBe(30);
    expect(cablePath(250, 123, 252, 101)).toBe("M 250 123 C 261 123, 241 101, 252 101");
  });

  it("is unchanged from 52 points of room up, and continuous there", () => {
    expect(cableControlOffset(0, 52)).toBe(36);
    expect(cableControlOffset(0, 51.9)).toBeCloseTo(36, 0);
    expect(cableControlOffset(0, 200)).toBe(100);
  });

  it("bends wide when the target is behind the source", () => {
    expect(cableControlOffset(400, 300)).toBe(60);
    expect(cableControlOffset(1000, 0)).toBe(160);
  });
});
