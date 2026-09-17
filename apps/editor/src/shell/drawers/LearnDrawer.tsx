import { ArrowRight, BookOpen, CirclePlay, Lightbulb, Search, X } from "lucide-react";
import { useState } from "react";
import { Button } from "../../ui/Button.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { Kbd } from "../../ui/Kbd.tsx";
import { TextField } from "../../ui/TextField.tsx";
import { toast } from "../../ui/Toast.tsx";
import { MOCK_LESSONS, MOCK_RECIPES } from "../mockData.ts";

/** Lessons, concepts, and recipes, inside the tool. */
export function LearnDrawer({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const lessons = MOCK_LESSONS.filter((l) => !q || `${l.title} ${l.description}`.toLowerCase().includes(q));
  const recipes = MOCK_RECIPES.filter((r) => !q || r.title.toLowerCase().includes(q));
  const [current, ...rest] = lessons;

  return (
    <div className="sb-drawer__panel">
      <header className="sb-drawer__header">
        <BookOpen size={14} strokeWidth={2} className="sb-drawer__header-icon" aria-hidden />
        <h2 className="sb-drawer__title">Learn</h2>
        <div className="sb-drawer__header-actions">
          <IconButton size="sm" icon={<X size={14} />} label="Close" shortcut="Escape" onClick={onClose} />
        </div>
      </header>
      <div className="sb-drawer__body sb-scroll">
        <TextField
          aria-label="Search lessons and recipes"
          placeholder="Search lessons, recipes, and patches"
          leading={<Search size={13} strokeWidth={2} />}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onCancel={() => setQuery("")}
        />

        {current && current.progress !== undefined && (
          <section className="sb-learn__hero">
            <div className="sb-learn__eyebrow">Continue where you left off</div>
            <div className="sb-learn__hero-title">{current.title}</div>
            <p className="sb-learn__hero-text">{current.description}</p>
            <div className="sb-learn__progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(current.progress * 100)} aria-label="Lesson progress">
              <span style={{ width: `${current.progress * 100}%` }} />
            </div>
            <div className="sb-learn__hero-meta">Step 2 of 3 · wire the Switch into Pop Animation</div>
            <div className="sb-learn__hero-actions">
              <Button size="sm" variant="primary" trailingIcon={<ArrowRight size={13} />} onClick={() => toast({ title: "Step 2: connect Switch → Pop Animation", tone: "info" })}>
                Continue
              </Button>
              <Button size="sm" variant="ghost" icon={<CirclePlay size={13} />}>
                Watch it done
              </Button>
            </div>
          </section>
        )}

        {(current?.progress === undefined ? lessons : rest).length > 0 && (
          <section>
            <h3 className="sb-drawer__section-title">Concepts</h3>
            <div className="sb-learn__lessons">
              {(current?.progress === undefined ? lessons : rest).map((lesson, i) => (
                <button key={lesson.id} type="button" className="sb-learn__lesson">
                  <span className="sb-learn__lesson-index sb-tabular">{i + 2}</span>
                  <span className="sb-learn__lesson-text">
                    <span className="sb-learn__lesson-title">{lesson.title}</span>
                    <span className="sb-learn__lesson-desc">{lesson.description}</span>
                  </span>
                  <span className="sb-learn__lesson-time sb-tabular">{lesson.minutes} min</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {recipes.length > 0 && (
          <section>
            <h3 className="sb-drawer__section-title">Recipes</h3>
            <div className="sb-learn__recipes">
              {recipes.map((recipe, i) => (
                <button key={recipe.id} type="button" className="sb-learn__recipe" data-variant={i % 3}>
                  <span className="sb-learn__recipe-art" aria-hidden>
                    <i />
                    <i />
                  </span>
                  <span className="sb-learn__recipe-title">{recipe.title}</span>
                  <span className="sb-learn__recipe-meta">{recipe.patches} patches</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {lessons.length === 0 && recipes.length === 0 && <div className="sb-learn__empty">Nothing matches “{query}”. Try “spring” or “loop”.</div>}

        <section className="sb-learn__tip">
          <Lightbulb size={14} strokeWidth={2} aria-hidden />
          <div>
            Every patch explains itself. Select one and press <Kbd shortcut="Mod+/" /> to read what it does, with examples.
          </div>
        </section>
      </div>
    </div>
  );
}
