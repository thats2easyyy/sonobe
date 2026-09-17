/** Patch picker, link-drag search, splice chooser, and patch info: registry-backed search and docs. */

import { findLayer, getPatchSpec, resolveNodePorts, type Id, type PatchSpec, type ValueType } from "@sonobe/core";
import { isPatchImplemented } from "../../../state/registry.ts";
import { ArrowRight, CornerDownLeft, Layers } from "lucide-react";
import { Fragment, useMemo, type CSSProperties, type ReactNode } from "react";
import { useStore } from "zustand";
import { CATEGORY_LABELS, categoryColorVar } from "../../../theme/tokens.ts";
import { Badge } from "../../../ui/Badge.tsx";
import { Button } from "../../../ui/Button.tsx";
import { Dialog } from "../../../ui/Dialog.tsx";
import { Kbd } from "../../../ui/Kbd.tsx";
import { MenuList, type MenuEntry } from "../../../ui/Menu.tsx";
import { Popover } from "../../../ui/Popover.tsx";
import { PortGlyph, VALUE_TYPE_LABELS } from "../../../ui/PortGlyph.tsx";
import { SearchList, type SearchListRenderContext } from "../../../ui/SearchList.tsx";
import type { SpliceOption } from "../model/editOps.ts";
import { LINK_SEARCH_KEYS, linkCandidateGroup, linkCandidates, type LayerLinkItem, type LinkCandidate, type LinkSearchItem, type OutputLinkItem } from "../model/linkSearch.ts";
import { PICKER_KEYS, pickerItems, type PickerItem } from "../model/picker.ts";
import type { LinkSearchRequest, PickerRequest, XY } from "../state/actions.ts";
import { usePatchEditor } from "../state/context.ts";
import { CATEGORY_ICONS, LAYER_ICONS } from "./icons.ts";

// ---------------------------------------------------------------------------
// Patch picker
// ---------------------------------------------------------------------------

export interface PatchPickerDialogProps {
  request: PickerRequest | null;
  onClose: () => void;
  onPick: (item: PickerItem, request: PickerRequest) => void;
}

/** ⌥⏎ or double-click the canvas: search every patch by name, alias, or port, with docs alongside. */
export function PatchPickerDialog({ request, onClose, onPick }: PatchPickerDialogProps) {
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && onClose()} aria-label={request?.replace ? "Replace patch" : "Insert patch"} placement="top" width={820} modalScope="patchPicker" className="sb-pe-picker">
      {request && <PickerBody request={request} onClose={onClose} onPick={onPick} />}
    </Dialog>
  );
}

function PickerBody({ request, onClose, onPick }: { request: PickerRequest; onClose: () => void; onPick: PatchPickerDialogProps["onPick"] }) {
  const { session, registry, componentId } = usePatchEditor();
  const components = useStore(session.document, (s) => s.doc.components);
  const items = useMemo(() => pickerItems(registry, session.document.getState().doc), [registry, components]); // eslint-disable-line react-hooks/exhaustive-deps
  const replacing = request.replace ? components[componentId]?.patches[request.replace] : undefined;
  const replacingName = replacing ? replacing.name || getPatchSpec(registry, replacing.type)?.name || replacing.type : undefined;
  const pick = (item: PickerItem) => {
    onClose();
    onPick(item, request);
  };
  return (
    <SearchList
      size="lg"
      aria-label="Patches"
      placeholder={replacingName ? `Replace ${replacingName} with…` : "Search patches by name, alias, or port…"}
      items={items}
      keys={PICKER_KEYS}
      getId={(item) => item.id}
      groupBy={(item) => (item.componentId ? "Components in this project" : CATEGORY_LABELS[item.spec.category])}
      onSelect={pick}
      limit={120}
      emptyState={(query) => (
        <div className="sb-pe-picker__empty">
          <div>No patches match “{query}”.</div>
          <div className="sb-pe-picker__empty-hint">Try what it does, like “spring”, “toggle”, or “fetch”.</div>
        </div>
      )}
      renderItem={(item, ctx) => {
        const Icon = CATEGORY_ICONS[item.spec.category];
        const alias = ctx.matches.aliases;
        const port = ctx.matches.ports;
        return (
          <div className="sb-pe-picker__item" style={{ "--sb-cat": categoryColorVar(item.spec.category) } as CSSProperties}>
            <span className="sb-pe-picker__icon" aria-hidden>
              <Icon size={13} strokeWidth={2} />
            </span>
            <span className="sb-pe-picker__name">{ctx.highlight("name", item.name)}</span>
            {alias && !ctx.matches.name && <span className="sb-pe-picker__alias">{ctx.highlight("aliases", alias.value)}</span>}
            {port && !ctx.matches.name && !alias && <span className="sb-pe-picker__alias">port: {ctx.highlight("ports", port.value)}</span>}
            {item.spec.shortcut && <Kbd className="sb-pe-picker__key">{item.spec.shortcut.replace("Shift+", "⇧")}</Kbd>}
          </div>
        );
      }}
      renderPreview={(item) => (item ? <PatchPreview item={item} onInsert={() => pick(item)} replacing={!!request.replace} /> : null)}
      footer={
        <>
          <span className="sb-pe-picker__hint">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> browse
          </span>
          <span className="sb-pe-picker__hint">
            <Kbd>
              <CornerDownLeft size={10} strokeWidth={2.25} />
            </Kbd>
            {request.replace ? "replace" : "insert"}
          </span>
          <span className="sb-pe-picker__hint sb-pe-picker__hint--end">Tip: hover the patch editor and press a letter, like A for Pop Animation</span>
        </>
      }
    />
  );
}

function PortList({ title, ports, variants }: { title: string; ports: readonly { key: string; name: string; type: ValueType | "variant" }[]; variants?: readonly ValueType[] | undefined }) {
  if (ports.length === 0) return null;
  const variantLabel = variants?.length ? `${VALUE_TYPE_LABELS[variants[0]!]}${variants.length > 1 ? ` +${variants.length - 1}` : ""}` : "Any type";
  return (
    <div className="sb-pe-picker__ports">
      <div className="sb-pe-eyebrow">{title}</div>
      {ports.map((port) => (
        <div key={port.key} className="sb-pe-picker__port">
          <PortGlyph type={port.type === "variant" && variants?.length ? variants[0]! : port.type} size={8} />
          <span className="sb-pe-picker__port-name">{port.name}</span>
          <span className="sb-pe-picker__port-type" title={port.type === "variant" && variants ? `Set with Change Type: ${variants.map((v) => VALUE_TYPE_LABELS[v]).join(", ")}` : undefined}>
            {port.type === "variant" ? variantLabel : VALUE_TYPE_LABELS[port.type]}
          </span>
        </div>
      ))}
    </div>
  );
}

function PatchPreview({ item, onInsert, replacing }: { item: PickerItem; onInsert: () => void; replacing: boolean }) {
  const { registry } = usePatchEditor();
  const spec = item.spec;
  const Icon = CATEGORY_ICONS[spec.category];
  const variadic = spec.variadic ? [{ key: `${spec.variadic.key}n`, name: `${spec.variadic.name} 1…${spec.variadic.defaultCount}`, type: spec.variadic.type }] : [];
  return (
    <div className="sb-pe-picker__preview" style={{ "--sb-cat": categoryColorVar(spec.category) } as CSSProperties}>
      <div className="sb-pe-picker__preview-head">
        <span className="sb-pe-picker__preview-icon" aria-hidden>
          <Icon size={16} strokeWidth={2} />
        </span>
        <div className="sb-pe-picker__preview-titles">
          <div className="sb-pe-picker__preview-title">{item.name}</div>
          <div className="sb-pe-picker__preview-category">
            {CATEGORY_LABELS[spec.category]}
            {spec.tier === 3 ? " · Hardware" : ""}
          </div>
        </div>
        <Button size="sm" variant="primary" onClick={onInsert}>
          {replacing ? "Replace" : "Insert"}
        </Button>
      </div>
      <p className="sb-pe-picker__summary">{spec.summary}</p>
      {spec.status && spec.status !== "supported" && <p className="sb-pe-picker__status">{spec.statusReason ?? "Limited on the web."}</p>}
      <div className="sb-pe-picker__port-grid">
        <PortList title="Inputs" ports={[...spec.inputs.filter((p) => !p.advanced), ...variadic]} variants={spec.variants} />
        <PortList title="Outputs" ports={spec.outputs} variants={spec.variants} />
      </div>
      {spec.pairsWellWith?.length ? (
        <div className="sb-pe-picker__pairs">
          <span className="sb-pe-eyebrow">Pairs well with</span>
          <div className="sb-pe-picker__chips">
            {spec.pairsWellWith.map((type) => (
              <span key={type} className="sb-pe-picker__chip">
                {getPatchSpec(registry, type)?.name ?? type}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {spec.shortcut && (
        <div className="sb-pe-picker__shortcut">
          Quick insert: hover the patch editor and press <Kbd>{spec.shortcut.replace("Shift+", "⇧")}</Kbd>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Link-drag search
// ---------------------------------------------------------------------------

export interface LinkDragSearchProps {
  request: LinkSearchRequest | null;
  onClose: () => void;
  onPick: (item: LinkCandidate, request: LinkSearchRequest) => void;
}

function searchLabel(request: LinkSearchRequest | null): string {
  if (request?.layer) return "Connect to a layer property";
  if (request?.drive) return "Choose what drives this property";
  return "Connect to a new patch";
}

/** Drop a cable on empty canvas (or a layer): pick a patch, a layer property, or an output to connect it to. */
export function LinkDragSearch({ request, onClose, onPick }: LinkDragSearchProps) {
  return (
    <Popover
      open={request !== null}
      onOpenChange={(open) => !open && onClose()}
      anchor={request ? { x: request.client.x, y: request.client.y, width: 0, height: 0 } : null}
      placement={request?.placement ?? "bottom-start"}
      offset={8}
      initialFocus="none"
      aria-label={searchLabel(request)}
      className="sb-pe-linksearch"
    >
      {request && <LinkSearchBody request={request} onClose={onClose} onPick={onPick} />}
    </Popover>
  );
}

function PatchCandidate({ item, ctx, side }: { item: LinkSearchItem; ctx: SearchListRenderContext; side: "in" | "out" }) {
  const Icon = CATEGORY_ICONS[item.spec.category];
  return (
    <div className="sb-pe-linksearch__item" style={{ "--sb-cat": categoryColorVar(item.spec.category) } as CSSProperties}>
      <span className="sb-pe-picker__icon" aria-hidden>
        <Icon size={12} strokeWidth={2} />
      </span>
      <span className="sb-pe-picker__name">{ctx.highlight("name", item.spec.name)}</span>
      {item.typeParam && item.spec.variants && item.typeParam !== item.spec.variants[0] && <span className="sb-pe-chip">{VALUE_TYPE_LABELS[item.typeParam]}</span>}
      <span className="sb-pe-linksearch__port" data-exact={item.exact || undefined} title={item.conversion ? `Converted: ${item.conversion}` : undefined}>
        {side === "out" && <ArrowRight size={10} strokeWidth={2.25} aria-hidden />}
        <PortGlyph type={item.port.type} size={7} />
        {ctx.highlight("port", item.port.name)}
      </span>
    </div>
  );
}

function LayerCandidate({ item, ctx, singleLayer }: { item: LayerLinkItem; ctx: SearchListRenderContext; singleLayer: boolean }) {
  const Icon = LAYER_ICONS[item.layerType] ?? Layers;
  const name = singleLayer ? (
    ctx.highlight("prop", item.port.name)
  ) : ctx.matches.label ? (
    ctx.highlight("label", item.label)
  ) : (
    <>
      {ctx.highlight("layer", item.layerName)}
      <span className="sb-pe-linksearch__sep" aria-hidden>
        {" › "}
      </span>
      {ctx.highlight("prop", item.port.name)}
    </>
  );
  return (
    <div className="sb-pe-linksearch__item" style={{ "--sb-cat": "var(--category-layers)" } as CSSProperties}>
      <span className="sb-pe-picker__icon" aria-hidden>
        <Icon size={12} strokeWidth={2} />
      </span>
      <span className="sb-pe-picker__name">{name}</span>
      {!singleLayer && item.parents.length > 0 && <span className="sb-pe-picker__alias">in {item.parents.at(-1)}</span>}
      {item.driver && (
        <span className="sb-pe-chip" title={`Driven by ${item.driver}. Connecting replaces it.`}>
          Driven
        </span>
      )}
      <span className="sb-pe-linksearch__port" data-exact={item.exact || undefined} title={item.conversion ? `Converted: ${item.conversion}` : undefined}>
        <PortGlyph type={item.port.type} size={7} />
        {VALUE_TYPE_LABELS[item.port.type]}
      </span>
    </div>
  );
}

function OutputCandidate({ item, ctx }: { item: OutputLinkItem; ctx: SearchListRenderContext }) {
  const { session, registry, componentId } = usePatchEditor();
  const node = session.document.getState().doc.components[componentId]?.patches[item.nodeId];
  const spec = node ? getPatchSpec(registry, node.type) : undefined;
  const category = spec?.category ?? "components";
  const Icon = CATEGORY_ICONS[category];
  return (
    <div className="sb-pe-linksearch__item" style={{ "--sb-cat": categoryColorVar(category) } as CSSProperties}>
      <span className="sb-pe-picker__icon" aria-hidden>
        <Icon size={12} strokeWidth={2} />
      </span>
      <span className="sb-pe-picker__name">
        {ctx.matches.label ? (
          ctx.highlight("label", item.label)
        ) : (
          <>
            {ctx.highlight("layer", item.nodeTitle)}
            <span className="sb-pe-linksearch__sep" aria-hidden>
              {" › "}
            </span>
            {ctx.highlight("prop", item.port.name)}
          </>
        )}
      </span>
      <span className="sb-pe-linksearch__port" data-exact={item.exact || undefined} title={item.conversion ? `Converted: ${item.conversion}` : undefined}>
        <PortGlyph type={item.port.type} size={7} />
        {VALUE_TYPE_LABELS[item.port.type]}
      </span>
    </div>
  );
}

function LinkSearchBody({ request, onClose, onPick }: { request: LinkSearchRequest; onClose: () => void; onPick: LinkDragSearchProps["onPick"] }) {
  const { session, registry, componentId } = usePatchEditor();
  const items = useMemo(() => {
    const doc = session.document.getState().doc;
    return linkCandidates(doc, componentId, registry, {
      side: request.side,
      type: request.type,
      ...(request.patchType ? { patchType: request.patchType } : {}),
      ...(request.layer !== undefined ? { layerId: request.layer } : {}),
      ...(request.sourceNode !== undefined ? { exclude: request.sourceNode } : {}),
      ...(request.drive ? { drive: true } : {}),
      selectedLayers: session.selection.getState().layers,
    });
  }, [session, registry, componentId, request]);
  const doc = session.document.getState().doc;
  const component = doc.components[componentId];
  const layerName = request.layer !== undefined && component ? (findLayer(component.layers, request.layer)?.layer.name ?? request.layer) : undefined;
  const typeName = VALUE_TYPE_LABELS[request.type].toLowerCase();
  const placeholder =
    layerName !== undefined
      ? request.chooseProperty
        ? `Choose a property of ${layerName} to drive…`
        : request.side === "out"
          ? `Drive a property of ${layerName}…`
          : `Read a property of ${layerName}…`
      : request.drive
        ? `Drive ${request.targetName ?? "this property"} from…`
        : request.side === "out"
          ? `Connect ${typeName} to…`
          : `Drive this ${typeName} from…`;
  return (
    <SearchList<LinkCandidate>
      aria-label={layerName !== undefined ? `Properties of ${layerName}` : "Compatible patches and properties"}
      placeholder={placeholder}
      items={items}
      keys={LINK_SEARCH_KEYS}
      getId={(item) => item.id}
      limit={80}
      leading={<PortGlyph type={request.type} size={9} />}
      {...(layerName === undefined ? { groupBy: linkCandidateGroup } : {})}
      onSelect={(item) => {
        onClose();
        onPick(item, request);
      }}
      emptyState={(query) => (layerName !== undefined ? `${layerName} has no property that fits “${query}”.` : `Nothing that fits “${query}”.`)}
      renderItem={(item, ctx) =>
        item.kind === "patch" ? <PatchCandidate item={item} ctx={ctx} side={request.side} /> : item.kind === "layer" ? <LayerCandidate item={item} ctx={ctx} singleLayer={layerName !== undefined} /> : <OutputCandidate item={item} ctx={ctx} />
      }
      footer={
        <span className="sb-pe-picker__hint">
          <Kbd>
            <CornerDownLeft size={10} strokeWidth={2.25} />
          </Kbd>
          connect
        </span>
      }
      size="md"
    />
  );
}

// ---------------------------------------------------------------------------
// Splice chooser
// ---------------------------------------------------------------------------

export interface SpliceChoiceRequest {
  /** Viewport point to open at (the drop). */
  client: XY;
  /** The patch being spliced ("Photo Scale"). */
  title: string;
  options: readonly SpliceOption[];
}

/** ⌘-drag a patch onto a cable where several ports fit: choose which input takes the cable and which output drives on. */
export function SpliceChooser({ request, onChoose, onCancel }: { request: SpliceChoiceRequest | null; onChoose: (option: SpliceOption) => void; onCancel: () => void }) {
  if (!request) return null;
  const entries: MenuEntry[] = [
    { type: "label", id: "title", label: `Splice ${request.title} into the cable` },
    ...request.options.map(
      (o): MenuEntry => ({
        id: `${o.inputKey}>${o.outputKey}`,
        label: `${o.inputName} → ${o.outputName}`,
        description: o.conversions.length ? `Converts ${o.conversions.join(" · ")}` : `${VALUE_TYPE_LABELS[o.inputType]} in, ${VALUE_TYPE_LABELS[o.outputType]} out`,
        onSelect: () => onChoose(o),
      }),
    ),
    { type: "separator", id: "sep" },
    { id: "move", label: "Just Move It", description: "Leave the cable as it is", onSelect: onCancel },
  ];
  return (
    <Popover open anchor={{ x: request.client.x, y: request.client.y, width: 0, height: 0 }} onOpenChange={(open) => !open && onCancel()} placement="bottom-start" offset={8} initialFocus="none" role="presentation" className="sb-menu-popover sb-pe-splice">
      <MenuList entries={entries} autoFocus="first" aria-label="Choose ports for the splice" onClose={(reason) => reason !== "select" && onCancel()} />
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Patch info
// ---------------------------------------------------------------------------

function inline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("`") && part.endsWith("`") ? <code key={i}>{part.slice(1, -1)}</code> : part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>,
  );
}

/** Small markdown renderer for patch docs: headings, lists, code fences, inline code and bold. */
export function DocsText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("```")) {
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i]!.startsWith("```"); i++) code.push(lines[i]!);
      blocks.push(<pre key={blocks.length}>{code.join("\n")}</pre>);
    } else if (/^#{1,4} /.test(line)) {
      blocks.push(<h4 key={blocks.length}>{inline(line.replace(/^#+ /, ""))}</h4>);
    } else if (/^\s*[-*] /.test(line)) {
      const items: string[] = [];
      for (; i < lines.length && /^\s*[-*] /.test(lines[i]!); i++) items.push(lines[i]!.replace(/^\s*[-*] /, ""));
      i--;
      blocks.push(
        <ul key={blocks.length}>
          {items.map((item, j) => (
            <li key={j}>{inline(item)}</li>
          ))}
        </ul>,
      );
    } else if (line.trim()) {
      const para: string[] = [line];
      for (; i + 1 < lines.length && lines[i + 1]!.trim() && !/^(#|```|\s*[-*] )/.test(lines[i + 1]!); i++) para.push(lines[i + 1]!);
      blocks.push(<p key={blocks.length}>{inline(para.join(" "))}</p>);
    }
  }
  return <div className="sb-pe-docs">{blocks}</div>;
}

export function PatchInfoDialog({ patchId, onClose }: { patchId: Id | null; onClose: () => void }) {
  return (
    <Dialog open={patchId !== null} onOpenChange={(open) => !open && onClose()} aria-label="Patch info" width={600} className="sb-pe-info">
      {patchId && <InfoBody patchId={patchId} onClose={onClose} />}
    </Dialog>
  );
}

function InfoBody({ patchId, onClose }: { patchId: Id; onClose: () => void }) {
  const { session, registry, componentId } = usePatchEditor();
  const doc = useStore(session.document, (s) => s.doc);
  const node = doc.components[componentId]?.patches[patchId];
  const spec: PatchSpec | undefined = node ? getPatchSpec(registry, node.type) : undefined;
  if (!node || !spec) return <div className="sb-pe-info__body">This patch type isn't known.</div>;
  const ports = resolveNodePorts(doc, node, registry);
  const Icon = CATEGORY_ICONS[spec.category];
  const implemented = isPatchImplemented(registry, node.type);
  return (
    <div className="sb-pe-info__body sb-scroll" style={{ "--sb-cat": categoryColorVar(spec.category) } as CSSProperties}>
      <div className="sb-pe-picker__preview-head">
        <span className="sb-pe-picker__preview-icon" aria-hidden>
          <Icon size={16} strokeWidth={2} />
        </span>
        <div className="sb-pe-picker__preview-titles">
          <div className="sb-pe-picker__preview-title">{node.name || spec.name}</div>
          <div className="sb-pe-picker__preview-category">
            {spec.name} · {CATEGORY_LABELS[spec.category]} · <code>{patchId}</code>
          </div>
        </div>
        {!implemented && (
          <Badge tone="warn" size="sm">
            Preview only
          </Badge>
        )}
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      <p className="sb-pe-picker__summary">{spec.summary}</p>
      {!implemented && <p className="sb-pe-picker__status">This patch doesn't run yet, so it outputs default values in the viewer.</p>}
      <div className="sb-pe-picker__port-grid">
        <div className="sb-pe-info__ports">
          <div className="sb-pe-eyebrow">Inputs</div>
          {(ports?.inputs ?? []).map((p) => (
            <div key={p.key} className="sb-pe-info__port">
              <PortGlyph type={p.type} size={8} />
              <div>
                <div className="sb-pe-picker__port-name">
                  {p.name} <span className="sb-pe-picker__port-type">{VALUE_TYPE_LABELS[p.type]}</span>
                </div>
                <div className="sb-pe-info__desc">{p.description}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="sb-pe-info__ports">
          <div className="sb-pe-eyebrow">Outputs</div>
          {(ports?.outputs ?? []).map((p) => (
            <div key={p.key} className="sb-pe-info__port">
              <PortGlyph type={p.type} size={8} />
              <div>
                <div className="sb-pe-picker__port-name">
                  {p.name} <span className="sb-pe-picker__port-type">{VALUE_TYPE_LABELS[p.type]}</span>
                </div>
                <div className="sb-pe-info__desc">{p.description}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      {spec.docs && <DocsText text={spec.docs} />}
      {spec.commonMistakes?.length ? (
        <div className="sb-pe-info__section">
          <div className="sb-pe-eyebrow">Common mistakes</div>
          <ul className="sb-pe-docs">
            {spec.commonMistakes.map((m, i) => (
              <li key={i}>{inline(m)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {spec.examples?.length ? (
        <div className="sb-pe-info__section">
          <div className="sb-pe-eyebrow">Examples</div>
          {spec.examples.map((ex, i) => (
            <div key={i} className="sb-pe-info__example">
              <div className="sb-pe-picker__port-name">{ex.title}</div>
              {ex.description && <div className="sb-pe-info__desc">{ex.description}</div>}
              <pre>{ex.outline}</pre>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
