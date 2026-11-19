// gestures.js: "Muse macht meine Bewegungen nach (Beta)", Muse answers what the person in
// front of the camera does with the matching move of motion.js. This module is the pure
// part: MediaPipe pose landmarks in (the same PoseLandmarker frames follow.js gets, about
// 12 a second), a recognised gesture out. No DOM and no MediaPipe in here, so the Node
// tests run it on synthetic landmark sequences; camera.js feeds it and display.js plays
// the move (display.gesture()).
//
// What is recognised (gesture -> motion), all measured in shoulder widths (S) of a short,
// lightly smoothed landmark history (6.5 s), so distance to the camera does not matter:
//  * dance  -> dance: a rhythmic vertical bounce (legs of >= 0.12 S, 1.2 to 3.5 Hz) or a
//    sideways sway (legs of >= 0.15 S, 0.6 to 3.5 Hz) over the last 3 s, regular (the
//    half periods vary by less than 50 %), staying on the spot (drift < 0.8 S/s).
//  * party  -> party: the same with both wrists above the head in 60 % of the frames.
//  * jump   -> jump: shoulders rise >= 0.375 S above the level before and after and fall
//    back to it within 0.8 s; hips (or the nose) rise with them.
//  * spin   -> spin: frontal (face seen, full shoulder width), then turned away (width
//    <= 0.5 S or the face gone while the body stays) for 0.15 to 2.5 s, then frontal
//    again at the same place.
//  * bow    -> bow: shoulders drop >= 0.33 S below their level of 1 to 3.5 s ago and the
//    nose comes down to the shoulder line (its height above them falls under about half),
//    while the hips (when seen) stay; held for 0.3 s.
//  * cheer  -> celebrate: both wrists above the head, apart (>= 0.6 S), held 0.8 s
//    without bouncing (with a bounce it becomes a party).
//  * heart  -> love: both wrists together (<= 0.45 S) at the chest or above the head,
//    held 0.6 s.
//  * hug    -> shiver: arms crossed or hugging oneself (each wrist past the body's middle
//    towards the other shoulder), held 1 s.
//  * wave   -> wave: one hand above its shoulder moving side to side (3 legs of >= 0.2 S),
//    or, like the raised-hand wave of follow.js, one hand above the head held for 1 s.
//  * shake  -> shake: the nose left and right of the shoulder midpoint twice (4 legs of
//    >= 0.1 S) while the shoulders stay.
//  * nod    -> nod: the nose down and up against the shoulders twice (4 legs of
//    >= 0.06 S) while the shoulders stay.
//  * still  -> look: standing still for 6 s with the head down (the nose's height above
//    the shoulders under 70 % of its upright value). Optional and rare (45 s cooldown).
//
// Rules: each gesture has a confidence 0..1 and a threshold (GESTURES). The highest
// priority gesture over its threshold wins (the order of GESTURES); while it is in its
// own cooldown it still holds the floor, so a dance in progress never lets its bounces
// pass as jumps. A gesture fires at most once per its cooldown (4 to 6 s, look 45 s), and
// any two at least 2 s apart.
//
// Pitfalls:
//  * observe() returns a candidate but never commits it: the caller plays the move only
//    on the plain ready screen and then calls fired(). A gesture seen while a card or a
//    status pose shows is dropped, without using up its cooldown.
//  * The scale S is the median shoulder width of the frames with the face seen, not the
//    current width: during a turn the width collapses and must not blow up the units.
//  * Pose noise is a few pixels (about 0.01 S at a normal distance); every amplitude here
//    is at least five times that, and the landmarks are smoothed with a 50 ms time
//    constant, so the swing counter does not count jitter.
//  * Walking past moves the whole body sideways at 1.5 S/s or more and is rejected by the
//    drift limit; sitting down lowers shoulders and hips together with the head upright,
//    which is neither a bow nor a jump.
//  * Nobody seen for 0.7 s clears the history. Shorter gaps are skipped.
//  * MediaPipe's `visibility` is missing in some builds; a missing value counts as seen.

import { smoothTo } from "./follow.js";

// BlazePose landmark indices used here.
export const GLM = Object.freeze({
  nose: 0, leftEye: 2, rightEye: 5, leftShoulder: 11, rightShoulder: 12,
  leftWrist: 15, rightWrist: 16, leftHip: 23, rightHip: 24,
});
const USED = Object.values(GLM);
const VISIBLE = 0.5;

// Gesture -> motion, threshold and cooldown, in priority order (first wins).
export const GESTURES = Object.freeze({
  party: Object.freeze({ motion: "party", threshold: 0.5, cooldownMs: 6000 }),
  dance: Object.freeze({ motion: "dance", threshold: 0.5, cooldownMs: 6000 }),
  jump: Object.freeze({ motion: "jump", threshold: 0.5, cooldownMs: 4000 }),
  spin: Object.freeze({ motion: "spin", threshold: 0.6, cooldownMs: 5000 }),
  bow: Object.freeze({ motion: "bow", threshold: 0.6, cooldownMs: 5000 }),
  cheer: Object.freeze({ motion: "celebrate", threshold: 0.8, cooldownMs: 5000 }),
  heart: Object.freeze({ motion: "love", threshold: 0.8, cooldownMs: 5000 }),
  hug: Object.freeze({ motion: "shiver", threshold: 0.8, cooldownMs: 6000 }),
  wave: Object.freeze({ motion: "wave", threshold: 0.6, cooldownMs: 5000 }),
  shake: Object.freeze({ motion: "shake", threshold: 0.6, cooldownMs: 4000 }),
  nod: Object.freeze({ motion: "nod", threshold: 0.6, cooldownMs: 4000 }),
  still: Object.freeze({ motion: "look", threshold: 0.6, cooldownMs: 45000 }),
});
export const PRIORITY = Object.keys(GESTURES);

export const GESTURE = Object.freeze({
  historyMs: 6500,
  lostMs: 700,
  smoothTauMs: 50,
  globalCooldownMs: 2000,
  uprightUpTauMs: 500, // the upright head height follows a raised head fast ...
  uprightDownTauMs: 60000, // ... and a lowered one very slowly
});

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const seen = (p) => !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && (p.visibility === undefined || p.visibility >= VISIBLE);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function median(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// Values minus their least-squares line over time `ts`.
export function detrend(ts, vs) {
  const n = vs.length;
  if (n < 2) return vs.map(() => 0);
  let st = 0, sv = 0;
  for (let i = 0; i < n; i++) { st += ts[i]; sv += vs[i]; }
  const mt = st / n, mv = sv / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (ts[i] - mt) * (vs[i] - mv); den += (ts[i] - mt) ** 2; }
  const k = den > 0 ? num / den : 0;
  return vs.map((v, i) => v - (mv + k * (ts[i] - mt)));
}

// The slope of `vs` over `ts` (units per ms).
export function slope(ts, vs) {
  const n = vs.length;
  if (n < 2) return 0;
  const mt = ts.reduce((a, b) => a + b, 0) / n, mv = vs.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (ts[i] - mt) * (vs[i] - mv); den += (ts[i] - mt) ** 2; }
  return den > 0 ? num / den : 0;
}

// The turning points of a signal with hysteresis `amp`: the indices of the extremes
// between legs that moved at least `amp`. Its length is the number of such legs (the
// running leg counts once it has moved `amp`), so two nods (down, up, down, up) give 4.
export function swings(vs, amp) {
  const turns = [];
  if (vs.length < 2) return turns;
  let dir = 0, ext = vs[0], extI = 0, hi = vs[0], hiI = 0, lo = vs[0], loI = 0;
  for (let i = 1; i < vs.length; i++) {
    const v = vs[i];
    if (dir === 0) {
      if (v > hi) { hi = v; hiI = i; }
      if (v < lo) { lo = v; loI = i; }
      if (hi - lo >= amp) {
        if (hiI > loI) { dir = 1; turns.push(loI); ext = hi; extI = hiI; } else { dir = -1; turns.push(hiI); ext = lo; extI = loI; }
      }
    } else if (dir === 1) {
      if (v > ext) { ext = v; extI = i; } else if (ext - v >= amp) { turns.push(extI); dir = -1; ext = v; extI = i; }
    } else if (v < ext) { ext = v; extI = i; } else if (v - ext >= amp) { turns.push(extI); dir = 1; ext = v; extI = i; }
  }
  return turns;
}

// Rhythm of turning points at times `ts`: frequency in Hz and the variation of the half
// periods (coefficient of variation), or null with fewer than 3 turns.
export function rhythm(turns, ts) {
  if (turns.length < 3) return null;
  const halves = [];
  for (let i = 1; i < turns.length; i++) halves.push(ts[turns[i]] - ts[turns[i - 1]]);
  const mean = halves.reduce((a, b) => a + b, 0) / halves.length;
  if (!(mean > 0)) return null;
  const sd = Math.sqrt(halves.reduce((a, h) => a + (h - mean) ** 2, 0) / halves.length);
  return { hz: 1000 / (2 * mean), cv: sd / mean };
}

// One pose frame in screen terms (mirrored for the front camera), or null when the
// shoulders, the scale of everything, are not both seen.
export function frameOf(landmarks, t, mirrored = true) {
  if (!Array.isArray(landmarks) || landmarks.length < 25) return null;
  const pick = (i) => {
    const p = landmarks[i];
    return seen(p) ? { x: mirrored ? 1 - p.x : p.x, y: p.y } : null;
  };
  const ls = pick(GLM.leftShoulder), rs = pick(GLM.rightShoulder);
  if (!ls || !rs) return null;
  const nose = pick(GLM.nose), le = pick(GLM.leftEye), re = pick(GLM.rightEye);
  const lh = pick(GLM.leftHip), rh = pick(GLM.rightHip);
  const mid = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
  return {
    t, ls, rs, mid, w: dist(ls, rs), nose, face: !!(nose && le && re),
    lw: pick(GLM.leftWrist), rw: pick(GLM.rightWrist),
    hip: lh && rh ? { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 } : null,
  };
}

// The nose's height above the shoulder line, in S (positive when the head is up).
const headUp = (f, S) => (f.nose ? (f.mid.y - f.nose.y) / S : NaN);

// Both wrists above the head: above the nose, or 0.7 S above the shoulders without one.
function armsUp(f, S) {
  if (!f.lw || !f.rw) return false;
  const top = f.nose ? Math.min(f.nose.y, f.mid.y - 0.5 * S) : f.mid.y - 0.7 * S;
  return f.lw.y < top && f.rw.y < top;
}

// Arms crossed or hugging oneself: each wrist past the middle towards the other shoulder.
function crossed(f, S) {
  if (!f.lw || !f.rw) return false;
  const ux = (f.ls.x - f.rs.x) / f.w, uy = (f.ls.y - f.rs.y) / f.w; // towards the left shoulder
  const along = (p) => ((p.x - f.mid.x) * ux + (p.y - f.mid.y) * uy) / S;
  const height = (p) => (p.y - f.mid.y) / S;
  const chest = (p) => height(p) > -0.2 && height(p) < 1.3;
  return along(f.lw) < -0.1 && along(f.rw) > 0.1 && chest(f.lw) && chest(f.rw);
}

const since = (frames, now, ms) => frames.filter((f) => f.t >= now - ms);
const share = (frames, test) => (frames.length ? frames.filter(test).length / frames.length : 0);
const span = (frames) => (frames.length ? frames[frames.length - 1].t - frames[0].t : 0);

// ------------------------------------------------------------- detectors --
// Each takes the history (oldest first), now and the scale S and answers a confidence.

export function detectDance(frames, now, S) {
  const win = since(frames, now, 3000);
  if (win.length < 20 || span(win) < 2200) return { dance: 0, party: 0 };
  const ts = win.map((f) => f.t);
  const xs = win.map((f) => f.mid.x / S), ys = win.map((f) => f.mid.y / S);
  // Walking past or towards the camera is no dance.
  if (Math.abs(slope(ts, xs)) * 1000 > 0.8) return { dance: 0, party: 0 };
  const widths = win.map((f) => f.w);
  if (Math.min(...widths) / Math.max(...widths) < 0.6) return { dance: 0, party: 0 };
  const score = (vs, amp, lo, hi, full) => {
    const turns = swings(detrend(ts, vs), amp);
    const r = rhythm(turns, ts);
    if (!r || r.hz < lo || r.hz > hi) return 0;
    const regular = clamp01((0.5 - r.cv) / 0.2);
    return clamp01((turns.length - 3) / (full - 3)) * regular;
  };
  const bounce = score(ys, 0.12, 1.2, 3.5, 8);
  const sway = score(xs, 0.15, 0.6, 3.5, 6);
  const conf = Math.max(bounce, sway);
  const up = share(win, (f) => armsUp(f, S)) >= 0.6;
  return { dance: up ? 0 : conf, party: up ? conf : 0 };
}

export function detectJump(frames, now, S) {
  const win = since(frames, now, 1500);
  if (win.length < 6) return 0;
  let p = 0;
  for (let i = 1; i < win.length; i++) if (win[i].mid.y < win[p].mid.y) p = i;
  if (p === 0 || p > win.length - 3) return 0; // it has to come down again
  const peak = win[p];
  const pre = win.slice(0, p).filter((f) => f.t >= peak.t - 900);
  const post = win.slice(p + 1);
  if (!pre.length) return 0;
  const preG = pre.reduce((a, f) => (f.mid.y > a.mid.y ? f : a));
  const postG = post.reduce((a, f) => (f.mid.y > a.mid.y ? f : a));
  const risePre = (preG.mid.y - peak.mid.y) / S, risePost = (postG.mid.y - peak.mid.y) / S;
  if (Math.abs(preG.mid.y - postG.mid.y) / S > 0.3) return 0; // back to the same level
  const half = peak.mid.y + 0.5 * (preG.mid.y - peak.mid.y);
  const air = win.filter((f) => f.mid.y < half);
  if (span(air) > 800) return 0;
  // The whole body rises: the hips, or without them the nose.
  const second = (f) => (peak.hip && f.hip ? f.hip.y : peak.nose && f.nose ? f.nose.y : NaN);
  const sPeak = peak.hip && preG.hip ? peak.hip.y : peak.nose && preG.nose ? peak.nose.y : NaN;
  const sRise = (second(preG) - sPeak) / S;
  if (Number.isFinite(sRise) && sRise < 0.5 * risePre) return 0;
  const wr = peak.w / preG.w;
  if (wr < 0.8 || wr > 1.25) return 0;
  return clamp01((Math.min(risePre, risePost) - 0.15) / 0.45);
}

export function detectSpin(frames, now, S) {
  const win = since(frames, now, 3500);
  if (win.length < 4) return 0;
  const frontal = (f) => f.face && f.w >= 0.75 * S;
  const turned = (f) => f.w <= 0.5 * S || !f.face;
  const last = win[win.length - 1];
  if (!frontal(last)) return 0;
  let i = win.length - 2;
  while (i >= 0 && frontal(win[i])) i--;
  const end = i;
  while (i >= 0 && !frontal(win[i])) i--;
  const start = i + 1;
  if (end < 0 || i < 0) return 0; // no turn, or no frontal frame before it
  const turn = win.slice(start, end + 1).filter(turned);
  if (!turn.length) return 0;
  const dur = turn[turn.length - 1].t - turn[0].t;
  if (dur < 150 || dur > 2500) return 0;
  if (Math.abs(last.mid.x - win[i].mid.x) / S > 1) return 0; // turned on the spot
  const collapsed = Math.min(...turn.map((f) => f.w)) <= 0.5 * S;
  const faceGone = turn.filter((f) => !f.face).length;
  if (!collapsed && faceGone < 3) return 0;
  if (collapsed) return faceGone >= 2 ? 1 : 0.8;
  return 0.65; // only the face went away, the width stayed
}

export function detectBow(frames, now, S) {
  const base = frames.filter((f) => f.t >= now - 3500 && f.t <= now - 1000);
  const cur = since(frames, now, 400);
  if (base.length < 5 || cur.length < 3 || span(cur) < 240) return 0;
  const baseY = median(base.map((f) => f.mid.y));
  const baseHead = median(base.map((f) => headUp(f, S)));
  if (!(baseHead > 0.2)) return 0;
  const baseHips = base.filter((f) => f.hip);
  const baseHip = baseHips.length >= 3 ? median(baseHips.map((f) => f.hip.y)) : NaN;
  let conf = 1;
  for (const f of cur) {
    if (!f.nose) return 0;
    if (Number.isFinite(baseHip) && f.hip && Math.abs(f.hip.y - baseHip) / S > 0.25) return 0; // sat down
    const drop = (f.mid.y - baseY) / S;
    const ratio = headUp(f, S) / baseHead;
    conf = Math.min(conf, clamp01((drop - 0.15) / 0.3), clamp01((0.75 - ratio) / 0.45));
  }
  return conf;
}

function held(frames, now, ms, test) {
  const win = since(frames, now, ms + 100);
  if (span(win) < ms - 100) return 0;
  return share(win, test);
}

export function detectCheer(frames, now, S) {
  // Arms up while bouncing is a party, not a cheer: the body has to stay up there.
  if (swings(since(frames, now, 900).map((f) => f.mid.y / S), 0.12).length > 1) return 0;
  return held(frames, now, 800, (f) => armsUp(f, S) && dist(f.lw, f.rw) >= 0.6 * S);
}

export function detectHeart(frames, now, S) {
  return held(frames, now, 600, (f) => {
    if (!f.lw || !f.rw || dist(f.lw, f.rw) > 0.45 * S || crossed(f, S)) return false;
    const c = { x: (f.lw.x + f.rw.x) / 2, y: (f.lw.y + f.rw.y) / 2 };
    const h = (c.y - f.mid.y) / S, off = Math.abs(c.x - f.mid.x) / S;
    const chest = h > -0.2 && h < 0.9 && off <= 0.5;
    const top = (f.nose ? f.nose.y : f.mid.y - 0.7 * S) - 0.1 * S;
    const overhead = c.y < top && off <= 0.8;
    return chest || overhead;
  });
}

export function detectHug(frames, now, S) {
  return held(frames, now, 1000, (f) => crossed(f, S));
}

export function detectWave(frames, now, S) {
  const win = since(frames, now, 2000);
  let best = 0;
  for (const side of ["l", "r"]) {
    const wrist = (f) => f[side + "w"];
    const shoulder = (f) => f[side + "s"];
    const other = (f) => f[(side === "l" ? "r" : "l") + "w"];
    const up = (f) => wrist(f) && wrist(f).y < shoulder(f).y - 0.3 * S && !(other(f) && other(f).y < f.mid.y - 0.3 * S);
    // The run of frames up to now with this hand up (one miss allowed).
    const run = [];
    let misses = 0;
    for (let i = win.length - 1; i >= 0; i--) {
      if (up(win[i])) run.unshift(win[i]);
      else if (++misses > 1) break;
    }
    if (span(run) < 600) continue;
    const xs = run.map((f) => (wrist(f).x - f.mid.x) / S);
    const legs = swings(xs, 0.2).length;
    if (legs >= 3) best = Math.max(best, clamp01(0.5 + 0.17 * (legs - 2)));
    else if (span(run) >= 1000 && share(run, (f) => f.nose && wrist(f).y < f.nose.y) >= 0.9) best = Math.max(best, 0.6);
  }
  return best;
}

// Nod and shake: the head against the shoulders, which themselves stay.
export function detectHead(frames, now, S) {
  const win = since(frames, now, 1800).filter((f) => f.nose);
  if (win.length < 8) return { nod: 0, shake: 0 };
  const ts = win.map((f) => f.t);
  if (swings(win.map((f) => f.mid.y / S), 0.12).length > 1 || swings(win.map((f) => f.mid.x / S), 0.15).length > 1) {
    return { nod: 0, shake: 0 };
  }
  const ds = win.map((f) => headUp(f, S));
  const es = win.map((f) => (f.nose.x - f.mid.x) / S);
  const head = (vs, amp) => {
    const turns = swings(vs, amp);
    const r = rhythm(turns, ts);
    if (turns.length < 4 || !r || r.hz < 0.7 || r.hz > 4.5) return 0;
    return clamp01(0.5 + 0.125 * (turns.length - 3));
  };
  const range = (vs) => Math.max(...vs) - Math.min(...vs);
  let nod = head(ds, 0.06), shake = head(es, 0.1);
  if (nod && shake) {
    if (range(ds) / 0.06 >= range(es) / 0.1) shake = 0;
    else nod = 0;
  }
  return { nod, shake };
}

export function detectStill(frames, now, S, upright) {
  const win = since(frames, now, 6000);
  if (span(win) < 5800 || !(upright > 0.2)) return 0;
  const sd = (vs) => {
    const m = vs.reduce((a, b) => a + b, 0) / vs.length;
    return Math.sqrt(vs.reduce((a, v) => a + (v - m) ** 2, 0) / vs.length);
  };
  if (sd(win.map((f) => f.mid.x / S)) > 0.06 || sd(win.map((f) => f.mid.y / S)) > 0.06) return 0;
  return share(win, (f) => headUp(f, S) < 0.7 * upright) >= 0.9 ? 0.7 : 0;
}

// Every gesture's confidence for the history `frames` at `now`.
export function classify(frames, now, upright = NaN) {
  const out = Object.fromEntries(PRIORITY.map((g) => [g, 0]));
  if (frames.length < 2) return out;
  const fw = frames.filter((f) => f.face).map((f) => f.w);
  const S = median(fw.length >= 3 ? fw : frames.map((f) => f.w));
  if (!(S > 0.01)) return out;
  Object.assign(out, detectDance(frames, now, S), detectHead(frames, now, S));
  out.jump = detectJump(frames, now, S);
  out.spin = detectSpin(frames, now, S);
  out.bow = detectBow(frames, now, S);
  out.cheer = detectCheer(frames, now, S);
  out.heart = detectHeart(frames, now, S);
  out.hug = detectHug(frames, now, S);
  out.wave = detectWave(frames, now, S);
  out.still = detectStill(frames, now, S, upright);
  return out;
}

// The recogniser: observe() with each pose result; fired() when the move was played.
export class GestureRecognizer {
  constructor() {
    this.reset();
  }

  reset() {
    this.frames = [];
    this.smooth = new Map(); // landmark index -> {x, y}
    this.lastT = null;
    this.lastSeen = -Infinity;
    this.upright = NaN;
    this.lastFired = -Infinity;
    this.firedAt = {};
    this.present = false;
    this.scores = null;
  }

  // Landmarks smoothed per landmark over time (a landmark that was not seen restarts).
  smoothed(landmarks, now) {
    const dt = this.lastT === null ? 0 : Math.max(0, Math.min(500, now - this.lastT));
    this.lastT = now;
    const out = landmarks.slice();
    for (const i of USED) {
      const p = landmarks[i];
      if (!seen(p)) {
        this.smooth.delete(i);
        continue;
      }
      const prev = this.smooth.get(i);
      const s = prev
        ? { x: smoothTo(prev.x, p.x, dt, GESTURE.smoothTauMs), y: smoothTo(prev.y, p.y, dt, GESTURE.smoothTauMs) }
        : { x: p.x, y: p.y };
      this.smooth.set(i, s);
      out[i] = { ...p, x: s.x, y: s.y };
    }
    return out;
  }

  // One pose result (the first person's landmarks, or null for nobody) at `now` ms.
  // Returns the gesture to play, {name, motion, confidence}, or null. Nothing is
  // committed: call fired(name, now) once the move really plays.
  observe(landmarks, now, mirrored = true) {
    const f = Array.isArray(landmarks) ? frameOf(this.smoothed(landmarks, now), now, mirrored) : null;
    if (!f) {
      if (now - this.lastSeen > GESTURE.lostMs) {
        this.frames = [];
        this.smooth.clear();
        this.present = false;
      }
      return null;
    }
    this.lastSeen = now;
    this.present = true;
    this.frames.push(f);
    while (this.frames.length && this.frames[0].t < now - GESTURE.historyMs) this.frames.shift();
    const S = median(this.frames.filter((q) => q.face).map((q) => q.w));
    const d = f.nose && S > 0 ? headUp(f, S) : NaN;
    if (Number.isFinite(d)) {
      const dt = this.frames.length > 1 ? now - this.frames[this.frames.length - 2].t : 0;
      if (!Number.isFinite(this.upright)) this.upright = d;
      else this.upright = smoothTo(this.upright, d, dt, d > this.upright ? GESTURE.uprightUpTauMs : GESTURE.uprightDownTauMs);
    }
    this.scores = classify(this.frames, now, this.upright);
    return this.pick(this.scores, now);
  }

  // The gesture of `scores` to play now, by priority and the cooldowns.
  pick(scores, now) {
    if (now - this.lastFired < GESTURE.globalCooldownMs) return null;
    for (const name of PRIORITY) {
      const g = GESTURES[name];
      const c = scores[name] || 0;
      if (c < g.threshold) continue;
      // The strongest gesture holds the floor while it cools down.
      if (now - (this.firedAt[name] ?? -Infinity) < g.cooldownMs) return null;
      return { name, motion: g.motion, confidence: Math.round(c * 100) / 100 };
    }
    return null;
  }

  fired(name, now) {
    this.firedAt[name] = now;
    this.lastFired = now;
  }
}
