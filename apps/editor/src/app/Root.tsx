import { lazy, Suspense, useEffect, useState } from "react";
import { ThemeProvider } from "../theme/ThemeProvider.tsx";
import { CommandProvider } from "../ui/commands/CommandProvider.tsx";
import { Toaster } from "../ui/Toast.tsx";
import { EditorApp } from "./EditorApp.tsx";

/** The widget gallery is a design-system page, so it loads only when visited. */
const Gallery = lazy(() => import("../gallery/Gallery.tsx").then((m) => ({ default: m.Gallery })));

function currentRoute(): string {
  return window.location.hash.replace(/^#\/?/, "");
}

function useHashRoute(): string {
  const [route, setRoute] = useState(currentRoute);
  useEffect(() => {
    const onChange = () => setRoute(currentRoute());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

/** App root: theme, commands and shortcuts, toasts; the editor, or the widget gallery at #gallery. */
export function Root() {
  const route = useHashRoute();
  return (
    <ThemeProvider>
      <CommandProvider>
        {route === "gallery" ? (
          <Suspense fallback={null}>
            <Gallery />
          </Suspense>
        ) : (
          <EditorApp />
        )}
        <Toaster />
      </CommandProvider>
    </ThemeProvider>
  );
}
