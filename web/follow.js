// follow.js: "Muse folgt mir (Beta)", the figure moves like the person in front of the
// camera. This module is the pure part: MediaPipe pose landmarks in, a smoothed figure
// motion out (a horizontal and vertical offset, a tilt, a slight scale and a wave). No
// DOM and no MediaPipe in here, so the Node tests run it; camera.js feeds it landmarks
// from PoseLandmarker and the renderers (square.js for Mosaico and Tab/iPad, cards.js
// for the box layout of the Mac app) sample it on every frame.
//
// What moves when (all in the mirrored picture for the front camera, so it behaves like
// a mirror):
//  * The person's shoulder midpoint left or right of the picture's centre shifts the
//    figure the same way, up to 18 % of the figure's size.
//  * Shoulders and head tilted (the shoulder line and the eye line) tilt the figure the
//    same way, up to 10 degrees.
//  * A jump or a crouch (the shoulders above or below their slow baseline, measured in
//    shoulder widths) lifts or lowers the figure a little.
//  * Coming closer or stepping back (shoulder width against its baseline) scales the
//    figure between 0.94 and 1.08.
//  * A wrist above the nose for two pose frames in a row plays the wave animation, for at
//    least 1.5 s and as long as the hand stays up; only on the plain ready screen.
//
// Pitfalls:
//  * Landmarks arrive at about 12 a second, the figure is drawn at up to 60: observe()
//    only sets targets, sample() moves the shown values towards them with a time-based
//    exponential smoothing, so the motion is smooth at every frame rate and the same at
//    10 and at 60 pictures a second.
//  * Pose noise is a few pixels even when the person stands still. Dead zones around the
//    neutral position (8 % of the half width, 3 degrees, 12 % of a shoulder width for the
//    height, 6 % for the size) keep the figure still until the person really moves.
//  * The vertical and size baselines follow slowly (4 s), so a person sitting lower or
//    nearer than the first frame does not leave the figure pushed for good.
//  * Nobody seen for 0.7 s: every target goes back to neutral and the wave stops; when
//    the shown values are back at neutral the tracker reports inactive, so square.js
//    stops redrawing a still screen again.
//  * MediaPipe's landmark `visibility` is missing in some builds; a missing value counts
//    as visible.

export const POSE_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
export const FOLLOW_MS = 80; // pose frames about 12 a second

// BlazePose landmark indices.
export const LM = {
  nose: 0, leftEye: 2, rightEye: 5, leftShoulder: 11, rightShoulder: 12, leftWrist: 15, rightWrist: 16,
};

const VISIBLE = 0.5;
const DEG = 180 / Math.PI;

export const FOLLOW = Object.freeze({
  deadX: 0.08, // of the half width
  deadAngle: 3, // degrees
  deadY: 0.12, // shoulder widths
  deadSize: 0.06, // relative
  maxAngle: 10, // degrees of the figure
  angleGain: 0.8,
  yGain: 2, // a jump of 0.5 + dead zone shoulder widths reaches the full lift
  sizeGain: 0.5,
  minScale: 0.94,
  maxScale: 1.08,
  tauMs: 180, // smoothing of offset and tilt
  scaleTauMs: 320,
  baseTauMs: 4000, // the slow baseline of height and size
  lostMs: 700,
  waveFrames: 2,
  waveHoldMs: 1500,
  shiftOfSize: 0.18, // the full horizontal shift in figure sizes
  liftOfSize: 0.08, // the full vertical shift in figure sizes
});

export const NEUTRAL = Object.freeze({ active: false, present: false, dx: 0, dy: 0, angle: 0, scale: 1, wave: false });

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function seen(p) {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && (p.visibility === undefined || p.visibility >= VISIBLE);
}

// A soft dead zone: 0 inside +-dz, then linear from 0 (no jump at the edge).
export function deadZone(v, dz) {
  const a = Math.abs(v);
  return a <= dz ? 0 : Math.sign(v) * (a - dz);
}

// One step of exponential smoothing over dt ms with time constant tau.
export function smoothTo(prev, target, dtMs, tauMs) {
  if (!(dtMs > 0)) return prev;
  if (!(tauMs > 0)) return target;
  return prev + (target - prev) * (1 - Math.exp(-dtMs / tauMs));
}

// The angle of the line through two points, in degrees, ordered left to right on screen,
// so a line whose right end is lower is positive (clockwise, as canvas rotate()).
function lineAngle(a, b) {
  const [l, r] = a.x <= b.x ? [a, b] : [b, a];
  return Math.atan2(r.y - l.y, r.x - l.x) * DEG;
}

// Landmarks (normalised 0..1, image coordinates) to the pose signal in screen terms, or
// null when no body is usable. `mirrored`: the front camera, shown mirrored.
//   x: shoulder midpoint (or nose) from -1 (left edge) to 1 (right edge)
//   y: the same point's height, 0 top to 1 bottom
//   size: shoulder width (0 when the shoulders are not both seen)
//   roll: tilt in degrees, shoulders and eyes averaged
//   handUp: a wrist above the nose (or well above the shoulders)
export function poseSignal(landmarks, mirrored = true) {
  if (!Array.isArray(landmarks) || landmarks.length < 17) return null;
  const pick = (i) => {
    const p = landmarks[i];
    if (!seen(p)) return null;
    return { x: mirrored ? 1 - p.x : p.x, y: p.y };
  };
  const nose = pick(LM.nose);
  const ls = pick(LM.leftShoulder);
  const rs = pick(LM.rightShoulder);
  const le = pick(LM.leftEye);
  const re = pick(LM.rightEye);
  const shoulders = ls && rs;
  if (!shoulders && !nose) return null;
  const mid = shoulders ? { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 } : nose;
  const size = shoulders ? Math.hypot(rs.x - ls.x, rs.y - ls.y) : 0;
  const rolls = [];
  if (shoulders && size > 0.02) rolls.push(lineAngle(ls, rs));
  if (le && re && Math.abs(re.x - le.x) > 0.005) rolls.push(lineAngle(le, re));
  const roll = rolls.length ? rolls.reduce((a, b) => a + b, 0) / rolls.length : 0;
  let handUp = false;
  for (const w of [pick(LM.leftWrist), pick(LM.rightWrist)]) {
    if (!w) continue;
    if (nose && w.y < nose.y) handUp = true;
    else if (!nose && shoulders && w.y < mid.y - 0.6 * size) handUp = true;
  }
  return { x: clamp((mid.x - 0.5) * 2, -1, 1), y: mid.y, size, roll, handUp };
}

// The pose's figure targets, given the slow baselines of height and size.
export function targetsFor(sig, baseY, baseSize) {
  const f = FOLLOW;
  const dx = clamp(deadZone(sig.x, f.deadX) / (1 - f.deadX), -1, 1);
  const angle = clamp(deadZone(sig.roll, f.deadAngle) * f.angleGain, -f.maxAngle, f.maxAngle);
  let dy = 0;
  let scale = 1;
  if (sig.size > 0 && baseSize > 0) {
    dy = clamp(deadZone((sig.y - baseY) / baseSize, f.deadY) * f.yGain, -1, 1);
    scale = clamp(1 + deadZone(sig.size / baseSize - 1, f.deadSize) * f.sizeGain, f.minScale, f.maxScale);
  }
  return { dx, dy, angle, scale };
}

// The tracker: observe() with each pose result, sample() on each drawn frame.
export class FollowTracker {
  constructor() {
    this.reset();
  }

  reset() {
    this.target = { dx: 0, dy: 0, angle: 0, scale: 1 };
    this.shown = { dx: 0, dy: 0, angle: 0, scale: 1 };
    this.baseY = null;
    this.baseSize = null;
    this.lastSeen = -Infinity;
    this.lastObserve = null;
    this.lastSample = null;
    this.handFrames = 0;
    this.waveUntil = 0;
    this.present = false;
    this.active = false;
  }

  // The camera stopped: nobody is there any more, at once; the figure glides back.
  release() {
    this.present = false;
    this.handFrames = 0;
    this.waveUntil = 0;
    this.target = { dx: 0, dy: 0, angle: 0, scale: 1 };
    this.baseY = null;
    this.baseSize = null;
    this.lastSeen = -Infinity;
    this.lastObserve = null;
    this.active = !this.atRest();
  }

  // One pose result: the landmarks of the first person, or null for nobody.
  observe(landmarks, now, mirrored = true) {
    const f = FOLLOW;
    const sig = landmarks ? poseSignal(landmarks, mirrored) : null;
    const dt = this.lastObserve === null ? 0 : clamp(now - this.lastObserve, 0, 1000);
    this.lastObserve = now;
    if (!sig) {
      this.handFrames = 0;
      if (now - this.lastSeen > f.lostMs) {
        this.present = false;
        this.waveUntil = 0;
        this.target = { dx: 0, dy: 0, angle: 0, scale: 1 };
        this.baseY = null;
        this.baseSize = null;
      }
      this.active = this.present || !this.atRest();
      return;
    }
    this.lastSeen = now;
    this.present = true;
    if (this.baseY === null || !(this.baseSize > 0)) {
      this.baseY = sig.y;
      this.baseSize = sig.size;
    } else if (sig.size > 0) {
      this.baseY = smoothTo(this.baseY, sig.y, dt, f.baseTauMs);
      this.baseSize = smoothTo(this.baseSize, sig.size, dt, f.baseTauMs);
    }
    this.target = targetsFor(sig, this.baseY, this.baseSize);
    this.handFrames = sig.handUp ? this.handFrames + 1 : 0;
    if (this.handFrames >= f.waveFrames) this.waveUntil = now + f.waveHoldMs;
    this.active = true;
  }

  atRest() {
    const s = this.shown;
    return Math.abs(s.dx) < 0.005 && Math.abs(s.dy) < 0.005 && Math.abs(s.angle) < 0.05 && Math.abs(s.scale - 1) < 0.001;
  }

  // The figure motion now, smoothed towards the targets since the last sample.
  sample(now) {
    const f = FOLLOW;
    const dt = this.lastSample === null ? 0 : clamp(now - this.lastSample, 0, 500);
    this.lastSample = now;
    const s = this.shown;
    const t = this.target;
    s.dx = smoothTo(s.dx, t.dx, dt, f.tauMs);
    s.dy = smoothTo(s.dy, t.dy, dt, f.tauMs);
    s.angle = smoothTo(s.angle, t.angle, dt, f.tauMs);
    s.scale = smoothTo(s.scale, t.scale, dt, f.scaleTauMs);
    const wave = this.present && now < this.waveUntil;
    if (!this.present && this.atRest()) {
      this.shown = { dx: 0, dy: 0, angle: 0, scale: 1 };
      this.active = false;
      return NEUTRAL;
    }
    this.active = true;
    return { active: true, present: this.present, dx: s.dx, dy: s.dy, angle: s.angle, scale: s.scale, wave };
  }
}

// A motion as pixels and radians for a figure of `size` px.
export function figureMotion(motion, size) {
  if (!motion || !motion.active) return null;
  return {
    tx: Math.round(motion.dx * FOLLOW.shiftOfSize * size * 10) / 10,
    ty: Math.round(motion.dy * FOLLOW.liftOfSize * size * 10) / 10,
    angle: (motion.angle * Math.PI) / 180,
    scale: motion.scale,
  };
}

// The animation to play: the wave replaces the plain idle pose while a hand is up; a
// status pose (listening, thinking, speaking) always wins.
export function followPose(pose, motion) {
  return pose === "idle" && motion && motion.wave ? "wave" : pose;
}

// Draws `drawFn` with the figure moved: rotated and scaled about the figure's centre
// (cx, cy), then shifted. `ctx` is a CanvasRenderingContext2D (or a test double).
export function withFigureMotion(ctx, m, cx, cy, drawFn) {
  if (!m) {
    drawFn();
    return;
  }
  ctx.save();
  ctx.translate(cx + m.tx, cy + m.ty);
  if (m.angle) ctx.rotate(m.angle);
  if (m.scale !== 1) ctx.scale(m.scale, m.scale);
  ctx.translate(-cx, -cy);
  drawFn();
  ctx.restore();
}
