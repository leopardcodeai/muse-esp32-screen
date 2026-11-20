// tile.test.js: Muse OS's tile mode (the canvas as a small square, square.js TILE): what
// a frame draws with `display.tile` on, that nothing changes with it off, and what rests
// meanwhile: the camera card's boxes and their detector, not the pose tracker. Also the
// card's three views.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Display } from "../display.js";
import { SquareView, TILE, FIGURE, BUBBLE, TOP_BAR, tileDotColor, tileCardKind, connectionColor } from "../square.js";
import { PILLS } from "../tables.js";
import { Camera, cameraView } from "../camera.js";

function make() {
  const clock = { t: 100000 };
  const media = { state: "none", show() { this.state = "loading"; }, hide() { this.state = "none"; } };
  const d = new Display({
    renderer: {}, figure: {}, weather: {}, media, layout: "square",
    now: () => clock.t,
    clock: () => new Date(2026, 9, 24, 12, 0),
    sound: { ask() {}, chime() {} },
  });
  d.connection = "on";
  return { d, clock };
}

// A renderer that records what is drawn instead of drawing it (text is `charW` px a
// character, 10 unless a test wants wide text).
function recorder(charW = 10) {
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => ((t[k] = v), true) });
  const calls = [];
  return {
    calls, ctx, k: 1, canvas: { width: 480, height: 480 },
    begin() {}, fill() {}, roundRectPath() {}, roundRectOutline() {}, ringArc() {}, line() {},
    width: (text) => String(text).length * charW,
    widthOf: () => (text) => String(text).length * charW,
    print: (x, y, font, color, align, text) => calls.push({ op: "print", x, y, font, color, align, text }),
    roundRect: (x, y, w, h, radius) => calls.push({ op: "rect", x, y, w, h, radius }),
    circle: (x, y, radius, color) => calls.push({ op: "circle", x, y, radius, color }),
  };
}

function frame(d, at, view = new SquareView(), charW = 10) {
  const r = recorder(charW);
  // The figure counts as a picture (frames has every pose), so a still frame stays still.
  const fig = {
    draws: [], frames: { size: 6, get: () => ({}) },
    draw(_r, sub, t, x, y, step, size) { this.draws.push({ sub, x, y, size }); },
  };
  d.figure = fig;
  const drew = view.render(r, d, at, new Date(2026, 9, 24, 12, 0));
  return { drew, calls: r.calls, figure: fig.draws, texts: r.calls.filter((c) => c.op === "print").map((c) => c.text) };
}

test("the tile's ready screen: no top bar text, no bubble, the figure fills the square, one dot", () => {
  const { d, clock } = make();
  d.tile = true;
  const { calls, figure, texts } = frame(d, clock.t);
  assert.deepEqual(texts, [], "no name, no clock, no Bereit");
  assert.ok(!calls.some((c) => c.op === "rect" && c.w === BUBBLE.w), "no bubble");
  assert.deepEqual(figure[0], { sub: "idle", ...TILE.figure });
  assert.ok(TILE.figure.size >= 1.5 * FIGURE.size, "the figure is much larger than on the full screen");
  assert.ok(TILE.figure.x >= 0 && TILE.figure.y >= 0 && TILE.figure.x + TILE.figure.size <= 480 && TILE.figure.y + TILE.figure.size <= 480);
  const dot = calls.filter((c) => c.op === "circle").at(-1);
  assert.deepEqual([dot.x, dot.y, dot.radius], [TILE.dot.x, TILE.dot.y, TILE.dot.r]);
  assert.deepEqual(dot.color, PILLS[0].color, "green: ready and connected");
  assert.ok(TILE.dot.r * 2 * (184 / 480) >= 10, "the dot is 10 dp or more on a 184 dp tile");
});

test("without the tile flag the frame is the square layout's own", () => {
  const { d, clock } = make();
  const { texts, figure } = frame(d, clock.t);
  assert.ok(texts.includes("Muse") && texts.includes("12:00") && texts.includes("Bereit"));
  assert.deepEqual(figure[0], { sub: "idle", x: FIGURE.x, y: FIGURE.y, size: FIGURE.size });
  assert.equal(d.tile, false, "off by default");
});

test("switching the tile on or off redraws a still picture", () => {
  const { d, clock } = make();
  const view = new SquareView();
  // Past the 220 ms slide in, at one moment: only the flag changes between the frames.
  const at = clock.t + 5000;
  assert.equal(frame(d, clock.t, view).drew, true, "the first frame slides in");
  assert.equal(frame(d, at, view).drew, true, "the first still frame");
  assert.equal(frame(d, at, view).drew, false, "nothing moved");
  d.tile = true;
  const on = frame(d, at, view);
  assert.equal(on.drew, true);
  assert.deepEqual(on.texts, []);
  assert.equal(frame(d, at, view).drew, false, "and the tile's picture is still too");
  d.tile = false;
  const off = frame(d, at, view);
  assert.equal(off.drew, true);
  assert.ok(off.texts.includes("Bereit"), "restored");
});

test("tileDotColor(): the connection while it is missing, else the status", () => {
  assert.deepEqual(tileDotColor({ connection: "off", status: 0 }), connectionColor("off"));
  assert.deepEqual(tileDotColor({ connection: "connecting", status: 2 }), connectionColor("connecting"));
  assert.deepEqual(tileDotColor({ connection: "on", status: 0 }), PILLS[0].color);
  assert.deepEqual(tileDotColor({ connection: "on", status: 1 }), PILLS[1].color);
  assert.deepEqual(tileDotColor({ connection: "demo", status: 4 }), PILLS[4].color);
  assert.deepEqual(tileDotColor({ connection: "on", status: 99 }), PILLS[0].color);
});

test("the tile's status poses stay: thinking shows the working figure and its dot pulses", () => {
  const { d, clock } = make();
  d.tile = true;
  d.setStatus("thinking");
  const { calls, figure } = frame(d, clock.t + 300);
  assert.equal(figure[0].sub, "working");
  const dot = calls.filter((c) => c.op === "circle").at(-1);
  assert.deepEqual(dot.color, PILLS[2].color);
  assert.ok(dot.radius > TILE.dot.r && dot.radius <= TILE.dot.r * 1.25, "it pulses");
});

test("tileCardKind(): pictures stay whole, numbers get large, the rest is a title", () => {
  assert.equal(tileCardKind(5), "full");
  assert.equal(tileCardKind(7), "full");
  assert.equal(tileCardKind(9), "full");
  assert.equal(tileCardKind(2), "value");
  assert.equal(tileCardKind(4), "value");
  assert.equal(tileCardKind(11), "timer");
  for (const m of [1, 6, 8, 10, 12, 13]) assert.equal(tileCardKind(m), "title", String(m));
});

test("a text card in the tile: the avatar and the title in large type, no body", () => {
  const { d, clock } = make();
  d.tile = true;
  d.dispatch("show_text", { title: "Erinnerung", message: "Sam kommt um 18:30." });
  const { texts, figure, calls } = frame(d, clock.t + 1000);
  assert.deepEqual(texts, ["Erinnerung"]);
  assert.equal(figure[0].sub, "avatar");
  assert.equal(figure[0].size, TILE.disc.size);
  const title = calls.find((c) => c.text === "Erinnerung");
  assert.match(title.font, /\b50px\b/, "50 px here is about 19 dp on the tile");
  assert.equal(title.x, 240, "centred");
  // The avatar and the title together are centred in the square.
  const top = figure[0].y, bottom = title.y + TILE.title.lineH / 2;
  assert.ok(Math.abs(top - (480 - bottom)) <= 1, `as much room above (${top}) as below (${480 - bottom})`);
});

test("a value and an event in the tile: one big number; a disc with the title", () => {
  const value = make();
  value.d.tile = true;
  value.d.dispatch("show_value", { label: "Wohnzimmer", value: "21,5", unit: "°C" });
  const v = frame(value.d, value.clock.t + 1000);
  assert.deepEqual(v.texts, ["Wohnzimmer", "21,5", "°C"]);
  assert.match(v.calls.find((c) => c.text === "21,5").font, /\b150px\b/);
  const long = make();
  long.d.tile = true;
  long.d.dispatch("show_value", { label: "Zähler", value: "1234567", unit: "kWh" });
  const l = frame(long.d, long.clock.t + 1000, new SquareView(), 80);
  const px = Number(/(\d+)px/.exec(l.calls.find((c) => /^\d+$/.test(c.text)).font)[1]);
  assert.ok(px < 150 && px >= 48, `a long number is set smaller (${px} px) to fit the width`);

  const event = make();
  event.d.tile = true;
  event.d.dispatch("show_event", { icon: "klingel", title: "Es klingelt", message: "Jemand steht vor der Tür." });
  const e = frame(event.d, event.clock.t + 1000);
  assert.equal(e.figure.length, 0, "a disc instead of the avatar");
  assert.ok(e.calls.some((c) => c.op === "circle" && c.radius === TILE.disc.size / 2), "the disc");
  assert.ok(e.texts.includes("Es klingelt"));
  assert.ok(!e.texts.some((t) => /Jemand/.test(t)), "no body");
});

test("a timer in the tile: the time left large, and a chip on the ready screen", () => {
  const { d, clock } = make();
  d.tile = true;
  d.dispatch("show_timer", { label: "Tee", duration: "5 min" });
  d.tick();
  assert.equal(d.mode, 11);
  const card = frame(d, clock.t + 1000);
  assert.deepEqual(card.texts.slice(0, 2), ["Tee", "5:00"]);
  d.next();
  assert.equal(d.mode, 0);
  const idle = frame(d, clock.t + 2000);
  assert.deepEqual(idle.texts, ["5:00"], "only the chip's time");
  const chip = idle.calls.find((c) => c.op === "rect");
  assert.deepEqual([chip.x, chip.y, chip.h], [TILE.chip.x, TILE.chip.y, TILE.chip.h]);
});

test("a celebration in the tile: the figure and the title, no message", () => {
  const { d, clock } = make();
  d.tile = true;
  d.dispatch("celebrate", { title: "Geschafft!", message: "Alle Aufgaben erledigt." });
  const { texts, figure } = frame(d, clock.t + 1000);
  assert.deepEqual(texts, ["Geschafft!"]);
  assert.deepEqual(figure[0], { sub: "confetti", ...TILE.celebration.figure });
});

test("a picture card in the tile keeps its panel (the picture fills it anyway)", () => {
  const { d, clock } = make();
  d.tile = true;
  d.dispatch("show_image", { title: "Bild", message: "Text", url: "http://x/y.jpg" });
  const { calls, texts } = frame(d, clock.t + 1000);
  assert.ok(calls.some((c) => c.op === "rect" && c.x === 24 && c.y === 176 && c.w === 432 && c.h === 280), "the panel");
  assert.ok(texts.includes("Bild"));
  assert.ok(!texts.includes("12:00"), "still no top bar");
  assert.ok(TOP_BAR.h > 0);
});

// ------------------------------------------------------------- the camera card --

test("cameraView(): one row without a stream, a thumbnail while following, full with boxes", () => {
  assert.equal(cameraView(), "off");
  assert.equal(cameraView({ on: false, boxes: true, expanded: true }), "off");
  assert.equal(cameraView({ on: true }), "thumb");
  assert.equal(cameraView({ on: true, boxes: true }), "full");
  assert.equal(cameraView({ on: true, expanded: true }), "full", "a tap enlarges it");
  assert.equal(cameraView({ on: true, vision: true }), "full", "a Vision answer needs the room");
});

function fakeCamera() {
  const ops = [];
  const ctx = { setTransform() {}, clearRect: (...a) => ops.push(["clearRect", ...a]), strokeRect: (...a) => ops.push(["strokeRect", ...a]), fillRect() {}, fillText() {}, measureText: () => ({ width: 40 }) };
  const view = { listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; } };
  const elements = {
    root: { dataset: {}, hidden: false },
    view,
    video: { clientWidth: 320, clientHeight: 180, videoWidth: 1280, videoHeight: 720, readyState: 4 },
    boxes: { width: 320, height: 180, getContext: () => ctx },
  };
  const clock = { t: 10000 };
  const cam = new Camera({ elements, now: () => clock.t });
  return { cam, elements, ops, clock };
}

test("the card's view follows the stream, the boxes and a tap on the picture", () => {
  const { cam, elements } = fakeCamera();
  cam.setOptions({ personBoxes: false });
  assert.equal(elements.root.dataset.view, "off");
  cam.on = true;
  cam.syncView();
  assert.equal(elements.root.dataset.view, "thumb");
  elements.view.listeners.click();
  assert.equal(elements.root.dataset.view, "full");
  elements.view.listeners.click();
  assert.equal(elements.root.dataset.view, "thumb");
  cam.personBoxes = true;
  cam.syncView();
  assert.equal(elements.root.dataset.view, "full");
});

test("setPreviewVisible(false): no boxes drawn, no object detection; the pose tracker is untouched", () => {
  const { cam, ops, clock } = fakeCamera();
  const person = { boundingBox: { originX: 100, originY: 100, width: 300, height: 400 }, categories: [{ categoryName: "person", score: 0.9 }] };
  let detections = 0;
  globalThis.document = { hidden: false };
  try {
    cam.on = true;
    cam.personBoxes = true;
    cam.detector = { detect: () => { detections++; return { detections: [person] }; } };
    cam.detect();
    assert.equal(detections, 1);
    assert.ok(ops.some((o) => o[0] === "strokeRect"), "a box is drawn while the card is visible");

    const followTimer = {};
    cam.poseTimer = followTimer;
    cam.followMe = true;
    cam.setPreviewVisible(false);
    assert.equal(cam.previewVisible, false);
    assert.equal(ops.at(-1)[0], "clearRect", "the boxes are cleared");
    ops.length = 0;
    clock.t += 5000;
    cam.detect();
    assert.equal(detections, 1, "the detector rests");
    cam.drawBoxes();
    assert.equal(ops.length, 0, "nothing is drawn");
    assert.equal(cam.poseTimer, followTimer, "the pose loop keeps its timer");
    assert.equal(cam.followMe, true);
    assert.equal(cam.on, true, "the camera stays on");

    cam.setPreviewVisible(true);
    assert.ok(ops.some((o) => o[0] === "strokeRect"), "back: the last boxes are drawn again");
    clock.t += 5000;
    cam.detect();
    assert.equal(detections, 2, "and the detector runs again");
    cam.setPreviewVisible(true);
    assert.equal(cam.previewVisible, true);
  } finally {
    cam.poseTimer = null;
    delete globalThis.document;
  }
});
