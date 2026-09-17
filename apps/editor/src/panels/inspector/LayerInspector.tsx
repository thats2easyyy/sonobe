/** Properties of the selected layers, generated from their layer type specs. */

import { COMPONENT_INSTANCE_LAYER_TYPE, findLayer, type Id, type Op } from "@sonobe/core";
import { Component, Copy, Ellipsis, Layers, Pointer, RotateCcw, ScanSearch } from "lucide-react";
import { useMemo } from "react";
import { LayerTypeIcon } from "../../shell/icons.tsx";
import { useDocument, useEditorSession, useSelection } from "../../state/EditorProvider.tsx";
import { currentComponentId } from "../../state/selection.ts";
import { Button } from "../../ui/Button.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { Menu, type MenuEntry } from "../../ui/Menu.tsx";
import { toast } from "../../ui/Toast.tsx";
import { relatedPatchIds } from "../layers/layerTree.ts";
import { touchMenuEntries } from "../layers/touchActions.tsx";
import { FieldRow } from "./FieldRow.tsx";
import { InspectorHeader } from "./Header.tsx";
import { intersectFields, layerSections, layerSources, splitAdvanced, subjectLabel, type InspectorField } from "./model.ts";
import { InspectorSection } from "./Section.tsx";
import { useInspectorEdit } from "./useInspectorEdit.ts";

export interface LayerInspectorProps {
  layerIds: readonly Id[];
}

export function LayerInspector({ layerIds }: LayerInspectorProps) {
  const session = useEditorSession();
  const registry = session.registry;
  const doc = useDocument((s) => s.doc);
  const componentId = useSelection(currentComponentId);
  const edit = useInspectorEdit();
  const component = doc.components[componentId];
  const sources = useMemo(() => layerSources(doc, componentId, layerIds, registry), [doc, componentId, layerIds, registry]);
  const fields = useMemo(() => intersectFields(sources), [sources]);
  const sections = useMemo(() => layerSections(fields), [fields]);

  const layers = component ? sources.map((s) => findLayer(component.layers, s.id)!.layer) : [];
  if (!component || layers.length === 0) return null;

  const single = layers.length === 1 ? layers[0]! : undefined;
  const spec = single ? registry.layers.get(single.type) : undefined;
  const subject = subjectLabel(layers.map((l) => l.name), "layer");
  const typeNames = [...new Set(layers.map((l) => registry.layers.get(l.type)?.name ?? l.type))];
  const instanceTarget = single?.type === COMPONENT_INSTANCE_LAYER_TYPE && single.component ? doc.components[single.component] : undefined;
  const publishedCount = instanceTarget ? Object.keys(instanceTarget.interface.inputs).length : 0;

  const revealInPatchEditor = () => {
    const ids = [...new Set(layers.flatMap((l) => relatedPatchIds(component, l.id)))];
    if (ids.length === 0) toast({ title: `${single ? `“${single.name}” isn't` : "These layers aren't"} used by any patches yet.`, description: "Use Touch to add an interaction.", tone: "neutral" });
    else session.selection.getState().requestReveal(componentId, ids);
  };

  const resetAll = () =>
    edit.apply(
      layers.filter((l) => Object.keys(l.props).length > 0).map((l): Op => ({ op: "updateLayer", component: componentId, id: l.id, props: Object.fromEntries(Object.keys(l.props).map((key) => [key, null])) })),
      `Reset properties on ${subject}`,
    );

  const overflow: MenuEntry[] = [
    { id: "reveal", label: "Reveal in Patch Editor", icon: <ScanSearch size={14} />, onSelect: revealInPatchEditor },
    { id: "reset", label: "Reset All Properties", icon: <RotateCcw size={14} />, disabled: layers.every((l) => Object.keys(l.props).length === 0), onSelect: resetAll },
    ...(single
      ? ([
          { type: "separator" },
          {
            id: "copyId",
            label: "Copy Layer Id",
            icon: <Copy size={14} />,
            description: single.id,
            onSelect: () => void globalThis.navigator?.clipboard?.writeText(single.id).then(() => toast({ id: "inspector-copied", title: `Copied ${single.id}`, tone: "success" }), () => undefined),
          },
        ] satisfies MenuEntry[])
      : []),
  ];

  const renderRow = (field: InspectorField) => (
    <FieldRow key={field.key} field={field} subject={subject} excludeLayers={layerIds} {...(single && field.link ? { liveAddress: field.targets[0]!.address } : {})} />
  );

  return (
    <>
      <InspectorHeader
        icon={single ? <LayerTypeIcon type={single.type} size={15} /> : <Layers size={15} strokeWidth={1.75} />}
        name={single ? single.name : `${layers.length} layers`}
        {...(single ? { onRename: (name: string) => edit.apply([{ op: "rename", component: componentId, id: single.id, name }], `Rename ${single.name} to ${name}`) } : {})}
        subtitle={
          single ? (
            <>
              {spec?.name ?? single.type} · <span className="sb-mono">{single.id}</span>
            </>
          ) : (
            typeNames.join(", ")
          )
        }
        actions={
          <>
            {single && (
              <Menu aria-label={`Add an interaction to ${single.name}`} placement="bottom-end" entries={() => touchMenuEntries(session, single.id)}>
                <Button size="sm" variant="secondary" icon={<Pointer size={13} />}>
                  Touch
                </Button>
              </Menu>
            )}
            <Menu aria-label="Layer options" placement="bottom-end" entries={overflow}>
              <IconButton size="sm" icon={<Ellipsis size={14} />} label="Layer options" />
            </Menu>
          </>
        }
      >
        {spec?.summary && <p className="sb-insp-summary">{spec.summary}</p>}
      </InspectorHeader>

      {single?.type === COMPONENT_INSTANCE_LAYER_TYPE && (
        <div className="sb-insp-card">
          <span className="sb-insp-card__icon" aria-hidden>
            <Component size={14} strokeWidth={1.75} />
          </span>
          <div className="sb-insp-card__text">
            <div className="sb-insp-card__title">{instanceTarget?.name ?? "Missing component"}</div>
            <div className="sb-insp-card__meta">
              {instanceTarget
                ? publishedCount
                  ? `${publishedCount} published ${publishedCount === 1 ? "input" : "inputs"}`
                  : "No published inputs yet. Publish some inside the component."
                : `This instance points at “${single.component ?? "nothing"}”, which doesn't exist.`}
            </div>
          </div>
          <Button size="sm" variant="secondary" disabled={!instanceTarget} onClick={() => instanceTarget && session.selection.getState().enterComponent(instanceTarget.id)}>
            Edit Component
          </Button>
        </div>
      )}

      {sections.length === 0 && <p className="sb-insp-note">These layers don't share any properties.</p>}
      {sections.map((section) => {
        const { primary, more } = splitAdvanced(section.fields);
        return (
          <InspectorSection key={section.id} id={`layer.${section.id}`} title={section.title} moreCount={more.length} more={more.map(renderRow)}>
            {primary.map(renderRow)}
          </InspectorSection>
        );
      })}
    </>
  );
}
