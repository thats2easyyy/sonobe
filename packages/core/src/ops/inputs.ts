/** setInput, connect, disconnect, rename. */

import { parseAddress } from "../address.ts";
import { VARIABLE_BROADCASTER_TYPE } from "../graph.ts";
import { getOwn } from "../ids.ts";
import { findLayer } from "../registry.ts";
import { didYouMean, didYouMeanText } from "../suggest.ts";
import { checkInputValue, checkLink, resolveSource, resolveTarget, type PortTarget } from "../validate.ts";
import { isLinkInput } from "../values.ts";
import {
  commitComponent,
  fail,
  getTargetComponent,
  resolveAddress,
  resolveId,
  resolveInputRefs,
  unwrap,
  type OpContext,
  type OpOf,
  type OpOutcome,
} from "./context.ts";
import { updatePatch } from "./patches.ts";
import { readInput, writeInput, type InputTarget } from "./references.ts";
import { mapLayer } from "./tree.ts";

function toInputTarget(t: PortTarget): InputTarget {
  return t.kind === "componentOutput" ? { kind: "componentOutput", key: t.key } : { kind: t.kind, id: t.itemId!, key: t.key };
}

function markAffected(ctx: OpContext, t: PortTarget): void {
  if (t.kind === "patch") ctx.affected.patches.add(t.itemId!);
  if (t.kind === "layer") ctx.affected.layers.add(t.itemId!);
}

export function setInput(ctx: OpContext, op: OpOf<"setInput">): OpOutcome {
  const component = getTargetComponent(ctx, op.component);
  const clearing = op.value === null || op.value === undefined;
  const validate = clearing ? { ...ctx.validate, lenient: true } : ctx.validate;
  const target = unwrap(resolveTarget(ctx.doc, component, resolveAddress(ctx, op.target), validate));
  const inputTarget = toInputTarget(target);
  const old = readInput(component, inputTarget);
  let value = null;
  if (op.value === null || op.value === undefined) {
    commitComponent(ctx, writeInput(component, inputTarget, undefined));
  } else {
    value = unwrap(checkInputValue(ctx.doc, component, target, resolveInputRefs(ctx, op.value), ctx.validate));
    commitComponent(ctx, writeInput(component, inputTarget, value));
  }
  markAffected(ctx, target);
  return {
    ids: target.itemId ? [target.itemId] : [],
    applied: { op: "setInput", component: component.id, target: target.address, value },
    inverse: [{ op: "setInput", component: component.id, target: target.address, value: old ?? null }],
  };
}

export function connect(ctx: OpContext, op: OpOf<"connect">): OpOutcome {
  const component = getTargetComponent(ctx, op.component);
  const from = resolveAddress(ctx, op.from);
  const to = resolveAddress(ctx, op.to);
  const targetCheck = resolveTarget(ctx.doc, component, to, ctx.validate);
  if (!targetCheck.ok) {
    // A knob as "to" gets the knob's own message: knobs are read, and tuned with setKnobValue.
    const swapped = parseAddress(to)?.kind !== "knob" && resolveSource(ctx.doc, component, to, ctx.validate).ok && resolveTarget(ctx.doc, component, from, ctx.validate).ok;
    if (swapped) {
      fail("wrong_direction", `"${to}" is an output and "${from}" is an input, so this connection points the wrong way.`, {
        address: to,
        hint: "Connections go from an output (from) into an input (to).",
        suggestions: [{ description: "Swap from and to", ops: [{ op: "connect", component: component.id, from: to, to: from }] }],
      });
    }
    unwrap(targetCheck);
  }
  const target = unwrap(targetCheck);
  const link = unwrap(checkLink(ctx.doc, component, from, target, ctx.validate));
  const inputTarget = toInputTarget(target);
  const old = readInput(component, inputTarget);
  commitComponent(ctx, writeInput(component, inputTarget, link));
  markAffected(ctx, target);
  return {
    ids: target.itemId ? [target.itemId] : [],
    applied: { op: "connect", component: component.id, from: link.link, to: target.address },
    inverse: [{ op: "setInput", component: component.id, target: target.address, value: old ?? null }],
  };
}

export function disconnect(ctx: OpContext, op: OpOf<"disconnect">): OpOutcome {
  const component = getTargetComponent(ctx, op.component);
  const target = unwrap(resolveTarget(ctx.doc, component, resolveAddress(ctx, op.to), ctx.validate));
  const inputTarget = toInputTarget(target);
  const old = readInput(component, inputTarget);
  if (!isLinkInput(old)) {
    fail("not_connected", old === undefined ? `${target.address} isn't connected to anything.` : `${target.address} holds a set value, not a connection.`, {
      address: target.address,
      hint: old === undefined ? "Nothing to disconnect." : "To reset it to its default, use setInput with value null.",
    });
  }
  commitComponent(ctx, writeInput(component, inputTarget, undefined));
  markAffected(ctx, target);
  return {
    ids: target.itemId ? [target.itemId] : [],
    applied: { op: "disconnect", component: component.id, to: target.address },
    inverse: [{ op: "setInput", component: component.id, target: target.address, value: old }],
  };
}

export function rename(ctx: OpContext, op: OpOf<"rename">): OpOutcome {
  const component = getTargetComponent(ctx, op.component);
  const id = resolveId(ctx, op.id);
  if (typeof op.name !== "string") fail("invalid_value", "A name must be text.");
  const loc = findLayer(component.layers, id);
  if (loc) {
    if (!op.name.trim()) fail("invalid_value", "Layer names can't be empty.");
    commitComponent(ctx, { ...component, layers: mapLayer(component.layers, id, (l) => ({ ...l, name: op.name })) });
    ctx.affected.layers.add(id);
    return { ids: [id], applied: { op: "rename", component: component.id, id, name: op.name }, inverse: [{ op: "rename", component: component.id, id, name: loc.layer.name }] };
  }
  const node = getOwn(component.patches, id);
  if (node?.type === VARIABLE_BROADCASTER_TYPE) {
    // A broadcaster's name is its variable's name (Origami names the value by its title): one field,
    // and the receivers that read the variable follow the rename in the same batch.
    const name = op.name.trim();
    const change: OpOf<"updatePatch"> = { op: "updatePatch", component: component.id, id, settings: { name: name || null } };
    if (node.name !== undefined) change.name = "";
    return updatePatch(ctx, change);
  }
  if (node) {
    const next = { ...node };
    if (op.name === "") delete next.name;
    else next.name = op.name;
    commitComponent(ctx, { ...component, patches: { ...component.patches, [id]: next } });
    ctx.affected.patches.add(id);
    return { ids: [id], applied: { op: "rename", component: component.id, id, name: op.name }, inverse: [{ op: "rename", component: component.id, id, name: node.name ?? "" }] };
  }
  if (component.comments.some((c) => c.id === id)) {
    fail("invalid_op", `"${id}" is a comment; comments have text, not names.`, {
      suggestions: [{ description: "Change the comment's text", ops: [{ op: "updateComment", component: component.id, id, text: op.name }] }],
    });
  }
  const target = getOwn(ctx.doc.components, id);
  if (target && op.component === undefined) {
    if (!op.name.trim()) fail("invalid_value", "Component names can't be empty.");
    commitComponent(ctx, { ...target, name: op.name });
    return { ids: [id], applied: { op: "updateComponent", id, name: op.name }, inverse: [{ op: "updateComponent", id, name: target.name }] };
  }
  const ids = [...Object.keys(component.patches), ...(findLayer(component.layers, id) ? [] : collectLayerIds(component))];
  return fail("not_found", `There's nothing named "${id}" in ${component.id}.${didYouMeanText(didYouMean(id, ids))}`);
}

function collectLayerIds(component: { layers: { id: string; children?: unknown }[] }): string[] {
  const out: string[] = [];
  const visit = (layers: { id: string; children?: unknown }[]) => {
    for (const l of layers) {
      out.push(l.id);
      if (Array.isArray(l.children)) visit(l.children as { id: string; children?: unknown }[]);
    }
  };
  visit(component.layers);
  return out;
}
