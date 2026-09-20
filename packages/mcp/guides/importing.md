# Importing designs

`import_design` turns a real screen into layers people can prototype with: backgrounds, borders, radii, shadows, text, images, SVG icons and text fields, named after data-name attributes, framework components, labels and roles. One import is one undo step. Import first, then spend your effort on the interaction.

Related: `start-here`, `animation`, `gestures`, `layout`

## Pick a source

| The screen lives in…                                                   | Do this                                                                                     |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| a web app you can run (React, Next, Vue, Svelte, Rails, Storybook)     | Start its dev server, then `import_design` with `url` per screen                            |
| code Sonobe can't render (SwiftUI, UIKit, Compose, React Native, Flutter) | Read the screen's code, write one static HTML page that reproduces it, import with `html` |
| nowhere yet (the person describes a new design)                        | Match what's there first (below), write the design as HTML, import with `html`, iterate with `replace` |
| a capture from the browser extension or a plugin                       | `import_design` with `capture`                                                              |

- `selector` imports one element, like a card or a sheet (`"#pricing-card"`, `"[data-testid=checkout]"`).
- `waitFor` waits for data that loads late; `waitMs` adds time for entrance animations to finish.
- The viewport defaults to the document's device. Pass `width` and `height` for tablet or desktop layouts.
- `colorScheme: "dark"` imports the page's dark mode (its `prefers-color-scheme` styles), and `"light"` its light mode.
- `screenshot: true` returns the page as the browser drew it, to compare with `get_screenshot`.

## How long an import takes

- Most imports take a few seconds. While one runs, it reports its steps as progress: loading the page, reading its layers, drawing SF Symbols, downloading images, taking the screenshot.
- A capture stops after 90 seconds plus `waitMs`, with `capture_timeout` naming the step it was on. The hint for that step says what to change.
- Images that are still downloading near the end become placeholders, and a screenshot that fails is left out. The result's notes say so.
- Cancelling the call before the screen is added changes nothing. Once the screen is added, it's one undo step like any other import.

## Write HTML that imports well

- **Match what's there**: read the prototype's styles with `get_outline` (`"detail": "styles"`: its most used colors, fonts, sizes and radii) and look at one screen with `get_screenshot` (`isolate: true`). Reuse those values exactly.
- **One screen per page**, laid out for the device width (`get_document_info` shows it). The viewer draws the status bar, so leave the top safe area empty (62 points on iPhone 17 Pro).
- **Real content**: the app's actual copy, numbers, avatars and photos (https or data: URLs), and icons as inline `<svg>`.
- **SF Symbols**: don't draw them. Write `<svg data-sf-symbol="heart.fill"></svg>`, styled like SwiftUI's `.font` and `.foregroundStyle`: `font-size` is the point size, `font-weight` the weight, `color` the color. `data-sf-palette="#0A84FF,#34C759"` sets palette colors, `data-sf-scale="large"` the image scale.
  - On a Mac, Sonobe draws the real symbol as an SVG image layer named after it (`heart.fill`), or after its `data-name` or `aria-label`. `get_document_info` says whether this host can.
  - Elsewhere, and for a name the Mac doesn't have, it's a gray placeholder of that size. The result's notes say why and suggest close names.
- **The app's tokens**: colors, font family and weights, radii, spacing, shadows. Copy them from its theme files. `<style>` works, and so does `<script src="https://cdn.tailwindcss.com"></script>` in the app.
- **Names**: put `data-name="Like Button"` on every element the prototype will touch, text included. Its layer takes that name, so its id is predictable (`like_button`).
  - An element that only holds text becomes a text layer with that name: `<div data-name="Card 1 Address">933 Kapahulu Ave</div>` is `card_1_address`. `aria-label`, `data-testid` and `id` name text the same way. Text nothing names is named by its words.
  - A box with a background or border keeps the name on its group, and its text keeps its words. To name the words too, wrap them: `<button data-name="Like Button"><span data-name="Like Label">Like</span></button>`. A named `<span>` inside a sentence becomes a text layer of its own.
  - `<body data-name="Discover">` names the screen when you don't pass `name`.
  - `::before` and `::after` can't carry a name, so draw anything you'll wire with a real element.
  - A `data-name` inside a very long paragraph that mixes styles can't get a layer of its own; the result says so.
- **Structure**: `position: fixed` bars stay on screen; content taller than the screen becomes a Content layer that scrolls; `overflow-x: auto` rows (carousels, chips) scroll sideways.
- **States**: elements with `display: none`, `visibility: hidden` or `opacity: 0` aren't imported. Import alternate states visible (a filled heart next to the outline), then hide them with `update_layers` and reveal them with patches.

For example, pass this page as `html` with `"name": "Post"`:

```html
<!doctype html>
<html>
  <body style="margin:0; font-family:system-ui; background:#fff">
    <article data-name="Post Card" style="margin:80px 16px; padding:16px; border-radius:20px; box-shadow:0 8px 24px rgba(0,0,0,.12)">
      <h2 style="margin:0 0 8px; font-size:20px">Sunset picnic</h2>
      <button data-name="Like Button" style="border:0; border-radius:999px; padding:8px 14px; background:#FF3B30; color:#fff; font-size:15px">♥ Like</button>
    </article>
  </body>
</html>
```

## After importing

1. **Read the result.** It lists the screen's layer ids (deepest levels trimmed on big screens). `get_outline` shows everything.
2. **Compare.** `get_screenshot` against the source (or `screenshot: true`). Fix what matters for the prototype with `update_layers`, or change the HTML and import again with `replace` set to the screen's id.
3. **Name what you wire.** Rename generic "Group" layers the person will talk about.
4. **Wire the interaction** onto the imported ids, then verify it with `sim_reset`, `sim_dispatch` and `sim_trace`.
5. **Iterate.** When the design changes (the person edits their app, or you revise the HTML), import again with `replace`. Layers found again at the same name path keep their ids, links and connections, so the wiring survives. Text an earlier import named by its words is found again by those words, even once a `data-name` renames it. The result says how many layers kept their ids and names every connection it had to drop (`@open_until_9_pm.text`), so you can wire those again. Text named by its words that now says something else counts as a new layer, so give text you wire a `data-name`. Before a replace over a screen the person may have changed, `dryRun: true` plans the import without changing anything and names the layers that wouldn't be found again. The result's notes name them after a real replace too.

A design captured elsewhere imports the same way:

```json tool:import_design
{
  "capture": {
    "format": "sonobe.design-capture",
    "version": 1,
    "source": { "kind": "chrome", "title": "Post" },
    "viewport": { "width": 402, "height": 874 },
    "root": {
      "kind": "frame",
      "name": "Post",
      "box": [0, 0, 402, 874],
      "fill": "#FFFFFFFF",
      "children": [
        {
          "kind": "frame",
          "name": "Like Button",
          "nameRank": 5,
          "box": [16, 400, 110, 40],
          "fill": "#FF3B30FF",
          "radii": [20, 20, 20, 20],
          "children": [
            {
              "kind": "text",
              "text": "♥ Like",
              "box": [36, 410, 70, 20],
              "style": { "fontFamily": "system-ui", "fontSize": 15, "fontWeight": 600, "color": "#FFFFFFFF", "lineHeight": 20 }
            }
          ]
        }
      ]
    },
    "images": {}
  }
}
```

Read the styles an import brought, to match the next screen to them:

```json tool:get_outline
{ "detail": "styles" }
```

Then make the imported button pop when it's tapped:

```json tool:add_patches
{
  "patches": [
    { "ref": "tap", "type": "interaction", "name": "Tap Like", "inputs": { "layer": { "layer": "like_button" } } },
    { "ref": "pressed", "type": "popAnimation", "name": "Press Spring", "inputs": { "number": { "link": "$tap.down" }, "bounciness": 8, "speed": 20 } },
    { "ref": "scale", "type": "transition", "name": "Like Scale", "inputs": { "progress": { "link": "$pressed.output" }, "start": 1, "end": 0.92 } }
  ],
  "connections": [{ "from": "$scale.output", "to": "@like_button.scale" }],
  "label": "press feedback on the imported Like button"
}
```

```text outline
  layer like_button group "Like Button" @16,400 110x40 scale←like_scale.output color=#FF3B30FF cornerRadius=20
```

## Limits

- A text layer has one style. A paragraph that mixes styles (a bold phrase, a link) becomes a group of text layers, one per styled run on each line, which looks right but edits in pieces. Very long mixed paragraphs flatten to their main style.
- Web fonts the page loads come along as font assets. When a font file can't be downloaded, the result says so and that text uses an installed font.
- CSS animations and transitions aren't imported. Build motion with patches: that's what Sonobe is for.
- Canvases that can't be read, videos without a frame, and embedded pages become placeholders. The result's notes list what was approximated.
- Headless servers render pages with Playwright's Chromium. When it isn't installed, `url` and `html` explain how to install it, and `capture` still works.
