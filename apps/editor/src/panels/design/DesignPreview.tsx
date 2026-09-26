/**
 * The live preview over the artboard: the page Claude is writing, drawn in a sandboxed iframe where
 * the screen will land, with a pill saying who is doing what. The pill stays in view: in the
 * artboard's label row over a frame at its top, else above the frame, else just inside its top edge.
 * The page comes from the in-app Assistant or from an MCP client such as Claude Code. The screen is
 * built in front of the person (DesignBuild): from the moment the box sends a request for a new
 * screen, rain falls and the laser sweeps over where it will land; loader boxes trace in as Claude
 * writes the page's elements; and once the page is complete and every box is in, the laser sweeps up
 * one last time and reveals it. An added page stays until that reveal is done, then fades onto the
 * real layers: it is that import's reveal, so the import hologram doesn't build the screen again
 * (designStore's previewedImport).
 */

import type { Author } from "@sonobe/core";
import { useEffect, useMemo, useRef, useState, type JSX, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useLatest } from "../../ui/lib/hooks.ts";
import type { Rect } from "../canvas/geometry.ts";
import { rectToScreen, type Viewport } from "../canvas/viewport.ts";
import { addPageBoxes, createBuild, readPageBoxes, type BuildState, type PageBox } from "./buildPlan.ts";
import { DesignBuild } from "./DesignBuild.tsx";
import type { DesignTarget } from "./context.ts";
import { activeDraft, assistantDraft, designStore, draftComponent, draftRequest, mcpDraftIdleAt, useDesign, type DesignData, type DesignDraft, type DesignRequest } from "./designStore.ts";
import { PREVIEW_BOXES_TYPE, PREVIEW_MESSAGE_TYPE, previewShellHtml, renderablePrefix } from "./previewShell.ts";
import "./design.css";
import "./design-layout.css";

/** Posts into the frame go out at most this often while Claude writes; the last one goes at done. */
export const PREVIEW_POST_MS = 120;
/** How long activeDraft keeps a finished draft, so the preview can fade out onto the layers. */
const FADE_WINDOW_MS = 400;
/** The artboard's label sits this far above it (CanvasPanel); a pill above a frame at the artboard's top rises above the label (design.css). */
const LABEL_CLEARANCE = 22;
/** The pill's height, and its gap from the frame's edge (design.css). */
const PILL_HEIGHT = 24;
const PILL_GAP = 8;
/** After the whole page is posted, the build waits this long for the page's last measure (previewShell's is at 450 ms). */
const SETTLE_MS = 520;

const requestIds = new WeakMap<object, number>();
let nextRequestId = 1;
/** A request's id for its build: its context is the same object while it runs. */
function requestId(request: Pick<DesignRequest, "context">): number {
  let id = requestIds.get(request.context);
  if (id === undefined) requestIds.set(request.context, (id = nextRequestId++));
  return id;
}

const isLive = (draft: DesignDraft) => draft.status === "writing" || draft.status === "adding";

export interface PreviewFrameOptions {
  componentId: string;
  rootId: string;
  artboard: [number, number];
  bounds(id: string): Rect | null;
  /** The layer to draw over while the draft doesn't say (the box's target, before the fields arrive). */
  fallbackReplace: string | null;
  /** The box's request: a draft of its run lands in the request's component when the fields don't name one. */
  request?: Pick<DesignRequest, "runId" | "context"> | null;
}

/** Where a draft draws, in artboard points: over the layer it replaces, else at its position at its size; null when it's for another component. */
export function previewFrame(draft: DesignDraft, o: PreviewFrameOptions): Rect | null {
  const { fields } = draft;
  if (draftComponent(draft, o.request, o.rootId) !== o.componentId) return null;
  const replace = fields.replace ?? o.fallbackReplace;
  const replaced = replace ? o.bounds(replace) : null;
  if (replaced) return { x: replaced.x, y: replaced.y, width: fields.width ?? replaced.width, height: fields.height ?? replaced.height };
  const [x, y] = fields.position ?? [0, 0];
  return { x, y, width: fields.width ?? o.artboard[0], height: fields.height ?? o.artboard[1] };
}

function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** What the pill says: "Claude is writing “Checkout”" for the Assistant, "Claude Code is writing “Checkout”" for an MCP client (its label, else its author), then "Adding the layers…". */
export function previewPillText(draft: DesignDraft): string {
  if (draft.status === "adding" || draft.status === "added") return "Adding the layers…";
  const writer = draft.mcp && !assistantDraft(draft) ? draft.mcp.client?.label.trim() || draft.mcp.author.name : "Claude";
  return draft.fields.name ? `${writer} is writing “${draft.fields.name}”` : `${writer} is writing the screen`;
}

/** Who writes an MCP draft, or does other work, as a key: its client's id, else its author. */
export function writerKey(author: Author, client?: { id: string } | null): string {
  return client ? `client:${client.id}` : `author:${author.kind}:${author.name}`;
}

/** The writer of the MCP client's draft the canvas shows on `componentId` while it's written or added, else null. Its pill says what that writer is doing there. */
export function liveDraftWriter(state: DesignData, now: number, componentId: string, rootId: string): string | null {
  const draft = state.drafts.length ? activeDraft(state, now) : null;
  if (!draft?.mcp || assistantDraft(draft) || !isLive(draft) || (draft.fields.component ?? rootId) !== componentId) return null;
  return writerKey(draft.mcp.author, draft.mcp.client);
}

export interface DesignPreviewProps {
  viewport: Viewport;
  bounds(id: string): Rect | null;
  componentId: string;
  rootId: string;
  artboard: [number, number];
  /** The layer the box is redesigning. Default: the target of the box's request, when the draft is from its run. */
  box?: DesignTarget | null;
  /** How far the canvas's top is covered (its ruler): the pill stays below it. Default 0. */
  insetTop?: number;
  /** A place in the artboard's label row: the pill of a frame at the artboard's top goes there while the label is in view. */
  labelSlot?: HTMLElement | null;
}

export function DesignPreview({ viewport, bounds, componentId, rootId, artboard, box, insetTop = 0, labelSlot = null }: DesignPreviewProps): JSX.Element | null {
  const drafts = useDesign((s) => s.drafts);
  const request = useDesign((s) => s.request);
  // Re-render once a finished draft's fade window ends, or an MCP client's draft goes idle.
  const [, setTick] = useState(0);
  /** The build that has revealed its page, and when (epoch ms). */
  const [built, setBuilt] = useState<{ key: string; at: number } | null>(null);
  const held = useRef<DesignDraft | null>(null);
  const build = useRef<{ key: string; state: BuildState; completeAt: number | null } | null>(null);
  const frameEl = useRef<HTMLIFrameElement | null>(null);
  const now = Date.now();
  const buildKey = (d: DesignDraft): string => {
    const r = draftRequest(d, request);
    return r ? `request:${requestId(r)}` : `draft:${d.key}`;
  };

  let draft = drafts.length ? activeDraft(designStore.getState(), now) : null;
  if (draft) held.current = isLive(draft) || draft.status === "added" ? draft : null;
  else if (held.current) {
    // An added page stays until its build has revealed it and faded.
    const h = held.current;
    const revealedAt = built?.key === buildKey(h) ? built.at : null;
    if ((h.status === "added" || h.status === "adding") && (revealedAt === null || now - revealedAt < FADE_WINDOW_MS)) draft = h;
    else held.current = null;
  }
  // Before Claude writes anything, a request for a new screen builds where it will land.
  const pending = !draft && request && request.outcome === undefined && !request.context.target && request.context.component.id === componentId && !drafts.some((d) => draftRequest(d, request)) ? request : null;
  const key = draft ? buildKey(draft) : pending ? `request:${requestId(pending)}` : null;
  if (key && build.current?.key !== key) build.current = { key, state: createBuild(), completeAt: null };
  const complete = !!draft && draft.status !== "writing" && !draft.resync;
  if (build.current && complete && build.current.completeAt === null) build.current.completeAt = performance.now();
  const revealed = key !== null && built?.key === key;
  const leaving = draft !== null && ((!isLive(draft) && draft.status !== "added") || (draft.status === "added" && revealed));

  useEffect(() => {
    if (!draft) return;
    const until = leaving ? Math.max(draft.since, built?.at ?? 0) + FADE_WINDOW_MS : isLive(draft) ? mcpDraftIdleAt(draft) : null;
    if (until === null) return;
    const timer = setTimeout(() => setTick((n) => n + 1), Math.max(0, until - Date.now()) + 1);
    return () => clearTimeout(timer);
  }, [draft, leaving, built]);

  if (!draft && !pending) return null;
  const fromRequest = draft ? draftRequest(draft, request) : pending;
  // The box's target is the Assistant's to draw over; an MCP client's draft names what it replaces.
  const target = draft && !assistantDraft(draft) ? null : box !== undefined ? (box?.id ?? null) : (fromRequest?.context.target?.id ?? null);
  // Claude writes the small fields before the html, so once html streams, a missing replace means a new screen.
  const frame = draft ? previewFrame(draft, { componentId, rootId, artboard, bounds, fallbackReplace: draft.html ? null : target, request }) : { x: 0, y: 0, width: artboard[0], height: artboard[1] };
  if (!frame) return null;
  const screen = rectToScreen(viewport, frame);
  const x = Math.round(screen.x);
  const y = Math.round(screen.y);
  const atTop = Math.abs(y - Math.round(viewport.y)) < LABEL_CLEARANCE;
  const text = draft ? previewPillText(draft) : "Claude is designing the screen";
  const status = draft?.status ?? "writing";
  const labelInView = Math.round(viewport.y) - LABEL_CLEARANCE >= insetTop;
  const roomAbove = y - (atTop ? LABEL_CLEARANCE : 0) - PILL_GAP - PILL_HEIGHT >= insetTop;
  const place = atTop && labelSlot && labelInView ? "label" : roomAbove ? "above" : "inside";
  // Inside, it keeps below the ruler while the frame's top is scrolled under it.
  const insideTop = Math.min(Math.max(0, insetTop - y), Math.max(0, screen.height - PILL_HEIGHT - PILL_GAP * 2)) + PILL_GAP;
  const building = !revealed && !leaving && build.current !== null;
  const onBoxes = (boxes: PageBox[]) => {
    if (build.current) addPageBoxes(build.current.state, boxes, performance.now());
  };
  const doneKey = key;
  const onDone = () => setBuilt({ key: doneKey ?? "", at: Date.now() });

  return (
    <div className="sb-design-preview" data-state={leaving ? "leaving" : "live"} data-building={building || undefined} style={{ transform: `translate(${x}px, ${y}px)`, width: screen.width, height: screen.height }}>
      {draft && <PreviewFrame key={draft.key} html={draft.html} complete={draft.status !== "writing"} hold={draft.resync && draft.status === "writing"} width={frame.width} height={frame.height} zoom={viewport.zoom} covered={!revealed} frameEl={frameEl} onBoxes={onBoxes} />}
      {building && build.current && (
        <DesignBuild
          key={build.current.key}
          width={screen.width}
          height={screen.height}
          pageWidth={frame.width}
          pageHeight={frame.height}
          build={build.current.state}
          completeAt={build.current.completeAt === null ? null : build.current.completeAt + SETTLE_MS}
          frame={frameEl}
          onDone={onDone}
        />
      )}
      {place !== "label" ? (
        <div className="sb-design-preview__pill" data-design-pill="" data-status={status} data-place={place} data-lift={(place === "above" && atTop) || undefined} style={place === "inside" ? { top: insideTop } : undefined}>
          <span className="sb-design-preview__dot" aria-hidden />
          {text}
        </div>
      ) : labelSlot && !leaving ? (
        createPortal(
          <span className="sb-cv__label-agent" data-design-pill="" data-status={status} data-place="label">
            <span className="sb-cv__label-agent-dot" aria-hidden />
            {text}
          </span>,
          labelSlot,
        )
      ) : null}
    </div>
  );
}

interface PostState {
  loaded: boolean;
  /** When the last post went out (epoch ms). */
  at: number;
  sent: string | null;
  timer: ReturnType<typeof setTimeout> | undefined;
}

const freshPostState = (): PostState => ({ loaded: false, at: -Infinity, sent: null, timer: undefined });

/**
 * The sandboxed frame. It posts the renderable part of the html once the shell has loaded, then at most
 * every PREVIEW_POST_MS, and the whole page when it's complete; `hold` pauses posts (a draft waiting to
 * resync). A second load means the frame navigated away from the shell: it's reset with a new nonce.
 * It passes on the boxes the page posts back (from this frame, with its nonce). While `covered`, it
 * starts clipped away: the build uncovers it (DesignBuild sets its clip-path).
 */
interface PreviewFrameProps {
  html: string;
  complete: boolean;
  hold: boolean;
  width: number;
  height: number;
  zoom: number;
  covered?: boolean;
  frameEl?: RefObject<HTMLIFrameElement | null>;
  onBoxes?(boxes: PageBox[]): void;
}

function PreviewFrame({ html, complete, hold, width, height, zoom, covered = false, frameEl, onBoxes }: PreviewFrameProps) {
  const [nonce, setNonce] = useState(newNonce);
  const srcDoc = useMemo(() => previewShellHtml(nonce), [nonce]);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const post = useRef<PostState>(freshPostState());
  const latest = useLatest({ html, nonce, onBoxes });

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data: unknown = event.data;
      const frame = frameRef.current;
      if (!frame || event.source !== frame.contentWindow || !data || typeof data !== "object") return;
      const message = data as { type?: unknown; nonce?: unknown; boxes?: unknown };
      if (message.type !== PREVIEW_BOXES_TYPE || message.nonce !== latest.current.nonce) return;
      const boxes = readPageBoxes(message.boxes);
      if (boxes) latest.current.onBoxes?.(boxes);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [latest]);

  const send = () => {
    const state = post.current;
    if (state.timer !== undefined) clearTimeout(state.timer);
    state.timer = undefined;
    const target = frameRef.current?.contentWindow;
    if (!state.loaded || !target) return;
    const page = renderablePrefix(latest.current.html);
    if (page === state.sent) return;
    state.at = Date.now();
    state.sent = page;
    target.postMessage({ type: PREVIEW_MESSAGE_TYPE, nonce: latest.current.nonce, html: page }, "*");
  };

  useEffect(() => {
    const state = post.current;
    if (!state.loaded || hold) return;
    const wait = complete ? 0 : state.at + PREVIEW_POST_MS - Date.now();
    if (wait <= 0) send();
    else state.timer ??= setTimeout(send, wait);
  });

  useEffect(
    () => () => {
      if (post.current.timer !== undefined) clearTimeout(post.current.timer);
    },
    [],
  );

  const onLoad = () => {
    const state = post.current;
    if (!state.loaded) {
      state.loaded = true;
      if (!hold) send();
      return;
    }
    console.warn("The design preview loaded another page, so Sonobe reset it to the preview shell.");
    if (state.timer !== undefined) clearTimeout(state.timer);
    post.current = freshPostState();
    setNonce(newNonce());
  };

  return (
    <iframe
      key={nonce}
      ref={(el) => {
        frameRef.current = el;
        if (frameEl) frameEl.current = el;
      }}
      className="sb-design-preview__frame"
      title="Design preview"
      sandbox="allow-scripts"
      allow=""
      referrerPolicy="no-referrer"
      scrolling="no"
      aria-hidden
      tabIndex={-1}
      srcDoc={srcDoc}
      onLoad={onLoad}
      // Only its first value applies: the build changes the clip-path from there.
      style={{ width, height, transform: `scale(${zoom})`, transformOrigin: "0 0", pointerEvents: "none", ...(covered ? { clipPath: "inset(100% 0 0 0)" } : {}) }}
    />
  );
}
