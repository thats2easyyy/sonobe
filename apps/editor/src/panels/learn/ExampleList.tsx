import { CirclePlay } from "lucide-react";
import { useState } from "react";
import { Tooltip } from "../../ui/Tooltip.tsx";
import type { ExampleProject } from "./examples.ts";

export interface ExampleListProps {
  examples: readonly ExampleProject[];
  onTry: (example: ExampleProject) => void;
  /** Rows shown before the rest are folded away. */
  limit: number;
  /** A line of each example's description under its name. */
  descriptions?: boolean;
  /** A row's title. Default: the example's name. */
  title?: (example: ExampleProject) => string;
  /** The button that shows the rest. */
  moreLabel: (hidden: number, total: number) => string;
}

/** Bundled examples as one row each; the whole row opens the example as a new prototype. */
export function ExampleList({ examples, onTry, limit, descriptions = false, title = (example) => example.name, moreLabel }: ExampleListProps) {
  const [all, setAll] = useState(false);
  const shown = all ? examples : examples.slice(0, limit);
  const hidden = examples.length - shown.length;
  return (
    <>
      <ul className="sb-examples">
        {shown.map((example) => (
          <li key={example.folder}>
            <Tooltip content="Opens as a new prototype" placement="left">
              <button type="button" className="sb-examples__item" onClick={() => onTry(example)}>
                <span className="sb-examples__text">
                  <span className="sb-examples__title">{title(example)}</span>
                  {descriptions && example.description && <span className="sb-examples__desc">{example.description}</span>}
                </span>
                <CirclePlay size={14} strokeWidth={1.75} className="sb-examples__play" aria-hidden />
              </button>
            </Tooltip>
          </li>
        ))}
      </ul>
      {examples.length > limit && (
        <button type="button" className="sb-learnx__more" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : moreLabel(hidden, examples.length)}
        </button>
      )}
    </>
  );
}
