/**
 * Isolated layer screenshots (get_screenshot with isolate: true): a SceneFrame cut down to one
 * layer's subtree, so the picture shows that layer alone, like the card under the top card or one
 * loop copy. Both hosts draw the result with their usual scene renderer. Browser-safe.
 */

import type { SceneFrame, SceneNode } from "@sonobe/engine";

function* walk(nodes: readonly SceneNode[]): Generator<SceneNode> {
  for (const node of nodes) {
    yield node;
    yield* walk(node.children ?? []);
  }
}

/**
 * The scene nodes a screenshot target names: the node with that scene key ("card#2",
 * "card#2/badge"), else every node of that layer id (all its loop copies and instances), else every
 * copy along an instance path written without copy numbers ("card/badge" matches "card#1/badge").
 */
export function sceneNodesFor(scene: SceneFrame, target: string): SceneNode[] {
  const nodes = [...walk(scene.roots ?? [])];
  const exact = nodes.find((n) => n.key === target);
  if (exact) return [exact];
  const byLayer = nodes.filter((n) => n.layerId === target);
  if (byLayer.length || !target.includes("/")) return byLayer;
  return nodes.filter((n) => n.key.replace(/#\d+/g, "") === target);
}

/**
 * A copy of `scene` that draws only `target` and its children. The kept nodes become roots placed by
 * their world transforms, so they draw where they are on screen, without the layers in front of or
 * behind them and without their parents' opacity and clipping. Undefined when nothing matches.
 */
export function isolateSceneLayer(
  scene: SceneFrame,
  target: string,
): { scene: SceneFrame; nodes: SceneNode[]; notes: string[] } | undefined {
  const nodes = sceneNodesFor(scene, target);
  if (!nodes.length) return undefined;
  const roots = nodes.map((n) => ({ ...n, parentKey: null, transform: [...n.worldTransform] }));
  const notes: string[] = [];
  if (nodes.every((n) => n.visible === false || !(n.opacity > 0)))
    notes.push(
      `Layer "${target}" is hidden in this frame (opacity 0 or not visible), so the isolated drawing shows only the background.`,
    );
  return { scene: { ...scene, roots }, nodes: roots, notes };
}
