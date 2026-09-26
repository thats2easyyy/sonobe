import { ChevronDown, ChevronUp, Gauge, Sparkles, SquareTerminal, TriangleAlert } from "lucide-react";
import { useState, type MouseEvent, type ReactNode } from "react";
import { useRuntimeState } from "../../state/EditorProvider.tsx";
import { Badge } from "../../ui/Badge.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { TabPanel, Tabs } from "../../ui/Tabs.tsx";
import { Tooltip } from "../../ui/Tooltip.tsx";
import { cx } from "../../ui/lib/cx.ts";
import { useControllableState } from "../../ui/lib/hooks.ts";
import { ALL_SEVERITIES, type SeverityFilter } from "./diagnosticsModel.ts";
import { AiActivityView } from "./AiActivityView.tsx";
import { ConsoleView } from "./ConsoleView.tsx";
import { DiagnosticsView } from "./DiagnosticsView.tsx";
import { useHudCounts } from "./hooks.ts";
import { HUD_TABS } from "./hudTabs.ts";
import { formatMs, smoothness } from "./perfModel.ts";
import { PerformanceView } from "./PerformanceView.tsx";
import "./hud.css";

/** Same ids as the shell layout store's HudTab. */
export type HudTabId = "console" | "diagnostics" | "ai" | "performance";

export interface HudProps {
  /** Controlled tab (e.g. layoutStore hudTab). */
  tab?: HudTabId;
  defaultTab?: HudTabId;
  onTabChange?: (tab: HudTabId) => void;
  /** Collapsed shows only the tab bar and status readout. */
  collapsed?: boolean;
  /** Shows the collapse button (Mod+J) when provided. */
  onToggleCollapse?: () => void;
  /** Opens the Connect Claude dialog from the AI Activity empty state. */
  onConnectClaude?: () => void;
  className?: string;
}

const ID_BASE = "sb-hudx";

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

const TAB_ICONS: Record<HudTabId, ReactNode> = {
  console: <SquareTerminal size={14} />,
  diagnostics: <TriangleAlert size={14} />,
  ai: <Sparkles size={14} />,
  performance: <Gauge size={14} />,
};

/**
 * Bottom HUD: Console, Diagnostics, AI Activity, and Performance, with a live fps and frame-time
 * readout. Fills its container; mount inside an EditorProvider.
 */
export function Hud({ tab, defaultTab = "console", onTabChange, collapsed = false, onToggleCollapse, onConnectClaude, className }: HudProps) {
  const [current, setCurrent] = useControllableState<HudTabId>(tab, defaultTab, onTabChange);
  const counts = useHudCounts();
  const fps = useRuntimeState((s) => s.fps);
  const playing = useRuntimeState((s) => s.playing);
  const frameMs = useRuntimeState((s) => s.frameMs);
  const [severities, setSeverities] = useState<SeverityFilter>(ALL_SEVERITIES);
  const status = smoothness(fps, playing);
  const readout = playing ? `${status.label}, ${Math.round(fps)} fps, ${formatMs(frameMs)} to evaluate a frame` : "Paused";

  const consoleBadge =
    counts.consoleErrors > 0 ? (
      <Badge size="sm" tone="danger" aria-label={plural(counts.consoleErrors, "error")}>
        {counts.consoleErrors}
      </Badge>
    ) : counts.consoleWarnings > 0 ? (
      <Badge size="sm" tone="warn" aria-label={plural(counts.consoleWarnings, "warning")}>
        {counts.consoleWarnings}
      </Badge>
    ) : undefined;
  const problems = counts.diagnostics.error + counts.diagnostics.warning;
  const diagnosticsBadge =
    problems > 0 ? (
      <Badge size="sm" tone={counts.diagnostics.error > 0 ? "danger" : "warn"} aria-label={plural(problems, "problem")}>
        {problems}
      </Badge>
    ) : undefined;

  const badges: Partial<Record<HudTabId, ReactNode>> = {
    console: consoleBadge,
    diagnostics: diagnosticsBadge,
    ai: counts.working > 0 ? <span className="sb-hudx__live" role="status" aria-label="Claude is working" /> : undefined,
  };

  const onBarDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onToggleCollapse?.();
  };

  return (
    <section className={cx("sb-hudx", className)} aria-label="Bottom panel" data-collapsed={collapsed || undefined} data-shortcut-scope="hud">
      <div className="sb-hudx__bar" onDoubleClick={onBarDoubleClick}>
        <Tabs<HudTabId>
          idBase={ID_BASE}
          aria-label="Bottom panel tabs"
          value={current}
          onChange={setCurrent}
          items={HUD_TABS.map(({ value, label }) => ({ value, label, icon: TAB_ICONS[value], badge: badges[value] }))}
        />
        <div className="sb-hudx__status">
          <Tooltip content={`${readout}. Show performance`} placement="top">
            <button type="button" className="sb-hudx__stat" data-link onClick={() => setCurrent("performance")} aria-label={`${readout}. Show performance`}>
              <span className="sb-hudx__dot" data-tone={status.tone} aria-hidden />
              <span className="sb-tabular">{playing ? `${Math.round(fps)} fps` : "Paused"}</span>
            </button>
          </Tooltip>
          {onToggleCollapse && <IconButton size="sm" icon={collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />} label={collapsed ? "Show bottom panel" : "Hide bottom panel"} shortcut="Mod+J" tooltipPlacement="top" onClick={onToggleCollapse} />}
        </div>
      </div>
      {!collapsed && (
        <div className="sb-hudx__body">
          <TabPanel idBase={ID_BASE} value="console" active={current === "console"} keepMounted className="sb-hudx__panel">
            <ConsoleView />
          </TabPanel>
          <TabPanel idBase={ID_BASE} value="diagnostics" active={current === "diagnostics"} className="sb-hudx__panel">
            <DiagnosticsView filter={severities} onFilterChange={setSeverities} />
          </TabPanel>
          <TabPanel idBase={ID_BASE} value="ai" active={current === "ai"} className="sb-hudx__panel">
            <AiActivityView {...(onConnectClaude ? { onConnectClaude } : {})} />
          </TabPanel>
          <TabPanel idBase={ID_BASE} value="performance" active={current === "performance"} keepMounted className="sb-hudx__panel">
            <PerformanceView active={current === "performance"} />
          </TabPanel>
        </div>
      )}
    </section>
  );
}
