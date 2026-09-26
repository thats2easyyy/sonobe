import { Eraser, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useDocument, useEditorSession, useRuntimeState } from "../../state/EditorProvider.tsx";
import { isPatchImplemented } from "../../state/registry.ts";
import { Badge } from "../../ui/Badge.tsx";
import { Button } from "../../ui/Button.tsx";
import { Tooltip } from "../../ui/Tooltip.tsx";
import { usePerfSamples } from "./hooks.ts";
import { itemDisplayName } from "./itemNames.ts";
import { documentStats, formatMs, frameBudgetShare, patchTimingsOf, sceneStats, smoothness, summarizeSamples, type PatchTiming, type SceneStats } from "./perfModel.ts";
import { revealItems } from "./reveal.ts";
import { SampleChart } from "./SampleChart.tsx";

const CAPACITY = 120;
const SAMPLE_MS = 500;

function Sub({ children }: { children: string }) {
  return (
    <Tooltip content={children} placement="top-start">
      <span className="sb-perfx__sub">{children}</span>
    </Tooltip>
  );
}

export interface PerformanceViewProps {
  /** False while another tab is showing: patch timings and the scene poll stop, the chart history keeps filling. */
  active?: boolean;
}

/** Performance tab: frame rate and frame time over the last minute, document and scene counts, and slow patches when the runtime reports them. */
export function PerformanceView({ active = true }: PerformanceViewProps = {}) {
  const session = useEditorSession();
  const { samples, reset } = usePerfSamples({ capacity: CAPACITY, intervalMs: SAMPLE_MS });
  const playing = useRuntimeState((s) => s.playing);
  const frame = useRuntimeState((s) => s.frame);
  const time = useRuntimeState((s) => s.time);
  const doc = useDocument((s) => s.doc);
  const stats = useMemo(() => (active ? documentStats(doc, (type) => isPatchImplemented(session.registry, type), session.registry) : null), [active, doc, session.registry]);
  const [scene, setScene] = useState<SceneStats>(() => sceneStats(session.runtime.scene()));
  const [timings, setTimings] = useState<PatchTiming[] | null>(() => patchTimingsOf(session.runtime.runtime));

  // Patch timings are only collected while this tab is showing.
  useEffect(() => (active && typeof session.runtime.profilePatches === "function" ? session.runtime.profilePatches() : undefined), [session, active]);

  useEffect(() => {
    if (!active) return;
    const read = () => {
      setScene(sceneStats(session.runtime.scene()));
      setTimings(patchTimingsOf(session.runtime.runtime));
    };
    read();
    const timer = setInterval(read, 1000);
    return () => clearInterval(timer);
  }, [session, active]);

  const summary = summarizeSamples(samples);
  const status = smoothness(summary.fps.latest, playing);
  const fpsValues = useMemo(() => samples.map((s) => (s.playing && s.fps > 0 ? s.fps : null)), [samples]);
  const msValues = useMemo(() => samples.map((s) => (s.playing ? s.frameMs : null)), [samples]);
  const msMax = Math.max(16.7, ...samples.map((s) => s.frameMs));
  const budgetMs = 1000 / (doc.project.fps ?? 60);
  const budget = frameBudgetShare(summary.frameMs.avg, doc.project.fps ?? 60);
  const fpsMin = Math.max(0, Math.min(30, Math.floor(Math.min(...fpsValues.map((v) => v ?? Infinity)) - 5)));

  if (!active || !stats) return null;

  return (
    <div className="sb-hudview">
      <div className="sb-hudview__scroll sb-perfx__scroll sb-scroll">
        <div className="sb-perfx">
          <section className="sb-perfx__charts" aria-label="Frame rate">
            <div className="sb-perfx__headline">
              <span className="sb-perfx__fps sb-tabular">{playing ? Math.round(summary.fps.latest) : "–"}</span>
              <span className="sb-perfx__unit">fps</span>
              <Badge tone={status.tone} dot>
                {status.label}
              </Badge>
              <span className="sb-hudview__spacer" />
              <Button size="sm" variant="ghost" icon={<Eraser size={12} />} onClick={reset}>
                Clear chart
              </Button>
            </div>
            <div className="sb-perfx__chart">
              <div className="sb-perfx__chart-title">Frame rate</div>
              <SampleChart
                values={fpsValues}
                capacity={CAPACITY}
                min={fpsMin}
                max={Math.max(62, ...fpsValues.map((v) => v ?? 0))}
                target={{ value: 60, label: "60" }}
                format={(v) => `${Math.round(v)} fps`}
                label={summary.playingSamples ? `Frame rate over the last minute: average ${Math.round(summary.fps.avg)} fps, lowest ${Math.round(summary.fps.min)} fps` : "Frame rate: the prototype is paused"}
                sampleMs={SAMPLE_MS}
                height={48}
                {...(status.tone === "warn" || status.tone === "danger" ? { tone: status.tone } : {})}
              />
            </div>
            <div className="sb-perfx__chart">
              <div className="sb-perfx__chart-title">Frame time</div>
              <SampleChart
                values={msValues}
                capacity={CAPACITY}
                min={0}
                max={msMax}
                target={{ value: budgetMs, label: `budget ${formatMs(budgetMs)}` }}
                format={formatMs}
                label={`Frame time: average ${formatMs(summary.frameMs.avg)}, slowest ${formatMs(summary.frameMs.max)}`}
                sampleMs={SAMPLE_MS}
                height={48}
                {...(budget > 1 ? { tone: "danger" as const } : budget > 0.8 ? { tone: "warn" as const } : {})}
              />
            </div>
          </section>

          <dl className="sb-perfx__stats">
            <div className="sb-perfx__stat">
              <dt>Latest frame</dt>
              <dd className="sb-tabular">
                {formatMs(summary.frameMs.latest)}
                <Sub>{`avg ${formatMs(summary.frameMs.avg)} · max ${formatMs(summary.frameMs.max)}`}</Sub>
              </dd>
            </div>
            <div className="sb-perfx__stat">
              <dt>Frame budget used</dt>
              <dd className="sb-tabular" data-tone={budget > 0.8 ? "warn" : undefined}>
                {Math.round(budget * 100)}%
                <Sub>{`of ${formatMs(budgetMs)}`}</Sub>
              </dd>
            </div>
            <div className="sb-perfx__stat">
              <dt>Dropped</dt>
              <dd className="sb-tabular">
                {summary.slowSamples}
                <Sub>{`slow samples in the last ${Math.round((samples.length * SAMPLE_MS) / 1000)}s`}</Sub>
              </dd>
            </div>
            <div className="sb-perfx__stat">
              <dt>Patches</dt>
              <dd className="sb-tabular">
                {stats.patches}
                <Sub>{`in ${stats.components} ${stats.components === 1 ? "component" : "components"}`}</Sub>
              </dd>
            </div>
            <div className="sb-perfx__stat">
              <dt>Layers drawn</dt>
              <dd className="sb-tabular">
                {scene.visible}
                <Sub>{`of ${scene.nodes} in the scene`}</Sub>
              </dd>
            </div>
            {scene.loopInstances > 0 && (
              <div className="sb-perfx__stat">
                <dt>Loop instances</dt>
                <dd className="sb-tabular">
                  {scene.loopInstances}
                  {scene.replicated.length > 0 && <Sub>{scene.replicated.slice(0, 3).map((r) => `${itemDisplayName(doc, doc.project.root, r.layerId, session.registry)} ×${r.count}`).join(" · ")}</Sub>}
                </dd>
              </div>
            )}
            <div className="sb-perfx__stat">
              <dt>Running</dt>
              <dd className="sb-tabular">
                {time.toFixed(1)}s<Sub>{`frame ${Math.max(0, frame).toLocaleString()}`}</Sub>
              </dd>
            </div>
            {stats.unimplemented.length > 0 && (
              <div className="sb-perfx__stat" data-wide>
                <dt>
                  <TriangleAlert size={11} strokeWidth={2} aria-hidden /> Not implemented yet
                </dt>
                <dd>
                  <span className="sb-perfx__sub" data-plain>
                    {stats.unimplemented.map((u) => `${session.registry.patches.get(u.type)?.name ?? u.type}${u.count > 1 ? ` ×${u.count}` : ""}`).join(", ")} output default values.
                  </span>
                </dd>
              </div>
            )}
          </dl>
          {timings && timings.length > 0 && (
            <section className="sb-perfx__slowest" aria-label="Slowest patches">
              <h3 className="sb-perfx__heading">Slowest patches</h3>
              <ol className="sb-perfx__slow">
                {timings.map((t) => (
                  <li key={`${t.componentPath ?? ""}/${t.patchId}`}>
                    <Tooltip content={itemDisplayName(doc, doc.project.root, t.patchId, session.registry)} placement="top-start">
                      <button type="button" onClick={() => revealItems(session, doc.project.root, [t.patchId])}>
                        {itemDisplayName(doc, doc.project.root, t.patchId, session.registry)}
                      </button>
                    </Tooltip>
                    <span className="sb-tabular">{formatMs(t.ms)}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
