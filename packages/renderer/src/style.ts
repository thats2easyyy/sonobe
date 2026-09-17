/**
 * Minimal-write style and attribute setters. Each element remembers what the renderer
 * last wrote, so an unchanged frame costs string comparisons and zero DOM writes.
 */

export interface WriteStats {
  styleWrites: number;
  attrWrites: number;
}

const styleCache = new WeakMap<Element, Map<string, string>>();
const attrCache = new WeakMap<Element, Map<string, string | null>>();

/** Sets a CSS property (kebab-case, custom properties allowed). An empty value removes it. */
export function setStyle(el: HTMLElement | SVGElement, name: string, value: string, stats: WriteStats): void {
  let cache = styleCache.get(el);
  if (!cache) {
    cache = new Map();
    styleCache.set(el, cache);
  }
  const prev = cache.get(name) ?? "";
  if (prev === value) return;
  cache.set(name, value);
  stats.styleWrites++;
  if (value === "") el.style.removeProperty(name);
  else el.style.setProperty(name, value);
}

/** Sets an attribute; null removes it. */
export function setAttr(el: Element, name: string, value: string | null, stats: WriteStats): void {
  let cache = attrCache.get(el);
  if (!cache) {
    cache = new Map();
    attrCache.set(el, cache);
  }
  const prev = cache.has(name) ? cache.get(name)! : null;
  if (prev === value) return;
  cache.set(name, value);
  stats.attrWrites++;
  if (value === null) el.removeAttribute(name);
  else el.setAttribute(name, value);
}

/** The value the renderer last wrote for a property ("" when unset). Useful in tests and devtools. */
export function writtenStyle(el: Element, name: string): string {
  return styleCache.get(el)?.get(name) ?? "";
}
