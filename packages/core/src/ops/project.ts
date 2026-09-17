/** setScript, addAsset, removeAsset, setProject. */

import { DEVICE_PRESETS } from "../devices.ts";
import { listComponentIds } from "../document.ts";
import { fileNameCollision, getOwn } from "../ids.ts";
import { AssetRecordSchema, zodIssues, formatIssues } from "../schema.ts";
import { isValidScriptFile } from "../serialize.ts";
import { didYouMean, didYouMeanText } from "../suggest.ts";
import type { AssetRecord, Op, ProjectManifest } from "../types.ts";
import { isAssetInput, normalizeColor } from "../values.ts";
import { CLEAR, fail, resolveId, withComponent, type OpContext, type OpOf, type OpOutcome } from "./context.ts";
import { removeInputs, restoreInputOps } from "./references.ts";

export function setScript(ctx: OpContext, op: OpOf<"setScript">): OpOutcome {
  if (typeof op.file !== "string" || !isValidScriptFile(op.file)) {
    fail("invalid_value", `"${String(op.file)}" isn't a valid script file name.`, { hint: 'Script files live directly in scripts/, like "js_1.js".' });
  }
  const old = getOwn(ctx.doc.scripts, op.file);
  if (old === undefined && op.source !== null && op.source !== undefined && !ctx.lenient) {
    const clash = fileNameCollision(Object.keys(ctx.doc.scripts), op.file);
    if (clash !== undefined) {
      fail("file_name_taken", `"${op.file}" would share a file with the script "${clash}": on macOS and Windows, scripts/${op.file} and scripts/${clash} are the same file.`, {
        hint: `Write to "${clash}" instead, or pick a name that differs by more than capitalization.`,
      });
    }
  }
  const scripts = { ...ctx.doc.scripts };
  if (op.source === null || op.source === undefined) delete scripts[op.file];
  else if (typeof op.source !== "string") fail("invalid_value", "Script source must be text.");
  else scripts[op.file] = op.source;
  ctx.doc = { ...ctx.doc, scripts };
  return {
    ids: [],
    applied: { op: "setScript", file: op.file, source: op.source ?? null },
    inverse: [{ op: "setScript", file: op.file, source: old ?? null }],
  };
}

export function addAsset(ctx: OpContext, op: OpOf<"addAsset">): OpOutcome {
  const r = AssetRecordSchema.safeParse(op.asset);
  if (!r.success) fail("invalid_value", `The asset has problems:\n${formatIssues(zodIssues(r.error))}`, { hint: 'Assets look like { "id": "photo", "kind": "image", "name": "Photo", "file": "3f2a….png" }.' });
  const asset: AssetRecord = r.data;
  if (getOwn(ctx.doc.assets, asset.id)) fail("id_taken",`There's already an asset "${asset.id}".`, { hint: "Remove it first with removeAsset, or pick another id." });
  ctx.doc = { ...ctx.doc, assets: { ...ctx.doc.assets, [asset.id]: asset } };
  return { ids: [asset.id], applied: { op: "addAsset", asset }, inverse: [{ op: "removeAsset", id: asset.id }] };
}

export function removeAsset(ctx: OpContext, op: OpOf<"removeAsset">): OpOutcome {
  const id = resolveId(ctx, op.id);
  const asset = getOwn(ctx.doc.assets, id);
  if (!asset) fail("not_found", `There's no asset "${id}".${didYouMeanText(didYouMean(id, Object.keys(ctx.doc.assets)))}`);
  const assets = { ...ctx.doc.assets };
  delete assets[id];
  let doc = { ...ctx.doc, assets };
  const restores: Op[] = [];
  for (const componentId of listComponentIds(doc)) {
    const { component, removed } = removeInputs(doc.components[componentId]!, (e) => isAssetInput(e.value) && e.value.asset === id);
    if (!removed.length) continue;
    doc = withComponent(doc, component);
    ctx.affected.components.add(componentId);
    for (const e of removed) {
      if (e.target.kind === "patch") ctx.affected.patches.add(e.target.id);
      if (e.target.kind === "layer") ctx.affected.layers.add(e.target.id);
    }
    restores.push(...restoreInputOps(componentId, removed));
  }
  ctx.doc = doc;
  return { ids: [id], applied: { op: "removeAsset", id }, inverse: [{ op: "addAsset", asset }, ...restores] };
}

const PROJECT_KEYS = ["minReaderVersion", "name", "generator", "root", "device", "fps", "background", "meta"] as const;
const REQUIRED = new Set(["name", "root", "device"]);

export function setProject(ctx: OpContext, op: OpOf<"setProject">): OpOutcome {
  const changes = op.changes as Record<string, unknown> | undefined;
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) fail("invalid_op", 'setProject needs "changes", like { "name": "Checkout Flow" }.');
  const project: ProjectManifest = { ...ctx.doc.project };
  const record = project as unknown as Record<string, unknown>;
  const inverse: Record<string, unknown> = {};
  const applied: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) continue;
    if (key === "formatVersion") fail("invalid_op", "formatVersion can't be changed with setProject; it's managed by Sonobe.");
    if (!(PROJECT_KEYS as readonly string[]).includes(key)) fail("invalid_op", `There's no project setting "${key}".${didYouMeanText(didYouMean(key, PROJECT_KEYS))}`);
    inverse[key] = key in record ? record[key] : CLEAR;
    if (value === null) {
      if (REQUIRED.has(key)) fail("invalid_value", `The project's ${key} can't be removed.`);
      delete record[key];
      applied[key] = CLEAR;
      continue;
    }
    switch (key) {
      case "name":
        if (typeof value !== "string" || !value.trim()) fail("invalid_value", "The project name can't be empty.");
        break;
      case "generator":
        if (typeof value !== "string") fail("invalid_value", "generator must be text.");
        break;
      case "minReaderVersion":
        if (typeof value !== "number" || !Number.isInteger(value) || value < 1) fail("invalid_value", "minReaderVersion must be a whole number ≥ 1.");
        break;
      case "root": {
        const root = getOwn(ctx.doc.components, resolveId(ctx, value));
        if (!root) fail("not_found", `There's no component "${String(value)}" to make the root.${didYouMeanText(didYouMean(String(value), Object.keys(ctx.doc.components)))}`);
        if (root.kind !== "prototype" && !ctx.lenient) fail("invalid_value", `"${root.id}" is a ${root.kind}; the root must be a prototype.`);
        record[key] = root.id;
        applied[key] = root.id;
        continue;
      }
      case "device": {
        const d = value as Record<string, unknown>;
        if (!d || typeof d !== "object" || typeof d.preset !== "string") fail("invalid_value", 'device must look like { "preset": "iphone-17-pro" }.');
        const presets = DEVICE_PRESETS.map((p) => p.id);
        if (!presets.includes(d.preset) && !ctx.lenient) fail("invalid_value", `There's no device preset "${d.preset}".${didYouMeanText(didYouMean(d.preset, presets))}`, { hint: `Presets: ${presets.join(", ")}.` });
        const device: ProjectManifest["device"] = { preset: d.preset };
        if (d.size !== undefined) {
          const s = d.size;
          if (!Array.isArray(s) || s.length !== 2 || !s.every((n) => typeof n === "number" && n > 0)) fail("invalid_value", "device.size must be [width, height].");
          device.size = [s[0], s[1]];
        }
        if (d.orientation !== undefined) {
          if (d.orientation !== "portrait" && d.orientation !== "landscape") fail("invalid_value", 'device.orientation must be "portrait" or "landscape".');
          device.orientation = d.orientation;
        }
        record[key] = device;
        applied[key] = device;
        continue;
      }
      case "fps":
        if (value !== 60 && value !== 120) fail("invalid_value", "fps must be 60 or 120.");
        break;
      case "background": {
        const color = typeof value === "string" ? normalizeColor(value) : undefined;
        if (!color) fail("invalid_value", 'background must be a color like "#FFFFFFFF".');
        record[key] = color;
        applied[key] = color;
        continue;
      }
      case "meta":
        if (typeof value !== "object" || Array.isArray(value)) fail("invalid_value", "meta must be an object.");
        break;
    }
    record[key] = value;
    applied[key] = value;
  }
  ctx.doc = { ...ctx.doc, project };
  return {
    ids: [],
    applied: { op: "setProject", changes: applied as OpOf<"setProject">["changes"] },
    inverse: [{ op: "setProject", changes: inverse as OpOf<"setProject">["changes"] }],
  };
}
