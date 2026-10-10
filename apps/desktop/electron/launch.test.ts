import { describe, expect, it } from "vitest";
import { planLaunch, showsLaunch, type LaunchPlanInput } from "./launch.ts";
import type { ReopenStep } from "./update-restart.ts";

const DRAFTS = "/data/Drafts";
const DRAFT = "draft-0001-abcd";

/** A disk with two prototypes, a draft's folder, a folder that isn't a prototype, and a share that never answers well. */
function plan(paths: string[], steps: ReopenStep[] = [], extra: Partial<LaunchPlanInput> = {}) {
  const projects = ["/work/Checkout.sonobe", "/work/Onboarding.sonobe", `${DRAFTS}/${DRAFT}.sonobe`];
  return planLaunch({
    paths,
    steps,
    resolve: async (candidate) => (projects.includes(candidate) ? candidate : candidate === "/work/Checkout.sonobe/project.json" ? "/work/Checkout.sonobe" : null),
    exists: (candidate) => candidate === "/work/Notes",
    draftAt: async (dir) => (dir.startsWith(`${DRAFTS}/`) ? DRAFT : null),
    ...extra,
  });
}

describe("planLaunch", () => {
  it("starts the window on the first prototype and leaves the others for the usual queue, in order", async () => {
    expect(await plan(["/work/Checkout.sonobe", "/work/Onboarding.sonobe"])).toEqual({
      info: { reopening: false, open: { kind: "project", path: "/work/Checkout.sonobe" }, problems: [] },
      restPaths: ["/work/Onboarding.sonobe"],
      restSteps: [],
    });
  });

  it("opens the folder a path selects (a project.json inside it)", async () => {
    expect((await plan(["/work/Checkout.sonobe/project.json"])).info.open).toEqual({ kind: "project", path: "/work/Checkout.sonobe" });
  });

  it("brings a draft's folder back as the draft it is, never as a project", async () => {
    expect((await plan([`${DRAFTS}/${DRAFT}.sonobe`])).info.open).toEqual({ kind: "draft", id: DRAFT, project: null });
  });

  it("tells the editor about every path that isn't a prototype, and why, instead of only logging it", async () => {
    const planned = await plan(["/gone/Old.sonobe", "/work/Notes", "/work/Onboarding.sonobe"]);
    expect(planned.info.open).toEqual({ kind: "project", path: "/work/Onboarding.sonobe" });
    expect(planned.info.problems).toEqual([
      { path: "/gone/Old.sonobe", reason: "missing" },
      { path: "/work/Notes", reason: "notProject" },
    ]);
    expect(planned.restPaths).toEqual([]);
  });

  it("starts on nothing when no path is a prototype: the editor shows what a plain launch shows, and the problems", async () => {
    expect(await plan(["/gone/Old.sonobe"])).toEqual({ info: { reopening: false, open: null, problems: [{ path: "/gone/Old.sonobe", reason: "missing" }] }, restPaths: [], restSteps: [] });
  });

  it("counts a path it can't look at as missing, and a draft store that fails as no draft", async () => {
    const failing = await plan(["/share/Slow.sonobe", "/work/Checkout.sonobe"], [], {
      resolve: async (candidate) => {
        if (candidate.startsWith("/share/")) throw new Error("EIO");
        return candidate;
      },
      draftAt: async () => {
        throw new Error("EACCES");
      },
    });
    expect(failing.info).toEqual({ reopening: false, open: { kind: "project", path: "/work/Checkout.sonobe" }, problems: [{ path: "/share/Slow.sonobe", reason: "missing" }] });
  });

  it("doesn't wait for a path that doesn't answer: the window starts on the next one, and that path opens the usual way", async () => {
    const looked: string[] = [];
    const hanging = await plan(["/share/Hung.sonobe", "/work/Checkout.sonobe", "/work/Onboarding.sonobe"], [], {
      resolve: (candidate) => (candidate.startsWith("/share/") ? new Promise<string | null>(() => undefined) : Promise.resolve(candidate)),
      exists: (candidate) => (looked.push(candidate), false),
      lookTimeoutMs: 20,
    });
    // Not a problem: nobody knows yet whether it's there. And nothing looks at it again, which would wait on the same share.
    expect(hanging).toEqual({ info: { reopening: false, open: { kind: "project", path: "/work/Checkout.sonobe" }, problems: [] }, restPaths: ["/share/Hung.sonobe", "/work/Onboarding.sonobe"], restSteps: [] });
    expect(looked).toEqual([]);
  });

  it("starts on nothing when the only path doesn't answer, and never on what a restart wrote down", async () => {
    const started = Date.now();
    const planned = await plan(["/share/Hung.sonobe"], [{ kind: "project", path: "/work/Onboarding.sonobe" }], { resolve: () => new Promise<string | null>(() => undefined), lookTimeoutMs: 20 });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(planned).toEqual({ info: { reopening: false, open: null, problems: [] }, restPaths: ["/share/Hung.sonobe"], restSteps: [] });
  });

  it("starts on a restart's first step with `reopening`, and returns the rest", async () => {
    const steps: ReopenStep[] = [
      { kind: "draft", id: DRAFT, project: "/work/Checkout.sonobe" },
      { kind: "project", path: "/work/Onboarding.sonobe" },
    ];
    expect(await plan([], steps)).toEqual({
      info: { reopening: true, open: { kind: "draft", id: DRAFT, project: "/work/Checkout.sonobe" }, problems: [] },
      restPaths: [],
      restSteps: [steps[1]],
    });
    expect((await plan([], [steps[1]!])).info).toEqual({ reopening: true, open: { kind: "project", path: "/work/Onboarding.sonobe" }, problems: [] });
  });

  it("lets a path win over what a restart wrote down, even a path that isn't a prototype", async () => {
    const steps: ReopenStep[] = [{ kind: "project", path: "/work/Onboarding.sonobe" }];
    expect((await plan(["/work/Checkout.sonobe"], steps)).info).toEqual({ reopening: false, open: { kind: "project", path: "/work/Checkout.sonobe" }, problems: [] });
    expect(await plan(["/gone/Old.sonobe"], steps)).toEqual({ info: { reopening: false, open: null, problems: [{ path: "/gone/Old.sonobe", reason: "missing" }] }, restPaths: [], restSteps: [] });
  });

  it("starts on nothing with nothing to open", async () => {
    expect(await plan([])).toEqual({ info: { reopening: false, open: null, problems: [] }, restPaths: [], restSteps: [] });
  });
});

describe("showsLaunch", () => {
  it("is the project's folder for a project", () => {
    const open = { kind: "project", path: "/work/Checkout.sonobe" } as const;
    expect(showsLaunch(open, { projectPath: "/work/Checkout.sonobe", draft: null })).toBe(true);
    expect(showsLaunch(open, { projectPath: null, draft: null })).toBe(false);
    expect(showsLaunch(open, null)).toBe(false);
  });

  it("is the draft for a draft, or its project when the draft didn't come back", () => {
    const open = { kind: "draft", id: DRAFT, project: "/work/Checkout.sonobe" } as const;
    expect(showsLaunch(open, { projectPath: "/work/Checkout.sonobe", draft: { id: DRAFT } })).toBe(true);
    expect(showsLaunch(open, { projectPath: null, draft: { id: DRAFT } })).toBe(true);
    expect(showsLaunch(open, { projectPath: "/work/Checkout.sonobe", draft: null })).toBe(true);
    // The launch document the editor rendered before the work was back: an MCP call must keep waiting.
    expect(showsLaunch(open, { projectPath: null, draft: null })).toBe(false);
    expect(showsLaunch({ ...open, project: null }, { projectPath: null, draft: { id: "draft-0002-ffff" } })).toBe(false);
  });
});
