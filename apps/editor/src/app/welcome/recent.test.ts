import { describe, expect, it } from "vitest";
import { recentFolder } from "./recent.ts";

describe("recentFolder", () => {
  it("shortens the home folder", () => {
    expect(recentFolder("/Users/tyler/Design/Card.sonobe")).toBe("~/Design");
    expect(recentFolder("/home/ana/Card.sonobe")).toBe("~");
    expect(recentFolder("C:\\Users\\ana\\Docs\\Card.sonobe")).toBe("~\\Docs");
  });

  it("keeps the last two folders of a deep path", () => {
    expect(recentFolder("/Users/tyler/a/b/c/Card.sonobe")).toBe("…/b/c");
    expect(recentFolder("/srv/a/b/c/Card.sonobe")).toBe("…/b/c");
  });

  it("keeps a short path whole", () => {
    expect(recentFolder("/tmp/Card.sonobe")).toBe("/tmp");
  });

  it("is empty when there is no folder", () => {
    expect(recentFolder("browser:Beta")).toBe("");
    expect(recentFolder("/Card.sonobe")).toBe("");
  });
});
