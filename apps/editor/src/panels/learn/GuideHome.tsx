import { ArrowRight, BookOpen, Check, CirclePlay, Lightbulb, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "../../ui/Badge.tsx";
import { Button } from "../../ui/Button.tsx";
import { TextField } from "../../ui/TextField.tsx";
import type { ExampleProject } from "./examples.ts";
import { searchGuides, type Guide, type GuideCatalog, type GuideLink } from "./guides.ts";

export interface GuideHomeProps {
  catalog: GuideCatalog;
  opened: ReadonlySet<string>;
  examples: readonly ExampleProject[];
  onOpenGuide: (slug: string, anchor?: string | null) => void;
  onOpenPatches: () => void;
  onTryExample: (example: ExampleProject) => void;
}

const levelTitles = ["Never prototyped", "Can make one thing move", "Makes interactions feel right", "Builds whole flows", "Expert"];

function guideLabel(catalog: GuideCatalog, link: GuideLink): { number: string | null; title: string } {
  const guide = catalog.get(link.slug);
  if (link.anchor && guide) return { number: guide.number, title: link.label.charAt(0).toUpperCase() + link.label.slice(1) };
  return { number: guide?.number ?? null, title: guide?.title ?? link.label };
}

/** The Learn home: search, the next guide to read, the level map, and examples. */
export function GuideHome({ catalog, opened, examples, onOpenGuide, onOpenPatches, onTryExample }: GuideHomeProps) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => (query.trim() ? searchGuides([...catalog.guides, ...(catalog.readme ? [catalog.readme] : [])], query) : []), [catalog, query]);

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

  const next = pathOrder.find((g) => !opened.has(g.slug)) ?? pathOrder[0];
  const started = pathOrder.some((g) => opened.has(g.slug));

  return (
    <div className="sb-learnx__stack">
      <TextField
        aria-label="Search guides"
        placeholder="Search guides: springs, loops, taps…"
        leading={<Search size={13} strokeWidth={2} />}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onCancel={() => setQuery("")}
        onCommit={() => {
          const first = results[0];
          if (first) onOpenGuide(first.guide.slug, first.heading?.id ?? null);
        }}
      />

      {query.trim() ? (
        <section aria-label="Search results">
          {results.length === 0 ? (
            <div className="sb-learnx__empty">
              Nothing matches “{query.trim()}”. Try “spring”, “loop”, or look it up in{" "}
              <button type="button" className="sb-learnx__inline-link" onClick={onOpenPatches}>
                the patch reference
              </button>
              .
            </div>
          ) : (
            <ul className="sb-results">
              {results.map((result) => (
                <li key={result.guide.slug}>
                  <button type="button" className="sb-results__item" onClick={() => onOpenGuide(result.guide.slug, result.heading?.id ?? null)}>
                    <span className="sb-results__title">
                      {result.guide.number && <span className="sb-results__number sb-tabular">{result.guide.number}</span>}
                      {result.guide.title}
                    </span>
                    {result.heading && <span className="sb-results__heading">§ {result.heading.text}</span>}
                    {result.snippet && <span className="sb-results__snippet">{result.snippet}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <>
          {next && (
            <section className="sb-learnx__hero">
              <div className="sb-learnx__eyebrow">{started ? "Up next" : "Start here"}</div>
              <div className="sb-learnx__hero-title">{next.title}</div>
              <p className="sb-learnx__hero-text">{next.summary}</p>
              <div className="sb-learnx__hero-meta">
                {next.levelLabel && <Badge size="sm">{next.levelLabel}</Badge>}
                {next.minutes !== null && <span>about {next.minutes} min</span>}
              </div>
              <div className="sb-learnx__hero-actions">
                <Button size="sm" variant="primary" trailingIcon={<ArrowRight size={13} />} onClick={() => onOpenGuide(next.slug)}>
                  {started ? "Continue" : "Read the guide"}
                </Button>
              </div>
            </section>
          )}

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
                      <span className="sb-path__marker sb-tabular" aria-label={`Level ${row.level}${done ? ", opened" : ""}`}>
                        {done ? <Check size={11} strokeWidth={2.5} /> : row.level}
                      </span>
                      <div className="sb-path__content">
                        <div className="sb-path__title">{levelTitles[row.level] ?? `Level ${row.level}`}</div>
                        {row.audience && <div className="sb-path__audience">{row.audience}</div>}
                        <div className="sb-path__guides">
                          {row.guides.map((link) => {
                            const label = guideLabel(catalog, link);
                            return (
                              <button key={`${link.slug}#${link.anchor ?? ""}`} type="button" className="sb-path__guide" data-read={(!link.anchor && opened.has(link.slug)) || undefined} onClick={() => onOpenGuide(link.slug, link.anchor)}>
                                {label.number && <span className="sb-path__number sb-tabular">{label.number}</span>}
                                <span>{label.title}</span>
                              </button>
                            );
                          })}
                        </div>
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
              <div className="sb-learnx__cards">
                {catalog.anyLevel.map((guide) => (
                  <button key={guide.slug} type="button" className="sb-guidecard" onClick={() => onOpenGuide(guide.slug)}>
                    <span className="sb-guidecard__icon" aria-hidden>
                      <BookOpen size={13} strokeWidth={2} />
                    </span>
                    <span className="sb-guidecard__title">{guide.title}</span>
                    <span className="sb-guidecard__text">{guide.summary}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {examples.length > 0 && (
            <section aria-labelledby="sb-learnx-examples">
              <h3 className="sb-learnx__section-title" id="sb-learnx-examples">
                Examples
              </h3>
              <ul className="sb-examples">
                {examples.map((example) => (
                  <li key={example.folder} className="sb-examples__item">
                    <div className="sb-examples__text">
                      <span className="sb-examples__title">{example.name}</span>
                      {example.description && <span className="sb-examples__desc">{example.description}</span>}
                    </div>
                    <Button size="sm" variant="secondary" icon={<CirclePlay size={12} />} onClick={() => onTryExample(example)}>
                      Try it
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="sb-learnx__tip">
            <Lightbulb size={14} strokeWidth={2} aria-hidden />
            <div>
              Every patch documents itself: what it does, its ports, examples, and the mistakes people make.{" "}
              <button type="button" className="sb-learnx__inline-link" onClick={onOpenPatches}>
                Browse the patch reference
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
