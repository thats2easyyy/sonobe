/**
 * The startup benchmark's side of the editor page (tests/startup-bench.mjs): a second preload that hook.cjs
 * registers for the run, sandboxed and in its own world. It only watches the DOM for the moments a person
 * would notice, reads the page's paint entries, and reports them one second after the last signal it waits for.
 *
 * Times are performance.now() in the page's clock; `timeOrigin` turns them into wall-clock time.
 */
"use strict";
(() => {
  if (window.top !== window || !/index\.html$/.test(location.pathname)) return;
  const { ipcRenderer } = require("electron");

  /** Part of the document's name the toolbar must show (a launch with a project). */
  const expectDoc = process.env.SONOBE_BENCH_EXPECT_DOC || "";
  const expectWelcome = process.env.SONOBE_BENCH_EXPECT_WELCOME === "1";
  const marks = {};
  const mark = (name) => {
    if (!(name in marks)) marks[name] = performance.now();
  };
  mark("preload");
  /** Every document name the toolbar showed, in order. */
  const titles = [];
  let done = false;
  let settle = null;

  const q = (selector) => document.querySelector(selector);
  /** Elements the prototype drew in the viewer. The device's own chrome is a handful. */
  const drawn = () => {
    const device = q(".sb-vw__device .sonobe-device");
    if (!device) return 0;
    let n = 0;
    for (const el of device.querySelectorAll("*")) if (!el.classList.contains("sonobe-device-button")) n += 1;
    return n;
  };

  function check() {
    if (done) return;
    if (q(".sb-app.sb-shell")) mark("shell");
    if ((q("#sb-layers")?.textContent ?? "").length > 20) mark("layers");
    const frame = drawn() >= 12;
    if (frame) mark("viewer");
    const title = (q(".sb-toolbar__doc")?.textContent ?? "").trim();
    if (title && titles[titles.length - 1] !== title) titles.push(title);
    if (q(".sb-welcome[role=dialog]")) mark("welcome");
    if (q(".sb-pe .react-flow__node")) mark("patchNodes");
    if (marks.shell !== undefined && marks.layers !== undefined && marks.viewer !== undefined) mark("usable");
    // The opened document counts once its name is up and the viewer has drawn it.
    if (expectDoc && title.includes(expectDoc) && frame) mark("opened");
    const waiting = marks.usable === undefined || (expectDoc && marks.opened === undefined) || (expectWelcome && marks.welcome === undefined);
    if (!waiting && !settle) settle = setTimeout(report, 1000);
  }

  function report() {
    if (done) return;
    done = true;
    observer.disconnect();
    const paint = Object.fromEntries(performance.getEntriesByType("paint").map((entry) => [entry.name, entry.startTime]));
    ipcRenderer.send("sonobe-bench:result", { timeOrigin: performance.timeOrigin, marks, titles, paint, settled: settle !== null });
  }

  const observer = new MutationObserver(check);
  observer.observe(document, { childList: true, subtree: true, characterData: true });
  document.addEventListener("DOMContentLoaded", check);
  window.addEventListener("load", check);
  // Signals that never line up are still reported, as far as they got.
  setTimeout(report, 25_000);
})();
