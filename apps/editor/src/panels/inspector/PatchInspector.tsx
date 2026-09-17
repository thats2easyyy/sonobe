/** Properties of the selected patches: header and docs, options (type, count, settings, bypass), springs, inputs, and live outputs. */

import {
  encodeValue,
  isJsonLiteral,
  resolveNodePorts,
  type Id,
  type InputValue,
  type Op,
  type PatchNode,
  type ResolvedPorts,
  type SettingSpec,
  type Value,
  type ValueType,
} from "@sonobe/core";
import { ArrowRight, BookOpen, Copy, Ellipsis, Minus, Plus, ScanSearch, Shapes, TriangleAlert } from "lucide-react";
import { useId, useMemo, useState, type ReactNode } from "react";
import { CATEGORY_ICONS } from "../../shell/icons.tsx";
import { useDocument, useEditorSession, useSelection } from "../../state/EditorProvider.tsx";
import { isPatchImplemented } from "../../state/registry.ts";
import { currentComponentId } from "../../state/selection.ts";
import { CATEGORY_LABELS, categoryColorVar } from "../../theme/tokens.ts";
import { Badge } from "../../ui/Badge.tsx";
import { Button } from "../../ui/Button.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { Menu, type MenuEntry } from "../../ui/Menu.tsx";
import { PortGlyph, VALUE_TYPE_LABELS } from "../../ui/PortGlyph.tsx";
import { Select } from "../../ui/Select.tsx";
import { toast } from "../../ui/Toast.tsx";
import { Toggle } from "../../ui/Toggle.tsx";
import { Tooltip } from "../../ui/Tooltip.tsx";
import { ValueControl, type FieldActions } from "./controls.tsx";
import { DocsText } from "./DocsText.tsx";
import { FieldRow, LiveValue } from "./FieldRow.tsx";
import { InspectorHeader } from "./Header.tsx";
import { intersectFields, patchSources, sameInputValue, splitAdvanced, subjectLabel, summarizeField, type FieldPort, type InspectorField } from "./model.ts";
import { planPortChange, type LostCable, type PortChangePlan } from "./portChange.ts";
import { InspectorSection } from "./Section.tsx";
import { isSpringPatch } from "./spring.ts";
import { SpringSection } from "./SpringSection.tsx";
import { useInspectorEdit } from "./useInspectorEdit.ts";

export interface PatchInspectorProps {
  patchIds: readonly Id[];
  /** Open a patch type's full reference elsewhere (the Learn drawer). Without it, "Learn More" expands the docs here. */
  onLearnMore?: (patchType: string) => void;
}

interface Entry {
  id: Id;
  node: PatchNode;
  ports: ResolvedPorts;
}

/** A Type or count change waiting for a decision because it would disconnect cables. */
export interface PendingPortChange {
  kind: "type" | "count";
  ops: Op[];
  label: string;
  /** "Switching to Color", "Removing Value 3" */
  title: string;
  plan: Extract<PortChangePlan, { ok: true }>;
  revision: number;
}

function settingValue(node: PatchNode, setting: SettingSpec): InputValue {
  const raw = node.settings?.[setting.key] ?? setting.default;
  return setting.type === "json" ? encodeValue(raw as Value, "json") : (raw as InputValue);
}

function settingField(setting: SettingSpec, entries: readonly Entry[]): InspectorField {
  const type: ValueType = setting.type;
  const port: FieldPort = { key: setting.key, name: setting.name, type, description: setting.description, default: setting.default as Value, ...(setting.enumOptions ? { enumOptions: setting.enumOptions } : {}) };
  return summarizeField(
    port,
    entries.map((e) => {
      const value = settingValue(e.node, setting);
      return { id: e.id, address: "", stored: value, fallback: value };
    }),
  );
}

function OptionRow({ label, description, children }: { label: string; description?: string; children: ReactNode }) {
  return (
    <div className="sb-insp-row">
      <Tooltip content={description} placement="left" delay={700}>
        <span className="sb-insp-row__label">
          <span className="sb-insp-row__name">{label}</span>
        </span>
      </Tooltip>
      <div className="sb-insp-row__control">{children}</div>
    </div>
  );
}

const typeName = (type: ValueType | undefined) => (type ? (VALUE_TYPE_LABELS[type] ?? type) : "value");

function lostReason(cable: LostCable): string {
  if (cable.removedPort) return "That port goes away.";
  if (cable.converter) return cable.converter.description;
  return `A ${typeName(cable.fromType).toLowerCase()} can't drive a ${typeName(cable.toType).toLowerCase()}, and there's no converter for it.`;
}

/**
 * Inline decision for a Type or count change that disconnects cables: insert converters where they
 * exist (one undo step with the change), change anyway, or cancel.
 */
export function PortChangeCard({ pending, onConfirm, onCancel }: { pending: PendingPortChange; onConfirm: (withConverters: boolean) => void; onCancel: () => void }) {
  const titleId = useId();
  const { plan } = pending;
  const count = plan.lost.length;
  const converters = plan.converterCount;
  const firstConverter = plan.lost.find((l) => l.converter)?.converter;
  return (
    <div
      className="sb-insp-conflict"
      role="alertdialog"
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }}
    >
      <div className="sb-insp-conflict__head">
        <TriangleAlert size={14} strokeWidth={2} aria-hidden className="sb-insp-conflict__icon" />
        <span id={titleId} className="sb-insp-conflict__title">
          {pending.title} disconnects {count === 1 ? "a cable" : `${count} cables`}
        </span>
      </div>
      <ul className="sb-insp-conflict__list">
        {plan.lost.map((cable) => (
          <li key={`${cable.from}→${cable.to}`} className="sb-insp-conflict__cable">
            <span className="sb-insp-conflict__ends">
              <PortGlyph type={cable.fromType ?? "any"} size={7} />
              <span className="sb-insp-conflict__end">{cable.fromLabel}</span>
              <ArrowRight size={11} strokeWidth={2} aria-label="to" className="sb-insp-conflict__arrow" />
              <PortGlyph type={cable.toType ?? "any"} size={7} />
              <span className="sb-insp-conflict__end">{cable.toLabel}</span>
            </span>
            <span className="sb-insp-conflict__why">{lostReason(cable)}</span>
          </li>
        ))}
      </ul>
      {plan.resetValues > 0 && (
        <p className="sb-insp-conflict__note">
          {plan.resetValues === 1 ? "One value you set goes back to its default." : `${plan.resetValues} values you set go back to their defaults.`}
        </p>
      )}
      <div className="sb-insp-conflict__actions">
        {converters > 0 && (
          <Button size="sm" variant="primary" autoFocus onClick={() => onConfirm(true)}>
            {converters === 1 && firstConverter ? `Insert ${firstConverter.patchName}` : `Insert ${converters} Converters`}
          </Button>
        )}
        <Button size="sm" variant={converters > 0 ? "secondary" : "primary"} autoFocus={converters === 0} onClick={() => onConfirm(false)}>
          {pending.kind === "type" ? "Change Anyway" : "Remove Anyway"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function PatchInspector({ patchIds, onLearnMore }: PatchInspectorProps) {
  const session = useEditorSession();
  const registry = session.registry;
  const doc = useDocument((s) => s.doc);
  const componentId = useSelection(currentComponentId);
  const edit = useInspectorEdit();
  const [docsOpen, setDocsOpen] = useState(false);
  const [pending, setPending] = useState<PendingPortChange | null>(null);
  const component = doc.components[componentId];

  const entries = useMemo(
    () =>
      patchIds.flatMap((id): Entry[] => {
        const node = component?.patches[id];
        const ports = node ? resolveNodePorts(doc, node, registry) : undefined;
        return node && ports ? [{ id, node, ports }] : [];
      }),
    [doc, component, patchIds, registry],
  );
  const sources = useMemo(() => patchSources(doc, componentId, patchIds, registry), [doc, componentId, patchIds, registry]);
  const fields = useMemo(() => intersectFields(sources), [sources]);

  if (!component || entries.length === 0) {
    return <EmptyState size="sm" icon={<Shapes size={16} />} title="Unknown patch" description="This patch's type isn't in the patch library, so its properties can't be shown." />;
  }

  const first = entries[0]!;
  const single = entries.length === 1 ? first : undefined;
  const spec = first.ports.spec;
  const sameType = entries.every((e) => e.node.type === first.node.type);
  const subject = subjectLabel(entries.map((e) => e.node.name ?? e.ports.spec.name), "patch");
  const updateAll = (build: (e: Entry) => Op | undefined, label: string) => edit.apply(entries.flatMap((e) => build(e) ?? []), label);
  const CategoryIcon = CATEGORY_ICONS[spec.category];
  const implemented = spec.type === "component" || isPatchImplemented(registry, spec.type);
  const { primary, more } = splitAdvanced(fields);
  const renderRow = (field: InspectorField) => <FieldRow key={field.key} field={field} subject={subject} {...(single && field.link ? { liveAddress: field.link } : {})} />;

  /** Apply a Type or count change, first asking when it would disconnect cables. */
  const changePorts = (kind: PendingPortChange["kind"], build: (e: Entry) => Op | undefined, label: string, title: string) => {
    const ops = entries.flatMap((e) => build(e) ?? []);
    if (ops.length === 0) return;
    const state = session.document.getState();
    const plan = planPortChange(state.doc, componentId, registry, ops);
    if (!plan.ok || plan.lost.length === 0) {
      setPending(null);
      edit.apply(ops, label);
      return;
    }
    setPending({ kind, ops, label, title, plan, revision: state.revision });
  };

  const confirmPortChange = (withConverters: boolean) => {
    if (!pending) return;
    const state = session.document.getState();
    let plan: PortChangePlan = pending.plan;
    if (state.revision !== pending.revision) plan = planPortChange(state.doc, componentId, registry, pending.ops);
    setPending(null);
    if (!plan.ok || !withConverters || plan.converterCount === 0) {
      edit.apply(pending.ops, pending.label);
      return;
    }
    const converter = plan.lost.find((l) => l.converter)?.converter;
    const label = `${pending.label} and insert ${plan.converterCount === 1 && converter ? converter.patchName : `${plan.converterCount} converters`}`;
    const result = edit.apply([...pending.ops, ...plan.converterOps], label);
    if (result?.ok) {
      const added = Object.values(result.idMap);
      toast({
        id: "inspector-converters",
        title: added.length === 1 && converter ? `Inserted ${converter.patchName}` : `Inserted ${added.length} converters`,
        description: "The cables that no longer fit go through them now.",
        tone: "success",
        action: { label: "Show", onClick: () => session.selection.getState().requestReveal(componentId, added) },
      });
    }
  };

  const overflow: MenuEntry[] = [
    { id: "reveal", label: "Reveal in Patch Editor", icon: <ScanSearch size={14} />, onSelect: () => session.selection.getState().requestReveal(componentId, entries.map((e) => e.id)) },
    ...(single
      ? ([
          {
            id: "copyId",
            label: "Copy Patch Id",
            icon: <Copy size={14} />,
            description: single.id,
            onSelect: () => void globalThis.navigator?.clipboard?.writeText(single.id).then(() => toast({ id: "inspector-copied", title: `Copied ${single.id}`, tone: "success" }), () => undefined),
          },
        ] satisfies MenuEntry[])
      : []),
  ];

  const typeParams = new Set(entries.map((e) => e.ports.typeParam));
  const counts = new Set(entries.map((e) => e.ports.inputCount));
  const inputCount = first.ports.inputCount ?? spec.variadic?.defaultCount ?? 0;
  const hasOptions = sameType && (!!spec.variants?.length || !!spec.variadic || !!spec.settings?.length);
  const variadicName = spec.variadic?.name ?? "";

  const settingActions = (setting: SettingSpec): FieldActions => {
    const run = (update: Parameters<FieldActions["set"]>[0], options: { gesture?: string }) => {
      const c = session.document.getState().doc.components[componentId];
      if (!c) return;
      const ops = entries.flatMap((e, index): Op[] => {
        const node = c.patches[e.id];
        if (!node) return [];
        const current = settingValue(node, setting);
        const next = typeof update === "function" ? update(current, index) : update;
        if (sameInputValue(current, next)) return [];
        const raw = isJsonLiteral(next) ? next.json : next;
        return [{ op: "updatePatch", component: componentId, id: e.id, settings: { [setting.key]: raw as NonNullable<PatchNode["settings"]>[string] } }];
      });
      edit.apply(ops, `Set ${setting.name} on ${subject}`, options);
    };
    return {
      change: (update) => run(update, { gesture: `setting:${setting.key}` }),
      set: (update) => {
        run(update, {});
        edit.endGesture();
      },
      commit: () => edit.endGesture(),
      reset: () => updateAll((e) => ({ op: "updatePatch", component: componentId, id: e.id, settings: { [setting.key]: null } }), `Reset ${setting.name} on ${subject}`),
      disconnect: () => undefined,
    };
  };

  const card = (kind: PendingPortChange["kind"]) => (pending?.kind === kind ? <PortChangeCard pending={pending} onConfirm={confirmPortChange} onCancel={() => setPending(null)} /> : null);

  return (
    <>
      <InspectorHeader
        icon={<CategoryIcon size={15} strokeWidth={1.75} />}
        accent={sameType ? categoryColorVar(spec.category) : undefined}
        name={single ? (single.node.name ?? "") : `${entries.length} patches`}
        placeholder={spec.name}
        allowEmpty
        {...(single ? { onRename: (name: string) => edit.apply([{ op: "rename", component: componentId, id: single.id, name }], `Rename ${single.node.name ?? spec.name} to ${name || spec.name}`) } : {})}
        subtitle={
          single ? (
            <>
              {CATEGORY_LABELS[spec.category]} · {spec.name}
              {single.ports.typeParam ? ` (${VALUE_TYPE_LABELS[single.ports.typeParam]})` : ""} · <span className="sb-mono">{single.id}</span>
            </>
          ) : sameType ? (
            `${spec.name} · ${entries.map((e) => e.id).join(", ")}`
          ) : (
            [...new Set(entries.map((e) => e.ports.spec.name))].join(", ")
          )
        }
        actions={
          <Menu aria-label="Patch options" placement="bottom-end" entries={overflow}>
            <IconButton size="sm" icon={<Ellipsis size={14} />} label="Patch options" />
          </Menu>
        }
      >
        {sameType && (
          <div className="sb-insp-patchdocs">
            <p className="sb-insp-summary">{spec.summary}</p>
            <div className="sb-insp-patchdocs__actions">
              <Button size="sm" variant="ghost" icon={<BookOpen size={13} />} aria-expanded={onLearnMore ? undefined : docsOpen} onClick={() => (onLearnMore ? onLearnMore(spec.type) : setDocsOpen((o) => !o))}>
                {docsOpen && !onLearnMore ? "Hide Details" : "Learn More"}
              </Button>
              {!implemented && (
                <Tooltip content="This patch isn't simulated yet, so the viewer uses default output values for it.">
                  <Badge size="sm" tone="warn" tabIndex={0}>
                    Preview only
                  </Badge>
                </Tooltip>
              )}
              {spec.status && spec.status !== "supported" && (
                <Tooltip content={spec.statusReason ?? "Limited on some platforms."}>
                  <Badge size="sm" tone="info" tabIndex={0}>
                    {spec.status === "web-limited" ? "Limited on web" : "Desktop and mobile only"}
                  </Badge>
                </Tooltip>
              )}
            </div>
            {docsOpen && !onLearnMore && (
              <div className="sb-insp-patchdocs__body">
                {spec.docs ? <DocsText markdown={spec.docs} /> : <p className="sb-insp-note">No extra details for this patch yet.</p>}
                {spec.commonMistakes?.length ? (
                  <>
                    <h4 className="sb-insp-patchdocs__heading">Common mistakes</h4>
                    <DocsText markdown={spec.commonMistakes.map((m) => `- ${m}`).join("\n")} />
                  </>
                ) : null}
                {spec.pairsWellWith?.length ? (
                  <>
                    <h4 className="sb-insp-patchdocs__heading">Pairs well with</h4>
                    <div className="sb-insp-patchdocs__pairs">
                      {spec.pairsWellWith.map((type) => (
                        <Badge key={type} size="sm">
                          {registry.patches.get(type)?.name ?? type}
                        </Badge>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
            )}
          </div>
        )}
      </InspectorHeader>

      {(hasOptions || single) && (
        <InspectorSection id="patch.options" title="Options">
          {sameType && spec.variants?.length ? (
            <>
              <OptionRow label="Type" description="The kind of value this patch works with. When cables no longer fit, you can insert converters or disconnect them.">
                <Select
                  size="sm"
                  aria-label="Value type"
                  className="sb-insp-select"
                  value={typeParams.size === 1 ? (first.ports.typeParam ?? null) : null}
                  mixed={typeParams.size > 1}
                  options={spec.variants.map((t) => ({ value: t, label: VALUE_TYPE_LABELS[t] }))}
                  onChange={(typeParam) => {
                    const name = VALUE_TYPE_LABELS[typeParam as ValueType] ?? typeParam;
                    changePorts("type", (e) => (e.ports.typeParam === typeParam ? undefined : { op: "updatePatch", component: componentId, id: e.id, typeParam }), `Set type of ${subject} to ${name}`, `Switching to ${name}`);
                  }}
                />
              </OptionRow>
              {card("type")}
            </>
          ) : null}
          {sameType && spec.variadic ? (
            <>
              <OptionRow label={`${spec.variadic.name}s`} description={`How many ${spec.variadic.name.toLowerCase()} ${spec.variadic.direction === "outputs" ? "outputs" : "inputs"} it has (${spec.variadic.min}–${spec.variadic.max}).`}>
                <div className="sb-insp-stepper" role="group" aria-label={`${spec.variadic.name} count`}>
                  <IconButton
                    size="xs"
                    variant="secondary"
                    icon={<Minus size={12} />}
                    label={`Remove a ${variadicName.toLowerCase()}`}
                    disabled={inputCount <= spec.variadic.min}
                    onClick={() =>
                      changePorts(
                        "count",
                        (e) => ({ op: "updatePatch", component: componentId, id: e.id, inputCount: Math.max(spec.variadic!.min, (e.ports.inputCount ?? inputCount) - 1) }),
                        `Remove ${variadicName} from ${subject}`,
                        `Removing ${variadicName} ${inputCount}`,
                      )
                    }
                  />
                  <span className="sb-insp-stepper__value sb-tabular" aria-live="polite">
                    {counts.size === 1 ? inputCount : "–"}
                  </span>
                  <IconButton
                    size="xs"
                    variant="secondary"
                    icon={<Plus size={12} />}
                    label={`Add a ${variadicName.toLowerCase()}`}
                    disabled={inputCount >= spec.variadic.max}
                    onClick={() =>
                      changePorts(
                        "count",
                        (e) => ({ op: "updatePatch", component: componentId, id: e.id, inputCount: Math.min(spec.variadic!.max, (e.ports.inputCount ?? inputCount) + 1) }),
                        `Add ${variadicName} to ${subject}`,
                        `Adding ${variadicName} ${inputCount + 1}`,
                      )
                    }
                  />
                </div>
              </OptionRow>
              {card("count")}
            </>
          ) : null}
          {sameType &&
            spec.settings?.map((setting) => (
              <OptionRow key={setting.key} label={setting.name} description={setting.description}>
                <ValueControl field={settingField(setting, entries)} actions={settingActions(setting)} label={setting.name} />
              </OptionRow>
            ))}
          {single && (
            <OptionRow label="Bypass" description="Mute the patch: matching inputs pass straight through to its outputs.">
              <Toggle size="sm" aria-label="Bypass" checked={!!single.node.muted} onChange={(muted) => edit.apply([{ op: "updatePatch", component: componentId, id: single.id, muted }], `${muted ? "Bypass" : "Unbypass"} ${subject}`)} />
            </OptionRow>
          )}
        </InspectorSection>
      )}

      {single && isSpringPatch(single.node.type) && <SpringSection patchId={single.id} node={single.node} spec={spec} subject={subject} />}

      <InspectorSection id="patch.inputs" title="Inputs" moreCount={more.length} more={more.map(renderRow)}>
        {fields.length === 0 ? <p className="sb-insp-note">{entries.length > 1 && !sameType ? "These patches don't share any inputs." : "This patch has no inputs to set."}</p> : primary.map(renderRow)}
      </InspectorSection>

      {single && single.ports.outputs.length > 0 && (
        <InspectorSection id="patch.outputs" title="Outputs">
          <ul className="sb-insp-outputs">
            {single.ports.outputs.map((port) => (
              <li key={port.key} className="sb-insp-output">
                <PortGlyph type={port.type} size={8} />
                <Tooltip content={port.description} placement="left" delay={700}>
                  <span className="sb-insp-output__name">{port.name}</span>
                </Tooltip>
                <LiveValue address={`${single.id}.${port.key}`} type={port.type} />
              </li>
            ))}
          </ul>
        </InspectorSection>
      )}
    </>
  );
}
