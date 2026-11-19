import { test } from "node:test";
import assert from "node:assert/strict";
import { railWidth, railSide, profileLabel } from "../tablet.js";

test("railWidth(): the leftover width makes the page square", () => {
  assert.equal(railWidth(960, 600), 360);
  assert.equal(railWidth(1180, 820), 360);
  assert.equal(railWidth(1024, 768), 256);
  assert.equal(railWidth(700, 900), 0, "portrait uses the bottom bar");
  assert.equal(railWidth(2000, 500), 520, "capped");
  assert.equal(railWidth(900, 900), 0, "a square window uses the bottom bar");
});

test("railSide() and profileLabel()", () => {
  assert.equal(railSide(960, 600), "right");
  assert.equal(railSide(700, 900), "bottom");
  assert.equal(railSide(900, 900), "bottom");
  assert.equal(profileLabel("tab"), "Tab");
  assert.equal(profileLabel("ipad"), "iPad");
  assert.equal(profileLabel("x"), "Tab");
});
