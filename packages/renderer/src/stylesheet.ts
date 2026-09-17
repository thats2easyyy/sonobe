/** Injects a renderer stylesheet once per document or shadow root. */
export function ensureStylesheet(target: Node, id: string, css: string): void {
  const root = target.getRootNode() as Document | ShadowRoot;
  const doc = (root as Document).head !== undefined ? (root as Document) : null;
  const host: ParentNode | null = doc ? (doc.head ?? doc.documentElement) : (root as ShadowRoot);
  if (!host || typeof (host as ParentNode).querySelector !== "function") return;
  if (host.querySelector(`style[data-sonobe="${id}"]`)) return;
  const ownerDoc = doc ?? (target.ownerDocument as Document);
  const style = ownerDoc.createElement("style");
  style.setAttribute("data-sonobe", id);
  style.textContent = css;
  host.appendChild(style);
}
