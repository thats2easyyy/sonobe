Make a palette of twelve color tiles from the one Tile layer, in three columns:

- Lay them out in a grid from [16, 290], 370 wide, with rows 116 tall and 10 points between tiles, so each tile is about 116.667 wide.
- Color tile i with hue i ÷ 12, saturation 0.72 and lightness 0.6, and number them "#01" to "#12".
- After a 0.15 s pause the tiles pop in one after another, 0.04 s apart: scale 0.6 → 1 and opacity 0 → 1.
- Tapping a tile selects it: it gets a 4-point white ring (its stroke width springs to 4) and the others lose theirs. Tile 1 starts selected. The Preview card animates to the selected color and its label shows the color's hex code, like "#5099E2".
