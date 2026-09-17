# Tab Bar

Four tabs: Home, Explore, Saved and Profile. Tap one and the screens slide over, a soft indicator pill springs under the tab, and that tab's icon and label turn indigo while the others go gray. It's ISAT with more than two states.

Level 1 · Guides: [02 ISAT](../../docs/guides/02-isat.md), [03 States and pulses](../../docs/guides/03-states-and-pulses.md)

## What you'll learn

- Option Switch: memory for more than two states.
- Option Picker: turning an option number into real units, then animating those.
- Driving several things from one option: screens, indicator, and four tints.
- Why the screen spring has no bounce and the indicator's does.

## Build it step by step

1. **Screens side by side.** Add a Group named Screens (`screens`), 1608 × 874 with Layout set to Row, holding four 402 × 874 screen groups. Only the first is on screen.
2. **The bar.** Add a Tab Bar group (`tab_bar`) at y 784 with a translucent white fill and Background Blur 20. Inside it go an Indicator pill (`indicator`, 56 × 36, pale indigo) and four tab groups, each 100.5 wide: `tab_home`, `tab_explore`, `tab_saved` and `tab_profile`, each holding an icon made of simple shapes and a label.
3. **Listen.** Add four Interactions, one per tab: `tap_home`, `tap_explore`, `tap_saved` and `tap_profile`.
4. **Remember which tab.** Add an Option Switch (`current_tab`) with 4 inputs. Connect each tab's Tap to Set to 0, Set to 1, Set to 2 and Set to 3.
5. **Slide the screens.** Add an Option Picker (`screen_offset`, number, 4 options: 0, −402, −804, −1206) with Option from `current_tab.option`. Feed it into a Pop Animation (`screen_spring`, Bounciness 0, Speed 16) and a Point (`screens_position`, y 0) into the Screens' Position.
6. **Move the indicator.** Add another Option Picker (`indicator_offset`) with each tab's pill x: 22.25, 122.75, 223.25 and 323.75. Feed it into a Pop Animation (`indicator_spring`, Bounciness 5, Speed 14) and a Point (`indicator_position`, y 6) into the Indicator's Position.
7. **Tint each tab.** For Home, add Equals (`home_selected`) comparing `current_tab.option` with 0, a Pop Animation (`home_tint_spring`), and a color Transition (`home_tint`) from gray to indigo into Home's icon parts and label (`home_label`). Repeat for the other tabs with 1, 2 and 3.

## The patch chain

```text
Tap Home ────▶ Set to 0 ┐
Tap Explore ─▶ Set to 1 ├─ Current Tab ──option──┬─▶ Screen Offset (0, −402, −804, −1206) ─▶ Screen Spring ─▶ Screens Position ─▶ Screens
Tap Saved ───▶ Set to 2 │   (Option Switch)      ├─▶ Indicator X (22, 123, 223, 324)       ─▶ Indicator Spring ─▶ Indicator Position ─▶ Indicator
Tap Profile ─▶ Set to 3 ┘                        └─▶ Home Selected (= 0) ─▶ Home Tint Spring ─▶ Home Tint ─▶ Home icon · Home label
                                                     … one tint chain per tab
```

| Patch | Type | Its one job |
|---|---|---|
| `tap_home` … `tap_profile` | Interaction | One pulse per tab. |
| `current_tab` | Option Switch | Remembers which Set to input pulsed last: 0, 1, 2 or 3. |
| `screen_offset` | Option Picker | Turns the tab number into the Screens' x. |
| `screen_spring` | Pop Animation | Slides the screens with no bounce, so the edge of the next screen never flashes into view. |
| `screens_position` | Point | Packs the x into a position. |
| `indicator_offset`, `indicator_spring`, `indicator_position` | Option Picker, Pop Animation, Point | Same idea for the pill, with a little bounce because it's small and playful. |
| `home_selected`, `home_tint_spring`, `home_tint` | Equals, Pop Animation, Transition | Per tab: am I current? If so, fade to indigo. |

Compare this with the tap-to-grow card. There, Switch → Pop Animation → Transition. Here, Option Switch → Option Picker → Pop Animation. When states are numbered, pick the units first and animate them directly.

## Check it

`test.json` taps Saved and checks the screens settle at −804 without overshooting, the indicator lands at 223.25, Saved's label is indigo and Home's is gray. It also taps Profile, then Home, and checks everything returns.

```sh
npx vitest run examples/run.test.ts -t 05-tab-bar
```

## Variations

- **Crossfade instead of slide.** Keep the screens stacked, and give each an opacity from its tab's Equals through a Classic Animation (0.2 s).
- **Remember scroll per tab.** Each screen can have its own Scroll patch. Because the screens stay alive side by side, they keep their scroll position when you come back.
- **Five tabs.** Set `current_tab` and both Option Pickers to 5 inputs, and make each tab 80.4 wide.
- **A badge.** Add a small red Oval on Saved, and give its scale a Transition from `saved_tint_spring.output` (1 → 0), so it hides while you're on that tab.

## Common mistakes

- **A regular Switch.** A Switch only has two states. With four tabs you need an Option Switch.
- **Option counts that don't match.** Four Set to inputs with three Option Picker values leaves the last tab with nothing to show.
- **Feeding the tab number straight into a Transition.** A Transition expects 0…1, so tab 3 would extrapolate far past End.
- **Tab icons that catch touches.** The icon shapes and labels have Receives Touches off, and touches on them bubble up to the tab group anyway. Listen on the whole tab group, not the icon.
