// figure_frames.test.js: the dark folder URLs, the 60 fps blend between 6 fps frames, and
// the loading order of a figure style: nothing is drawn before the choice, nothing but
// the chosen set's pictures (or an empty place) on a screen with a folder, all six
// pictures requested at once with idle first, and each pose drawn as soon as it is decoded.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FigureSource, FIGURE_NAMES, frameUrl, frameBlend, fetchOptions, pulseAlpha, PULSE_DELAY_MS, SAME_SET,
} from "../figure_frames.js";
import { STEP_MS } from "../figure.js";

test("the dark theme loads the same six files under /dark", () => {
  assert.equal(frameUrl("https://ha/local", "idle"), "https://ha/local/muse_idle.png");
  assert.equal(frameUrl("https://ha/local/", "idle", true), "https://ha/local/dark/muse_idle.png");
  assert.equal(frameUrl("./local/winter", "wave", true), "./local/winter/dark/muse_wave.png");
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

// A fetch whose answers the test releases one by one: `answer(url)` resolves that request.
function gatedFetch({ missing = [] } = {}) {
  const asked = [];
  const gates = new Map();
  const fetchImpl = (url, opts) => {
    asked.push({ url, opts });
    return new Promise((resolve) => gates.set(url, resolve));
  };
  const answer = async (url) => {
    const ok = !missing.some((m) => url.endsWith(m));
    gates.get(url)(ok ? { ok: true, arrayBuffer: async () => new TextEncoder().encode(url).buffer } : { ok: false, status: 404 });
    for (let i = 0; i < 5; i++) await Promise.resolve(); // let the decode and the commit run
  };
  return { asked, fetchImpl, answer };
}
const decodeUrl = async (bytes) => {
  const url = new TextDecoder().decode(bytes);
  return [url + "#0", url + "#1", url + "#2"];
};
function drawRecorder() {
  const drawn = [];
  const arcs = [];
  const ctx = {
    save() {}, restore() {}, beginPath() {}, fill() {},
    arc: (x, y, rad) => arcs.push([x, y, rad]),
    drawImage: (img, x, y, w, h) => drawn.push([img, x, y, w, h]),
  };
  return { r: { ctx }, drawn, arcs };
}

test("before use() the source draws nothing at all, not even the placeholder", () => {
  const calls = [];
  const src = new FigureSource({ placeholder: { smooth: false, draw: (...a) => calls.push(a[1]) } });
  const { r, drawn } = drawRecorder();
  src.draw(r, "idle", 0, 80, 30);
  src.draw(r, "avatar", 0, 12, 32);
  assert.equal(src.mode, "none");
  assert.deepEqual([calls, drawn], [[], []]);
  assert.equal(src.moving("idle"), false, "nothing moves, the square view keeps its still picture");
});

test("a screen with a folder: idle first and high, the rest once idle is in; the placeholder never draws", async () => {
  const calls = [];
  let clock = 0;
  const gate = gatedFetch();
  const src = new FigureSource({
    placeholder: { smooth: false, draw: (...a) => calls.push(a[1]) },
    fetchImpl: gate.fetchImpl, decode: decodeUrl, now: () => clock,
  });
  const done = src.use("./local", { name: "Muse" });
  assert.equal(src.mode, "frames");
  assert.equal(src.loading, true, "loading starts synchronously, before the first frame");
  assert.deepEqual(gate.asked.map((a) => a.url), ["./local/muse_idle.png", "./local/muse_avatar.png"],
    "idle and the small avatar go at once; the big poses wait for idle's file");
  assert.equal(gate.asked[0].opts.priority, "high");
  assert.equal(gate.asked[1].opts.priority, "auto");
  assert.equal(src.describe(), "Muse lädt …");

  const { r, drawn, arcs } = drawRecorder();
  src.draw(r, "idle", 0, 100, 97, STEP_MS, 280);
  assert.deepEqual([drawn, arcs, calls], [[], [], []], "while loading: an empty place, no dot yet");
  assert.equal(src.moving("idle"), true, "the place may pulse, so the square view redraws");
  clock = PULSE_DELAY_MS + 400;
  src.draw(r, "idle", 0, 100, 97, STEP_MS, 280);
  assert.equal(arcs.length, 1, "after the delay a small dot pulses");
  assert.deepEqual(arcs[0].slice(0, 2), [240, 237], "in the middle of the figure's place");
  assert.ok(arcs[0][2] <= 8, "a small dot");
  src.draw(r, "avatar", 0, 12, 32);
  assert.equal(arcs.length, 1, "no dot on the small card avatar");

  const ready = src.whenReady("idle");
  await gate.answer("./local/muse_idle.png");
  assert.equal(await ready, true, "idle is ready before the other five answered");
  assert.deepEqual(gate.asked.map((a) => a.url).sort(), FIGURE_NAMES.map((n) => `./local/muse_${n}.png`).sort(),
    "with idle's file in, the four big poses are requested together");
  assert.ok(gate.asked.slice(2).every((a) => a.opts.priority === "auto"));
  drawn.length = 0;
  src.draw(r, "idle", 2 * STEP_MS, 100, 97, STEP_MS, 280);
  src.draw(r, "making", 0, 100, 97, STEP_MS, 280);
  assert.deepEqual(drawn.map((d) => d[0]), ["./local/muse_idle.png#2", "./local/muse_idle.png#0"],
    "idle at once; making borrows idle of the same set until its own arrive");
  assert.equal(src.moving("idle"), false);

  await gate.answer("./local/muse_avatar.png");
  for (const n of ["wave", "working", "making", "confetti"]) await gate.answer(`./local/muse_${n}.png`);
  const result = await done;
  assert.deepEqual([result.loaded, result.failed], [6, []]);
  assert.equal(src.describe(), "Muse, 6 von 6 Bildern");
  assert.deepEqual(calls, [], "the placeholder was never drawn");
});

test("a set that fails completely leaves the place empty and still; nothing stands in", async () => {
  const calls = [];
  const lines = [];
  const src = new FigureSource({
    placeholder: { smooth: false, draw: (...a) => calls.push(a[1]) },
    fetchImpl: async () => ({ ok: false, status: 404 }),
    decode: decodeUrl, log: (l) => lines.push(l), now: () => 10000,
  });
  const r0 = await src.use("./local", { name: "Muse" });
  assert.deepEqual([r0.loaded, r0.failed], [0, FIGURE_NAMES]);
  assert.equal(src.failedAll, true);
  const { r, drawn, arcs } = drawRecorder();
  for (const sub of FIGURE_NAMES) src.draw(r, sub, 0, 0, 0);
  assert.deepEqual([drawn, arcs, calls], [[], [], []]);
  assert.equal(src.moving("idle"), false, "no endless redraw of an empty place");
  assert.equal(lines.length, 6, "one log line per missing picture");
  assert.equal(src.describe(), "Muse nicht erreichbar, der Platz der Figur bleibt leer");
});

test("the dark theme takes the light avatar, its dark copy only as the fallback", async () => {
  const asked = [];
  const src = new FigureSource({
    fetchImpl: async (url) => {
      asked.push(url);
      if (url === "./local/muse_avatar.png") return { ok: false, status: 404 };
      return { ok: true, arrayBuffer: async () => new TextEncoder().encode(url).buffer };
    },
    decode: decodeUrl,
  });
  src.dark = true;
  await src.use("./local");
  assert.ok(asked.includes("./local/dark/muse_idle.png"));
  assert.deepEqual(asked.filter((u) => u.includes("avatar")), ["./local/muse_avatar.png", "./local/dark/muse_avatar.png"]);
  assert.equal(src.frames.get("avatar")[0], "./local/dark/muse_avatar.png#0");
});

test("a later use() makes the earlier one stale; use('') is the neutral placeholder", async () => {
  const gate = gatedFetch();
  const calls = [];
  const src = new FigureSource({ placeholder: { smooth: true, draw: (...a) => calls.push(a[1]) }, fetchImpl: gate.fetchImpl, decode: decodeUrl });
  const first = src.use("./local");
  const second = src.use("");
  assert.equal(src.mode, "placeholder");
  assert.equal(src.describe(), "neutraler Platzhalter");
  await gate.answer("./local/muse_idle.png");
  await gate.answer("./local/muse_avatar.png");
  assert.equal((await first).stale, true);
  assert.equal(gate.asked.length, 2, "a stale load asks for nothing more");
  await second;
  assert.equal(src.frames.size, 0, "the stale set never lands");
  const { r } = drawRecorder();
  src.draw(r, "idle", 0, 0, 0);
  assert.deepEqual(calls, ["idle"]);
  assert.equal(src.moving("idle"), true, "the placeholder moves on every frame");
});

test("loadDefault() is kept for the camera add-on and loads nothing", async () => {
  const asked = [];
  const src = new FigureSource({ fetchImpl: async (u) => { asked.push(u); return { ok: false }; } });
  assert.deepEqual(await src.loadDefault("/web/figure-default"), { loaded: 0, failed: [] });
  assert.deepEqual(asked, []);
  assert.equal(src.mode, "none", "still nothing chosen: nothing drawn until use()");
});

test("helpers: fetch options, the pulse and the same-set fallbacks", () => {
  assert.equal(fetchOptions("idle").priority, "high");
  assert.equal(fetchOptions("confetti").priority, "auto");
  assert.equal(fetchOptions("idle").credentials, "omit");
  assert.equal(pulseAlpha(0), 0);
  assert.equal(pulseAlpha(PULSE_DELAY_MS - 1), 0);
  for (let ms = PULSE_DELAY_MS; ms < PULSE_DELAY_MS + 3200; ms += 100) {
    const a = pulseAlpha(ms);
    assert.ok(a >= 0.15 && a <= 0.45, `subtle at ${ms} ms: ${a}`);
  }
  for (const name of FIGURE_NAMES) assert.ok(Array.isArray(SAME_SET[name]), name);
  assert.ok(!SAME_SET.idle.length, "idle borrows nothing");
});
