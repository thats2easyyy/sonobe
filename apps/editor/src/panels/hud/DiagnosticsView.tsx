import { CircleX, Info, LocateFixed, TriangleAlert, Wrench } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import type { Severity } from "@sonobe/core";
import { useDocument, useEditorSession } from "../../state/EditorProvider.tsx";
import { Button } from "../../ui/Button.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { toast } from "../../ui/Toast.tsx";
import { Tooltip } from "../../ui/Tooltip.tsx";
import { useControllableState } from "../../ui/lib/hooks.ts";
import { adviceSuggestions, ALL_SEVERITIES, applyDiagnosticFix, countBySeverity, filterDiagnostics, fixableSuggestions, fixLabel, SEVERITIES, type FixSuggestion, type HudDiagnostic, type SeverityFilter } from "./diagnosticsModel.ts";
import { FilterChip } from "./FilterChip.tsx";
import { focusSelectedTab } from "./focusTab.ts";
import { isFiltered, toggleFilter } from "./filters.ts";
import { showKnobs } from "../knobs/knobsStore.ts";
import { useHudDiagnostics } from "./hooks.ts";
import { disambiguateNames, itemDisplayName } from "./itemNames.ts";
import { revealItems } from "./reveal.ts";

const SEVERITY: Record<Severity, { label: string; single: string; icon: ReactNode; tone: "danger" | "warn" | "info" }> = {
  error: { label: "Errors", single: "Error", icon: <CircleX size={12} strokeWidth={2} />, tone: "danger" },
  warning: { label: "Warnings", single: "Warning", icon: <TriangleAlert size={12} strokeWidth={2} />, tone: "warn" },
  info: { label: "Info", single: "Info", icon: <Info size={12} strokeWidth={2} />, tone: "info" },
};

const ROW_ICONS: Record<Severity, ReactNode> = {
  error: <CircleX size={14} strokeWidth={2} />,
  warning: <TriangleAlert size={14} strokeWidth={2} />,
  info: <Info size={14} strokeWidth={2} />,
};

export interface DiagnosticsViewProps {
  /** Which severities show. Pass it (with onFilterChange) to keep the choice while the tab is unmounted. */
  filter?: SeverityFilter;
  onFilterChange?: (filter: SeverityFilter) => void;
}

/** Diagnostics tab: document checks and runtime issues, with severity filters, reveal, and one-click fixes. */
export function DiagnosticsView({ filter: controlledFilter, onFilterChange }: DiagnosticsViewProps = {}) {
  const session = useEditorSession();
  const diagnostics = useHudDiagnostics();
  const doc = useDocument((s) => s.doc);
  const [filter, setFilter] = useControllableState<SeverityFilter>(controlledFilter, ALL_SEVERITIES, onFilterChange);
  const counts = useMemo(() => countBySeverity(diagnostics), [diagnostics]);
  const visible = useMemo(() => filterDiagnostics(diagnostics, filter), [diagnostics, filter]);

  const reveal = (d: HudDiagnostic, ids: readonly string[] = d.itemIds) => {
    if (ids.length === 0) {
      // Knob table diagnostics (a missing value, an unused knob) point at a knob: show it in the Knobs tab.
      if (d.knob !== undefined) showKnobs(session, d.knob);
      return;
    }
    if (!revealItems(session, d.component, ids)) toast({ title: "Those items aren't in the document anymore", tone: "neutral" });
  };

  const applyFix = (d: HudDiagnostic, suggestion: FixSuggestion) => {
    const outcome = applyDiagnosticFix(session.document, d, suggestion);
    if (!outcome.ok) {
      toast.error("Couldn't apply this fix", { description: outcome.message ?? "" });
      return;
    }
    toast({
      title: outcome.label,
      description: `Fixed as one undoable change (${outcome.result.applied.length} ${outcome.result.applied.length === 1 ? "edit" : "edits"}).`,
      tone: "success",
      action: {
        label: "Undo",
        onClick: () => {
          const undone = session.document.getState().undo();
          if (!undone.ok) toast.error("Couldn't undo the fix", { description: undone.errors[0]?.message ?? "" });
        },
      },
    });
  };

  const root = doc.project.root;

  const nothingToFilter = diagnostics.length === 0;

  return (
    <div className="sb-hudview">
      {!nothingToFilter && (
        <div className="sb-hudview__toolbar">
          <div className="sb-hudview__chips" role="group" aria-label="Show severities">
            {SEVERITIES.map((severity) => (
              <FilterChip
                key={severity}
                pressed={filter[severity]}
                tone={SEVERITY[severity].tone}
                icon={SEVERITY[severity].icon}
                label={SEVERITY[severity].label}
                count={counts[severity]}
                hint="Option-click to show only this severity"
                onToggle={(event) => setFilter(toggleFilter(filter, severity, event.altKey))}
              />
            ))}
          </div>
        </div>
      )}

      {nothingToFilter ? (
        <div className="sb-hudview__empty">
          <EmptyState size="sm" variant="inline" title="No problems" description="Checked as you edit." />
        </div>
      ) : visible.length === 0 ? (
        <div className="sb-hudview__empty">
          <EmptyState
            size="sm"
            variant="inline"
            title="Nothing at these severities"
            description={`${diagnostics.length} ${diagnostics.length === 1 ? "problem is" : "problems are"} hidden by filters.`}
            actions={
              isFiltered(filter) && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={(event) => {
                    focusSelectedTab(event.currentTarget);
                    setFilter(ALL_SEVERITIES);
                  }}
                >
                  Show all
                </Button>
              )
            }
          />
        </div>
      ) : (
        <div className="sb-hudview__scroll sb-scroll" role="list" aria-label="Problems">
          {visible.map((d) => {
            const fixes = fixableSuggestions(d);
            const advice = adviceSuggestions(d);
            const component = doc.components[d.component];
            const revealable = d.itemIds.length > 0 || d.knob !== undefined;
            const names = disambiguateNames(
              d.itemIds.map((id) => itemDisplayName(doc, d.component, id, session.registry)),
              d.itemIds,
            );
            const hasMeta = d.source === "runtime" || (d.component !== root && component) || names.length > 0;
            return (
              <div key={d.key} className="sb-problem" data-severity={d.severity} role="listitem">
                <Tooltip content={d.code} placement="top">
                  <span className="sb-problem__icon" role="img" aria-label={SEVERITY[d.severity].single} aria-description={d.code}>
                    {ROW_ICONS[d.severity]}
                  </span>
                </Tooltip>
                <div className="sb-problem__text">
                  {revealable ? (
                    <button type="button" className="sb-problem__message" onClick={() => reveal(d)}>
                      {d.message}
                    </button>
                  ) : (
                    <div className="sb-problem__message">{d.message}</div>
                  )}
                  {d.hint && !d.message.includes(d.hint) && <div className="sb-problem__hint">{d.hint}</div>}
                  {advice.map((s) => (
                    <div key={s.description} className="sb-problem__hint">
                      {s.description}
                    </div>
                  ))}
                  {hasMeta && (
                    <div className="sb-problem__meta">
                      {d.source === "runtime" && <span>Runtime check</span>}
                      {d.component !== root && component && <span className="sb-problem__component">in {component.name}</span>}
                      {d.itemIds.map((id, i) => (
                        <button key={id} type="button" className="sb-problem__item" onClick={() => reveal(d, [id])}>
                          {names[i]}
                          {d.port && d.itemIds[0] === id ? <span className="sb-problem__port">.{d.port}</span> : null}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="sb-problem__actions">
                  {fixes.map((suggestion, i) => (
                    <Tooltip key={`${i}-${suggestion.description}`} content={suggestion.description} placement="top">
                      <Button size="sm" variant={i === 0 ? "secondary" : "ghost"} icon={<Wrench size={12} />} onClick={() => applyFix(d, suggestion)}>
                        {fixLabel(suggestion)}
                      </Button>
                    </Tooltip>
                  ))}
                  {revealable && <IconButton size="sm" icon={<LocateFixed size={14} />} label={names[0] ? `Reveal ${names[0]}` : "Reveal knob"} tooltipPlacement="top" onClick={() => reveal(d)} />}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
