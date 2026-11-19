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
