// cards.test.js: the box cards keep clear of the top bar and fit the 320 x 240 screen,
// at the positions the firmware's display lambda uses (firmware/muse-esp32-s3-box-3-screen.yaml).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { drawCelebration, drawTopBar, CELEBRATION } from "../cards.js";
import { CARD_FONTS } from "../render.js";

const FIRMWARE = readFileSync(new URL("../../firmware/muse-esp32-s3-box-3-screen.yaml", import.meta.url), "utf8");
const TOP_BAR = 30;  // the badges reach y 27, the clock's line box y 29; a tap above 30 opens the box info
const FIGURE = 160;
// The line box of Inter (ascent 0.96875 + descent 0.2412 of the size), as render.js and ESPHome place text.
const lineBox = (name) => CARD_FONTS[name][1] * (0.96875 + 0.2412);

function recorder() {
  const calls = [];
  const r = {
    print: (x, y, font, color, align, text) => calls.push(["print", x, y, text]),
    roundRect: (x, y, w, h) => calls.push(["roundRect", x, y, w, h]),
    circle: () => {},
    width: (text) => 7 * text.length,
    widthOf: () => (text) => 7 * text.length,
  };
  return { r, calls };
}

test("the celebration starts below the top bar and its text ends above y 240", () => {
  const { r, calls } = recorder();
  const drawn = [];
  const d = { card: { title: "Done!", body: "Every task for today is finished." }, since: 0,
    figure: { draw: (r_, name, t, x, y) => drawn.push([name, x, y]) } };
  drawCelebration(r, d, 1000);
  assert.deepEqual(drawn, [["confetti", 80, CELEBRATION.figureY]]);
  assert.ok(CELEBRATION.figureY >= TOP_BAR, "the figure's page-coloured frame would cover the clock and the timer chip");
  assert.deepEqual(calls.map((c) => c.slice(0, 3)), [["print", 160, CELEBRATION.titleY], ["print", 160, CELEBRATION.bodyY]]);
  assert.ok(CELEBRATION.titleY >= CELEBRATION.figureY + FIGURE, "the title sits below the figure");
  assert.ok(CELEBRATION.bodyY >= CELEBRATION.titleY + lineBox("title"), "the body sits below the title");
  assert.ok(CELEBRATION.bodyY + lineBox("body") <= 240, "the body fits on the screen");
});

test("the top bar draws nothing below y 30", () => {
  const { r, calls } = recorder();
  const d = { name: "Muse", connection: "on", card: { mode: 3 }, queue: { waiting: [1, 2] },
    timers: { soonest: () => ({ left: 299 }) } };
  drawTopBar(r, d, 0, new Date(2026, 9, 24, 21, 30));
  for (const c of calls) {
    if (c[0] === "roundRect") assert.ok(c[2] + c[4] <= TOP_BAR, `badge at y ${c[2]}, ${c[4]} high`);
    if (c[0] === "print" && c[3] === "21:30") assert.ok(c[2] + lineBox("clock") <= TOP_BAR, "the clock's line box");
  }
});

test("the firmware draws the celebration at the same positions", () => {
  const block = FIRMWARE.slice(FIRMWARE.indexOf("if (mode == 3) {"), FIRMWARE.indexOf("if (mode == 4) {"));
  assert.ok(block.length > 0);
  assert.match(block, new RegExp(`it\\.image\\(80, ${CELEBRATION.figureY}, confetti\\);`));
  assert.match(block, new RegExp(`it\\.print\\(160, ${CELEBRATION.titleY}, id\\(m_title\\)`));
  assert.match(block, new RegExp(`it\\.print\\(160, ${CELEBRATION.bodyY}, id\\(m_body\\)`));
  assert.match(FIRMWARE, new RegExp(`it\\.image\\(80 \\+ wiggle, ${TOP_BAR}, anim\\);`), "the ready screen's figure, the reference");
});
