<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Mouse

Reports the mouse pointer's position, which buttons are held, and how fast the scroll wheel or trackpad is scrolling.

| | |
|---|---|
| Type key | `mouse` |
| Category | [Interaction](README.md#interaction) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | cursor position, mouse position, right click, middle click, mouse wheel, scroll wheel, trackpad scroll, pointer |

## How it works
Mouse listens to the mouse across the whole prototype, not a particular layer.

- **Position** is where the pointer is, in points from the prototype's top-left, even while no button is pressed.
- **Left**, **Right**, and **Middle** are true while that button is held.
- **Scroll Velocity** is how fast the wheel or trackpad is scrolling, in points per second. **Scroll Delta** is how far it scrolled this frame. Both are positive when scrolling toward the bottom or right of a page.

On phones and tablets a finger acts like the left button, and there's no wheel.

## Tips
- For clicks or hovering on one layer, use Interaction or Hover instead.
- To move content with the wheel, subtract Scroll Delta from its position each frame, or use Scroll, which already handles the wheel.
- Smooth Value makes a custom cursor trail the pointer gently.

## Coming from Origami
Origami's older docs list Down and Location; current files use Left, Right, Middle, Position, and Scroll Velocity, which Sonobe matches. Position starts at the top-left with y down instead of the viewer center, and Scroll Velocity is per second instead of per frame. Scroll Delta is new.

## Inputs

This patch has no fixed inputs.

## Outputs

| Output | Type | Description |
|---|---|---|
| **Position**<br>`position` | `point` (distance) | Where the mouse pointer is, in points from the prototype's top-left; keeps its last value when the pointer leaves. |
| **Left**<br>`left` | `boolean` | True while the left mouse button (or a finger) is pressed. |
| **Right**<br>`right` | `boolean` | True while the right mouse button is pressed. |
| **Middle**<br>`middle` | `boolean` | True while the middle mouse button (the wheel) is pressed. |
| **Scroll Velocity**<br>`scrollVelocity` | `point` (velocity) | How fast the wheel or trackpad is scrolling, in points per second; positive toward the bottom and right. |
| **Scroll Delta**<br>`scrollDelta` | `point` (distance) | How far the wheel or trackpad scrolled this frame, in points; [0, 0] when it isn't scrolling. |

## Examples

### A custom cursor that follows the mouse

```text
layer cursor oval "Cursor" 24x24 anchor=[0.5,0.5] position←pointer.position
patch pointer mouse
```

### Right-click to open a menu

Right turns the menu on and a left click closes it; Turn Off wins when both happen in one frame.

```text
layer menu rectangle "Menu" @120,200 180x220 enabled←menu_open.on
patch pointer mouse
patch menu_open switch turnOn←pointer.right turnOff←pointer.left
```

## Common mistakes

- Clicks register anywhere on the screen: Mouse is global. Use Interaction with a layer for clicks on one element.
- A wheel-driven layer moves the wrong way: Scroll Delta is positive when scrolling down a page. Subtract it from the layer's position instead of adding it.
- Right never turns on in the browser: the browser's context menu takes the click. Test in the desktop app, or check that nothing else handles right clicks on the page.

## Pairs well with

- [Hover](hover.md): Reports whether the mouse pointer is over a layer and where it is, for hover highlights and tooltips on desktop.
- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.
- [Switch](switch.md): Remembers whether something is on or off and changes when it gets a pulse.
- [Smooth Value](smoothValue.md): Smooths a changing number over time, so noisy or jumpy values glide toward their latest value.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Mouse (`builtin.mouse`)
