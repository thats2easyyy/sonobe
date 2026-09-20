Make this "Payment sent" confirmation play itself when the prototype starts:

- at 0.1 s the green circle pops in (scale 0 → 1 with a little bounce) and its pale ring grows from 0.5 to 1,
- at 0.45 s the checkmark draws itself in 0.45 s, easing out (stroke end 0 → 1). Its shape is the path `M34 62L52 80L88 42` in a 120 × 120 view box, 120 × 120,
- at 0.8 s the title and the amount fade in over 0.4 s while rising 16 points,
- at 1.15 s the receipt slides up from y 900 to y 548,
- at 1.5 s the Replay button fades in over 0.3 s.

Tapping Replay plays the whole thing again from the top.
