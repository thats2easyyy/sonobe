This is Noddit's Discover screen, imported from a design: four place cards in the Cards group, the ✕ and ♥ buttons in Vote Buttons, and End of Deck with its Find more places button under the deck. Make the deck work, and put every number that sets its feel on knobs, so I can compare my proposal with what the shipped app does.

**One card per place.** Keep Card and delete Card 2, Card 3 and Card 4. Repeat Card once per place, top card first. Each copy shows its place's name (Place Name), address, photo credits and three photos (the big one, top right, bottom right), the way the four imported cards show them now:

1. Leonard's Bakery, "933 Kapahulu Ave, Honolulu", "Photos: _e.t · Ken Lund · Banzai Hiroaki", photos malasadas, pastry_case and bakery_storefront.
2. Rainbow Drive-In, "3308 Kanaina Ave, Honolulu", "Photos: Arnold Gatilao · Eugene Kim · John Liu", photos plate_lunch, drive_in_storefront and mix_plate_and_chili.
3. Honolulu Museum of Art, "900 S Beretania St, Honolulu", "Photos: Glamorous Vagabonds · HonoluluMuseumOfArt · Wmpearl", photos museum_courtyard, impressionism_gallery and japanese_tea_house.
4. Mānoa Falls Trail, "3860 Manoa Rd, Honolulu", "Photos: Chouwawa · Daniel Ramirez", photos manoa_falls, forest_trail and bamboo_steps.

Copy 0 is the top card: its Z Position is 0, copy 1's is −1, and so on, so it draws in front and takes the touches. Cards itself shouldn't catch touches, so a tap reaches Find more places once the deck is empty.

**The swipe.** Only the top card moves.

- Dragging it follows the finger sideways, and Vertical Follow of the way up and down. It tilts Tilt per Point degrees for each point it's moved sideways, the other way when you grab its lower half and Grab Tilt is on.
- Letting go votes when the card is headed past Commit Distance: where the finger let go, plus Throw Lookahead seconds of its release speed. A vote throws the card Fly-Out Distance that way (its x position goes from 0 to 600, or −600 on the left). It stays there, gone, and can't be grabbed, and the next card becomes the top card. Otherwise it springs back to the center. One spring moves the card, starting at the finger's speed, with Spring Response and Spring Damping.
- The heart (Card Yes Badge) fades in as the card moves right, from Badge Fade Start to Badge Fade End points, and the ✕ (Card Pass Badge) as it moves left. Once letting go would vote, the badge pops up to Commit Pop.
- The cards underneath wait at Next Card Scale, and the next one grows to full size as the top card nears Commit Distance.
- Tapping ✕ or ♥ throws the top card left or right, one card per tap. Holding one nudges the top card Button Nudge points that way and shows its badge, and the button shrinks to Button Press Scale while pressed.
- With every card gone, Vote Buttons dims to 40%. Find more places brings every card back to the center.

**Knobs.** Make these knobs, and two presets, Proposal and Shipped app, with the values in that order. Lock Shipped app and leave Proposal running.

| Knob | Proposal | Shipped app |
|---|---|---|
| Vertical Follow | 0.3 | 0 |
| Tilt per Point | 1/30° | 1/30° |
| Grab Tilt | on | off |
| Badge Fade Start | 25 pt | 25 pt |
| Badge Fade End | 95 pt | 25 pt |
| Commit Pop | 1.15× | 1× |
| Commit Distance | 95 pt | 95 pt |
| Throw Lookahead | 0.2 s | 0 s |
| Spring Response | 0.3 s | 0.3 s |
| Spring Damping | 0.75 | 0.75 |
| Card Flies Out | on | off |
| Fly-Out Distance | 600 pt | 600 pt |
| Next Card Scale | 0.95× | 1× |
| Button Nudge | 20 pt | 0 pt |
| Button Press Scale | 0.92× | 1× |

Card Flies Out off is how the shipped app works: the card never leaves. Only the top card shows, and the cards under it follow it. A vote hides the voted card and the next place shows in its place: after a drag it springs back from where the finger let go, its badge fading as it comes back, and after a button tap it's right in the center. End of Deck stays hidden until the deck is empty; with Card Flies Out on, it always shows under the cards.
