/** Per-viewer Learn drawer conveniences: the last view and which guides were opened. Storage failures are ignored. */

import { readJSON, writeJSON } from "../../ui/lib/storage.ts";

export type LearnView = { kind: "home" } | { kind: "guide"; slug: string; anchor?: string | null } | { kind: "patches"; type?: string | null } | { kind: "lessons" } | { kind: "lesson"; id: string };

export const LEARN_VIEW_KEY = "sonobe.learn.view.v1";
export const LEARN_READ_KEY = "sonobe.learn.read.v1";

export function isLearnView(value: unknown): value is LearnView {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.kind === "home") return true;
  if (v.kind === "guide") return typeof v.slug === "string" && (v.anchor === undefined || v.anchor === null || typeof v.anchor === "string");
  if (v.kind === "patches") return v.type === undefined || v.type === null || typeof v.type === "string";
  if (v.kind === "lessons") return true;
  if (v.kind === "lesson") return typeof v.id === "string";
  return false;
}

export function readLearnView(): LearnView | undefined {
  return readJSON(LEARN_VIEW_KEY, isLearnView);
}

export function writeLearnView(view: LearnView): void {
  writeJSON(LEARN_VIEW_KEY, view);
}

const isStringList = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === "string");

export function readOpenedGuides(): Set<string> {
  return new Set(readJSON(LEARN_READ_KEY, isStringList) ?? []);
}

export function writeOpenedGuides(slugs: Iterable<string>): void {
  writeJSON(LEARN_READ_KEY, [...slugs].slice(-100));
}
