/**
 * Bounds registry: panels register where their surfaces are on screen, so the desktop MCP bridge
 * can screenshot them. The canvas registers "canvas.bounds", the patch editor "graph.bounds", and
 * the viewer "viewer.layerBounds" ({ layerId, key? }). Rects are viewport CSS pixels; `scale` is CSS
 * pixels per point (canvas or graph zoom, viewer scale). The RPC handlers expose each method only
 * while a provider exists, so the desktop can tell what's capturable.
 *
 * ```ts
 * useEffect(() => session.bounds.register("canvas.bounds", () => rectOfElement(ref.current, viewport.zoom)), [session, viewport.zoom]);
 * ```
 */

export type BoundsMethod = "canvas.bounds" | "graph.bounds" | "viewer.layerBounds";

export const BOUNDS_METHODS: readonly BoundsMethod[] = ["canvas.bounds", "graph.bounds", "viewer.layerBounds"];

export interface BoundsRect {
  x: number;
  y: number;
  width: number;
  height: number;
  /** CSS pixels per point of the content (zoom). */
  scale?: number;
}

/** Resolves the rect, or null when there's nothing on screen to capture. */
export type BoundsProvider = (params: Record<string, unknown>) => BoundsRect | null | undefined | Promise<BoundsRect | null | undefined>;

export interface BoundsRegisterOptions {
  /** A default that any non-fallback provider overrides (e.g. the runtime's own layer bounds). */
  fallback?: boolean;
}

export interface BoundsRegistry {
  /** Register a provider; the newest one answers. Returns unregister. */
  register(method: BoundsMethod, provider: BoundsProvider, options?: BoundsRegisterOptions): () => void;
  /** The provider that currently answers `method`. */
  get(method: BoundsMethod): BoundsProvider | undefined;
  /** Methods with at least one provider. */
  methods(): BoundsMethod[];
  /** Called when providers are added or removed. */
  subscribe(cb: () => void): () => void;
  /** Ask the current provider; null when there's none or it has nothing to show. */
  measure(method: BoundsMethod, params?: Record<string, unknown>): Promise<BoundsRect | null>;
}

export const isBoundsMethod = (value: unknown): value is BoundsMethod => typeof value === "string" && (BOUNDS_METHODS as readonly string[]).includes(value);

/** An element's viewport rect (null when detached or empty). */
export function rectOfElement(element: Element | null | undefined, scale?: number): BoundsRect | null {
  if (!element || !element.isConnected) return null;
  const r = element.getBoundingClientRect();
  if (!(r.width > 0) || !(r.height > 0)) return null;
  const rect: BoundsRect = { x: r.left, y: r.top, width: r.width, height: r.height };
  if (scale !== undefined && Number.isFinite(scale) && scale > 0) rect.scale = scale;
  return rect;
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

function normalizeRect(value: unknown): BoundsRect | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<BoundsRect>;
  if (!finite(v.x) || !finite(v.y) || !finite(v.width) || !finite(v.height)) return null;
  const rect: BoundsRect = { x: v.x, y: v.y, width: Math.max(0, v.width), height: Math.max(0, v.height) };
  if (finite(v.scale) && v.scale > 0) rect.scale = v.scale;
  return rect;
}

export function createBoundsRegistry(): BoundsRegistry {
  interface Entry {
    provider: BoundsProvider;
    fallback: boolean;
  }
  const providers = new Map<BoundsMethod, Entry[]>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const cb of [...listeners]) cb();
  };
  const get = (method: BoundsMethod) => {
    const list = providers.get(method);
    if (!list?.length) return undefined;
    return (list.findLast((e) => !e.fallback) ?? list.at(-1)!).provider;
  };
  return {
    register(method, provider, options = {}) {
      const entry: Entry = { provider, fallback: options.fallback === true };
      let list = providers.get(method);
      if (!list) providers.set(method, (list = []));
      const hadProvider = list.length > 0;
      list.push(entry);
      if (!hadProvider) notify();
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        const current = providers.get(method);
        const index = current?.indexOf(entry) ?? -1;
        if (!current || index < 0) return;
        current.splice(index, 1);
        if (current.length === 0) {
          providers.delete(method);
          notify();
        }
      };
    },
    get,
    methods: () => BOUNDS_METHODS.filter((m) => (providers.get(m)?.length ?? 0) > 0),
    subscribe(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    async measure(method, params = {}) {
      const provider = get(method);
      if (!provider) return null;
      return normalizeRect(await provider(params));
    },
  };
}
