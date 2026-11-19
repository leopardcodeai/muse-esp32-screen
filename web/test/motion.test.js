// motion.test.js: Muse's moves (motion.js): names and seconds, the curves of every motion
// (they start and end at rest, stay in bounds, and move the way their name says), the
// effects they trigger, reduced motion, the player that waits for the ready screen, the
// idle variety, the follow damping, and the display and renderers using them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MOTIONS, DEFAULT_SECONDS, MAX_SECONDS, MIN_SECONDS, PENDING_MS, IDLE_MOTIONS, IDLE_MIN_MS, IDLE_MAX_MS,
  parseMotion, motionSeconds, envelope, hopCurve, motionPose, followDamp, MotionPlayer, IdleVariety,
  withMotionPose, drawMotionEffects, confettiPieces, zPositions, heartPositions,
} from "../motion.js";
import { Display } from "../display.js";
import { SquareView, FIGURE, TOP_BAR } from "../square.js";
import { drawStatus } from "../cards.js";
import { DEFAULTS, loadSettings, restorable } from "../settings.js";
import { mapMuseWeb, mapCallService } from "../ha.js";

const ms = (name) => DEFAULT_SECONDS[name] * 1000;
// Samples a motion every 10 ms over its default length.
function samples(name, opts) {
  const dur = ms(name);
  const out = [];
  for (let t = 0; t <= dur; t += 10) out.push(motionPose(name, t, dur, opts));
  return out;
}
const max = (arr, f) => Math.max(...arr.map(f));
const min = (arr, f) => Math.min(...arr.map(f));

test("names: English, German and stop", () => {
  for (const m of MOTIONS) assert.equal(parseMotion(m), m);
  assert.equal(parseMotion("Tanzen"), "dance");
  assert.equal(parseMotion(" tanz "), "dance");
  assert.equal(parseMotion("hüpfen"), "jump");
  assert.equal(parseMotion("Kopfschütteln"), "shake");
  assert.equal(parseMotion("nicken"), "nod");
  assert.equal(parseMotion("verbeugen"), "bow");
  assert.equal(parseMotion("frieren"), "shiver");
  assert.equal(parseMotion("müde"), "sleep");
  assert.equal(parseMotion("Herzschlag"), "love");
  assert.equal(parseMotion("look_around"), "look");
  assert.equal(parseMotion("umschauen"), "look");
  assert.equal(parseMotion("feiern"), "celebrate");
  assert.equal(parseMotion("winken"), "wave");
  assert.equal(parseMotion("Party"), "party");
  assert.equal(parseMotion("stopp"), "stop");
  assert.equal(parseMotion("STOP"), "stop");
  assert.equal(parseMotion("moonwalk"), null);
  assert.equal(parseMotion(""), null);
  assert.equal(parseMotion(undefined), null);
});

test("seconds: the default, clamped to 0.5 .. 30, a comma counts", () => {
  for (const m of MOTIONS) assert.ok(DEFAULT_SECONDS[m] > 0 && DEFAULT_SECONDS[m] <= MAX_SECONDS, m);
  assert.equal(motionSeconds("dance"), 6);
  assert.equal(motionSeconds("dance", ""), 6);
  assert.equal(motionSeconds("dance", "abc"), 6);
  assert.equal(motionSeconds("dance", 0), 6);
  assert.equal(motionSeconds("dance", 10), 10);
  assert.equal(motionSeconds("dance", "2,5"), 2.5);
  assert.equal(motionSeconds("dance", 999), MAX_SECONDS);
  assert.equal(motionSeconds("dance", 0.1), MIN_SECONDS);
});

test("the envelope fades in and out and is 0 outside", () => {
  assert.equal(envelope(-1, 1000), 0);
  assert.equal(envelope(0, 1000), 0);
  assert.equal(envelope(1000, 1000), 0);
  assert.equal(envelope(500, 1000), 1);
  assert.ok(envelope(100, 1000) > 0 && envelope(100, 1000) < 1);
  assert.ok(envelope(900, 1000) > 0 && envelope(900, 1000) < 1);
  // A very short motion still reaches full strength in its middle.
  assert.equal(envelope(250, 500), 1);
});

test("every motion starts and ends at rest and stays in bounds", () => {
  for (const name of MOTIONS) {
    const dur = ms(name);
    for (const t of [0, dur]) {
      const p = motionPose(name, t, dur);
      assert.deepEqual([p.dx, p.dy, p.angle, p.sx, p.sy, p.alpha], [0, 0, 0, 1, 1, 1], `${name} at ${t}`);
    }
    const s = samples(name);
    assert.ok(max(s, (p) => Math.abs(p.dx)) <= 0.08, `${name} dx`);
    assert.ok(max(s, (p) => Math.abs(p.dy)) <= 0.17, `${name} dy`);
    assert.ok(max(s, (p) => Math.abs(p.angle)) <= 10, `${name} angle`);
    assert.ok(max(s, (p) => Math.abs(p.sy - 1)) <= 0.2, `${name} sy`);
    assert.ok(max(s, (p) => Math.abs(p.sx)) <= 1.2, `${name} sx`);
    assert.ok(s.every((p) => Number.isFinite(p.dx + p.dy + p.angle + p.sx + p.sy)), `${name} finite`);
    // and it does move
    assert.ok(max(s, (p) => Math.abs(p.dx) + Math.abs(p.dy) + Math.abs(p.angle) + Math.abs(p.sx - 1) + Math.abs(p.sy - 1)) > 0.02, `${name} moves`);
  }
});

test("each motion moves the way its name says", () => {
  const jump = samples("jump");
  assert.ok(min(jump, (p) => p.dy) < -0.1, "jump rises well above its place");
  assert.ok(max(jump, (p) => 1 - p.sy) > 0.05, "jump squashes on the crouch and the landing");
  assert.ok(min(jump, (p) => p.sy) < 1 && max(jump, (p) => p.sy) > 1, "squash and stretch");
  const hop = samples("hop");
  assert.ok(min(hop, (p) => p.dy) > -0.07 && min(hop, (p) => p.dy) < -0.03, "a hop is small");
  const dance = samples("dance");
  assert.ok(min(dance, (p) => p.angle) < -4 && max(dance, (p) => p.angle) > 4, "dance sways both ways");
  assert.ok(min(dance, (p) => p.dy) < -0.03, "dance bounces");
  assert.ok(min(dance, (p) => p.sy) < 0.96, "dance squashes on the beat");
  const spin = samples("spin");
  assert.ok(min(spin, (p) => p.sx) < 0, "spin turns the figure round (mirrored halfway)");
  assert.ok(spin.every((p) => Math.abs(p.sx) >= 0.059), "spin never collapses to a line");
  assert.equal(spin[100].pivot, 0.5, "spin turns about the middle");
  const nod = samples("nod");
  assert.ok(max(nod, (p) => p.dy) > 0.02 && min(nod, (p) => p.dy) >= 0, "nod goes down, never up");
  assert.ok(max(nod, (p) => Math.abs(p.dx)) === 0, "nod stays in place sideways");
  const shake = samples("shake");
  assert.ok(min(shake, (p) => p.dx) < -0.02 && max(shake, (p) => p.dx) > 0.02, "shake goes left and right");
  assert.ok(max(shake, (p) => Math.abs(p.dy)) === 0, "shake does not bob");
  const bow = samples("bow");
  const mid = motionPose("bow", ms("bow") * 0.5, ms("bow"));
  assert.ok(mid.sy < 0.9 && mid.dy > 0.04, "bow holds low in its middle");
  assert.ok(bow.every((p) => p.sy <= 1), "bow never stretches");
  const shiver = samples("shiver");
  let flips = 0;
  for (let i = 1; i < shiver.length; i++) if (Math.sign(shiver[i].dx) !== Math.sign(shiver[i - 1].dx)) flips++;
  assert.ok(flips > 40, `shiver trembles fast (${flips} flips in 3 s)`);
  const look = samples("look");
  assert.ok(look[Math.round(look.length * 0.3)].dx < -0.06, "look: left first");
  assert.ok(look[Math.round(look.length * 0.75)].dx > 0.06, "look: then right");
  const love = samples("love");
  assert.ok(max(love, (p) => p.sx) > 1.05 && love.every((p) => p.sx === p.sy), "love pulses evenly");
  const sleep = samples("sleep");
  assert.ok(min(sleep, (p) => p.angle) < -2 && max(sleep, (p) => p.angle) > 2, "sleep sways slowly");
  const celebrate = samples("celebrate");
  assert.ok(min(celebrate, (p) => p.dy) < -0.1, "celebrate jumps");
});

test("the figure animation under each motion", () => {
  assert.equal(motionPose("party", 1000, 8000).anim, "wave");
  assert.equal(motionPose("wave", 1000, 3000).anim, "wave");
  assert.equal(motionPose("celebrate", 1000, 5000).anim, "confetti");
  for (const m of ["dance", "jump", "spin", "nod", "shake", "bow", "shiver", "sleep", "love", "look", "hop"]) {
    assert.equal(motionPose(m, 500, ms(m)).anim, "idle", m);
  }
});

test("particle triggers: confetti and light for party and celebrate, Zs, hearts, cold marks", () => {
  const fx = (m) => motionPose(m, ms(m) / 2, ms(m)).effects;
  assert.ok(fx("party").confetti > 0 && fx("party").lights > 0);
  assert.ok(fx("celebrate").confetti > 0 && fx("celebrate").lights > 0);
  assert.ok(fx("sleep").zs > 0 && fx("sleep").confetti === 0);
  assert.ok(fx("love").hearts > 0);
  assert.ok(fx("shiver").cold > 0);
  for (const m of ["dance", "jump", "hop", "spin", "nod", "shake", "bow", "look", "wave"]) {
    const e = fx(m);
    assert.equal(e.confetti + e.lights + e.hearts + e.zs + e.cold, 0, m);
  }
  // The effects fade with the envelope.
  assert.equal(motionPose("party", 0, 8000).effects.confetti, 0);
});

test("the effect positions are deterministic and where they belong", () => {
  const area = { x: 0, y: 62, w: 480, h: 418 };
  const a = confettiPieces(1234, area), b = confettiPieces(1234, area);
  assert.deepEqual(a, b);
  assert.equal(a.length, 36);
  assert.ok(a.every((q) => q.y >= area.y - 20 && q.y <= area.y + area.h + 20));
  assert.notDeepEqual(confettiPieces(1500, area).map((q) => q.y), a.map((q) => q.y), "confetti falls");
  const z0 = zPositions(100, 270, 180, 280);
  assert.equal(z0.length, 1, "the Zs come one after another");
  const z = zPositions(2000, 270, 180, 280);
  assert.equal(z.length, 3);
  assert.ok(z.every((q) => q.x >= 270 && q.y <= 180 && q.alpha >= 0 && q.alpha <= 1), "Zs rise to the upper right");
  const h = heartPositions(700, 240, 237, 280);
  assert.equal(h.length, 6);
  assert.ok(h.every((q) => q.alpha >= 0 && q.alpha <= 1 && q.s > 0));
});

test("hopCurve: crouch, flight, landing", () => {
  assert.equal(hopCurve(0.1).lift, 0);
  assert.ok(hopCurve(0.1).squash > 0, "crouch");
  assert.ok(hopCurve(0.475).lift > 0.99, "top of the flight");
  assert.ok(hopCurve(0.3).squash < 0, "stretched while rising");
  assert.ok(hopCurve(0.87).squash > 0, "squash on landing");
});

test("intensity scales a motion, reduced motion only pulses", () => {
  const full = motionPose("look", 900, 3000), soft = motionPose("look", 900, 3000, { intensity: 0.6 });
  assert.ok(Math.abs(soft.dx - full.dx * 0.6) < 1e-9);
  for (const m of MOTIONS) {
    const s = samples(m, { reduced: true });
    assert.ok(s.every((p) => p.dx === 0 && p.dy === 0 && p.angle === 0), `${m} does not travel`);
    assert.ok(s.every((p) => p.sx === p.sy && p.sx <= 1.026 && p.alpha >= 0.85), `${m} pulses gently`);
    assert.ok(s.every((p) => p.effects.confetti + p.effects.lights + p.effects.hearts + p.effects.zs + p.effects.cold === 0),
      `${m} no particles`);
  }
});

test("follow damping: a running motion takes most of the follow tilt", () => {
  assert.equal(followDamp(0.1, 0), 0.1);
  assert.ok(Math.abs(followDamp(0.1, 1) - 0.025) < 1e-12);
  assert.equal(followDamp(0.1, undefined), 0.1);
});

test("the player starts on the ready screen, ends, stops, and drops a stale request", () => {
  const p = new MotionPlayer();
  assert.equal(p.sample(0, true), null);
  assert.deepEqual(p.start("dance", 1000), { motion: "dance", seconds: 6 });
  assert.equal(p.sample(2000, false), null, "a card shows: nothing yet");
  assert.ok(p.busy(2000));
  const first = p.sample(5000, true);
  assert.equal(first.t, 0, "the clock starts when the ready screen is seen");
  assert.ok(p.sample(8000, true).weight > 0);
  assert.equal(p.sample(11000, true), null, "6 s after it started it is over");
  assert.equal(p.busy(11000), false);
  p.start("party", 0, 20);
  assert.ok(p.busy(5000));
  assert.equal(p.start("stop", 6000), null);
  assert.equal(p.busy(6000), false, "stop ends it");
  p.start("jump", 0);
  assert.equal(p.busy(PENDING_MS + 1), false, "never shown within 60 s: dropped");
});

test("the idle variety waits 30 to 90 s of still ready screen, never twice the same", () => {
  let k = 0;
  const seq = [0, 0, 0.5, 0.99, 0.3, 0.7];
  const v = new IdleVariety(() => seq[k++ % seq.length]);
  assert.equal(v.due(0, true), null, "the pause starts");
  assert.equal(v.due(IDLE_MIN_MS - 1, true), null);
  const first = v.due(IDLE_MIN_MS, true);
  assert.ok(IDLE_MOTIONS.includes(first));
  // a card comes: no motion, and the pause starts again afterwards
  assert.equal(v.due(IDLE_MIN_MS + 1000, false), null);
  assert.equal(v.due(IDLE_MIN_MS + 2000, true), null);
  const next = v.nextAt - (IDLE_MIN_MS + 2000);
  assert.ok(next >= IDLE_MIN_MS && next <= IDLE_MAX_MS, `pause ${next}`);
  const second = v.due(v.nextAt, true);
  assert.ok(IDLE_MOTIONS.includes(second) && second !== first, "another one");
  // Over many rounds no motion repeats directly.
  const r = new IdleVariety(() => 0.4);
  let last = "", t = 0;
  r.due(t, true);
  for (let i = 0; i < 20; i++) {
    t = r.nextAt;
    const m = r.due(t, true);
    assert.notEqual(m, last);
    last = m;
  }
});

// --------------------------------------------------------- the display --

function make(extra = {}) {
  const clock = { t: 100000 };
  const media = { state: "none", show() { this.state = "loading"; }, hide() { this.state = "none"; } };
  const d = new Display({
    renderer: {}, figure: {}, weather: {}, media,
    now: () => clock.t, clock: () => new Date(2026, 10, 19, 12, 0),
    sound: { ask() {}, chime() {} }, random: () => 0.5, ...extra,
  });
  const advance = (ms_) => { clock.t += ms_; d.tick(); };
  return { d, clock, advance };
}

test("animate: the action, its answer, stop and an unknown name", () => {
  const { d, clock } = make();
  const r = d.dispatch("animate", { motion: "tanzen" });
  assert.deepEqual(r, { ok: true, motion: "dance", seconds: 6, on_screen: true });
  assert.ok(d.motionPose(clock.t + 100).weight >= 0);
  assert.equal(d.getState().motion, "dance");
  assert.deepEqual(d.dispatch("animate", { motion: "party", seconds: 99 }).seconds, 30);
  assert.deepEqual(d.dispatch("animate", { motion: "stop" }), { ok: true, motion: "stop" });
  assert.equal(d.motionPose(clock.t + 200), null);
  const bad = d.dispatch("animate", { motion: "moonwalk" });
  assert.equal(bad.ok, false);
  assert.ok(bad.motions.includes("dance") && bad.motions.includes("stop"));
  assert.equal(d.mode, 0, "animate is no card");
});

test("status poses and cards win over a running motion; it plays after the card", () => {
  const { d, clock, advance } = make();
  d.dispatch("show_text", { title: "T", message: "M" });
  const r = d.dispatch("animate", { motion: "jump" });
  assert.equal(r.on_screen, false);
  assert.equal(d.motionPose(clock.t), null, "cards never move");
  advance(20001);
  assert.equal(d.mode, 0);
  const p = d.motionPose(clock.t);
  assert.ok(p && p.t === 0, "the jump starts once the ready screen is back");
  d.setStatus("listening");
  assert.equal(d.motionPose(clock.t + 300), null, "listening wins");
  d.setStatus("ready");
  assert.ok(d.motionPose(clock.t + 400), "back on the ready screen it goes on");
});

test("the idle variety runs on the still ready screen only, and only when allowed", () => {
  const { d, advance } = make();
  advance(10);
  for (let i = 0; i < 70; i++) advance(1000);
  assert.ok(d.motion.current && d.motion.current.idle, "after 60 s (random 0.5) a small motion starts");
  assert.equal(d.motion.current.intensity, 0.6);
  const off = make({ autoMotion: false });
  for (let i = 0; i < 100; i++) off.advance(1000);
  assert.equal(off.d.motion.current, null, "setting off: still");
  const reduced = make();
  reduced.d.reducedMotion = true;
  for (let i = 0; i < 100; i++) reduced.advance(1000);
  assert.equal(reduced.d.motion.current, null, "reduced motion: no idle variety");
  const followed = make();
  followed.d.follow = { present: true, sample: () => null };
  for (let i = 0; i < 100; i++) followed.advance(1000);
  assert.equal(followed.d.motion.current, null, "someone is followed: the follow moves her");
});

test("the setting, the transient action and both channels", () => {
  assert.equal(DEFAULTS.autoMotion, true);
  assert.equal(loadSettings({ getItem: () => JSON.stringify({ autoMotion: false }) }).autoMotion, false);
  assert.equal(loadSettings({ getItem: () => "{}" }).autoMotion, true);
  assert.equal(restorable("animate"), false, "a move is never replayed after a reload");
  assert.deepEqual(mapMuseWeb({ action: "animate", motion: "dance", seconds: 4 }), { action: "animate", fields: { motion: "dance", seconds: 4 } });
  assert.deepEqual(mapCallService({ domain: "esphome", service: "muse_esp32_s3_box_3_screen_muse_animate", service_data: { motion: "nod" } }),
    { action: "animate", fields: { motion: "nod" } });
});

test("motion.js is in the service worker's shell, the setting in the dialog", () => {
  const sw = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  assert.ok(sw.includes('"./motion.js"'));
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.ok(html.includes('name="autoMotion"') && html.includes("Muse bewegt sich von selbst"));
});

// --------------------------------------------------------- the canvas --

function fakeCtx() {
  const ops = [];
  const ctx = { globalAlpha: 1, ops };
  for (const k of ["save", "restore", "translate", "rotate", "scale", "beginPath", "rect", "clip", "fillRect", "moveTo",
    "lineTo", "stroke", "fill", "bezierCurveTo", "closePath", "arc"]) {
    ctx[k] = (...a) => ops.push([k, ...a]);
  }
  ctx.createRadialGradient = () => ({ addColorStop() {} });
  return ctx;
}

test("withMotionPose turns about the pivot, does nothing without a pose", () => {
  const ctx = fakeCtx();
  let drawn = 0;
  withMotionPose(ctx, null, 100, 97, 280, () => drawn++);
  assert.equal(drawn, 1);
  assert.equal(ctx.ops.length, 0);
  const p = { ...motionPose("bow", 1200, 2400) };
  withMotionPose(ctx, p, 100, 97, 280, () => drawn++);
  assert.equal(drawn, 2);
  const names = ctx.ops.map((o) => o[0]);
  assert.deepEqual(names, ["save", "translate", "rotate", "scale", "translate", "restore"]);
  const [, tx, ty] = ctx.ops[1];
  assert.ok(Math.abs(tx - (240 + p.dx * 280)) < 1e-9);
  assert.ok(Math.abs(ty - (97 + 280 * 0.92 + p.dy * 280)) < 1e-9, "the bow pivots at the feet");
});

test("drawMotionEffects draws shapes only (no text) and leaves the alpha as it was", () => {
  for (const m of ["party", "celebrate", "sleep", "love", "shiver"]) {
    const ctx = fakeCtx();
    ctx.globalAlpha = 0.8;
    drawMotionEffects(ctx, motionPose(m, ms(m) / 2, ms(m)), 100, 97, 280, { x: 0, y: 62, w: 480, h: 418 });
    assert.ok(ctx.ops.some((o) => ["fillRect", "fill", "stroke"].includes(o[0])), `${m} draws`);
    assert.ok(!ctx.ops.some((o) => o[0] === "fillText"), `${m} no glyphs`);
    assert.equal(ctx.globalAlpha, 0.8, m);
  }
  const ctx = fakeCtx();
  drawMotionEffects(ctx, motionPose("nod", 500, 1600), 100, 97, 280, { x: 0, y: 62, w: 480, h: 418 });
  assert.ok(!ctx.ops.some((o) => ["fillRect", "fill", "stroke"].includes(o[0])), "a nod has no effects");
});

function recorder() {
  const ops = [];
  const ctx = new Proxy({ ops }, {
    get: (t, k) => (k in t ? t[k] : (...a) => { ops.push([k, ...a]); }),
    set: (t, k, v) => ((t[k] = v), true),
  });
  return {
    ctx, ops, k: 1, canvas: { width: 480, height: 480 },
    begin() {}, fill() {}, roundRectPath() {}, ringArc() {}, line() {}, print() {}, roundRect() {}, circle() {},
    width: (text) => String(text).length * 10, widthOf: () => (text) => String(text).length * 10,
  };
}

test("square: a party on the ready screen moves the figure, clips below the top bar, keeps drawing", () => {
  const { d, clock } = make({ layout: "square" });
  const draws = [];
  d.figure = { draw(_r, sub) { draws.push(sub); } };
  d.dispatch("animate", { motion: "party" });
  const view = new SquareView();
  const r = recorder();
  view.render(r, d, clock.t, new Date());
  const r2 = recorder();
  assert.ok(view.render(r2, d, clock.t + 2000, new Date()), "a running motion keeps the picture moving");
  assert.equal(draws.at(-1), "wave", "party plays the wave frames");
  assert.ok(r2.ops.some((o) => o[0] === "rect" && o[2] === TOP_BAR.h), "clipped below the top bar");
  assert.ok(r2.ops.some((o) => o[0] === "rotate"), "the figure sways");
  assert.ok(r2.ops.some((o) => o[0] === "fillRect"), "confetti falls");
  assert.ok(FIGURE.size > 0);
});

test("box layout: drawStatus applies the motion and a status pose wins", () => {
  const { d, clock } = make();
  const draws = [];
  d.figure = { draw(_r, sub) { draws.push(sub); } };
  d.dispatch("animate", { motion: "celebrate" });
  const r = recorder();
  drawStatus(r, d, clock.t + 1000);
  assert.equal(draws.at(-1), "confetti", "celebrate plays the confetti frames");
  assert.ok(r.ops.some((o) => o[0] === "rect" && o[2] === 30), "clipped below the top bar");
  d.setStatus("thinking");
  const r2 = recorder();
  drawStatus(r2, d, clock.t + 1200);
  assert.equal(draws.at(-1), "working", "thinking wins");
  assert.ok(!r2.ops.some((o) => o[0] === "rotate"), "and nothing moves");
});
