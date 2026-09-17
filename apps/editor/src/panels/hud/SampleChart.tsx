import { useMemo, useState, type PointerEvent } from "react";

export interface SampleChartProps {
  /** Oldest first; null leaves a gap (paused). */
  values: readonly (number | null)[];
  /** Slots across the chart; new samples enter from the right. */
  capacity: number;
  min: number;
  max: number;
  /** A reference line (e.g. 60 fps). */
  target?: { value: number; label: string };
  format: (value: number) => string;
  /** Accessible summary. */
  label: string;
  sampleMs: number;
  height?: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** One-series sparkline with a reference line and a crosshair tooltip. */
export function SampleChart({ values, capacity, min, max, target, format, label, sampleMs, height = 64 }: SampleChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 100;
  const offset = Math.max(0, capacity - values.length);
  const x = (i: number) => ((offset + i) / Math.max(1, capacity - 1)) * width;
  const y = (v: number) => height - ((clamp(v, min, max) - min) / Math.max(1e-9, max - min)) * (height - 4) - 2;

  const { line, area } = useMemo(() => {
    let linePath = "";
    let areaPath = "";
    let segment: [number, number][] = [];
    const flush = () => {
      if (segment.length === 0) return;
      const d = segment.map(([px, py], i) => `${i === 0 ? "M" : "L"}${px.toFixed(2)} ${py.toFixed(2)}`).join(" ");
      linePath += `${d} `;
      areaPath += `${d} L${segment.at(-1)![0].toFixed(2)} ${height} L${segment[0]![0].toFixed(2)} ${height} Z `;
      segment = [];
    };
    values.forEach((v, i) => {
      if (v === null) flush();
      else segment.push([x(i), y(v)]);
    });
    flush();
    return { line: linePath.trim(), area: areaPath.trim() };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, capacity, min, max, height]);

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    const index = Math.round(ratio * (capacity - 1)) - offset;
    setHover(index >= 0 && index < values.length ? index : null);
  };

  const hovered = hover !== null ? values[hover] : undefined;
  const left = hover !== null ? (x(hover) / width) * 100 : 0;
  const secondsAgo = hover !== null ? ((values.length - 1 - hover) * sampleMs) / 1000 : 0;

  return (
    <div className="sb-perfchart" style={{ height }} role="img" aria-label={label} onPointerMove={onPointerMove} onPointerLeave={() => setHover(null)}>
      <svg className="sb-perfchart__svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden>
        {target && <line className="sb-perfchart__target" x1={0} x2={width} y1={y(target.value)} y2={y(target.value)} vectorEffect="non-scaling-stroke" />}
        {area && <path className="sb-perfchart__area" d={area} />}
        {line && <path className="sb-perfchart__line" d={line} vectorEffect="non-scaling-stroke" />}
        {hover !== null && <line className="sb-perfchart__crosshair" x1={x(hover)} x2={x(hover)} y1={0} y2={height} vectorEffect="non-scaling-stroke" />}
      </svg>
      {target && (
        <span className="sb-perfchart__target-label" style={{ top: y(target.value) }}>
          {target.label}
        </span>
      )}
      {hover !== null && hovered !== undefined && hovered !== null && <span className="sb-perfchart__dot" style={{ left: `${left}%`, top: y(hovered) }} />}
      {hover !== null && hovered !== undefined && (
        <span className="sb-perfchart__tip" data-side={left > 70 ? "left" : "right"} style={{ left: `${left}%` }}>
          <strong className="sb-tabular">{hovered === null ? "Paused" : format(hovered)}</strong>
          <span>{secondsAgo < 0.5 ? "now" : `${secondsAgo.toFixed(secondsAgo < 10 ? 1 : 0)}s ago`}</span>
        </span>
      )}
    </div>
  );
}
