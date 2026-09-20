import { allLayers, COMPONENT_INSTANCE_LAYER_TYPE, findLayer, isLinkInput, loopShapes, wouldCreateComponentCycle, type Id, type LayerCopies, type LayerNode, type LayerTypeSpec, type Op } from "@sonobe/core";
import {
  ArrowDownToLine,
  ArrowUpToLine,
  BringToFront,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  Component,
  Copy,
  CopyPlus,
  Eye,
  EyeOff,
  Group,
  ListFilter,
  Lock,
  LockOpen,
  LogIn,
  PanelLeftClose,
  Plus,
  Pointer,
  Repeat,
  ScanSearch,
  Search,
  SendToBack,
  Trash,
  Ungroup,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { LayerTypeIcon } from "../../shell/icons.tsx";
import { Panel } from "../../shell/Panel.tsx";
import { dragHasFiles, filesFromDataTransfer } from "../../state/assets.ts";
import { parseClipboardFragment, serializeClipboardFragment, type ClipboardFragment } from "../../state/clipboard.ts";
import {
  arrangeLayers,
  copySelection,
  createComponentFromSelection,
  deleteSelection,
  duplicateSelection,
  exitComponent,
  groupSelection,
  pasteFragment,
  ungroupSelection,
  type ActionResult,
  type ArrangeDirection,
} from "../../state/editActions.ts";
import { useDocument, useEditorSession, useLiveValues, useSelection } from "../../state/EditorProvider.tsx";
import { selectBreadcrumbs } from "../../state/selection.ts";
import { Button } from "../../ui/Button.tsx";
import { useOptionalCommands } from "../../ui/commands/CommandProvider.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { Menu, useContextMenu, type MenuEntry } from "../../ui/Menu.tsx";
import { TextField } from "../../ui/TextField.tsx";
import { toast } from "../../ui/Toast.tsx";
import { Tooltip } from "../../ui/Tooltip.tsx";
import { TreeView } from "../../ui/TreeView.tsx";
import { cx } from "../../ui/lib/cx.ts";
import { getAncestorIds } from "../../ui/lib/treeModel.ts";
import { layerDropAttributes, useCableDrag } from "../patch-editor/api.ts";
import { layerAcceptsCable, layerHoverKey, useCableHover } from "./cableHover.ts";
import { displayTree, filterLayerTree, isFiltering, parentLayerIds, planInsertLayer, planLayerMove, relatedPatchIds, treeIds } from "./layerTree.ts";
import { dragMediaKinds, dropFilesOnLayers, planLayerFileDrop } from "./mediaDrop.ts";
import { touchMenuEntries } from "./touchActions.tsx";
import "./LayersPanel.css";

export interface LayersPanelProps {
  /** Collapse the panel to its rail; the shell passes this. Omit to hide the collapse button. */
  onCollapse?: () => void;
  className?: string;
}

const EMPTY_LAYERS: readonly LayerNode[] = [];

const LAYER_CATEGORY_ORDER: readonly LayerTypeSpec["category"][] = ["shape", "basic", "media", "container", "advanced", "component"];

const LAYER_CATEGORY_LABELS: Readonly<Record<LayerTypeSpec["category"], string>> = {
  shape: "Shapes",
  basic: "Basic",
  media: "Media",
  container: "Containers",
  advanced: "Advanced",
  component: "Components",
};

const KIND_LABELS = { prototype: "Prototype", layerComponent: "Layer component", patchComponent: "Patch component" } as const;

const isHidden = (node: LayerNode) => node.props.enabled === false;

const collapsedFromDocument = (layers: readonly LayerNode[]): ReadonlySet<Id> => new Set(allLayers(layers).filter((l) => l.collapsed).map((l) => l.id));

/** The layer a row element belongs to (rows carry the id on their icon). */
const rowLayerId = (target: EventTarget | null): Id | null => (target as Element | null)?.closest?.(".sb-tree__row")?.querySelector("[data-layer-id]")?.getAttribute("data-layer-id") ?? null;

/** The copies a layer drew last frame, for a ×N badge whose count only the running prototype knows. */
function LiveCopies({ layerId }: { layerId: Id }) {
  const address = `@${layerId}.repeat`;
  const value = useLiveValues([address], { hz: 4 })[address];
  return <>{typeof value === "number" ? `×${value}` : "×"}</>;
}

const zText = (z: unknown) => (typeof z === "number" ? `${Math.round(z * 100) / 100}` : "");

/**
 * A row's copy and stacking badges: ×N on a layer that makes copies of itself (with a repeat icon
 * when its Repeat decides how many), and z on a layer with a Z Position, which orders it among its
 * siblings before the layer list does.
 */
function LayerBadges({ node, copies }: { node: LayerNode; copies: LayerCopies }) {
  const z = node.props.zPosition;
  const zLinked = isLinkInput(z);
  const showZ = zLinked || (typeof z === "number" && z !== 0);
  const makes = copies.kind === "repeat" || copies.kind === "auto";
  if (!makes && !showZ) return null;
  const count = makes ? copies.count : null;
  const copyTip = !makes
    ? ""
    : copies.kind === "repeat"
      ? `Repeat makes ${count === null ? "one copy per item of its loop" : `${count} ${count === 1 ? "copy" : "copies"}`}, and everything inside follows.`
      : `${count === null ? "One copy" : `${count} ${count === 1 ? "copy" : "copies"}, one`} per item of the longest loop on its own properties. Set Repeat to decide how many.`;
  const zTip = zLinked
    ? "Z Position comes from a patch. It orders this layer among its siblings before the layer list does."
    : (z as number) > 0
      ? `Z Position ${zText(z)}: draws in front of siblings with a lower Z Position, whatever the layer order.`
      : `Z Position ${zText(z)}: draws behind siblings with a higher Z Position, whatever the layer order.`;
  return (
    <span className="sb-layerspanel__badges">
      {makes && (
        <Tooltip content={copyTip} delay={400}>
          <span className="sb-layerspanel__badge sb-mono" data-kind="copies" aria-label={copyTip}>
            {copies.kind === "repeat" && <Repeat size={10} strokeWidth={2} aria-hidden />}
            {count === null ? <LiveCopies layerId={node.id} /> : `×${count}`}
          </span>
        </Tooltip>
      )}
      {showZ && (
        <Tooltip content={zTip} delay={400}>
          <span className="sb-layerspanel__badge sb-mono" data-kind="z" aria-label={zLinked ? "Z Position from a patch" : `Z Position ${zText(z)}`}>
            z{zLinked ? "" : zText(z)}
          </span>
        </Tooltip>
      )}
    </span>
  );
}

function report(result: ActionResult): void {
  if (result.ok && result.note) toast({ title: result.note.message, ...(result.note.hint ? { description: result.note.hint } : {}), tone: "neutral" });
  if (!result.ok && result.message) toast({ title: result.message, ...(result.hint ? { description: result.hint } : {}), tone: "warn" });
}

/**
 * The Layers panel: the current component's layer tree, front-most first. Select (Shift / ⌘ for
 * more), rename (double-click or Enter), drag to reorder or reparent, hide and lock from the row,
 * add pre-wired interactions with Touch, insert any layer type, filter by name or type, and act on
 * the selection from the context menu. Hovering a row highlights the layer elsewhere. A cable
 * dragged from the patch editor onto a row lists that layer's properties to drive, and files dropped
 * on the panel become media layers (or replace the media of the layer they land on).
 */
export function LayersPanel({ onCollapse, className }: LayersPanelProps) {
  const session = useEditorSession();
  const registry = session.registry;
  const commands = useOptionalCommands();
  const doc = useDocument((s) => s.doc);
  const componentPath = useSelection((s) => s.componentPath);
  const selectedLayers = useSelection((s) => s.layers);
  const hovered = useSelection((s) => s.hovered);
  const reveal = useSelection((s) => s.reveal);
  const componentId = componentPath.at(-1) ?? doc.project.root;
  const component = doc.components[componentId];
  const layers = component?.layers ?? EMPTY_LAYERS;
  /** A patch component is never drawn, so it can't hold layers (core refuses them too). */
  const canHoldLayers = component?.kind !== "patchComponent";
  const menu = useContextMenu();
  const bodyRef = useRef<HTMLDivElement>(null);
  const pendingScroll = useRef<Id | null>(null);
  const [query, setQuery] = useState("");
  const [types, setTypes] = useState<ReadonlySet<string>>(() => new Set());
  const [collapsedByComponent, setCollapsedByComponent] = useState<Readonly<Record<Id, ReadonlySet<Id>>>>({});
  const [fileDrop, setFileDrop] = useState<{ layerId: Id | null; label: string } | null>(null);
  const drag = useCableDrag(session);
  const cableActive = drag !== null && drag.component === componentId;
  const cableHover = useCableHover(cableActive);

  const typeName = useCallback((type: string) => registry.layers.get(type)?.name ?? type, [registry]);
  /** How each layer makes copies, read from the document (the badges' counts). */
  const shapes = useMemo(() => (component ? loopShapes(doc, componentId, registry) : null), [doc, component, componentId, registry]);
  const display = useMemo(() => displayTree(layers), [layers]);
  const filter = useMemo(() => ({ query, types }), [query, types]);
  const filtering = isFiltering(filter);
  const nodes = useMemo(() => (filtering ? filterLayerTree(display, filter, typeName) : display), [display, filter, filtering, typeName]);
  const collapsed = collapsedByComponent[componentId] ?? collapsedFromDocument(layers);
  const expanded = useMemo(() => (filtering ? treeIds(nodes) : new Set(parentLayerIds(display).filter((id) => !collapsed.has(id)))), [filtering, nodes, display, collapsed]);
  const selected = useMemo(() => new Set(selectedLayers), [selectedLayers]);
  /** Layers with a property the dragged cable can drive. */
  const accepting = useMemo(
    () => (cableActive ? new Set(allLayers(layers).filter((layer) => layerAcceptsCable(doc, componentId, registry, layer, drag)).map((layer) => layer.id)) : null),
    [cableActive, layers, doc, componentId, registry, drag],
  );
  const sel = () => session.selection.getState();

  const expandTo = useCallback(
    (ids: readonly Id[]) => {
      const ancestors = new Set(ids.flatMap((id) => getAncestorIds(layers, id) ?? []));
      if (ancestors.size === 0) return;
      setCollapsedByComponent((current) => {
        const before = current[componentId] ?? collapsedFromDocument(layers);
        if (![...before].some((id) => ancestors.has(id))) return current;
        return { ...current, [componentId]: new Set([...before].filter((id) => !ancestors.has(id))) };
      });
    },
    [componentId, layers],
  );

  useEffect(() => {
    if (selectedLayers.length === 0) return;
    expandTo(selectedLayers);
    pendingScroll.current = selectedLayers.at(-1)!;
    // Only a selection change should expand; collapsing a selected layer's parent must stick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLayers]);

  useEffect(() => {
    if (!reveal || reveal.component !== componentId) return;
    const revealed = reveal.ids.filter((id) => findLayer(layers, id));
    if (revealed.length === 0) return;
    expandTo(revealed);
    pendingScroll.current = revealed[0]!;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal?.nonce]);

  useEffect(() => {
    const id = pendingScroll.current;
    if (!id) return;
    pendingScroll.current = null;
    const row = bodyRef.current?.querySelector(`[data-layer-id="${id}"]`)?.closest(".sb-tree__row");
    (row as HTMLElement | null | undefined)?.scrollIntoView?.({ block: "nearest" });
  });

  const apply = (ops: readonly Op[], label: string) => {
    if (ops.length === 0) return undefined;
    const result = session.document.getState().apply(ops, { label, defaultComponent: componentId });
    if (!result.ok) {
      const error = result.errors[0];
      toast({ title: error?.message ?? "That change couldn't be made.", ...(error?.hint ? { description: error.hint } : {}), tone: "warn" });
    }
    return result;
  };

  /** Run a registered document command (so shortcuts and behavior match the menus), else the action directly. */
  const run = (commandId: string, fallback: () => void) => {
    if (commands?.registry.get(commandId)) commands.registry.run(commandId);
    else fallback();
  };

  const layerById = (id: Id) => findLayer(layers, id)?.layer;

  /** A row action applies to the whole selection when the row is part of it. */
  const targetsFor = (node: LayerNode): LayerNode[] => {
    const ids = sel().layers.includes(node.id) ? sel().layers : [node.id];
    return ids.map(layerById).filter((l): l is LayerNode => !!l);
  };

  const subject = (list: readonly LayerNode[]) => (list.length === 1 ? list[0]!.name : `${list.length} layers`);

  const toggleVisibility = (node: LayerNode) => {
    const targets = targetsFor(node);
    const editable = targets.filter((l) => !isLinkInput(l.props.enabled));
    if (editable.length === 0) {
      toast({ title: "Enabled is driven by a patch here.", description: "Disconnect Enabled in the inspector to toggle it by hand.", tone: "warn" });
      return;
    }
    const show = isHidden(node);
    apply(
      editable.map((l): Op => ({ op: "updateLayer", component: componentId, id: l.id, props: { enabled: show ? null : false } })),
      `${show ? "Show" : "Hide"} ${subject(editable)}`,
    );
  };

  const toggleLock = (node: LayerNode) => {
    const targets = targetsFor(node);
    const lock = !node.locked;
    apply(
      targets.map((l): Op => ({ op: "updateLayer", component: componentId, id: l.id, locked: lock })),
      `${lock ? "Lock" : "Unlock"} ${subject(targets)}`,
    );
  };

  const insert = (type: string, instanceOf?: Id) => {
    if (!canHoldLayers) return;
    const current = session.document.getState().doc;
    const plan = planInsertLayer(current, componentId, registry, type, { ...(sel().layers.at(-1) ? { anchor: sel().layers.at(-1)! } : {}), ...(instanceOf ? { component: instanceOf } : {}) });
    if (!plan) return;
    const result = apply([plan.op], `Add ${plan.name}`);
    const id = result?.idMap[plan.ref];
    if (result?.ok && id) sel().select({ layers: [id] });
  };

  const revealInPatchEditor = (targets: readonly LayerNode[]) => {
    if (!component) return;
    const ids = [...new Set(targets.flatMap((l) => relatedPatchIds(component, l.id)))];
    if (ids.length === 0) {
      toast({ title: `${targets.length === 1 ? `“${targets[0]!.name}” isn't` : "These layers aren't"} used by any patches yet.`, description: "Use Touch on the row to add an interaction.", tone: "neutral" });
      return;
    }
    sel().requestReveal(componentId, ids);
  };

  const copyFallback = async () => {
    const fragment = copySelection(session);
    if (!fragment) return;
    try {
      await globalThis.navigator?.clipboard?.writeText(serializeClipboardFragment(fragment));
    } catch {
      // Permission denied: the session clipboard still holds it.
    }
  };

  const pasteFallback = async () => {
    let fragment: ClipboardFragment | null = null;
    try {
      const text = await globalThis.navigator?.clipboard?.readText();
      if (text) fragment = parseClipboardFragment(text);
    } catch {
      // Permission denied or not a Sonobe fragment: fall back to the session clipboard.
    }
    fragment ??= session.clipboard;
    if (!fragment) {
      toast({ title: "There's nothing to paste.", description: "Copy layers or patches first.", tone: "neutral" });
      return;
    }
    report(pasteFragment(session, fragment));
  };

  const insertEntries = (): MenuEntry[] => {
    const specs = [...registry.layers.values()];
    const out: MenuEntry[] = [];
    for (const category of LAYER_CATEGORY_ORDER) {
      const list = specs.filter((s) => s.category === category);
      if (list.length === 0) continue;
      out.push({ type: "label", id: `label-${category}`, label: LAYER_CATEGORY_LABELS[category] });
      for (const spec of list) {
        if (spec.type !== COMPONENT_INSTANCE_LAYER_TYPE) {
          out.push({ id: `insert-${spec.type}`, label: spec.name, icon: <LayerTypeIcon type={spec.type} />, onSelect: () => insert(spec.type) });
          continue;
        }
        const targets = Object.values(doc.components).filter((c) => c.kind === "layerComponent" && !wouldCreateComponentCycle(doc, componentId, c.id));
        out.push(
          targets.length
            ? { id: "insert-componentInstance", label: "Component Instance", icon: <LayerTypeIcon type={spec.type} />, submenu: targets.map((c): MenuEntry => ({ id: `insert-instance-${c.id}`, label: c.name, onSelect: () => insert(spec.type, c.id) })) }
            : { id: "insert-componentInstance", label: "Component Instance", icon: <LayerTypeIcon type={spec.type} />, description: "Select layers and choose Create Component first.", disabled: true },
        );
      }
    }
    return out;
  };

  const arrangeEntry = (id: string, label: string, direction: ArrangeDirection, icon: ReactNode): MenuEntry => ({
    id,
    label,
    icon,
    onSelect: () => run(`layer.${id}`, () => report(arrangeLayers(session, direction))),
  });

  const rowEntries = (node: LayerNode): MenuEntry[] => {
    const targets = targetsFor(node);
    const single = targets.length === 1;
    const hidden = isHidden(node);
    const hasGroup = targets.some((l) => l.type === "group");
    const instance = single && node.type === COMPONENT_INSTANCE_LAYER_TYPE && node.component ? doc.components[node.component] : undefined;
    return [
      { id: "touch", label: "Add Interaction", icon: <Pointer size={14} />, disabled: !single, ...(single ? { submenu: touchMenuEntries(session, node.id).filter((e) => e.type !== "label") } : { description: "Select one layer" }) },
      { type: "separator" },
      { id: "copy", label: "Copy", icon: <Copy size={14} />, shortcut: "Mod+C", onSelect: () => run("edit.copy", () => void copyFallback()) },
      { id: "paste", label: "Paste", icon: <ClipboardPaste size={14} />, shortcut: "Mod+V", onSelect: () => run("edit.paste", () => void pasteFallback()) },
      { id: "duplicate", label: "Duplicate", icon: <CopyPlus size={14} />, shortcut: "Mod+D", onSelect: () => run("edit.duplicate", () => report(duplicateSelection(session))) },
      { type: "separator" },
      { id: "group", label: "Group", icon: <Group size={14} />, shortcut: "Mod+G", onSelect: () => run("layer.group", () => report(groupSelection(session))) },
      { id: "ungroup", label: "Ungroup", icon: <Ungroup size={14} />, shortcut: "Mod+Shift+G", disabled: !hasGroup, onSelect: () => run("layer.ungroup", () => report(ungroupSelection(session))) },
      { id: "createComponent", label: "Create Component", icon: <Component size={14} />, shortcut: "Mod+Ctrl+G", onSelect: () => run("layer.createComponent", () => report(createComponentFromSelection(session))) },
      ...(instance ? [{ id: "enterComponent", label: `Edit “${instance.name}”`, icon: <LogIn size={14} />, shortcut: "Alt+ArrowDown", onSelect: () => sel().enterComponent(instance.id) } satisfies MenuEntry] : []),
      { type: "separator" },
      { id: "reveal", label: "Reveal in Patch Editor", icon: <ScanSearch size={14} />, onSelect: () => revealInPatchEditor(targets) },
      { id: "visibility", label: hidden ? "Show" : "Hide", icon: hidden ? <Eye size={14} /> : <EyeOff size={14} />, onSelect: () => toggleVisibility(node) },
      { id: "lock", label: node.locked ? "Unlock" : "Lock", icon: node.locked ? <LockOpen size={14} /> : <Lock size={14} />, onSelect: () => toggleLock(node) },
      {
        id: "arrange",
        label: "Arrange",
        icon: <BringToFront size={14} />,
        submenu: [
          arrangeEntry("bringToFront", "Bring to Front", "front", <BringToFront size={14} />),
          arrangeEntry("bringForward", "Bring Forward", "forward", <ArrowUpToLine size={14} />),
          arrangeEntry("sendBackward", "Send Backward", "backward", <ArrowDownToLine size={14} />),
          arrangeEntry("sendToBack", "Send to Back", "back", <SendToBack size={14} />),
        ],
      },
      { type: "separator" },
      { id: "delete", label: "Delete", icon: <Trash size={14} />, shortcut: "Backspace", danger: true, onSelect: () => run("edit.delete", () => report(deleteSelection(session))) },
    ];
  };

  const backgroundEntries = (): MenuEntry[] => [
    { id: "paste", label: "Paste", icon: <ClipboardPaste size={14} />, shortcut: "Mod+V", onSelect: () => run("edit.paste", () => void pasteFallback()) },
    ...(canHoldLayers ? ([{ type: "separator" }, { id: "insert", label: "Insert Layer", icon: <Plus size={14} />, submenu: insertEntries() }] satisfies MenuEntry[]) : []),
  ];

  const typeFilterEntries = (): MenuEntry[] => {
    const present = [...new Set(allLayers(layers).map((l) => l.type))].sort((a, b) => typeName(a).localeCompare(typeName(b)));
    return [
      { type: "label", label: "Show layer types" },
      ...present.map(
        (type): MenuEntry => ({
          id: `type-${type}`,
          label: typeName(type),
          icon: <LayerTypeIcon type={type} />,
          checked: types.has(type),
          keepOpen: true,
          onSelect: () =>
            setTypes((current) => {
              const next = new Set(current);
              if (next.has(type)) next.delete(type);
              else next.add(type);
              return next;
            }),
        }),
      ),
      { type: "separator" },
      { id: "type-all", label: "Show All Types", disabled: types.size === 0, onSelect: () => setTypes(new Set()) },
    ];
  };

  const highlighted =
    hovered && hovered.component === componentId && hovered.source !== "layers" && (hovered.kind === "layer" || (hovered.kind === "port" && hovered.address?.startsWith("@"))) ? hovered.id : null;

  const onPointerOver = (event: PointerEvent<HTMLDivElement>) => {
    const row = (event.target as Element).closest?.(".sb-tree__row");
    const id = row?.querySelector("[data-layer-id]")?.getAttribute("data-layer-id") ?? null;
    const current = sel().hovered;
    if (!id) {
      if (current?.source === "layers") sel().setHovered(null);
      return;
    }
    sel().setHovered({ kind: "layer", id, component: componentId, source: "layers" });
  };

  const onPointerLeave = () => {
    if (sel().hovered?.source === "layers") sel().setHovered(null);
  };

  const onBackgroundPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const target = event.target as Element;
    if (event.button === 0 && (target.classList.contains("sb-tree") || target.classList.contains("sb-tree__canvas"))) sel().clear();
  };

  const onBackgroundContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || (event.target as Element).closest(".sb-tree__row")) return;
    event.preventDefault();
    menu.open(event, backgroundEntries());
  };

  // Files from the desktop: replace a media layer's content, go into a group, or become new layers.
  const onFileDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!dragHasFiles(event.dataTransfer) || !component || !canHoldLayers) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    const layerId = rowLayerId(event.target);
    const label = planLayerFileDrop(doc, componentId, registry, layerId, dragMediaKinds(event.dataTransfer.items))?.label ?? "Add files";
    setFileDrop((current) => (current && current.layerId === layerId && current.label === label ? current : { layerId, label }));
  };

  const onFileDragLeave = (event: DragEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) return;
    setFileDrop(null);
  };

  const onFileDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!dragHasFiles(event.dataTransfer) || !canHoldLayers) return;
    event.preventDefault();
    setFileDrop(null);
    const files = filesFromDataTransfer(event.dataTransfer);
    if (files.length === 0 || !component) return;
    void dropFilesOnLayers(session, componentId, rowLayerId(event.target), files).then((result) => {
      if (result.errors.length) {
        toast({
          id: "layers-drop",
          title: result.errors[0]!,
          ...(result.errors.length > 1 ? { description: `${result.errors.length - 1} more ${result.errors.length === 2 ? "file" : "files"} couldn't be added either.` } : {}),
          tone: "warn",
        });
      }
      if (result.ok && result.layerIds.length) sel().select({ layers: result.layerIds });
    });
  };

  const crumbs = selectBreadcrumbs({ componentPath }, doc);

  const emptyState = filtering ? (
    <EmptyState
      size="sm"
      icon={<Search size={16} />}
      title="No matching layers"
      description={query.trim() ? `Nothing here matches “${query.trim()}”.` : "No layers of the chosen types."}
      actions={
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setQuery("");
            setTypes(new Set());
          }}
        >
          Clear Filter
        </Button>
      }
    />
  ) : !canHoldLayers ? (
    <EmptyState
      size="sm"
      icon={<Component size={16} />}
      title="Patch components have no layers"
      description="A patch component is logic only, like a function: edit its patches in the patch editor. To reuse layers, select them in a prototype and choose Create Component."
    />
  ) : (
    <EmptyState
      size="sm"
      icon={<LayerTypeIcon type="rectangle" size={16} />}
      title="No layers yet"
      description="Layers are what people see and touch. Start with a shape, some text, or an image, or drop an image file here."
      actions={
        <>
          {["rectangle", "text", "image"].filter((type) => registry.layers.has(type)).map((type) => (
            <Button key={type} size="sm" variant="secondary" icon={<LayerTypeIcon type={type} size={13} />} onClick={() => insert(type)}>
              {typeName(type)}
            </Button>
          ))}
        </>
      }
    />
  );

  return (
    <Panel
      title="Layers"
      scope="layers"
      className={cx("sb-layerspanel-panel", className)}
      actions={
        <>
          {canHoldLayers ? (
            <Menu aria-label="Insert layer" placement="bottom-end" entries={insertEntries}>
              <IconButton size="sm" icon={<Plus size={14} />} label="Insert layer" />
            </Menu>
          ) : (
            <IconButton size="sm" icon={<Plus size={14} />} label="Insert layer" tooltip="Patch components hold only patches" disabled />
          )}
          {onCollapse && <IconButton size="sm" icon={<PanelLeftClose size={14} />} label="Hide layers" shortcut="Mod+1" onClick={onCollapse} />}
        </>
      }
      footer={
        <div className="sb-layerspanel__filter">
          <TextField
            size="sm"
            aria-label="Filter layers"
            placeholder="Filter by name or type"
            containerClassName="sb-layerspanel__search"
            leading={<Search size={12} strokeWidth={2} />}
            trailing={query ? <IconButton size="xs" icon={<X size={11} />} label="Clear filter" tooltip={false} onClick={() => setQuery("")} /> : undefined}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onCancel={() => setQuery("")}
          />
          <Menu aria-label="Filter by layer type" placement="top-end" entries={typeFilterEntries}>
            <IconButton size="sm" icon={<ListFilter size={13} />} label={types.size ? `Showing ${types.size} layer ${types.size === 1 ? "type" : "types"}` : "Filter by type"} active={types.size > 0} badge={types.size > 0} />
          </Menu>
        </div>
      }
    >
      <div className="sb-layerspanel" onFocusCapture={() => sel().setFocusedPanel("layers")}>
        <div className="sb-layerspanel__component">
          {crumbs.length > 1 && <IconButton size="xs" icon={<ChevronLeft size={13} />} label="Exit component" shortcut="Alt+ArrowUp" onClick={() => exitComponent(session)} />}
          <Component size={13} strokeWidth={1.75} aria-hidden className="sb-layerspanel__component-icon" />
          <nav aria-label="Component path" className="sb-layerspanel__crumbs">
            {crumbs.map((crumb, i) =>
              i < crumbs.length - 1 ? (
                <span key={crumb.id} className="sb-layerspanel__crumb-item">
                  <button type="button" className="sb-layerspanel__crumb" onClick={() => sel().setComponentPath(crumb.path)}>
                    {crumb.name}
                  </button>
                  <ChevronRight size={11} aria-hidden />
                </span>
              ) : (
                <span key={crumb.id} className="sb-layerspanel__crumb" aria-current="page">
                  {crumb.name}
                </span>
              ),
            )}
          </nav>
          {component && <span className="sb-layerspanel__kind">{KIND_LABELS[component.kind]}</span>}
        </div>
        <div
          ref={bodyRef}
          className="sb-layerspanel__body"
          data-cable={cableActive ? "" : undefined}
          data-file-drop={fileDrop ? (fileDrop.layerId === null ? "panel" : "row") : undefined}
          onPointerOver={onPointerOver}
          onPointerLeave={onPointerLeave}
          onPointerDown={onBackgroundPointerDown}
          onContextMenu={onBackgroundContextMenu}
          onDragOver={onFileDragOver}
          onDragLeave={onFileDragLeave}
          onDrop={onFileDrop}
        >
          <TreeView<LayerNode>
            aria-label="Layers"
            className="sb-layerspanel__tree"
            nodes={nodes}
            getLabel={(node) => node.name}
            expanded={expanded}
            onExpandedChange={
              filtering
                ? undefined
                : (next) => setCollapsedByComponent((current) => ({ ...current, [componentId]: new Set(parentLayerIds(display).filter((id) => !next.has(id))) }))
            }
            selected={selected}
            onSelectedChange={(next) => sel().select({ layers: [...next] })}
            canHaveChildren={(node) => registry.layers.get(node.type)?.canHaveChildren ?? false}
            canDrag={(node) => !node.locked && !filtering}
            onRename={(id, name) => {
              const layer = layerById(id);
              if (layer) apply([{ op: "rename", component: componentId, id, name }], `Rename ${layer.name} to ${name}`);
            }}
            onMove={
              filtering || !component
                ? undefined
                : (ids, target) => {
                    const moving = ids.map(layerById).filter((l): l is LayerNode => !!l && !l.locked);
                    const ops = planLayerMove(component, moving.map((l) => l.id), target);
                    apply(ops, `Move ${subject(moving)}`);
                  }
            }
            onActivate={(node) => {
              if (node.type === COMPONENT_INSTANCE_LAYER_TYPE && node.component && doc.components[node.component]) sel().enterComponent(node.component);
            }}
            onRowContextMenu={(node, event) => {
              event.preventDefault();
              menu.open(event, rowEntries(node));
            }}
            isDimmed={isHidden}
            // A cable released anywhere on a row lists that layer's properties (the patch editor looks for these attributes).
            getRowProps={accepting ? (node) => layerDropAttributes(node.id) : undefined}
            renderIcon={(node) => (
              <span className="sb-layerspanel__icon" data-layer-id={node.id} data-kind={node.type === COMPONENT_INSTANCE_LAYER_TYPE ? "component" : undefined}>
                <LayerTypeIcon type={node.type} size={14} />
              </span>
            )}
            renderTrailing={(node) => {
              const accepts = accepting?.has(node.id) ?? false;
              const cableOver = accepts && cableHover === layerHoverKey(node.id);
              return (
                <>
                  {highlighted === node.id && <span className="sb-layerspanel__hover" aria-hidden />}
                  {shapes && <LayerBadges node={node} copies={shapes.copies(node.id)} />}
                  {(isHidden(node) || node.locked) && (
                    <span className="sb-layerspanel__status">
                      {isHidden(node) && <EyeOff size={12} strokeWidth={1.75} aria-label="Hidden" />}
                      {node.locked && <Lock size={12} strokeWidth={1.75} aria-label="Locked" />}
                    </span>
                  )}
                  {accepting && (
                    <span className="sb-layerspanel__drop" data-kind="cable" data-accept={accepts || undefined} data-hover={cableOver || undefined}>
                      {cableOver && <span className="sb-layerspanel__drop-label">Choose a property</span>}
                    </span>
                  )}
                  {fileDrop?.layerId === node.id && (
                    <span className="sb-layerspanel__drop" data-kind="file" data-hover aria-hidden>
                      <span className="sb-layerspanel__drop-label">{fileDrop.label}</span>
                    </span>
                  )}
                </>
              );
            }}
            renderActions={(node) => {
              const hidden = isHidden(node);
              return (
                <>
                  <Menu aria-label={`Add an interaction to ${node.name}`} placement="bottom-end" entries={() => touchMenuEntries(session, node.id)}>
                    <IconButton size="xs" icon={<Pointer size={12} />} label={`Touch: add an interaction to ${node.name}`} tooltip="Touch: add an interaction" />
                  </Menu>
                  <IconButton size="xs" icon={hidden ? <EyeOff size={12} /> : <Eye size={12} />} label={hidden ? `Show ${node.name}` : `Hide ${node.name}`} tooltip={hidden ? "Show" : "Hide"} onClick={() => toggleVisibility(node)} />
                  <IconButton size="xs" icon={node.locked ? <Lock size={12} /> : <LockOpen size={12} />} label={node.locked ? `Unlock ${node.name}` : `Lock ${node.name}`} tooltip={node.locked ? "Unlock" : "Lock"} active={node.locked} onClick={() => toggleLock(node)} />
                </>
              );
            }}
            emptyState={<div className="sb-layerspanel__empty">{emptyState}</div>}
          />
          {fileDrop?.layerId === null && (
            <div className="sb-layerspanel__filedrop" role="status">
              <Upload size={13} strokeWidth={2} aria-hidden />
              {fileDrop.label}
            </div>
          )}
        </div>
      </div>
      {menu.element}
    </Panel>
  );
}
