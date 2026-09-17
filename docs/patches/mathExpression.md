<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Math Expression

Calculates numbers from a formula you type, creating an input for each variable and an output for each result.

| | |
|---|---|
| Type key | `mathExpression` |
| Category | [Math](README.md#math) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | expression, formula, equation, calculate, calculator, custom math, js math, evaluate, compute |

## How it works
Type a formula into the patch's **Expression** setting and the patch does the math every frame. Each variable you use becomes a number input, so `(a + b) / 2` gives you inputs **a** and **b** and one output.

- **Several results:** separate formulas with `;` and name a result with `name =`, like `area = w * h; perimeter = 2 * (w + h)`. Unnamed results are called Output, Output 2, and so on.
- **Reuse a result:** a later formula can use an earlier named result: `d = sqrt(dx * dx + dy * dy); nx = dx / d`.
- **Operators:** `+ - * / % **`, parentheses, comparisons like `<` and `==` (which give 1 or 0), `&&`, `||`, `!`, and `condition ? a : b`.
- **Functions:** `sqrt`, `abs`, `min`, `max`, `round`, `floor`, `sin`, `atan2`, and the rest of JavaScript's `Math` library, with or without `Math.`, plus `PI`, `clamp(value, min, max)`, `lerp(start, end, progress)`, `radians(degrees)`, and `degrees(radians)`.

If the formula has a mistake, the editor points to it and keeps the last formula that worked.

## Tips
- Formulas have no memory. For running totals, use Counter or Delay One Frame.

## Coming from Origami
Functions also work without `Math.`, `^` is rejected with a hint to use `**`, and `Math.random()` isn't available: wire in a Random patch so restarts are reproducible. A result that isn't a real number outputs 0.

## Inputs

This patch adds ports based on how it's set up, so these tables list only the ports it always has.

This patch has no fixed inputs.

## Outputs

This patch has no fixed outputs.

## Settings

Settings configure the patch itself instead of flowing through cables.

| Setting | Type | Default | Description |
|---|---|---|---|
| **Expression**<br>`expression` | `text` | `""` | The formula. Each variable becomes an input, `;` separates results, and `name =` names a result. |

## Examples

### Drive two properties from one spring

One formula turns the spring's 0 to 1 into a smaller scale and a lower opacity, replacing two Transition patches.

```text
layer card rectangle "Card" @16,120 358x220 cornerRadius=24 scale←look.scale opacity←look.opacity
patch tap_card interaction layer=@card
patch toggle switch flip←tap_card.tap
patch pop popAnimation number←toggle.on
patch look mathExpression expression="scale = 1 - 0.1 * p; opacity = 1 - 0.6 * p" p←pop.output
```

### Make a button breathe

Time feeds a sine wave, so the button's scale drifts between 0.95 and 1.05 once every 2 seconds.

```text
layer button rectangle "Button" @127,400 148x56 cornerRadius=28 scale←breathe.scale
patch clock time
patch breathe mathExpression expression="scale = 1 + 0.05 * sin(t * PI)" t←clock.time
```

## Common mistakes

- Motion is tiny or jittery: `sin`, `cos`, and `tan` in a formula take radians, but angles elsewhere in Sonobe are degrees. Write `sin(radians(angle))`, or use the Sine and Cosine patches.
- A result reads 0 when you expected a number: it wasn't finite, often because an input used as a divisor is 0. Guard it with `b == 0 ? 0 : a / b` or `max(b, 0.001)`.
- A cable disappeared after you edited the formula: renaming a variable removes its old input and adds a new one. Reconnect the cable to the renamed input.

## Pairs well with

- [Time](time.md): Counts the seconds and frames since the prototype started.
- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.
- [Loop](loop.md): Makes a loop of indices from 0 up to Count minus 1, so layers and patches repeat once per index.
- [Round](round.md): Rounds a number to the nearest whole number or decimal place, and also outputs it rounded down and rounded up.
- [JavaScript](javascript.md): Runs a JavaScript file whose code declares its own inputs and outputs, for logic other patches can't express.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Math Expression (`builtin.javascript.expression`)
