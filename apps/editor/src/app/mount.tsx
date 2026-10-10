/**
 * Mounting the editor so its window is never blank (ARCHITECTURE §9, Error containment): errors that
 * reach `window` and React's root are reported, and a root boundary shows the recovery screen when the
 * tree can't render. The boundary sits outside the app root, so a failure in the theme or the command
 * provider is covered too.
 */

import { StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ErrorBoundary, type BoundaryProblem } from "../ui/ErrorBoundary.tsx";
import { installErrorReporting, rootErrorOptions } from "./errorReports.ts";
import { RecoveryScreen } from "./RecoveryScreen.tsx";

// No Try again at the root: a tree that failed as a whole starts over from a clean page.
const recovery = ({ error, componentStack }: BoundaryProblem) => <RecoveryScreen error={error} componentStack={componentStack} />;

export function mountEditor(container: Element, children: ReactNode): Root {
  installErrorReporting();
  const root = createRoot(container, rootErrorOptions(container));
  root.render(
    <StrictMode>
      <ErrorBoundary name="Sonobe" fallback={recovery}>
        {children}
      </ErrorBoundary>
    </StrictMode>,
  );
  return root;
}
