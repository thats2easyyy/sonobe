import { ChevronDown, ChevronRight, ChevronUp, CircleX, Gauge, Info, LoaderCircle, Sparkles, SquareTerminal, Trash, TriangleAlert, Undo2, UserRound, WandSparkles } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Badge } from "../../ui/Badge.tsx";
import { Button } from "../../ui/Button.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { SegmentedControl } from "../../ui/SegmentedControl.tsx";
import { TabPanel, Tabs } from "../../ui/Tabs.tsx";
import { toast } from "../../ui/Toast.tsx";
import { layoutStore, useLayout, type HudTab } from "../layoutStore.ts";
import { MOCK_AI_ACTIVITY, MOCK_CONSOLE, MOCK_DIAGNOSTICS, MOCK_FPS, type ConsoleLevel } from "../mockData.ts";

const ID_BASE = "sb-hud";

const LEVEL_ICONS: Record<ConsoleLevel, ReactNode> = {
  log: <ChevronRight size={12} strokeWidth={2} />,
  info: <Info size={12} strokeWidth={2} />,
  warn: <TriangleAlert size={12} strokeWidth={2} />,
  error: <CircleX size={12} strokeWidth={2} />,
};

function ConsoleView() {
  const [level, setLevel] = useState<"all" | "warn" | "error">("all");
  const [entries, setEntries] = useState(MOCK_CONSOLE);
  const visible = entries.filter((e) => level === "all" || (level === "warn" ? e.level === "warn" || e.level === "error" : e.level === "error"));
  return (
    <div className="sb-console">
      <div className="sb-console__toolbar">
        <SegmentedControl
          size="sm"
          aria-label="Log level"
          value={level}
          onChange={setLevel}
          options={[
            { value: "all", label: "All" },
            { value: "warn", label: "Warnings" },
            { value: "error", label: "Errors" },
          ]}
        />
        <IconButton size="sm" icon={<Trash size={13} />} label="Clear console" shortcut="Mod+Shift+K" onClick={() => setEntries([])} />
      </div>
      {visible.length === 0 ? (
        <EmptyState size="sm" icon={<SquareTerminal size={16} />} title="Console is clear" description="Logs from JavaScript patches and the prototype show up here." />
      ) : (
        <div className="sb-console__rows sb-selectable" role="log" aria-label="Console output">
          {visible.map((entry) => (
            <div key={entry.id} className="sb-console__row" data-level={entry.level}>
              <span className="sb-console__icon" aria-hidden>
                {LEVEL_ICONS[entry.level]}
              </span>
              <span className="sb-console__time">{entry.time}</span>
              <span className="sb-console__source">{entry.source}</span>
              <span className="sb-console__message">{entry.message}</span>
              {entry.count && <Badge size="sm">{entry.count}</Badge>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DiagnosticsView() {
  return (
    <div className="sb-diagnostics">
      {MOCK_DIAGNOSTICS.map((d) => (
        <div key={d.id} className="sb-diagnostics__row" data-severity={d.severity}>
          <span className="sb-diagnostics__icon" aria-hidden>
            {d.severity === "error" ? <CircleX size={14} /> : d.severity === "warning" ? <TriangleAlert size={14} /> : <Info size={14} />}
          </span>
          <div className="sb-diagnostics__text">
            <div className="sb-diagnostics__message">{d.message}</div>
            <div className="sb-diagnostics__meta">
              <code>{d.code}</code>
              {d.items.map((id) => (
                <span key={id} className="sb-diagnostics__item">
                  {id}
                </span>
              ))}
            </div>
          </div>
          {d.fix && (
            <Button size="sm" variant="secondary" icon={<WandSparkles size={12} />} onClick={() => toast({ title: d.fix!, description: "Applied as one undoable change.", tone: "success" })}>
              {d.fix}
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

function AiActivityView() {
  return (
    <div className="sb-activity">
      <div className="sb-activity__row" data-working>
        <span className="sb-activity__avatar" data-author="Claude" aria-hidden>
          <LoaderCircle size={13} strokeWidth={2} className="sb-spin" />
        </span>
        <div className="sb-activity__text">
          <div className="sb-activity__label">Claude is building the tab bar’s selected state</div>
          <div className="sb-activity__detail">working on optionSwitch → optionPicker → @tab_bar.selected</div>
        </div>
        <Badge tone="ai" dot>
          Live
        </Badge>
      </div>
      {MOCK_AI_ACTIVITY.map((entry) => (
        <div key={entry.id} className="sb-activity__row">
          <span className="sb-activity__avatar" data-author={entry.author} aria-hidden>
            {entry.author === "Claude" ? <Sparkles size={12} strokeWidth={2} /> : <UserRound size={12} strokeWidth={2} />}
          </span>
          <div className="sb-activity__text">
            <div className="sb-activity__label">
              <strong>{entry.author}</strong> {entry.label.charAt(0).toLowerCase() + entry.label.slice(1)}
            </div>
            {entry.detail && <div className="sb-activity__detail">{entry.detail}</div>}
          </div>
          <Badge size="sm" className="sb-tabular">
            {entry.ops} {entry.ops === 1 ? "op" : "ops"}
          </Badge>
          <span className="sb-activity__time">{entry.time}</span>
          <IconButton size="xs" icon={<Undo2 size={12} />} label={`Undo “${entry.label}”`} onClick={() => toast({ title: `Undid “${entry.label}”`, tone: "neutral" })} />
        </div>
      ))}
    </div>
  );
}

function Sparkline({ values, width = 360, height = 64, min = 30, max = 62 }: { values: readonly number[]; width?: number; height?: number; min?: number; max?: number }) {
  const path = useMemo(() => {
    const step = width / Math.max(1, values.length - 1);
    return values.map((v, i) => `${i === 0 ? "M" : "L"} ${(i * step).toFixed(1)} ${(height - ((v - min) / (max - min)) * height).toFixed(1)}`).join(" ");
  }, [values, width, height, min, max]);
  const target = height - ((60 - min) / (max - min)) * height;
  return (
    <svg className="sb-sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Frame rate over the last 90 seconds">
      <line x1={0} x2={width} y1={target} y2={target} className="sb-sparkline__target" />
      <path d={`${path} L ${width} ${height} L 0 ${height} Z`} className="sb-sparkline__area" />
      <path d={path} className="sb-sparkline__line" />
    </svg>
  );
}

function PerformanceView() {
  const stats: [string, string][] = [
    ["Frame time", "4.2 ms"],
    ["Patches evaluated", "18"],
    ["Layers drawn", "24"],
    ["Loop instances", "×6"],
    ["Slowest patch", "js_formatPrice · 0.8 ms"],
    ["Dropped frames", "4 in last minute"],
  ];
  return (
    <div className="sb-perf">
      <div className="sb-perf__chart">
        <div className="sb-perf__headline">
          <span className="sb-perf__fps sb-tabular">60</span>
          <span className="sb-perf__unit">fps</span>
          <Badge tone="success" dot>
            Smooth
          </Badge>
        </div>
        <Sparkline values={MOCK_FPS} />
      </div>
      <dl className="sb-perf__stats">
        {stats.map(([label, value]) => (
          <div key={label} className="sb-perf__stat">
            <dt>{label}</dt>
            <dd className="sb-tabular">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export interface BottomHudSlots {
  console?: ReactNode;
  diagnostics?: ReactNode;
  aiActivity?: ReactNode;
  performance?: ReactNode;
}

/** Bottom HUD: console, diagnostics, AI activity, and performance, with a live status readout. */
export function BottomHud({ slots = {}, collapsed, onToggleCollapse }: { slots?: BottomHudSlots; collapsed: boolean; onToggleCollapse: () => void }) {
  const tab = useLayout((s) => s.hudTab);
  const setTab = (next: HudTab) => layoutStore.getState().setHudTab(next);
  const errors = MOCK_CONSOLE.filter((e) => e.level === "error").length;
  return (
    <section className="sb-hud" aria-label="Console and diagnostics" data-collapsed={collapsed || undefined} data-shortcut-scope="hud">
      <div className="sb-hud__bar">
        <Tabs<HudTab>
          idBase={ID_BASE}
          aria-label="Console panels"
          value={tab}
          onChange={setTab}
          items={[
            { value: "console", label: "Console", icon: <SquareTerminal size={13} />, badge: errors > 0 ? <Badge size="sm" tone="danger">{errors}</Badge> : undefined },
            { value: "diagnostics", label: "Diagnostics", icon: <TriangleAlert size={13} />, badge: <Badge size="sm" tone="warn">{MOCK_DIAGNOSTICS.length}</Badge> },
            { value: "ai", label: "AI Activity", icon: <Sparkles size={13} />, badge: <span className="sb-hud__live-dot" aria-label="Claude is working" /> },
            { value: "performance", label: "Performance", icon: <Gauge size={13} /> },
          ]}
        />
        <div className="sb-hud__status" aria-live="off">
          <span className="sb-hud__stat">
            <span className="sb-hud__fps-dot" aria-hidden />
            <span className="sb-tabular">60 fps</span>
          </span>
          <span className="sb-hud__stat sb-tabular">4.2 ms</span>
          <span className="sb-hud__stat">iPhone 17 Pro</span>
          <IconButton
            size="sm"
            icon={collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            label={collapsed ? "Show console" : "Hide console"}
            shortcut="Mod+J"
            tooltipPlacement="top"
            onClick={onToggleCollapse}
          />
        </div>
      </div>
      {!collapsed && (
        <div className="sb-hud__body sb-scroll">
          <TabPanel idBase={ID_BASE} value="console" active={tab === "console"} className="sb-hud__panel">
            {slots.console ?? <ConsoleView />}
          </TabPanel>
          <TabPanel idBase={ID_BASE} value="diagnostics" active={tab === "diagnostics"} className="sb-hud__panel">
            {slots.diagnostics ?? <DiagnosticsView />}
          </TabPanel>
          <TabPanel idBase={ID_BASE} value="ai" active={tab === "ai"} className="sb-hud__panel">
            {slots.aiActivity ?? <AiActivityView />}
          </TabPanel>
          <TabPanel idBase={ID_BASE} value="performance" active={tab === "performance"} className="sb-hud__panel">
            {slots.performance ?? <PerformanceView />}
          </TabPanel>
        </div>
      )}
    </section>
  );
}
