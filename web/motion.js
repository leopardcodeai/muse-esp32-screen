// motion.js: Muse's moves on the ready screen (dance, party, jump, hop, spin, nod, shake,
// bow, shiver, sleep, love, look, celebrate, wave), done in code on top of the figure's
// own frames. The figure's pictures stay what they are (the project's frames, the owner's
// frames from the Muse app, or the figure drawn in code); a motion only moves, turns and
// squashes the whole picture and draws a few shapes around it (confetti, coloured light,
// hearts, a floating Z, cold marks). So every move works with every figure source, and no
// new video frame is needed.
//
// What is here:
//  * parseMotion(): a motion's name, English or German ("tanzen", "nicken", ...), to its
//    canonical name, "stop", or null.
//  * motionSeconds(): the time a motion plays, its default when none is given, capped.
//  * motionPose(): the pure curve of a motion at time t: offset x/y (in figure sizes),
//    tilt (degrees), scale x/y, an opacity, the pivot, the figure animation to play
//    under it and which effects show. No DOM, no canvas, so the Node tests run it.
//  * MotionPlayer: the one motion that runs; it starts when the ready screen is first
//    seen after the request, so a dance asked for while a card shows plays once the card
//    has gone.
//  * IdleVariety: now and then (30 to 90 s on the ready screen) a short subtle motion
//    (look around, a small hop, a nod), so the idle figure feels alive.
//  * withMotionPose() and drawMotionEffects(): the canvas side, on a context handed in
//    (a CanvasRenderingContext2D or a test double).
//
// Pitfalls:
//  * Every curve is multiplied by an envelope that fades in over 250 ms and out over
//    350 ms, so a motion never jumps on or off, whatever its length.
//  * Squash and stretch pivot at the figure's feet (0.92 of its height), turns at its
//    middle; scaling about the middle makes a jump look like a zoom.
//  * The figure's frame is an opaque square in the page colour. A moved square must be
//    clipped below the top bar (the renderers do that, as they do for "Muse folgt mir"),
//    and effects are drawn over the figure, never behind it, where the square hides them.
//  * Combined with "Muse folgt mir" the follow offsets add to the motion's; the follow
//    tilt is damped while a motion runs (followDamp), so a dance's sway and a person's
//    tilt do not pull against each other.
//  * prefers-reduced-motion: every motion becomes a gentle pulse of size and opacity,
//    without offsets, turns or particles.
//  * Status poses (listening, thinking, speaking) and cards win: the renderers sample a
//    motion only on the plain ready screen.
import { rnd, PALETTE } from "./particles.js";

// The motions in the order the docs list them; "hop" is the small jump of the idle variety.
export const MOTIONS = ["dance", "party", "jump", "hop", "spin", "nod", "shake", "bow", "shiver", "sleep",
  "love", "look", "celebrate", "wave"];

// Seconds a motion plays without `seconds`.
export const DEFAULT_SECONDS = Object.freeze({
  dance: 6, party: 8, jump: 2, hop: 0.9, spin: 2, nod: 1.6, shake: 1.6, bow: 2.4, shiver: 3, sleep: 8,
  love: 4, look: 3, celebrate: 5, wave: 3,
});
export const MIN_SECONDS = 0.5;
export const MAX_SECONDS = 30;
// A motion asked for while a card shows waits this long for the ready screen.
export const PENDING_MS = 60000;
export const FADE_IN_MS = 250;
export const FADE_OUT_MS = 350;
// The share of the follow tilt that a running motion takes away.
export const FOLLOW_DAMP = 0.75;
// The idle variety: a pause of 30 to 90 s on the ready screen, then one of these.
export const IDLE_MOTIONS = ["look", "hop", "nod"];
export const IDLE_MIN_MS = 30000;
export const IDLE_MAX_MS = 90000;
export const IDLE_INTENSITY = 0.6;

// Names an assistant or a person may use, mapped to the motion (lower case, no accents).
const ALIASES = {
  dance: "dance", tanz: "dance", tanze: "dance", tanzen: "dance",
  party: "party", disco: "party", disko: "party", feier: "party",
  jump: "jump", springen: "jump", spring: "jump", sprung: "jump", hupfen: "jump", huepfen: "jump",
  hop: "hop", hupfer: "hop", huepfer: "hop",
  spin: "spin", drehen: "spin", dreh: "spin", drehung: "spin", pirouette: "spin",
  nod: "nod", nicken: "nod", nick: "nod", ja: "nod", yes: "nod",
  shake: "shake", schutteln: "shake", schuetteln: "shake", kopfschutteln: "shake", kopfschuetteln: "shake",
  nein: "shake", no: "shake",
  bow: "bow", verbeugen: "bow", verbeugung: "bow", diener: "bow",
  shiver: "shiver", cold: "shiver", frieren: "shiver", frierst: "shiver", kalt: "shiver", zittern: "shiver",
  sleep: "sleep", schlafen: "sleep", schlaf: "sleep", mude: "sleep", muede: "sleep", sleepy: "sleep",
  love: "love", heart: "love", heartbeat: "love", liebe: "love", herz: "love", herzschlag: "love",
  look: "look", lookaround: "look", umschauen: "look", umsehen: "look", schauen: "look",
  celebrate: "celebrate", feiern: "celebrate", jubeln: "celebrate", jubel: "celebrate",
  wave: "wave", winken: "wave", wink: "wave", hallo: "wave",
  stop: "stop", stopp: "stop", aus: "stop", off: "stop", halt: "stop", none: "stop", idle: "stop", ruhe: "stop",
};

// A motion's name, English or German, to its canonical name, "stop", or null.
export function parseMotion(name) {
  const key = String(name ?? "").trim().toLowerCase()
    .replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u").replace(/ß/g, "ss")
    .replace(/[\s_-]+/g, "");
  return ALIASES[key] || null;
}

// The seconds motion `name` plays: `seconds` clamped to 0.5 .. 30, its default when
// `seconds` is missing, empty or not a number.
export function motionSeconds(name, seconds) {
  const fallback = DEFAULT_SECONDS[name] ?? 4;
  if (seconds === undefined || seconds === null || String(seconds).trim() === "") return fallback;
  const n = Number(String(seconds).replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, n));
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (v) => { const x = clamp01(v); return x * x * (3 - 2 * x); };
const easeInOut = (v) => { const x = clamp01(v); return x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x); };
const TAU = 2 * Math.PI;

// 0 at the start and the end of a motion of `durMs`, 1 in between, with soft edges.
export function envelope(t, durMs) {
  if (!(t >= 0) || t >= durMs) return 0;
  const fin = Math.min(FADE_IN_MS, durMs / 3), fout = Math.min(FADE_OUT_MS, durMs / 3);
  return smooth(t / fin) * smooth((durMs - t) / fout);
}

// One hop of length 1 (k from 0 to 1): a crouch, the flight, the landing.
// Returns {lift 0..1, squash: >0 squashed, <0 stretched}.
export function hopCurve(k) {
  if (k < 0.2) return { lift: 0, squash: smooth(k / 0.2) }; // crouch before the jump
  if (k < 0.75) {
    const a = (k - 0.2) / 0.55;
    const lift = Math.sin(Math.PI * a);
    // stretched while rising fast, round at the top, stretched again falling
    return { lift, squash: -0.7 * Math.abs(Math.cos(Math.PI * a)) * (a < 0.15 ? a / 0.15 : 1) };
  }
  const b = (k - 0.75) / 0.25; // landing: a squash that springs back
  return { lift: 0, squash: Math.sin(Math.PI * b) * (1 - 0.4 * b) };
}

// A narrow bump at `at` (0..1 within the beat), `w` wide: the shape of a heartbeat.
function bump(k, at, w) {
  const x = (k - at) / w;
  return Math.exp(-x * x * 4);
}

const NEUTRAL_POSE = Object.freeze({ dx: 0, dy: 0, angle: 0, sx: 1, sy: 1, alpha: 1, pivot: 0.5 });

// The pose of motion `name` at `t` ms of `durMs`. Offsets are in figure sizes (dy
// positive is down), the angle in degrees (positive clockwise, like canvas rotate()),
// sx and sy the scale, `pivot` the height of the turning point in figure sizes from the
// top (0.5 middle, 0.92 the feet). `anim` is the figure animation under the motion
// (idle, wave or confetti); `effects` says which shapes show and with what weight:
// {confetti, lights, hearts, zs, cold} (0 .. 1, 0 when off). `weight` is the envelope.
// opts: {intensity (1), reduced (prefers-reduced-motion)}.
export function motionPose(name, t, durMs, { intensity = 1, reduced = false } = {}) {
  const env = envelope(t, durMs);
  const effects = { confetti: 0, lights: 0, hearts: 0, zs: 0, cold: 0 };
  const anim = name === "party" || name === "wave" ? "wave" : name === "celebrate" ? "confetti" : "idle";
  const base = { ...NEUTRAL_POSE, anim, effects, weight: env, t, name };
  if (env <= 0) return base;
  if (reduced) {
    // A gentle pulse of size and opacity, nothing that travels or turns.
    const pulse = 0.5 - 0.5 * Math.cos((TAU * t) / 1400);
    const s = 1 + 0.025 * pulse * env;
    return { ...base, sx: s, sy: s, alpha: 1 - 0.15 * pulse * env };
  }
  let dx = 0, dy = 0, angle = 0, sx = 1, sy = 1, pivot = 0.92;
  switch (name) {
    case "dance":
    case "party": {
      // Two beats per sway, a bounce on every beat with a squash where it lands.
      const beat = name === "party" ? 430 : 500;
      const ph = t / beat, k = ph % 1;
      const side = Math.floor(ph) % 2 === 0 ? 1 : -1;
      const up = Math.sin(Math.PI * k);
      const land = Math.max(0, 1 - k / 0.18);
      const big = name === "party" ? 1.25 : 1;
      dy = -0.05 * up * big;
      sy = 1 - 0.07 * land + 0.04 * up;
      sx = 1 + 0.06 * land - 0.02 * up;
      angle = side * 7 * up * big;
      dx = 0.035 * Math.sin(Math.PI * ph) * big;
      if (name === "party") {
        effects.confetti = env;
        effects.lights = env;
      }
      break;
    }
    case "jump":
    case "hop":
    case "celebrate": {
      const small = name === "hop";
      const n = small ? 1 : Math.max(1, Math.round(durMs / (name === "celebrate" ? 850 : 950)));
      const len = durMs / n;
      const h = hopCurve((t % len) / len);
      const height = small ? 0.06 : name === "celebrate" ? 0.13 : 0.14;
      dy = -height * h.lift;
      sy = 1 - 0.12 * h.squash * (small ? 0.6 : 1);
      sx = 1 + 0.08 * h.squash * (small ? 0.6 : 1);
      if (name === "celebrate") {
        angle = 6 * Math.sin((TAU * t) / len) * h.lift;
        effects.confetti = env;
        effects.lights = env * 0.6;
      }
      break;
    }
    case "spin": {
      // A turn on the spot: the picture narrows, mirrors and widens again (one turn
      // per 1.6 s), with a small lift while it turns.
      const turns = Math.max(1, Math.round(durMs / 1600));
      const inner = clamp01((t - 150) / Math.max(1, durMs - 450));
      const c = Math.cos(TAU * turns * easeInOut(inner));
      sx = Math.sign(c || 1) * Math.max(0.06, Math.abs(c));
      dy = -0.04 * Math.sin(Math.PI * inner);
      pivot = 0.5;
      break;
    }
    case "nod": {
      // Three nods: the head goes down and comes back, a little squash with each.
      const n = Math.max(2, Math.round(durMs / 520));
      const a = Math.abs(Math.sin(Math.PI * n * (t / durMs)));
      dy = 0.03 * a;
      sy = 1 - 0.05 * a;
      sx = 1 + 0.015 * a;
      angle = 2 * a;
      break;
    }
    case "shake": {
      const n = Math.max(2, Math.round(durMs / 550));
      const s = Math.sin(TAU * n * (t / durMs));
      angle = 8 * s;
      dx = 0.03 * s;
      pivot = 0.6;
      break;
    }
    case "bow": {
      // Down in the first 30 %, held, up from 65 %.
      const p = t / durMs;
      const b = p < 0.3 ? easeInOut(p / 0.3) : p < 0.65 ? 1 : 1 - easeInOut((p - 0.65) / 0.35);
      dy = 0.05 * b;
      sy = 1 - 0.14 * b;
      sx = 1 + 0.04 * b;
      angle = 3 * b;
      break;
    }
    case "shiver": {
      dx = 0.012 * Math.sin((TAU * t) / 70) + 0.006 * Math.sin((TAU * t) / 43);
      angle = 1.5 * Math.sin((TAU * t) / 90);
      sx = 0.97;
      sy = 0.97;
      effects.cold = env;
      break;
    }
    case "sleep": {
      const sway = Math.sin((TAU * t) / 3200);
      const breath = 0.5 - 0.5 * Math.cos((TAU * t) / 3200);
      angle = 4 * sway;
      dy = 0.02;
      sx = 1 + 0.02 * breath;
      sy = 1 - 0.02 * breath;
      effects.zs = env;
      break;
    }
    case "love": {
      const k = (t % 1000) / 1000; // lub-dub once a second
      const pulse = bump(k, 0.05, 0.09) + 0.7 * bump(k, 0.27, 0.09);
      sx = sy = 1 + 0.07 * pulse;
      pivot = 0.55;
      effects.hearts = env;
      break;
    }
    case "look": {
      // Left, a pause, right, a pause, back to the middle, leaning into each look.
      const p = t / durMs;
      const pos = p < 0.15 ? -easeInOut(p / 0.15) : p < 0.4 ? -1 : p < 0.6 ? -1 + 2 * easeInOut((p - 0.4) / 0.2)
        : p < 0.85 ? 1 : 1 - easeInOut((p - 0.85) / 0.15);
      dx = 0.07 * pos;
      angle = 5 * pos;
      break;
    }
    case "wave": {
      angle = 3 * Math.sin((TAU * t) / 1200);
      dy = -0.012 * (0.5 - 0.5 * Math.cos((TAU * t) / 600));
      break;
    }
    default:
      return base;
  }
  const k = env * intensity;
  return {
    ...base,
    dx: dx * k, dy: dy * k, angle: angle * k,
    sx: 1 + (sx - 1) * k, sy: 1 + (sy - 1) * k,
    pivot,
  };
}

// The tilt of "Muse folgt mir" while a motion of `weight` (its envelope) runs.
export function followDamp(angle, weight) {
  return angle * (1 - FOLLOW_DAMP * clamp01(weight || 0));
}

// The one motion that runs. start() asks for it; sample() returns its pose on the ready
// screen. The clock of a motion starts the first time the ready screen samples it.
export class MotionPlayer {
  constructor() {
    this.current = null; // {name, ms, askedAt, startedAt, intensity, idle}
  }

  // Asks for motion `name` for `seconds` (motionSeconds()); "stop" ends the one running.
  start(name, now, seconds, { intensity = 1, idle = false } = {}) {
    if (name === "stop") {
      this.stop();
      return null;
    }
    const secs = motionSeconds(name, seconds);
    this.current = { name, ms: secs * 1000, askedAt: now, startedAt: null, intensity, idle };
    return { motion: name, seconds: secs };
  }

  stop() {
    this.current = null;
  }

  // Whether a motion runs or waits for the ready screen at `now` (drops what has ended).
  busy(now) {
    const c = this.current;
    if (!c) return false;
    if (c.startedAt === null ? now - c.askedAt > PENDING_MS : now - c.startedAt >= c.ms) {
      this.current = null;
      return false;
    }
    return true;
  }

  // The pose now, or null. `visible`: the plain ready screen shows (status ready, no
  // card); otherwise nothing is drawn and a motion not yet started keeps waiting.
  sample(now, visible, reduced = false) {
    if (!this.busy(now)) return null;
    const c = this.current;
    if (!visible) return null;
    if (c.startedAt === null) c.startedAt = now;
    return motionPose(c.name, now - c.startedAt, c.ms, { intensity: c.intensity, reduced });
  }
}

// The idle variety: due() is asked on every tick; it answers a motion's name when the
// ready screen has been still for a random 30 to 90 s, else null. `random` is injected
// so the tests are deterministic.
export class IdleVariety {
  constructor(random = Math.random) {
    this.random = random;
    this.nextAt = Infinity;
    this.eligible = false;
    this.last = "";
  }

  interval() {
    return IDLE_MIN_MS + this.random() * (IDLE_MAX_MS - IDLE_MIN_MS);
  }

  // `eligible`: the plain ready screen, nothing moving, the setting on.
  due(now, eligible) {
    if (!eligible) {
      this.eligible = false;
      return null;
    }
    if (!this.eligible) { // the ready screen just became still: the pause starts now
      this.eligible = true;
      this.nextAt = now + this.interval();
      return null;
    }
    if (now < this.nextAt) return null;
    // Never the same one twice in a row.
    const choices = IDLE_MOTIONS.filter((m) => m !== this.last);
    const name = choices[Math.min(choices.length - 1, Math.floor(this.random() * choices.length))];
    this.last = name;
    this.nextAt = now + this.interval();
    return name;
  }
}

// ---------------------------------------------------------------- canvas --

// Draws `drawFn` with the figure (x, y, size: its square) moved by pose `p`: turned and
// scaled about its pivot, then shifted. No pose: drawn as it is.
export function withMotionPose(ctx, p, x, y, size, drawFn) {
  if (!p || !(p.weight > 0)) {
    drawFn();
    return;
  }
  const px = x + size / 2, py = y + size * (p.pivot ?? 0.5);
  ctx.save();
  ctx.translate(px + p.dx * size, py + p.dy * size);
  if (p.angle) ctx.rotate((p.angle * Math.PI) / 180);
  if (p.sx !== 1 || p.sy !== 1) ctx.scale(p.sx, p.sy);
  ctx.translate(-px, -py);
  if (p.alpha < 1) ctx.globalAlpha *= p.alpha;
  drawFn();
  ctx.restore();
}

const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
const LIGHTS = [[255, 45, 85], [0, 122, 255], [255, 204, 0], [52, 199, 89]];
const HEART = [255, 45, 85];
const Z_INK = [120, 140, 190];
const COLD = [90, 170, 255];

// Where the pieces of confetti are t ms into a motion, over `area` {x, y, w, h}; scale
// `k` is the figure's size against 280 px. Pure, for the tests and the drawing.
export function confettiPieces(t, area, k = 1, count = 36) {
  const out = [];
  const range = area.h + 40 * k;
  for (let i = 0; i < count; i++) {
    const v = (90 + rnd(i, 22) * 110) * k;
    const travel = (rnd(i, 21) * range + (v * t) / 1000) % range;
    out.push({
      x: area.x + rnd(i, 20) * area.w + 10 * k * Math.sin(t / 400 + rnd(i, 23) * TAU),
      y: area.y - 20 * k + travel,
      spin: t / 260 + rnd(i, 24) * TAU,
      w: (5 + rnd(i, 25) * 6) * k,
      color: PALETTE[i % PALETTE.length],
    });
  }
  return out;
}

// The floating Zs of sleep, t ms in: up to three, rising to the upper right of the head
// at (hx, hy), each growing and fading over 2.4 s. Pure.
export function zPositions(t, hx, hy, size) {
  const out = [];
  for (let i = 0; i < 3; i++) {
    const local = t - i * 800;
    if (local < 0) continue;
    const p = (local % 2400) / 2400;
    out.push({
      x: hx + size * (0.04 + 0.16 * p) + size * 0.02 * Math.sin(p * TAU),
      y: hy - size * 0.28 * p,
      s: size * (0.05 + 0.06 * p),
      alpha: p < 0.2 ? p / 0.2 : 1 - (p - 0.2) / 0.8,
    });
  }
  return out;
}

// The hearts of love, t ms in: six rising from the figure's middle, swaying. Pure.
export function heartPositions(t, cx, cy, size) {
  const out = [];
  for (let i = 0; i < 6; i++) {
    const p = ((t + rnd(i, 31) * 2000) % 2000) / 2000;
    out.push({
      x: cx + (rnd(i, 32) - 0.5) * size * 0.9 + size * 0.04 * Math.sin(p * TAU * 1.5 + i),
      y: cy + size * 0.15 - size * 0.55 * p,
      s: size * (0.035 + 0.025 * rnd(i, 33)) * (0.6 + 0.4 * Math.sin(Math.PI * p)),
      alpha: Math.sin(Math.PI * p),
    });
  }
  return out;
}

function heartPath(ctx, x, y, s) {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.9);
  ctx.bezierCurveTo(x - s * 1.6, y - s * 0.1, x - s * 0.8, y - s * 1.2, x, y - s * 0.4);
  ctx.bezierCurveTo(x + s * 0.8, y - s * 1.2, x + s * 1.6, y - s * 0.1, x, y + s * 0.9);
  ctx.closePath();
}

// Draws the effects of pose `p` for the figure at (x, y, size), over `area` {x, y, w, h}
// (the content below the top bar). Call it after the figure: the figure's opaque square
// would hide anything drawn before it.
export function drawMotionEffects(ctx, p, x, y, size, area) {
  if (!p || !p.effects || !(p.weight > 0)) return;
  const e = p.effects;
  const t = p.t || 0;
  const k = size / 280;
  const base = ctx.globalAlpha;
  ctx.save();
  if (e.lights > 0 && typeof ctx.createRadialGradient === "function") {
    // Disco light: soft coloured spots sweeping over the screen.
    for (let i = 0; i < LIGHTS.length; i++) {
      const cx = area.x + area.w * (0.5 + 0.42 * Math.sin(t / 700 + i * 1.7));
      const cy = area.y + area.h * (0.4 + 0.25 * Math.sin(t / 1100 + i * 2.3));
      const r = area.w * 0.32;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      if (!g || typeof g.addColorStop !== "function") break;
      g.addColorStop(0, rgba(LIGHTS[i], 0.22 * e.lights));
      g.addColorStop(1, rgba(LIGHTS[i], 0));
      ctx.fillStyle = g;
      ctx.fillRect(area.x, area.y, area.w, area.h);
    }
  }
  if (e.confetti > 0) {
    ctx.globalAlpha = base * e.confetti;
    for (const q of confettiPieces(t, area, k)) {
      ctx.save();
      ctx.translate(q.x, q.y);
      ctx.rotate(q.spin);
      ctx.fillStyle = rgba(q.color, 1);
      ctx.fillRect(-q.w / 2, -4 * k, q.w, 8 * k * Math.abs(Math.cos(q.spin)) + 2 * k);
      ctx.restore();
    }
    ctx.globalAlpha = base;
  }
  if (e.hearts > 0) {
    for (const h of heartPositions(t, x + size / 2, y + size / 2, size)) {
      ctx.fillStyle = rgba(HEART, h.alpha * e.hearts);
      heartPath(ctx, h.x, h.y, h.s);
      ctx.fill();
    }
  }
  if (e.zs > 0) {
    // A Z drawn as three strokes, never a character: the fonts need no glyph for it.
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const z of zPositions(t, x + size * 0.62, y + size * 0.3, size)) {
      ctx.strokeStyle = rgba(Z_INK, z.alpha * e.zs);
      ctx.lineWidth = Math.max(1.5, z.s * 0.2);
      ctx.beginPath();
      ctx.moveTo(z.x - z.s / 2, z.y - z.s / 2);
      ctx.lineTo(z.x + z.s / 2, z.y - z.s / 2);
      ctx.lineTo(z.x - z.s / 2, z.y + z.s / 2);
      ctx.lineTo(z.x + z.s / 2, z.y + z.s / 2);
      ctx.stroke();
    }
  }
  if (e.cold > 0) {
    // Short cold marks left and right of the figure, flickering.
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(1.5, 3 * k);
    for (let i = 0; i < 6; i++) {
      const side = i < 3 ? -1 : 1;
      const row = i % 3;
      const flick = 0.5 + 0.5 * Math.sin(t / 90 + i * 1.3);
      const bx = x + size / 2 + side * size * (0.36 + 0.03 * flick);
      const by = y + size * (0.42 + 0.12 * row);
      ctx.strokeStyle = rgba(COLD, (0.35 + 0.5 * flick) * e.cold);
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + side * size * 0.06, by - size * 0.02);
      ctx.stroke();
    }
  }
  ctx.restore();
  ctx.globalAlpha = base;
}
