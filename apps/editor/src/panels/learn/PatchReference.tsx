import type { PatchCategory } from "@sonobe/core";
import { CATEGORY_LABELS, CATEGORY_ORDER } from "@sonobe/patches";
import { ArrowLeft, CirclePlay, Plus, Search, TriangleAlert } from "lucide-react";
import { useMemo, type CSSProperties } from "react";
import { Badge } from "../../ui/Badge.tsx";
import { Button } from "../../ui/Button.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { PortGlyph, VALUE_TYPE_LABELS } from "../../ui/PortGlyph.tsx";
import { HighlightedText } from "../../ui/SearchList.tsx";
import { TextField } from "../../ui/TextField.tsx";
import { examplesUsingPatch, type ExampleProject } from "./examples.ts";
import { Markdown } from "./Markdown.tsx";
import { patchAvailability, patchPortRows, searchPatchReference, type PatchReferenceItem, type PortRow } from "./patchReference.ts";

export interface PatchReferenceProps {
  items: readonly PatchReferenceItem[];
  /** The patch being read, or null for the list. */
  type: string | null;
  onSelect: (type: string | null) => void;
  query: string;
  onQueryChange: (query: string) => void;
  category: PatchCategory | null;
  onCategoryChange: (category: PatchCategory | null) => void;
  examples: readonly ExampleProject[];
  onTryExample: (example: ExampleProject) => void;
  onInsertPatch?: (type: string) => void;
}

const categoryStyle = (category: PatchCategory) => ({ "--sb-category": `var(--category-${category})` }) as CSSProperties;

/** Patch reference: searchable list by category, and per-patch docs, ports, examples, and common mistakes. */
export function PatchReference(props: PatchReferenceProps) {
  return props.type ? <PatchDetail {...props} type={props.type} /> : <PatchList {...props} />;
}

function PatchList({ items, onSelect, query, onQueryChange, category, onCategoryChange }: PatchReferenceProps) {
  const results = useMemo(() => searchPatchReference(items, query, category), [items, query, category]);
  const searching = query.trim() !== "";
  const groups = useMemo(() => {
    if (searching) return [];
    const byCategory = new Map<PatchCategory, typeof results>();
    for (const result of results) byCategory.set(result.item.category, [...(byCategory.get(result.item.category) ?? []), result]);
    return CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((c) => ({ category: c, results: byCategory.get(c)! }));
  }, [results, searching]);

  const row = (result: (typeof results)[number]) => (
    <li key={result.item.type}>
      <button type="button" className="sb-patchrow" style={categoryStyle(result.item.category)} onClick={() => onSelect(result.item.type)}>
        <span className="sb-patchrow__dot" aria-hidden />
        <span className="sb-patchrow__text">
          <span className="sb-patchrow__name">
            <HighlightedText text={result.item.name} indices={result.matches.name?.indices} />
            {searching && <span className="sb-patchrow__category">{result.item.categoryLabel}</span>}
          </span>
          <span className="sb-patchrow__summary">{result.item.summary}</span>
        </span>
      </button>
    </li>
  );

  return (
    <div className="sb-learnx__stack">
      <TextField
        aria-label="Search patches"
        placeholder="Search patches, aliases, and ports"
        leading={<Search size={13} strokeWidth={2} />}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onCancel={() => onQueryChange("")}
        onCommit={() => {
          const first = results[0];
          if (first) onSelect(first.item.type);
        }}
      />
      <div className="sb-catrow sb-scroll" role="group" aria-label="Categories">
        <button type="button" className="sb-catrow__chip" aria-pressed={category === null} onClick={() => onCategoryChange(null)}>
          All
        </button>
        {CATEGORY_ORDER.map((c) => (
          <button key={c} type="button" className="sb-catrow__chip" aria-pressed={category === c} style={categoryStyle(c)} onClick={() => onCategoryChange(category === c ? null : c)}>
            <span className="sb-catrow__dot" aria-hidden />
            {CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>
      <div className="sb-learnx__count" aria-live="polite">
        {results.length} {results.length === 1 ? "patch" : "patches"}
        {category ? ` in ${CATEGORY_LABELS[category]}` : ""}
      </div>
      {results.length === 0 ? (
        <EmptyState size="sm" icon={<Search size={16} />} title="No patches match" description="Try a behavior (“spring”, “drag”, “repeat”) or a port name." />
      ) : searching ? (
        <ul className="sb-patchlist">{results.map(row)}</ul>
      ) : (
        groups.map((group) => (
          <section key={group.category} aria-labelledby={`sb-patch-group-${group.category}`}>
            <h3 className="sb-learnx__section-title" id={`sb-patch-group-${group.category}`}>
              {CATEGORY_LABELS[group.category]}
            </h3>
            <ul className="sb-patchlist">{group.results.map(row)}</ul>
          </section>
        ))
      )}
    </div>
  );
}

function PortTable({ title, rows }: { title: string; rows: readonly PortRow[] }) {
  return (
    <section aria-label={title}>
      <h3 className="sb-learnx__section-title">{title}</h3>
      {rows.length === 0 ? (
        <div className="sb-ports__none">None</div>
      ) : (
        <ul className="sb-ports">
          {rows.map((r) => (
            <li key={r.key} className="sb-ports__row">
              <PortGlyph type={r.type} size={9} className="sb-ports__glyph" />
              <div className="sb-ports__text">
                <div className="sb-ports__head">
                  <span className="sb-ports__name">{r.name}</span>
                  <span className="sb-ports__type">{r.type === "variant" ? "Matches the patch type" : VALUE_TYPE_LABELS[r.type]}</span>
                  {r.defaultText && <span className="sb-ports__default sb-tabular">= {r.defaultText}</span>}
                  {r.variadic && (
                    <span className="sb-ports__default">
                      repeats {r.variadic.min}–{r.variadic.max}
                    </span>
                  )}
                </div>
                <div className="sb-ports__desc">{r.description}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PatchDetail({ items, type, onSelect, examples, onTryExample, onInsertPatch }: PatchReferenceProps & { type: string }) {
  const item = items.find((i) => i.type === type);
  const tryIt = useMemo(() => examplesUsingPatch(examples, type), [examples, type]);
  if (!item) {
    return (
      <div className="sb-learnx__stack">
        <EmptyState size="sm" title="There's no patch called “" description={`“${type}” isn't in the patch library.`} actions={<Button size="sm" variant="secondary" onClick={() => onSelect(null)}>All patches</Button>} />
      </div>
    );
  }
  const { spec } = item;
  const availability = patchAvailability(spec);
  const pairs = (spec.pairsWellWith ?? []).map((t) => items.find((i) => i.type === t)).filter((i): i is PatchReferenceItem => !!i);

  return (
    <article className="sb-patchdoc" aria-labelledby="sb-patchdoc-title" style={categoryStyle(item.category)}>
      <button type="button" className="sb-reader__crumb" onClick={() => onSelect(null)}>
        <ArrowLeft size={12} strokeWidth={2} aria-hidden />
        All patches
      </button>
      <header className="sb-patchdoc__header">
        <span className="sb-patchdoc__category">
          <span className="sb-catrow__dot" aria-hidden />
          {item.categoryLabel}
        </span>
        <h1 className="sb-patchdoc__title" id="sb-patchdoc-title">
          {item.name}
        </h1>
        <div className="sb-patchdoc__ids">
          <code>{item.type}</code>
          {spec.shortcut && (
            <span className="sb-patchdoc__shortcut">
              press <kbd>{spec.shortcut}</kbd> on the canvas
            </span>
          )}
        </div>
        <p className="sb-patchdoc__summary">{spec.summary}</p>
        {(availability.tier || availability.status || spec.platforms) && (
          <div className="sb-patchdoc__badges">
            {availability.tier && <Badge size="sm">{availability.tier}</Badge>}
            {availability.status && (
              <Badge size="sm" tone="warn" title={availability.reason ?? undefined}>
                {availability.status}
              </Badge>
            )}
            {spec.platforms?.map((p) => (
              <Badge key={p} size="sm" variant="outline">
                {p}
              </Badge>
            ))}
          </div>
        )}
        {availability.reason && <p className="sb-patchdoc__reason">{availability.reason}</p>}
        {item.aliases.length > 0 && <div className="sb-patchdoc__aliases">Also found by: {item.aliases.join(", ")}</div>}
        {onInsertPatch && (
          <div className="sb-patchdoc__actions">
            <Button size="sm" variant="primary" icon={<Plus size={12} />} onClick={() => onInsertPatch(item.type)}>
              Add to patch editor
            </Button>
          </div>
        )}
      </header>

      {spec.docs && <Markdown source={spec.docs} headingOffset={1} idPrefix={`sb-patch-${item.type}-`} className="sb-md--compact" />}

      <PortTable title="Inputs" rows={patchPortRows(spec, "inputs")} />
      <PortTable title="Outputs" rows={patchPortRows(spec, "outputs")} />

      {spec.variants && spec.variants.length > 0 && (
        <section aria-label="Types">
          <h3 className="sb-learnx__section-title">Types</h3>
          <div className="sb-patchdoc__chips">
            {spec.variants.map((v, i) => (
              <Badge key={v} size="sm" variant={i === 0 ? "soft" : "outline"}>
                {VALUE_TYPE_LABELS[v]}
                {i === 0 ? " (default)" : ""}
              </Badge>
            ))}
          </div>
        </section>
      )}

      {spec.settings && spec.settings.length > 0 && (
        <section aria-label="Settings">
          <h3 className="sb-learnx__section-title">Settings</h3>
          <ul className="sb-ports">
            {spec.settings.map((s) => (
              <li key={s.key} className="sb-ports__row">
                <div className="sb-ports__text">
                  <div className="sb-ports__head">
                    <span className="sb-ports__name">{s.name}</span>
                    <span className="sb-ports__type">{s.type}</span>
                  </div>
                  <div className="sb-ports__desc">{s.description}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {((spec.examples && spec.examples.length > 0) || tryIt.length > 0) && (
        <section aria-label="Examples">
          <h3 className="sb-learnx__section-title">Examples</h3>
          <div className="sb-patchdoc__examples">
            {spec.examples?.map((example) => (
              <div key={example.title} className="sb-patchdoc__example">
                <div className="sb-patchdoc__example-title">{example.title}</div>
                {example.description && <div className="sb-patchdoc__example-desc">{example.description}</div>}
                <pre className="sb-patchdoc__outline sb-scroll sb-selectable" aria-label={`${example.title} as an outline`}>
                  <code>{example.outline}</code>
                </pre>
              </div>
            ))}
            {tryIt.length > 0 && (
              <div className="sb-patchdoc__try">
                {tryIt.map((e) => (
                  <Button key={e.folder} size="sm" variant="secondary" icon={<CirclePlay size={12} />} onClick={() => onTryExample(e)}>
                    Try “{e.name}”
                  </Button>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {spec.commonMistakes && spec.commonMistakes.length > 0 && (
        <section aria-label="Common mistakes">
          <h3 className="sb-learnx__section-title">Common mistakes</h3>
          <ul className="sb-patchdoc__mistakes">
            {spec.commonMistakes.map((m) => (
              <li key={m}>
                <TriangleAlert size={13} strokeWidth={2} aria-hidden />
                <span>{m}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {pairs.length > 0 && (
        <section aria-label="Pairs well with">
          <h3 className="sb-learnx__section-title">Pairs well with</h3>
          <div className="sb-patchdoc__chips">
            {pairs.map((p) => (
              <button key={p.type} type="button" className="sb-catrow__chip" style={categoryStyle(p.category)} onClick={() => onSelect(p.type)}>
                <span className="sb-catrow__dot" aria-hidden />
                {p.name}
              </button>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
