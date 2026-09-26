import { ArrowRight, Check, ChevronRight, Search } from "lucide-react";
import { useMemo } from "react";
import { TextField } from "../../ui/TextField.tsx";
import { ExampleList } from "./ExampleList.tsx";
import type { ExampleProject } from "./examples.ts";
import { searchGuides, splitByTerms, type Guide, type GuideCatalog, type GuideLink } from "./guides.ts";

export interface GuideHomeProps {
  catalog: GuideCatalog;
  opened: ReadonlySet<string>;
  examples: readonly ExampleProject[];
  query: string;
  onQueryChange: (query: string) => void;
  onOpenGuide: (slug: string, anchor?: string | null) => void;
  onOpenPatches: () => void;
  onTryExample: (example: ExampleProject) => void;
}

const levelTitles = ["Just starting", "Making things move", "Making it feel right", "Whole flows", "Holds up for other people"];

function guideLabel(catalog: GuideCatalog, link: GuideLink): { title: string; suffix: string | null } {
  const guide = catalog.get(link.slug);
  if (link.anchor && guide) return { title: link.label.charAt(0).toUpperCase() + link.label.slice(1), suffix: guide.number ? `in ${guide.number}` : null };
  return { title: guide?.title ?? link.label, suffix: null };
}

/** The Learn home: search, the next guide to read, the level map, and examples. */
export function GuideHome({ catalog, opened, examples, query, onQueryChange, onOpenGuide, onOpenPatches, onTryExample }: GuideHomeProps) {
  const results = useMemo(() => (query.trim() ? searchGuides(catalog.guides, query) : []), [catalog, query]);
  const terms = useMemo(() => query.toLowerCase().split(/\s+/).filter(Boolean), [query]);

  const pathOrder = useMemo(() => {
    const order: Guide[] = [];
    const seen = new Set<string>();
    for (const row of catalog.levels) {
      for (const link of row.guides) {
        const guide = catalog.get(link.slug);
        if (guide && !link.anchor && !seen.has(guide.slug)) {
          seen.add(guide.slug);
          order.push(guide);
        }
      }
    }
    for (const guide of catalog.guides) if (!seen.has(guide.slug)) order.push(guide);
    return order;
  }, [catalog]);

  const next = pathOrder.find((g) => !opened.has(g.slug));
  const started = pathOrder.some((g) => opened.has(g.slug));
  const searching = query.trim() !== "";

  const guideRow = (link: GuideLink) => {
    const label = guideLabel(catalog, link);
    const read = !link.anchor && opened.has(link.slug);
    return (
      <button key={`${link.slug}#${link.anchor ?? ""}`} type="button" className="sb-path__guide" data-read={read || undefined} onClick={() => onOpenGuide(link.slug, link.anchor)}>
        <span className="sb-path__guide-title">{label.title}</span>
        {label.suffix && <span className="sb-path__suffix">{label.suffix}</span>}
        {read && (
          <>
            <Check size={12} strokeWidth={2} className="sb-path__check" aria-hidden />
            <span className="sb-visually-hidden">, opened</span>
          </>
        )}
        <ChevronRight size={12} strokeWidth={2} className="sb-path__chevron" aria-hidden />
      </button>
    );
  };

  return (
    <div className="sb-learnx__stack" data-dense={searching || undefined}>
      <div className="sb-learnx__toolbar">
        <TextField
          aria-label="Search guides"
          placeholder="Search guides: springs, loops, taps…"
          leading={<Search size={13} strokeWidth={2} />}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onCancel={() => onQueryChange("")}
          onCommit={() => {
            const first = results[0];
            if (first) onOpenGuide(first.guide.slug, first.anchor);
          }}
        />
        {searching && results.length > 0 && (
          <div className="sb-learnx__count" aria-live="polite">
            {results.length} {results.length === 1 ? "guide" : "guides"}
          </div>
        )}
        {!searching && next && (
          <button type="button" className="sb-learnx__next" onClick={() => onOpenGuide(next.slug)}>
            <span className="sb-learnx__next-label">{started ? "Up next:" : "Start here:"}</span>
            <span className="sb-learnx__next-title">{next.title}</span>
            <ArrowRight size={12} strokeWidth={2} aria-hidden />
          </button>
        )}
      </div>

      {searching ? (
        <section aria-label="Search results">
          {results.length === 0 ? (
            <p className="sb-learnx__empty">
              No guide matches “{query.trim()}”. Try the{" "}
              <button type="button" className="sb-learnx__inline-link" onClick={onOpenPatches}>
                patch reference
              </button>
              .
            </p>
          ) : (
            <ul className="sb-results">
              {results.map((result) => (
                <li key={result.guide.slug}>
                  <button type="button" className="sb-results__item" onClick={() => onOpenGuide(result.guide.slug, result.anchor)}>
                    <span className="sb-results__title">
                      {result.guide.number && <span className="sb-results__number sb-tabular">{result.guide.number}</span>}
                      {result.guide.title}
                    </span>
                    {result.section && <span className="sb-results__heading">{result.section.text}</span>}
                    {result.snippet && (
                      <span className="sb-results__snippet">
                        {splitByTerms(result.snippet, terms).map((part, i) =>
                          part.match ? (
                            <mark key={i} className="sb-highlight">
                              {part.text}
                            </mark>
                          ) : (
                            part.text
                          ),
                        )}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <>
          {catalog.levels.length > 0 && (
            <section aria-labelledby="sb-learnx-path">
              <h3 className="sb-learnx__section-title" id="sb-learnx-path">
                Your learning path
              </h3>
              <ol className="sb-path">
                {catalog.levels.map((row) => {
                  const guides = row.guides.filter((l) => !l.anchor);
                  const done = guides.length > 0 && guides.every((l) => opened.has(l.slug));
                  return (
                    <li key={row.level} className="sb-path__level" data-done={done || undefined}>
                      <span className="sb-path__marker" aria-hidden>
                        {done && <Check size={10} strokeWidth={3} />}
                      </span>
                      <div className="sb-path__content">
                        <h4 className="sb-path__title">
                          Level {row.level} · {levelTitles[row.level] ?? "Beyond"}
                          {done && <span className="sb-visually-hidden"> (all opened)</span>}
                        </h4>
                        {row.audience && <div className="sb-path__audience">{row.audience}</div>}
                        <div className="sb-path__guides">{row.guides.map(guideRow)}</div>
                        {row.outcomes && <div className="sb-path__outcomes">You'll build: {row.outcomes}</div>}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}

          {catalog.anyLevel.length > 0 && (
            <section aria-labelledby="sb-learnx-any">
              <h3 className="sb-learnx__section-title" id="sb-learnx-any">
                Any level
              </h3>
              <div className="sb-path__guides">{catalog.anyLevel.map((guide) => guideRow({ slug: guide.slug, anchor: null, label: guide.title }))}</div>
            </section>
          )}

          {examples.length > 0 && (
            <section aria-labelledby="sb-learnx-examples">
              <h3 className="sb-learnx__section-title" id="sb-learnx-examples">
                Examples
              </h3>
              <ExampleList examples={examples} onTry={onTryExample} limit={4} descriptions moreLabel={(_, total) => `Show all ${total}`} />
            </section>
          )}
        </>
      )}
    </div>
  );
}
