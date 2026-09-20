import { Window } from "happy-dom";
import { afterEach, describe, expect, it } from "vitest";
import { PREVIEW_BOOTSTRAP, PREVIEW_MESSAGE_TYPE, previewCsp, previewShellHtml, renderablePrefix } from "./previewShell.ts";

describe("renderablePrefix", () => {
  it("keeps a complete page as it is", () => {
    const page = '<!doctype html><html><head><style>.a > .b{color:red}</style><script src="https://cdn.tailwindcss.com"></script></head><body><p class="a">Hi</p></body></html>';
    expect(renderablePrefix(page)).toBe(page);
  });

  it("cuts an unclosed script at its start", () => {
    expect(renderablePrefix('<p>One</p><script>const tag = "<b>";')).toBe("<p>One</p>");
    expect(renderablePrefix('<p>One</p><script src="https://cdn.tailwindcss.com"></script><p>Two</p><script>let')).toBe('<p>One</p><script src="https://cdn.tailwindcss.com"></script><p>Two</p>');
    expect(renderablePrefix("<p>One</p><scr")).toBe("<p>One</p>");
  });

  it("closes an unclosed style after its last complete rule", () => {
    expect(renderablePrefix("<style>.a{color:red} .b{colo")).toBe("<style>.a{color:red}</style>");
    expect(renderablePrefix("<style>@media (min-width: 1px){.a{color:red} .b{")).toBe("<style>@media (min-width: 1px){.a{color:red}</style>");
    expect(renderablePrefix("<style>:root{--accent:#8b5c")).toBe("<style></style>");
    expect(renderablePrefix("<style>.a{color:red}</sty")).toBe("<style>.a{color:red}</style>");
    expect(renderablePrefix('<p>One</p><style media="scr')).toBe("<p>One</p>");
  });

  it("cuts a half-written tag or attribute at the end", () => {
    expect(renderablePrefix("<p>Hi</p><di")).toBe("<p>Hi</p>");
    expect(renderablePrefix('<p>Hi</p><img src="https://example.com/a.png')).toBe("<p>Hi</p>");
    expect(renderablePrefix('<div class="card" data-name="Pay Butt')).toBe("");
    expect(renderablePrefix("<p>Hi</p")).toBe("<p>Hi");
    expect(renderablePrefix("<p>Hi</p><!-- a note")).toBe("<p>Hi</p>");
  });
});

describe("previewCsp and previewShellHtml", () => {
  it("lets nothing leave the frame", () => {
    const csp = previewCsp("n0nce");
    for (const directive of ["default-src 'none'", "connect-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-src 'none'", "object-src 'none'"]) expect(csp).toContain(directive);
    expect(csp).toContain("script-src 'nonce-n0nce' https://cdn.tailwindcss.com https://cdn.jsdelivr.net;");
    const shell = previewShellHtml("n0nce");
    expect(shell).toContain(`<script nonce="n0nce">${PREVIEW_BOOTSTRAP}</script>`);
    expect(shell).toContain(`content="${csp}"`);
  });
});

describe("PREVIEW_BOOTSTRAP", () => {
  const NONCE = "5f0c2a9e";
  let window: Window;

  afterEach(async () => {
    await window.happyDOM.close();
  });

  /** The shell in a happy-dom window, running its bootstrap as the frame would. */
  function frame() {
    window = new Window({ settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, handleDisabledFileLoadingAsSuccess: true } });
    window.document.write(previewShellHtml(NONCE));
    return window.document;
  }

  /** Dispatched inside the frame's own script context, where its parent is `window.parent`. */
  function message(data: unknown, source: "parent" | "other" = "parent") {
    (window as unknown as { __message: unknown }).__message = data;
    window.eval(`window.dispatchEvent(new MessageEvent("message", { data: window.__message, source: ${source === "parent" ? "window.parent" : "null"} }))`);
  }

  const page = (html: string, nonce = NONCE) => ({ type: PREVIEW_MESSAGE_TYPE, nonce, html });

  it("has the CSP meta as the first element in its head", () => {
    const doc = frame();
    const first = doc.head.firstElementChild!;
    expect(first.localName).toBe("meta");
    expect(first.getAttribute("http-equiv")).toBe("Content-Security-Policy");
    expect(first.getAttribute("content")).toBe(previewCsp(NONCE));
  });

  it("ignores messages from anyone but the parent, with another nonce, or of another type", () => {
    const doc = frame();
    message(page("<p>From a stranger</p>"), "other");
    message(page("<p>Wrong nonce</p>", "guess"));
    message({ type: "something-else", nonce: NONCE, html: "<p>Other type</p>" });
    expect(doc.body.innerHTML).toBe("");
    message(page("<p>From the canvas</p>"));
    expect(doc.body.innerHTML).toBe("<p>From the canvas</p>");
  });

  it("applies a partial style and swaps in the page's html and body attributes", () => {
    const doc = frame();
    message(page(renderablePrefix('<!doctype html><html class="dark" lang="en"><head><style>p{color:rgb(255, 0, 0)} .later{colo')));
    const managed = doc.head.querySelectorAll("style[data-sb]");
    expect(managed).toHaveLength(1);
    expect(managed[0]!.textContent).toBe("p{color:rgb(255, 0, 0)}");
    message(page('<!doctype html><html class="dark" lang="en"><head><style>p{color:rgb(255, 0, 0)}</style></head><body class="screen"><p>Hi</p></body></html>'));
    expect(doc.head.querySelectorAll("style[data-sb]")).toHaveLength(1);
    expect(doc.documentElement.getAttribute("class")).toBe("dark");
    expect(doc.body.getAttribute("class")).toBe("screen");
    expect(window.getComputedStyle(doc.querySelector("p")!).color).toBe("rgb(255, 0, 0)");
  });

  it("never runs the page's own scripts", () => {
    const doc = frame();
    // (happy-dom's parser swallows what follows an SVG script, so it goes last.)
    message(page('<body><p>Hi</p><script>window.ran = true;</script><img src="data:," onerror="window.ranHandler = true"><svg><script>window.ranSvg = true;</script></svg></body>'));
    const w = window as unknown as Record<string, unknown>;
    expect(w.ran).toBeUndefined();
    expect(w.ranSvg).toBeUndefined();
    expect(w.ranHandler).toBeUndefined();
    expect(doc.body.querySelectorAll("script")).toHaveLength(0);
    expect(doc.body.querySelector("img")!.hasAttribute("onerror")).toBe(false);
  });

  it("strips meta refreshes, base, frames, objects, embeds, on* attributes and javascript: URLs", () => {
    const doc = frame();
    message(
      page(
        '<html><head><meta http-equiv="refresh" content="0;url=https://example.com/"><base href="https://example.com/"></head>' +
          '<body onload="go()"><meta http-equiv="refresh" content="0"><iframe src="https://example.com/"></iframe><object data="x"></object><embed src="x">' +
          // (happy-dom's parser makes a frame hold what follows it, so it goes last.)
          '<a href=" java\tscript:alert(1)" onclick="go()">Link</a><button onpointerdown="go()" data-name="Pay">Pay</button><frame src="x"></body></html>',
      ),
    );
    expect([...doc.querySelectorAll("meta[http-equiv]")].map((m) => m.getAttribute("http-equiv"))).toEqual(["Content-Security-Policy"]);
    expect(doc.querySelectorAll("base, iframe, frame, object, embed")).toHaveLength(0);
    for (const el of [doc.body, ...doc.body.querySelectorAll("*")]) expect([...el.attributes].filter((a) => a.name.startsWith("on"))).toEqual([]);
    expect(doc.querySelector("a")!.hasAttribute("href")).toBe(false);
    expect(doc.querySelector("button")!.getAttribute("data-name")).toBe("Pay");
  });

  it("adds a Tailwind CDN script once, with the nonce, and no other script", () => {
    const doc = frame();
    const tailwind = '<script src="https://cdn.tailwindcss.com"></script>';
    const strangers = ["https://evil.example/x.js", "https://cdn.tailwindcss.com.evil.example/x.js", "https://cdn.tailwindcss.com@evil.example/x.js", "http://cdn.tailwindcss.com/", "https://cdn.jsdelivr.net/npm/left-pad", "tailwind.js"]
      .map((src) => `<script src="${src}"></script>`)
      .join("");
    message(page(`<head>${tailwind}${strangers}</head><body><p class="p-4">One</p></body>`));
    message(page(`<head>${tailwind}</head><body><p class="p-4">Two</p></body>`));
    message(page('<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script><p>Three</p>'));
    const scripts = [...doc.querySelectorAll("script[src]")];
    expect(scripts.map((s) => s.getAttribute("src"))).toEqual(["https://cdn.tailwindcss.com/", "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"]);
    for (const script of scripts) {
      expect(script.parentNode).toBe(doc.head);
      expect(script.getAttribute("nonce")).toBe(NONCE);
    }
    expect(doc.body.textContent).toBe("Three");
  });

  it("swaps the last page in again once a CDN script loads, so Tailwind's v3 CDN, which styles only later changes, sees it", async () => {
    const doc = frame();
    // Tailwind's v3 Play CDN watches the document from when it runs, just before its load event.
    const seen: string[] = [];
    doc.addEventListener(
      "load",
      (event) => {
        if (!(event.target instanceof window.HTMLScriptElement)) return;
        new window.MutationObserver((records) => {
          for (const record of records) for (const node of record.addedNodes) if (node.textContent) seen.push(node.textContent);
        }).observe(doc.documentElement, { childList: true, subtree: true });
      },
      true,
    );
    message(page('<head><script src="https://cdn.tailwindcss.com"></script></head><body><p class="p-8">Checkout</p></body>'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toContain("Checkout");
    expect(doc.body.innerHTML).toBe('<p class="p-8">Checkout</p>');
  });
});
