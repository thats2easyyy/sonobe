# Importing designs

Any level · Back to [the learning path](README.md)

## What you'll be able to do

- Bring a screen from your running app onto the canvas as real layers, in one step.
- Import a design that only exists as code, by pasting HTML or asking Claude to rebuild it.
- Turn an imported screen into a prototype with the patches you already know.
- Know what comes across faithfully, and what to touch up by hand.

## The idea

Drawing a screen you've already built is slow, and it never quite matches. Sonobe skips that. It opens the page in a hidden browser window, reads the finished layout (every box, color, border, shadow, line of text, image and icon), and adds it to your prototype as ordinary layers.

```
 your app on its dev server ──┐
 HTML you paste ──────────────┼──▶ hidden browser window ──▶ reads the layout ──▶ layers you can wire
 Claude, from your code ──────┘                                                   images as assets
                                                                                   Scroll patches for long pages
```

Nothing is a screenshot. The Follow button becomes a group with a fill, a corner radius and a text layer, so you can tap it, scale it and recolor it like anything you drew yourself.

## Import from your running app

This needs the desktop app. A browser tab isn't allowed to read another site's layout.

1. Start your app's dev server (`npm run dev`, or your project's own command) and find the screen you want.
2. In Sonobe, choose **File → Import Design…**, or search "Import Design" in the command palette (⌘K).
3. On **From URL**, enter the page address, like `http://localhost:3000/settings`.
4. Click **Import**.

The screen lands on top of your prototype, selected, and named after the page title. It's sized to your device (the size shows in the dialog), so switch devices first if you want a tablet or desktop layout. The confirmation shows the first notes about what the import changed or left out; when there are more, click **N more notes** to list them all.

While the page loads, the dialog shows each step, like "Downloading images: 7 of 28". To stop, click **Cancel**. Nothing is added, and the dialog stays open so you can change the address or the options. An import that takes more than about 90 seconds stops by itself and says which step was slow.

**More options** covers the rest:

| Option | Use it when |
|---|---|
| Only this element | You want one piece, like a card or a sheet: `#pricing-card`, `[data-testid=checkout]` |
| Wait for | The screen loads data after the page: wait until `[data-loaded]` or a list item exists |
| Import the whole page | On (the default): a page taller than the screen scrolls in the viewer. Off: only the first screenful |
| Make long pages and scroll areas scroll | On (the default): Sonobe adds Scroll patches for you |
| Dark appearance | Your app follows `prefers-color-scheme` and you want its dark mode |

Storybook works well for single components: import a story's iframe address, like `http://localhost:6006/iframe.html?id=button--primary`.

## Paste HTML

When the design is a web page you have as a file, or a snippet with its CSS, choose **Paste HTML** instead. Paste a complete page, including its `<style>`, and click **Import**. This works in the browser version of Sonobe too.

To give layers names you'll recognize, add `data-name` to the elements you care about:

```html
<button data-name="Like Button" class="like">♥ Like</button>
```

For an app that uses SF Symbols, put a placeholder where each symbol goes instead of drawing it:

```html
<svg data-sf-symbol="heart.fill" style="font-size: 22px; font-weight: 600; color: #FF3B30"></svg>
```

CSS styles it the way SwiftUI's `.font` and `.foregroundStyle` do: `font-size` is the point size, `font-weight` the weight and `color` the color. `data-sf-palette="#0A84FF,#34C759"` sets palette colors, and `data-sf-scale="large"` the image scale. On a Mac with macOS 13 or later, Sonobe draws the real symbol and names its layer after it, like heart.fill. Elsewhere, and for a name your Mac doesn't have, the import leaves a gray square of the same size and says why (with close names it knows). Symbols are drawn on your Mac when you import, so they come from your copy of macOS, and the import notes Apple's rules for the few symbols that may only refer to Apple's own features.

## Copy from Chrome

The Sonobe Capture extension for Chrome copies the page you're looking at, or one element you pick, straight from the tab. It works on pages Sonobe can't open by address: signed-in dashboards, staging sites behind a VPN, any site you visit. Build and install it from [integrations/chrome-extension](../../integrations/chrome-extension/README.md), then:

1. Open the page. For a phone layout, turn on device mode in Chrome's developer tools and pick a device.
2. Click the Sonobe Capture button, then **Copy page**, or **Pick an element…** and click what you want (↑ selects the parent).
3. Press ⌘V in Sonobe.

## Copy from Figma

The Sonobe Capture plugin for Figma copies the selected frame or layers the same way. Build and install it from [integrations/figma-plugin](../../integrations/figma-plugin/README.md), select a frame, run the plugin, and press ⌘V in Sonobe. Frames keep their fills, gradients, strokes, radii, shadows and layer names; vectors come in as SVG. It hasn't been verified inside Figma yet, so expect rough edges.

## Import with Claude

Your app might not be a web app at all: SwiftUI, React Native, Flutter, or a screen that needs a backend you can't run. Claude can read the screen's code, rebuild it as a faithful HTML page, and import it. It can also design a new screen from a description.

Connect Claude first ([guide 11](11-working-with-claude.md)), open Claude Code in your app's folder, and ask:

- "Import the settings screen from my app into Sonobe. The dev server runs on localhost:3000."
- "Rebuild ProfileView from my SwiftUI code as HTML, import it into Sonobe, then make the Follow button bounce when I tap it."
- "Design a music player screen, import it into Sonobe, and make the play button morph into pause with a spring."

Claude uses the `import_design` tool, checks the result against the original with a screenshot, and then wires the interaction onto the imported layers. One undo removes the import. For a SwiftUI or UIKit screen, Claude writes SF Symbol placeholders, so on a Mac the imported icons are the real symbols.

## Design on the canvas

In the desktop app, the Assistant can design a screen right where you noticed it's missing. It uses your own Anthropic API key ([guide 11](11-working-with-claude.md)).

1. Click the sparkle in the canvas header (**Design with Claude**), or choose **Redesign with Claude…** on a layer in the Layers panel.
2. Describe the screen, like "a checkout with Apple Pay and a promo code", and press Return. With a layer selected, describe what should change instead.
3. Watch Claude write it: the canvas makes room, with the patch editor kept as a strip below, and the page draws over the artboard as the HTML arrives, large enough to read. When it's done, the preview turns into real layers, named from the page, in one undo step, and the new screen is selected.
4. Keep going in the same box: "make the header bigger", "try a darker version", or "make the Pay button bounce". **Make it interactive** and **Add knobs** under the result ask Claude to wire its buttons, or to turn its colors, corner radius and spacing into knobs you can tune ([guide 13](13-knobs-and-presets.md)).

- **It matches what's there.** Claude gets the colors, fonts, sizes and corner radii your screens already use. Choose **Match my code…** and pick your app's folder, and it can read your theme and token files too. It reads only text files there, skips hidden files, `.env` files and keys, and can't change anything. What it reads goes to Anthropic's API.
- **Where it lands.** A new screen goes in front, at the top left of the artboard, so it covers the screen behind it in the viewer too. **Send to Back** moves it behind.
- **Replacing asks first.** When Claude wants to replace a screen you didn't pick, or one you changed since Claude made it, Sonobe asks you and names the layers that would go. **Undo** in the box, or ⌘Z, steps back.
- **No API key?** On a Mac, **Open in Claude Code** opens Terminal in your app's folder and starts your own Claude Code with your request and your screens' styles, signed in with your Claude plan. You drive that session, and it draws the screen on this canvas as it writes. The first time, pick your app's folder: it's the one **Match my code…** links. **Copy for Claude Code** copies the same request instead. In the browser editor, copy the prompt for Claude, then paste the HTML it writes into File → Import Design.
- **Claude Code and Claude Desktop draw here too.** When a connected session designs a screen, you watch the page take shape over the artboard as it writes, one part at a time (`preview_design`), and it becomes real layers in one undo step when Claude imports it.

## What you get

| On the page | In Sonobe |
|---|---|
| A box with a background, border, radius or shadow | Group (or Rectangle when it holds nothing) |
| A border on one side, like a divider | A thin rectangle |
| Text | Text layers with the page's font, size, weight, color, line height and letter spacing |
| Web fonts (`@font-face`) | Font assets saved with your project, so text draws in the same typeface |
| `<img>`, CSS background images, `<canvas>` | Image layers, with the files saved in your project |
| Inline `<svg>` icons | Image layers holding the SVG, colors included |
| `<svg data-sf-symbol="heart.fill">` | The real SF Symbol as an image layer (Sonobe on a Mac), or a gray placeholder elsewhere |
| `<input>`, `<textarea>` | Text Field layers you can type into in the viewer |
| `position: fixed` bars | Layers that stay put while the page scrolls |
| A page taller than the screen, or an `overflow: auto` area | A Content layer driven by a Scroll patch |

Layers take their names from `data-name`, then the component that rendered them (React and Vue development builds), `aria-label`, ids, icon names and the kind of element ("Button", "Navigation"). Wrappers that draw nothing disappear, so the layer list stays short.

Text works the same way when the element holding it draws nothing: `<div data-name="Card 1 Address">933 Kapahulu Ave</div>` becomes a text layer called Card 1 Address, and so does a named `<span>` inside a sentence. `data-name`, `aria-label` and ids beat the text's own words; a component name or the kind of element doesn't, because every card shares it, so that text is named by its words. A box with a background keeps the name for itself, and `<body data-name>` names the screen.

## Make it interactive

An imported screen is just layers, so everything in [02 ISAT](02-isat.md) applies.

1. Select the imported Follow Button in the layer list.
2. Press its **Touch** button to add an Interaction patch for it.
3. Add a Switch, a Pop Animation and a Transition, and connect the Transition to the button's Scale, like the like button in guide 02.
4. Tap the button in the viewer.

When the design changes in code, import it again and pick **Replace** for the earlier screen. Your interactions stay wired to the layers it finds again, and the import names any connection it had to drop because its layer is gone, and any layer of the old screen it didn't find again.

Long pages already scroll: drag the page in the viewer. The Scroll patch Sonobe added is named after the layer it moves ("Scroll Content"), and its Y output is handy for headers that shrink or fade as you scroll ([06 Gestures](06-gestures.md)).

## Try it

1. Import a screen from an app you work on. Compare the viewer with your browser side by side, and note the differences.
2. Import only one card with **Only this element**, then make it grow when tapped.
3. Import a long page and make its header's shadow appear once the page scrolls, using the Scroll patch's Y output.
4. Ask Claude to import a screen from code that isn't a web app, and to explain which layers it named for wiring.

## Common mistakes

- **The dev server isn't running.** Sonobe says nothing answered at that address. Start the server, open the page in a browser once, then import again.
- **Importing before choosing the device.** The page is laid out for the current device's width. Switch devices first, then import.
- **Expecting hidden states.** Elements that are hidden (`display: none`, `opacity: 0`) aren't imported. Open the state you want in the app first, or import the other state separately and hide it with a patch.
- **Editing mixed text.** A text layer has one style, so a paragraph with a bold phrase or a link comes in as a group of text layers, one per styled run on each line. It looks right, but changing its words means editing several layers. Retype it as one text layer if the copy will change.
- **Fonts that can't be downloaded.** Sonobe saves the web fonts a page uses with your project, so text looks the same. When a font file can't be downloaded (some font services refuse other apps), the import says so and that text uses a font installed on your computer.
- **Importing again on top.** A fresh import adds a new screen. When your code changed, choose **Replace “Profile”** under **Add to the prototype** instead: the new version takes the old screen's place, and layers it finds again (same names in the same places) keep their ids, so the patches you wired still work.
- **CSS animations.** Transitions and keyframes aren't imported. Build motion with patches, where you can tune it.
