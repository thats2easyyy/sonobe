import { useEffect, useState } from "react";
import { Gallery } from "./gallery/Gallery.tsx";
import { AppShell } from "./shell/AppShell.tsx";
import { ThemeProvider } from "./theme/ThemeProvider.tsx";
import { Toaster } from "./ui/Toast.tsx";
import { CommandProvider } from "./ui/commands/CommandProvider.tsx";

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

/** Editor root: theme, commands and shortcuts, toasts, and the #gallery route. */
export function App() {
  const route = useHashRoute();
  return (
    <ThemeProvider>
      <CommandProvider>
        {route === "gallery" ? <Gallery /> : <AppShell />}
        <Toaster />
      </CommandProvider>
    </ThemeProvider>
  );
}
