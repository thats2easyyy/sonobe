import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OwnWriteRegistry, writeProject } from "./project-io.ts";
import { createProjectWatcher, type WatchFn } from "./project-watcher.ts";

let project: string;

beforeEach(async () => {
  project = await mkdtemp(path.join(tmpdir(), "sonobe-watch-"));
  await mkdir(path.join(project, "components"), { recursive: true });
  await writeFile(path.join(project, "project.json"), "{}\n");
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(project, { recursive: true, force: true });
});

function fakeWatch() {
  const emitter = new EventEmitter();
  let listener: ((eventType: string, filename: string | null) => void) | null = null;
  let closed = false;
  const watch: WatchFn = (_dir, l) => {
    listener = l;
    return Object.assign(emitter, { close: () => void (closed = true) });
  };
  return {
    watch,
    emit: (filename: string | null, eventType = "change") => listener?.(eventType, filename),
    fail: (err: Error) => emitter.emit("error", err),
    get closed() {
      return closed;
    },
  };
}

describe("createProjectWatcher (fake fs.watch)", () => {
  it("debounces bursts into one sorted report", async () => {
    vi.useFakeTimers();
    const fake = fakeWatch();
    const onChange = vi.fn();
    const watcher = createProjectWatcher({ dir: project, onChange, debounceMs: 100, watch: fake.watch });
    fake.emit("components/main.json");
    fake.emit("project.json");
    await vi.advanceTimersByTimeAsync(60);
    fake.emit("components/main.json");
    await vi.advanceTimersByTimeAsync(60);
    expect(onChange).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(50);
    await watcher.flush();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(["components/main.json", "project.json"]);
    watcher.close();
    expect(fake.closed).toBe(true);
  });

  it("ignores VCS, OS litter, temp files, and per-user session state", async () => {
    const fake = fakeWatch();
    const onChange = vi.fn();
    const watcher = createProjectWatcher({ dir: project, onChange, debounceMs: 5, watch: fake.watch });
    for (const name of [".git/index", ".DS_Store", "components/.main.json.sonobe-tmp-abc123", ".sonobe/session.json", ".sonobe"]) fake.emit(name);
    await watcher.flush();
    expect(onChange).not.toHaveBeenCalled();
    watcher.close();
  });

  it("filters own writes by content but reports later external edits", async () => {
    const fake = fakeWatch();
    const ownWrites = new OwnWriteRegistry();
    const onChange = vi.fn();
    const watcher = createProjectWatcher({ dir: project, onChange, debounceMs: 5, ownWrites, watch: fake.watch });

    await writeProject(project, { files: { "components/main.json": '{"v":1}\n' }, deleted: ["project.json"] }, { ownWrites });
    fake.emit("components/main.json");
    fake.emit("project.json", "rename");
    await watcher.flush();
    expect(onChange).not.toHaveBeenCalled();

    await writeFile(path.join(project, "components", "main.json"), '{"v":2}\n');
    fake.emit("components/main.json");
    await watcher.flush();
    expect(onChange).toHaveBeenCalledWith(["components/main.json"]);
    watcher.close();
  });

  it("reports '.' when the platform omits the filename, and surfaces errors", async () => {
    const fake = fakeWatch();
    const onChange = vi.fn();
    const onError = vi.fn();
    const watcher = createProjectWatcher({ dir: project, onChange, onError, debounceMs: 5, watch: fake.watch });
    fake.emit(null);
    await watcher.flush();
    expect(onChange).toHaveBeenCalledWith(["."]);
    fake.fail(new Error("EPERM"));
    expect(onError).toHaveBeenCalled();
    watcher.close();
  });

  it("stops reporting after close", async () => {
    const fake = fakeWatch();
    const onChange = vi.fn();
    const watcher = createProjectWatcher({ dir: project, onChange, debounceMs: 5, watch: fake.watch });
    fake.emit("project.json");
    watcher.close();
    fake.emit("project.json");
    await watcher.flush();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("createProjectWatcher (real fs.watch)", () => {
  it("notices an external edit and skips our own write", async () => {
    const ownWrites = new OwnWriteRegistry();
    const changes: string[][] = [];
    const watcher = createProjectWatcher({ dir: project, ownWrites, debounceMs: 80, onChange: (paths) => changes.push(paths) });
    await new Promise((r) => setTimeout(r, 150));

    await writeProject(project, { files: { "components/main.json": "{}\n" } }, { ownWrites });
    await new Promise((r) => setTimeout(r, 400));
    await watcher.flush();
    expect(changes.flat()).not.toContain("components/main.json");

    await writeFile(path.join(project, "components", "card.json"), '{"external":true}\n');
    await vi.waitFor(() => expect(changes.flat()).toContain("components/card.json"), { timeout: 4000, interval: 50 });
    watcher.close();
  });
});
