/**
 * User-perceived characters (extended grapheme clusters) for the text patches, so an emoji or an
 * accented letter counts as one character. Uses Intl.Segmenter, with a code-point fallback that
 * patches report once per restart.
 */

import type { OnceContext } from "../infra/index.ts";
import { warnOnce } from "../infra/index.ts";

/** The part of Intl.Segmenter the splitter uses. */
export interface SegmenterLike {
  segment(text: string): Iterable<{ segment: string; index: number }>;
}

export interface GraphemeSplitter {
  /** True when grapheme segmentation is available; false means text splits into code points. */
  readonly native: boolean;
  /** Every grapheme of `text`, in order. */
  split(text: string): string[];
  /** How many graphemes `text` has. */
  count(text: string): number;
  /** How many graphemes end at or before the UTF-16 `offset` (a match inside a grapheme reports that grapheme). */
  indexAt(text: string, offset: number): number;
}

/** A splitter over `segmenter`, or over code points when it's null. */
export function createGraphemeSplitter(segmenter: SegmenterLike | null): GraphemeSplitter {
  if (!segmenter) {
    return {
      native: false,
      split: (text) => Array.from(text),
      count(text) {
        let n = 0;
        for (const _ of text) n++;
        return n;
      },
      indexAt(text, offset) {
        let n = 0;
        let end = 0;
        for (const ch of text) {
          end += ch.length;
          if (end > offset) break;
          n++;
        }
        return n;
      },
    };
  }
  return {
    native: true,
    split: (text) => Array.from(segmenter.segment(text), (s) => s.segment),
    count(text) {
      let n = 0;
      for (const _ of segmenter.segment(text)) n++;
      return n;
    },
    indexAt(text, offset) {
      let n = 0;
      for (const s of segmenter.segment(text)) {
        if (s.index + s.segment.length > offset) break;
        n++;
      }
      return n;
    },
  };
}

function platformSegmenter(): SegmenterLike | null {
  try {
    return typeof Intl !== "undefined" && typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
  } catch {
    return null;
  }
}

/** The shared splitter (grapheme boundaries don't depend on the locale). */
export const graphemeSplitter: GraphemeSplitter = createGraphemeSplitter(platformSegmenter());

/** Log one warning per restart when `splitter` can only split code points. */
export function warnIfCodePointsOnly(ctx: OnceContext, patchName: string, splitter: GraphemeSplitter = graphemeSplitter): void {
  if (splitter.native) return;
  warnOnce(
    ctx,
    "graphemes",
    `${patchName}: this platform can't find character boundaries (Intl.Segmenter is missing), so emoji made of several parts count as more than one character.`,
  );
}
