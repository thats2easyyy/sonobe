/**
 * The Inspector's subject: what it shows the properties of, as a key ("layers:card,title"). The
 * Inspector stays mounted when the selection changes, so its rows and sections are the same
 * elements for the next layer. Anything that belonged to the old subject has to be let go on
 * purpose: state that should start over uses `useSubjectState`, and a part that holds more than
 * that (a control with a typed draft, an open menu) is keyed by `useSubjectKey()` and remounts.
 */

import { createContext, useContext, useState, type Dispatch, type SetStateAction } from "react";

const SubjectContext = createContext("");

export const SubjectProvider = SubjectContext.Provider;

export const subjectKey = (kind: "layers" | "patches" | "none", ids: readonly string[] = []): string => `${kind}:${ids.join(",")}`;

/** The key of what the Inspector shows. It's "" outside the Inspector, so nothing there ever starts over. */
export function useSubjectKey(): string {
  return useContext(SubjectContext);
}

/** `useState` that goes back to `initial` when the Inspector's subject changes. */
export function useSubjectState<T>(initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const subject = useSubjectKey();
  const [state, setState] = useState(initial);
  const [seen, setSeen] = useState(subject);
  if (seen === subject) return [state, setState];
  // Set while rendering: React renders this component again before it paints, with the state as new.
  const fresh = typeof initial === "function" ? (initial as () => T)() : initial;
  setSeen(subject);
  setState(() => fresh);
  return [fresh, setState];
}
