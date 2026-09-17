import { ChevronRight, Minus, Plus, WandSparkles } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import { categoryColorVar, portColorVar } from "../../theme/tokens.ts";
import { IconButton } from "../../ui/IconButton.tsx";
import { PortGlyph } from "../../ui/PortGlyph.tsx";
import { toast } from "../../ui/Toast.tsx";
import { useElementSize } from "../../ui/lib/useElementSize.ts";
import { MOCK_GRAPH, type MockNode } from "../mockData.ts";
import { Panel } from "../Panel.tsx";

const NODE_W = 160;
const HEADER_H = 28;
const ROW_H = 22;
const FOOT_H = 6;

const nodeWidth = (node: MockNode) => node.width ?? NODE_W;
const nodeHeight = (node: MockNode) => HEADER_H + Math.max(node.inputs.length, node.outputs.length, 1) * ROW_H + FOOT_H;

function portPoint(node: MockNode, side: "in" | "out", key: string): [number, number] | null {
  const ports = side === "in" ? node.inputs : node.outputs;
  const index = ports.findIndex((p) => p.key === key);
  if (index < 0) return null;
  return [side === "in" ? node.x : node.x + nodeWidth(node), node.y + HEADER_H + index * ROW_H + ROW_H / 2];
}

function cablePath([x1, y1]: [number, number], [x2, y2]: [number, number]): string {
  const dx = Math.max(36, Math.abs(x2 - x1) * 0.5);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

function PatchNode({ node, selected }: { node: MockNode; selected: boolean }) {
  const rows = Math.max(node.inputs.length, node.outputs.length, 1);
  return (
    <div
      className="sb-pnode"
      data-selected={selected || undefined}
      style={{ left: node.x, top: node.y, width: nodeWidth(node), "--sb-cat": categoryColorVar(node.category) } as CSSProperties}
    >
      <div className="sb-pnode__header">
        <span className="sb-pnode__cat" aria-hidden />
        <span className="sb-pnode__title">{node.name}</span>
        {node.loop && <span className="sb-pnode__loop sb-tabular">×{node.loop}</span>}
      </div>
      <div className="sb-pnode__rows">
        {Array.from({ length: rows }, (_, i) => {
          const input = node.inputs[i];
          const output = node.outputs[i];
          return (
            <div key={i} className="sb-pnode__row">
              <div className="sb-pnode__in">
                {input && (
                  <>
                    <span className="sb-pnode__port" data-side="in">
                      <PortGlyph type={input.type} connected={input.connected ?? false} />
                    </span>
                    <span className="sb-pnode__label">{input.name}</span>
                    {input.value && !input.connected && <span className="sb-pnode__value">{input.value}</span>}
                  </>
                )}
              </div>
              <div className="sb-pnode__out">
                {output && (
                  <>
                    {output.value && <span className="sb-pnode__live sb-tabular">{output.value}</span>}
                    <span className="sb-pnode__label">{output.name}</span>
                    <span className="sb-pnode__port" data-side="out">
                      <PortGlyph type={output.type} connected={output.connected ?? false} live={output.live} />
                    </span>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Node graph placeholder: category-colored patches, typed ports, cables, comments, a pulse spark. */
export function PatchEditorPanel({ onOpenPicker }: { onOpenPicker: () => void }) {
  const [bodyRef, box] = useElementSize<HTMLDivElement>();
  const [zoom, setZoom] = useState<number | null>(null);
  const graph = MOCK_GRAPH;
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);

  const bounds = useMemo(() => {
    let width = 0;
    let height = 0;
    for (const node of graph.nodes) {
      width = Math.max(width, node.x + nodeWidth(node));
      height = Math.max(height, node.y + nodeHeight(node));
    }
    for (const c of graph.comments) {
      width = Math.max(width, c.rect[0] + c.rect[2]);
      height = Math.max(height, c.rect[1] + c.rect[3]);
    }
    return { width: width + 16, height: height + 16 };
  }, [graph]);

  const fit = box.width > 0 ? Math.max(0.8, Math.min(1, (box.width - 48) / bounds.width, (box.height - 40) / bounds.height)) : 0.8;
  const scale = zoom ?? fit;
  const setZoomStep = (direction: 1 | -1) => setZoom(Math.round(Math.max(0.25, Math.min(2, scale + direction * 0.1)) * 100) / 100);

  return (
    <Panel
      title="Patches"
      scope="patchEditor"
      surface="sunken"
      headerContent={
        <nav className="sb-breadcrumb" aria-label="Component path">
          <ChevronRight size={12} aria-hidden />
          <span aria-current="page">Main</span>
        </nav>
      }
      actions={
        <>
          <IconButton size="sm" icon={<WandSparkles size={14} />} label="Tidy up" shortcut="Ctrl+T" onClick={() => toast({ title: "Tidied 9 patches", tone: "success" })} />
          <IconButton size="sm" icon={<Plus size={14} />} label="Insert patch" shortcut="Alt+Enter" onClick={onOpenPicker} />
        </>
      }
    >
      <div
        ref={bodyRef}
        className="sb-patches"
        onDoubleClick={(event) => {
          if (!(event.target as Element).closest(".sb-pnode")) onOpenPicker();
        }}
      >
        <div className="sb-patches__graph" style={{ width: bounds.width, height: bounds.height, transform: `translate(24px, 20px) scale(${scale})` }}>
          {graph.comments.map((comment) => (
            <div key={comment.id} className="sb-pcomment" style={{ left: comment.rect[0], top: comment.rect[1], width: comment.rect[2], height: comment.rect[3] }}>
              <span className="sb-pcomment__title">{comment.text}</span>
            </div>
          ))}
          <svg className="sb-patches__cables" width={bounds.width} height={bounds.height} aria-hidden>
            {graph.cables.map((cable) => {
              const fromNode = byId.get(cable.from[0]);
              const toNode = byId.get(cable.to[0]);
              if (!fromNode || !toNode) return null;
              const a = portPoint(fromNode, "out", cable.from[1]);
              const b = portPoint(toNode, "in", cable.to[1]);
              if (!a || !b) return null;
              const port = fromNode.outputs.find((p) => p.key === cable.from[1])!;
              const d = cablePath(a, b);
              const looped = fromNode.loop !== undefined;
              return (
                <g key={`${cable.from.join(".")}-${cable.to.join(".")}`}>
                  {looped && <path d={d} className="sb-cable__loop" />}
                  <path d={d} className="sb-cable" style={{ stroke: portColorVar(port.type) }} />
                  {cable.pulse && (
                    <circle r={3.5} className="sb-cable__spark">
                      <animateMotion dur="1.8s" repeatCount="indefinite" path={d} keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.4 0 0.2 1" />
                    </circle>
                  )}
                </g>
              );
            })}
          </svg>
          {graph.nodes.map((node) => (
            <PatchNode key={node.id} node={node} selected={node.id === "pop"} />
          ))}
        </div>
        <div className="sb-patches__zoom" role="group" aria-label="Zoom">
          <IconButton size="xs" icon={<Minus size={12} />} label="Zoom out" shortcut="Mod+-" onClick={() => setZoomStep(-1)} />
          <button type="button" className="sb-patches__zoom-value sb-tabular" onClick={() => setZoom(null)} aria-label="Zoom to fit">
            {Math.round(scale * 100)}%
          </button>
          <IconButton size="xs" icon={<Plus size={12} />} label="Zoom in" shortcut="Mod+=" onClick={() => setZoomStep(1)} />
        </div>
      </div>
    </Panel>
  );
}
