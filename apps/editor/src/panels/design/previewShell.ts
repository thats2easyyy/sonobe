/**
 * The live design preview's sandboxed page: a srcdoc shell whose CSP meta comes first in its head, and
 * a nonce bootstrap that swaps in the HTML Claude is writing. Claude's own scripts never run; only
 * Tailwind's CDN script is recreated. The preview captures and writes nothing: after each swap it
 * posts only its elements' boxes to the canvas, which builds the page from them (buildPlan.ts).
 */

/** The only script sources the preview recreates (Tailwind's CDN builds). */
export const PREVIEW_SCRIPT_PREFIXES: readonly string[] = ["https://cdn.tailwindcss.com", "https://cdn.jsdelivr.net/npm/@tailwindcss/browser"];

/** The `type` of the messages the canvas posts into the preview. */
export const PREVIEW_MESSAGE_TYPE = "sonobe-design-preview";

/** The `type` of the messages the preview posts back: its elements' boxes. */
export const PREVIEW_BOXES_TYPE = "sonobe-design-preview-boxes";

/** Nothing leaves the frame: no fetches, frames, forms or base URL; styles, images, fonts and media over https or inline. */
export function previewCsp(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' https://cdn.tailwindcss.com https://cdn.jsdelivr.net`,
    "style-src 'unsafe-inline' https:",
    "img-src data: blob: https:",
    "font-src data: https:",
    "media-src data: blob: https:",
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
}

/** The frame's srcdoc. The CSP meta is the first element in the head, so it covers everything after it. */
export function previewShellHtml(nonce: string): string {
  return (
    `<!doctype html><html><head>` +
    `<meta http-equiv="Content-Security-Policy" content="${previewCsp(nonce)}">` +
    `<meta charset="utf-8"><meta name="referrer" content="no-referrer">` +
    `<style>html,body{margin:0}svg[data-sf-symbol]:empty{display:inline-block;width:1em;height:1em;border-radius:.25em;background:rgba(127,127,127,.35)}</style>` +
    `<script nonce="${nonce}">${PREVIEW_BOOTSTRAP}</script></head><body></body></html>`
  );
}

/**
 * The shell's bootstrap script (plain JS, run inside the frame). It reads its nonce from its own tag,
 * accepts only the parent's messages carrying that nonce, and for each one: parses the page with
 * DOMParser; drops every script (keeping Tailwind CDN sources), meta refreshes, base, frames, objects,
 * embeds, on* attributes and javascript: URLs; swaps in the page's head styles, its html and body
 * attributes and its body; and adds each allowed CDN script once. When one loads, the last page is
 * swapped in again: Tailwind's v3 Play CDN styles only what changes after it starts, so a page that
 * came in one post would stay unstyled. Clicks and submits are cancelled. After each swap (and again
 * once styles and fonts settle) it measures the page's visible elements and posts their boxes to the
 * parent as `[path, shape, x, y, width, height, lines, radius]`: an image, video, canvas or svg, or an
 * element with a background image, as an image; an element with its own text as text line bars; a box
 * with a background, border or shadow as a box (an oval when it's round). Layout-only boxes are skipped.
 */
export const PREVIEW_BOOTSTRAP: string = `(function () {
  "use strict";
  var own = document.currentScript || document.querySelector("script[nonce]");
  var nonce = own ? own.nonce || own.getAttribute("nonce") || "" : "";
  if (!nonce) return;
  var PREFIXES = ${JSON.stringify(PREVIEW_SCRIPT_PREFIXES)};
  var STRIP = "script, meta[http-equiv], base, iframe, frame, object, embed";
  var added = Object.create(null);
  var last = null;
  var MAX_BOXES = 600;
  var MEDIA = { img: 1, svg: 1, video: 1, canvas: 1, picture: 1 };
  var soon = 0;
  var later = 0;
  function shown(color) {
    return !!color && color !== "transparent" && color.slice(-3) !== ", 0)" && color.slice(-2) !== "/0" && color.slice(-4) !== "/ 0)";
  }
  function ownText(el) {
    for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3 && n.nodeValue.trim()) return true;
    return false;
  }
  function bordered(cs) {
    var sides = ["Top", "Right", "Bottom", "Left"];
    for (var i = 0; i < sides.length; i++) if (parseFloat(cs["border" + sides[i] + "Width"]) > 0 && shown(cs["border" + sides[i] + "Color"])) return true;
    return false;
  }
  function measure() {
    var out = [];
    var vw = document.documentElement.clientWidth;
    var vh = document.documentElement.clientHeight;
    var range = document.createRange();
    function push(path, shape, r, lines, radius) {
      if (r.width < 2 || r.height < 2 || r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) return;
      out.push([path, shape, r.left, r.top, r.width, r.height, lines, radius]);
    }
    function visit(el, path) {
      var kids = el.children;
      for (var i = 0; i < kids.length && out.length < MAX_BOXES; i++) {
        var child = kids[i];
        var at = path + "/" + i;
        var cs = getComputedStyle(child);
        if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) === 0) continue;
        var r = child.getBoundingClientRect();
        var radius = parseFloat(cs.borderTopLeftRadius) || 0;
        if (MEDIA[child.localName] || (cs.backgroundImage && cs.backgroundImage.indexOf("url(") !== -1)) {
          push(at, 3, r, 1, radius);
          continue;
        }
        if (ownText(child)) {
          range.selectNodeContents(child);
          var t = range.getBoundingClientRect();
          var lh = parseFloat(cs.lineHeight) || (parseFloat(cs.fontSize) || 16) * 1.2;
          if (shown(cs.backgroundColor) || bordered(cs)) push(at + "#box", 0, r, 1, radius);
          push(at, 2, t.width >= 2 ? t : r, Math.max(1, Math.min(3, Math.round(t.height / lh))), 0);
          continue;
        }
        if (shown(cs.backgroundColor) || bordered(cs) || (cs.boxShadow && cs.boxShadow !== "none")) {
          var oval = radius >= Math.min(r.width, r.height) / 2 - 0.5 && Math.abs(r.width - r.height) < 2;
          push(at, oval ? 1 : 0, r, 1, radius);
        }
        visit(child, at);
      }
    }
    if (document.body) visit(document.body, "");
    window.parent.postMessage({ type: ${JSON.stringify(PREVIEW_BOXES_TYPE)}, nonce: nonce, boxes: out }, "*");
  }
  function remeasure() {
    clearTimeout(soon);
    clearTimeout(later);
    soon = setTimeout(measure, 30);
    later = setTimeout(measure, 450);
  }
  function cancel(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  document.addEventListener("click", cancel, true);
  document.addEventListener("submit", cancel, true);
  // The same scheme and host as a prefix, and its path or a version or file after it (never a look-alike host or user info).
  function allowedScript(src) {
    var url;
    try {
      url = new URL(src);
    } catch (error) {
      return null;
    }
    if (url.username || url.password) return null;
    for (var i = 0; i < PREFIXES.length; i++) {
      var prefix = new URL(PREFIXES[i]);
      if (url.protocol !== prefix.protocol || url.host !== prefix.host || url.pathname.indexOf(prefix.pathname) !== 0) continue;
      var rest = url.pathname.slice(prefix.pathname.length);
      if (prefix.pathname === "/" || rest === "" || rest.charAt(0) === "@" || rest.charAt(0) === "/") return url.href;
    }
    return null;
  }
  function clean(doc) {
    var sources = [];
    var dropped = doc.querySelectorAll(STRIP);
    for (var i = 0; i < dropped.length; i++) {
      var el = dropped[i];
      if (el.localName === "script") {
        var src = allowedScript((el.getAttribute("src") || "").trim());
        if (src) sources.push(src);
      }
      if (el.parentNode) el.parentNode.removeChild(el);
    }
    var all = doc.getElementsByTagName("*");
    for (var j = 0; j < all.length; j++) {
      var attrs = all[j].attributes;
      for (var k = attrs.length - 1; k >= 0; k--) {
        var name = attrs[k].name;
        var value = attrs[k].value.replace(/[\\u0000-\\u0020]+/g, "").toLowerCase();
        if (name.toLowerCase().indexOf("on") === 0 || value.indexOf("javascript:") === 0) all[j].removeAttribute(name);
      }
    }
    return sources;
  }
  function copyAttributes(target, source) {
    for (var i = target.attributes.length - 1; i >= 0; i--) {
      var name = target.attributes[i].name;
      if (!source.hasAttribute(name)) target.removeAttribute(name);
    }
    for (var j = 0; j < source.attributes.length; j++) target.setAttribute(source.attributes[j].name, source.attributes[j].value);
  }
  function render(html) {
    var doc = new DOMParser().parseFromString(html, "text/html");
    var sources = clean(doc);
    var head = document.head;
    var managed = head.querySelectorAll("[data-sb]");
    for (var i = 0; i < managed.length; i++) head.removeChild(managed[i]);
    var styles = doc.head.querySelectorAll("style, link");
    for (var j = 0; j < styles.length; j++) {
      var node = styles[j];
      if (node.localName === "link" && !/(^|\\s)stylesheet(\\s|$)/i.test(node.getAttribute("rel") || "")) continue;
      var copy = document.importNode(node, true);
      copy.setAttribute("data-sb", "");
      head.appendChild(copy);
    }
    copyAttributes(document.documentElement, doc.documentElement);
    copyAttributes(document.body, doc.body);
    var fragment = document.createDocumentFragment();
    var children = doc.body.childNodes;
    for (var k = 0; k < children.length; k++) fragment.appendChild(document.importNode(children[k], true));
    while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    document.body.appendChild(fragment);
    for (var s = 0; s < sources.length; s++) {
      if (added[sources[s]]) continue;
      added[sources[s]] = true;
      var script = document.createElement("script");
      script.setAttribute("nonce", nonce);
      script.onload = renderLast;
      script.src = sources[s];
      head.appendChild(script);
    }
  }
  function renderLast() {
    if (last !== null) render(last);
    remeasure();
  }
  window.addEventListener("message", function (event) {
    var data = event.data;
    if (event.source !== window.parent || !data || data.type !== ${JSON.stringify(PREVIEW_MESSAGE_TYPE)} || data.nonce !== nonce || typeof data.html !== "string") return;
    last = data.html;
    render(data.html);
    remeasure();
  });
})();`;

/** Where the tag named `name` closes after `from`, or -1. */
function closeTag(html: string, name: string, from: number): { index: number; end: number } | null {
  const re = new RegExp(`</${name}\\s*>`, "gi");
  re.lastIndex = from;
  const m = re.exec(html);
  return m ? { index: m.index, end: m.index + m[0].length } : null;
}

/** Without a trailing half-written tag (the last `<` after the last `>`). */
function withoutHalfTag(html: string): string {
  const lt = html.lastIndexOf("<");
  return lt > html.lastIndexOf(">") ? html.slice(0, lt) : html;
}

/**
 * The part of a partial page that renders cleanly: an unclosed script is cut at its start, an unclosed
 * style keeps its rules up to the last `}` and is closed, an unclosed comment is cut, and a half-written
 * tag at the end is cut.
 */
export function renderablePrefix(html: string): string {
  const open = /<!--|<(script|style)(?=[\s/>]|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = open.exec(html))) {
    if (m[0] === "<!--") {
      const end = html.indexOf("-->", m.index + 4);
      if (end === -1) return withoutHalfTag(html.slice(0, m.index));
      open.lastIndex = end + 3;
      continue;
    }
    const name = m[1]!.toLowerCase();
    const close = closeTag(html, name, m.index + m[0].length);
    if (close) {
      open.lastIndex = close.end;
      continue;
    }
    const tagEnd = html.indexOf(">", m.index);
    if (name === "script" || tagEnd === -1) return withoutHalfTag(html.slice(0, m.index));
    const rules = html.slice(tagEnd + 1);
    return `${html.slice(0, tagEnd + 1)}${rules.slice(0, rules.lastIndexOf("}") + 1)}</style>`;
  }
  return withoutHalfTag(html);
}
