/**
 * Capture → Sonobe: `planImport` turns a DesignCapture into one undoable batch of ops (new image
 * assets, the screen as a layer tree, and Scroll patches for content that scrolls) plus the asset
 * files to store first. Pure and browser-safe: images arrive already downloaded (see resolve.ts).
 *
 * Mapping:
 * - frame → Group, or Rectangle when it has no children. Uniform borders become a stroke; borders on
 *   some sides become thin rectangles. Gradients and background images become child layers.
 * - text → Text. Single lines hug their text (anchored at their alignment edge); paragraphs keep
 *   their width.
 * - image → Image with a content-addressed asset.
 * - A web font the text uses → a font asset naming its face, which the renderer registers.
 * - input → Text Field.
 * - A frame marked as scrolling gets a Scroll patch driving its content's position, so a long page or
 *   a carousel scrolls in the viewer right away.
 *
 * Re-importing over an earlier screen (`replace`) swaps the screen in one step but keeps the ids of
 * layers found again at the same name path, their linked properties, and every connection other items
 * have to them, so interactions wired onto the old screen keep working. The notes name each connection
 * it had to drop.
 */

import { componentItemIds, findLayer, isLayerInput, isLinkInput, LAYER_TYPE_MAP, listInputs, parseAddress, slugify, targetAddress, uniqueId, type AssetRecord, type Id, type InputValue, type LayerNode, type NewLayer, type NewPatch, type Op, type SonobeDocument } from "@sonobe/core";
import type { Box, CaptureFrame, CaptureGradient, CaptureImage, CaptureInput, CaptureNode, CaptureShadow, CaptureText, CaptureTextStyle, DesignCapture } from "./capture.ts";
import { hexAlpha } from "./css.ts";
import { sha256Hex } from "./sha256.ts";

export interface ResolvedImage {
  bytes: Uint8Array;
  mime: string;
  width?: number;
  height?: number;
}

export interface ImportOptions {
  /** Component the screen goes into. Default: the document's root prototype. */
  component?: Id;
  /** Parent layer (default: the component root). */
  parent?: Id | null;
  /** Insert position among siblings (default: front). */
  index?: number;
  /** Screen name. Default: the capture root's name. */
  name?: string;
  /** Screen position in its parent. Default [0, 0]. */
  position?: [number, number];
  /** Make scrolling frames scroll in the prototype (Scroll patches). Default true. */
  scrolling?: boolean;
  /** Most layers the import creates. Default 5000. */
  maxLayers?: number;
  /** Temp ref of the screen layer in the batch. Default "screen". */
  ref?: string;
  /**
   * An earlier screen to replace (a layer id). The new screen takes its place, position and name, and
   * layers found again keep their ids, links and connections.
   */
  replace?: Id;
  /** With `replace`: ids retired in the component this session (ARCHITECTURE §3.2), which new layers must not take. */
  isRetired?: (id: Id) => boolean;
}

/** The import can't be planned (the layer to replace doesn't exist). */
export class ImportPlanError extends Error {
  readonly code: string;
  readonly hint: string | undefined;

  constructor(code: string, message: string, hint?: string) {
    super(message);
    this.name = "ImportPlanError";
    this.code = code;
    this.hint = hint;
  }
}

export interface ImportFile {
  /** File name under assets/ ("<sha256>.<ext>"). */
  file: string;
  bytes: Uint8Array;
  mime: string;
}

export interface ImportSummary {
  layers: number;
  /** Web fonts added as assets. */
  fonts: number;
  texts: number;
  images: number;
  fields: number;
  scrolls: number;
  newAssets: number;
  /** With `replace`: layers that kept their ids, and connections to layers that are gone. */
  kept?: number;
  lostConnections?: number;
  /** With replace: layers of the old one that weren't found again (all of them, children included). */
  dropped?: number;
}

export interface ImportPlan {
  /** addAsset ops, then the screen's addLayer, then Scroll patches and their connections. */
  ops: Op[];
  /** Bytes of new assets. Store them before applying the ops. */
  files: ImportFile[];
  /** Ref of the screen layer: `plan.idMap[screenRef]` after applying names its id. */
  screenRef: string;
  screenName: string;
  summary: ImportSummary;
  notes: string[];
  /** With replace: the top-most old layers not found again (a dropped group's children aren't listed). Empty otherwise. */
  dropped: { id: Id; name: string }[];
}

const round = (n: number) => Math.round(n * 100) / 100 || 0;

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
};

/** Sniff an image type from its first bytes (servers often send octet-stream). */
export function sniffImageMime(bytes: Uint8Array, declared = ""): string {
  const b = bytes;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 && b[8] === 0x61 && b[9] === 0x76 && b[10] === 0x69) return "image/avif";
  if (b[0] === 0x42 && b[1] === 0x4d) return "image/bmp";
  const head = new TextDecoder().decode(b.subarray(0, Math.min(b.length, 512))).trimStart().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "image/svg+xml";
  const clean = declared.split(";")[0]!.trim().toLowerCase();
  return clean.startsWith("image/") ? clean : "application/octet-stream";
}

const isImageMime = (mime: string) => mime in EXTENSIONS;

const FONT_EXTENSIONS: Record<string, string> = { "font/woff2": "woff2", "font/woff": "woff", "font/ttf": "ttf", "font/otf": "otf" };

/** A font file's type from its signature; null when it isn't WOFF2, WOFF, TrueType or OpenType. */
export function sniffFontMime(bytes: Uint8Array): string | null {
  const tag = String.fromCharCode(...bytes.subarray(0, 4));
  if (tag === "wOF2") return "font/woff2";
  if (tag === "wOFF") return "font/woff";
  if (tag === "OTTO") return "font/otf";
  if (tag === "true" || (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0)) return "font/ttf";
  return null;
}

interface Scroller {
  /** Ref of the layer the Scroll patch moves. */
  contentRef: string;
  name: string;
  x: boolean;
  y: boolean;
}

interface BuildContext {
  options: ImportOptions;
  assetValues: Map<string, InputValue>;
  refCounter: number;
  layers: number;
  truncated: boolean;
  scrollers: Scroller[];
  summary: ImportSummary;
  insetShadows: number;
  missingImages: number;
}

/** Plan an import of `capture` into `doc`. `images` holds downloaded bytes by capture image key (null: couldn't download). */
export async function planImport(capture: DesignCapture, doc: SonobeDocument, images: ReadonlyMap<string, ResolvedImage | null>, options: ImportOptions = {}): Promise<ImportPlan> {
  const notes: string[] = [...(capture.notes ?? [])];
  const summary: ImportSummary = { layers: 0, fonts: 0, texts: 0, images: 0, fields: 0, scrolls: 0, newAssets: 0 };
  const ops: Op[] = [];
  const files: ImportFile[] = [];
  const assetValues = new Map<string, InputValue>();

  // Assets: one per distinct image, reusing identical files already in the document.
  const takenAssetIds = new Set(Object.keys(doc.assets));
  const bySha = new Map(Object.values(doc.assets).filter((a) => a.sha256).map((a) => [a.sha256!, a.id] as const));
  const usedKeys = new Set<string>();
  const visit = (node: CaptureNode) => {
    if (node.kind === "image") usedKeys.add(node.image);
    if (node.kind === "frame") {
      if (node.backgroundImage) usedKeys.add(node.backgroundImage.image);
      node.children.forEach(visit);
    }
  };
  visit(capture.root);
  for (const key of usedKeys) {
    const source = capture.images[key];
    const resolved = images.get(key);
    if (!resolved) {
      if (source && /^https?:/i.test(source.url)) assetValues.set(key, source.url);
      continue;
    }
    const mime = sniffImageMime(resolved.bytes, resolved.mime);
    if (!isImageMime(mime)) continue;
    const sha256 = await sha256Hex(resolved.bytes);
    const existing = bySha.get(sha256);
    if (existing) {
      assetValues.set(key, { asset: existing });
      continue;
    }
    const file = `${sha256}.${EXTENSIONS[mime]}`;
    const name = (source?.name ?? "image").slice(0, 60) || "image";
    const id = uniqueId(slugify(name, "image"), takenAssetIds);
    takenAssetIds.add(id);
    bySha.set(sha256, id);
    const record: AssetRecord = { id, kind: "image", name, file, mime, sha256 };
    const width = resolved.width ?? source?.width;
    const height = resolved.height ?? source?.height;
    if (width && height) {
      record.width = Math.round(width);
      record.height = Math.round(height);
    }
    ops.push({ op: "addAsset", asset: record });
    files.push({ file, bytes: resolved.bytes, mime });
    assetValues.set(key, { asset: id });
    summary.newAssets++;
  }

  // Fonts: one asset per face the text uses, named after its family.
  const missingFonts = new Set<string>();
  for (const [i, font] of (capture.fonts ?? []).entries()) {
    const resolved = images.get(`font:${i}`);
    const mime = resolved ? sniffFontMime(resolved.bytes) : null;
    if (!resolved || !mime) {
      missingFonts.add(font.family);
      continue;
    }
    const sha256 = await sha256Hex(resolved.bytes);
    if (bySha.has(sha256)) continue;
    const id = uniqueId(slugify(`${font.family} ${font.style === "italic" ? "italic " : ""}${font.weight ?? ""}`, "font"), takenAssetIds);
    takenAssetIds.add(id);
    bySha.set(sha256, id);
    const face: NonNullable<AssetRecord["font"]> = { family: font.family };
    if (font.weight) face.weight = font.weight;
    if (font.style) face.style = font.style;
    if (font.unicodeRange) face.unicodeRange = font.unicodeRange;
    const file = `${sha256}.${FONT_EXTENSIONS[mime]}`;
    ops.push({ op: "addAsset", asset: { id, kind: "font", name: font.family, file, mime, sha256, font: face } });
    files.push({ file, bytes: resolved.bytes, mime });
    summary.newAssets++;
    summary.fonts++;
  }
  if (missingFonts.size) notes.push(`The font${missingFonts.size === 1 ? "" : "s"} ${[...missingFonts].map((f) => `“${f}”`).join(", ")} couldn't be downloaded, so text in ${missingFonts.size === 1 ? "it" : "them"} uses a font installed on this computer.`);

  const ctx: BuildContext = { options, assetValues, refCounter: 0, layers: 0, truncated: false, scrollers: [], summary, insetShadows: 0, missingImages: 0 };
  const screenRef = options.ref ?? "screen";
  const root = capture.root;
  const component = options.component ?? doc.project.root;
  const target = doc.components[component];
  const replaced = options.replace !== undefined ? locateReplaced(doc, component, options.replace) : null;
  const screenName = options.name?.trim() || replaced?.layer.name || root.name?.trim() || capture.source.title?.trim() || "Imported Screen";
  const screen = frameLayer(ctx, { ...root, name: screenName, nameRank: 5, keep: true }, root.box, true) ?? { type: "group", props: {} };
  screen.ref = screenRef;
  const oldPosition = replaced?.layer.props.position;
  screen.props = { ...screen.props, position: options.position ? [round(options.position[0]), round(options.position[1])] : Array.isArray(oldPosition) || isLinkInput(oldPosition) ? oldPosition : [0, 0] };
  const addScreen: Op = { op: "addLayer", component, layer: screen };
  const parent = options.parent !== undefined ? options.parent : replaced?.parent;
  if (parent !== undefined && parent !== null) (addScreen as { parent?: Id | null }).parent = parent;
  const index = options.index ?? replaced?.index;
  if (index !== undefined) (addScreen as { index?: number }).index = index;

  const skipScroll = new Set<string>();
  const restores: Op[] = [];
  if (replaced && target) {
    const kept = keepIds(replaced.layer, screen, skipScroll);
    const oldIds = new Set<Id>();
    const collect = (l: LayerNode) => {
      oldIds.add(l.id);
      l.children?.forEach(collect);
    };
    collect(replaced.layer);
    const newIds = new Set<Id>();
    const visitNew = (l: NewLayer) => {
      if (l.id) newIds.add(l.id);
      l.children?.forEach(visitNew);
    };
    visitNew(screen);
    // A new layer derives its id while the tree is built, so it could take a kept id before the layer
    // keeping it is reached. Name every new layer up front instead, against the ids in use. That includes
    // the old screen's ids nothing kept: a layer not found again doesn't take one without its connections.
    const taken = componentItemIds(target);
    // Where each connection the new screen can't keep was stored ("@card_1_address.text", "tap_like.layer").
    const lost: string[] = [];
    const claim = (l: NewLayer) => {
      if (!l.id) {
        l.id = uniqueId(slugify(l.name ?? l.type, slugify(l.type)), (id) => taken.has(id) || !!options.isRetired?.(id));
        taken.add(l.id);
      } else if (newIds.has(l.id) && l.props) {
        // Links carried over from the old screen can point at layers the new one doesn't have.
        for (const [key, value] of Object.entries(l.props)) {
          const referenced = referencedLayer(value);
          if (referenced !== undefined && oldIds.has(referenced) && !newIds.has(referenced)) {
            delete l.props[key];
            lost.push(`@${l.id}.${key}`);
          }
        }
      }
      l.children?.forEach(claim);
    };
    claim(screen);
    for (const entry of listInputs(target)) {
      if (entry.target.kind === "layer" && oldIds.has(entry.target.id)) {
        // keepIds carried this one over when its layer was found again; otherwise it goes with the layer.
        if (!newIds.has(entry.target.id) && (isLinkInput(entry.value) || isLayerInput(entry.value))) lost.push(targetAddress(entry.target));
        continue;
      }
      const referenced = referencedLayer(entry.value);
      if (referenced === undefined || !oldIds.has(referenced)) continue;
      if (newIds.has(referenced)) restores.push({ op: "setInput", component, target: targetAddress(entry.target), value: entry.value });
      else lost.push(targetAddress(entry.target));
    }
    ops.push({ op: "removeLayer", component, id: replaced.layer.id });
    summary.kept = kept;
    summary.lostConnections = lost.length;
    if (lost.length) {
      const one = lost.length === 1;
      const listed = `${lost.slice(0, 5).join(", ")}${lost.length > 5 ? ` and ${lost.length - 5} more` : ""}`;
      notes.push(`${lost.length} connection${one ? "" : "s"} to layers the new screen doesn't have ${one ? "was" : "were"} removed: ${listed}. Wire ${one ? "it" : "them"} to the new screen's layers again if ${one ? "it's" : "they're"} still needed.`);
    }
  }
  ops.push(addScreen);

  if (options.scrolling !== false && ctx.scrollers.some((s) => !skipScroll.has(s.contentRef))) {
    const existing = Object.values(doc.components[component]?.patches ?? {});
    const baseY = existing.length ? Math.max(...existing.map((p) => p.ui.y)) + 160 : 40;
    const baseX = existing.length ? Math.min(...existing.map((p) => p.ui.x)) : 40;
    ctx.scrollers.filter((s) => !skipScroll.has(s.contentRef)).slice(0, 16).forEach((s, i) => {
      const ref = `${screenRef}_scroll_${i + 1}`;
      const patch: NewPatch = {
        ref,
        type: "scroll",
        name: `Scroll ${s.name}`,
        inputs: { layer: { layer: `$${s.contentRef}` }, scrollX: s.x ? "free" : "off", scrollY: s.y ? "free" : "off" },
        ui: { x: baseX, y: baseY + i * 200 },
      };
      ops.push({ op: "addPatch", component, patch });
      ops.push({ op: "connect", component, from: `$${ref}.position`, to: `@$${s.contentRef}.position` });
      summary.scrolls++;
    });
  }

  ops.push(...restores);

  if (ctx.truncated) notes.push(`Only the first ${options.maxLayers ?? 5000} layers were imported.`);
  if (ctx.insetShadows) notes.push(`${ctx.insetShadows} inner shadow${ctx.insetShadows === 1 ? " was" : "s were"} left out (Sonobe draws outer shadows).`);
  if (ctx.missingImages) notes.push(`${ctx.missingImages} image${ctx.missingImages === 1 ? "" : "s"} couldn't be downloaded; ${ctx.missingImages === 1 ? "it's" : "they're"} gray placeholders.`);
  summary.layers = ctx.layers;
  return { ops, files, screenRef, screenName, summary, notes, dropped: [] };
}

// ---------------------------------------------------------------------------
// Replacing an earlier screen
// ---------------------------------------------------------------------------

function locateReplaced(doc: SonobeDocument, componentId: Id, id: Id): { layer: LayerNode; parent: Id | null; index: number } {
  const component = doc.components[componentId];
  const loc = component ? findLayer(component.layers, id) : undefined;
  if (!component || !loc) throw new ImportPlanError("not_found", `There's no layer "${id}" to replace${component ? ` in ${componentId}` : ""}.`, "Pass the id of the screen an earlier import created; get_outline shows it.");
  const parent = loc.path.length > 1 ? loc.path[loc.path.length - 2]! : null;
  const siblings = parent === null ? component.layers : (findLayer(component.layers, parent)?.layer.children ?? []);
  return { layer: loc.layer, parent, index: siblings.findIndex((l) => l.id === id) };
}

/** The layer a value points at or links from. */
function referencedLayer(value: InputValue): Id | undefined {
  if (isLayerInput(value)) return value.layer;
  if (!isLinkInput(value)) return undefined;
  const a = parseAddress(value.link);
  return a?.kind === "layer" ? a.id : undefined;
}

const hasProp = (type: string, key: string) => LAYER_TYPE_MAP.get(type)?.props.some((p) => p.key === key) ?? false;

/**
 * Give new layers the ids of old layers at the same name path ("Profile Card/Follow Button", the second
 * of two same-named siblings counting separately), and carry their linked properties across. A layer
 * not found by name is looked up among its old siblings by the name an earlier import gave it
 * (formerName). Content layers whose position a Scroll patch already drives don't get another one.
 * Returns how many kept ids.
 */
function keepIds(oldRoot: LayerNode, newRoot: NewLayer, skipScroll: Set<string>): number {
  let kept = 0;
  const match = (old: LayerNode, next: NewLayer) => {
    next.id = old.id;
    kept++;
    for (const [key, value] of Object.entries(old.props)) {
      if ((isLinkInput(value) || isLayerInput(value)) && hasProp(next.type, key)) {
        next.props = { ...next.props, [key]: value };
        if (key === "position" && next.ref) skipScroll.add(next.ref);
      }
    }
    const keyed = (children: readonly { name?: string }[]) => {
      const counts = new Map<string, number>();
      return children.map((c) => {
        const name = c.name ?? "";
        const n = counts.get(name) ?? 0;
        counts.set(name, n + 1);
        return `${name}#${n}`;
      });
    };
    const oldChildren = old.children ?? [];
    const oldKeys = new Map(keyed(oldChildren).map((k, i) => [k, oldChildren[i]!] as const));
    const newChildren = next.children ?? [];
    const used = new Set<LayerNode>();
    const unmatched: NewLayer[] = [];
    keyed(newChildren).forEach((k, i) => {
      const previous = oldKeys.get(k);
      if (previous) {
        used.add(previous);
        match(previous, newChildren[i]!);
      } else unmatched.push(newChildren[i]!);
    });
    // Layers earlier imports named differently are found by the names they had then.
    for (const child of unmatched) {
      const former = formerName(child, next.name ?? "");
      if (former === undefined) continue;
      const previous = oldChildren.find((o) => !used.has(o) && o.type === child.type && o.name === former);
      if (previous) {
        used.add(previous);
        match(previous, child);
      }
    }
  };
  match(oldRoot, newRoot);
  return kept;
}

/**
 * The name an earlier import gave a layer of `parent`, where the walker names it differently now. Text
 * was named after its words, not the element holding it ("Card 1 Address" was "933 Kapahulu Ave,
 * Honolulu"). An image in a frame that stays took the frame's name ("Avatar Image" and a checked box's
 * "Checkmark" were "Avatar" and "Agree Checkbox"). A text field's box was "<field> Input" or "<field> Box"
 * ("Email Input Group" was "Email Input Input").
 */
function formerName(child: NewLayer, parent: string): string | undefined {
  const text = child.type === "text" ? child.props?.text : undefined;
  if (typeof text === "string") return wordsName(text);
  const name = child.name ?? "";
  if (parent && (name === `${parent} Image` || name === "Checkmark" || name === "Dot")) return parent;
  const box = / (Input|Box) Group$/.exec(name);
  return box ? `${name.slice(0, -" Group".length)} ${box[1]}` : undefined;
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

function nextRef(ctx: BuildContext, prefix: string): string {
  ctx.refCounter++;
  return `${ctx.options.ref ?? "screen"}_${prefix}_${ctx.refCounter}`;
}

function countLayer(ctx: BuildContext): boolean {
  if (ctx.layers >= (ctx.options.maxLayers ?? 5000)) {
    ctx.truncated = true;
    return false;
  }
  ctx.layers++;
  return true;
}

function layerName(node: CaptureNode, fallback: string): string {
  const name = node.name?.replace(/\s+/g, " ").trim();
  return name ? name.slice(0, 80) : fallback;
}

/** Position and size relative to the parent's box, plus opacity, transform, blend and blur. */
function commonProps(node: CaptureNode, parent: Box): Record<string, InputValue> {
  const props: Record<string, InputValue> = {
    position: [round(node.box[0] - parent[0]), round(node.box[1] - parent[1])],
    size: [round(Math.max(0, node.box[2])), round(Math.max(0, node.box[3]))],
  };
  if (node.opacity !== undefined && node.opacity < 1) props.opacity = round(node.opacity);
  if (node.rotation) props.rotation = round(node.rotation);
  if (node.scale !== undefined && node.scale !== 1) props.scale = Math.round(node.scale * 10000) / 10000;
  if (node.blendMode) props.blendMode = node.blendMode;
  if (node.blur) props.blur = round(node.blur);
  return props;
}

function radiiProps(radii: [number, number, number, number] | undefined): Record<string, InputValue> {
  if (!radii || radii.every((r) => r <= 0)) return {};
  if (radii.every((r) => Math.abs(r - radii[0]) < 0.01)) return { cornerRadius: round(radii[0]) };
  return { cornerRadii: radii.map(round) };
}

/** The shadow Sonobe draws: the largest outer shadow. A zero-blur ring (spread only) becomes an outside stroke. */
function shadowProps(ctx: BuildContext, shadows: CaptureShadow[] | undefined, hasBorder: boolean): Record<string, InputValue> {
  if (!shadows?.length) return {};
  const props: Record<string, InputValue> = {};
  const outer = shadows.filter((s) => !s.inset);
  ctx.insetShadows += shadows.length - outer.length;
  const ring = outer.find((s) => s.blur === 0 && s.x === 0 && s.y === 0 && s.spread > 0);
  if (ring && !hasBorder) {
    props.strokeColor = ring.color;
    props.strokeWidth = round(ring.spread);
    props.strokePosition = "outside";
  }
  const visible = outer.filter((s) => s !== ring && hexAlpha(s.color) > 0);
  if (visible.length) {
    const main = visible.reduce((a, b) => (b.blur + Math.abs(b.y) > a.blur + Math.abs(a.y) ? b : a));
    props.shadowColor = `${main.color.slice(0, 7)}FF`;
    props.shadowOpacity = round(hexAlpha(main.color));
    props.shadowRadius = round(Math.max(0, main.blur + Math.min(0, main.spread)));
    props.shadowOffset = [round(main.x), round(main.y)];
  }
  return props;
}

function gradientLiteral(g: CaptureGradient): InputValue {
  const gradient: { kind: CaptureGradient["kind"]; stops: [number, string][]; start: [number, number]; end: [number, number]; ratio?: number } = { kind: g.kind, stops: g.stops, start: g.start, end: g.end };
  if (g.ratio !== undefined) gradient.ratio = g.ratio;
  return { gradient };
}

const hasAlpha = (g: CaptureGradient) => g.stops.some(([, c]) => hexAlpha(c) < 1);

function uniformBorder(frame: CaptureFrame): { width: number; color: string } | null {
  const b = frame.border;
  if (!b) return null;
  const [w] = b.widths;
  if (b.widths.every((x) => Math.abs(x - w) < 0.01) && b.colors.every((c) => c === b.colors[0])) return { width: w, color: b.colors[0] };
  return null;
}

function frameLayer(ctx: BuildContext, frame: CaptureFrame, parentBox: Box, isScreen = false): NewLayer | null {
  if (!countLayer(ctx)) return null;
  const [, , w, h] = frame.box;
  const props = commonProps(frame, parentBox);
  const border = uniformBorder(frame);
  const gradients = frame.gradients ?? [];
  const radii = radiiProps(frame.radii);
  const shadow = shadowProps(ctx, frame.shadows, !!frame.border);
  const name = layerName(frame, "Group");

  // Paint that needs its own layers inside the group.
  const paint: NewLayer[] = [];
  const onlyGradient = gradients.length === 1 && !frame.backgroundImage && !(frame.fill && hasAlpha(gradients[0]!)) && (!frame.border || border);
  const isLeaf = frame.children.length === 0 && !frame.scroll && !frame.scrollContent && !isScreen;

  if (isLeaf && (onlyGradient || (!gradients.length && !frame.backgroundImage && (!frame.border || border)))) {
    const rect: NewLayer = { type: "rectangle", name, props: { ...props, ...radii, ...shadow } };
    if (onlyGradient) rect.props!.gradient = gradientLiteral(gradients[0]!);
    else rect.props!.color = frame.fill ?? "#00000000";
    if (border && border.width > 0) {
      rect.props!.strokeWidth = round(border.width);
      rect.props!.strokeColor = border.color;
    }
    if (frame.backgroundBlur) rect.props!.backgroundBlur = round(frame.backgroundBlur);
    if (!frame.fill && !onlyGradient && !border && !shadow.shadowOpacity && !shadow.strokeWidth && !frame.backgroundBlur) {
      // Nothing to see: an empty tap target.
      return { type: "hitArea", name, props: { position: props.position!, size: props.size!, showInEditor: false } };
    }
    return rect;
  }

  const fullBox: [number, number] = [round(w), round(h)];
  for (const g of gradients) {
    if (!countLayer(ctx)) break;
    paint.push({ type: "rectangle", name: g.kind === "linear" ? "Gradient" : `${g.kind === "radial" ? "Radial" : "Angular"} Gradient`, props: { position: [0, 0], size: fullBox, gradient: gradientLiteral(g), ...radii } });
  }
  if (frame.backgroundImage && countLayer(ctx)) {
    const value = ctx.assetValues.get(frame.backgroundImage.image);
    if (value !== undefined) {
      paint.push({ type: "image", name: "Background Image", props: { position: [0, 0], size: fullBox, image: value, fillMode: fitMode(frame.backgroundImage.fit), ...radii } });
      ctx.summary.images++;
    } else ctx.layers--;
  }
  if (frame.border && !border) {
    const [t, r, b, l] = frame.border.widths;
    const [ct, cr, cb, cl] = frame.border.colors;
    const side = (sideName: string, box: [number, number, number, number], color: string) => {
      if (box[2] <= 0 || box[3] <= 0 || hexAlpha(color) === 0 || !countLayer(ctx)) return;
      paint.push({ type: "rectangle", name: `Border ${sideName}`, props: { position: [round(box[0]), round(box[1])], size: [round(box[2]), round(box[3])], color } });
    };
    side("Top", [0, 0, w, t], ct);
    side("Right", [w - r, 0, r, h], cr);
    side("Bottom", [0, h - b, w, b], cb);
    side("Left", [0, 0, l, h], cl);
  }

  const group: NewLayer = { type: "group", name, props: { ...props, ...radii, ...shadow } };
  if (frame.fill) group.props!.color = frame.fill;
  if (border && border.width > 0) {
    group.props!.strokeWidth = round(border.width);
    group.props!.strokeColor = border.color;
  }
  if (frame.clip) group.props!.clip = true;
  if (frame.backgroundBlur) group.props!.backgroundBlur = round(frame.backgroundBlur);

  let children: NewLayer[] = [];
  for (const child of frame.children) {
    const layer = nodeLayer(ctx, child, frame.box);
    if (layer) children.push(layer);
    if (ctx.truncated) break;
  }

  if (ctx.options.scrolling !== false) {
    if (frame.scrollContent && h > parentBox[3] + 1) {
      // The page's content: taller than the screen that clips it, so it moves itself.
      group.ref = nextRef(ctx, "content");
      ctx.scrollers.push({ contentRef: group.ref, name, x: false, y: true });
    } else if (frame.scroll && (frame.scroll.x || frame.scroll.y)) {
      // A scroll container: its children move together inside it.
      const bounds = childBounds(frame);
      const overflowsY = frame.scroll.y && bounds.height > h + 1;
      const overflowsX = frame.scroll.x && bounds.width > w + 1;
      if ((overflowsX || overflowsY) && countLayer(ctx)) {
        const contentRef = nextRef(ctx, "content");
        group.props!.clip = true;
        children = [{ ref: contentRef, type: "group", name: `${name} Content`, props: { position: [0, 0], size: [round(Math.max(w, bounds.width)), round(Math.max(h, bounds.height))] }, children }];
        ctx.scrollers.push({ contentRef, name, x: overflowsX, y: overflowsY });
      }
    }
  }

  const all = [...paint, ...children];
  if (all.length) group.children = all;
  return group;
}

/** Extent of a frame's children measured from the frame's top-left. */
function childBounds(frame: CaptureFrame): { width: number; height: number } {
  let width = 0;
  let height = 0;
  for (const c of frame.children) {
    width = Math.max(width, c.box[0] + c.box[2] - frame.box[0]);
    height = Math.max(height, c.box[1] + c.box[3] - frame.box[1]);
  }
  return { width, height };
}

function fitMode(fit: CaptureImage["fit"]): string {
  return fit === "cover" ? "fill" : fit === "contain" ? "fit" : fit === "tile" ? "tile" : "stretch";
}

function nodeLayer(ctx: BuildContext, node: CaptureNode, parentBox: Box): NewLayer | null {
  switch (node.kind) {
    case "frame":
      return frameLayer(ctx, node, parentBox);
    case "text":
      return textLayer(ctx, node, parentBox);
    case "image":
      return imageLayer(ctx, node, parentBox);
    case "input":
      return inputLayer(ctx, node, parentBox);
  }
}

function textStyleProps(style: CaptureTextStyle, colorKey: "textColor"): Record<string, InputValue> {
  const props: Record<string, InputValue> = {
    fontFamily: style.fontFamily,
    fontSize: round(style.fontSize),
    fontWeight: Math.max(100, Math.min(900, Math.round(style.fontWeight / 100) * 100 || 400)),
    [colorKey]: style.color,
  };
  if (style.italic) props.italic = true;
  if (style.align && style.align !== "left") props.textAlignment = style.align;
  if (style.letterSpacing) props.letterSpacing = round(style.letterSpacing);
  if (style.lineHeight) props.lineHeight = round(style.lineHeight);
  if (style.decoration) props.textDecoration = style.decoration;
  if (style.transform) props.textTransform = style.transform;
  return props;
}

function textLayer(ctx: BuildContext, node: CaptureText, parentBox: Box): NewLayer | null {
  if (!countLayer(ctx)) return null;
  ctx.summary.texts++;
  const props: Record<string, InputValue> = { ...commonProps(node, parentBox), text: node.text, ...textStyleProps(node.style, "textColor") };
  const [x, y] = props.position as [number, number];
  const [w, h] = props.size as [number, number];
  const fixed = node.wraps || (node.maxLines ?? 0) > 0;
  if (fixed) {
    // A point of slack so a paragraph wraps where it did, even when glyphs measure a hair wider.
    props.widthMode = "fixed";
    props.size = [round(w + 1), h];
    if (node.style.align === "center") props.position = [round(x - 0.5), y];
    else if (node.style.align === "right") props.position = [round(x - 1), y];
    if (node.maxLines) props.maxLines = node.maxLines;
  } else {
    props.widthMode = "auto";
    // Hug the text, and grow from the edge it's aligned to, so centered labels stay centered.
    if (node.style.align === "center") {
      props.anchor = [0.5, 0];
      props.position = [round(x + w / 2), y];
    } else if (node.style.align === "right") {
      props.anchor = [1, 0];
      props.position = [round(x + w), y];
    }
  }
  return { type: "text", name: layerName(node, wordsName(node.text)), props };
}

/** A text layer's name from its words, as the walker names text that nothing else names. */
function wordsName(text: string): string {
  const words = text.replace(/\s+/g, " ").trim();
  return words.length > 40 ? `${words.slice(0, 39).trimEnd()}…` : words || "Text";
}

function imageLayer(ctx: BuildContext, node: CaptureImage, parentBox: Box): NewLayer | null {
  if (!countLayer(ctx)) return null;
  const value = ctx.assetValues.get(node.image);
  const props = { ...commonProps(node, parentBox), ...radiiProps(node.radii) };
  if (value === undefined) {
    ctx.missingImages++;
    return { type: "rectangle", name: layerName(node, "Image"), props: { ...props, color: "#E5E7EBFF" } };
  }
  ctx.summary.images++;
  return { type: "image", name: layerName(node, "Image"), props: { ...props, image: value, fillMode: fitMode(node.fit) } };
}

function inputLayer(ctx: BuildContext, node: CaptureInput, parentBox: Box): NewLayer | null {
  if (!countLayer(ctx)) return null;
  ctx.summary.fields++;
  const props: Record<string, InputValue> = { ...commonProps(node, parentBox), text: node.value, placeholder: node.placeholder ?? "", ...textStyleProps(node.style, "textColor") };
  if (node.placeholderColor) props.placeholderColor = node.placeholderColor;
  if (node.multiline) props.multiline = true;
  if (node.secure) props.secure = true;
  if (node.keyboard && node.keyboard !== "default") props.keyboardType = node.keyboard;
  return { type: "textField", name: layerName(node, "Text Field"), props };
}
