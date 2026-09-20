Make this post likeable, two ways. Tapping the heart button likes the post, and tapping it again unlikes it. Double-tapping the photo likes it too, but a double tap never unlikes it.

- Draw the small heart and the big heart over the photo with this path (view box 0 0 24 24), 24 × 24 for the heart and 96 × 96 for the big heart: `M12 21C12 21 3 15.2 3 8.9C3 5.8 5.4 3.5 8.2 3.5C9.9 3.5 11.2 4.4 12 5.7C12.8 4.4 14.1 3.5 15.8 3.5C18.6 3.5 21 5.8 21 8.9C21 15.2 12 21 12 21Z`
- Unliked, the heart is an outline: a transparent fill with an ink (#111118) stroke, at 0.9 scale. Liked, it fills pink (#FF3D71), its outline turns the same pink, and it pops to full size with a big bounce that overshoots past 1 first.
- The count reads "128 likes", and "129 likes" while the post is liked.
- A double tap on the photo also flashes the big white heart: it pops in fully visible, then disappears about half a second later. A single tap on the photo does nothing.
