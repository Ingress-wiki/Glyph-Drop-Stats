import { releaseVelocity } from "./velocity.ts";

/**
 * Scrolling the canvas with a finger. synth-ui reads pointer events as a
 * mouse and scrolls only on the wheel, and its canvas sets
 * `touch-action: none`, so on a phone a swipe would press whatever it
 * started on and scroll nothing.
 *
 * A touch that moves past `SLOP` becomes a scroll along the axis it mostly
 * moved on: synth-ui's press is released off screen, so nothing activates,
 * and the movement is sent as wheel events at the point the finger went
 * down, so the scroll view under it moves, then a glide that slows down
 * after the finger lifts. A touch that doesn't move stays a tap.
 */

/** CSS pixels a finger may wander before a touch becomes a scroll. */
const SLOP = 8;
/** The glide keeps this much of its speed each 16 ms, and stops below `MIN_SPEED` (CSS px per ms). */
const FRICTION = 0.95;
const MIN_SPEED = 0.02;

interface Touch {
  id: number;
  start: { x: number; y: number };
  last: { x: number; y: number };
  axis: "x" | "y" | null;
  samples: { t: number; x: number; y: number }[];
}

/**
 * Turns touch drags over the canvas, or the text layer above it, into
 * scrolling. `pixelScale` is CSS pixels per virtual pixel: synth-ui reads
 * wheel deltas as virtual pixels, so the content follows the finger.
 */
export function enableTouchScroll(canvas: HTMLCanvasElement, layer: HTMLElement, pixelScale: number): void {
  let touch: Touch | null = null;
  let glide = 0;

  const over = (target: EventTarget | null) => target instanceof Node && (target === canvas || layer.contains(target));
  const wheel = (at: { x: number; y: number }, dx: number, dy: number) =>
    canvas.dispatchEvent(
      new WheelEvent("wheel", { deltaX: dx / pixelScale, deltaY: dy / pixelScale, deltaMode: 0, clientX: at.x, clientY: at.y, bubbles: true, cancelable: true }),
    );

  window.addEventListener(
    "pointerdown",
    (event) => {
      if (!event.isTrusted || event.pointerType !== "touch" || !event.isPrimary || !over(event.target)) return;
      cancelAnimationFrame(glide);
      const at = { x: event.clientX, y: event.clientY };
      touch = { id: event.pointerId, start: at, last: at, axis: null, samples: [{ t: event.timeStamp, ...at }] };
    },
    true,
  );

  window.addEventListener(
    "pointermove",
    (event) => {
      if (!event.isTrusted || !touch || event.pointerId !== touch.id) return;
      if (touch.axis === null) {
        const moved = { x: event.clientX - touch.start.x, y: event.clientY - touch.start.y };
        if (Math.hypot(moved.x, moved.y) < SLOP) return;
        touch.axis = Math.abs(moved.x) > Math.abs(moved.y) ? "x" : "y";
        // Let go of whatever the touch pressed, where nothing is, so it doesn't activate.
        canvas.dispatchEvent(new PointerEvent("pointerup", { pointerId: touch.id, pointerType: "touch", button: 0, clientX: -1e4, clientY: -1e4, bubbles: true }));
      }
      event.stopImmediatePropagation();
      const dx = touch.axis === "x" ? touch.last.x - event.clientX : 0;
      const dy = touch.axis === "y" ? touch.last.y - event.clientY : 0;
      wheel(touch.start, dx, dy);
      touch.last = { x: event.clientX, y: event.clientY };
      touch.samples.push({ t: event.timeStamp, ...touch.last });
      if (touch.samples.length > 32) touch.samples.splice(0, touch.samples.length - 32);
    },
    true,
  );

  const end = (event: PointerEvent) => {
    if (!event.isTrusted || !touch || event.pointerId !== touch.id) return;
    const ended = touch;
    touch = null;
    if (ended.axis === null) return;
    // synth-ui already had its release.
    event.stopImmediatePropagation();
    if (event.type === "pointercancel") return;
    const velocity = releaseVelocity(ended.samples, event.timeStamp);
    let speed = -(ended.axis === "x" ? velocity.x : velocity.y);
    let then = performance.now();
    const step = (now: number) => {
      const dt = Math.min(now - then, 50);
      then = now;
      if (Math.abs(speed) < MIN_SPEED) return;
      const distance = speed * dt;
      wheel(ended.start, ended.axis === "x" ? distance : 0, ended.axis === "y" ? distance : 0);
      speed *= FRICTION ** (dt / 16);
      glide = requestAnimationFrame(step);
    };
    glide = requestAnimationFrame(step);
  };
  window.addEventListener("pointerup", end, true);
  window.addEventListener("pointercancel", end, true);
}
