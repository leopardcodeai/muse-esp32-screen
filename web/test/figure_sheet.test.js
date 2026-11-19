// figure_sheet.test.js: the compact figure format of 1.8.23 (one WebP sheet per pose, its
// layout in the XMP chunk), the start pose that draws in the first frame, and the PNG
// fallback for folders from before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sniffFormat, webpXmp, parseSheetMeta, sheetCell, decodeSheet, decodeFigure } from "../figure_sheet.js";
import { FigureSource, FIGURE_NAMES, poseUrls, frameUrl, fetchOptions, START_POSE } from "../figure_frames.js";

// A minimal WebP container: RIFF, WEBP, a VP8X chunk, an optional XMP chunk, a dummy VP8.
function webp(xmp = "") {
  const chunks = [];
  const add = (type, data) => {
    const head = new Uint8Array(8);
    head.set([...type].map((c) => c.charCodeAt(0)));
    new DataView(head.buffer).setUint32(4, data.length, true);
    chunks.push(head, data);
    if (data.length & 1) chunks.push(new Uint8Array(1));
  };
  add("VP8X", new Uint8Array(10));
  if (xmp) add("XMP ", new TextEncoder().encode(xmp));
  add("VP8 ", new Uint8Array(3));
  const body = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(12 + body);
  out.set([..."RIFF"].map((c) => c.charCodeAt(0)));
  new DataView(out.buffer).setUint32(4, 4 + body, true);
  out.set([..."WEBP"].map((c) => c.charCodeAt(0)), 8);
  let at = 12;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
const SHEET = '<x:xmpmeta xmlns:x="adobe:ns:meta/" muse-sheet="frames=5 columns=3 size=320 delay=41.667"/>';

test("sniffFormat tells PNG from WebP", () => {
  assert.equal(sniffFormat(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])), "png");
  assert.equal(sniffFormat(webp()), "webp");
  assert.equal(sniffFormat(new TextEncoder().encode("<html>")), "");
});

test("the sheet layout comes from the XMP chunk; without it a WebP is one still", () => {
  assert.ok(webpXmp(webp(SHEET)).includes("muse-sheet"));
  assert.deepEqual(parseSheetMeta(webp(SHEET)), { frames: 5, columns: 3, size: 320, delayMs: 41.667 });
  assert.equal(parseSheetMeta(webp()), null);
  assert.equal(parseSheetMeta(webp("odd")), null, "an odd-length chunk is padded and still parsed");
  assert.equal(parseSheetMeta(webp('muse-sheet="frames=0 columns=1 size=320"')), null, "nonsense is a still");
  assert.equal(parseSheetMeta(webp('muse-sheet="frames=4 columns=9 size=320"')), null, "more columns than frames");
  assert.deepEqual(sheetCell(0, 3, 320), { sx: 0, sy: 0 });
  assert.deepEqual(sheetCell(4, 3, 320), { sx: 320, sy: 320 });
});

test("decodeSheet cuts the cells in order and closes the sheet; a still stays one picture", async () => {
  const cuts = [];
  let closed = false;
  const createBitmap = async (src, ...rect) => {
    if (src instanceof Blob) return { sheet: true, close: () => { closed = true; } };
    cuts.push(rect);
    return `cell@${rect[0]},${rect[1]}`;
  };
  const frames = await decodeSheet(webp(SHEET), { createBitmap });
  assert.deepEqual([...frames], ["cell@0,0", "cell@320,0", "cell@640,0", "cell@0,320", "cell@320,320"]);
  assert.ok(cuts.every((r) => r[2] === 320 && r[3] === 320));
  assert.equal(frames.delayMs, 42);
  assert.equal(closed, true, "the big sheet bitmap is released");
  const still = await decodeSheet(webp(), { createBitmap });
  assert.equal(still.length, 1);
  assert.equal(still.delayMs, 0);
  await assert.rejects(decodeFigure(new TextEncoder().encode("<html>")), /neither PNG nor WebP/);
});

test("pose URLs: the sheet WebP first, the animated PNG as the fallback", () => {
  assert.equal(frameUrl("./local", "idle", false, "webp"), "./local/muse_idle.webp");
  assert.deepEqual(poseUrls("./local", "idle", true), ["./local/dark/muse_idle.webp", "./local/dark/muse_idle.png"]);
  assert.deepEqual(poseUrls("./local", "avatar", true),
    ["./local/muse_avatar.webp", "./local/muse_avatar.png", "./local/dark/muse_avatar.webp", "./local/dark/muse_avatar.png"]);
  assert.equal(fetchOptions(START_POSE).priority, "high");
});

// A fetch whose answers the test releases: `answer(url, ok)` resolves that request.
function gatedFetch() {
  const asked = [];
  const gates = new Map();
  const fetchImpl = (url) => {
    asked.push(url);
    return new Promise((resolve) => gates.set(url, resolve));
  };
  const answer = async (url, ok = true) => {
    gates.get(url)(ok ? { ok: true, arrayBuffer: async () => new TextEncoder().encode(url).buffer } : { ok: false, status: 404 });
    for (let i = 0; i < 8; i++) await Promise.resolve();
  };
  return { asked, fetchImpl, answer };
}
const decodeUrl = async (bytes) => {
  const url = new TextDecoder().decode(bytes);
  return url.includes("start") ? [url + "#0"] : [url + "#0", url + "#1", url + "#2"];
};
function drawRecorder() {
  const drawn = [];
  const ctx = { save() {}, restore() {}, beginPath() {}, fill() {}, arc() {}, drawImage: (img) => drawn.push(img) };
  return { r: { ctx }, drawn };
}

test("cold start: the start pose draws first, the animated idle replaces it", async () => {
  const gate = gatedFetch();
  const lines = [];
  let clock = 0;
  const src = new FigureSource({ fetchImpl: gate.fetchImpl, decode: decodeUrl, log: (l) => lines.push(l), now: () => clock });
  const done = src.use("./local", { name: "Muse" });
  assert.deepEqual(gate.asked, ["./local/muse_start.webp", "./local/muse_idle.webp", "./local/muse_avatar.webp"],
    "the start pose, idle's sheet and the avatar go at once");
  const ready = src.whenReady("idle");
  clock = 40;
  await gate.answer("./local/muse_start.webp");
  assert.equal(await ready, true, "the first frame does not wait for idle's sheet");
  assert.equal(src.starting, true);
  const { r, drawn } = drawRecorder();
  src.draw(r, "idle", 5000, 0, 0);
  src.draw(r, "wave", 0, 0, 0);
  assert.deepEqual(drawn, ["./local/muse_start.webp#0", "./local/muse_start.webp#0"],
    "idle and the poses that borrow it show the still; no placeholder, no dot");
  assert.equal(src.moving("idle"), false);
  assert.equal(gate.asked.length, 3, "the big poses still wait for idle's file");

  clock = 300;
  await gate.answer("./local/muse_idle.webp");
  assert.equal(src.starting, false);
  drawn.length = 0;
  src.draw(r, "idle", 0, 0, 0);
  assert.deepEqual(drawn, ["./local/muse_idle.webp#0"], "the animated idle took over");
  assert.deepEqual(gate.asked.slice(3).sort(), ["confetti", "making", "wave", "working"].map((n) => `./local/muse_${n}.webp`));
  for (const n of ["avatar", "wave", "working", "making", "confetti"]) await gate.answer(`./local/muse_${n}.webp`);
  const result = await done;
  assert.deepEqual([result.loaded, result.failed], [6, []]);
  assert.ok(lines.includes("figure start pose ready after 40 ms"));
  assert.ok(lines.includes("figure idle animated after 300 ms (3 frames)"));
});

test("a start pose that comes after idle is ignored", async () => {
  const gate = gatedFetch();
  const src = new FigureSource({ fetchImpl: gate.fetchImpl, decode: decodeUrl });
  const done = src.use("./local");
  await gate.answer("./local/muse_idle.webp");
  await gate.answer("./local/muse_start.webp");
  assert.equal(src.frames.get("idle")[0], "./local/muse_idle.webp#0");
  assert.equal(src.starting, false);
  for (const n of ["avatar", "wave", "working", "making", "confetti"]) await gate.answer(`./local/muse_${n}.webp`);
  await done;
});

test("a folder from before 1.8.23: no start pose, no WebP, the PNGs load as before", async () => {
  const asked = [];
  const lines = [];
  const src = new FigureSource({
    fetchImpl: async (url) => {
      asked.push(url);
      return url.endsWith(".png") ? { ok: true, arrayBuffer: async () => new TextEncoder().encode(url).buffer } : { ok: false, status: 404 };
    },
    decode: decodeUrl, log: (l) => lines.push(l),
  });
  const r = await src.use("./local", { name: "Muse" });
  assert.deepEqual([r.loaded, r.failed], [6, []]);
  for (const n of FIGURE_NAMES) assert.equal(src.frames.get(n)[0], `./local/muse_${n}.png#0`);
  assert.ok(asked.indexOf("./local/muse_idle.webp") < asked.indexOf("./local/muse_idle.png"));
  assert.ok(asked.indexOf("./local/muse_idle.png") < asked.indexOf("./local/muse_wave.webp"),
    "idle's head start holds until its PNG is in, not just until the WebP said 404");
  assert.deepEqual(lines, [], "a missing start pose or sheet is no error");
});

test("the service worker keeps the sheets and the start pose and serves WebP figure files", () => {
  const sw = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  assert.ok(sw.includes("./figure_sheet.js"), "figure_sheet.js is in the app shell");
  assert.ok(sw.includes('"start", "idle"'), "the start pose is cached at install");
  assert.ok(sw.includes("(?:png|webp)"), "WebP figure files are answered from the cache");
});
