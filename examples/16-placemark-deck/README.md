# Placemark Deck

Places to vote on, from a real session: a designer and Claude rebuilt the swipe deck of Placemark's Discover screen to tune its feel before writing any SwiftUI. Drag the top card and throw it, or tap ✕ and ♥. The card follows your finger and tilts, a heart or ✕ fades in and pops once letting go would vote, and the next card rises as you drag. Find more places brings the deck back. Every number that sets the feel is a knob, and a locked **Shipped app** preset holds what the app does today, so ⌘' flips between the proposal and the reference in the middle of a swipe.

Level 4 · Guides: [07 Loops](../../docs/guides/07-loops.md), [12 Importing designs](../../docs/guides/12-importing-designs.md), [13 Knobs and presets](../../docs/guides/13-knobs-and-presets.md)

## What you'll learn

- Starting from an imported design: the screen comes from HTML with `data-name` on its elements, so layers get ids like `@place_name` instead of ids made from their text.
- Turning a static stack of four cards into one card repeated once per place, with each field a Loop Builder row.
- Stacking copies so row 0 is on top, and letting each copy read the one above it with Loop Select and Delay One Frame.
- A lookahead throw with one Swipe, instead of patches that project the release.
- Packing one card's logic into a patch component that runs once per copy.
- Knobs and presets: a locked reference, a working proposal, and differences in kind as on/off knobs.

## Build it step by step

1. **Import the design.** `design/placemark-discover.html` is the Discover screen as HTML. Import it with Import Design, or ask Claude to import it. The deck holds four cards in a Cards group (`@cards`), with the top one, Card (`@card`), named as the template: Card Photos, Place Name (`@place_name`), Place Address (`@place_address`), Photo Credits (`@photo_credits`), and the Yes and Pass badges. The file stored here, `design/capture.json`, is that import's capture, so the example builds offline.
2. **Keep one card.** Delete Card 2, Card 3 and Card 4; they only carried their place's photos and text. Give Card a Column layout with a 1 pt padding for its border, so a two-line place name makes the photos shorter instead of pushing the text off the card. Card Photos grows to fill the rest, its photo grid sits behind the Photos label at 100 % × 100 %, and the badges are placed by Position so they stay out of the column. Turn off Receives Touches on Cards, so taps reach End of Deck once the cards are gone.
3. **One row per place.** Add six Loop Builders (`place_names`, `place_addresses`, `place_credits`, `big_photos`, `top_right_photos`, `bottom_right_photos`) with four rows each, top card first, and connect them to the card's text and photos. Connect `place_names.loop` to the Card's Repeat: Card now makes one copy per place, and everything inside follows.
4. **Row 0 on top.** Copies draw in index order, so the last is in front. Add a Multiply (`stack_order`) of the index × −1 into the Card's Z Position, and row 0 draws, and gets touches, in front. The copies' Z Positions only reorder inside Cards, which is why the cards have a group of their own.
5. **The finger.** Add a Gesture (`drag_card`) and a Swipe (`throw_card`) on Card. Throw Card judges the release: Min Distance from the Commit Distance knob, Lookahead from Throw Lookahead, and Min Velocity 10000 so it goes by the projection alone.
6. **One card's logic.** Add the Swipe Card patch component (`swipe_card`) and feed it the finger, both throws, the ✕ and ♥ taps and holds, and Find more places. Its outputs drive Card's Position, Rotation, Scale, Opacity and Receives Touches, and the badges' Opacity and Scale. Inside, in nine numbered frames: is this the top card, the button preview, the vote, where the card wants to be, one spring to get it there, tilt, badges, the next card's rise, and the shipped app's behavior.
7. **The card above.** Add a Subtract (`card_above`: index − 1) and three Loop Selects (`card_above_gone`, `card_above_lift`, `card_above_offset`) that read Swipe Card's Gone, Lift and Position at that index, each into a Delay One Frame. The top card has no card above, so Out of Range is Use Fallback: true for Gone, 1 for Lift, 0,0 for Offset.
8. **Buttons and the empty deck.** Interactions on ✕, ♥ and Find more places (`tap_pass`, `tap_yes`, `tap_find_more_places`) with press springs into their Scale. An All (`every_card_gone`) of Swipe Card's Gone dims the vote buttons to 40 % through `deck_empty_fade` and `vote_buttons_opacity`.
9. **Knobs.** Make the fifteen knobs below, add a Proposal and a Shipped app preset, fill in the shipped values, and lock Shipped app.

## The patch chain

```text
Place Names (loop ×4) ─loop───────▶ Card · Repeat
                      ─index × −1─▶ Stack Order ─▶ Card · Z Position
                      ─index − 1──▶ Card Above

Drag Card ─down · translation · velocity · local position─┐
Throw Card ─swiped left or right · projected──────────────┤
Tap Pass · Tap Yes ─down · tap────────────────────────────┼─▶ Swipe Card (×4) ─position · rotation · scale · shown · touchable─▶ Card
Tap Find More Places ─tap: reset──────────────────────────┤                   ─badge opacity · badge scale─▶ Card Yes Badge · Card Pass Badge
Card Above: Gone · Lift · Offset ─▶ … Last Frame ─────────┘                   ─gone · lift · position─┐
         ▲                                                                                              │
         └─ Loop Select at Card Above, Use Fallback ◀───────────────────────────────────────────────────┘

Swipe Card · gone ─▶ Every Card Gone ─▶ Deck Empty Fade ─▶ Vote Buttons Opacity (1 → 0.4) ─▶ Vote Buttons · Opacity
```

| Patch | Type | Its one job |
|---|---|---|
| `place_names`, `place_addresses`, `place_credits`, `big_photos`, `top_right_photos`, `bottom_right_photos` | Loop Builder | One row per place, top card first. Place Names also sets how many cards there are. |
| `stack_order` | Multiply | Index × −1 into Z Position, so row 0 draws in front. |
| `drag_card` | Gesture | The finger on each copy: down, offset, speed and where it grabbed. |
| `throw_card` | Swipe | Whether letting go throws the card, counting Throw Lookahead seconds of release speed; its Projected output arms the badge pop. |
| `swipe_card` | Component | One copy's logic: whether it's on top, the vote, the spring, tilt, badges and rise. |
| `card_above` | Subtract | Which copy is above this one. |
| `card_above_gone`, `card_above_lift`, `card_above_offset` | Loop Select | Read the card above; the top card gets the fallback. |
| `card_above_gone_last_frame`, `card_above_lift_last_frame`, `card_above_offset_last_frame` | Delay One Frame | Break the loop between copies: each reads the one above it as it was a frame ago, so one ✕ tap throws one card. |
| `tap_pass`, `tap_yes`, `tap_find_more_places` | Interaction | ✕, ♥ and Find more places. A pulse reaches every copy; only the top one acts. |
| `pass_press_spring`, `yes_press_spring`, `pass_button_scale`, `yes_button_scale` | Pop Animation, Pop Animation, Transition, Transition | ✕ and ♥ shrink to Button Press Scale while pressed. |
| `every_card_gone`, `deck_empty_fade`, `vote_buttons_opacity` | All, Pop Animation, Transition | Dim the vote buttons once the deck is empty. |
| `end_of_deck_shown` | Or | With Card Flies Out off, End of Deck waits until the deck is empty. |
| `scroll_categories` | Scroll | The category chips scroll sideways; the design import added it. |

## Knobs

Open the Knobs tab (⌘5) to tune them while the prototype runs. Proposal runs; Shipped app is locked and holds what the shipped app does. Nine of the fifteen differ.

| Knob | Proposal | Shipped app | What it changes |
|---|---|---|---|
| Vertical Follow | 0.3 | 0 | How much the card follows your finger up and down |
| Tilt per Point | 1/30° | 1/30° | Degrees of tilt per point dragged |
| Grab Tilt | on | off | Grabbing the lower half tilts the card the other way |
| Badge Fade Start | 25 pt | 25 pt | Where the heart or ✕ starts to fade in |
| Badge Fade End | 95 pt | 25 pt | Where it's fully shown; the same as the start pops it in |
| Commit Pop | 1.15× | 1× | How much the badge grows once letting go would vote |
| Commit Distance | 95 pt | 95 pt | How far the card must be headed to count as a vote |
| Throw Lookahead | 0.2 s | 0 s | Release speed that counts toward the distance; 0 judges by distance only |
| Spring Response | 0.3 s | 0.3 s | How long the card takes to spring home or fly off |
| Spring Damping | 0.75 | 0.75 | Below 1 it overshoots a little |
| Card Flies Out | on | off | Off: the card never leaves, and the next place springs back from your finger |
| Fly-Out Distance | 600 pt | 600 pt | How far a thrown card flies |
| Next Card Scale | 0.95× | 1× | The card underneath starts this small and grows as you drag |
| Button Nudge | 20 pt | 0 pt | Holding ✕ or ♥ nudges the top card that way |
| Button Press Scale | 0.92× | 1× | How small ✕ and ♥ get while pressed |

The shipped app's card never flies off: the next place loads into the same card while it springs back from your finger, with the old heart or ✕ still on it until it's within 25 pt of the center. That's a difference in kind, so it's an on/off knob. With Card Flies Out off, only the top card shows, the cards under it follow it one frame behind, and the next one takes over wherever the finger let go.

## Check it

`test.json` checks the deck at rest (Leonard's Bakery on top at full size, the others at 0.95 behind it), a slow drag right that throws the card to x 600 at a 20° tilt while Rainbow Drive-In rises, a slow 60 pt drag that springs back, and a quick 60 pt flick that throws under Proposal and springs back under Shipped app. A ✕ tap throws exactly one card left, holding ♥ nudges the card and shows the heart, four votes empty the deck and dim the buttons to 40 %, and Find more places brings every card back. Under Shipped app it checks that only the top card shows, that the next place springs back from where the finger let go, and that End of Deck waits for the empty deck.

```sh
npx vitest run examples/run.test.ts -t 16-placemark-deck
```

To look at one copy, use a `#n` target: `@card.position#1`, or `swipe_card.gone#0`. To compare presets without touching your viewer, ask Claude to simulate with the Shipped app preset: a simulation's preset never changes what your viewer runs.

## Variations

- **Tune it.** Open the Knobs tab and drag Throw Lookahead or Commit Distance while you throw cards. ⌘' flips to Shipped app and back.
- **Another place.** Add a row to every Loop Builder. Repeat, the stacking and the card-above lookups follow on their own.
- **A haptic tick at the commit point.** Inside Swipe Card, feed Armed into a Pulse, and its Turned On into a Haptic's Play. Try it on a phone preview.
- **Undo.** Keep a Counter of votes. On undo, turn off Card Gone for the card thrown last: the copy whose index is the top card's minus 1.

## Common mistakes

- **A backdrop in the same group as the copies.** Z Position × −1 gives copies below the top one negative values, which sort behind every sibling at 0, so End of Deck would draw over them. The copies get their own Cards group.
- **Cards catching every touch.** A group receives touches like any layer, so Cards would swallow the Find more places tap after the last card leaves. Turning off its Receives Touches lets touches through to its children and to what's behind it.
- **Loop Select without a fallback.** With Out of Range on Skip, the top card's lookup at index −1 is dropped, so the result is one item short and every copy reads the wrong card. Use Fallback gives every copy a card above.
- **Delay One Frame before Loop Select.** Put Loop Select first and delay its result. In a feedback loop, Delay One Frame gives its input's default on the first frame, one value rather than a loop, which is fine for a card's input but leaves Loop Select one item to pick from.
- **Putting reference values in names.** The session first built its knobs as Variable Broadcasters named like "Commit Distance (app: 95)". Nothing can switch to a name; a locked preset can.

## Photo credits

The photos are from [Wikimedia Commons](https://commons.wikimedia.org/). The files are Commons' own 1280-pixel previews (the malasadas and the waterfall as uploaded), and the cards crop them to fit. Their licenses allow sharing and adapting them with credit; the CC BY-SA ones also ask that adaptations keep the same license. `design/photos.json` lists the same credits with each file.

| Photo | Place | Commons page | By | License |
|---|---|---|---|---|
| Malasadas | Leonard's Bakery | [Leonard's malasadas.jpg](<https://commons.wikimedia.org/wiki/File:Leonard%27s_malasadas.jpg>) | _e.t | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/) |
| Pastry case | Leonard's Bakery | [Leonard's Bakery, Honolulu, Hawaii (4540006860).jpg](<https://commons.wikimedia.org/wiki/File:Leonard%27s_Bakery,_Honolulu,_Hawaii_(4540006860).jpg>) | Ken Lund | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/) |
| Bakery storefront | Leonard's Bakery | [Leonard's Bakery (4915217136).jpg](<https://commons.wikimedia.org/wiki/File:Leonard%27s_Bakery_(4915217136).jpg>) | Banzai Hiroaki | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) |
| Plate lunch | Rainbow Drive-In | [Rainbow Drive-In mix plate lunch (2194653288).jpg](<https://commons.wikimedia.org/wiki/File:Rainbow_Drive-In_mix_plate_lunch_(2194653288).jpg>) | Arnold Gatilao | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) |
| Drive-in storefront | Rainbow Drive-In | [Rainbow Drive-In (7442048154).jpg](<https://commons.wikimedia.org/wiki/File:Rainbow_Drive-In_(7442048154).jpg>) | Eugene Kim | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) |
| Mix plate and chili | Rainbow Drive-In | [Rainbow Drive-In mix plate and chili (5636830471).jpg](<https://commons.wikimedia.org/wiki/File:Rainbow_Drive-In_mix_plate_and_chili_(5636830471).jpg>) | John Liu | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) |
| Museum courtyard | Honolulu Museum of Art | [Honolulu - Honolulu Museum of Art - 20160727131828.jpg](<https://commons.wikimedia.org/wiki/File:Honolulu_-_Honolulu_Museum_of_Art_-_20160727131828.jpg>) | Glamorous Vagabonds | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| Impressionism gallery | Honolulu Museum of Art | [HoMA Impressionism.jpg](<https://commons.wikimedia.org/wiki/File:HoMA_Impressionism.jpg>) | HonoluluMuseumOfArt | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| Japanese tea house | Honolulu Museum of Art | [Japanese tea house on the grounds of the Honolulu Museum of Art .JPG](<https://commons.wikimedia.org/wiki/File:Japanese_tea_house_on_the_grounds_of_the_Honolulu_Museum_of_Art_.JPG>) | Wmpearl | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| Mānoa Falls | Mānoa Falls Trail | [ManoaFalls.jpg](<https://commons.wikimedia.org/wiki/File:ManoaFalls.jpg>) | Chouwawa | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| Forest trail | Mānoa Falls Trail | [Manoa Falls Trail (8330307443).jpg](<https://commons.wikimedia.org/wiki/File:Manoa_Falls_Trail_(8330307443).jpg>) | Daniel Ramirez | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) |
| Bamboo steps | Mānoa Falls Trail | [Manoa Falls Trail (8330330105).jpg](<https://commons.wikimedia.org/wiki/File:Manoa_Falls_Trail_(8330330105).jpg>) | Daniel Ramirez | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) |

## The design folder

`design/` holds what the build imports: the HTML, the capture (`capture.json`, text measured by Chromium on macOS), the photos, and `photos.json`. After changing the HTML, run `node examples/16-placemark-deck/design/capture.ts` (it needs Playwright's Chromium and the network), then `node examples/build.ts 16-placemark-deck`.
