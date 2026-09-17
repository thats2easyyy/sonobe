/**
 * Spectral residual saliency on a 64 × 64 luma grid: Object Detection's region finder. Deterministic
 * for the same pixels on every host.
 */

/** Grid cells per side. */
export const SALIENCY_GRID = 64;

const N = SALIENCY_GRID;
const CELLS = N * N;

export interface PixelsLike {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

/** [x, y, w, h] in picture pixels. */
export type Region = [number, number, number, number];

/** For each target cell along an axis of `size` source pixels, the covered source pixels and their weights. */
function axisWeights(size: number): [number, number][][] {
  const out: [number, number][][] = [];
  const cell = size / N;
  for (let c = 0; c < N; c++) {
    const start = c * cell;
    const end = (c + 1) * cell;
    const list: [number, number][] = [];
    for (let x = Math.floor(start); x < Math.min(size, Math.ceil(end)); x++) {
      const overlap = Math.min(end, x + 1) - Math.max(start, x);
      if (overlap > 0) list.push([x, overlap / cell]);
    }
    out.push(list);
  }
  return out;
}

/** Area-average RGBA pixels into a 64 × 64 luma grid in 0–1, composited onto black. */
export function grayGrid(px: PixelsLike): Float64Array {
  const grid = new Float64Array(CELLS);
  const w = Math.floor(Number(px.width) || 0);
  const h = Math.floor(Number(px.height) || 0);
  if (w <= 0 || h <= 0 || !px.data || px.data.length < w * h * 4) return grid;
  const xs = axisWeights(w);
  const ys = axisWeights(h);
  const d = px.data;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      let sum = 0;
      for (const [y, wy] of ys[r]!) {
        for (const [x, wx] of xs[c]!) {
          const i = (y * w + x) * 4;
          const luma = 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
          sum += ((luma * d[i + 3]!) / 65025) * wx * wy;
        }
      }
      grid[r * N + c] = sum;
    }
  }
  return grid;
}

/** In-place radix-2 FFT of one line; the inverse divides by the length. */
function fft1d(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]!;
      re[i] = re[j]!;
      re[j] = t;
      t = im[i]!;
      im[i] = im[j]!;
      im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = ((2 * Math.PI) / len) * (inverse ? -1 : 1);
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const vr = re[b]! * cr - im[b]! * ci;
        const vi = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - vr;
        im[b] = im[a]! - vi;
        re[a] = re[a]! + vr;
        im[a] = im[a]! + vi;
        const next = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = next;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] = re[i]! / n;
      im[i] = im[i]! / n;
    }
  }
}

/** In-place 2D FFT of an N × N grid (rows, then columns). */
function fft2d(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const lr = new Float64Array(N);
  const li = new Float64Array(N);
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      lr[c] = re[r * N + c]!;
      li[c] = im[r * N + c]!;
    }
    fft1d(lr, li, inverse);
    for (let c = 0; c < N; c++) {
      re[r * N + c] = lr[c]!;
      im[r * N + c] = li[c]!;
    }
  }
  for (let c = 0; c < N; c++) {
    for (let r = 0; r < N; r++) {
      lr[r] = re[r * N + c]!;
      li[r] = im[r * N + c]!;
    }
    fft1d(lr, li, inverse);
    for (let r = 0; r < N; r++) {
      re[r * N + c] = lr[r]!;
      im[r * N + c] = li[r]!;
    }
  }
}

const wrap = (i: number) => (i + N) % N;
const clampCell = (i: number) => (i < 0 ? 0 : i >= N ? N - 1 : i);

/** Separable Gaussian blur (σ = 2 cells, radius 6) with clamped edges. */
function gaussianBlur(values: Float64Array): Float64Array {
  const sigma = 2;
  const radius = 6;
  const kernel: number[] = [];
  let total = 0;
  for (let i = -radius; i <= radius; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel.push(w);
    total += w;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i]! /= total;
  const tmp = new Float64Array(CELLS);
  const out = new Float64Array(CELLS);
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += kernel[k + radius]! * values[r * N + clampCell(c + k)]!;
      tmp[r * N + c] = sum;
    }
  }
  for (let c = 0; c < N; c++) {
    for (let r = 0; r < N; r++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += kernel[k + radius]! * tmp[clampCell(r + k) * N + c]!;
      out[r * N + c] = sum;
    }
  }
  return out;
}

/**
 * The saliency map S of a 64 × 64 grid, normalized to a maximum of 1. A flat picture (no variation)
 * gives all zeros.
 */
export function saliencyMap(grid: Float64Array): Float64Array {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < CELLS; i++) {
    const v = grid[i]!;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!(max - min > 1e-9)) return new Float64Array(CELLS);
  const re = Float64Array.from(grid);
  const im = new Float64Array(CELLS);
  fft2d(re, im, false);
  const logAmplitude = new Float64Array(CELLS);
  const phase = new Float64Array(CELLS);
  for (let i = 0; i < CELLS; i++) {
    logAmplitude[i] = Math.log(Math.hypot(re[i]!, im[i]!) + 1e-9);
    phase[i] = Math.atan2(im[i]!, re[i]!);
  }
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      let sum = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) sum += logAmplitude[wrap(r + dr) * N + wrap(c + dc)]!;
      const residual = logAmplitude[r * N + c]! - sum / 9;
      const e = Math.exp(residual);
      re[r * N + c] = e * Math.cos(phase[r * N + c]!);
      im[r * N + c] = e * Math.sin(phase[r * N + c]!);
    }
  }
  fft2d(re, im, true);
  const s = new Float64Array(CELLS);
  for (let i = 0; i < CELLS; i++) s[i] = re[i]! * re[i]! + im[i]! * im[i]!;
  const blurred = gaussianBlur(s);
  let peak = 0;
  for (let i = 0; i < CELLS; i++) if (blurred[i]! > peak) peak = blurred[i]!;
  if (!(peak > 0)) return new Float64Array(CELLS);
  for (let i = 0; i < CELLS; i++) blurred[i] = blurred[i]! / peak;
  return blurred;
}

/**
 * Regions of a saliency map in picture pixels. Objects: up to three 8-connected components of at
 * least 16 cells, largest summed saliency first. Attention: the bounding box of every salient cell,
 * or the whole picture when nothing stands out. Zero-size content gives no regions.
 */
export function saliencyRegions(map: Float64Array, mode: "objects" | "attention", contentSize: readonly [number, number]): Region[] {
  const [cw, ch] = contentSize;
  if (!(Number.isFinite(cw) && Number.isFinite(ch) && cw > 0 && ch > 0)) return [];
  let max = 0;
  let total = 0;
  for (let i = 0; i < CELLS; i++) {
    const v = map[i]!;
    total += v;
    if (v > max) max = v;
  }
  const threshold = Math.min(1, (3 * total) / CELLS);
  const mask = new Uint8Array(CELLS);
  if (max > 0) for (let i = 0; i < CELLS; i++) mask[i] = map[i]! >= threshold ? 1 : 0;
  const toPixels = (c0: number, r0: number, c1: number, r1: number): Region => [(c0 * cw) / N, (r0 * ch) / N, ((c1 - c0 + 1) * cw) / N, ((r1 - r0 + 1) * ch) / N];

  if (mode === "attention") {
    let c0 = N;
    let r0 = N;
    let c1 = -1;
    let r1 = -1;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (!mask[r * N + c]) continue;
        c0 = Math.min(c0, c);
        r0 = Math.min(r0, r);
        c1 = Math.max(c1, c);
        r1 = Math.max(r1, r);
      }
    }
    return c1 < 0 ? [toPixels(0, 0, N - 1, N - 1)] : [toPixels(c0, r0, c1, r1)];
  }

  const label = new Int32Array(CELLS).fill(-1);
  const components: { cells: number; sum: number; box: [number, number, number, number] }[] = [];
  const queue = new Int32Array(CELLS);
  for (let start = 0; start < CELLS; start++) {
    if (!mask[start] || label[start]! >= 0) continue;
    const id = components.length;
    const component = { cells: 0, sum: 0, box: [N, N, -1, -1] as [number, number, number, number] };
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    label[start] = id;
    while (head < tail) {
      const cell = queue[head++]!;
      const r = Math.floor(cell / N);
      const c = cell % N;
      component.cells++;
      component.sum += map[cell]!;
      component.box[0] = Math.min(component.box[0], c);
      component.box[1] = Math.min(component.box[1], r);
      component.box[2] = Math.max(component.box[2], c);
      component.box[3] = Math.max(component.box[3], r);
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue;
          const next = nr * N + nc;
          if (mask[next] && label[next]! < 0) {
            label[next] = id;
            queue[tail++] = next;
          }
        }
      }
    }
    components.push(component);
  }
  return components
    .filter((comp) => comp.cells >= 16)
    .sort((a, b) => b.sum - a.sum)
    .slice(0, 3)
    .map((comp) => toPixels(comp.box[0], comp.box[1], comp.box[2], comp.box[3]));
}
