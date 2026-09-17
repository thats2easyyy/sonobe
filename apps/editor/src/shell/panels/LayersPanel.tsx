import type { LayerNode } from "@sonobe/core";
import { ArrowDownToLine, ArrowUpToLine, Component, Copy, Eye, EyeOff, Lock, LockOpen, PanelLeftClose, Plus, Pointer, Search, Trash, X } from "lucide-react";
import { useMemo, useState, type MouseEvent } from "react";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { Menu, useContextMenu, type MenuEntry } from "../../ui/Menu.tsx";
import { TextField } from "../../ui/TextField.tsx";
import { toast } from "../../ui/Toast.tsx";
import { TreeView } from "../../ui/TreeView.tsx";
import { getAncestorIds, moveTreeNodes } from "../../ui/lib/treeModel.ts";
import { LayerTypeIcon } from "../icons.tsx";
import { MOCK_LAYERS } from "../mockData.ts";
import { Panel } from "../Panel.tsx";

const CONTAINER_TYPES = new Set(["group", "shader", "componentInstance"]);

const isHidden = (node: LayerNode) => node.props.enabled === false;

function mapTree(nodes: readonly LayerNode[], id: string, fn: (node: LayerNode) => LayerNode): LayerNode[] {
  return nodes.map((node) => (node.id === id ? fn(node) : node.children ? { ...node, children: mapTree(node.children, id, fn) } : node));
}

function removeFromTree(nodes: readonly LayerNode[], ids: ReadonlySet<string>): LayerNode[] {
  return nodes.filter((n) => !ids.has(n.id)).map((n) => (n.children ? { ...n, children: removeFromTree(n.children, ids) } : n));
}

function collectIds(nodes: readonly LayerNode[], out = new Set<string>()): Set<string> {
  for (const n of nodes) {
    out.add(n.id);
    if (n.children) collectIds(n.children, out);
  }
  return out;
}

function uniqueId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

function findWithParent(nodes: readonly LayerNode[], id: string, parentId: string | null = null): { node: LayerNode; parentId: string | null; index: number } | null {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    if (node.id === id) return { node, parentId, index: i };
    const found = node.children ? findWithParent(node.children, id, node.id) : null;
    if (found) return found;
  }
  return null;
}

/** Prune to layers whose name matches, keeping their ancestors. */
function filterTree(nodes: readonly LayerNode[], query: string): LayerNode[] {
  const q = query.trim().toLowerCase();
  const out: LayerNode[] = [];
  for (const node of nodes) {
    const children = node.children ? filterTree(node.children, q) : [];
    if (node.name.toLowerCase().includes(q) || children.length > 0) out.push({ ...node, children });
  }
  return out;
}

const INSERTABLE: { type: string; label: string; shortcut?: string }[] = [
  { type: "rectangle", label: "Rectangle", shortcut: "R" },
  { type: "oval", label: "Oval", shortcut: "O" },
  { type: "text", label: "Text", shortcut: "T" },
  { type: "image", label: "Image" },
  { type: "group", label: "Group" },
  { type: "hitArea", label: "Hit Area" },
  { type: "shader", label: "Shader" },
];

const TOUCH_INTERACTIONS = ["Tap", "Long Press", "Drag", "Scroll Y", "Scroll X", "Hover"];

export function LayersPanel({ onCollapse }: { onCollapse?: () => void }) {
  const [layers, setLayers] = useState<LayerNode[]>(MOCK_LAYERS);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["card", "like_button"]));
  const [selected, setSelected] = useState<Set<string>>(() => new Set(["card"]));
  const [filter, setFilter] = useState("");
  const menu = useContextMenu();

  const filtered = useMemo(() => (filter.trim() ? filterTree(layers, filter) : layers), [layers, filter]);
  const filterExpanded = useMemo(() => (filter.trim() ? collectIds(filtered) : null), [filter, filtered]);

  const update = (id: string, fn: (node: LayerNode) => LayerNode) => setLayers((current) => mapTree(current, id, fn));

  const insertLayer = (type: string, label: string) => {
    setLayers((current) => {
      const id = uniqueId(type === "hitArea" ? "hit_area" : type, collectIds(current));
      setSelected(new Set([id]));
      return [{ id, type, name: label, props: {}, children: CONTAINER_TYPES.has(type) ? [] : undefined }, ...current];
    });
  };

  const addInteraction = (node: LayerNode, interaction: string) =>
    toast({ title: `Added ${interaction} to “${node.name}”`, description: "An Interaction patch is wired to this layer in the patch editor.", tone: "success" });

  const touchEntries = (node: LayerNode): MenuEntry[] => [
    { type: "label", label: "Add interaction" },
    ...TOUCH_INTERACTIONS.map((name) => ({ id: `touch_${name}`, label: name, onSelect: () => addInteraction(node, name) })),
  ];

  const rowEntries = (node: LayerNode): MenuEntry[] => {
    const hidden = isHidden(node);
    const bump = (direction: -1 | 1) =>
      setLayers((current) => {
        const location = findWithParent(current, node.id);
        if (!location) return current;
        const index = direction === -1 ? location.index - 1 : location.index + 2;
        return moveTreeNodes(current, [node.id], { parentId: location.parentId, index: Math.max(0, index) }, (n, children) => ({ ...n, children }));
      });
    return [
      {
        id: "duplicate",
        label: "Duplicate",
        icon: <Copy size={14} />,
        shortcut: "Mod+D",
        onSelect: () =>
          setLayers((current) => {
            const location = findWithParent(current, node.id);
            if (!location) return current;
            const taken = collectIds(current);
            const clone = (n: LayerNode): LayerNode => {
              const id = uniqueId(`${n.id}_copy`, taken);
              taken.add(id);
              return { ...n, id, children: n.children?.map(clone) };
            };
            const copy = { ...clone(node), name: `${node.name} Copy` };
            const withCopy = (list: readonly LayerNode[], parentId: string | null): LayerNode[] => {
              if (parentId === location.parentId) {
                const next = [...list];
                next.splice(location.index, 0, copy);
                return next;
              }
              return list.map((n) => (n.children ? { ...n, children: withCopy(n.children, n.id) } : n));
            };
            setSelected(new Set([copy.id]));
            return withCopy(current, null);
          }),
      },
      { id: "component", label: "Create Component", icon: <Component size={14} />, shortcut: "Ctrl+Mod+G", onSelect: () => toast({ title: `Made “${node.name}” a component`, tone: "success" }) },
      { type: "separator" },
      { id: "touch", label: "Add Interaction", icon: <Pointer size={14} />, submenu: TOUCH_INTERACTIONS.map((name) => ({ id: `ctx_${name}`, label: name, onSelect: () => addInteraction(node, name) })) },
      { type: "separator" },
      { id: "forward", label: "Bring Forward", icon: <ArrowUpToLine size={14} />, shortcut: "Mod+Alt+ArrowUp", onSelect: () => bump(-1) },
      { id: "backward", label: "Send Backward", icon: <ArrowDownToLine size={14} />, shortcut: "Mod+Alt+ArrowDown", onSelect: () => bump(1) },
      { type: "separator" },
      { id: "visibility", label: hidden ? "Show" : "Hide", icon: hidden ? <Eye size={14} /> : <EyeOff size={14} />, shortcut: "Mod+Shift+H", onSelect: () => update(node.id, (n) => ({ ...n, props: { ...n.props, enabled: hidden } })) },
      { id: "lock", label: node.locked ? "Unlock" : "Lock", icon: node.locked ? <LockOpen size={14} /> : <Lock size={14} />, shortcut: "Mod+Shift+L", onSelect: () => update(node.id, (n) => ({ ...n, locked: !n.locked })) },
      { type: "separator" },
      {
        id: "delete",
        label: "Delete",
        icon: <Trash size={14} />,
        shortcut: "Backspace",
        danger: true,
        onSelect: () => {
          const ids = selected.has(node.id) ? selected : new Set([node.id]);
          setLayers((current) => removeFromTree(current, ids));
          setSelected(new Set());
        },
      },
    ];
  };

  return (
    <Panel
      title="Layers"
      scope="layers"
      actions={
        <>
          <Menu aria-label="Insert layer" entries={INSERTABLE.map((item) => ({ id: item.type, label: item.label, shortcut: item.shortcut, icon: <LayerTypeIcon type={item.type} />, onSelect: () => insertLayer(item.type, item.label) }))}>
            <IconButton size="sm" icon={<Plus size={14} />} label="Insert layer" shortcut="Mod+Enter" />
          </Menu>
          {onCollapse && <IconButton size="sm" icon={<PanelLeftClose size={14} />} label="Hide layers" shortcut="Mod+1" onClick={onCollapse} />}
        </>
      }
      footer={
        <TextField
          size="sm"
          aria-label="Filter layers"
          placeholder="Filter layers"
          leading={<Search size={12} strokeWidth={2} />}
          trailing={filter && <IconButton size="xs" icon={<X size={11} />} label="Clear filter" tooltip={false} onClick={() => setFilter("")} />}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          onCancel={() => setFilter("")}
        />
      }
    >
      <div className="sb-layers">
        <div className="sb-layers__root">
          <Component size={13} strokeWidth={1.75} aria-hidden />
          <span className="sb-layers__root-name">Main</span>
          <span className="sb-layers__root-meta">Prototype</span>
        </div>
        <TreeView<LayerNode>
          aria-label="Layers"
          className="sb-layers__tree"
          nodes={filtered}
          getLabel={(node) => node.name}
          expanded={filterExpanded ?? expanded}
          onExpandedChange={filterExpanded ? undefined : setExpanded}
          selected={selected}
          onSelectedChange={setSelected}
          canHaveChildren={(node) => CONTAINER_TYPES.has(node.type)}
          canDrag={(node) => !node.locked}
          onRename={(id, name) => update(id, (node) => ({ ...node, name }))}
          onMove={(ids, target) => {
            setLayers((current) => moveTreeNodes(current, ids, target, (node, children) => ({ ...node, children })));
            if (target.parentId) setExpanded((current) => new Set([...current, ...(getAncestorIds(layers, target.parentId!) ?? []), target.parentId!]));
          }}
          isDimmed={isHidden}
          renderIcon={(node) => <LayerTypeIcon type={node.type} size={14} />}
          renderTrailing={(node) =>
            node.locked || isHidden(node) ? (
              <>
                {isHidden(node) && <EyeOff size={12} strokeWidth={1.75} aria-label="Hidden" />}
                {node.locked && <Lock size={12} strokeWidth={1.75} aria-label="Locked" />}
              </>
            ) : null
          }
          renderActions={(node) => (
            <>
              <IconButton
                size="xs"
                icon={<Pointer size={12} />}
                label="Add interaction"
                tooltip="Add interaction (Touch)"
                onClick={(event: MouseEvent<HTMLButtonElement>) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  menu.openAt({ x: rect.left, y: rect.bottom + 2, width: 0, height: 0 }, touchEntries(node), event.currentTarget);
                }}
              />
              <IconButton
                size="xs"
                icon={isHidden(node) ? <EyeOff size={12} /> : <Eye size={12} />}
                label={isHidden(node) ? "Show layer" : "Hide layer"}
                shortcut="Mod+Shift+H"
                onClick={() => update(node.id, (n) => ({ ...n, props: { ...n.props, enabled: isHidden(n) } }))}
              />
              <IconButton
                size="xs"
                icon={node.locked ? <Lock size={12} /> : <LockOpen size={12} />}
                label={node.locked ? "Unlock layer" : "Lock layer"}
                shortcut="Mod+Shift+L"
                onClick={() => update(node.id, (n) => ({ ...n, locked: !n.locked }))}
              />
            </>
          )}
          onRowContextMenu={(node, event) => {
            event.preventDefault();
            menu.open(event, rowEntries(node));
          }}
          emptyState={
            <EmptyState size="sm" icon={<Search size={16} />} title="No matching layers" description={filter ? `Nothing here is named “${filter}”.` : "Insert a layer with the + button."} />
          }
        />
      </div>
      {menu.element}
    </Panel>
  );
}
