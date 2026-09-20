import type { BetaMessage, BetaRawMessageStreamEvent } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { describe, expect, it } from "vitest";
import { createDraftStreams, createJsonFieldStream } from "./draftStream.ts";
import type { AssistantEvent } from "./protocol.ts";

/** A seeded generator (mulberry32), so a failing chunking replays. */
function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cuts text at random points (inside escapes and surrogate pairs too) into chunks of 1–max code units. */
function chunk(text: string, random: () => number, max: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; ) {
    const n = 1 + Math.floor(random() * max);
    out.push(text.slice(i, i + n));
    i += n;
  }
  return out;
}

const HTML = [
  '<!doctype html><html><head><style>:root{--accent:#8B5CF6}.card{border-radius:24px}</style></head>',
  '<body data-name="Checkout"><h1 data-name="Title">Say "hi" \\ back</h1>',
  "\n<p>Caf\u00e9 cr\u00e8me \u00fcber</p>\t",
  "<b>1 < 2 > 0</b>",
  "<span>raw 😀 and escaped 🎉</span>",
  '<a href="https://example.com/a/b">link</a><div data-name=\'{"html":"no"}\'></div></body></html>',
].join("");

const INPUT = {
  docId: "doc_1",
  component: "main",
  name: 'Check "out" é',
  replace: "card_1",
  position: [12, 34.5],
  meta: { html: "<nested>", list: [1, { html: "x", note: "]}" }] },
  label: 'Not "html": "<fake>"',
  html: HTML,
  width: 402,
  height: 874,
};

const FIELDS = { name: INPUT.name, replace: "card_1", component: "main", position: [12, 34.5], width: 402, height: 874 };

/** INPUT as JSON with escapes JSON.stringify doesn't write: \u00e9, \u003c, \/ and an escaped surrogate pair. */
const JSON_TEXT = JSON.stringify(INPUT).replaceAll("é", "\\u00e9").replaceAll("🎉", "\\ud83c\\udf89").replaceAll("<b>", "\\u003cb>").replaceAll("</", "<\\/");

const isHighSurrogate = (s: string) => s.length > 0 && s.charCodeAt(s.length - 1) >= 0xd800 && s.charCodeAt(s.length - 1) <= 0xdbff;

describe("createJsonFieldStream", () => {
  it("decodes the html and the fields across 200 random chunkings", () => {
    expect(JSON.parse(JSON_TEXT)).toEqual(INPUT);
    expect(JSON_TEXT).toContain("\\u00e9");
    expect(JSON_TEXT).toContain("\\ud83c\\udf89");
    expect(JSON_TEXT).toContain("😀");
    for (let seed = 1; seed <= 200; seed++) {
      const random = seeded(seed);
      const stream = createJsonFieldStream();
      const pieces: string[] = [];
      for (const part of chunk(JSON_TEXT, random, seed % 10 === 0 ? 200 : 1 + (seed % 24))) {
        const { html } = stream.push(part);
        if (!stream.htmlDone) expect(isHighSurrogate(html), `seed ${seed}`).toBe(false);
        pieces.push(html);
      }
      expect(pieces.join(""), `seed ${seed}`).toBe(HTML);
      expect(stream.fields, `seed ${seed}`).toEqual(FIELDS);
      expect(stream.htmlDone).toBe(true);
      expect(stream.htmlLength).toBe(HTML.length);
    }
  });

  it("takes every prefix of the JSON without throwing, and decodes a prefix of the html", () => {
    for (let n = 0; n <= JSON_TEXT.length; n++) {
      const stream = createJsonFieldStream();
      let html = "";
      expect(() => (html = stream.push(JSON_TEXT.slice(0, n)).html)).not.toThrow();
      expect(HTML.startsWith(html)).toBe(true);
    }
  });

  it("reports a field once, when its value is complete, and a position split across chunks", () => {
    const stream = createJsonFieldStream();
    expect(stream.push('{"name":"Chec')).toEqual({ html: "", fieldsChanged: false });
    expect(stream.push('kout","posi')).toEqual({ html: "", fieldsChanged: true });
    expect(stream.push('tion":[1')).toEqual({ html: "", fieldsChanged: false });
    expect(stream.push("2.5, -")).toEqual({ html: "", fieldsChanged: false });
    expect(stream.push("3] ,")).toEqual({ html: "", fieldsChanged: true });
    expect(stream.push('"width": 40')).toEqual({ html: "", fieldsChanged: false });
    expect(stream.push("2 ,")).toEqual({ html: "", fieldsChanged: true });
    expect(stream.push('"name":"Checkout",')).toEqual({ html: "", fieldsChanged: false });
    expect(stream.fields).toEqual({ name: "Checkout", position: [12.5, -3], width: 402 });
  });

  it("keeps only fields of the types the preview reads", () => {
    const stream = createJsonFieldStream();
    stream.push('{"width":"402","height":null,"position":[1],"name":7,"replace":"card","component":{"id":"x"},"na\\u006de":"Escaped key","html":"<p>"}');
    expect(stream.fields).toEqual({ replace: "card", name: "Escaped key" });
  });

  it("ignores html keys nested in other values, and a second top-level html", () => {
    const stream = createJsonFieldStream();
    const { html } = stream.push('{"meta":{"html":"no","deeper":[{"html":"no"}]},"label":"\\"html\\":\\"no\\"","html":"yes","html":"again"}');
    expect(html).toBe("yes");
    expect(stream.htmlDone).toBe(true);
  });

  it("holds a high surrogate back until its pair arrives, escaped or raw", () => {
    const escaped = createJsonFieldStream();
    expect(escaped.push('{"html":"a\\ud83d').html).toBe("a");
    expect(escaped.push("\\ude").html).toBe("");
    expect(escaped.push('00b"}').html).toBe("😀b");
    const raw = createJsonFieldStream();
    expect(raw.push('{"html":"a\ud83d').html).toBe("a");
    expect(raw.htmlLength).toBe(1);
    expect(raw.push('\ude00b"}').html).toBe("😀b");
    expect(raw.htmlLength).toBe(4);
  });

  it("stops for good on malformed input, without throwing", () => {
    for (const bad of ['{"html":"abc\\q more"}', '{"html":"ab\\u12G4"}', "[1,2]", '{"name": nope}', '{"name":"x" "html":"y"}', '{"a":1}}{"html":"z"}']) {
      const stream = createJsonFieldStream();
      expect(() => stream.push(bad)).not.toThrow();
      expect(stream.push('"html":"later"}').html).toBe("");
      expect(stream.htmlDone).toBe(false);
    }
    const stream = createJsonFieldStream();
    expect(stream.push('{"html":"abc\\q').html).toBe("abc");
    expect(stream.push('def"}').html).toBe("");
    // A high surrogate cut off by the malformed escape after it isn't sent alone.
    expect(createJsonFieldStream().push('{"html":"a\ud83d\\q').html).toBe("a");
  });

  it("reads a whole input with no html key (a url source) as fields only", () => {
    const stream = createJsonFieldStream();
    expect(stream.push('{"url":"https://example.com","name":"Home","html":5}')).toEqual({ html: "", fieldsChanged: true });
    expect(stream.htmlDone).toBe(false);
    expect(stream.fields).toEqual({ name: "Home" });
  });
});

const start = (index: number, name: string, id = `toolu_${index}`) => ({ type: "content_block_start", index, content_block: { type: "tool_use", id, name, input: {} } }) as BetaRawMessageStreamEvent;
const delta = (index: number, partial_json: string) => ({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json } }) as BetaRawMessageStreamEvent;
const stop = (index: number) => ({ type: "content_block_stop", index }) as BetaRawMessageStreamEvent;
const message = (content: unknown[]) => ({ id: "msg_1", type: "message", role: "assistant", content, stop_reason: "tool_use" }) as unknown as BetaMessage;

type Draft = Extract<AssistantEvent, { type: "design_draft" }>;

function recorder(options: { now?: () => number; intervalMs?: number } = {}) {
  const events: AssistantEvent[] = [];
  const drafts = createDraftStreams({ runId: "run_1", turn: 2, emit: (e) => events.push(e), ...options });
  return { events, drafts, sent: () => events as Draft[] };
}

describe("createDraftStreams", () => {
  it("streams appends at their offsets and ends with done carrying the whole html", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const random = seeded(seed);
      let t = 0;
      const { events, drafts, sent } = recorder({ now: () => (t += Math.floor(random() * 40)) });
      drafts.onEvent(start(1, "import_design", "toolu_a"));
      for (const part of chunk(JSON_TEXT, random, 30)) drafts.onEvent(delta(1, part));
      drafts.onEvent(stop(1));
      expect(events.every((e) => e.type === "design_draft" && e.runId === "run_1" && e.turn === 2 && e.toolUseId === "toolu_a")).toBe(true);
      let length = 0;
      for (const e of sent()) {
        expect(e.offset, `seed ${seed}`).toBe(length);
        length += e.append.length;
      }
      expect(sent().map((e) => e.append).join("")).toBe(HTML);
      const last = sent().at(-1)!;
      expect(last).toMatchObject({ done: true, html: HTML });
      expect(last.fields).toEqual(FIELDS);
      expect(sent().filter((e) => e.done)).toHaveLength(1);
      expect(sent()[0]!.fields).toEqual({ name: INPUT.name, replace: "card_1", component: "main", position: [12, 34.5] });
    }
  });

  it("throttles appends to intervalMs with an injected clock, and sends field changes at once", () => {
    let t = 0;
    const { events, drafts } = recorder({ now: () => t, intervalMs: 50 });
    drafts.onEvent(start(1, "import_design"));
    drafts.onEvent(delta(1, '{"docId":"doc_1","name":"Checkout",'));
    expect(events).toEqual([]); // nothing before the html
    t = 5;
    drafts.onEvent(delta(1, '"html":"<div>'));
    t = 20;
    drafts.onEvent(delta(1, "Hello"));
    t = 54;
    drafts.onEvent(delta(1, " there"));
    t = 55;
    drafts.onEvent(delta(1, "!"));
    t = 60;
    drafts.onEvent(delta(1, '</div>"'));
    t = 70;
    drafts.onEvent(delta(1, ',"width":402}'));
    drafts.onEvent(stop(1));
    const base = { type: "design_draft", runId: "run_1", turn: 2, toolUseId: "toolu_1" };
    expect(events).toEqual([
      { ...base, offset: 0, append: "<div>", fields: { name: "Checkout" }, done: false },
      { ...base, offset: 5, append: "Hello there!", done: false },
      { ...base, offset: 17, append: "</div>", fields: { name: "Checkout", width: 402 }, done: false },
      { ...base, offset: 23, append: "", fields: { name: "Checkout", width: 402 }, done: true, html: "<div>Hello there!</div>" },
    ]);
  });

  it("emits nothing for other tools, url sources, text or blocks it didn't see start", () => {
    const { events, drafts } = recorder();
    drafts.onEvent(start(0, "add_layers"));
    drafts.onEvent(delta(0, '{"layers":[{"type":"text","name":"html"}],"html":"<p>no</p>"}'));
    drafts.onEvent(stop(0));
    drafts.onEvent(start(1, "import_design"));
    drafts.onEvent(delta(1, '{"name":"Home","replace":"home",'));
    drafts.onEvent(delta(1, '"url":"https://example.com"}'));
    drafts.onEvent(stop(1));
    drafts.onEvent({ type: "content_block_start", index: 2, content_block: { type: "text", text: "", citations: null } } as BetaRawMessageStreamEvent);
    drafts.onEvent({ type: "content_block_delta", index: 2, delta: { type: "text_delta", text: '"html":"x"' } } as BetaRawMessageStreamEvent);
    drafts.onEvent(delta(3, '{"html":"<p>unseen</p>"}'));
    drafts.onEvent(stop(3));
    drafts.finish(message([{ type: "tool_use", id: "toolu_0", name: "add_layers", input: { html: "<p>no</p>" } }, { type: "tool_use", id: "toolu_1", name: "import_design", input: { name: "Home", url: "https://example.com" } }]));
    expect(events).toEqual([]);
  });

  it("finish covers import_design blocks that never streamed or never finished decoding", () => {
    const { events, drafts } = recorder();
    // Streamed and done at its stop: finish doesn't repeat it.
    drafts.onEvent(start(0, "import_design", "toolu_streamed"));
    drafts.onEvent(delta(0, '{"html":"<p>streamed</p>"}'));
    drafts.onEvent(stop(0));
    // JSON the decoder gave up on.
    drafts.onEvent(start(1, "import_design", "toolu_broken"));
    drafts.onEvent(delta(1, '{"html":"<p>br\\x'));
    drafts.onEvent(stop(1));
    drafts.finish(
      message([
        { type: "tool_use", id: "toolu_streamed", name: "import_design", input: { html: "<p>streamed</p>" } },
        { type: "tool_use", id: "toolu_broken", name: "import_design", input: { name: "Broken", html: "<p>broken</p>" } },
        { type: "tool_use", id: "toolu_whole", name: "import_design", input: { docId: "doc_1", name: "Whole", width: 402, position: [0, "0"], html: "<p>whole</p>" } },
      ]),
    );
    drafts.finish(message([{ type: "tool_use", id: "toolu_whole", name: "import_design", input: { html: "<p>whole</p>" } }]));
    const base = { type: "design_draft", runId: "run_1", turn: 2 };
    expect(events).toEqual([
      { ...base, toolUseId: "toolu_streamed", offset: 0, append: "<p>streamed</p>", done: false },
      { ...base, toolUseId: "toolu_streamed", offset: 15, append: "", fields: {}, done: true, html: "<p>streamed</p>" },
      { ...base, toolUseId: "toolu_broken", offset: 0, append: "<p>br", done: false },
      { ...base, toolUseId: "toolu_broken", offset: 0, append: "", fields: { name: "Broken" }, done: true, html: "<p>broken</p>" },
      { ...base, toolUseId: "toolu_whole", offset: 0, append: "", fields: { name: "Whole", width: 402 }, done: true, html: "<p>whole</p>" },
    ]);
  });

  it("keeps two import_design blocks in one reply apart", () => {
    const { drafts, sent } = recorder();
    drafts.onEvent(start(0, "import_design", "toolu_a"));
    drafts.onEvent(start(1, "import_design", "toolu_b"));
    drafts.onEvent(delta(0, '{"html":"<p>a'));
    drafts.onEvent(delta(1, '{"html":"<p>b'));
    drafts.onEvent(delta(0, '</p>"}'));
    drafts.onEvent(delta(1, '</p>"}'));
    drafts.onEvent(stop(0));
    drafts.onEvent(stop(1));
    const done = sent().filter((e) => e.done);
    expect(done.map((e) => [e.toolUseId, e.html])).toEqual([
      ["toolu_a", "<p>a</p>"],
      ["toolu_b", "<p>b</p>"],
    ]);
  });
});
