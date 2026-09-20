/**
 * The player's own gesture: a three-finger tap opens its menu (menu.ts), as in Stitch's phone
 * player. Shaking would collide with Device Motion prototypes, and a button would cover the screen.
 *
 * Fingers never land at the same instant, so the first ones reach the prototype before a third one
 * makes it the player's gesture. From that moment the touch belongs to the player: the prototype gets
 * a pointer cancel for each finger it already has (so nothing taps or keeps dragging), and nothing
 * else from those fingers, or from any finger that lands before they all lift. Mouse and pen input
 * always pass through.
 */

/** The PointerEvent fields the gesture reads. */
export interface GesturePointer {
  type: string;
  pointerId: number;
  pointerType: string;
  clientX: number;
  clientY: number;
  timeStamp: number;
}

export interface GestureDecision {
  /** Keep the event from the prototype. */
  swallow: boolean;
  /** Fingers the prototype already has, to cancel now (client coordinates). */
  cancel?: { pointerId: number; clientX: number; clientY: number }[];
  /** A three-finger tap just finished. */
  tap?: boolean;
}

export interface MenuGestureOptions {
  /** Fingers down at once that make the player's gesture. Default 3. */
  fingers?: number;
  /** Longest tap, from the first finger down to the last one up, in ms. Default 600. */
  maxTapMs?: number;
  /** How far a finger may move and still tap, in CSS pixels. Default 24. */
  slop?: number;
}

export interface MenuGesture {
  /** What to do with a pointer event (pointerdown, move, up, cancel, and leave/out after a claimed touch). */
  handle(e: GesturePointer): GestureDecision;
  /** The player owns the current touch. */
  readonly claimed: boolean;
  reset(): void;
}

interface Finger {
  x0: number;
  y0: number;
  x: number;
  y: number;
  downAt: number;
  /** The prototype got this finger's pointerdown. */
  delivered: boolean;
}

const PASS: GestureDecision = { swallow: false };
const SWALLOW: GestureDecision = { swallow: true };

export function createMenuGesture(options: MenuGestureOptions = {}): MenuGesture {
  const fingers = options.fingers ?? 3;
  const maxTapMs = options.maxTapMs ?? 600;
  const slop = options.slop ?? 24;
  const touches = new Map<number, Finger>();
  /** Fingers of the player's touches, until their pointerleave (which follows pointerup) has passed. */
  const owned = new Set<number>();
  let claim: { startedAt: number; moved: boolean } | null = null;
  const moved = (f: Finger) => Math.hypot(f.x - f.x0, f.y - f.y0) > slop;

  const lift = (e: GesturePointer): GestureDecision => {
    const finger = touches.get(e.pointerId);
    if (!finger) return owned.has(e.pointerId) ? SWALLOW : PASS;
    touches.delete(e.pointerId);
    if (!claim) return PASS;
    if (touches.size > 0) return SWALLOW;
    const tap = !claim.moved && e.timeStamp - claim.startedAt <= maxTapMs;
    claim = null;
    return tap ? { swallow: true, tap: true } : SWALLOW;
  };

  return {
    handle(e) {
      if (e.pointerType !== "touch") return PASS;
      switch (e.type) {
        case "pointerdown": {
          owned.delete(e.pointerId);
          touches.set(e.pointerId, { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, downAt: e.timeStamp, delivered: claim === null });
          if (claim) {
            owned.add(e.pointerId);
            return SWALLOW;
          }
          if (touches.size < fingers) return PASS;
          const all = [...touches];
          claim = { startedAt: Math.min(...all.map(([, f]) => f.downAt)), moved: all.some(([, f]) => moved(f)) };
          const cancel = all.filter(([id, f]) => id !== e.pointerId && f.delivered).map(([pointerId, f]) => ({ pointerId, clientX: f.x, clientY: f.y }));
          for (const [id, finger] of all) {
            finger.delivered = false;
            owned.add(id);
          }
          return cancel.length ? { swallow: true, cancel } : SWALLOW;
        }
        case "pointermove": {
          const finger = touches.get(e.pointerId);
          if (!finger) return owned.has(e.pointerId) ? SWALLOW : PASS;
          finger.x = e.clientX;
          finger.y = e.clientY;
          if (!claim) return PASS;
          if (moved(finger)) claim.moved = true;
          return SWALLOW;
        }
        case "pointerup":
        case "pointercancel":
          return lift(e);
        case "pointerleave": {
          const mine = owned.delete(e.pointerId);
          return mine ? SWALLOW : PASS;
        }
        default:
          return owned.has(e.pointerId) ? SWALLOW : PASS;
      }
    },
    get claimed() {
      return claim !== null;
    },
    reset() {
      touches.clear();
      owned.clear();
      claim = null;
    },
  };
}
