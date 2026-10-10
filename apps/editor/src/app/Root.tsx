import { useEffect, useState } from "react";
import { ThemeProvider } from "../theme/ThemeProvider.tsx";
import { CommandProvider } from "../ui/commands/CommandProvider.tsx";
import { loadable } from "../ui/loadable.tsx";
import { Toaster } from "../ui/Toast.tsx";
import { EditorApp } from "./EditorApp.tsx";
import { useRightDrawerInset } from "./rightDrawers.ts";

/** The widget gallery is a design-system page, so it loads only when visited. */
const Gallery = loadable(() => import("../gallery/Gallery.tsx").then((m) => m.Gallery), { name: "The widget gallery" });

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

/** Its own component so a drag of the drawer edge re-renders the toasts and not the whole editor. */
function DrawerAwareToaster() {
  return <Toaster inset={useRightDrawerInset()} />;
}

/** App root: theme, commands and shortcuts, toasts; the editor, or the widget gallery at #gallery. */
export function Root() {
  const route = useHashRoute();
  return (
    <ThemeProvider>
      <CommandProvider>
        {/* A page, not a dialog: with a fallback (nothing, while it loads) it says a problem in place. */}
        {route === "gallery" ? <Gallery fallback={null} /> : <EditorApp />}
        <DrawerAwareToaster />
      </CommandProvider>
    </ThemeProvider>
  );
}
