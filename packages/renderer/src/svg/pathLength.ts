/**
 * Length of SVG path data, for trimming strokes by fraction (Stroke Start / Stroke End) without
 * relying on the `pathLength` attribute, which some rasterizers ignore. Curves and arcs are sampled.
 * DOM-free.
 */

const COMMANDS = "MmLlHhVvCcSsQqTtAaZz";
const PARAMS: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const SAMPLES = 24;

/** Tokenize path data into commands with their numbers (arc flags may be written without separators). */
function parse(d: string): { cmd: string; args: number[] }[] {
  const out: { cmd: string; args: number[] }[] = [];
  let i = 0;
  let current: { cmd: string; args: number[] } | null = null;
  const skip = () => {
    while (i < d.length && /[\s,]/.test(d[i]!)) i++;
  };
  while (i < d.length) {
    skip();
    if (i >= d.length) break;
    const ch = d[i]!;
    if (COMMANDS.includes(ch)) {
      current = { cmd: ch, args: [] };
      out.push(current);
      i++;
      continue;
    }
    if (!current) return out;
    const lower = current.cmd.toLowerCase();
    // Arc flags (the 4th and 5th parameter of each arc) are a single 0 or 1.
    const slot = PARAMS[lower]! > 0 ? current.args.length % PARAMS[lower]! : 0;
    if (lower === "a" && (slot === 3 || slot === 4) && (ch === "0" || ch === "1")) {
      current.args.push(ch === "1" ? 1 : 0);
      i++;
      continue;
    }
    const m = NUMBER.exec(d.slice(i));
    if (!m) return out;
    current.args.push(Number(m[0]));
    i += m[0].length;
  }
  return out;
}

const dist = (x0: number, y0: number, x1: number, y1: number) => Math.hypot(x1 - x0, y1 - y0);

function sampled(fn: (t: number) => [number, number]): number {
  let length = 0;
  let [px, py] = fn(0);
  for (let k = 1; k <= SAMPLES; k++) {
    const [x, y] = fn(k / SAMPLES);
    length += dist(px, py, x, y);
    px = x;
    py = y;
  }
  return length;
}

/** Arc length via the SVG endpoint → center parameterization (spec F.6.5), sampled. */
function arcLength(x0: number, y0: number, rx: number, ry: number, rotation: number, large: number, sweep: number, x1: number, y1: number): number {
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (rx === 0 || ry === 0) return dist(x0, y0, x1, y1);
  const phi = (rotation * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x0 - x1) / 2;
  const dy = (y0 - y1) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, den > 0 ? num / den : 0));
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const theta = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  else if (sweep && delta < 0) delta += 2 * Math.PI;
  const cx = cos * cxp - sin * cyp + (x0 + x1) / 2;
  const cy = sin * cxp + cos * cyp + (y0 + y1) / 2;
  return sampled((t) => {
    const a = theta + delta * t;
    return [cx + rx * Math.cos(a) * cos - ry * Math.sin(a) * sin, cy + rx * Math.cos(a) * sin + ry * Math.sin(a) * cos];
  });
}

/** Total length of path data in its own units; 0 for empty or unreadable data. */
export function pathDataLength(d: string): number {
  let length = 0;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let lastControl: [number, number] | null = null;
  let lastQuad: [number, number] | null = null;
  for (const { cmd, args } of parse(d)) {
    const lower = cmd.toLowerCase();
    const rel = cmd !== cmd.toUpperCase();
    const count = PARAMS[lower]!;
    if (lower === "z") {
      length += dist(x, y, startX, startY);
      x = startX;
      y = startY;
      lastControl = lastQuad = null;
      continue;
    }
    for (let k = 0; k + count <= args.length; k += count) {
      const a = args.slice(k, k + count);
      const ox = rel ? x : 0;
      const oy = rel ? y : 0;
      let control: [number, number] | null = null;
      let quad: [number, number] | null = null;
      switch (lower) {
        case "m": {
          const nx = a[0]! + ox;
          const ny = a[1]! + oy;
          if (k === 0) {
            startX = nx;
            startY = ny;
          } else {
            // Extra coordinate pairs after a moveto are linetos.
            length += dist(x, y, nx, ny);
          }
          x = nx;
          y = ny;
          break;
        }
        case "l": {
          const nx = a[0]! + ox;
          const ny = a[1]! + oy;
          length += dist(x, y, nx, ny);
          x = nx;
          y = ny;
          break;
        }
        case "h": {
          const nx = a[0]! + ox;
          length += Math.abs(nx - x);
          x = nx;
          break;
        }
        case "v": {
          const ny = a[0]! + oy;
          length += Math.abs(ny - y);
          y = ny;
          break;
        }
        case "c":
        case "s": {
          const [c1x, c1y]: [number, number] = lower === "c" ? [a[0]! + ox, a[1]! + oy] : lastControl ? [2 * x - lastControl[0], 2 * y - lastControl[1]] : [x, y];
          const rest = lower === "c" ? a.slice(2) : a;
          const c2x = rest[0]! + ox;
          const c2y = rest[1]! + oy;
          const ex = rest[2]! + ox;
          const ey = rest[3]! + oy;
          const x0 = x;
          const y0 = y;
          length += sampled((t) => {
            const u = 1 - t;
            return [u * u * u * x0 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * ex, u * u * u * y0 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * ey];
          });
          control = [c2x, c2y];
          x = ex;
          y = ey;
          break;
        }
        case "q":
        case "t": {
          let qx: number = x;
          let qy: number = y;
          if (lower === "q") {
            qx = a[0]! + ox;
            qy = a[1]! + oy;
          } else if (lastQuad) {
            qx = 2 * x - lastQuad[0];
            qy = 2 * y - lastQuad[1];
          }
          const rest = lower === "q" ? a.slice(2) : a;
          const ex = rest[0]! + ox;
          const ey = rest[1]! + oy;
          const x0 = x;
          const y0 = y;
          length += sampled((t) => {
            const u = 1 - t;
            return [u * u * x0 + 2 * u * t * qx + t * t * ex, u * u * y0 + 2 * u * t * qy + t * t * ey];
          });
          quad = [qx, qy];
          x = ex;
          y = ey;
          break;
        }
        case "a": {
          const ex = a[5]! + ox;
          const ey = a[6]! + oy;
          length += arcLength(x, y, a[0]!, a[1]!, a[2]!, a[3]!, a[4]!, ex, ey);
          x = ex;
          y = ey;
          break;
        }
      }
      lastControl = control;
      lastQuad = quad;
    }
  }
  return Number.isFinite(length) ? length : 0;
}
