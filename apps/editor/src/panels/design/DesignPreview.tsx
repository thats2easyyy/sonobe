/**
 * The live preview over the artboard: the page Claude is writing, drawn in a sandboxed iframe where
 * the screen will land, with a pill saying who is doing what. The pill stays in view: in the
 * artboard's label row over a frame at its top, else above the frame, else just inside its top edge.
 * The page comes from the in-app Assistant or from an MCP client such as Claude Code. It fades out
 * onto the real layers.
 */

import type { Author } from "@sonobe/core";
import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { createPortal } from "react-dom";
import { useLatest } from "../../ui/lib/hooks.ts";
import type { Rect } from "../canvas/geometry.ts";
import { rectToScreen, type Viewport } from "../canvas/viewport.ts";
import type { DesignTarget } from "./context.ts";
import { activeDraft, designStore, mcpDraftIdleAt, useDesign, type DesignData, type DesignDraft, type DesignRequest } from "./designStore.ts";
import { PREVIEW_MESSAGE_TYPE, previewShellHtml, renderablePrefix } from "./previewShell.ts";
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

/** The box's request, when the draft is the Assistant's and of the request's run (or the run it's starting). */
function draftRequest<R extends Pick<DesignRequest, "runId">>(draft: DesignDraft, request: R | null | undefined): R | null {
  return draft.source === "assistant" && request && (request.runId === null || request.runId === draft.runId) ? request : null;
}

/** Where a draft draws, in artboard points: over the layer it replaces, else at its position at its size; null when it's for another component. */
export function previewFrame(draft: DesignDraft, o: PreviewFrameOptions): Rect | null {
  const { fields } = draft;
  const fromRequest = draftRequest(draft, o.request)?.context.component.id;
  if ((fields.component ?? fromRequest ?? o.rootId) !== o.componentId) return null;
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
  const writer = draft.mcp ? draft.mcp.client?.label.trim() || draft.mcp.author.name : "Claude";
  return draft.fields.name ? `${writer} is writing “${draft.fields.name}”` : `${writer} is writing the screen`;
}

/** Who writes an MCP draft, or does other work, as a key: its client's id, else its author. */
export function writerKey(author: Author, client?: { id: string } | null): string {
  return client ? `client:${client.id}` : `author:${author.kind}:${author.name}`;
}

/** The writer of the MCP draft the canvas shows on `componentId` while it's written or added, else null. Its pill says what that writer is doing there. */
export function liveDraftWriter(state: DesignData, now: number, componentId: string, rootId: string): string | null {
  const draft = state.drafts.length ? activeDraft(state, now) : null;
  if (!draft?.mcp || !isLive(draft) || (draft.fields.component ?? rootId) !== componentId) return null;
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
  const draft = drafts.length ? activeDraft(designStore.getState(), Date.now()) : null;
  const leaving = draft !== null && !isLive(draft);

  useEffect(() => {
    if (!draft) return;
    const until = !isLive(draft) ? draft.since + FADE_WINDOW_MS : mcpDraftIdleAt(draft);
    if (until === null) return;
    const timer = setTimeout(() => setTick((n) => n + 1), Math.max(0, until - Date.now()) + 1);
    return () => clearTimeout(timer);
  }, [draft]);

  if (!draft) return null;
  const fromRequest = draftRequest(draft, request);
  // The box's target is the Assistant's to draw over; an MCP client's draft names what it replaces.
  const target = draft.source !== "assistant" ? null : box !== undefined ? (box?.id ?? null) : (fromRequest?.context.target?.id ?? null);
  // Claude writes the small fields before the html, so once html streams, a missing replace means a new screen.
  const frame = previewFrame(draft, { componentId, rootId, artboard, bounds, fallbackReplace: draft.html ? null : target, request });
  if (!frame) return null;
  const screen = rectToScreen(viewport, frame);
  const x = Math.round(screen.x);
  const y = Math.round(screen.y);
  const atTop = Math.abs(y - Math.round(viewport.y)) < LABEL_CLEARANCE;
  const text = previewPillText(draft);
  const labelInView = Math.round(viewport.y) - LABEL_CLEARANCE >= insetTop;
  const roomAbove = y - (atTop ? LABEL_CLEARANCE : 0) - PILL_GAP - PILL_HEIGHT >= insetTop;
  const place = atTop && labelSlot && labelInView ? "label" : roomAbove ? "above" : "inside";
  // Inside, it keeps below the ruler while the frame's top is scrolled under it.
  const insideTop = Math.min(Math.max(0, insetTop - y), Math.max(0, screen.height - PILL_HEIGHT - PILL_GAP * 2)) + PILL_GAP;

  return (
    <div className="sb-design-preview" data-state={leaving ? "leaving" : "live"} style={{ transform: `translate(${x}px, ${y}px)`, width: screen.width, height: screen.height }}>
      <PreviewFrame key={draft.key} html={draft.html} complete={draft.status !== "writing"} hold={draft.resync && draft.status === "writing"} width={frame.width} height={frame.height} zoom={viewport.zoom} />
      {place !== "label" ? (
        <div className="sb-design-preview__pill" data-design-pill="" data-status={draft.status} data-place={place} data-lift={(place === "above" && atTop) || undefined} style={place === "inside" ? { top: insideTop } : undefined}>
          <span className="sb-design-preview__dot" aria-hidden />
          {text}
        </div>
      ) : labelSlot && !leaving ? (
        createPortal(
          <span className="sb-cv__label-agent" data-design-pill="" data-status={draft.status} data-place="label">
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
 */
function PreviewFrame({ html, complete, hold, width, height, zoom }: { html: string; complete: boolean; hold: boolean; width: number; height: number; zoom: number }) {
  const [nonce, setNonce] = useState(newNonce);
  const srcDoc = useMemo(() => previewShellHtml(nonce), [nonce]);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const post = useRef<PostState>(freshPostState());
  const latest = useLatest({ html, nonce });

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
      ref={frameRef}
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
      style={{ width, height, transform: `scale(${zoom})`, transformOrigin: "0 0", pointerEvents: "none" }}
    />
  );
}
