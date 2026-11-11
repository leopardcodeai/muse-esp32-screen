// figure_frames.test.js: the dark folder URLs and the 60 fps blend between 6 fps frames.
import { test } from "node:test";
import assert from "node:assert/strict";
import { frameUrl, defaultUrl, frameBlend } from "../figure_frames.js";

test("the dark theme loads the same six files under /dark", () => {
  assert.equal(frameUrl("https://ha/local", "idle"), "https://ha/local/muse_idle.png");
  assert.equal(frameUrl("https://ha/local/", "idle", true), "https://ha/local/dark/muse_idle.png");
  assert.equal(defaultUrl("idle"), "./figure-default/idle.png");
  assert.equal(defaultUrl("idle", "./figure-default", true), "./figure-default/dark/idle.png");
});

test("ping-pong blends forwards and backwards", () => {
  // 0.0 steps: frame 0, no mix; 1.5: half between 1 and 2.
  assert.deepEqual(frameBlend("idle", 0, 16, 200), { i: 0, j: 1, mix: 0 });
  assert.deepEqual(frameBlend("idle", 300, 16, 200), { i: 1, j: 2, mix: 0.5 });
  // 15 steps is the turnaround: frame 15, no next frame.
  assert.deepEqual(frameBlend("idle", 3000, 16, 200), { i: 15, j: 15, mix: 0 });
  // 15.5 steps walks back: half between 14 and 13.
  assert.deepEqual(frameBlend("idle", 3100, 16, 200), { i: 14, j: 13, mix: 0.5 });
});

test("confetti runs once and the avatar stays", () => {
  assert.deepEqual(frameBlend("confetti", 100, 18, 200), { i: 0, j: 1, mix: 0.5 });
  assert.deepEqual(frameBlend("confetti", 999999, 18, 200), { i: 17, j: 17, mix: 0 });
  assert.deepEqual(frameBlend("avatar", 12345, 1, 200), { i: 0, j: 0, mix: 0 });
});
