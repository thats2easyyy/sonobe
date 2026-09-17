import { Pause, Play, RotateCcw, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useDocument, useEditorSession, useRuntimeState } from "../../state/EditorProvider.tsx";
import { isPatchImplemented } from "../../state/registry.ts";
import { Badge } from "../../ui/Badge.tsx";
import { Button } from "../../ui/Button.tsx";
import { usePerfSamples } from "./hooks.ts";
import { itemDisplayName } from "./itemNames.ts";
import { documentStats, formatMs, frameBudgetShare, patchTimingsOf, sceneStats, smoothness, summarizeSamples, type PatchTiming, type SceneStats } from "./perfModel.ts";
import { revealItems } from "./reveal.ts";
import { SampleChart } from "./SampleChart.tsx";

const CAPACITY = 120;
const SAMPLE_MS = 500;

/** Performance tab: frame rate and frame time over the last minute, document and scene counts, and slow patches when the runtime reports them. */
export function PerformanceView() {
  const session = useEditorSession();
  const { samples, reset } = usePerfSamples({ capacity: CAPACITY, intervalMs: SAMPLE_MS });
  const playing = useRuntimeState((s) => s.playing);
  const frame = useRuntimeState((s) => s.frame);
  const time = useRuntimeState((s) => s.time);
  const doc = useDocument((s) => s.doc);
  const stats = useMemo(() => documentStats(doc, (type) => isPatchImplemented(session.registry, type), session.registry), [doc, session.registry]);
  const [scene, setScene] = useState<SceneStats>(() => sceneStats(session.runtime.scene()));
  const [timings, setTimings] = useState<PatchTiming[] | null>(() => patchTimingsOf(session.runtime.runtime));

  useEffect(() => {
    const read = () => {
      setScene(sceneStats(session.runtime.scene()));
      setTimings(patchTimingsOf(session.runtime.runtime));
    };
    read();
    const timer = setInterval(read, 1000);
    return () => clearInterval(timer);
  }, [session]);

  const summary = summarizeSamples(samples);
  const status = smoothness(summary.fps.latest, playing);
  const fpsValues = useMemo(() => samples.map((s) => (s.playing && s.fps > 0 ? s.fps : null)), [samples]);
  const msValues = useMemo(() => samples.map((s) => (s.playing ? s.frameMs : null)), [samples]);
  const msMax = Math.max(16.7, ...samples.map((s) => s.frameMs));
  const budget = frameBudgetShare(summary.frameMs.avg, doc.project.fps ?? 60);

  return (
    <div className="sb-hudview">
      <div className="sb-hudview__scroll sb-scroll">
        <div className="sb-perfx">
          <section className="sb-perfx__charts" aria-label="Frame rate">
            <div className="sb-perfx__headline">
              <span className="sb-perfx__fps sb-tabular">{playing ? Math.round(summary.fps.latest) : "–"}</span>
              <span className="sb-perfx__unit">fps</span>
              <Badge tone={status.tone} dot>
                {status.label}
              </Badge>
              <span className="sb-hudview__spacer" />
              <Button size="sm" variant="ghost" icon={playing ? <Pause size={12} /> : <Play size={12} />} onClick={() => session.runtime.togglePlay()}>
                {playing ? "Pause" : "Play"}
              </Button>
              <Button size="sm" variant="ghost" icon={<RotateCcw size={12} />} onClick={reset}>
                Reset
              </Button>
            </div>
            <div className="sb-perfx__chart">
              <div className="sb-perfx__chart-title">Frame rate</div>
              <SampleChart
                values={fpsValues}
                capacity={CAPACITY}
                min={0}
                max={Math.max(62, ...fpsValues.map((v) => v ?? 0))}
                target={{ value: 60, label: "60" }}
                format={(v) => `${Math.round(v)} fps`}
                label={summary.playingSamples ? `Frame rate over the last minute: average ${Math.round(summary.fps.avg)} fps, lowest ${Math.round(summary.fps.min)} fps` : "Frame rate: the prototype is paused"}
                sampleMs={SAMPLE_MS}
                height={64}
              />
            </div>
            <div className="sb-perfx__chart">
              <div className="sb-perfx__chart-title">Evaluate time per frame</div>
              <SampleChart
                values={msValues}
                capacity={CAPACITY}
                min={0}
                max={msMax}
                target={{ value: 1000 / (doc.project.fps ?? 60), label: "budget" }}
                format={formatMs}
                label={`Evaluate time per frame: average ${formatMs(summary.frameMs.avg)}, slowest ${formatMs(summary.frameMs.max)}`}
                sampleMs={SAMPLE_MS}
                height={40}
              />
            </div>
          </section>

          <dl className="sb-perfx__stats">
            <div className="sb-perfx__stat">
              <dt>Frame time</dt>
              <dd className="sb-tabular">
                {formatMs(summary.frameMs.latest)}
                <span className="sb-perfx__sub">
                  avg {formatMs(summary.frameMs.avg)} · max {formatMs(summary.frameMs.max)}
                </span>
              </dd>
            </div>
            <div className="sb-perfx__stat">
              <dt>Frame budget used</dt>
              <dd className="sb-tabular" data-tone={budget > 0.8 ? "warn" : undefined}>
                {Math.round(budget * 100)}%
                <span className="sb-perfx__sub">of {formatMs(1000 / (doc.project.fps ?? 60))}</span>
              </dd>
            </div>
            <div className="sb-perfx__stat">
              <dt>Dropped</dt>
              <dd className="sb-tabular">
                {summary.slowSamples}
                <span className="sb-perfx__sub">slow samples in the last {Math.round((samples.length * SAMPLE_MS) / 1000)}s</span>
              </dd>
            </div>
            <div className="sb-perfx__stat">
              <dt>Patches</dt>
              <dd className="sb-tabular">
                {stats.patches}
                <span className="sb-perfx__sub">
                  in {stats.components} {stats.components === 1 ? "component" : "components"}
                </span>
              </dd>
            </div>
            <div className="sb-perfx__stat">
              <dt>Layers drawn</dt>
              <dd className="sb-tabular">
                {scene.visible}
                <span className="sb-perfx__sub">of {scene.nodes} in the scene</span>
              </dd>
            </div>
            <div className="sb-perfx__stat">
              <dt>Loop instances</dt>
              <dd className="sb-tabular">
                {scene.loopInstances}
                {scene.replicated.length > 0 && <span className="sb-perfx__sub">{scene.replicated.slice(0, 3).map((r) => `${itemDisplayName(doc, doc.project.root, r.layerId)} ×${r.count}`).join(" · ")}</span>}
              </dd>
            </div>
            <div className="sb-perfx__stat">
              <dt>Running</dt>
              <dd className="sb-tabular">
                {time.toFixed(1)}s<span className="sb-perfx__sub">frame {Math.max(0, frame).toLocaleString()}</span>
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
            {timings && timings.length > 0 && (
              <div className="sb-perfx__stat" data-wide>
                <dt>Slowest patches</dt>
                <dd>
                  <ol className="sb-perfx__slow">
                    {timings.map((t) => (
                      <li key={`${t.componentPath ?? ""}/${t.patchId}`}>
                        <button type="button" onClick={() => revealItems(session, doc.project.root, [t.patchId])}>
                          {itemDisplayName(doc, doc.project.root, t.patchId)}
                        </button>
                        <span className="sb-tabular">{formatMs(t.ms)}</span>
                      </li>
                    ))}
                  </ol>
                </dd>
              </div>
            )}
          </dl>
        </div>
      </div>
    </div>
  );
}
