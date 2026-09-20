/**
 * The player's menu, opened with a three-finger tap (gesture.ts): a small sheet over the prototype
 * with Restart, Reload, and, in the Sonobe Viewer app, Open Another Prototype. A one-time tip teaches
 * the gesture on touch screens. Plain DOM, styled in player.css.
 */

export interface PlayerMenuItem {
  id: string;
  label: string;
  run(): void;
}

export interface PlayerMenu {
  open(): void;
  close(): void;
  readonly isOpen: boolean;
  dispose(): void;
}

export interface PlayerMenuOptions {
  /** The prototype's name, shown at the top. */
  title(): string;
  /** A second line under the title ("Live from Sonobe"). */
  subtitle(): string;
  /** What the menu offers right now. */
  items(): PlayerMenuItem[];
  onOpen?(): void;
}

export function createPlayerMenu(doc: Document, options: PlayerMenuOptions): PlayerMenu {
  const root = doc.createElement("div");
  root.id = "menu";
  root.hidden = true;
  const scrim = doc.createElement("div");
  scrim.className = "menu-scrim";
  const sheet = doc.createElement("div");
  sheet.className = "menu-sheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-labelledby", "menu-title");
  sheet.tabIndex = -1;
  const heading = doc.createElement("div");
  heading.className = "menu-heading";
  const title = doc.createElement("div");
  title.id = "menu-title";
  title.className = "menu-title";
  const subtitle = doc.createElement("div");
  subtitle.className = "menu-subtitle";
  heading.append(title, subtitle);
  const list = doc.createElement("div");
  list.className = "menu-items";
  const cancel = doc.createElement("button");
  cancel.type = "button";
  cancel.className = "menu-cancel";
  cancel.textContent = "Cancel";
  sheet.append(heading, list, cancel);
  root.append(scrim, sheet);

  let open = false;

  const close = () => {
    if (!open) return;
    open = false;
    root.hidden = true;
    root.removeAttribute("data-open");
    // Out of the document while closed: WebKit keeps the page hidden from accessibility while a modal
    // dialog is in it, even a hidden one. Focus isn't handed back to the stage either: focusing its
    // role=application element from script hides the prototype's text from accessibility in WebKit, and
    // the next touch focuses it again.
    root.remove();
  };

  const show = () => {
    title.textContent = options.title();
    subtitle.textContent = options.subtitle();
    list.replaceChildren(
      ...options.items().map((item) => {
        const button = doc.createElement("button");
        button.type = "button";
        button.className = "menu-item";
        button.dataset.action = item.id;
        button.textContent = item.label;
        button.addEventListener("click", () => {
          close();
          item.run();
        });
        return button;
      }),
    );
    if (open) return;
    open = true;
    doc.body.appendChild(root);
    root.hidden = false;
    // The next frame, so the sheet animates in from its closed style.
    requestAnimationFrame(() => {
      if (open) root.setAttribute("data-open", "");
    });
    // Into the dialog for screen readers and keyboards; the sheet itself, so a touch shows no focus ring.
    sheet.focus({ preventScroll: true });
    options.onOpen?.();
  };

  const onKey = (e: KeyboardEvent) => {
    if (open && e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };
  scrim.addEventListener("click", close);
  cancel.addEventListener("click", close);
  doc.addEventListener("keydown", onKey);

  return {
    open: show,
    close,
    get isOpen() {
      return open;
    },
    dispose() {
      doc.removeEventListener("keydown", onKey);
      root.remove();
    },
  };
}

/** A short note at the bottom of the screen that fades out by itself. */
export function showTip(doc: Document, text: string, ms = 4500): () => void {
  const tip = doc.createElement("div");
  tip.id = "tip";
  tip.setAttribute("role", "status");
  tip.textContent = text;
  doc.body.appendChild(tip);
  requestAnimationFrame(() => tip.setAttribute("data-visible", ""));
  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    tip.removeAttribute("data-visible");
    setTimeout(() => tip.remove(), 300);
  };
  const timer = setTimeout(remove, ms);
  return () => {
    clearTimeout(timer);
    remove();
  };
}
