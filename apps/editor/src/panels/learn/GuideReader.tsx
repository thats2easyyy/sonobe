import { ArrowLeft, ArrowRight, CirclePlay, Plug } from "lucide-react";
import { useMemo } from "react";
import { Badge } from "../../ui/Badge.tsx";
import { Button } from "../../ui/Button.tsx";
import { examplesForGuide, type ExampleProject } from "./examples.ts";
import { CLAUDE_GUIDE_SLUG, resolveGuideHref, type Guide, type GuideCatalog } from "./guides.ts";
import { Markdown } from "./Markdown.tsx";

export const GUIDE_ID_PREFIX = "sb-guide-";

export interface GuideReaderProps {
  guide: Guide;
  catalog: GuideCatalog;
  examples: readonly ExampleProject[];
  onOpenGuide: (slug: string, anchor?: string | null) => void;
  onHome: () => void;
  onTryExample: (example: ExampleProject) => void;
  onConnectClaude?: () => void;
}

/** One guide: title and level, the rendered body, examples to try, and where to go next. */
export function GuideReader({ guide, catalog, examples, onOpenGuide, onHome, onTryExample, onConnectClaude }: GuideReaderProps) {
  const body = useMemo(() => {
    const titleIndex = guide.blocks.findIndex((b) => b.type === "heading" && b.level === 1);
    const skipMeta = guide.levelLabel !== "" && guide.blocks[titleIndex + 1]?.type === "paragraph";
    return guide.blocks.filter((_, i) => i !== titleIndex && !(skipMeta && i === titleIndex + 1));
  }, [guide]);
  const tryIt = useMemo(() => examplesForGuide(examples, guide), [examples, guide]);
  const next = guide.next.filter((link) => catalog.get(link.slug) && link.slug !== "README");

  const navigate = (href: string) => {
    const target = resolveGuideHref(href);
    if (!target) return;
    if (!target.slug) {
      if (target.anchor) document.getElementById(`${GUIDE_ID_PREFIX}${target.anchor}`)?.scrollIntoView({ block: "start" });
      return;
    }
    if (target.slug.toLowerCase() === "readme") onHome();
    else onOpenGuide(target.slug, target.anchor);
  };

  return (
    <article className="sb-reader" aria-labelledby={`${GUIDE_ID_PREFIX}title`}>
      <header className="sb-reader__header">
        <button type="button" className="sb-reader__crumb" onClick={onHome}>
          <ArrowLeft size={12} strokeWidth={2} aria-hidden />
          Learning path
        </button>
        <h1 className="sb-reader__title" id={`${GUIDE_ID_PREFIX}title`}>
          {guide.number && <span className="sb-reader__number sb-tabular">{guide.number}</span>}
          {guide.title}
        </h1>
        <div className="sb-reader__meta">
          {guide.levelLabel && (
            <Badge size="sm" tone="accent">
              {guide.levelLabel}
            </Badge>
          )}
          {guide.minutes !== null && <span>about {guide.minutes} min</span>}
          {guide.audience && <span>{guide.audience}</span>}
        </div>
      </header>

      {guide.slug === CLAUDE_GUIDE_SLUG && onConnectClaude && (
        <div className="sb-reader__callout" data-tone="ai">
          <div>
            <div className="sb-reader__callout-title">Set it up from here</div>
            <div className="sb-reader__callout-text">Connect Claude shows your MCP status and the exact command for your machine.</div>
          </div>
          <Button size="sm" variant="ai" icon={<Plug size={12} />} onClick={onConnectClaude}>
            Connect Claude
          </Button>
        </div>
      )}

      {tryIt.length > 0 && (
        <div className="sb-reader__callout">
          <div>
            <div className="sb-reader__callout-title">Follow along</div>
            <div className="sb-reader__callout-text">Open a finished version as a new document and poke at it.</div>
          </div>
          <div className="sb-reader__callout-actions">
            {tryIt.map((example) => (
              <Button key={example.folder} size="sm" variant="secondary" icon={<CirclePlay size={12} />} onClick={() => onTryExample(example)}>
                Try “{example.name}”
              </Button>
            ))}
          </div>
        </div>
      )}

      <Markdown blocks={body} idPrefix={GUIDE_ID_PREFIX} onNavigate={navigate} className="sb-reader__body" />

      <footer className="sb-reader__footer">
        {next.length > 0 ? (
          <>
            <div className="sb-learnx__section-title">Next</div>
            <div className="sb-reader__next">
              {next.map((link) => {
                const target = catalog.get(link.slug)!;
                return (
                  <button key={link.slug} type="button" className="sb-reader__next-item" onClick={() => onOpenGuide(link.slug, link.anchor)}>
                    <span className="sb-reader__next-text">
                      <span className="sb-reader__next-level">{target.levelLabel || "Guide"}</span>
                      <span className="sb-reader__next-title">{target.title}</span>
                    </span>
                    <ArrowRight size={14} strokeWidth={2} aria-hidden />
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <Button size="sm" variant="secondary" icon={<ArrowLeft size={12} />} onClick={onHome}>
            Back to the learning path
          </Button>
        )}
      </footer>
    </article>
  );
}
