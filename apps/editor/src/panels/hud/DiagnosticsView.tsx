import { CircleCheck, CircleX, Info, LocateFixed, TriangleAlert, WandSparkles } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type { Severity } from "@sonobe/core";
import { useDocument, useEditorSession } from "../../state/EditorProvider.tsx";
import { Badge } from "../../ui/Badge.tsx";
import { Button } from "../../ui/Button.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { toast } from "../../ui/Toast.tsx";
import { adviceSuggestions, ALL_SEVERITIES, applyDiagnosticFix, countBySeverity, filterDiagnostics, fixableSuggestions, fixLabel, SEVERITIES, type FixSuggestion, type HudDiagnostic, type SeverityFilter } from "./diagnosticsModel.ts";
import { FilterChip } from "./FilterChip.tsx";
import { isFiltered, toggleFilter } from "./filters.ts";
import { showKnobs } from "../knobs/knobsStore.ts";
import { useHudDiagnostics } from "./hooks.ts";
import { itemDisplayName } from "./itemNames.ts";
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

/** Diagnostics tab: document checks and runtime issues, with severity filters, reveal, and one-click fixes. */
export function DiagnosticsView() {
  const session = useEditorSession();
  const diagnostics = useHudDiagnostics();
  const doc = useDocument((s) => s.doc);
  const [filter, setFilter] = useState<SeverityFilter>(ALL_SEVERITIES);
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
      description: `Fixed as one undoable change (${outcome.result.applied.length} ${outcome.result.applied.length === 1 ? "op" : "ops"}).`,
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

  return (
    <div className="sb-hudview">
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
              onToggle={(event) => setFilter((current) => toggleFilter(current, severity, event.altKey))}
            />
          ))}
        </div>
        <span className="sb-hudview__spacer" />
        <span className="sb-hudview__summary">Checked as you edit</span>
      </div>

      {diagnostics.length === 0 ? (
        <div className="sb-hudview__empty">
          <EmptyState size="sm" icon={<CircleCheck size={16} />} title="No problems found" description="Sonobe checks links, types, cycles, missing assets, and layers that can't be tapped as you edit." />
        </div>
      ) : visible.length === 0 ? (
        <div className="sb-hudview__empty">
          <EmptyState
            size="sm"
            icon={<CircleCheck size={16} />}
            title="Nothing at these severities"
            description={`${diagnostics.length} hidden by filters.`}
            actions={
              isFiltered(filter) && (
                <Button size="sm" variant="secondary" onClick={() => setFilter(ALL_SEVERITIES)}>
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
            return (
              <div key={d.key} className="sb-problem" data-severity={d.severity} role="listitem">
                <span className="sb-problem__icon" aria-label={SEVERITY[d.severity].single}>
                  {ROW_ICONS[d.severity]}
                </span>
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
                  <div className="sb-problem__meta">
                    <code className="sb-problem__code">{d.code}</code>
                    {d.source === "runtime" && (
                      <Badge size="sm" tone="info">
                        Runtime
                      </Badge>
                    )}
                    {d.component !== root && component && <span className="sb-problem__component">in {component.name}</span>}
                    {d.itemIds.map((id) => (
                      <button key={id} type="button" className="sb-problem__item" onClick={() => reveal(d, [id])} title={`Reveal ${id}`}>
                        {itemDisplayName(doc, d.component, id, session.registry)}
                        {d.port && d.itemIds[0] === id ? <span className="sb-problem__port">.{d.port}</span> : null}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="sb-problem__actions">
                  {fixes.map((suggestion, i) => (
                    <Button key={`${i}-${suggestion.description}`} size="sm" variant={i === 0 ? "secondary" : "ghost"} icon={<WandSparkles size={12} />} title={suggestion.description} onClick={() => applyFix(d, suggestion)}>
                      {fixLabel(suggestion)}
                    </Button>
                  ))}
                  {revealable && <IconButton size="sm" icon={<LocateFixed size={13} />} label="Reveal" tooltipPlacement="top" onClick={() => reveal(d)} />}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
