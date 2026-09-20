Make the sheet draggable between three stops: half open (its top edge at y 470, where it starts), fully open (y 132, just below the location chip) and collapsed (y 760).

- It sticks to the finger while you drag.
- When you let go, it springs to the stop that a fling at the finger's speed would reach (project it with fast deceleration), and the spring starts moving at the finger's speed. A fast flick down collapses it, a short quick flick up still opens it fully, and a small slow drag springs back to where it was.
- Use a spring with tension 300 and friction 30.
- The Scrim dims the map as the sheet opens: opacity 0 when collapsed, 0.4 when fully open, in proportion in between (about 0.185 at half open).
