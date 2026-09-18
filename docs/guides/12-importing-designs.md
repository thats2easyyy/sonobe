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

The screen lands on top of your prototype, selected, and named after the page title. It's sized to your device (the size shows in the dialog), so switch devices first if you want a tablet or desktop layout.

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

Claude uses the `import_design` tool, checks the result against the original with a screenshot, and then wires the interaction onto the imported layers. One undo removes the import.

## What you get

| On the page | In Sonobe |
|---|---|
| A box with a background, border, radius or shadow | Group (or Rectangle when it holds nothing) |
| A border on one side, like a divider | A thin rectangle |
| Text | Text layers with the page's font, size, weight, color, line height and letter spacing |
| Web fonts (`@font-face`) | Font assets saved with your project, so text draws in the same typeface |
| `<img>`, CSS background images, `<canvas>` | Image layers, with the files saved in your project |
| Inline `<svg>` icons | Image layers holding the SVG, colors included |
| `<input>`, `<textarea>` | Text Field layers you can type into in the viewer |
| `position: fixed` bars | Layers that stay put while the page scrolls |
| A page taller than the screen, or an `overflow: auto` area | A Content layer driven by a Scroll patch |

Layers take their names from `data-name`, then the component that rendered them (React and Vue development builds), `aria-label`, ids, icon names and the kind of element ("Button", "Navigation"). Wrappers that draw nothing disappear, so the layer list stays short.

## Make it interactive

An imported screen is just layers, so everything in [02 ISAT](02-isat.md) applies.

1. Select the imported Follow Button in the layer list.
2. Press its **Touch** button to add an Interaction patch for it.
3. Add a Switch, a Pop Animation and a Transition, and connect the Transition to the button's Scale, like the like button in guide 02.
4. Tap the button in the viewer.

When the design changes in code, import it again and pick **Replace** for the earlier screen. Your interactions stay wired to the layers it finds again.

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
