import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  deadZone, smoothTo, poseSignal, targetsFor, FollowTracker, figureMotion, followPose, withFigureMotion,
  FOLLOW, NEUTRAL, LM, POSE_MODEL_URL,
} from "../follow.js";
import { DEFAULTS, loadSettings } from "../settings.js";

// A standing person in image coordinates (not mirrored): shoulders 0.2 apart at y 0.6,
// nose at 0.4, wrists down at 0.85. `over` moves single landmarks.
function body({ cx = 0.5, y = 0.6, width = 0.2, tilt = 0, wristY = 0.85, over = {} } = {}) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.1 }));
  const set = (i, x, yy) => { lm[i] = { x, y: yy, visibility: 0.99 }; };
  // Image left is the person's right side; tilt lowers the image-right shoulder.
  set(LM.rightShoulder, cx - width / 2, y - tilt);
  set(LM.leftShoulder, cx + width / 2, y + tilt);
  set(LM.nose, cx, y - 0.2);
  set(LM.rightEye, cx - 0.03, y - 0.22 - tilt / 3);
  set(LM.leftEye, cx + 0.03, y - 0.22 + tilt / 3);
  set(LM.rightWrist, cx - width / 2, wristY);
  set(LM.leftWrist, cx + width / 2, wristY);
  for (const [i, p] of Object.entries(over)) lm[i] = { visibility: 0.99, ...p };
  return lm;
}

// Feeds pose frames every 80 ms and samples at 60 Hz in between.
function run(tracker, frames, startAt = 0, mirrored = true) {
  let t = startAt;
  let last = null;
  for (const lm of frames) {
    tracker.observe(lm, t, mirrored);
    for (let k = 0; k < 5; k++) {
      last = tracker.sample(t);
      t += 16;
    }
  }
  return { t, last };
}

test("deadZone(): zero inside, continuous outside", () => {
  assert.equal(deadZone(0.05, 0.08), 0);
  assert.equal(deadZone(-0.08, 0.08), 0);
  assert.ok(Math.abs(deadZone(0.18, 0.08) - 0.1) < 1e-9);
  assert.ok(Math.abs(deadZone(-0.18, 0.08) + 0.1) < 1e-9);
});

test("smoothTo(): time based, same result at 10 and at 60 steps", () => {
  assert.equal(smoothTo(0, 1, 0, 100), 0);
  assert.equal(smoothTo(0, 1, 50, 0), 1);
  let a = 0;
  for (let i = 0; i < 6; i++) a = smoothTo(a, 1, 100 / 6, 100);
  const b = smoothTo(0, 1, 100, 100);
  assert.ok(Math.abs(a - b) < 1e-9, "the step size does not change the curve");
  assert.ok(Math.abs(b - (1 - Math.exp(-1))) < 1e-9);
});

test("poseSignal(): centre, mirror, size, hand", () => {
  const s = poseSignal(body());
  assert.ok(Math.abs(s.x) < 1e-9);
  assert.ok(Math.abs(s.size - 0.2) < 1e-9);
  assert.ok(Math.abs(s.roll) < 1e-9);
  assert.equal(s.handUp, false);
  // The person stands at the image's left (0.3): in the mirror that is the screen's right.
  assert.ok(poseSignal(body({ cx: 0.3 }), true).x > 0.39);
  assert.ok(poseSignal(body({ cx: 0.3 }), false).x < -0.39);
  assert.equal(poseSignal(body({ over: { [LM.rightWrist]: { x: 0.4, y: 0.2 } } })).handUp, true);
  assert.equal(poseSignal(null), null);
  assert.equal(poseSignal([]), null);
});

test("poseSignal(): tilt follows the mirrored picture", () => {
  // tilt > 0 lowers the image-right shoulder; mirrored, the screen-left end is lower:
  // the line falls to the left, a negative (counter-clockwise) angle.
  const mirrored = poseSignal(body({ tilt: 0.03 }), true);
  const plain = poseSignal(body({ tilt: 0.03 }), false);
  assert.ok(mirrored.roll < -3, `mirrored roll ${mirrored.roll}`);
  assert.ok(plain.roll > 3, `plain roll ${plain.roll}`);
});

test("poseSignal(): invisible landmarks do not count, missing visibility does", () => {
  const lm = body();
  for (const i of [LM.leftShoulder, LM.rightShoulder, LM.nose]) lm[i] = { ...lm[i], visibility: 0.2 };
  assert.equal(poseSignal(lm), null);
  const noVis = body().map(({ x, y }) => ({ x, y }));
  assert.ok(poseSignal(noVis));
});

test("targetsFor(): dead zones keep a still person neutral, limits hold", () => {
  const still = targetsFor({ x: 0.05, y: 0.61, size: 0.205, roll: 2, handUp: false }, 0.6, 0.2);
  assert.deepEqual(still, { dx: 0, dy: 0, angle: 0, scale: 1 });
  const far = targetsFor({ x: 1, y: 0.2, size: 0.5, roll: 45, handUp: false }, 0.6, 0.2);
  assert.equal(far.dx, 1);
  assert.equal(far.dy, -1);
  assert.equal(far.angle, FOLLOW.maxAngle);
  assert.equal(far.scale, FOLLOW.maxScale);
  const away = targetsFor({ x: -1, y: 0.6, size: 0.05, roll: -45, handUp: false }, 0.6, 0.2);
  assert.equal(away.dx, -1);
  assert.equal(away.angle, -FOLLOW.maxAngle);
  assert.equal(away.scale, FOLLOW.minScale);
});

test("FollowTracker: nobody seen means inactive and neutral", () => {
  const t = new FollowTracker();
  assert.equal(t.active, false);
  assert.deepEqual(t.sample(0), NEUTRAL);
  t.observe(null, 0);
  assert.deepEqual(t.sample(100), NEUTRAL);
  assert.equal(t.active, false);
});

test("FollowTracker: the figure glides to the side the person moves to, without jumps", () => {
  const t = new FollowTracker();
  const frames = Array.from({ length: 25 }, () => body({ cx: 0.25 })); // screen right, mirrored
  const { last } = run(t, frames);
  assert.equal(last.active, true);
  assert.equal(last.present, true);
  assert.ok(last.dx > 0.4, `dx ${last.dx}`);
  // The first sample after the first pose frame has not jumped there.
  const fresh = new FollowTracker();
  fresh.observe(body({ cx: 0.25 }), 0);
  fresh.sample(0);
  assert.ok(fresh.sample(16).dx < 0.1);
});

test("FollowTracker: jitter inside the dead zone keeps the figure still", () => {
  const t = new FollowTracker();
  const frames = Array.from({ length: 40 }, (_, i) => body({ cx: 0.5 + (i % 2 ? 0.015 : -0.015), y: 0.6 + (i % 3 - 1) * 0.004 }));
  const { last } = run(t, frames);
  assert.equal(last.dx, 0);
  assert.ok(Math.abs(last.dy) < 1e-9);
  assert.ok(Math.abs(last.angle) < 1e-9);
  assert.equal(last.scale, 1);
});

test("FollowTracker: a jump lifts the figure, coming closer scales it up", () => {
  const t = new FollowTracker();
  const { t: at } = run(t, Array.from({ length: 10 }, () => body()));
  const jump = run(t, Array.from({ length: 4 }, () => body({ y: 0.45 })), at);
  assert.ok(jump.last.dy < -0.3, `dy ${jump.last.dy}`);
  const t2 = new FollowTracker();
  const { t: at2 } = run(t2, Array.from({ length: 10 }, () => body()));
  const close = run(t2, Array.from({ length: 6 }, () => body({ width: 0.26 })), at2);
  assert.ok(close.last.scale > 1.02 && close.last.scale <= FOLLOW.maxScale, `scale ${close.last.scale}`);
});

test("FollowTracker: a raised hand waves for at least 1.5 s, one noisy frame does not", () => {
  const up = body({ over: { [LM.leftWrist]: { x: 0.6, y: 0.2 } } });
  const t = new FollowTracker();
  const { t: at } = run(t, [body(), up, body()]);
  assert.equal(t.sample(at).wave, false, "one frame is noise");
  const raised = run(t, [up, up], at);
  assert.equal(raised.last.wave, true);
  const down = run(t, [body(), body(), body()], raised.t);
  assert.equal(down.last.wave, true, "held after the hand drops");
  const later = run(t, Array.from({ length: 20 }, () => body()), down.t);
  assert.equal(later.last.wave, false);
});

test("FollowTracker: losing the person returns to neutral and stops redrawing", () => {
  const t = new FollowTracker();
  const { t: at } = run(t, Array.from({ length: 20 }, () => body({ cx: 0.2, tilt: 0.04 })));
  const brief = run(t, [null, null, null], at); // 240 ms: still holds
  assert.ok(brief.last.dx > 0.4);
  const gone = run(t, Array.from({ length: 40 }, () => null), brief.t);
  assert.deepEqual(gone.last, NEUTRAL);
  assert.equal(t.active, false);
});

test("FollowTracker.release(): the camera stops, the figure glides back", () => {
  const t = new FollowTracker();
  const { t: at } = run(t, Array.from({ length: 20 }, () => body({ cx: 0.2 })));
  t.release();
  assert.equal(t.present, false);
  assert.equal(t.active, true, "still moving back");
  let m = null;
  for (let k = 0; k < 200; k++) m = t.sample(at + k * 16);
  assert.deepEqual(m, NEUTRAL);
});

test("figureMotion() and followPose()", () => {
  assert.equal(figureMotion(NEUTRAL, 280), null);
  assert.equal(figureMotion(null, 280), null);
  const m = figureMotion({ active: true, dx: 1, dy: -1, angle: 10, scale: 1.05, wave: false }, 280);
  assert.equal(m.tx, Math.round(FOLLOW.shiftOfSize * 280 * 10) / 10);
  assert.equal(m.ty, -Math.round(FOLLOW.liftOfSize * 280 * 10) / 10);
  assert.ok(Math.abs(m.angle - Math.PI / 18) < 1e-9);
  assert.equal(m.scale, 1.05);
  assert.equal(followPose("idle", { wave: true }), "wave");
  assert.equal(followPose("working", { wave: true }), "working", "a status pose wins");
  assert.equal(followPose("idle", null), "idle");
});

test("withFigureMotion(): turns about the figure's centre, restores the context", () => {
  const calls = [];
  const ctx = new Proxy({}, { get: (_, name) => (...args) => calls.push([name, ...args]) });
  let drawn = 0;
  withFigureMotion(ctx, null, 240, 237, () => drawn++);
  assert.equal(drawn, 1);
  assert.equal(calls.length, 0, "no motion, no transform");
  withFigureMotion(ctx, { tx: 10, ty: -5, angle: 0.1, scale: 1.02 }, 240, 237, () => drawn++);
  assert.equal(drawn, 2);
  assert.deepEqual(calls.map((c) => c[0]), ["save", "translate", "rotate", "scale", "translate", "restore"]);
  assert.deepEqual(calls[1], ["translate", 250, 232]);
  assert.deepEqual(calls[4], ["translate", -240, -237]);
});

test("the setting is off by default and the pose model is the lite one", () => {
  assert.equal(DEFAULTS.followMe, false);
  assert.equal(loadSettings({ getItem: () => JSON.stringify({ followMe: true }) }).followMe, true);
  assert.equal(loadSettings({ getItem: () => JSON.stringify({ followMe: "yes" }) }).followMe, false);
  assert.match(POSE_MODEL_URL, /pose_landmarker_lite/);
});

test("follow.js is in the service worker shell and the pose model in its runtime cache", () => {
  const sw = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  assert.match(sw, /"\.\/follow\.js"/);
  assert.ok(new URL(POSE_MODEL_URL).pathname.startsWith("/mediapipe-models/"));
  assert.match(sw, /\/mediapipe-models\//);
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /name="followMe"/);
  assert.match(html, /Muse folgt mir \(Beta\)/);
});
