// figure.js: the figure's pace, and the neutral placeholder drawn in code.
//
// On the box the figure is a set of pictures: idle, wave, working and making with 16
// frames each, played forwards and back; confetti with 18 frames played once; a 72 px
// avatar. In a scene the box takes the frame from the scene's time, one step per 160 ms
// (muse.h, t / 160). On the ready screen and the celebration it steps once at least
// 160 ms have passed, checked on its 100 ms display ticks, which is one step every
// second tick: 200 ms (CARD_STEP_MS). The step functions here serve every source.
//
// The figure itself comes from pictures (figure_frames.js): a figure style, a set of six
// animated PNGs in the owner's folder (today "Muse", web/local/muse_*.png). Figure below
// is only the placeholder of the public page (demo, screenshots, `?figure=placeholder`):
// a soft neutral silhouette in a mix of the page and the ink colour (a round body with a
// slightly darker lower half and two eyes; a waving arm, thought dots, an orbiting spark,
// a bounce with falling flecks), so it suits the light and the dark palette and carries
// no colour of its own. Up to 1.8.20 this was a blue character with cheeks and a smile;
// the owner retired that look on 19.11.2026, and a screen that names a figure style never
// shows this placeholder at all, not even while its pictures load.
//
// Pitfalls:
//  * Meta's Muse artwork never goes into this file or the repository; the placeholder is
//    deliberately plain so nobody mistakes it for a brand.
//  * The frame is an opaque square in the page colour (like the box's pictures), which
//    motion.js and the scene's disc clip rely on.
//  * Smooth: above the box's 10 frames a second the placeholder is drawn between its
//    frames (`smooth`), with the same timing; at 10 frames a second it shows whole steps.
import { PAGE, INK, css } from "./render.js";

export const SIZE = 160;
export const AVATAR = 72;
// The placeholder's tones as a share of the way from the page colour to the ink colour:
// grey on the light page, dark grey on the black one, never a hue of its own.
export const TONES = Object.freeze({ body: 0.16, shade: 0.24, detail: 0.55, fleck: 0.32 });

// The colour `share` of the way from `page` to `ink`, per channel, rounded.
export function neutralTone(share, page = PAGE, ink = INK) {
  return page.map((p, i) => Math.round(p + (ink[i] - p) * share));
}
export const FRAMES = 16;
export const CONFETTI_FRAMES = 18;
export const STEP_MS = 160; // a step in a scene
export const CARD_STEP_MS = 200; // a step on the ready screen and the celebration

const deg = (d) => (d * Math.PI) / 180;

// The frame of a looping animation t ms after it started: 0 .. frames - 1 forwards,
// then back, one step per `stepMs`.
export function pingPongStep(t, stepMs = STEP_MS, frames = FRAMES) {
  if (frames <= 1) return 0;
  const step = Math.floor(Math.max(0, t) / stepMs) % (2 * (frames - 1));
  return step < frames ? step : 2 * (frames - 1) - step;
}

// The same as a continuous position between the frames: equal to pingPongStep() at
// every whole step, a straight line between two of them.
export function pingPongPos(t, stepMs = STEP_MS, frames = FRAMES) {
  if (frames <= 1) return 0;
  const cycle = 2 * (frames - 1);
  const pos = (Math.max(0, t) / stepMs) % cycle;
  return pos <= frames - 1 ? pos : cycle - pos;
}

// The frame of a once-only animation (confetti) t ms after it started; it holds the last.
export function onceStep(t, stepMs = STEP_MS, frames = CONFETTI_FRAMES, smooth = false) {
  const pos = Math.max(0, t) / stepMs;
  return Math.min(frames - 1, smooth ? pos : Math.floor(pos));
}

export class Figure {
  constructor() {
    this.smooth = false; // draw between the frames (above 10 frames a second)
  }

  // Draws the figure's frame at (x0, y0): `sub` is idle, wave, working, making, avatar
  // or confetti; `t` ms since the animation started, `stepMs` the length of a step
  // (STEP_MS in a scene, CARD_STEP_MS on the cards). The frame is an opaque square in
  // the page colour, like the box's pictures, whose edges fade into that colour: on the
  // page the square is invisible, in a scene the caller clips it to a disc, which is the
  // light round frame the box shows there.
  // `drawSize` (optional) draws the frame that many px wide instead of its own size, for
  // the larger figure of the square layout (square.js).
  draw(r, sub, t, x0, y0, stepMs = STEP_MS, drawSize = 0) {
    const size = sub === "avatar" ? AVATAR : SIZE;
    const c = r.ctx;
    c.save();
    c.translate(x0, y0);
    if (drawSize > 0 && drawSize !== size) c.scale(drawSize / size, drawSize / size);
    c.fillStyle = css(PAGE);
    c.fillRect(0, 0, size, size);
    if (sub === "confetti") drawConfettiFrame(c, onceStep(t, stepMs, CONFETTI_FRAMES, this.smooth), size);
    else drawFrame(c, sub, t, size, stepMs, this.smooth);
    c.restore();
  }
}

// One frame of idle, wave, working, making or the avatar, on a canvas whose origin is
// the frame's top left corner; `smooth` draws the position between two frames.
export function drawFrame(c, sub, t, size, stepMs = STEP_MS, smooth = false) {
  const step = smooth ? pingPongPos(t, stepMs) : pingPongStep(t, stepMs);
  const phase = step / FRAMES;
  const cx = size / 2;
  const [cy, br] = sub === "avatar" ? [size * 0.5, size * 0.4]
    : sub === "working" || sub === "making" ? [size * 0.56, size * 0.28] : [size * 0.54, size * 0.3];
  const shade = neutralTone(TONES.shade);
  if (sub === "wave") { // the waving hand: a small disc on an arm that swings
    const ang = deg(-60 + 35 * Math.sin(4 * Math.PI * phase));
    const ax = cx + br * 0.95, ay = cy - br * 0.1;
    const hx = ax + Math.cos(ang) * br * 0.55, hy = ay + Math.sin(ang) * br * 0.55;
    thickLine(c, ax, ay, hx, hy, br * 0.16, shade);
    disc(c, hx, hy, br * 0.14, shade);
  }
  const squash = sub === "idle" ? 1 + 0.03 * Math.sin(2 * Math.PI * phase) : 1; // breathing
  body(c, cx, cy, br, squash);
  const look = sub === "working" ? Math.sin(2 * Math.PI * phase) : 0;
  const blink = sub === "idle" && Math.round(step) === 11;
  eyes(c, cx, cy, br, look, blink);
  if (sub === "working") { // three thought dots above, swelling one after another
    for (let k = 0; k < 3; k++) {
      const p = (Math.sin(2 * Math.PI * (phase - k * 0.18)) + 1) / 2;
      disc(c, cx + (k - 1) * br * 0.32, cy - br * 1.25 - k * br * 0.05, br * (0.06 + 0.05 * p), shade);
    }
  }
  if (sub === "making") { // a spark that orbits the head
    const ang = 2 * Math.PI * phase;
    star(c, cx + Math.cos(ang) * br * 1.25, cy - br * 0.4 + Math.sin(ang) * br * 0.5, br * 0.16, shade);
  }
}

// Frame i of the drawn confetti animation: the body bounces, neutral flecks fall from
// the top at fixed positions; a fractional i lies between two.
export function drawConfettiFrame(c, i, size) {
  const n = CONFETTI_FRAMES;
  const t = i / (n - 1);
  const cx = size / 2, cy = size * 0.58, br = size * 0.26;
  const bounce = Math.abs(Math.sin(Math.PI * t * 2)) * br * 0.15;
  body(c, cx, cy - bounce, br, 1);
  eyes(c, cx, cy - bounce, br, 0, false);
  c.fillStyle = css(neutralTone(TONES.fleck));
  for (let k = 0; k < 26; k++) {
    const seed = ((k * 7919) % 1000) / 1000;
    const x = (k * 61) % size;
    const y = ((seed * size + t * size * 1.4) % (size * 1.2)) - size * 0.1;
    const w = br * 0.09, h = br * 0.05 * (0.5 + Math.abs(Math.sin(2 * Math.PI * (t + seed))));
    c.fillRect(x - w, y - h, 2 * w, 2 * h);
  }
}

// A round body with a slightly darker lower half, squashed a little for breathing.
function body(c, cx, cy, r, squash) {
  const rx = r, ry = r * squash;
  c.beginPath();
  c.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
  c.fillStyle = css(neutralTone(TONES.body));
  c.fill();
  c.beginPath();
  c.ellipse(cx, cy, rx, ry, 0, deg(20), deg(160));
  c.closePath();
  c.fillStyle = css(neutralTone(TONES.shade));
  c.fill();
}

// Two eyes and nothing else (no mouth, no cheeks), so the silhouette reads as a stand-in.
function eyes(c, cx, cy, r, look, blink) {
  const ex = r * 0.34, ey = cy - r * 0.12, er = r * 0.09;
  const tone = neutralTone(TONES.detail);
  for (const sx of [-1, 1]) {
    const x = cx + sx * ex + look * r * 0.1;
    if (blink) thickLine(c, x - er, ey, x + er, ey, 3, tone, false);
    else disc(c, x, ey, er, tone);
  }
}

function disc(c, x, y, r, color) {
  c.beginPath();
  c.arc(x, y, r, 0, 2 * Math.PI);
  c.fillStyle = css(color);
  c.fill();
}

function thickLine(c, x1, y1, x2, y2, w, color, round = true) {
  c.beginPath();
  c.moveTo(x1, y1);
  c.lineTo(x2, y2);
  c.lineWidth = w;
  c.lineCap = round ? "round" : "butt";
  c.strokeStyle = css(color);
  c.stroke();
  c.lineCap = "butt";
}

function star(c, sx, sy, s, color) {
  c.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = (Math.PI / 5) * k - Math.PI / 2;
    const rr = k % 2 === 0 ? s : s * 0.45;
    const x = sx + Math.cos(a) * rr, y = sy + Math.sin(a) * rr;
    if (k === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  c.closePath();
  c.fillStyle = css(color);
  c.fill();
}
