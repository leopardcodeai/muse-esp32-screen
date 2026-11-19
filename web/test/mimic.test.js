// mimic.test.js: "Muse macht meine Bewegungen nach" around gestures.js: the setting and
// its default (it goes with "Muse folgt mir"), the camera modes (Aus, Folgen, Nachmachen,
// Erkennen, Alles) and their mapping to the settings, the display playing a gesture's
// move only on the ready screen, and the camera feeding the recogniser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULTS, loadSettings, mimicOn, mimicChoice, CAMERA_MODES, CAMERA_MODE_LABELS, parseCameraMode, cameraModeOf,
  cameraModeSettings, restorable,
} from "../settings.js";
import { Display } from "../display.js";
import { MotionPlayer, DEFAULT_SECONDS } from "../motion.js";
import { Camera } from "../camera.js";

const stored = (obj) => ({ getItem: () => JSON.stringify(obj) });

// ------------------------------------------------------------- settings --

test("mimicMe: by default it goes with followMe; an explicit choice is kept", () => {
  assert.equal(DEFAULTS.mimicMe, null);
  assert.equal(loadSettings(stored({})).mimicMe, null);
  assert.equal(loadSettings(stored({ mimicMe: "yes" })).mimicMe, null);
  assert.equal(loadSettings(stored({ mimicMe: false })).mimicMe, false);
  assert.equal(mimicOn({ followMe: false, mimicMe: null }), false);
  assert.equal(mimicOn({ followMe: true, mimicMe: null }), true, "default on when follow-me is on");
  assert.equal(mimicOn({ followMe: true, mimicMe: false }), false);
  assert.equal(mimicOn({ followMe: false, mimicMe: true }), true);
  assert.equal(mimicOn(null), false);
  assert.equal(mimicChoice(true, true), null);
  assert.equal(mimicChoice(false, false), null);
  assert.equal(mimicChoice(true, false), true);
  assert.equal(mimicChoice(false, true), false);
});

test("camera modes: names, German labels and aliases", () => {
  assert.deepEqual(CAMERA_MODES, ["off", "follow", "mimic", "detect", "all"]);
  assert.deepEqual(Object.keys(CAMERA_MODE_LABELS), CAMERA_MODES);
  assert.equal(CAMERA_MODE_LABELS.mimic, "Nachmachen");
  for (const m of CAMERA_MODES) assert.equal(parseCameraMode(m), m);
  assert.equal(parseCameraMode("Nachmachen"), "mimic");
  assert.equal(parseCameraMode(" erkennen "), "detect");
  assert.equal(parseCameraMode("Folgen"), "follow");
  assert.equal(parseCameraMode("aus"), "off");
  assert.equal(parseCameraMode("Alles"), "all");
  assert.equal(parseCameraMode("follow_me"), "follow");
  assert.equal(parseCameraMode("toString"), null, "no prototype keys");
  assert.equal(parseCameraMode("moonwalk"), null);
  assert.equal(parseCameraMode(undefined), null);
  assert.equal(restorable("camera_mode"), false, "a mode is never replayed after a reload");
});

test("camera modes: every mode sets the settings that read back as that mode", () => {
  for (const mode of CAMERA_MODES) {
    const s = { ...DEFAULTS, camera: true, followMe: false, personBoxes: true, ...cameraModeSettings(mode) };
    assert.equal(cameraModeOf(s), mode, mode);
  }
  assert.deepEqual(cameraModeSettings("off"), { camera: false });
  assert.deepEqual(cameraModeSettings("mimic"), { camera: true, followMe: true, mimicMe: true, personBoxes: false });
  assert.equal(cameraModeSettings("detect").vision, true);
  assert.equal(cameraModeSettings("all").visionAuto, undefined, "the Vision timer is never switched by a mode");
  assert.deepEqual(cameraModeSettings("nope"), {});
});

test("cameraModeOf(): the camera off is off, mixed switches are custom", () => {
  assert.equal(cameraModeOf(DEFAULTS), "off");
  assert.equal(cameraModeOf(null), "off");
  assert.equal(cameraModeOf({ camera: true, followMe: true, mimicMe: null, personBoxes: false }), "mimic", "the default mimic counts");
  assert.equal(cameraModeOf({ camera: true, followMe: true, mimicMe: false, personBoxes: false }), "follow");
  assert.equal(cameraModeOf({ camera: true, followMe: false, mimicMe: null, personBoxes: false }), "custom");
  assert.equal(cameraModeOf({ camera: true, followMe: false, mimicMe: true, personBoxes: false }), "custom");
  assert.equal(cameraModeOf({ camera: true, followMe: true, mimicMe: false, personBoxes: true }), "custom");
});

// -------------------------------------------------------------- display --

function make(extra = {}) {
  const clock = { t: 100000 };
  const lines = [];
  const media = { state: "none", show() { this.state = "loading"; }, hide() { this.state = "none"; } };
  const d = new Display({
    renderer: {}, figure: {}, weather: {}, media, log: (l) => lines.push(l),
    now: () => clock.t, clock: () => new Date(2026, 10, 19, 12, 0),
    sound: { ask() {}, chime() {} }, random: () => 0.5, ...extra,
  });
  return { d, clock, lines };
}
const jump = { name: "jump", motion: "jump", confidence: 0.823 };

test("display.gesture(): plays the move on the ready screen and logs it once", () => {
  const { d, clock, lines } = make();
  assert.equal(d.gesture(jump), true);
  assert.equal(d.motion.current.name, "jump");
  assert.equal(d.motion.current.gesture, true);
  assert.deepEqual(lines.filter((l) => l.startsWith("gesture")), ["gesture jump (0.82)"]);
  assert.ok(d.motionPose(clock.t + 200));
  assert.equal(d.gesture(null), false);
  assert.equal(d.gesture({ name: "x" }), false);
});

test("display.gesture(): cards and status poses win, nothing waits for later", () => {
  const { d, lines } = make();
  d.dispatch("show_text", { title: "T", message: "M" });
  assert.equal(d.gesture(jump), false);
  assert.equal(d.motion.current, null, "a gesture is not queued behind a card");
  const s = make();
  s.d.setStatus("listening");
  assert.equal(s.d.gesture(jump), false);
  assert.equal(lines.some((l) => l.startsWith("gesture")), false);
});

test("display.gesture(): an animate move wins, an idle move gives way", () => {
  const { d, clock } = make();
  d.dispatch("animate", { motion: "sleep" });
  d.motionPose(clock.t);
  assert.equal(d.gesture(jump), false);
  assert.equal(d.motion.current.name, "sleep");
  const idle = make();
  idle.d.motion.start("look", idle.clock.t, undefined, { idle: true });
  assert.equal(idle.d.gesture(jump), true);
  assert.equal(idle.d.motion.current.name, "jump");
});

test("display.gesture(): another gesture replaces, the same one extends", () => {
  const { d, clock } = make();
  d.gesture({ name: "dance", motion: "dance", confidence: 0.7 });
  d.motionPose(clock.t); // started on the ready screen
  clock.t += 5000;
  d.gesture({ name: "dance", motion: "dance", confidence: 0.7 });
  const c = d.motion.current;
  assert.equal(c.startedAt, 100000, "not started over");
  assert.equal(c.ms, 5000 + DEFAULT_SECONDS.dance * 1000);
  d.gesture({ name: "nod", motion: "nod", confidence: 0.7 });
  assert.equal(d.motion.current.name, "nod");
});

test("MotionPlayer.extend(): only the running gesture move of that name", () => {
  const p = new MotionPlayer();
  assert.equal(p.extend("dance", 0), false);
  p.start("dance", 0, undefined, { gesture: true });
  assert.equal(p.extend("dance", 10), false, "not started yet");
  p.sample(0, true);
  assert.equal(p.extend("jump", 10), false);
  assert.equal(p.extend("dance", 1000), true);
  assert.equal(p.current.ms, 1000 + DEFAULT_SECONDS.dance * 1000);
  p.start("dance", 2000);
  p.sample(2000, true);
  assert.equal(p.extend("dance", 2100), false, "an animate move is never extended by a gesture");
});

test("the idle variety stays quiet while the gesture tracker sees someone", () => {
  const { d, clock } = make();
  d.gestures = { present: true };
  for (let i = 0; i < 100; i++) { clock.t += 1000; d.tick(); }
  assert.equal(d.motion.current, null);
});

// --------------------------------------------------------------- camera --

function camera(extra = {}) {
  return new Camera({ elements: {}, now: () => 0, ...extra });
}

test("camera: the pose tracker runs for either setting; mimic alone does not move the figure", () => {
  const c = camera();
  c.setOptions({ followMe: false, mimicMe: null });
  assert.equal(c.posing(), false);
  c.setOptions({ followMe: true, mimicMe: null });
  assert.equal(c.mimic, true, "mimic goes with follow-me by default");
  assert.equal(c.posing(), true);
  c.setOptions({ followMe: false, mimicMe: true });
  assert.equal(c.followMe, false);
  assert.equal(c.posing(), true, "mimic turns the pose tracker on by itself");
  c.setOptions({ followMe: true, mimicMe: false });
  assert.equal(c.mimic, false);
});

test("camera: pose frames go to the recogniser; the cooldown starts only when the move plays", () => {
  const offered = [];
  let accept = false;
  const fired = [];
  const gestures = {
    observe: () => ({ name: "jump", motion: "jump", confidence: 0.9 }),
    fired: (name) => fired.push(name),
    reset() {},
  };
  const follow = { observed: 0, observe() { this.observed++; }, release() {} };
  const c = camera({ gestures, follow, onGesture: (g) => { offered.push(g.name); return accept; } });
  c.setOptions({ followMe: false, mimicMe: true });
  c.on = true;
  c.pose = { detectForVideo: () => ({ landmarks: [[{ x: 0.5, y: 0.5 }]] }) };
  c.el.video = { readyState: 4, videoWidth: 640, videoHeight: 480 };
  globalThis.document = { hidden: false };
  try {
    let t = 0;
    c.now = () => (t += 80);
    c.followStep();
    assert.deepEqual(offered, ["jump"]);
    assert.deepEqual(fired, [], "not played: no cooldown");
    assert.equal(follow.observed, 0, "follow-me is off: the figure is not moved");
    accept = true;
    c.followStep();
    assert.deepEqual(fired, ["jump"]);
  } finally {
    delete globalThis.document;
  }
});

// ------------------------------------------------------------------- UI --

test("the page has the setting, the rail's camera mode and the dialog's mode", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /name="mimicMe"/);
  assert.match(html, /Muse macht meine Bewegungen nach \(Beta\)/);
  const rail = html.match(/<div id="rail-camera-mode"[\s\S]*?<\/div>/);
  assert.ok(rail, "the rail has the camera mode control");
  for (const m of CAMERA_MODES) {
    assert.match(rail[0], new RegExp(`data-mode="${m}"[^>]*>${CAMERA_MODE_LABELS[m]}<`));
    assert.match(html, new RegExp(`name="cameraMode" value="${m}"`));
  }
  const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.match(css, /html\[data-look="ios"\]\.tablet #rail-camera-mode/);
  assert.match(css, /\.seg-5/);
});
