// theme.test.js: the two palettes of the square layout and the live token swap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PALETTES, applyTheme } from "../theme.js";
import { PAGE, INK, CARD, EDGE } from "../render.js";
import { PILLS } from "../tables.js";

test("light keeps the box's page and white cards", () => {
  applyTheme("light");
  assert.deepEqual(PAGE, [243, 243, 243]);
  assert.deepEqual(INK, [28, 28, 30]);
  assert.deepEqual(CARD, [255, 255, 255]);
  assert.equal(EDGE, null);
  assert.deepEqual(PILLS[0].color, [52, 199, 89]);
});

test("dark is true black, cards one step above, a hairline instead of a shadow", () => {
  applyTheme("dark");
  assert.deepEqual(PAGE, [0, 0, 0]);
  assert.deepEqual(INK, [245, 245, 247]);
  assert.deepEqual(CARD, [20, 20, 22]);
  assert.deepEqual(EDGE, [44, 44, 46]);
  assert.deepEqual(PILLS[0].color, [48, 209, 88]);
  assert.equal(PALETTES.dark.orange[0], 255);
  applyTheme("light");
});
