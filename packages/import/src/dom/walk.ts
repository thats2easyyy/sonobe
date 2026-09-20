/**
 * The DOM walker: reads a rendered page, or one element of it, and writes a DesignCapture. It runs
 * inside the page. The desktop app injects the bundled script (walkerSource.ts) into a hidden window,
 * the browser editor into a sandboxed iframe, and a browser extension into a tab. Everything comes
 * from layout and computed styles, so it works with any framework and any CSS (Tailwind, CSS modules,
 * styled components, inline styles).
 *
 * What it writes:
 * - Boxes with paint (backgrounds, gradients, borders, radii, shadows, clipping, blur) become frames.
 *   Wrappers with no paint and one child disappear, so the layer list stays shallow.
 * - Runs of inline text become text layers positioned by their line boxes.
 * - <img>, inline <svg> (as SVG files with their computed colors), CSS background images, <canvas>
 *   and video posters become images. SF Symbols a host drew into their <svg data-sf-symbol>
 *   placeholders (dom/symbols.ts) are images named after the symbol; undrawn ones are gray placeholders.
 * - <input> and <textarea> become text fields.
 * - position: fixed elements move to the screen level, and a page taller than the viewport goes into
 *   a "Content" frame marked as scrolling, so the importer can make it scroll.
 * - Names come from data-name, framework component names (React and Vue dev builds), aria-label,
 *   ids and test ids, icon classes, and semantic tags. Text takes the name a person gave the element
 *   holding it (data-name, aria-label, ids) over its words, but not a component, role or tag name,
 *   which every instance shares. A named inline element (<span data-name>) becomes a text layer of its
 *   own, and <body data-name> names the screen.
 */

import type { Box, CaptureBorder, CaptureFont, CaptureFrame, CaptureImage, CaptureImageSource, CaptureInput, CaptureNode, CaptureText, CaptureTextStyle, DesignCapture, ImageFit } from "../capture.ts";
import { CAPTURE_FORMAT, CAPTURE_VERSION } from "../constants.ts";
import { blendModeKey, clampRadii, collapseWhitespace, coversLatin, parseBackgroundImages, parseBlur, parseBoxShadows, parseFontFaceRules, parseFontFamilies, parsePx, parseRadius, parseRgb, parseTransform, pickFontSource, titleize, toHex, type ColorFn, type FontFaceRule } from "../css.ts";

export const WALKER_GENERATOR = "sonobe-walker/1";

export interface WalkOptions {
  /** Capture just the first element matching this selector (a card, a dialog, a Storybook story root). */
  selector?: string;
  /** Name of the captured screen. Default: the element's name, or the page title. */
  name?: string;
  /** Capture the whole page height, not only the viewport. Default true. */
  fullPage?: boolean;
  /** Stop after this many elements. Default 6000. */
  maxElements?: number;
  /** Tallest page captured, in points. Default 12000. */
  maxHeight?: number;
  /** Wait until an element matches this selector. */
  waitFor?: string;
  /** Extra time to wait after the page settles (animations, data loading). */
  waitMs?: number;
  /** Longest wait for load, fonts, images and a quiet DOM. Default 10000. */
  timeoutMs?: number;
  /** How long the DOM has to stay unchanged to count as settled. Default 300. */
  settleMs?: number;
  /**
   * Which images to embed as data: URLs. "local" (default): data:, blob: and same-origin images;
   * the importer downloads the rest. "all" also tries cross-origin images (they need CORS). "none"
   * embeds only what must be read in the page (blob:, canvas, inline SVG).
   */
  inlineImages?: "local" | "all" | "none";
  /** Recorded as `capture.source`. Default: { kind: "url", url: location.href }. */
  source?: DesignCapture["source"];
}

const SKIP_TAGS = new Set(["script", "style", "link", "meta", "head", "title", "template", "noscript", "base", "source", "track", "param", "datalist", "map", "area"]);

const SEMANTIC_NAMES: Record<string, string> = {
  a: "Link", article: "Article", aside: "Sidebar", blockquote: "Quote", body: "Page", button: "Button", canvas: "Canvas", details: "Disclosure", dialog: "Dialog",
  fieldset: "Fieldset", figure: "Figure", footer: "Footer", form: "Form", h1: "Heading", h2: "Heading", h3: "Heading", h4: "Heading", h5: "Heading", h6: "Heading",
  header: "Header", hr: "Divider", iframe: "Embed", img: "Image", input: "Text Field", label: "Label", li: "List Item", main: "Main", menu: "Menu", nav: "Navigation",
  ol: "List", p: "Paragraph", section: "Section", select: "Picker", summary: "Summary", svg: "Icon", table: "Table", td: "Cell", textarea: "Text Area", th: "Cell",
  tr: "Row", ul: "List", video: "Video",
};

const ROLE_NAMES: Record<string, string> = {
  alert: "Alert", banner: "Header", button: "Button", checkbox: "Checkbox", dialog: "Dialog", img: "Image", link: "Link", listitem: "List Item", menu: "Menu",
  menuitem: "Menu Item", navigation: "Navigation", progressbar: "Progress Bar", radio: "Radio", search: "Search", slider: "Slider", status: "Status", switch: "Switch",
  tab: "Tab", tablist: "Tab Bar", tabpanel: "Tab Panel", toolbar: "Toolbar", tooltip: "Tooltip",
};

const INTERACTIVE_ROLES = new Set(["button", "link", "tab", "switch", "checkbox", "radio", "menuitem", "option", "slider"]);

/** Framework internals that wrap app components without naming anything people designed. */
const IGNORED_COMPONENT = /^(?:Fragment|StrictMode|Suspense|Profiler|Component|Element|Wrapper|Inner|Outer|Root|Portal|Slot|Slottable|Presence|Primitive|Anonymous|Unknown|Transition|TransitionGroup|Link|Image|Head|Script)$|(?:Provider|Boundary|Router|Handler|Context|Consumer|Adapter|Announcer|Overlay|Reloader|Template|Segment|Metadata|Viewport|Outlet|Emotion|Styled|Internal|Impl)$/;

const round2 = (n: number) => Math.round(n * 100) / 100 || 0;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));

/** Wait for load, a selector, fonts, images, and a quiet DOM (bounded by timeoutMs), then waitMs more. */
export async function waitForPage(options: WalkOptions): Promise<void> {
  const deadline = Date.now() + (options.timeoutMs ?? 10_000);
  const left = () => Math.max(0, deadline - Date.now());
  if (document.readyState !== "complete") {
    await Promise.race([new Promise<void>((resolve) => window.addEventListener("load", () => resolve(), { once: true })), delay(left())]);
  }
  if (options.waitFor) {
    while (!document.querySelector(options.waitFor)) {
      if (left() === 0) throw new Error(`Nothing on the page matched "${options.waitFor}" within ${Math.round((options.timeoutMs ?? 10_000) / 1000)} seconds.`);
      await delay(100);
    }
  }
  const settle = options.settleMs ?? 300;
  await new Promise<void>((resolve) => {
    let timer = setTimeout(done, settle);
    const cap = setTimeout(done, left());
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(done, settle);
    });
    function done() {
      observer.disconnect();
      clearTimeout(timer);
      clearTimeout(cap);
      resolve();
    }
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  });
  if (document.fonts?.ready) await Promise.race([document.fonts.ready, delay(left())]);
  // Images below the fold wait for a scroll that never comes: load them now.
  for (const img of document.images) if (img.loading === "lazy") img.loading = "eager";
  const pending = [...document.images].filter((img) => !img.complete);
  if (pending.length) {
    await Promise.race([Promise.all(pending.map((img) => new Promise<void>((resolve) => {
      img.addEventListener("load", () => resolve(), { once: true });
      img.addEventListener("error", () => resolve(), { once: true });
    }))), delay(Math.min(left(), 5000))]);
  }
  // Hosts add waitMs to their deadlines, so it isn't cut to what timeoutMs left.
  if (options.waitMs) await delay(options.waitMs);
  await Promise.race([new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))), delay(100)]);
}

/** Resolve any CSS color the browser understands (oklch, lab, color(), system colors) to "#RRGGBBAA". */
export function createColorResolver(): ColorFn {
  const cache = new Map<string, string | null>();
  let ctx: CanvasRenderingContext2D | null | undefined;
  return (css) => {
    const key = css.trim();
    if (!key || key === "none" || key === "transparent") return null;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    let out = parseRgb(key);
    if (out === null) {
      ctx ??= (() => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        return canvas.getContext("2d", { willReadFrequently: true });
      })();
      if (ctx) {
        // Sample an opaque version for exact channels, and read alpha from the syntax.
        const alphaMatch = /\/\s*([\d.]+%?)\s*\)$/.exec(key);
        const alpha = alphaMatch ? (alphaMatch[1]!.endsWith("%") ? Number(alphaMatch[1]!.slice(0, -1)) / 100 : Number(alphaMatch[1])) : 1;
        const opaque = alphaMatch ? key.replace(/\/\s*[\d.]+%?\s*\)$/, ")") : key;
        ctx.globalCompositeOperation = "copy";
        ctx.fillStyle = "#000000";
        ctx.fillStyle = opaque;
        ctx.fillRect(0, 0, 1, 1);
        const d = ctx.getImageData(0, 0, 1, 1).data;
        out = toHex(d[0]!, d[1]!, d[2]!, (d[3]! / 255) * (Number.isFinite(alpha) ? alpha : 1));
      }
    }
    if (out !== null && out.endsWith("00")) out = null;
    cache.set(key, out);
    return out;
  };
}

/**
 * Where a name came from. "explicit", "aria" and "id" name this element (a person chose them for it);
 * "component", "role" and "semantic" name its kind, which every instance shares.
 */
type NameKind = "explicit" | "component" | "aria" | "icon" | "id" | "role" | "semantic" | "generic";

interface NameInfo {
  name: string;
  rank: number;
  kind: NameKind;
}

/**
 * Whether an element's name beats the words of the text it holds. Names people gave this element do
 * (data-name, aria-label, a test id or id); names of its kind don't (a component type every card
 * shares, a role, a tag), because the words tell instances apart. An icon class names a glyph ("♥").
 */
function namesText(kind: NameKind | undefined, text: string): boolean {
  if (kind === "explicit" || kind === "aria" || kind === "id") return true;
  return kind === "icon" && !/[\p{L}\p{N}]/u.test(text);
}

/** data-sonobe-name, data-name or data-layer. */
function explicitName(el: Element): string | undefined {
  const explicit = el.getAttribute("data-sonobe-name") ?? el.getAttribute("data-name") ?? el.getAttribute("data-layer");
  return explicit?.trim() ? explicit.trim().slice(0, 80) : undefined;
}

/** Nearest framework component whose root element is `el` (React and Vue dev builds keep names). */
function componentName(el: Element): string | undefined {
  const record = el as unknown as Record<string, unknown>;
  let fiber: Record<string, unknown> | undefined;
  for (const key of Object.keys(record)) {
    if (key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")) {
      fiber = record[key] as Record<string, unknown>;
      break;
    }
  }
  if (fiber) {
    let best: string | undefined;
    let child = fiber;
    let parent = fiber.return as Record<string, unknown> | undefined;
    for (let depth = 0; parent && depth < 16; depth++) {
      if (typeof parent.type === "string" || parent.tag === 3) break;
      // Only components that render `el` as their first element name it.
      if (parent.child !== child) break;
      const type = parent.type as Record<string, unknown> | ((...args: unknown[]) => unknown) | undefined;
      let name: unknown;
      if (typeof type === "function") name = (type as { displayName?: unknown }).displayName ?? type.name;
      else if (type && typeof type === "object") {
        const inner = (type.render ?? type.type) as { displayName?: unknown; name?: unknown } | undefined;
        name = type.displayName ?? inner?.displayName ?? inner?.name;
      }
      if (typeof name === "string" && /^[A-Z][A-Za-z0-9]{1,48}$/.test(name) && !IGNORED_COMPONENT.test(name)) best = name;
      child = parent;
      parent = parent.return as Record<string, unknown> | undefined;
    }
    return best;
  }
  const vue = record.__vueParentComponent as { type?: { name?: unknown; __name?: unknown }; subTree?: { el?: unknown } } | undefined;
  if (vue?.subTree?.el === el) {
    const name = vue.type?.name ?? vue.type?.__name;
    if (typeof name === "string" && /^[A-Z][A-Za-z0-9]{1,48}$/.test(name) && !IGNORED_COMPONENT.test(name)) return name;
  }
  return undefined;
}

/** "lucide-arrow-left" → "Arrow Left Icon". */
function iconName(el: Element): string | undefined {
  const dataIcon = el.getAttribute("data-icon") ?? el.getAttribute("icon");
  if (dataIcon) return `${titleize(dataIcon.split(":").pop() ?? dataIcon)} Icon`;
  const cls = typeof el.className === "string" ? el.className : (el.getAttribute("class") ?? "");
  const m = /(?:^|\s)(?:lucide|tabler|ph|bi|ri|fa|fa-solid|heroicon|icon|octicon|feather|mdi)-([a-z0-9-]+)/i.exec(cls);
  if (m && !/^(?:solid|regular|light|thin|duotone|brands|fw|lg|xl|sm|xs|\d+x)$/.test(m[1]!)) return `${titleize(m[1]!)} Icon`;
  return undefined;
}

/** Ids people chose ("checkout-form"), not generated ones (":r3:", "radix-4", "headlessui-menu-7"). */
const readableId = (id: string) => id.length > 1 && id.length <= 40 && !/[:$]|^(?:radix|headlessui|mui|chakra|react-aria|downshift|ember|__)|\d{3,}|^[a-f0-9-]{16,}$/i.test(id);

interface Counters {
  flattenedText: number;
  approximateTransforms: number;
  placeholders: Set<string>;
  missingImages: number;
  unsupportedBackgrounds: number;
  unsupportedControls: number;
  /** Names on inline elements inside a paragraph that became one text layer, so no layer carries them. */
  unplacedNames: Set<string>;
  /** SF Symbol placeholders no host tried to draw (data-sf-placeholder marks the ones a host explained). */
  undrawnSymbols: Set<string>;
}

class Walker {
  readonly options: WalkOptions;
  readonly toColor = createColorResolver();
  readonly images: Record<string, CaptureImageSource> = {};
  readonly imageKeys = new Map<string, string>();
  readonly pending: Promise<void>[] = [];
  readonly fixed: CaptureNode[] = [];
  readonly counters: Counters = { flattenedText: 0, approximateTransforms: 0, placeholders: new Set(), missingImages: 0, unsupportedBackgrounds: 0, unsupportedControls: 0, unplacedNames: new Set(), undrawnSymbols: new Set() };
  readonly paintKeys = new WeakMap<CaptureNode, number>();
  readonly plainInline = new WeakMap<Element, boolean>();
  readonly gradientText = new WeakMap<Element, string>();
  /** Where each frame's name came from, so finish() knows whether it beats the words of a text it wraps. */
  readonly nameKinds = new WeakMap<CaptureNode, NameKind>();
  /** Plain inline elements whose own name beats their words, or null (see namedInline). */
  readonly inlineNames = new WeakMap<Element, NameInfo | null>();
  /** Run keys for inline elements with data-name (see paragraph()). */
  readonly runIds = new WeakMap<Element, number>();
  runCount = 0;
  /** Font families named by captured text, lowercased. */
  readonly families = new Set<string>();
  origin: [number, number] = [0, 0];
  truncatedHeight = 0;
  /** Added to measured boxes inside a transformed element measured without its transform (see visitDrawn). */
  shift: [number, number] = [0, 0];
  /** Ancestors that make position: fixed descendants relative to themselves (transform, filter, contain...). */
  containingBlocks = 0;
  elements = 0;
  nodes = 0;
  truncated = false;
  fixedDepth = 0;
  pageMode = true;

  constructor(options: WalkOptions) {
    this.options = options;
  }

  get maxElements() {
    return this.options.maxElements ?? 6000;
  }

  box(rect: { left: number; top: number; width: number; height: number }): Box {
    return [round2(rect.left - this.origin[0] + this.shift[0]), round2(rect.top - this.origin[1] + this.shift[1]), round2(rect.width), round2(rect.height)];
  }

  // -------------------------------------------------------------------------
  // Page and element entry points
  // -------------------------------------------------------------------------

  async run(): Promise<DesignCapture> {
    const o = this.options;
    const docEl = document.documentElement;
    const body = document.body;
    const vw = docEl.clientWidth || window.innerWidth;
    const vh = window.innerHeight;
    window.scrollTo(0, 0);
    let root: CaptureFrame;
    if (o.selector) {
      this.pageMode = false;
      const el = document.querySelector(o.selector);
      if (!el) throw new Error(`Nothing on the page matches "${o.selector}".`);
      const rect = el.getBoundingClientRect();
      this.origin = [rect.left, rect.top];
      const nodes = this.visitElement(el, true);
      const first = nodes[0];
      if (first?.kind === "frame" && nodes.length === 1) root = first;
      else root = { kind: "frame", box: [0, 0, round2(rect.width), round2(rect.height)], keep: true, children: nodes };
      root.box = [0, 0, round2(rect.width), round2(rect.height)];
      root.keep = true;
      if (o.name) {
        root.name = o.name;
        root.nameRank = 5;
      }
      if (this.fixed.length) root.children.push(...this.fixed);
    } else {
      const maxHeight = o.maxHeight ?? 12_000;
      const fullHeight = Math.max(docEl.scrollHeight, body?.scrollHeight ?? 0, vh);
      const height = o.fullPage === false ? vh : Math.min(fullHeight, maxHeight);
      // The canvas takes the root element's background, or the body's when the root has none (CSS
      // background propagation), so a gradient on <body> fills the whole screen.
      const htmlCs = getComputedStyle(docEl);
      const htmlPaints = !!this.toColor(htmlCs.backgroundColor) || htmlCs.backgroundImage !== "none";
      const canvasCs = htmlPaints || !body ? htmlCs : getComputedStyle(body);
      const pageNodes = body ? this.visitElement(body, false, { stripFill: !htmlPaints }) : [];
      const viewportHeight = o.fullPage === false ? vh : Math.max(vh, 1);
      const scrolls = height > viewportHeight + 1;
      const canvasBox: Box = [0, 0, round2(vw), round2(scrolls ? height : viewportHeight)];
      const canvasPaint: CaptureFrame = { kind: "frame", box: canvasBox, children: [] };
      this.paint(canvasPaint, body ?? docEl, canvasCs);
      let children: CaptureNode[];
      if (scrolls) {
        const content: CaptureFrame = { kind: "frame", name: "Content", nameRank: 5, box: canvasBox, keep: true, scrollContent: true, children: pageNodes };
        // Page backgrounds scroll with the page.
        if (canvasPaint.gradients) content.gradients = canvasPaint.gradients;
        if (canvasPaint.backgroundImage) content.backgroundImage = canvasPaint.backgroundImage;
        children = [content, ...this.fixed];
      } else children = [...pageNodes, ...this.fixed];
      const title = document.title.trim();
      const pageName = (body ? explicitName(body) : undefined) ?? explicitName(docEl);
      root = { kind: "frame", name: o.name ?? pageName ?? (title ? title.slice(0, 60) : "Screen"), nameRank: 5, box: [0, 0, round2(vw), round2(viewportHeight)], fill: canvasPaint.fill ?? "#FFFFFFFF", clip: true, keep: true, children };
      // A <body> that stays a layer (it paints over the page's background) doesn't repeat the screen's name.
      for (const node of pageNodes) {
        if (node.name === root.name && node.source?.tag === "body") {
          node.name = SEMANTIC_NAMES.body;
          node.nameRank = 1;
        }
      }
      if (!scrolls) {
        if (canvasPaint.gradients) root.gradients = canvasPaint.gradients;
        if (canvasPaint.backgroundImage) root.backgroundImage = canvasPaint.backgroundImage;
      }
      if (fullHeight > maxHeight && o.fullPage !== false) this.truncatedHeight = fullHeight;
    }
    const fonts = await Promise.race([this.collectFonts(), delay(10_000).then(() => [] as CaptureFont[])]);
    await Promise.race([Promise.all(this.pending), delay(15_000)]);
    const notes = this.notes();
    return {
      format: CAPTURE_FORMAT,
      version: CAPTURE_VERSION,
      source: o.source ?? { kind: "url", url: location.href, ...(document.title ? { title: document.title } : {}), generator: WALKER_GENERATOR },
      viewport: { width: round2(vw), height: round2(vh) },
      root,
      images: this.images,
      ...(fonts.length ? { fonts } : {}),
      ...(notes.length ? { notes } : {}),
      stats: { elements: this.elements, nodes: this.nodes, ...(this.truncated ? { truncated: true } : {}) },
    };
  }

  /**
   * Web fonts the captured text uses: @font-face rules with a downloadable file, from stylesheets the
   * page can read, and from cross-origin sheets fetched again (Google Fonts allows it). When a family is
   * split into unicode-range subsets, only the faces covering Latin letters come along.
   */
  async collectFonts(): Promise<CaptureFont[]> {
    const out: CaptureFont[] = [];
    const seen = new Set<string>();
    const add = (rule: FontFaceRule, base: string) => {
      if (out.length >= 24 || !this.families.has(rule.family.toLowerCase()) || !coversLatin(rule.unicodeRange)) return;
      const url = pickFontSource(rule.src, base);
      if (!url || seen.has(url)) return;
      seen.add(url);
      const font: CaptureFont = { family: rule.family, url };
      if (rule.weight && rule.weight !== "normal") font.weight = rule.weight === "bold" ? "700" : rule.weight;
      if (rule.style && rule.style !== "normal") font.style = rule.style;
      if (rule.unicodeRange) font.unicodeRange = rule.unicodeRange;
      out.push(font);
    };
    const visitRules = (rules: CSSRuleList, base: string) => {
      for (const rule of rules) {
        if (rule.constructor.name === "CSSFontFaceRule" || rule.type === 5) {
          const s = (rule as CSSFontFaceRule).style;
          const family = parseFontFamilies(s.getPropertyValue("font-family"))[0];
          if (family) add({ family, src: s.getPropertyValue("src"), weight: s.getPropertyValue("font-weight"), style: s.getPropertyValue("font-style"), unicodeRange: s.getPropertyValue("unicode-range") }, base);
        } else if (rule.type === 3 && (rule as CSSImportRule).styleSheet) pending.push(visitSheet((rule as CSSImportRule).styleSheet!));
        else if ("cssRules" in rule) visitRules((rule as CSSGroupingRule).cssRules, base);
      }
    };
    const pending: Promise<void>[] = [];
    const visitSheet = async (sheet: CSSStyleSheet): Promise<void> => {
      const base = sheet.href ?? document.baseURI;
      let rules: CSSRuleList | null = null;
      try {
        rules = sheet.cssRules;
      } catch {
        rules = null;
      }
      if (rules) {
        visitRules(rules, base);
        return;
      }
      if (!sheet.href) return;
      try {
        const response = await fetch(sheet.href, { mode: "cors", credentials: "omit" });
        if (response.ok) for (const rule of parseFontFaceRules(await response.text())) add(rule, sheet.href);
      } catch {
        // The sheet can't be read here; its text falls back to installed fonts.
      }
    };
    for (const sheet of document.styleSheets) pending.push(visitSheet(sheet));
    for (let i = 0; i < pending.length; i++) await pending[i];
    return out;
  }

  notes(): string[] {
    const c = this.counters;
    const out: string[] = [];
    if (this.truncated) out.push(`Stopped after ${this.maxElements} elements, so the rest of the page wasn't imported. Import a smaller part with a selector.`);
    if (this.truncatedHeight) out.push(`The page is ${Math.round(this.truncatedHeight)} points tall; only the top ${this.options.maxHeight ?? 12_000} points were imported.`);
    if (c.flattenedText) out.push(`${c.flattenedText} long paragraph${c.flattenedText === 1 ? "" : "s"} mixed several text styles; each became one text layer in its main style.`);
    if (c.approximateTransforms) out.push(`${c.approximateTransforms} skewed or unevenly scaled element${c.approximateTransforms === 1 ? " was" : "s were"} approximated with rotation and uniform scale.`);
    if (c.missingImages) out.push(`${c.missingImages} image${c.missingImages === 1 ? " hadn't" : "s hadn't"} loaded, so ${c.missingImages === 1 ? "it's" : "they're"} gray placeholders.`);
    if (c.unsupportedBackgrounds) out.push(`${c.unsupportedBackgrounds} background${c.unsupportedBackgrounds === 1 ? "" : "s"} used CSS Sonobe can't draw (image-set, cross-fade...) and ${c.unsupportedBackgrounds === 1 ? "was" : "were"} left out.`);
    if (c.unsupportedControls) out.push(`${c.unsupportedControls} form control${c.unsupportedControls === 1 ? "" : "s"} (sliders, date or file pickers) became plain boxes.`);
    if (c.unplacedNames.size) {
      const one = c.unplacedNames.size === 1;
      const names = [...c.unplacedNames].slice(0, 5).map((n) => `“${n}”`).join(", ");
      out.push(`${names} ${one ? "names" : "name"} part of a long paragraph that became one text layer, so no layer has ${one ? "that name" : "those names"}. Split the paragraph, or make ${one ? "that element" : "those elements"} display: inline-block.`);
    }
    if (c.placeholders.size) out.push(`Placeholders stand in for ${[...c.placeholders].join(", ")}.`);
    if (c.undrawnSymbols.size) {
      const one = c.undrawnSymbols.size === 1;
      const names = [...c.undrawnSymbols].slice(0, 5).map((n) => `“${n}”`).join(", ");
      out.push(`The SF Symbol${one ? "" : "s"} ${names}${c.undrawnSymbols.size > 5 ? ` and ${c.undrawnSymbols.size - 5} more` : ""} ${one ? "is a gray placeholder" : "are gray placeholders"}: this capture didn't draw SF Symbols. Sonobe draws them when it imports in the app on a Mac with macOS 13 or later.`);
    }
    return out;
  }

  /** Nodes for an element (0 when it isn't drawn, several when a paintless wrapper passes its children up). */
  visitElement(el: Element, force = false, extra: { stripFill?: boolean } = {}): CaptureNode[] {
    if (this.elements >= this.maxElements) {
      this.truncated = true;
      return [];
    }
    const tag = el.localName;
    if (SKIP_TAGS.has(tag)) return [];
    const cs = getComputedStyle(el);
    if (cs.display === "none") return [];
    this.elements++;
    if (cs.display === "contents") return this.visitChildren(el, cs);
    if (cs.visibility === "hidden" || cs.visibility === "collapse") return [];
    const opacity = Number(cs.opacity);
    if (opacity === 0 && !force) return [];
    const rect = el.getBoundingClientRect();
    // Screen-reader-only content: a 1px box that's clipped away.
    if (!force && rect.width <= 1 && rect.height <= 1 && (cs.overflow !== "visible" || cs.clip !== "auto" || cs.clipPath !== "none")) return [];
    if (!force && (rect.right < this.origin[0] - 4000 || rect.bottom < this.origin[1] - 4000 || rect.left > this.origin[0] + 8000)) return [];

    // A fixed element stays on screen while the page scrolls, unless an ancestor contains it.
    const isFixed = this.pageMode && cs.position === "fixed" && this.fixedDepth === 0 && this.containingBlocks === 0;
    const contains = cs.transform !== "none" || cs.filter !== "none" || cs.perspective !== "none" || /transform|filter|perspective/.test(cs.willChange) || /paint|layout|strict|content/.test(cs.contain);
    if (isFixed) this.fixedDepth++;
    if (contains) this.containingBlocks++;
    try {
      const nodes = this.visitDrawn(el, tag, cs, rect, force, extra);
      const key = this.paintKey(el, cs);
      for (const n of nodes) if (!this.paintKeys.has(n)) this.paintKeys.set(n, key);
      if (isFixed) {
        this.fixed.push(...nodes);
        return [];
      }
      return nodes;
    } finally {
      if (isFixed) this.fixedDepth--;
      if (contains) this.containingBlocks--;
    }
  }

  visitDrawn(el: Element, tag: string, cs: CSSStyleDeclaration, transformedRect: DOMRect, force: boolean, extra: { stripFill?: boolean }): CaptureNode[] {
    const transform = parseTransform(cs.transform);
    const style = (el as HTMLElement).style as CSSStyleDeclaration | undefined;
    if (!transform || !style) return this.visitUntransformed(el, tag, cs, transformedRect, null, force, extra);
    // Measure the element and everything inside it without its transform, shifted so its center lands
    // where the transformed element's center is. Sonobe then applies the rotation and scale to the group.
    if (transform.approximate) this.counters.approximateTransforms++;
    const saved = ["transform", "transition"].map((prop) => [prop, style.getPropertyValue(prop), style.getPropertyPriority(prop)] as const);
    const previousShift = this.shift;
    style.setProperty("transition", "none", "important");
    style.setProperty("transform", "none", "important");
    const plain = el.getBoundingClientRect();
    this.shift = [previousShift[0] + (transformedRect.left + transformedRect.width / 2) - (plain.left + plain.width / 2), previousShift[1] + (transformedRect.top + transformedRect.height / 2) - (plain.top + plain.height / 2)];
    try {
      return this.visitUntransformed(el, tag, cs, plain, transform, force, extra);
    } finally {
      this.shift = previousShift;
      for (const [prop, value, priority] of saved) {
        if (value) style.setProperty(prop, value, priority);
        else style.removeProperty(prop);
      }
    }
  }

  visitUntransformed(el: Element, tag: string, cs: CSSStyleDeclaration, rect: DOMRect, transform: ReturnType<typeof parseTransform>, force: boolean, extra: { stripFill?: boolean }): CaptureNode[] {
    const frame = this.frame(el, tag, cs, this.box(rect), transform);
    if (extra.stripFill) {
      delete frame.fill;
      delete frame.gradients;
      delete frame.backgroundImage;
    }
    if (tag === "html" || tag === "body") delete frame.clip;
    if (el.hasAttribute("data-sf-symbol") && !el.hasAttribute("data-sf-drawn")) {
      this.addSymbolPlaceholder(el, cs, rect, frame);
      if (force) frame.keep = true;
      return this.finish(frame);
    }

    switch (tag) {
      case "img":
        this.addImageElement(el as HTMLImageElement, cs, rect, frame);
        break;
      case "svg":
        this.addSvg(el as SVGSVGElement, rect, frame);
        break;
      case "canvas":
        this.addCanvas(el as HTMLCanvasElement, cs, rect, frame);
        break;
      case "video":
        this.addVideo(el as HTMLVideoElement, cs, rect, frame);
        break;
      case "iframe":
      case "object":
      case "embed":
        if (!frame.fill) frame.fill = "#E5E7EBFF";
        this.counters.placeholders.add("embedded pages");
        break;
      case "input":
      case "textarea":
      case "select":
        if (!this.addControl(el as HTMLInputElement, tag, cs, rect, frame)) return [];
        break;
      case "hr":
        if (!frame.border && !frame.fill) frame.fill = this.toColor(cs.color) ?? "#00000033";
        break;
      default: {
        const before = this.pseudo(el, cs, "::before");
        const after = this.pseudo(el, cs, "::after");
        frame.children = this.visitChildren(el, cs);
        if (before) frame.children.unshift(before);
        if (after) frame.children.push(after);
      }
    }
    if (force) frame.keep = true;
    return this.finish(frame);
  }

  /** Paint and identity for an element's box. */
  frame(el: Element, tag: string, cs: CSSStyleDeclaration, box: Box, transform: ReturnType<typeof parseTransform>): CaptureFrame {
    const [, , w, h] = box;
    const frame: CaptureFrame = { kind: "frame", box, children: [] };
    this.nodes++;
    const name = this.nameOf(el, tag);
    frame.name = name.name;
    frame.nameRank = name.rank;
    this.nameKinds.set(frame, name.kind);
    const source = this.sourceOf(el, tag);
    if (source) frame.source = source;
    const opacity = Number(cs.opacity);
    if (Number.isFinite(opacity) && opacity < 1) frame.opacity = round2(opacity);
    if (transform) {
      if (transform.rotation) frame.rotation = transform.rotation;
      if (transform.scale !== 1) frame.scale = transform.scale;
    }
    this.paint(frame, el, cs);
    if (cs.overflowX !== "visible" || cs.overflowY !== "visible") frame.clip = true;
    const scrollsY = (cs.overflowY === "auto" || cs.overflowY === "scroll") && el.scrollHeight > el.clientHeight + 1;
    const scrollsX = (cs.overflowX === "auto" || cs.overflowX === "scroll") && el.scrollWidth > el.clientWidth + 1;
    if ((scrollsX || scrollsY) && tag !== "html" && tag !== "body") {
      frame.scroll = { x: scrollsX, y: scrollsY };
      if ((frame.nameRank ?? 0) < 2) {
        frame.name = scrollsX && !scrollsY ? "Carousel" : "Scroll View";
        frame.nameRank = 1;
      }
      el.scrollTop = 0;
      el.scrollLeft = 0;
    }
    if (this.isInteractive(el, tag, cs)) frame.interactive = true;
    return frame;
  }

  /** Backgrounds, gradients, background images, radii, borders, shadows, blur and blending. */
  paint(frame: CaptureFrame, el: Element, cs: CSSStyleDeclaration): void {
    const [, , w, h] = frame.box;
    const fill = this.toColor(cs.backgroundColor);
    const clipText = cs.backgroundClip === "text" || (cs as unknown as { webkitBackgroundClip?: string }).webkitBackgroundClip === "text";
    if (fill && !clipText) frame.fill = fill;
    const bg = parseBackgroundImages(cs.backgroundImage, this.toColor, w, h);
    if (clipText) {
      const first = bg.gradients[0]?.stops[0]?.[1] ?? fill;
      if (first) this.gradientText.set(el, first);
    } else {
      if (bg.gradients.length) frame.gradients = bg.gradients;
      if (bg.url) {
        const key = this.imageKey(bg.url, {});
        if (key) frame.backgroundImage = { image: key, fit: this.backgroundFit(cs) };
      }
      this.counters.unsupportedBackgrounds += bg.unsupported;
    }
    const radii = clampRadii([parseRadius(cs.borderTopLeftRadius, w, h), parseRadius(cs.borderTopRightRadius, w, h), parseRadius(cs.borderBottomRightRadius, w, h), parseRadius(cs.borderBottomLeftRadius, w, h)], w, h);
    if (radii.some((r) => r > 0)) frame.radii = radii.map(round2) as [number, number, number, number];
    const border = this.border(cs);
    if (border) frame.border = border;
    const shadows = parseBoxShadows(cs.boxShadow, this.toColor);
    if (shadows.length) frame.shadows = shadows;
    const blur = parseBlur(cs.filter);
    if (blur) frame.blur = blur;
    const backdrop = parseBlur(cs.backdropFilter || (cs as unknown as { webkitBackdropFilter?: string }).webkitBackdropFilter || "");
    if (backdrop) frame.backgroundBlur = backdrop;
    const blend = blendModeKey(cs.mixBlendMode);
    if (blend) frame.blendMode = blend;
  }

  border(cs: CSSStyleDeclaration): CaptureBorder | undefined {
    const side = (s: "Top" | "Right" | "Bottom" | "Left") => {
      const style = cs.getPropertyValue(`border-${s.toLowerCase()}-style`);
      const width = style === "none" || style === "hidden" ? 0 : (parsePx(cs.getPropertyValue(`border-${s.toLowerCase()}-width`)) ?? 0);
      const color = width > 0 ? this.toColor(cs.getPropertyValue(`border-${s.toLowerCase()}-color`)) : null;
      return { width: color ? width : 0, color: color ?? "#00000000" };
    };
    const sides = [side("Top"), side("Right"), side("Bottom"), side("Left")];
    if (sides.every((s) => s.width === 0)) return undefined;
    return { widths: sides.map((s) => round2(s.width)) as CaptureBorder["widths"], colors: sides.map((s) => s.color) as CaptureBorder["colors"] };
  }

  backgroundFit(cs: CSSStyleDeclaration): ImageFit {
    const size = cs.backgroundSize;
    if (size.includes("cover")) return "cover";
    if (size.includes("contain")) return "contain";
    if (size === "100% 100%") return "stretch";
    return cs.backgroundRepeat.startsWith("no-repeat") ? "contain" : "tile";
  }

  isInteractive(el: Element, tag: string, cs: CSSStyleDeclaration): boolean {
    if (tag === "button" || tag === "summary" || tag === "select" || (tag === "a" && el.hasAttribute("href"))) return true;
    const role = el.getAttribute("role");
    if (role && INTERACTIVE_ROLES.has(role)) return true;
    if (el.hasAttribute("onclick")) return true;
    if (cs.cursor === "pointer") {
      const parent = el.parentElement;
      return !parent || getComputedStyle(parent).cursor !== "pointer";
    }
    return false;
  }

  sourceOf(el: Element, tag: string): CaptureFrame["source"] {
    const out: NonNullable<CaptureFrame["source"]> = { tag };
    const component = componentName(el);
    if (component) out.component = component;
    if (el.id) out.id = el.id.slice(0, 200);
    const testId = el.getAttribute("data-testid") ?? el.getAttribute("data-test-id");
    if (testId) out.testId = testId.slice(0, 200);
    return out;
  }

  nameOf(el: Element, tag: string): NameInfo {
    const explicit = explicitName(el);
    if (explicit) return { name: explicit, rank: 5, kind: "explicit" };
    // An SF Symbol is named after the symbol ("heart.fill"). Like an icon class it names the glyph, so a
    // named wrapper that disappears around it still gives it the wrapper's name.
    const symbol = el.getAttribute("data-sf-symbol")?.trim();
    if (symbol) return { name: symbol.slice(0, 80), rank: 2, kind: "icon" };
    const component = componentName(el);
    if (component) return { name: titleize(component), rank: 4, kind: "component" };
    const aria = el.getAttribute("aria-label") ?? (tag === "svg" || tag === "img" ? (el.getAttribute("title") ?? el.querySelector?.(":scope > title")?.textContent) : null);
    if (aria?.trim()) {
      const role = ROLE_NAMES[el.getAttribute("role") ?? ""] ?? SEMANTIC_NAMES[tag];
      const label = aria.trim().slice(0, 60);
      return { name: role && (tag === "button" || tag === "a" || el.hasAttribute("role")) && !label.toLowerCase().includes(role.toLowerCase()) ? `${label} ${role}` : label, rank: 3, kind: "aria" };
    }
    const icon = iconName(el);
    if (icon) return { name: icon, rank: 2, kind: "icon" };
    const testId = el.getAttribute("data-testid") ?? el.getAttribute("data-test-id") ?? el.getAttribute("data-cy");
    if (testId && readableId(testId)) return { name: titleize(testId), rank: 2, kind: "id" };
    if (el.id && readableId(el.id)) return { name: titleize(el.id), rank: 2, kind: "id" };
    const semantic = ROLE_NAMES[el.getAttribute("role") ?? ""] ?? SEMANTIC_NAMES[tag];
    if (semantic && (tag === "button" || tag === "a" || el.getAttribute("role") === "button" || el.getAttribute("role") === "tab")) {
      const text = collapseWhitespace(el.textContent ?? "", "normal").trim();
      if (text && text.length <= 32) return { name: `${text} ${semantic}`, rank: 2, kind: "role" };
    }
    if (semantic) return { name: semantic, rank: 1, kind: "semantic" };
    return { name: "Group", rank: 0, kind: "generic" };
  }

  /**
   * The nearest plain inline element from `owner` up to (not including) `block` whose own name beats
   * its words (<span data-name="City">, <b aria-label="Price">). With `explicitOnly`, only data-name and
   * friends count: those ask for a layer, so their text becomes a run of its own (see paragraph()).
   */
  namedInline(owner: Element, block: Element, explicitOnly = false): { el: Element; info: NameInfo } | null {
    for (let el: Element | null = owner; el && el !== block; el = el.parentElement) {
      let info = this.inlineNames.get(el);
      if (info === undefined) {
        const candidate = this.nameOf(el, el.localName);
        info = namesText(candidate.kind, el.textContent ?? "") ? candidate : null;
        this.inlineNames.set(el, info);
      }
      if (info && (!explicitOnly || info.kind === "explicit")) return { el, info };
    }
    return null;
  }

  /**
   * Name a text layer after the named inline element its text came from. An element with data-name
   * always does, since its text is a run of its own; any other strong name only when the element holds
   * all of this text (<b id="price-now">$4.99</b> <b>each</b> stays "$4.99 each").
   */
  nameFromInline(node: CaptureText, owner: Element, block: Element): CaptureText {
    const named = this.namedInline(owner, block);
    if (named && (named.info.kind === "explicit" || holdsAll(named.el, node.text))) this.nameAfter(node, named.el, named.info);
    return node;
  }

  nameAfter(node: CaptureText, el: Element, info: NameInfo): void {
    node.name = info.name;
    node.nameRank = info.rank;
    node.source = this.sourceOf(el, el.localName);
  }

  /** CSS painting order among siblings: negative z-index, in flow, positioned, positive z-index. */
  paintKey(el: Element, cs: CSSStyleDeclaration): number {
    const positioned = cs.position !== "static";
    const parent = el.parentElement ? getComputedStyle(el.parentElement).display : "";
    const zApplies = positioned || /flex|grid/.test(parent);
    const z = cs.zIndex === "auto" ? null : Number(cs.zIndex);
    if (zApplies && z !== null && Number.isFinite(z)) return z < 0 ? -1 + z / 1e9 : z === 0 ? 1 : 2 + Math.min(z, 1e9) / 1e9;
    return positioned ? 1 : 0;
  }

  /**
   * An absolutely positioned ::before or ::after with paint (a toggle knob, a badge dot, an overlay).
   * Pseudo-elements have no DOM box, so the box comes from the used left/top/width/height inside the
   * containing block. In-flow pseudo-elements are left out: their text already moved what's next to them.
   */
  pseudo(el: Element, elCs: CSSStyleDeclaration, which: "::before" | "::after"): CaptureNode | null {
    if (el.namespaceURI !== "http://www.w3.org/1999/xhtml") return null;
    const cs = getComputedStyle(el, which);
    const content = cs.content;
    if (!content || content === "none" || content === "normal" || cs.display === "none") return null;
    if (cs.position !== "absolute" && cs.position !== "fixed") return null;
    const width = parsePx(cs.width);
    const height = parsePx(cs.height);
    const left = parsePx(cs.left);
    const top = parsePx(cs.top);
    if (width === null || height === null || left === null || top === null || width <= 0 || height <= 0) return null;
    let container: Element | null = el;
    if (cs.position === "absolute") {
      while (container && container !== document.documentElement && getComputedStyle(container).position === "static" && getComputedStyle(container).transform === "none") container = container.parentElement;
    }
    const base = cs.position === "fixed" || !container ? { left: 0, top: 0 } : (() => {
      const r = container.getBoundingClientRect();
      const ccs = container === el ? elCs : getComputedStyle(container);
      return { left: r.left + (parsePx(ccs.borderLeftWidth) ?? 0), top: r.top + (parsePx(ccs.borderTopWidth) ?? 0) };
    })();
    const box = this.box({ left: base.left + left + (parsePx(cs.marginLeft) ?? 0), top: base.top + top + (parsePx(cs.marginTop) ?? 0), width, height });
    const frame: CaptureFrame = { kind: "frame", box, children: [], name: which === "::before" ? "Before" : "After", nameRank: 0 };
    this.nodes++;
    const opacity = Number(cs.opacity);
    if (opacity === 0) return null;
    if (Number.isFinite(opacity) && opacity < 1) frame.opacity = round2(opacity);
    const transform = parseTransform(cs.transform);
    if (transform?.rotation) frame.rotation = transform.rotation;
    if (transform && transform.scale !== 1) frame.scale = transform.scale;
    this.paint(frame, el, cs);
    const text = /^["'](.*)["']$/s.exec(content)?.[1]?.replace(/\\([0-9a-f]{1,6})\s?/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)));
    if (text?.trim()) {
      this.nodes++;
      const lineHeight = parsePx(cs.lineHeight) ?? (parseFloat(cs.fontSize) || 16) * 1.2;
      const style = this.textStyle(el, cs, lineHeight);
      frame.children.push({ kind: "text", text: text.trim(), style, box: [box[0], round2(box[1] + Math.max(0, (box[3] - lineHeight) / 2)), box[2], round2(lineHeight)], name: textName(text), nameRank: 1, wraps: true, maxLines: 1 });
    }
    const url = /^url\(\s*["']?([^"')]+)["']?\s*\)$/.exec(content)?.[1];
    if (url) {
      const key = this.imageKey(url, { name: fileStem(url) });
      if (key) frame.children.push(this.imageNode(key, box, "stretch", frame, "Icon"));
    }
    const paints = frame.fill || frame.gradients || frame.backgroundImage || frame.border || frame.shadows || frame.children.length;
    if (!paints) return null;
    this.paintKeys.set(frame, 1);
    return frame;
  }

  /**
   * Drop paintless wrappers, handing their identity to the child they wrap. Text takes the wrapper's name
   * only when it's a name a person gave that element (see namesText).
   */
  finish(frame: CaptureFrame): CaptureNode[] {
    if (paints(frame) || frame.keep || frame.scroll) return [frame];
    const children = frame.children;
    // A plain <body> or <html> passes its children up: the screen already is the page.
    if ((frame.source?.tag === "body" || frame.source?.tag === "html") && !frame.clip && frame.opacity === undefined && frame.rotation === undefined && frame.scale === undefined) return children;
    if (children.length === 0) return frame.interactive && frame.box[2] > 0 && frame.box[3] > 0 ? [frame] : [];
    const transformed = frame.rotation !== undefined || frame.scale !== undefined;
    const faded = frame.opacity !== undefined;
    if (children.length === 1) {
      const child = children[0]!;
      const inside = contains(frame.box, child.box);
      if ((!frame.clip || inside) && !transformed && !(frame.interactive && !sameBox(frame.box, child.box) && child.kind !== "frame")) {
        if (faded) child.opacity = round2((child.opacity ?? 1) * frame.opacity!);
        if ((frame.nameRank ?? 0) > (child.nameRank ?? 0) && (child.kind !== "text" || namesText(this.nameKinds.get(frame), child.text))) {
          child.name = frame.name;
          child.nameRank = frame.nameRank;
          if (frame.source) child.source = { ...child.source, ...frame.source };
        }
        if (frame.interactive) {
          if (sameBox(frame.box, child.box) || child.kind === "frame") child.interactive = true;
        }
        if (frame.radii && frame.clip && child.kind === "image" && sameBox(frame.box, child.box)) child.radii = frame.radii;
        return [child];
      }
      return [frame];
    }
    return [frame];
  }

  // -------------------------------------------------------------------------
  // Children and text
  // -------------------------------------------------------------------------

  visitChildren(el: Element, cs: CSSStyleDeclaration): CaptureNode[] {
    const list: Node[] = [];
    const collect = (nodes: NodeListOf<ChildNode> | Node[]) => {
      for (const node of nodes) {
        if (node.nodeType === Node.ELEMENT_NODE && (node as Element).localName === "slot") collect((node as HTMLSlotElement).assignedNodes({ flatten: true }));
        else list.push(node);
      }
    };
    collect(el.shadowRoot ? el.shadowRoot.childNodes : el.childNodes);
    const out: CaptureNode[] = [];
    let group: Node[] = [];
    const flush = () => {
      if (group.length) out.push(...this.paragraph(el, cs, group));
      group = [];
    };
    for (const node of list) {
      if (node.nodeType === Node.TEXT_NODE) {
        group.push(node);
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const child = node as Element;
      if (this.isPlainInline(child)) {
        group.push(child);
        continue;
      }
      flush();
      out.push(...this.visitElement(child));
    }
    flush();
    // Stable sort into painting order.
    return out.map((node, i) => ({ node, i, key: this.paintKeys.get(node) ?? 0 })).sort((a, b) => a.key - b.key || a.i - b.i).map((x) => x.node);
  }

  /** Inline elements that only style text (a, b, em, a plain span) join the surrounding paragraph. */
  isPlainInline(el: Element): boolean {
    const cached = this.plainInline.get(el);
    if (cached !== undefined) return cached;
    let plain = false;
    if (el.localName === "br" || el.localName === "wbr") plain = true;
    else if (!el.shadowRoot && !SKIP_TAGS.has(el.localName) && !el.hasAttribute("data-sf-symbol") && el.namespaceURI === "http://www.w3.org/1999/xhtml" && !["img", "svg", "input", "textarea", "select", "button", "video", "canvas", "iframe"].includes(el.localName)) {
      const cs = getComputedStyle(el);
      if (cs.display === "none") plain = true;
      else if (cs.display === "inline" && cs.position !== "absolute" && cs.position !== "fixed") {
        const painted = !!this.toColor(cs.backgroundColor) || cs.backgroundImage !== "none" || cs.boxShadow !== "none" || ["Top", "Right", "Bottom", "Left"].some((s) => (parsePx(cs.getPropertyValue(`border-${s.toLowerCase()}-width`)) ?? 0) > 0 && cs.getPropertyValue(`border-${s.toLowerCase()}-style`) !== "none");
        plain = !painted && [...el.childNodes].every((c) => c.nodeType === Node.TEXT_NODE || c.nodeType === Node.COMMENT_NODE || (c.nodeType === Node.ELEMENT_NODE && this.isPlainInline(c as Element)));
      }
    }
    this.plainInline.set(el, plain);
    return plain;
  }

  textStyle(owner: Element, cs: CSSStyleDeclaration, lineHeight: number): CaptureTextStyle {
    const fillColor = (cs as unknown as { webkitTextFillColor?: string }).webkitTextFillColor;
    let color = fillColor && fillColor !== cs.color ? this.toColor(fillColor) : this.toColor(cs.color);
    if (!color) {
      for (let e: Element | null = owner; e && !color; e = e.parentElement) color = this.gradientText.get(e) ?? null;
    }
    for (const family of parseFontFamilies(cs.fontFamily)) this.families.add(family.toLowerCase());
    const style: CaptureTextStyle = {
      fontFamily: cs.fontFamily.slice(0, 500),
      fontSize: round2(parseFloat(cs.fontSize) || 16),
      fontWeight: Number.parseInt(cs.fontWeight, 10) || (cs.fontWeight === "bold" ? 700 : 400),
      color: color ?? "#00000000",
      lineHeight: round2(lineHeight),
    };
    if (cs.fontStyle === "italic" || cs.fontStyle.startsWith("oblique")) style.italic = true;
    const align = cs.textAlign;
    if (align === "center" || align === "-webkit-center") style.align = "center";
    else if (align === "right" || align === "-webkit-right" || (align === "end" && cs.direction !== "rtl") || (align === "start" && cs.direction === "rtl")) style.align = "right";
    else if (align === "justify") style.align = "justify";
    const spacing = parsePx(cs.letterSpacing);
    if (spacing) style.letterSpacing = round2(spacing);
    const deco = cs.textDecorationLine || cs.textDecoration;
    if (deco.includes("underline")) style.decoration = "underline";
    else if (deco.includes("line-through")) style.decoration = "strikethrough";
    if (cs.textTransform === "uppercase" || cs.textTransform === "lowercase" || cs.textTransform === "capitalize") style.transform = cs.textTransform;
    return style;
  }

  /** Text layers for a run of text nodes and plain inline elements inside `block`. */
  paragraph(block: Element, blockCs: CSSStyleDeclaration, nodes: Node[]): CaptureNode[] {
    interface Run {
      text: string;
      owner: Element;
      node: Text | null;
    }
    const runs: Run[] = [];
    const visit = (node: Node, owner: Element) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const cs = owner === block ? blockCs : getComputedStyle(owner);
        runs.push({ text: collapseWhitespace((node as Text).data, cs.whiteSpace), owner, node: node as Text });
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const e = node as Element;
        if (e.localName === "br") runs.push({ text: "\n", owner, node: null });
        else if (getComputedStyle(e).display !== "none") for (const c of e.childNodes) visit(c, e);
      }
    };
    for (const node of nodes) visit(node, block);
    const collapses = !/^(?:pre|pre-wrap|break-spaces)$/.test(blockCs.whiteSpace);
    // Collapse spaces across run boundaries and trim the paragraph's ends.
    if (collapses) {
      let previousSpace = true;
      for (const run of runs) {
        let t = run.text;
        if (previousSpace) t = t.replace(/^ +/, "");
        previousSpace = t.endsWith(" ") || t.endsWith("\n");
        run.text = t;
      }
      for (let i = runs.length - 1; i >= 0; i--) {
        const trimmed = runs[i]!.text.replace(/[ ]+$/, "");
        runs[i]!.text = trimmed;
        if (trimmed !== "") break;
      }
    }
    const text = runs.map((r) => r.text).join("");
    if (text.trim() === "") return [];

    const range = document.createRange();
    range.setStartBefore(nodes[0]!);
    range.setEndAfter(nodes[nodes.length - 1]!);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    if (rects.length === 0) return [];
    const lineTops = lineClusters(rects);
    const lines = lineTops.length;

    const styleKey = (cs: CSSStyleDeclaration) => [cs.fontFamily, cs.fontSize, cs.fontWeight, cs.fontStyle, cs.color, cs.textDecorationLine, cs.letterSpacing, cs.textTransform].join("|");
    // An inline element with data-name (<span data-name="Closing Time">) is a run of its own, like a
    // change of style, so its text becomes a layer that can carry the name.
    const runKey = (owner: Element) => {
      const key = styleKey(getComputedStyle(owner));
      const named = this.namedInline(owner, block, true);
      if (!named) return key;
      if (!this.runIds.has(named.el)) this.runIds.set(named.el, ++this.runCount);
      return `${key}|#${this.runIds.get(named.el)}`;
    };
    const withText = runs.filter((r) => r.node && r.text.trim() !== "");
    // Runs decide between one text layer and several; styles alone decide what flattening loses.
    const keys = new Map<string, number>();
    const styles = new Map<string, number>();
    for (const run of withText) {
      const k = runKey(run.owner);
      keys.set(k, (keys.get(k) ?? 0) + run.text.length);
      const s = styleKey(getComputedStyle(run.owner));
      styles.set(s, (styles.get(s) ?? 0) + run.text.length);
    }

    if (keys.size > 1 && lines === 1) {
      // One line with several styles: a text layer per styled run, merging neighbours that match.
      const out: CaptureNode[] = [];
      let current: { runs: Run[]; key: string } | null = null;
      const emit = () => {
        if (!current) return;
        const r = document.createRange();
        r.setStartBefore(current.runs[0]!.node!);
        r.setEndAfter(current.runs[current.runs.length - 1]!.node!);
        const bounds = r.getBoundingClientRect();
        const t = current.runs.map((x) => x.text).join("").trim();
        if (t && bounds.width > 0) {
          const owner = current.runs[0]!.owner;
          out.push(this.nameFromInline(this.textNode(owner, getComputedStyle(owner), t, bounds, [...r.getClientRects()], 1, block, blockCs), owner, block));
        }
        current = null;
      };
      for (const run of runs) {
        if (!run.node) continue;
        const k = runKey(run.owner);
        if (current && current.key !== k) emit();
        if (!current) current = { runs: [], key: k };
        current.runs.push(run);
      }
      emit();
      return out;
    }

    let owner = block;
    if (keys.size > 1) {
      const split = lines <= 16 ? this.splitStyledLines(runs, block, blockCs, text, range.getBoundingClientRect(), runKey) : null;
      if (split) return [split];
      if (styles.size > 1) this.counters.flattenedText++;
      const dominant = [...styles.entries()].sort((a, b) => b[1] - a[1])[0]![0];
      owner = withText.find((r) => styleKey(getComputedStyle(r.owner)) === dominant)?.owner ?? block;
      // One text layer for the whole paragraph: a data-name inside it has no layer to go to, unless its
      // element holds all of the text.
      const node = this.textNode(owner, owner === block ? blockCs : getComputedStyle(owner), text, range.getBoundingClientRect(), rects, lines, block, blockCs, lineTops);
      for (const run of withText) {
        const named = this.namedInline(run.owner, block, true);
        if (!named) continue;
        if (holdsAll(named.el, text)) this.nameAfter(node, named.el, named.info);
        else this.counters.unplacedNames.add(named.info.name);
      }
      return [node];
    }
    if (withText[0]) owner = withText[0].owner;
    return [this.nameFromInline(this.textNode(owner, owner === block ? blockCs : getComputedStyle(owner), text, range.getBoundingClientRect(), rects, lines, block, blockCs, lineTops), owner, block)];
  }

  /**
   * A paragraph that mixes styles over several lines (a bold phrase, a link) as a group of single-line
   * text layers, one per styled run on each line, so it looks the same as the page. `runKey` tells runs
   * apart: by style, and by the named inline element they belong to.
   */
  splitStyledLines(runs: { text: string; owner: Element; node: Text | null }[], block: Element, blockCs: CSSStyleDeclaration, text: string, bounds: DOMRect, runKey: (owner: Element) => string): CaptureFrame | null {
    interface Word {
      text: string;
      rect: DOMRect;
      owner: Element;
      key: string;
      space: boolean;
    }
    const words: Word[] = [];
    const range = document.createRange();
    for (const run of runs) {
      if (!run.node) continue;
      const data = run.node.data;
      const cs = getComputedStyle(run.owner);
      const key = runKey(run.owner);
      const collapses = !/^(?:pre|pre-wrap|break-spaces)$/.test(cs.whiteSpace);
      for (const m of data.matchAll(/\S+/g)) {
        range.setStart(run.node, m.index);
        range.setEnd(run.node, m.index + m[0].length);
        const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
        // A word broken over two lines (a long URL) can't be placed as one piece.
        if (rects.length !== 1) return null;
        const after = data.slice(m.index + m[0].length, m.index + m[0].length + 1);
        words.push({ text: collapses ? m[0] : m[0], rect: rects[0]!, owner: run.owner, key, space: after !== "" && /\s/.test(after) });
        if (words.length > 600) return null;
      }
    }
    if (words.length === 0) return null;
    // Lines by top, then runs of one style within a line.
    const lineOf = new Map<Word, number>();
    const tops: number[] = [];
    for (const w of [...words].sort((a, b) => a.rect.top - b.rect.top)) {
      let line = tops.findIndex((t) => Math.abs(t - w.rect.top) < Math.max(2, w.rect.height * 0.5));
      if (line < 0) {
        tops.push(w.rect.top);
        line = tops.length - 1;
      }
      lineOf.set(w, line);
    }
    const children: CaptureNode[] = [];
    let segment: Word[] = [];
    const flush = () => {
      if (!segment.length) return;
      const first = segment[0]!;
      const last = segment[segment.length - 1]!;
      const segmentText = segment.map((w, i) => w.text + (i < segment.length - 1 && w.space ? " " : "")).join("");
      const left = first.rect.left;
      const right = last.rect.right;
      const top = Math.min(...segment.map((w) => w.rect.top));
      const height = Math.max(...segment.map((w) => w.rect.height));
      const cs = getComputedStyle(first.owner);
      const node = this.nameFromInline(this.textNode(first.owner, cs, segmentText, new DOMRect(left, top, right - left, height), [new DOMRect(left, top, right - left, height)], 1, block, blockCs), first.owner, block);
      delete node.wraps;
      children.push(node);
      segment = [];
    };
    for (const w of words) {
      const prev = segment[segment.length - 1];
      if (prev && (prev.key !== w.key || lineOf.get(prev) !== lineOf.get(w))) {
        // A space between runs of different styles belongs visually to the gap: keep it out of both.
        flush();
      }
      segment.push(w);
    }
    flush();
    this.nodes++;
    return { kind: "frame", name: textName(text), nameRank: 1, box: this.box(bounds), keep: true, children };
  }

  textNode(owner: Element, cs: CSSStyleDeclaration, text: string, bounds: DOMRect, rects: DOMRect[], lines: number, block: Element, blockCs: CSSStyleDeclaration, lineTops?: number[]): CaptureText {
    this.nodes++;
    const first = rects[0]!;
    let lineHeight = parsePx(cs.lineHeight);
    if (lineHeight === null) {
      const tops = lineTops ?? lineClusters(rects);
      lineHeight = tops.length > 1 ? (tops[tops.length - 1]! - tops[0]!) / (tops.length - 1) : Math.max(...rects.map((r) => r.height));
    }
    const style = this.textStyle(owner, cs, lineHeight);
    const nowrap = blockCs.whiteSpace === "nowrap" || blockCs.whiteSpace === "pre";
    const wraps = lines > 1 && !nowrap;
    const halfLeading = (lineHeight - first.height) / 2;
    const node: CaptureText = { kind: "text", text, style, box: [0, 0, 0, 0], name: textName(text), nameRank: 1 };
    const blockRect = block.getBoundingClientRect();
    const padLeft = (parsePx(blockCs.paddingLeft) ?? 0) + (parsePx(blockCs.borderLeftWidth) ?? 0);
    const padRight = (parsePx(blockCs.paddingRight) ?? 0) + (parsePx(blockCs.borderRightWidth) ?? 0);
    const contentLeft = blockRect.left + padLeft;
    const contentWidth = Math.max(0, blockRect.width - padLeft - padRight);
    if (wraps) {
      const top = bounds.top - halfLeading;
      // The lines' own extent, inside the block: text sharing a flex row with an icon starts after the icon.
      const left = Math.max(contentLeft, bounds.left);
      const right = Math.min(contentLeft + contentWidth, bounds.right);
      node.box = right > left ? this.box({ left, top, width: right - left, height: lines * lineHeight }) : this.box({ left: contentLeft, top, width: contentWidth, height: lines * lineHeight });
      node.wraps = true;
    } else {
      node.box = this.box({ left: bounds.left, top: first.top - halfLeading, width: bounds.width, height: lineHeight });
    }
    const clamp = Number((blockCs as unknown as { webkitLineClamp?: string }).webkitLineClamp);
    if (Number.isFinite(clamp) && clamp > 0) {
      node.maxLines = clamp;
      node.box = this.box({ left: contentLeft, top: bounds.top - halfLeading, width: contentWidth, height: Math.min(lines, clamp) * lineHeight });
      node.wraps = true;
    } else if (blockCs.textOverflow === "ellipsis" && blockCs.overflowX !== "visible" && nowrap && bounds.width > contentWidth + 1) {
      node.maxLines = 1;
      node.box[2] = round2(contentWidth);
    }
    return node;
  }

  // -------------------------------------------------------------------------
  // Images, SVG, media, and form controls
  // -------------------------------------------------------------------------

  contentBox(cs: CSSStyleDeclaration, rect: DOMRect): Box {
    const l = (parsePx(cs.borderLeftWidth) ?? 0) + (parsePx(cs.paddingLeft) ?? 0);
    const t = (parsePx(cs.borderTopWidth) ?? 0) + (parsePx(cs.paddingTop) ?? 0);
    const r = (parsePx(cs.borderRightWidth) ?? 0) + (parsePx(cs.paddingRight) ?? 0);
    const b = (parsePx(cs.borderBottomWidth) ?? 0) + (parsePx(cs.paddingBottom) ?? 0);
    return this.box({ left: rect.left + l, top: rect.top + t, width: Math.max(0, rect.width - l - r), height: Math.max(0, rect.height - t - b) });
  }

  /**
   * An image drawn inside `frame`. It takes the frame's name when the frame will disappear around it (no
   * paint); inside a frame that stays (a bordered avatar), the name stays on the frame and the image is
   * "<name> Image", so the two don't share a name. `inherit: false` keeps `name` (a checkbox's mark).
   */
  imageNode(key: string, box: Box, fit: ImageFit, frame: CaptureFrame, name: string, inherit = true): CaptureImage {
    this.nodes++;
    const named = inherit && (frame.nameRank ?? 0) >= 2;
    const node: CaptureImage = { kind: "image", image: key, fit, box, name: named ? (paints(frame) ? `${frame.name!} Image` : frame.name!) : name, nameRank: named ? frame.nameRank! : 1 };
    // An image clips to its own rounded corners.
    if (frame.radii && !frame.border) node.radii = frame.radii;
    return node;
  }

  addImageElement(img: HTMLImageElement, cs: CSSStyleDeclaration, rect: DOMRect, frame: CaptureFrame): void {
    const src = img.currentSrc || img.src;
    const box = this.contentBox(cs, rect);
    if (!src || img.naturalWidth === 0) {
      this.counters.missingImages++;
      frame.fill ??= "#E5E7EBFF";
      return;
    }
    const key = this.imageKey(src, { width: img.naturalWidth, height: img.naturalHeight, name: img.alt || fileStem(src) });
    if (!key) return;
    const fit = cs.objectFit === "cover" ? "cover" : cs.objectFit === "contain" || cs.objectFit === "scale-down" || cs.objectFit === "none" ? "contain" : "stretch";
    frame.children = [this.imageNode(key, box, fit, frame, img.alt?.trim() ? img.alt.trim().slice(0, 60) : "Image")];
  }

  addSvg(svg: SVGSVGElement, rect: DOMRect, frame: CaptureFrame): void {
    if (rect.width === 0 || rect.height === 0) return;
    let markup: string | null;
    try {
      markup = this.svgMarkup(svg, rect);
    } catch {
      markup = null;
    }
    if (!markup) {
      frame.fill ??= "#E5E7EBFF";
      this.counters.placeholders.add("SVGs that couldn't be read");
      return;
    }
    const key = this.imageKey(`data:image/svg+xml;base64,${utf8Base64(markup)}`, { width: Math.round(rect.width), height: Math.round(rect.height), name: frame.name && frame.nameRank! >= 2 ? frame.name : "icon" });
    if (!key) return;
    // Paint on the <svg> element itself (fill, stroke) is inside the drawing, not a box.
    delete frame.fill;
    const node = this.imageNode(key, this.box(rect), "stretch", frame, "Icon");
    delete node.radii;
    frame.children = [node];
  }

  /** An SF Symbol nothing drew (see dom/symbols.ts): a gray rounded square named after the symbol. */
  addSymbolPlaceholder(el: Element, cs: CSSStyleDeclaration, rect: DOMRect, frame: CaptureFrame): void {
    const size = parseFloat(cs.fontSize) || 17;
    if (rect.width === 0 || rect.height === 0) frame.box = this.box({ left: rect.left, top: rect.top, width: size, height: size });
    const [, , w, h] = frame.box;
    const r = round2(Math.min(w, h) / 4);
    frame.fill = "#E5E7EBFF";
    frame.radii = [r, r, r, r];
    frame.children = [];
    if (!el.hasAttribute("data-sf-placeholder")) this.counters.undrawnSymbols.add(el.getAttribute("data-sf-symbol")!.trim() || "(no name)");
  }

  /** The SVG with computed paint written onto every element, so classes and currentColor survive on their own. */
  svgMarkup(svg: SVGSVGElement, rect: DOMRect): string | null {
    const clone = svg.cloneNode(true) as SVGSVGElement;
    const originals = [svg, ...svg.querySelectorAll("*")];
    const copies = [clone, ...clone.querySelectorAll("*")];
    if (originals.length === copies.length && originals.length <= 3000) {
      const PROPS = ["fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset", "stroke-miterlimit", "opacity", "stop-color", "stop-opacity", "visibility", "font-family", "font-size", "font-weight", "text-anchor", "dominant-baseline"];
      const COLORS = new Set(["fill", "stroke", "stop-color"]);
      for (let i = 0; i < originals.length; i++) {
        const cs = getComputedStyle(originals[i]!);
        const decls: string[] = [];
        for (const prop of PROPS) {
          let value = cs.getPropertyValue(prop);
          if (!value) continue;
          if (COLORS.has(prop) && value !== "none" && !value.startsWith("url(")) value = this.toColor(value) ?? "none";
          decls.push(`${prop}:${value}`);
        }
        if (cs.display === "none") decls.push("display:none");
        copies[i]!.setAttribute("style", decls.join(";"));
        copies[i]!.removeAttribute("class");
      }
    }
    // <use href="#icon"> sprites: copy the referenced symbols in.
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    for (const use of clone.querySelectorAll("use")) {
      const href = use.getAttribute("href") ?? use.getAttribute("xlink:href");
      const id = href?.startsWith("#") ? href.slice(1) : null;
      // Ids like ":r1:" (React useId) aren't valid selectors, so compare ids instead of querying.
      if (!id || [...clone.querySelectorAll("[id]")].some((e) => e.id === id)) continue;
      const target = document.getElementById(id);
      if (target) defs.appendChild(target.cloneNode(true));
    }
    if (defs.childNodes.length) clone.insertBefore(defs, clone.firstChild);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(round2(rect.width)));
    clone.setAttribute("height", String(round2(rect.height)));
    if (!clone.hasAttribute("viewBox")) clone.setAttribute("viewBox", `0 0 ${round2(rect.width)} ${round2(rect.height)}`);
    try {
      return new XMLSerializer().serializeToString(clone);
    } catch {
      return null;
    }
  }

  addCanvas(canvas: HTMLCanvasElement, cs: CSSStyleDeclaration, rect: DOMRect, frame: CaptureFrame): void {
    try {
      const url = canvas.toDataURL("image/png");
      const key = this.imageKey(url, { width: canvas.width, height: canvas.height, name: "canvas" });
      if (key) frame.children = [this.imageNode(key, this.contentBox(cs, rect), "stretch", frame, "Canvas")];
    } catch {
      frame.fill ??= "#E5E7EBFF";
      this.counters.placeholders.add("canvases");
    }
  }

  addVideo(video: HTMLVideoElement, cs: CSSStyleDeclaration, rect: DOMRect, frame: CaptureFrame): void {
    const box = this.contentBox(cs, rect);
    const fit = cs.objectFit === "cover" ? "cover" : "contain";
    if (video.readyState >= 2 && video.videoWidth > 0) {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext("2d")!.drawImage(video, 0, 0);
        const key = this.imageKey(canvas.toDataURL("image/jpeg", 0.9), { width: canvas.width, height: canvas.height, name: "video frame" });
        if (key) {
          frame.children = [this.imageNode(key, box, fit, frame, "Video")];
          return;
        }
      } catch {
        // Cross-origin video: fall back to the poster.
      }
    }
    if (video.poster) {
      const key = this.imageKey(video.poster, { name: fileStem(video.poster) });
      if (key) {
        frame.children = [this.imageNode(key, box, fit, frame, "Video")];
        return;
      }
    }
    frame.fill ??= "#111111FF";
    this.counters.placeholders.add("videos");
  }

  /** Form controls. Returns false when the control isn't drawn (hidden inputs). */
  addControl(el: HTMLInputElement, tag: string, cs: CSSStyleDeclaration, rect: DOMRect, frame: CaptureFrame): boolean {
    const type = tag === "input" ? (el.type || "text").toLowerCase() : tag;
    if (type === "hidden") return false;
    frame.interactive = true;
    const box = this.contentBox(cs, rect);
    const lineHeight = parsePx(cs.lineHeight) ?? Math.round((parseFloat(cs.fontSize) || 16) * 1.2);
    if (type === "checkbox" || type === "radio") {
      if (cs.appearance === "none" || cs.appearance === "") return true;
      const accent = cs.accentColor && cs.accentColor !== "auto" ? (this.toColor(cs.accentColor) ?? "#0075FFFF") : "#0075FFFF";
      const size = Math.min(rect.width, rect.height);
      const r = type === "radio" ? size / 2 : Math.min(3, size / 4);
      frame.radii = [r, r, r, r];
      if (el.checked) {
        frame.fill = accent;
        const mark = type === "radio"
          ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="3.5" fill="#FFFFFF"/></svg>`
          : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
        const key = this.imageKey(`data:image/svg+xml;base64,${utf8Base64(mark)}`, { width: 16, height: 16, name: type === "radio" ? "radio dot" : "checkmark" });
        if (key) frame.children = [this.imageNode(key, this.box(rect), "stretch", frame, type === "radio" ? "Dot" : "Checkmark", false)];
      } else {
        frame.fill = "#FFFFFFFF";
        frame.border = { widths: [1, 1, 1, 1], colors: ["#767676FF", "#767676FF", "#767676FF", "#767676FF"] };
      }
      frame.name = frame.nameRank! >= 2 ? frame.name : type === "radio" ? "Radio" : "Checkbox";
      return true;
    }
    if (["range", "color", "file", "date", "datetime-local", "month", "week", "time", "image"].includes(type)) {
      this.counters.unsupportedControls++;
      frame.fill ??= "#E5E7EBFF";
      return true;
    }
    if (type === "button" || type === "submit" || type === "reset" || tag === "select") {
      const label = tag === "select" ? ((el as unknown as HTMLSelectElement).selectedOptions?.[0]?.textContent ?? "") : el.value || (type === "submit" ? "Submit" : type === "reset" ? "Reset" : "");
      if (label.trim()) {
        this.nodes++;
        const style = this.textStyle(el, cs, lineHeight);
        if (tag !== "select") style.align = "center";
        const text: CaptureText = { kind: "text", text: label.trim(), style, box: [box[0], round2(box[1] + (box[3] - lineHeight) / 2), box[2], round2(lineHeight)], name: textName(label.trim()), nameRank: 1, wraps: true, maxLines: 1 };
        frame.children = [text];
      }
      if (frame.nameRank! < 2) frame.name = tag === "select" ? "Picker" : `${label.trim().slice(0, 32) || "Form"} Button`;
      return true;
    }
    this.nodes++;
    const multiline = tag === "textarea";
    const placeholderCs = getComputedStyle(el, "::placeholder");
    const input: CaptureInput = {
      kind: "input",
      value: el.value ?? "",
      style: this.textStyle(el, cs, lineHeight),
      box: multiline ? box : [box[0], round2(box[1] + (box[3] - lineHeight) / 2), box[2], round2(lineHeight)],
      name: frame.nameRank! >= 2 ? frame.name! : el.placeholder?.trim() ? `${el.placeholder.trim().slice(0, 40)} Field` : multiline ? "Text Area" : "Text Field",
      nameRank: 2,
    };
    if (el.placeholder) input.placeholder = el.placeholder;
    const placeholderColor = this.toColor(placeholderCs.color);
    if (placeholderColor) input.placeholderColor = placeholderColor;
    if (multiline) input.multiline = true;
    if (type === "password") input.secure = true;
    const keyboard = ({ number: "number", email: "email", url: "url", tel: "phone" } as Record<string, CaptureInput["keyboard"]>)[type];
    if (keyboard) input.keyboard = keyboard;
    frame.children = [input];
    frame.keep = true;
    // The field keeps the element's name; its box gets another ("Email Input Group", not "Email Input Input").
    const suffix = multiline ? " Box" : " Input";
    const base = input.name!.replace(/ Field$/, "");
    frame.name = base.endsWith(suffix) ? `${base} Group` : base + suffix;
    frame.nameRank = Math.max(frame.nameRank ?? 0, 2);
    return true;
  }

  /** A key into `images` for a URL, embedding bytes that must be read in the page. */
  imageKey(raw: string, info: { width?: number; height?: number; name?: string }): string | null {
    let url: string;
    try {
      url = raw.startsWith("data:") ? raw : new URL(raw, document.baseURI).href;
    } catch {
      return null;
    }
    if (!/^(?:https?|data|blob):/i.test(url)) return null;
    const existing = this.imageKeys.get(url);
    if (existing) return existing;
    const key = `img${this.imageKeys.size + 1}`;
    this.imageKeys.set(url, key);
    const source: CaptureImageSource = { url };
    if (info.width) source.width = info.width;
    if (info.height) source.height = info.height;
    if (info.name) source.name = info.name.slice(0, 80);
    this.images[key] = source;
    const mode = this.options.inlineImages ?? "local";
    const sameOrigin = (() => {
      try {
        return new URL(url).origin === location.origin && location.origin !== "null";
      } catch {
        return false;
      }
    })();
    if (url.startsWith("blob:") || (url.startsWith("http") && (mode === "all" || (mode === "local" && sameOrigin)))) {
      this.pending.push(
        readAsDataUrl(url).then((data) => {
          if (data) {
            source.url = data.url;
            source.mime = data.mime;
          }
        }),
      );
    } else if (url.startsWith("data:")) {
      const mime = /^data:([^;,]+)/.exec(url)?.[1];
      if (mime) source.mime = mime;
    }
    return key;
  }
}

async function readAsDataUrl(url: string): Promise<{ url: string; mime: string } | null> {
  try {
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) return null;
    const blob = await response.blob();
    if (blob.size > 25 * 1024 * 1024) return null;
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    return { url: data, mime: blob.type };
  } catch {
    return null;
  }
}

/** Distinct line tops among a text range's rects. */
function lineClusters(rects: DOMRect[]): number[] {
  const tops: number[] = [];
  for (const r of [...rects].sort((a, b) => a.top - b.top)) {
    const last = tops[tops.length - 1];
    if (last === undefined || r.top > last + Math.max(2, r.height * 0.5)) tops.push(r.top);
  }
  return tops;
}

/** The frame draws something of its own, so finish() keeps it. */
function paints(frame: CaptureFrame): boolean {
  return !!(frame.fill || frame.gradients?.length || frame.backgroundImage || frame.border || frame.shadows?.length || frame.backgroundBlur || frame.blur || frame.blendMode);
}

/** `el` holds all of `text` (whitespace aside), so its name can stand for that text. */
function holdsAll(el: Element, text: string): boolean {
  return (el.textContent ?? "").replace(/\s+/g, "") === text.replace(/\s+/g, "");
}

function contains(outer: Box, inner: Box): boolean {
  return inner[0] >= outer[0] - 0.5 && inner[1] >= outer[1] - 0.5 && inner[0] + inner[2] <= outer[0] + outer[2] + 0.5 && inner[1] + inner[3] <= outer[1] + outer[3] + 0.5;
}

function sameBox(a: Box, b: Box): boolean {
  return Math.abs(a[0] - b[0]) < 1 && Math.abs(a[1] - b[1]) < 1 && Math.abs(a[2] - b[2]) < 1 && Math.abs(a[3] - b[3]) < 1;
}

function textName(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > 40 ? `${oneLine.slice(0, 39).trimEnd()}…` : oneLine;
}

function fileStem(url: string): string {
  if (url.startsWith("data:")) return "image";
  try {
    const last = new URL(url, document.baseURI).pathname.split("/").filter(Boolean).pop() ?? "image";
    return decodeURIComponent(last).replace(/\.[A-Za-z0-9]{1,5}$/, "").slice(0, 60) || "image";
  } catch {
    return "image";
  }
}

function utf8Base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * SF Symbol placeholders no host drew or sized get a 1em square, so the layout keeps their place (an
 * empty <svg> would be 300×150). CSS sizes still win over these attributes.
 */
function sizeUndrawnSymbols(): void {
  for (const el of document.querySelectorAll("svg[data-sf-symbol]:not([data-sf-drawn]):not([data-sf-placeholder])")) {
    const size = String(parseFloat(getComputedStyle(el).fontSize) || 17);
    if (!el.hasAttribute("width")) el.setAttribute("width", size);
    if (!el.hasAttribute("height")) el.setAttribute("height", size);
  }
}

/** Capture the current page (or `options.selector`) once it has settled. */
export async function captureDom(options: WalkOptions = {}): Promise<DesignCapture> {
  await waitForPage(options);
  sizeUndrawnSymbols();
  return new Walker(options).run();
}
