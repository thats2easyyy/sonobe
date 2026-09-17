<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# JavaScript

Runs a JavaScript file whose code declares its own inputs and outputs, for logic other patches can't express.

| | |
|---|---|
| Type key | `javascript` |
| Category | [Scripting](README.md#scripting) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | javascript patch, js patch, js, script, code, custom patch, custom logic, function, program |

## How it works
A JavaScript patch runs a script from your project's `scripts` folder. The script lists its inputs and outputs, and they appear as ports you wire like any other patch.

```js
export const inputs = [
  { key: "count", name: "Count", type: "number", default: 0 },
];
export const outputs = [
  { key: "label", name: "Label", type: "text" },
];
export function evaluate(patch) {
  const n = patch.input("count");
  patch.output("label", n === 1 ? "1 item" : `${n} items`);
}
```

- **Ports** take the same fields as built-in ports: `key`, `name`, `type`, and optionally `default`, `min`, `max`, `enumOptions`, and `description`. Write both lists as plain values at the top of the file.
- **evaluate** runs on the first frame, then whenever an input changes or a pulse arrives. Outputs keep their last value until you set them again.
- **Memory:** variables outside `evaluate` keep their values between runs. In a loop, each item gets its own copy of the script.
- **Pulses:** check for one with `patch.pulsed("reload")` and send one with `patch.pulse("done")`.
- **Extras:** `fetch`, `setTimeout`, `setInterval`, and `console.log` work. Timers and `Math.random` follow the prototype's clock and seed, so simulations replay the same way.

## Tips
- Ask Claude to write or fix a script: describe the ports and what should happen.
- Mark a port `wholeLoop: true` to read a whole loop with `patch.inputItems(key)`, or to output an array as a loop.
- Scripts can't reach layers directly. Wire their outputs into layer properties.

## Coming from Origami
Scripts export `inputs`, `outputs`, and `evaluate` instead of returning a `Patch` object. Cables follow each port's `key`, so reordering ports keeps them connected. Scripts built with `new Patch()` still run, except for reading image pixels. Types use Sonobe names (`text`, `point`, `color`), colors are `{ r, g, b, a }`, and points are arrays.

## Inputs

This patch adds ports based on how it's set up, so these tables list only the ports it always has.

This patch has no fixed inputs.

## Outputs

This patch has no fixed outputs.

## Settings

Settings configure the patch itself instead of flowing through cables.

| Setting | Type | Default | Description |
|---|---|---|---|
| **Script**<br>`script` | `text` | `""` | The script file in the project's scripts folder, like "email_check.js". Empty means there's no script yet, so the patch has no ports. |

## Examples

### Tap to load a new quote

quotes.js declares a load pulse input plus quote (text) and loading (boolean) outputs. When patch.pulsed("load") is true, it sets loading, fetches JSON from a quotes service, writes the quote, and clears loading. The Transition dims the text while a request is out.

```text
layer quote text "Quote" @24,200 354x240 text←quotes.quote opacity←dim.output
layer load_button rectangle "Load Button" @24,720 354x56 cornerRadius=28 color=#5B5FEFFF
patch tap_load interaction layer=@load_button
patch quotes javascript script="quotes.js" load←tap_load.tap
patch dim transition<number> progress←quotes.loading start=1 end=0.4
```

### Draw a trail behind your finger

trail.js declares position (point) and down (boolean) inputs and a shape output. A top-level array keeps the last 40 positions while down is true, and evaluate turns them into an SVG path such as M 120 300 L 124 306.

```text
layer trail shape "Trail" @0,0 402x874 shape←trail_path.shape color=#00000000 strokeColor=#5B5FEFFF strokeWidth=6
layer touch_area hitArea "Touch Area" @0,0 402x874
patch touch interaction layer=@touch_area
patch trail_path javascript script="trail.js" position←touch.position down←touch.down
```

## Common mistakes

- The patch has no ports and warns that it couldn't work out its ports: the inputs or outputs list uses a variable or a function call, or sits below other code. Put export const inputs = [...] and export const outputs = [...] at the top of the file, written as plain values.
- An output updates once and then freezes even though the script tracks time: evaluate runs only when an input changes or a pulse arrives. Call patch.requestNextFrame() while something is moving, or add export const alwaysEvaluate = true.
- Cables disappear after you edit the script: you changed a port's key, and cables follow keys. Change the port's name instead to relabel it and keep its connections.
- A loop of 50 items makes 50 network requests: in a loop, the script runs once per item. Mark the port wholeLoop: true to receive the whole loop at once and make one request.

## Pairs well with

- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.
- [Watch](watch.md): Shows a value right on the patch and logs its changes to the console, so you can see what a cable carries.
- [Math Expression](mathExpression.md): Calculates numbers from a formula you type, creating an input for each variable and an output for each result.
- [Network Request](networkRequest.md): Loads JSON, text, images, video, or sound from a URL when it gets a pulse, and reports loading and errors.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** JavaScript Patch (`builtin.javascript`)
