/** addComment, updateComment, removeComment. Comments are kept sorted by id. */

import { componentItemIds } from "../registry.ts";
import { didYouMean, didYouMeanText } from "../suggest.ts";
import type { CommentNode, Component, Id } from "../types.ts";
import { commitComponent, defineRef, fail, getTargetComponent, isClear, newItemId, resolveId, type OpContext, type OpOf, type OpOutcome } from "./context.ts";

const byId = (a: CommentNode, b: CommentNode) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function validRect(rect: unknown): rect is [number, number, number, number] {
  return Array.isArray(rect) && rect.length === 4 && rect.every((n) => typeof n === "number" && Number.isFinite(n));
}

function requireComment(component: Component, id: Id): CommentNode {
  const c = component.comments.find((x) => x.id === id);
  if (!c) fail("not_found", `There's no comment "${id}" in ${component.id}.${didYouMeanText(didYouMean(id, component.comments.map((x) => x.id)))}`);
  return c;
}

export function addComment(ctx: OpContext, op: OpOf<"addComment">): OpOutcome {
  const component = getTargetComponent(ctx, op.component);
  const c = op.comment;
  if (!c || typeof c !== "object") fail("invalid_op", 'addComment needs a comment, like { "text": "…", "rect": [x, y, w, h] }.');
  if (typeof c.text !== "string") fail("invalid_value", "A comment's text must be text.");
  if (!validRect(c.rect)) fail("invalid_value", 'A comment needs "rect": [x, y, width, height] in patch editor points.');
  if (c.color !== undefined && typeof c.color !== "string") fail("invalid_value", "A comment's color must be text.");
  const id = newItemId(ctx, component, { explicit: c.id, fallback: "comment", taken: componentItemIds(component) });
  defineRef(ctx, c.ref, id);
  const node: CommentNode = { id, text: c.text, rect: [c.rect[0], c.rect[1], c.rect[2], c.rect[3]] };
  if (c.color) node.color = c.color;
  commitComponent(ctx, { ...component, comments: [...component.comments, node].sort(byId) });
  return { ids: [id], applied: { op: "addComment", component: component.id, comment: node }, inverse: [{ op: "removeComment", component: component.id, id }] };
}

export function updateComment(ctx: OpContext, op: OpOf<"updateComment">): OpOutcome {
  const component = getTargetComponent(ctx, op.component);
  const id = resolveId(ctx, op.id);
  const original = requireComment(component, id);
  const next: CommentNode = { ...original };
  const inverse: OpOf<"updateComment"> = { op: "updateComment", component: component.id, id };
  const applied: OpOf<"updateComment"> = { op: "updateComment", component: component.id, id };
  if (op.text !== undefined) {
    if (typeof op.text !== "string") fail("invalid_value", "A comment's text must be text.");
    inverse.text = original.text;
    next.text = applied.text = op.text;
  }
  if (op.rect !== undefined) {
    if (!validRect(op.rect)) fail("invalid_value", '"rect" must be [x, y, width, height].');
    inverse.rect = original.rect;
    next.rect = applied.rect = [op.rect[0], op.rect[1], op.rect[2], op.rect[3]];
  }
  if (op.color !== undefined) {
    inverse.color = original.color ?? "";
    applied.color = op.color ?? "";
    if (isClear(op.color)) delete next.color;
    else if (typeof op.color !== "string") fail("invalid_value", "A comment's color must be text.");
    else next.color = op.color;
  }
  commitComponent(ctx, { ...component, comments: component.comments.map((x) => (x.id === id ? next : x)) });
  return { ids: [id], applied, inverse: [inverse] };
}

export function removeComment(ctx: OpContext, op: OpOf<"removeComment">): OpOutcome {
  const component = getTargetComponent(ctx, op.component);
  const id = resolveId(ctx, op.id);
  const original = requireComment(component, id);
  commitComponent(ctx, { ...component, comments: component.comments.filter((x) => x.id !== id) });
  return { ids: [id], applied: { op: "removeComment", component: component.id, id }, inverse: [{ op: "addComment", component: component.id, comment: original }] };
}
