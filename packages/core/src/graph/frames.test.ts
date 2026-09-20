import { describe, expect, it } from "vitest";
import { frameContents, homeFrame, parentFrame } from "./frames.ts";

const rect = (id: string, x: number, y: number, width: number, height: number) => ({ id, x, y, width, height });

describe("frame membership", () => {
  const outer = rect("outer", 0, 0, 800, 500);
  const inner = rect("inner", 40, 60, 300, 200);
  const other = rect("other", 1000, 0, 300, 200);
  const frames = [outer, inner, other];

  it("puts a node in the innermost frame under its title bar, even when it grew past the frame's edge", () => {
    const wide = rect("wide", 700, 300, 260, 60);
    expect(homeFrame(wide, frames)?.id).toBe("outer");
    expect(homeFrame(rect("a", 60, 100, 180, 80), frames)?.id).toBe("inner");
    expect(parentFrame(inner, frames)?.id).toBe("outer");
    expect(parentFrame(outer, frames)).toBeUndefined();
  });

  it("gives a frame's contents: its nodes, the frames inside it, and theirs", () => {
    const nodes = [rect("a", 60, 100, 180, 80), rect("b", 400, 40, 180, 80), rect("wide", 700, 300, 260, 60), rect("far", 1020, 40, 180, 80), rect("loose", 0, 900, 180, 80)];
    const contents = frameContents("outer", frames, nodes);
    expect(contents.nodes.map((n) => n.id)).toEqual(["a", "b", "wide"]);
    expect(contents.frames.map((f) => f.id)).toEqual(["inner"]);
    expect(frameContents("inner", frames, nodes).nodes.map((n) => n.id)).toEqual(["a"]);
    expect(frameContents("other", frames, nodes)).toEqual({ nodes: [nodes[3]], frames: [] });
  });
});
