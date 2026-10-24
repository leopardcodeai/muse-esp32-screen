// square.test.js: the square layout's behaviour (docs/SQUARE_LAYOUT.md) on the same
// state machine, with a fake clock: its times, the queue of 8, the question buttons with
// their 150 ms press, "Fertig" after a timer, scene taps mapped into the panel, the
// layout setting, and what a frame draws: the top bar like the box's and one status.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Display } from "../display.js";
import { SQUARE, squareButton, squareButtonAt, toScene, SCENE_BOX, PANEL, weatherGlyph, squareCaption,
  SquareView, TOP_BAR, NAME, CLOCK, BADGE, FIGURE, BUBBLE, CELEBRATION } from "../square.js";
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
  assert.equal(yes.y, PANEL.y + 136 + 68);
  assert.equal(PANEL.y + PANEL.h - (yes.y + yes.h), 20, "the bottom row keeps 20 px to the panel's edge");
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

test("a tap on the top bar shows the display about itself, on the panel the next card", () => {
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

// A renderer that records what is drawn instead of drawing it (text is 10 px a character).
function recorder() {
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => ((t[k] = v), true) });
  const calls = [];
  return {
    calls, ctx, k: 1, canvas: { width: 480, height: 480 },
    begin() {}, fill() {}, roundRectPath() {}, ringArc() {}, line() {},
    width: (text) => String(text).length * 10,
    widthOf: () => (text) => String(text).length * 10,
    print: (x, y, font, color, align, text) => calls.push({ op: "print", x, y, font, align, text }),
    roundRect: (x, y, w, h, radius) => calls.push({ op: "rect", x, y, w, h, radius }),
    circle: (x, y, radius) => calls.push({ op: "circle", x, y, radius }),
  };
}

function frame(d, at) {
  const r = recorder();
  const fig = { draws: [], draw(_r, sub, t, x, y, step, size) { this.draws.push({ sub, x, y, size }); } };
  d.figure = fig;
  new SquareView().render(r, d, at, new Date(2026, 9, 24, 12, 0));
  return { calls: r.calls, figure: fig.draws, texts: r.calls.filter((c) => c.op === "print").map((c) => c.text) };
}

test("the ready screen: the top bar like the box's, the figure, and Bereit once in the bubble", () => {
  const { d, clock } = make();
  const { calls, figure, texts } = frame(d, clock.t);
  assert.equal(texts.filter((t) => t === "Bereit").length, 1, "the status shows once");
  const name = calls.find((c) => c.text === "Muse");
  assert.deepEqual([name.x, name.y, name.align], [NAME.x, NAME.y + NAME.h / 2, "CL"]);
  const time = calls.find((c) => c.text === "12:00");
  assert.deepEqual([time.x, time.y, time.align], [CLOCK.x + CLOCK.w / 2, CLOCK.y + CLOCK.h / 2, "C"]);
  assert.ok(calls.some((c) => c.op === "circle" && c.x === 450 && c.y === 32 && c.radius === 6), "the connection dot");
  assert.deepEqual(figure[0], { sub: "idle", x: FIGURE.x, y: FIGURE.y, size: FIGURE.size });
  // Figure, 16 px gap and bubble are centred in the area under the top bar (y 62 to 480).
  assert.deepEqual([FIGURE.x, FIGURE.y, FIGURE.size], [100, 97, 280]);
  assert.equal(BUBBLE.y, FIGURE.y + FIGURE.size + 16);
  assert.equal(FIGURE.y - TOP_BAR.h, 480 - (BUBBLE.y + BUBBLE.h), "as much room above as below");
  const bubble = calls.find((c) => c.op === "rect" && c.w === BUBBLE.w);
  assert.deepEqual([bubble.x, bubble.y, bubble.h, bubble.radius], [105, 393, 52, 26]);
  const label = calls.find((c) => c.text === "Bereit");
  assert.deepEqual([label.x, label.y], [BUBBLE.x + 147, BUBBLE.y + 26]);
  assert.ok(calls.every((c) => c.op !== "rect" || c.y >= TOP_BAR.h), "no pill in the top bar");
});

test("a card: the timer chip and +N right after the name, the content below the top bar", () => {
  const { d, clock } = make();
  d.dispatch("show_timer", { label: "Tee", duration: "5 min" });
  d.dispatch("show_text", { title: "A", message: "a" });
  d.dispatch("show_text", { title: "B", message: "b" });
  d.tick();
  assert.equal(d.mode, 11);
  d.next();
  assert.equal(d.mode, 1);
  const { calls, figure } = frame(d, clock.t);
  const chips = calls.filter((c) => c.op === "rect" && c.y === BADGE.y && c.h === BADGE.h);
  assert.equal(chips.length, 2, "timer chip and queue badge");
  assert.equal(chips[0].x, BADGE.x);
  assert.equal(chips[1].x, chips[0].x + chips[0].w + BADGE.gap);
  assert.ok(calls.some((c) => c.text === "+1"));
  const time = calls.find((c) => c.text === "12:00");
  assert.ok(time.x - 25 >= chips[1].x + chips[1].w + 12, "the clock moves right of both chips");
  assert.deepEqual([figure[0].sub, figure[0].x, figure[0].y], ["avatar", 24, 72]);
  assert.ok(calls.some((c) => c.op === "rect" && c.x === 24 && c.y === 176 && c.w === 432 && c.h === 280), "the panel");
  assert.equal(PANEL.x, 480 - (PANEL.x + PANEL.w), "equal margins left and right");
  assert.equal(480 - (PANEL.y + PANEL.h), PANEL.x, "the bottom margin equals the side margins");
});

test("the celebration: title and message in the bubble's place, no bubble", () => {
  const { d, clock } = make();
  d.dispatch("celebrate", { title: "Geschafft", message: "Alles erledigt" });
  assert.equal(d.mode, 3);
  const { calls, texts } = frame(d, clock.t);
  const title = calls.find((c) => c.text === "Geschafft");
  assert.deepEqual([title.x, title.y, title.align], [240, CELEBRATION.titleY, "TC"]);
  const body = calls.find((c) => c.text === "Alles erledigt");
  assert.deepEqual([body.x, body.y], [240, CELEBRATION.bodyY]);
  assert.deepEqual([CELEBRATION.titleY, CELEBRATION.bodyY], [385, 437]);
  assert.ok(CELEBRATION.titleY >= FIGURE.y + FIGURE.size, "the title sits below the figure");
  assert.ok(CELEBRATION.bodyY + 26 <= 480, "the message fits on the screen");
  assert.ok(!texts.includes("Bereit"));
  assert.ok(!calls.some((c) => c.op === "rect" && c.w === BUBBLE.w));
});
