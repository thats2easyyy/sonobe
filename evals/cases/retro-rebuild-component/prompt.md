The Swipe Card component is left over from an old swipe experiment. Rebuild its logic from scratch, in one batch, as a flip card: tapping the card scales its face down to 0.9 with a spring, and tapping again springs it back to full size. Dragging it shouldn't do anything any more.

Keep these patch names for the new logic: Card Tap, Card Flipped, Flip Spring and Flip Scale. Remove everything else from the old design, including the Swiped Left and Swiped Right outputs, and give the component one output, Flipped, that's on while the card is flipped.
