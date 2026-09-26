import type { PatchCategory } from "@sonobe/core";
import { CATEGORY_LABELS, CATEGORY_ORDER } from "@sonobe/patches";
import { ArrowLeft, Plus, Search, TriangleAlert } from "lucide-react";
import { useMemo, type CSSProperties } from "react";
import { Badge } from "../../ui/Badge.tsx";
import { Button } from "../../ui/Button.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { Kbd } from "../../ui/Kbd.tsx";
import { PortGlyph, VALUE_TYPE_LABELS } from "../../ui/PortGlyph.tsx";
import { Select, type SelectOption } from "../../ui/Select.tsx";
import { HighlightedText } from "../../ui/SearchList.tsx";
import { TextField } from "../../ui/TextField.tsx";
import { getRegistry } from "../../state/registry.ts";
import { singleKeyFor } from "../patch-editor/model/singleKey.ts";
import { ExampleList } from "./ExampleList.tsx";
import { examplesUsingPatch, type ExampleProject } from "./examples.ts";
import { Markdown } from "./Markdown.tsx";
import { patchAvailability, patchPortRows, searchPatchReference, type PatchReferenceItem, type PortRow } from "./patchReference.ts";
import { useScrollOverflow } from "./useScrollOverflow.ts";

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

type CategoryFilter = "all" | PatchCategory;

const categoryOptions: SelectOption<CategoryFilter>[] = [
  { value: "all", label: "All categories" },
  ...CATEGORY_ORDER.map((c) => ({ value: c, label: CATEGORY_LABELS[c], icon: <span className="sb-catdot" style={categoryStyle(c)} aria-hidden /> })),
];

/** Patch reference: searchable list by category, and per-patch docs, ports, examples, and common mistakes. */
export function PatchReference(props: PatchReferenceProps) {
  return props.type ? <PatchDetail {...props} type={props.type} /> : <PatchList {...props} />;
}

function PatchList({ items, onSelect, query, onQueryChange, category, onCategoryChange }: PatchReferenceProps) {
  const results = useMemo(() => searchPatchReference(items, query, category), [items, query, category]);
  const searching = query.trim() !== "";
  const groups = useMemo(() => {
    if (searching || category) return [];
    const byCategory = new Map<PatchCategory, typeof results>();
    for (const result of results) byCategory.set(result.item.category, [...(byCategory.get(result.item.category) ?? []), result]);
    return CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((c) => ({ category: c, results: byCategory.get(c)! }));
  }, [results, searching, category]);

  const row = (result: (typeof results)[number]) => (
    <li key={result.item.type}>
      <button type="button" className="sb-patchrow" style={categoryStyle(result.item.category)} onClick={() => onSelect(result.item.type)}>
        <span className="sb-patchrow__dot" aria-hidden />
        <span className="sb-patchrow__text">
          <span className="sb-patchrow__name">
            <span>
              <HighlightedText text={result.item.name} indices={result.matches.name?.indices} />
            </span>
            {searching && !category && <span className="sb-patchrow__category">{result.item.categoryLabel}</span>}
          </span>
          <span className="sb-patchrow__summary">{result.item.summary}</span>
        </span>
      </button>
    </li>
  );

  return (
    <div className="sb-learnx__stack" data-dense>
      <div className="sb-learnx__toolbar">
        <div className="sb-learnx__filters">
          <TextField
            aria-label="Search patches"
            placeholder="Search patches"
            leading={<Search size={13} strokeWidth={2} />}
            containerClassName="sb-learnx__search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onCancel={() => onQueryChange("")}
            onCommit={() => {
              const first = results[0];
              if (first) onSelect(first.item.type);
            }}
          />
          <Select<CategoryFilter>
            aria-label="Category"
            options={categoryOptions}
            value={category ?? "all"}
            onChange={(next) => onCategoryChange(next === "all" ? null : next)}
            renderValue={(option) => (option?.value === "all" ? "Category" : option?.label)}
            menuWidth={200}
            placement="bottom-end"
            className="sb-learnx__category"
          />
        </div>
        {(searching || category) && results.length > 0 && (
          <div className="sb-learnx__count" aria-live="polite">
            {results.length} {results.length === 1 ? "patch" : "patches"}
            {category ? ` in ${CATEGORY_LABELS[category]}` : ""}
          </div>
        )}
      </div>
      {results.length === 0 ? (
        <EmptyState
          variant="inline"
          size="sm"
          className="sb-learnx__empty-state"
          title={category ? `No patch in ${CATEGORY_LABELS[category]} matches “${query.trim()}”.` : `No patch matches “${query.trim()}”.`}
          actions={
            <button
              type="button"
              className="sb-learnx__more"
              onClick={() => {
                onQueryChange("");
                onCategoryChange(null);
              }}
            >
              {category ? "Clear filters" : "Clear search"}
            </button>
          }
        />
      ) : searching || category ? (
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

function SectionTitle({ children }: { children: string }) {
  return (
    <h4 className="sb-patchdoc__section-title">{children}</h4>
  );
}

function PortTable({ title, rows }: { title: string; rows: readonly PortRow[] }) {
  return (
    <section aria-label={title}>
      <SectionTitle>{title}</SectionTitle>
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

function OutlineBlock({ label, outline }: { label: string; outline: string }) {
  const scroller = useScrollOverflow<HTMLPreElement>();
  return (
    <pre ref={scroller.ref} className="sb-patchdoc__outline sb-scroll sb-selectable" data-more={scroller.more || undefined} aria-label={label}>
      <code>{outline}</code>
    </pre>
  );
}

function PatchDetail({ items, type, onSelect, query, examples, onTryExample, onInsertPatch }: PatchReferenceProps & { type: string }) {
  const item = items.find((i) => i.type === type);
  const tryIt = useMemo(() => examplesUsingPatch(examples, type), [examples, type]);
  if (!item) {
    return (
      <EmptyState
        variant="inline"
        size="sm"
        className="sb-learnx__empty-state"
        title="That patch isn't in the library"
        actions={
          <button type="button" className="sb-learnx__more" onClick={() => onSelect(null)}>
            All patches
          </button>
        }
      />
    );
  }
  const { spec } = item;
  const availability = patchAvailability(spec);
  const pairs = (spec.pairsWellWith ?? []).map((t) => items.find((i) => i.type === t)).filter((i): i is PatchReferenceItem => !!i);
  const key = singleKeyFor(getRegistry(), spec.type);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matchedAliases = item.aliases.filter((alias) => terms.some((term) => alias.toLowerCase().includes(term)));
  const meta = [availability.tier, ...(spec.platforms ?? [])].filter(Boolean).join(" · ");

  return (
    <article className="sb-patchdoc" aria-labelledby="sb-patchdoc-title" style={categoryStyle(item.category)}>
      <header className="sb-patchdoc__header">
        <button type="button" className="sb-reader__crumb" onClick={() => onSelect(null)}>
          <ArrowLeft size={12} strokeWidth={2} aria-hidden />
          All patches
        </button>
        <div className="sb-patchdoc__ids">
          <span className="sb-catdot" aria-hidden />
          <span>{item.categoryLabel}</span>
          <code>{item.type}</code>
        </div>
        <h3 className="sb-patchdoc__title" id="sb-patchdoc-title" tabIndex={-1} data-view-heading>
          {item.name}
        </h3>
        <p className="sb-patchdoc__summary">{spec.summary}</p>
        {meta && <div className="sb-patchdoc__meta">{meta}</div>}
        {availability.status && (
          <div className="sb-patchdoc__status">
            <Badge size="sm" tone="warn">
              {availability.status}
            </Badge>
            {availability.reason && <p className="sb-patchdoc__reason">{availability.reason}</p>}
          </div>
        )}
        {matchedAliases.length > 0 && <div className="sb-patchdoc__meta">Also called {matchedAliases.map((alias) => `“${alias}”`).join(", ")}</div>}
        {onInsertPatch && (
          <div className="sb-patchdoc__actions">
            <Button size="sm" variant="primary" icon={<Plus size={12} />} onClick={() => onInsertPatch(item.type)}>
              Add to patch editor
            </Button>
            {key && (
              <span className="sb-patchdoc__hint">
                or press <Kbd shortcut={key} /> in the patch editor
              </span>
            )}
          </div>
        )}
      </header>

      <PortTable title="Inputs" rows={patchPortRows(spec, "inputs")} />
      <PortTable title="Outputs" rows={patchPortRows(spec, "outputs")} />

      {spec.variants && spec.variants.length > 0 && (
        <section aria-label="Types">
          <SectionTitle>Types</SectionTitle>
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
          <SectionTitle>Settings</SectionTitle>
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

      {spec.docs && <Markdown source={spec.docs} headingOffset={2} idPrefix={`sb-patch-${item.type}-`} className="sb-md--compact" />}

      {((spec.examples && spec.examples.length > 0) || tryIt.length > 0) && (
        <section aria-label="Examples">
          <SectionTitle>Examples</SectionTitle>
          <div className="sb-patchdoc__examples">
            {spec.examples?.map((example) => (
              <div key={example.title} className="sb-patchdoc__example">
                <div className="sb-patchdoc__example-title">{example.title}</div>
                {example.description && <div className="sb-patchdoc__example-desc">{example.description}</div>}
                <OutlineBlock label={`${example.title} as an outline`} outline={example.outline} />
              </div>
            ))}
            {tryIt.length > 0 && <ExampleList examples={tryIt} onTry={onTryExample} limit={3} title={(e) => `Try “${e.name}”`} moreLabel={(hidden) => `${hidden} more`} />}
          </div>
        </section>
      )}

      {spec.commonMistakes && spec.commonMistakes.length > 0 && (
        <section aria-label="Common mistakes">
          <SectionTitle>Common mistakes</SectionTitle>
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
          <SectionTitle>Pairs well with</SectionTitle>
          <div className="sb-patchdoc__chips">
            {pairs.map((p) => (
              <button key={p.type} type="button" className="sb-catchip" style={categoryStyle(p.category)} onClick={() => onSelect(p.type)}>
                <span className="sb-catdot" aria-hidden />
                {p.name}
              </button>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
