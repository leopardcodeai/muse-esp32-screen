// figure.test.js: the figure steps like the box (ping-pong, 160 ms in a scene, 200 ms on
// the cards, confetti once), the smooth position meets the box's frames at every step,
// the placeholder drawn in code carries no colour of its own (the blue figure is gone),
// and the web app ships no figure pictures.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  pingPongStep, pingPongPos, onceStep, STEP_MS, CARD_STEP_MS, FRAMES, CONFETTI_FRAMES, Figure, neutralTone,
} from "../figure.js";
import { frameIndex, frameUrl } from "../figure_frames.js";
import { applyTheme } from "../theme.js";

test("ping-pong like the box: 0 .. 15 and back, one step per 160 ms", () => {
  const seq = [];
  for (let i = 0; i < 32; i++) seq.push(pingPongStep(i * STEP_MS));
  assert.deepEqual(seq, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 1]);
  assert.equal(pingPongStep(159), 0);
  assert.equal(pingPongStep(160), 1);
});

test("the cards step every 200 ms, as the box does on its 100 ms ticks", () => {
  // The box steps once at least 160 ms have passed, checked every 100 ms: at 200, 400, ...
  let frame = 0, step = 0;
  const box = [];
  for (let now = 0; now <= 3000; now += 100) {
    if (now - step >= 160) { step = now; frame++; }
    box.push(frame);
  }
  const web = [];
  for (let now = 0; now <= 3000; now += 100) web.push(Math.floor(now / CARD_STEP_MS));
  assert.deepEqual(web, box);
});

test("the smooth position equals the box's frame at every whole step and lies between", () => {
  for (let i = 0; i < 2 * (FRAMES - 1) * 2; i++) {
    assert.equal(pingPongPos(i * STEP_MS), pingPongStep(i * STEP_MS), `step ${i}`);
  }
  const mid = pingPongPos(2.5 * STEP_MS);
  assert.ok(mid > 2 && mid < 3);
  const turn = pingPongPos(15.5 * STEP_MS);
  assert.ok(turn > 14 && turn < 15, "turns back without a jump");
  assert.equal(onceStep(10 * 1000, STEP_MS), CONFETTI_FRAMES - 1, "confetti holds its last frame");
  assert.equal(onceStep(250, STEP_MS, CONFETTI_FRAMES, true), 250 / STEP_MS);
});

test("frameIndex(): avatar still, confetti once, the rest ping-pong over the file's frames", () => {
  assert.equal(frameIndex("avatar", 5000, 1), 0);
  assert.equal(frameIndex("confetti", 0, 18), 0);
  assert.equal(frameIndex("confetti", 100000, 18), 17);
  assert.equal(frameIndex("idle", 16 * STEP_MS, 16), 14);
  assert.equal(frameIndex("wave", 3 * CARD_STEP_MS, 16, CARD_STEP_MS), 3);
  assert.equal(frameUrl("http://127.0.0.1:8322/", "idle"), "http://127.0.0.1:8322/muse_idle.png");
});

// A canvas context that records every colour it is given.
function colourRecorder() {
  const colours = [];
  const record = (v) => colours.push(v);
  const ctx = new Proxy({}, {
    get: (target, key) => (key in target ? target[key] : () => {}),
    set: (target, key, value) => {
      if (key === "fillStyle" || key === "strokeStyle") record(value);
      target[key] = value;
      return true;
    },
  });
  return { r: { ctx }, colours };
}

function rgb(text) {
  const m = /rgba?\((\d+),(\d+),(\d+)/.exec(text);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

test("the placeholder is neutral grey in both themes: no blue, no colour at all", () => {
  for (const theme of ["light", "dark"]) {
    applyTheme(theme);
    const fig = new Figure();
    const { r, colours } = colourRecorder();
    for (const sub of ["idle", "wave", "working", "making", "avatar", "confetti"]) {
      for (const t of [0, 400, 1700]) fig.draw(r, sub, t, 0, 0, STEP_MS);
    }
    assert.ok(colours.length > 20, `${theme}: the placeholder draws`);
    for (const c of colours) {
      const [red, green, blue] = rgb(c);
      assert.ok(Math.max(red, green, blue) - Math.min(red, green, blue) <= 2, `${theme}: ${c} is grey`);
    }
  }
  applyTheme("light");
});

test("neutralTone() mixes the page towards the ink", () => {
  assert.deepEqual(neutralTone(0, [243, 243, 243], [28, 28, 30]), [243, 243, 243]);
  assert.deepEqual(neutralTone(1, [0, 0, 0], [245, 245, 247]), [245, 245, 247]);
  assert.deepEqual(neutralTone(0.5, [0, 0, 0], [200, 200, 200]), [100, 100, 100]);
});

test("the web app ships no figure pictures and no blue figure any more", () => {
  assert.equal(existsSync(new URL("../figure-default", import.meta.url)), false, "web/figure-default/ is gone");
  const sw = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  assert.ok(!sw.includes("figure-default/"), "the service worker caches no project figure");
  assert.ok(sw.includes("./figure_styles.js"), "figure_styles.js is in the app shell");
  const figure = readFileSync(new URL("../figure.js", import.meta.url), "utf8");
  assert.ok(!/\[\s*76,\s*150,\s*214\s*\]/.test(figure), "the blue body colour is gone");
});
