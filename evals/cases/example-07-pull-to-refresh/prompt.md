Add pull to refresh to the feed.

- The feed scrolls vertically. As you pull down past the top, the spinner arc behind the list draws in: its opacity rises with the pull (fully visible at 64 points), and its stroke end grows up to 0.8.
- Let go when it's pulled at least 64 points and it refreshes: the feed holds 64 points down while the spinner spins (a full turn every 0.9 s) and a pretend request runs for 1.6 seconds. Then the list slides back up to 0, the spinner fades out, and the status line changes from "Pull down to refresh" to "Updated just now".
- Let go before 64 points and it just springs back without refreshing. Scrolling up the normal way never refreshes.
