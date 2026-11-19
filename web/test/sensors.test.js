import { test } from "node:test";
import assert from "node:assert/strict";
import { luxDim, isHandNear } from "../sensors.js";

test("luxDim(): dark room dims, a lit room does not", () => {
  assert.equal(luxDim(0), 0.45);
  assert.equal(luxDim(-1), 0.45);
  assert.equal(luxDim(120), 0);
  assert.equal(luxDim(500), 0);
  assert.ok(luxDim(10) > 0.3);
  assert.ok(luxDim(60) > 0.1 && luxDim(60) < 0.3);
});

test("isHandNear(): a sharp drop, not a dark room", () => {
  assert.equal(isHandNear(100, 2), true);
  assert.equal(isHandNear(100, 30), false);
  assert.equal(isHandNear(20, 2), false);
  assert.equal(isHandNear(null, 2), false);
});

test("a frozen native bridge still receives pushes through the window wrapper", async () => {
  const { Sensors } = await import("../sensors.js");
  const native = Object.freeze({ read: () => JSON.stringify({ light: 80 }), wake: () => {} });
  globalThis.window = { museSensors: native };
  const s = new Sensors({ bridge: native });
  assert.equal(s.start(), true);
  assert.equal(s.light, 80, "the first read is a JSON string and is applied");
  assert.notEqual(globalThis.window.museSensors, native);
  globalThis.window.museSensors.update(JSON.stringify({ light: 3 }));
  assert.equal(s.light, 3, "the push reaches the page");
  delete globalThis.window;
});
