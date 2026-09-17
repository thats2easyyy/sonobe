import { CornerDownLeft } from "lucide-react";
import { useMemo, type CSSProperties } from "react";
import { CATEGORY_LABELS, PATCH_CATEGORIES, categoryColorVar } from "../theme/tokens.ts";
import { Button } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { Kbd } from "../ui/Kbd.tsx";
import { PortGlyph, VALUE_TYPE_LABELS } from "../ui/PortGlyph.tsx";
import { SearchList } from "../ui/SearchList.tsx";
import { toast } from "../ui/Toast.tsx";
import type { FuzzyKey } from "../ui/lib/fuzzy.ts";
import { CATEGORY_ICONS } from "./icons.tsx";
import { MOCK_PATCH_TYPES, type MockPatchType, type MockPort } from "./mockData.ts";
import "./PatchPicker.css";

const KEYS: FuzzyKey<MockPatchType>[] = [
  { name: "name", get: (p) => p.name },
  { name: "aliases", get: (p) => p.aliases, weight: 0.75 },
  { name: "type", get: (p) => p.type, weight: 0.6 },
  { name: "ports", get: (p) => [...p.inputs, ...p.outputs].map((port) => port.name), weight: 0.45 },
  { name: "category", get: (p) => CATEGORY_LABELS[p.category], weight: 0.4 },
  { name: "summary", get: (p) => p.summary, weight: 0.25 },
];

export interface PatchPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patches?: readonly MockPatchType[];
  onInsert?: (patch: MockPatchType) => void;
}

/** ⌥⏎ or double-click the patch editor: search patches by name, alias, or port, with docs alongside. */
export function PatchPicker({ open, onOpenChange, patches = MOCK_PATCH_TYPES, onInsert }: PatchPickerProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} aria-label="Insert patch" placement="top" width={800} modalScope="patchPicker" className="sb-picker">
      <PickerBody
        patches={patches}
        onClose={() => onOpenChange(false)}
        onInsert={
          onInsert ??
          ((patch) => toast({ title: `Inserted ${patch.name}`, description: "Placed at the center of the patch editor.", tone: "success" }))
        }
      />
    </Dialog>
  );
}

function PickerBody({ patches, onClose, onInsert }: { patches: readonly MockPatchType[]; onClose: () => void; onInsert: (patch: MockPatchType) => void }) {
  const sorted = useMemo(
    () => [...patches].sort((a, b) => PATCH_CATEGORIES.indexOf(a.category) - PATCH_CATEGORIES.indexOf(b.category)),
    [patches],
  );
  const insert = (patch: MockPatchType) => {
    onClose();
    onInsert(patch);
  };
  return (
    <SearchList
      size="lg"
      aria-label="Patches"
      placeholder="Search patches by name, alias, or port…"
      items={sorted}
      keys={KEYS}
      getId={(p) => p.type}
      groupBy={(p) => CATEGORY_LABELS[p.category]}
      onSelect={insert}
      emptyState={(query) => (
        <div className="sb-picker__empty">
          <div>No patches match “{query}”.</div>
          <div className="sb-picker__empty-hint">Try what it does, like “spring”, “toggle”, or “fetch”.</div>
        </div>
      )}
      renderItem={(patch, ctx) => {
        const Icon = CATEGORY_ICONS[patch.category];
        const alias = ctx.matches.aliases;
        return (
          <div className="sb-picker__item" style={{ "--sb-cat": categoryColorVar(patch.category) } as CSSProperties}>
            <span className="sb-picker__item-icon" aria-hidden>
              <Icon size={13} strokeWidth={2} />
            </span>
            <span className="sb-picker__item-name">{ctx.highlight("name", patch.name)}</span>
            {alias && !ctx.matches.name && <span className="sb-picker__item-alias">{ctx.highlight("aliases", alias.value)}</span>}
            {patch.shortcut && <Kbd className="sb-picker__item-key">{patch.shortcut}</Kbd>}
          </div>
        );
      }}
      renderPreview={(patch) => (patch ? <PatchPreview patch={patch} onInsert={() => insert(patch)} /> : null)}
      footer={
        <>
          <span className="sb-picker__hint">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> browse
          </span>
          <span className="sb-picker__hint">
            <Kbd>
              <CornerDownLeft size={10} strokeWidth={2.25} />
            </Kbd>
            insert
          </span>
          <span className="sb-picker__hint sb-picker__hint--end">Tip: hover the patch editor and press a letter, like A for Pop Animation</span>
        </>
      }
    />
  );
}

function PortList({ title, ports }: { title: string; ports: readonly MockPort[] }) {
  return (
    <div className="sb-picker__ports">
      <div className="sb-picker__ports-title">{title}</div>
      {ports.map((port) => (
        <div key={port.name} className="sb-picker__port">
          <PortGlyph type={port.type} size={8} />
          <span className="sb-picker__port-name">{port.name}</span>
          <span className="sb-picker__port-type">{VALUE_TYPE_LABELS[port.type]}</span>
        </div>
      ))}
    </div>
  );
}

function PatchPreview({ patch, onInsert }: { patch: MockPatchType; onInsert: () => void }) {
  const Icon = CATEGORY_ICONS[patch.category];
  return (
    <div className="sb-picker__preview" style={{ "--sb-cat": categoryColorVar(patch.category) } as CSSProperties}>
      <div className="sb-picker__preview-head">
        <span className="sb-picker__preview-icon" aria-hidden>
          <Icon size={16} strokeWidth={2} />
        </span>
        <div className="sb-picker__preview-titles">
          <div className="sb-picker__preview-title">{patch.name}</div>
          <div className="sb-picker__preview-category">{CATEGORY_LABELS[patch.category]}</div>
        </div>
        <Button size="sm" variant="primary" onClick={onInsert}>
          Insert
        </Button>
      </div>
      <p className="sb-picker__summary">{patch.summary}</p>
      <div className="sb-picker__port-grid">
        {patch.inputs.length > 0 && <PortList title="Inputs" ports={patch.inputs} />}
        {patch.outputs.length > 0 && <PortList title="Outputs" ports={patch.outputs} />}
      </div>
      {patch.pairsWellWith && (
        <div className="sb-picker__pairs">
          <span className="sb-picker__ports-title">Pairs well with</span>
          <div className="sb-picker__chips">
            {patch.pairsWellWith.map((name) => (
              <span key={name} className="sb-picker__chip">
                {name}
              </span>
            ))}
          </div>
        </div>
      )}
      {patch.shortcut && (
        <div className="sb-picker__shortcut">
          Quick insert: hover the patch editor and press <Kbd>{patch.shortcut}</Kbd>
        </div>
      )}
    </div>
  );
}
