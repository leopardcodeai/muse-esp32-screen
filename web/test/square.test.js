// square.test.js: the square layout's behaviour (docs/SQUARE_LAYOUT.md) on the same
// state machine, with a fake clock: its times, the queue of 8, the question buttons with
// their 150 ms press, "Fertig" after a timer, scene taps mapped into the panel, and the
// layout setting.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Display } from "../display.js";
import { SQUARE, squareButton, squareButtonAt, toScene, SCENE_BOX, PANEL, weatherGlyph, squareCaption } from "../square.js";
import { WEATHER } from "../text.js";
import { DEFAULTS, loadSettings, layoutFor } from "../settings.js";

function make() {
  const clock = { t: 100000 };
  const answers = [];
  const media = { state: "none", show() { this.state = "loading"; }, hide() { this.state = "none"; } };
  const d = new Display({
    renderer: {}, figure: {}, weather: {}, media, layout: "square",
    now: () => clock.t,
    clock: () => new Date(2026, 9, 24, 12, 0),
    onAnswer: (a, q) => answers.push([a, q]),
    sound: { ask() {}, chime() {} },
  });
  const advance = (ms) => {
    clock.t += ms;
    d.tick();
  };
  return { d, clock, answers, media, advance };
}

test("square cards stay 20 s, a celebration 6 s, a question 60 s", () => {
  const cases = [
    ["show_text", { title: "T", message: "M" }, 20000],
    ["show_weather", { condition: "sunny", temperature: "20", message: "M" }, 20000],
    ["show_image", { title: "T", message: "M", url: "http://x/y.jpg" }, 20000],
    ["show_live", { title: "T", url: "http://x/y.jpg", seconds: 30 }, 33000],
    ["show_agenda", { title: "", events: "09:00 a" }, 20000],
    ["celebrate", { title: "T", message: "M" }, 6000],
    ["ask", { question: "Q?" }, 60000],
    ["draw", { scene: "bg red\nseconds 45" }, 45000],
  ];
  for (const [action, fields, ms] of cases) {
    const { d, advance } = make();
    d.dispatch(action, fields);
    advance(ms - 1);
    assert.notEqual(d.mode, 0, `${action} still up before ${ms} ms`);
    advance(2);
    assert.equal(d.mode, 0, `${action} gone after ${ms} ms`);
  }
});

test("the square queue keeps 8", () => {
  const { d } = make();
  for (let i = 0; i < 12; i++) d.dispatch("show_text", { title: `T${i}`, message: "M" });
  assert.equal(d.queue.waiting.length, SQUARE.queueMax);
});

test("ask: yes left, no right in the bottom row; the press shows 150 ms", () => {
  const { d, answers, advance } = make();
  d.dispatch("ask", { question: "Licht an?" });
  const yes = squareButton(2, 0), no = squareButton(2, 1);
  assert.equal(yes.y, PANEL.y + 128 + 68);
  assert.ok(yes.x < no.x);
  d.touchStart(no.x + 10, no.y + 10);
  d.touchEnd();
  assert.deepEqual(answers, [["no", "Licht an?"]]);
  assert.equal(d.mode, 8, "the pressed button is still on screen");
  advance(SQUARE.pressMs + 1);
  assert.equal(d.mode, 0);
});

test("a question that comes during the 150 ms press stays up and takes taps at once", () => {
  // Review 24.10.2026: the press timer advanced the newer question and answered it "none".
  const { d, answers, advance } = make();
  d.dispatch("ask", { question: "Licht an?" });
  const yes = squareButton(2, 0);
  d.touchStart(yes.x + 10, yes.y + 10);
  d.touchEnd();
  advance(50);
  d.dispatch("ask", { question: "Tür zu?" });
  assert.equal(d.pressed, null, "the new question shows no pressed button");
  advance(SQUARE.pressMs);
  assert.equal(d.mode, 8);
  assert.equal(d.card.title, "Tür zu?");
  assert.deepEqual(answers, [["yes", "Licht an?"]], "the new question is not answered none");
  d.touchStart(yes.x + 10, yes.y + 10);
  d.touchEnd();
  assert.deepEqual(answers, [["yes", "Licht an?"], ["yes", "Tür zu?"]]);
  advance(SQUARE.pressMs + 1);
  assert.equal(d.mode, 0);
});

test("choose with four options fills the 2 x 2 grid", () => {
  for (let i = 0; i < 4; i++) {
    const b = squareButton(4, i);
    assert.equal(squareButtonAt(4, b.x + 1, b.y + 1), i);
  }
  assert.equal(squareButtonAt(4, 0, 0), -1);
});

test("a timer ends with Fertig for 5 s", () => {
  const { d, advance } = make();
  d.dispatch("show_timer", { label: "Tee", duration: "3 s" });
  assert.equal(d.mode, 11);
  advance(3001);
  assert.equal(d.mode, 6);
  assert.equal(d.card.title, "Fertig");
  advance(SQUARE.doneMs - 2);
  assert.equal(d.mode, 6);
  advance(5);
  assert.equal(d.mode, 0);
});

test("a tap on the pill shows the display about itself, on the panel the next card", () => {
  const { d } = make();
  d.dispatch("show_text", { title: "A", message: "a" });
  d.dispatch("show_text", { title: "B", message: "b" });
  d.touchStart(240, 300);
  d.touchEnd();
  assert.equal(d.card.title, "B");
  d.touchStart(60, 40);
  d.touchEnd();
  assert.equal(d.mode, 12);
});

test("scene coordinates map into the panel", () => {
  const [x, y] = toScene(SCENE_BOX.x + 160 * SCENE_BOX.k, SCENE_BOX.y + 120 * SCENE_BOX.k);
  assert.ok(Math.abs(x - 160) < 1e-9 && Math.abs(y - 120) < 1e-9);
  assert.ok(SCENE_BOX.w <= PANEL.w && SCENE_BOX.h <= PANEL.h);
});

test("every weather number has a glyph; captions only with a message", () => {
  for (let i = 0; i < WEATHER.length; i++) assert.ok(weatherGlyph(i), WEATHER[i]);
  assert.equal(squareCaption({ body: "" }), null);
  assert.equal(squareCaption({ body: "Live" }).text, "Live");
});

test("the layout setting and ?layout=", () => {
  assert.equal(DEFAULTS.layout, "box");
  const mem = { getItem: () => JSON.stringify({ layout: "round" }) };
  assert.equal(loadSettings(mem).layout, "box");
  assert.equal(layoutFor("?layout=square", DEFAULTS), "square");
  assert.equal(layoutFor("?layout=nonsense", { ...DEFAULTS, layout: "square" }), "square");
  assert.equal(layoutFor("", { ...DEFAULTS, layout: "square" }), "square");
  assert.equal(layoutFor("", DEFAULTS), "box");
});
