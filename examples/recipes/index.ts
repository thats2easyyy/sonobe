/** Every example recipe, in learning order. */

import type { Recipe } from "../lib/recipe.ts";
import { tapToGrow } from "./01-tap-to-grow.ts";
import { likeToggle } from "./02-like-toggle.ts";
import { scrollingList } from "./03-scrolling-list.ts";
import { carouselPaging } from "./04-carousel-paging.ts";
import { tabBar } from "./05-tab-bar.ts";
import { collapsingHeader } from "./06-collapsing-header.ts";
import { pullToRefresh } from "./07-pull-to-refresh.ts";
import { bottomSheet } from "./08-bottom-sheet.ts";
import { dragAndSnap } from "./09-drag-and-snap.ts";
import { swipeCards } from "./10-swipe-cards.ts";
import { longPressMenu } from "./11-long-press-menu.ts";
import { timedSequence } from "./12-timed-sequence.ts";
import { stories } from "./13-stories.ts";
import { onboarding } from "./14-onboarding.ts";
import { gridWithLoops } from "./15-grid-with-loops.ts";
import { nodditDeck } from "./16-noddit-deck.ts";

export const RECIPES: readonly Recipe[] = [
  tapToGrow,
  likeToggle,
  scrollingList,
  carouselPaging,
  tabBar,
  collapsingHeader,
  pullToRefresh,
  bottomSheet,
  dragAndSnap,
  swipeCards,
  longPressMenu,
  timedSequence,
  stories,
  onboarding,
  gridWithLoops,
  nodditDeck,
];
