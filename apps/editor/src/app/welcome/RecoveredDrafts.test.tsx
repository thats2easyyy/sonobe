// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DraftInfo } from "../../host/types.ts";
import { createManualScheduler } from "../../runtime/scheduler.ts";
import { EditorProvider } from "../../state/EditorProvider.tsx";
import { createEditorSession, type EditorSession } from "../../state/session.ts";
import { draftParts, draftSummary, RecoveredDrafts } from "./RecoveredDrafts.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.now();

function draft(over: Partial<DraftInfo> = {}): DraftInfo {
  return { id: "d1", name: "Untitled", projectPath: null, createdAt: NOW, updatedAt: NOW - 5 * 60_000, revision: 1, counts: { layers: 1 } as DraftInfo["counts"], ...over };
}

describe("draftParts", () => {
  it("splits the summary into the pieces that wrap as units", () => {
    expect(draftParts(draft(), (p) => p, NOW)).toEqual(["Not saved", "5 min ago", "1 layer"]);
    expect(draftParts(draft({ projectPath: "/a/Checkout.sonobe", counts: { layers: 3 } as DraftInfo["counts"] }), () => "Checkout", NOW)).toEqual(["Unsaved changes to Checkout", "5 min ago", "3 layers"]);
  });

  it("joins them with a dot", () => {
    expect(draftSummary(draft(), (p) => p, NOW)).toBe("Not saved · 5 min ago · 1 layer");
  });
});

describe("RecoveredDrafts", () => {
  let container: HTMLDivElement;
  let root: Root;
  let session: EditorSession;

  beforeEach(() => {
    session = createEditorSession({ host: null, scheduler: createManualScheduler(), textMeasurer: "approximate", autoplay: false });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    session.dispose();
    container.remove();
  });

  async function mount(drafts: DraftInfo[]) {
    session.recoverableDrafts = async () => drafts;
    await act(async () => {
      root.render(
        <EditorProvider session={session} commands={false} clipboardEvents={false} rpc={false}>
          <RecoveredDrafts titleId="t" onOpened={() => undefined} />
        </EditorProvider>,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("warns on its own line when a draft may be missing its last changes", async () => {
    await mount([draft({ torn: true })]);
    const warning = container.querySelector(".sb-welcome__draft-warning");
    expect(warning?.textContent).toBe("This draft may be missing its last changes.");
    expect(container.querySelector(".sb-welcome__draft-meta")?.textContent).toBe("Not saved · 5 min ago · 1 layer");
  });

  it("shows no warning for an intact draft", async () => {
    await mount([draft()]);
    expect(container.querySelector(".sb-welcome__draft")).not.toBeNull();
    expect(container.querySelector(".sb-welcome__draft-warning")).toBeNull();
  });
});
