/**
 * Smooth-corner ("squircle") rectangles as SVG path data, following the construction in
 * Figma's "Desperately seeking squircles": each corner is a circular arc shortened by the
 * smoothing amount and blended into the edges with two cubic Béziers.
 */

export type CornerRadii = readonly [number, number, number, number]; // topLeft, topRight, bottomRight, bottomLeft

interface CornerParams {
  a: number;
  b: number;
  c: number;
  d: number;
  p: number;
  arc: number;
  radius: number;
}

const rad = (deg: number) => (deg * Math.PI) / 180;

function cornerParams(radius: number, smoothing: number, budget: number): CornerParams {
  if (radius <= 0 || budget <= 0) return { a: 0, b: 0, c: 0, d: 0, p: 0, arc: 0, radius: 0 };
  radius = Math.min(radius, budget);
  // Not enough room for the full smoothing extent: reduce smoothing instead of distorting the curve.
  const s = Math.max(0, Math.min(smoothing, budget / radius - 1));
  const p = Math.min((1 + s) * radius, budget);
  const arcMeasure = 90 * (1 - s);
  const arc = Math.sin(rad(arcMeasure / 2)) * radius * Math.SQRT2;
  const alpha = (90 - arcMeasure) / 2;
  const p3ToP4 = radius * Math.tan(rad(alpha / 2));
  const beta = 45 * s;
  const c = p3ToP4 * Math.cos(rad(beta));
  const d = c * Math.tan(rad(beta));
  const b = (p - arc - c - d) / 3;
  const a = 2 * b;
  return { a, b, c, d, p, arc, radius };
}

const n = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? "0" : String(r);
};

/** Room each corner may use, shared with its neighbours in proportion to their radii. */
function budgets(w: number, h: number, r: CornerRadii): [number, number, number, number] {
  const share = (len: number, self: number, other: number) => (self + other > 0 ? (len * self) / (self + other) : len / 2);
  const [tl, tr, br, bl] = r;
  return [
    Math.min(share(w, tl, tr), share(h, tl, bl)),
    Math.min(share(w, tr, tl), share(h, tr, br)),
    Math.min(share(w, br, bl), share(h, br, tr)),
    Math.min(share(w, bl, br), share(h, bl, tl)),
  ];
}

/**
 * Path data for a rectangle at (x, y) with size w × h, per-corner radii, and smoothing 0..1.
 * Smoothing 0 yields plain circular corners.
 */
export function squirclePath(x: number, y: number, w: number, h: number, radii: CornerRadii, smoothing: number): string {
  w = Math.max(0, w);
  h = Math.max(0, h);
  const s = Math.max(0, Math.min(1, smoothing));
  const clamped = radii.map((v) => Math.max(0, v)) as unknown as CornerRadii;
  const bud = budgets(w, h, clamped);
  const tl = cornerParams(clamped[0], s, bud[0]);
  const tr = cornerParams(clamped[1], s, bud[1]);
  const br = cornerParams(clamped[2], s, bud[2]);
  const bl = cornerParams(clamped[3], s, bud[3]);

  const corner = (q: CornerParams, dir: 0 | 1 | 2 | 3): string => {
    if (q.radius <= 0) {
      const l = [`l ${n(q.p)} 0`, `l 0 ${n(q.p)}`, `l ${n(-q.p)} 0`, `l 0 ${n(-q.p)}`];
      return l[dir]!;
    }
    const { a, b, c, d, arc, radius: r } = q;
    const abc = a + b + c;
    switch (dir) {
      case 0:
        return `c ${n(a)} 0 ${n(a + b)} 0 ${n(abc)} ${n(d)} a ${n(r)} ${n(r)} 0 0 1 ${n(arc)} ${n(arc)} c ${n(d)} ${n(c)} ${n(d)} ${n(b + c)} ${n(d)} ${n(abc)}`;
      case 1:
        return `c 0 ${n(a)} 0 ${n(a + b)} ${n(-d)} ${n(abc)} a ${n(r)} ${n(r)} 0 0 1 ${n(-arc)} ${n(arc)} c ${n(-c)} ${n(d)} ${n(-(b + c))} ${n(d)} ${n(-abc)} ${n(d)}`;
      case 2:
        return `c ${n(-a)} 0 ${n(-(a + b))} 0 ${n(-abc)} ${n(-d)} a ${n(r)} ${n(r)} 0 0 1 ${n(-arc)} ${n(-arc)} c ${n(-d)} ${n(-c)} ${n(-d)} ${n(-(b + c))} ${n(-d)} ${n(-abc)}`;
      default:
        return `c 0 ${n(-a)} 0 ${n(-(a + b))} ${n(d)} ${n(-abc)} a ${n(r)} ${n(r)} 0 0 1 ${n(arc)} ${n(-arc)} c ${n(c)} ${n(-d)} ${n(b + c)} ${n(-d)} ${n(abc)} ${n(-d)}`;
    }
  };

  return [
    `M ${n(x + w - tr.p)} ${n(y)}`,
    corner(tr, 0),
    `L ${n(x + w)} ${n(y + h - br.p)}`,
    corner(br, 1),
    `L ${n(x + bl.p)} ${n(y + h)}`,
    corner(bl, 2),
    `L ${n(x)} ${n(y + tl.p)}`,
    corner(tl, 3),
    `L ${n(x + w - tr.p)} ${n(y)} Z`,
  ].join(" ");
}
