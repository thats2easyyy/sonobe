<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Haptic

Plays a short tactile tap or pattern, like a light impact or a success buzz, each time it gets a pulse.

| | |
|---|---|
| Type key | `haptic` |
| Category | [Device](README.md#device) |
| Tier | 3 (hardware and platform-specific) |
| Status | Web-limited |
| Search terms | haptics, haptic feedback, taptic, impact, tick, ahap, haptic player, trackpad haptic, haptic ios |

## How it works
Haptic makes the device tap or buzz so an interaction feels physical. Each pulse (a signal that's on for one frame) into **Play** plays the feedback chosen in **Type** once.

- **Selection** and the three **Impact** types are single taps from faint to strong.
- The **Notification** types are short patterns for success, warning, and error.
- **Vibrate** is a plain buzz.
- **Alignment** and **Level Change** are for Force Touch trackpads.
- **Custom Pattern** plays a Core Haptics pattern (AHAP JSON) from **Pattern**.

**Available** is true when the device can play the selected type. On an Android phone, Preview on Phone plays each type as a matching vibration. On an iPhone, open the preview in the Sonobe Viewer app to feel real haptics; Safari can't play them. Computers can't play haptics.

## Tips
- Match the strength to the moment: Selection for scrolling through options, Impact Light for taps, Notification Success when something finishes.
- Pair Pulse on Change with a scroll page or snap index to tick once per step.
- Haptics are extras. Always show visual feedback too.

## Coming from Origami
Haptic, Haptic Player, and Trackpad Haptic are one patch here, with the trackpad types in Type. The AHAP input is called Pattern.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Play**<br>`play` | `pulse` | — | Pulse to play the selected feedback once. |
| **Type**<br>`type` | `enum` | `impactLight` | Which feedback to play, from a faint Selection tick to an Error pattern; trackpad types only work on Force Touch trackpads. |
| **Pattern**<br>`pattern` | `json` | none | A Core Haptics pattern (AHAP JSON) that plays when Type is Custom Pattern; ignored for other types. |

**Type options**

- **Vibrate** (`vibrate`): A plain buzz of about 0.4 s.
- **Selection** (`selection`): A faint tick for moving between choices, like a picker or slider detent.
- **Impact Light** (`impactLight`): A light tap for small buttons and toggles.
- **Impact Medium** (`impactMedium`): A firmer tap for larger controls and cards snapping into place.
- **Impact Heavy** (`impactHeavy`): A strong thud for big moments, like dropping a dragged item.
- **Notification Success** (`notificationSuccess`): Two quick taps for a completed action.
- **Notification Warning** (`notificationWarning`): Two firmer taps for something that needs attention.
- **Notification Error** (`notificationError`): Three rapid taps for a failed action.
- **Alignment (Trackpad)** (`alignment`): A crisp click on a Force Touch trackpad when something snaps into alignment.
- **Level Change (Trackpad)** (`levelChange`): A click on a Force Touch trackpad when pressure crosses a level.
- **Custom Pattern** (`customPattern`): Plays the Core Haptics pattern (AHAP JSON) on Pattern.

## Outputs

| Output | Type | Description |
|---|---|---|
| **Available**<br>`available` | `boolean` | True when this device can play the selected Type. |

## Examples

### Tap a like button with a light haptic

```text
layer like_button oval "Like Button" @171,700 60x60
patch tap_like interaction layer=@like_button
patch like_feedback haptic play←tap_like.tap type=impactLight
```

### Tick each time a carousel snaps to a page

```text
layer carousel group "Carousel" @0,200 402x300 clip=true
  layer cards group "Cards" 1206x300 position←pager.position
patch pager scroll layer=@cards scrollX=paging scrollY=off
patch page_changed pulseOnChange<index> value←pager.pageX
patch tick haptic play←page_changed.changed type=selection
```

## Common mistakes

- Nothing happens on an iPhone or a laptop: browsers there can't play haptics. On an iPhone, open the preview in the Sonobe Viewer app; an Android phone vibrates in the browser. Always give visual feedback too.
- Alignment and Level Change never do anything: they're for Force Touch trackpads, which a browser can't reach. On phones, use Selection or Impact Light.
- Custom Pattern is silent: Pattern is empty or isn't AHAP JSON with a Pattern list. Load the .ahap file with a JSON File patch and wire it into Pattern.

## Pairs well with

- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.
- [Pulse on Change](pulseOnChange.md): Sends a pulse whenever a watched value changes, such as a new page number or a different tab.
- [Snap](snap.md): Moves a value to the nearest step or point, and can use flick velocity to predict where it lands, for grids and carousels.
- [Vibrate](vibrate.md): Buzzes the phone's vibration motor for a moment each time it gets a pulse.
- [JSON File](jsonFile.md): Loads a JSON file from your project, such as a product list or mock feed, so prototypes work without a server.

## Availability

**Web-limited.** Browsers have no haptics API. Android plays each type as a short Vibration API pattern, and the Sonobe Viewer iPhone app plays real iPhone haptics; iOS Safari, computers, and the trackpad types do nothing.

Works in the web player on phones and tablets.

Tier 3: hardware and platform-specific.

## Origami mapping

- **Origami patch:** Haptic (`origami.haptic.ios`)
- **Also imports:** `origami.HapticiOS`, `builtin.hapticPlayer`, `origami.haptic.macos`

| Sonobe port | Origami label |
|---|---|
| `pattern` | AHAP |
