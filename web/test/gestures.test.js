import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GestureRecognizer, GESTURES, PRIORITY, GESTURE, GLM, swings, rhythm, detrend, median, frameOf, classify,
} from "../gestures.js";
import { MOTIONS } from "../motion.js";

const TAU = 2 * Math.PI;

// A deterministic noise source, a few pixels like real pose noise (about 0.01 S).
function noise(seed = 1, amp = 0.004) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 4294967296 - 0.5) * amp;
  };
}

// A person in image coordinates (not mirrored), facing the camera: the person's left
// shoulder is on the image's right. Shoulder line at `y`, shoulders `w` apart, the nose
// `head` above the shoulder line, wrists down by default, hips 0.3 below the shoulders.
// `turn` (radians) turns the body about its vertical axis: the width shrinks with
// cos(turn) and the face is gone while the back shows.
function body({
  cx = 0.5, y = 0.5, w = 0.2, head = 0.14, noseDx = 0, turn = 0, face = true, hips = true,
  lw = null, rw = null, n = null,
} = {}) {
  const j = n || (() => 0);
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.05 }));
  const set = (i, x, yy, vis = 0.99) => { lm[i] = { x: x + j(), y: yy + j(), visibility: vis }; };
  const half = (w / 2) * Math.cos(turn);
  const front = Math.cos(turn) > 0.3 && face;
  set(GLM.leftShoulder, cx + half, y);
  set(GLM.rightShoulder, cx - half, y);
  set(GLM.nose, cx + noseDx, y - head, front ? 0.99 : 0.1);
  set(GLM.leftEye, cx + noseDx + 0.03, y - head - 0.02, front ? 0.99 : 0.1);
  set(GLM.rightEye, cx + noseDx - 0.03, y - head - 0.02, front ? 0.99 : 0.1);
  const lwp = lw || { x: cx + half, y: y + 0.35 };
  const rwp = rw || { x: cx - half, y: y + 0.35 };
  set(GLM.leftWrist, lwp.x, lwp.y);
  set(GLM.rightWrist, rwp.x, rwp.y);
  if (hips) {
    set(GLM.leftHip, cx + half * 0.8, y + 0.3);
    set(GLM.rightHip, cx - half * 0.8, y + 0.3);
  }
  return lm;
}

// Feeds pose frames every 80 ms from `start` to `start + ms`, plays (fired()) every
// gesture the recogniser offers, and returns them as [{name, motion, confidence, t}].
function play(rec, fn, ms, start = 0) {
  const out = [];
  for (let t = start; t < start + ms; t += 80) {
    const g = rec.observe(fn(t), t);
    if (g) {
      rec.fired(g.name, t);
      out.push({ ...g, t });
    }
  }
  return out;
}

const names = (list) => list.map((g) => g.name);
const smoothstep = (v) => { const x = Math.max(0, Math.min(1, v)); return x * x * (3 - 2 * x); };

// ------------------------------------------------------------- helpers --

test("swings(): legs with hysteresis, jitter does not count", () => {
  const sine = Array.from({ length: 48 }, (_, i) => Math.sin((TAU * i) / 12)); // 4 periods
  assert.equal(swings(sine, 0.5).length, 8);
  const jitter = Array.from({ length: 48 }, (_, i) => (i % 2 ? 0.01 : -0.01));
  assert.equal(swings(jitter, 0.05).length, 0);
  assert.equal(swings([0, 1], 0.5).length, 1);
  assert.deepEqual(swings([], 1), []);
});

test("rhythm(): frequency and regularity of the turns", () => {
  const ts = Array.from({ length: 48 }, (_, i) => i * 80);
  const vs = ts.map((t) => Math.sin((TAU * 2 * t) / 1000));
  const r = rhythm(swings(vs, 0.5), ts);
  assert.ok(Math.abs(r.hz - 2) < 0.25, `hz ${r.hz}`);
  assert.ok(r.cv < 0.3, `cv ${r.cv}`);
  assert.equal(rhythm([1, 2], ts), null);
});

test("detrend() and median()", () => {
  const d = detrend([0, 1, 2, 3], [1, 3, 5, 7]);
  for (const v of d) assert.ok(Math.abs(v) < 1e-9);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.ok(Number.isNaN(median([])));
});

test("frameOf(): needs both shoulders, mirrors, missing visibility counts as seen", () => {
  const f = frameOf(body({ cx: 0.3 }), 0, true);
  assert.ok(Math.abs(f.mid.x - 0.7) < 1e-9);
  assert.ok(Math.abs(f.w - 0.2) < 1e-9);
  assert.equal(f.face, true);
  assert.ok(f.hip);
  const noShoulder = body();
  noShoulder[GLM.leftShoulder].visibility = 0.1;
  assert.equal(frameOf(noShoulder, 0), null);
  assert.ok(frameOf(body().map(({ x, y }) => ({ x, y })), 0));
  assert.equal(frameOf(null, 0), null);
});

test("every gesture maps to a motion of motion.js, in priority order", () => {
  for (const name of PRIORITY) {
    const g = GESTURES[name];
    assert.ok(MOTIONS.includes(g.motion), `${name} -> ${g.motion}`);
    assert.ok(g.threshold > 0 && g.threshold <= 1);
    assert.ok(g.cooldownMs >= 4000);
  }
  assert.deepEqual(PRIORITY.slice(0, 3), ["party", "dance", "jump"]);
  assert.equal(GESTURE.globalCooldownMs, 2000);
});

// ------------------------------------------------------------ gestures --

test("jump: the body rises and falls back -> jump", () => {
  const rec = new GestureRecognizer();
  const n = noise(2);
  const fired = play(rec, (t) => {
    const k = (t - 2000) / 500;
    const lift = k > 0 && k < 1 ? 0.12 * Math.sin(Math.PI * k) : 0;
    return body({ y: 0.5 - lift, n });
  }, 3500);
  assert.deepEqual(names(fired), ["jump"]);
  assert.equal(fired[0].motion, "jump");
  assert.ok(fired[0].confidence >= 0.5);
  assert.ok(fired[0].t >= 2300 && fired[0].t < 3000, `t ${fired[0].t}`);
});

test("dance: a rhythmic bounce and sway -> dance, nothing else first", () => {
  const rec = new GestureRecognizer();
  const n = noise(3);
  const fired = play(rec, (t) => {
    const dance = t > 1000;
    const bounce = dance ? 0.025 * Math.sin((TAU * 2 * t) / 1000) : 0;
    const sway = dance ? 0.03 * Math.sin((TAU * 1 * t) / 1000) : 0;
    return body({ cx: 0.5 + sway, y: 0.5 + bounce, n });
  }, 5000);
  assert.equal(fired[0]?.name, "dance", JSON.stringify(fired));
  assert.equal(fired[0].motion, "dance");
});

test("dance with only a sideways sway -> dance", () => {
  const rec = new GestureRecognizer();
  const fired = play(rec, (t) => body({ cx: 0.5 + 0.04 * Math.sin((TAU * 1.2 * t) / 1000), n: noise(4) }), 4000);
  assert.equal(fired[0]?.name, "dance", JSON.stringify(fired));
});

test("party: dancing with both arms up -> party, no cheer first", () => {
  const rec = new GestureRecognizer();
  const fired = play(rec, (t) => {
    const bounce = 0.025 * Math.sin((TAU * 2 * t) / 1000);
    const y = 0.5 + bounce;
    return body({ y, lw: { x: 0.62, y: y - 0.3 }, rw: { x: 0.38, y: y - 0.3 }, n: noise(5) });
  }, 4000);
  assert.equal(fired[0]?.name, "party", JSON.stringify(fired));
  assert.equal(fired[0].motion, "party");
});

test("cheer: both arms up and held -> celebrate", () => {
  const rec = new GestureRecognizer();
  const fired = play(rec, (t) => (t < 1000 ? body() : body({ lw: { x: 0.64, y: 0.18 }, rw: { x: 0.36, y: 0.18 } })), 2500);
  assert.deepEqual(names(fired), ["cheer"]);
  assert.equal(fired[0].motion, "celebrate");
});

test("wave: one hand above the shoulder moving side to side -> wave", () => {
  const rec = new GestureRecognizer();
  const fired = play(rec, (t) => (t < 1000 ? body()
    : body({ rw: { x: 0.36 + 0.06 * Math.sin((TAU * 1.5 * t) / 1000), y: 0.38 }, n: noise(6) })), 3000);
  assert.deepEqual(names(fired), ["wave"]);
  assert.ok(fired[0].confidence >= 0.6);
});

test("wave: a hand raised above the head and held, like follow.js -> wave", () => {
  const rec = new GestureRecognizer();
  const fired = play(rec, (t) => (t < 1000 ? body() : body({ lw: { x: 0.62, y: 0.25 } })), 2600);
  assert.deepEqual(names(fired), ["wave"]);
});

test("nod: the nose down and up twice against the shoulders -> nod", () => {
  const rec = new GestureRecognizer();
  const fired = play(rec, (t) => body({ head: 0.14 - (t > 1000 ? 0.012 * (1 - Math.cos((TAU * 2 * t) / 1000)) : 0), n: noise(7) }), 3000);
  assert.deepEqual(names(fired), ["nod"]);
});

test("shake: the nose left and right twice -> shake", () => {
  const rec = new GestureRecognizer();
  const fired = play(rec, (t) => body({ noseDx: t > 1000 ? 0.03 * Math.sin((TAU * 2 * t) / 1000) : 0, n: noise(8) }), 3000);
  assert.deepEqual(names(fired), ["shake"]);
});

test("bow: shoulders and nose drop forward while the hips stay -> bow", () => {
  const rec = new GestureRecognizer();
  const fired = play(rec, (t) => {
    const b = smoothstep((t - 2000) / 600);
    const lm = body({ y: 0.5 + 0.08 * b, head: 0.14 - 0.16 * b, n: noise(9), hips: false });
    // The hips stay where they were.
    lm[GLM.leftHip] = { x: 0.58, y: 0.8, visibility: 0.99 };
    lm[GLM.rightHip] = { x: 0.42, y: 0.8, visibility: 0.99 };
    return lm;
  }, 3800);
  assert.deepEqual(names(fired), ["bow"]);
});

test("heart: both wrists together at the chest or above the head -> love", () => {
  const chest = play(new GestureRecognizer(), (t) => (t < 1000 ? body()
    : body({ lw: { x: 0.52, y: 0.58 }, rw: { x: 0.48, y: 0.58 } })), 2200);
  assert.deepEqual(names(chest), ["heart"]);
  assert.equal(chest[0].motion, "love");
  const top = play(new GestureRecognizer(), (t) => (t < 1000 ? body()
    : body({ lw: { x: 0.52, y: 0.22 }, rw: { x: 0.48, y: 0.22 } })), 2200);
  assert.deepEqual(names(top), ["heart"], "together above the head is a heart, not a cheer");
});

test("hug: arms crossed or hugging oneself -> shiver", () => {
  const rec = new GestureRecognizer();
  const fired = play(rec, (t) => (t < 1000 ? body()
    : body({ lw: { x: 0.43, y: 0.6 }, rw: { x: 0.57, y: 0.6 }, n: noise(10) })), 2600);
  assert.deepEqual(names(fired), ["hug"]);
  assert.equal(fired[0].motion, "shiver");
});

test("spin: turning around on the spot -> spin", () => {
  const rec = new GestureRecognizer();
  const fired = play(rec, (t) => {
    const k = (t - 2000) / 1200;
    return body({ turn: k > 0 && k < 1 ? TAU * k : 0, n: noise(11) });
  }, 4000);
  assert.deepEqual(names(fired), ["spin"]);
  assert.ok(fired[0].t > 2700, "recognised once the face is back");
});

test("still: standing still with the head down for a long time -> look", () => {
  const rec = new GestureRecognizer();
  const fired = play(rec, (t) => body({ head: t < 3000 ? 0.14 : 0.06, n: noise(12) }), 11000);
  assert.deepEqual(names(fired), ["still"]);
  assert.equal(fired[0].motion, "look");
  assert.ok(fired[0].t > 8000, `t ${fired[0].t}`);
});

// ------------------------------------------------------ no false alarm --

test("standing still (with pose noise and dropped frames) recognises nothing", () => {
  const rec = new GestureRecognizer();
  const n = noise(13);
  const fired = play(rec, (t) => (t % 1760 === 0 ? null : body({ n, y: 0.5 + 0.003 * Math.sin(t / 700) })), 15000);
  assert.deepEqual(fired, []);
});

test("standing still with three times the pose noise recognises nothing", () => {
  const rec = new GestureRecognizer();
  const n = noise(21, 0.012);
  assert.deepEqual(play(rec, () => body({ n }), 15000), []);
});

test("walking past (frontal or in profile) recognises nothing", () => {
  for (const profile of [false, true]) {
    const rec = new GestureRecognizer();
    const fired = play(rec, (t) => {
      const cx = -0.1 + (1.2 * t) / 3000;
      if (cx < 0.05 || cx > 0.95) return null;
      const step = Math.sin((TAU * 2 * t) / 1000);
      return body({
        cx, y: 0.5 + 0.008 * Math.abs(step), w: profile ? 0.08 : 0.2, face: !profile,
        lw: { x: cx + 0.1 + 0.03 * step, y: 0.86 }, rw: { x: cx - 0.1 - 0.03 * step, y: 0.86 }, n: noise(14),
      });
    }, 3600);
    assert.deepEqual(fired, [], `profile ${profile}: ${JSON.stringify(fired)}`);
  }
});

test("walking away and coming back later is no spin", () => {
  const rec = new GestureRecognizer();
  const fired = play(rec, (t) => {
    if (t < 2000) return body();
    if (t < 3000) return body({ turn: Math.PI, w: 0.2 - (0.1 * (t - 2000)) / 1000 });
    if (t < 5000) return null;
    return body();
  }, 7000);
  assert.deepEqual(fired, []);
});

test("sitting down (hips seen or not) recognises nothing", () => {
  for (const hips of [true, false]) {
    const rec = new GestureRecognizer();
    const fired = play(rec, (t) => {
      const s = smoothstep((t - 2000) / 1200);
      return body({ y: 0.45 + 0.2 * s, hips, n: noise(15) });
    }, 8000);
    assert.deepEqual(fired, [], `hips ${hips}: ${JSON.stringify(fired)}`);
  }
});

test("standing up from a chair is no jump", () => {
  const rec = new GestureRecognizer();
  const fired = play(rec, (t) => body({ y: 0.65 - 0.2 * smoothstep((t - 1500) / 900), n: noise(16) }), 5000);
  assert.deepEqual(fired, []);
});

// ------------------------------------------------------------ cooldowns --

test("cooldown: jumping again and again plays jump at most every 4 s", () => {
  const rec = new GestureRecognizer();
  const fired = play(rec, (t) => {
    const k = ((t - 1000) % 1200) / 500;
    const lift = t > 1000 && k < 1 ? 0.12 * Math.sin(Math.PI * k) : 0;
    return body({ y: 0.5 - lift });
  }, 13000);
  assert.ok(fired.length >= 2 && fired.length <= 4, JSON.stringify(fired));
  for (let i = 1; i < fired.length; i++) assert.ok(fired[i].t - fired[i - 1].t >= GESTURES.jump.cooldownMs);
});

test("global cooldown: two gestures are at least 2 s apart", () => {
  const rec = new GestureRecognizer();
  // A jump, then at once a held heart.
  const fired = play(rec, (t) => {
    const k = (t - 1500) / 500;
    const lift = k > 0 && k < 1 ? 0.12 * Math.sin(Math.PI * k) : 0;
    const heart = t > 2100;
    return body({ y: 0.5 - lift, lw: heart ? { x: 0.52, y: 0.58 } : null, rw: heart ? { x: 0.48, y: 0.58 } : null });
  }, 5000);
  assert.deepEqual(names(fired), ["jump", "heart"]);
  assert.ok(fired[1].t - fired[0].t >= GESTURE.globalCooldownMs);
});

test("observe() commits nothing: a gesture not played stays offered, without cooldown", () => {
  const rec = new GestureRecognizer();
  const up = body({ lw: { x: 0.64, y: 0.18 }, rw: { x: 0.36, y: 0.18 } });
  let offered = 0;
  for (let t = 0; t < 2000; t += 80) if (rec.observe(up, t)) offered++;
  assert.ok(offered > 5, "offered on every frame while held");
  const g = rec.observe(up, 2000);
  assert.equal(g.name, "cheer");
  rec.fired(g.name, 2000);
  assert.equal(rec.observe(up, 2080), null);
});

test("nobody for 0.7 s clears the history", () => {
  const rec = new GestureRecognizer();
  play(rec, () => body(), 2000);
  assert.ok(rec.frames.length > 10);
  assert.equal(rec.present, true);
  play(rec, () => null, 1000, 2000);
  assert.equal(rec.frames.length, 0);
  assert.equal(rec.present, false);
});

test("classify() is all zeros for a short history", () => {
  const c = classify([], 0);
  for (const name of PRIORITY) assert.equal(c[name], 0);
});

test("gestures.js is in the service worker shell", () => {
  const sw = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  assert.match(sw, /"\.\/gestures\.js"/);
});
