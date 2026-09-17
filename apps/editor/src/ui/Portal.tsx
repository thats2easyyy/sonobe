import { useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface PortalProps {
  children: ReactNode;
  /** Copy the nearest `data-theme` from this element so overlays match a themed subtree. */
  themeFrom?: Element | null;
}

/** Renders children into a container appended to <body>. Mounts after the container is attached. */
export function Portal({ children, themeFrom }: PortalProps) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const el = document.createElement("div");
    el.className = "sb-portal";
    document.body.appendChild(el);
    setContainer(el);
    return () => {
      el.remove();
    };
  }, []);

  useLayoutEffect(() => {
    if (!container) return;
    const theme = themeFrom?.closest("[data-theme]")?.getAttribute("data-theme");
    if (theme) container.setAttribute("data-theme", theme);
    else container.removeAttribute("data-theme");
  });

  return container ? createPortal(children, container) : null;
}
