// composer.test.js: the pure logic of the rail's composer (composer.js): its state, the
// hint line, the send button, the microphone level and its wave, the last exchange; and
// that the page carries the composer's parts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  COMPOSER_STATES, WAVE_BARS, HISTORY_MAX, composerState, composerHint, canSend, levelOf, levelOfChunks,
  smoothLevel, waveBars, clip, LastExchange,
} from "../composer.js";

test("composerState(): the voice state wins while the microphone or the speaker is busy", () => {
  assert.equal(composerState(), "idle");
  assert.equal(composerState({ voice: "listening", busy: true }), "listening");
  assert.equal(composerState({ voice: "speaking", textError: "x" }), "speaking");
  assert.equal(composerState({ voice: "idle", busy: true }), "thinking", "a typed question waits");
  assert.equal(composerState({ voice: "thinking" }), "thinking");
  assert.equal(composerState({ voice: "error", busy: true }), "thinking", "a new question replaces the old error");
  assert.equal(composerState({ voice: "idle", textError: "Muse antwortet nicht" }), "error");
  assert.equal(composerState({ voice: "error" }), "error");
  assert.equal(composerState({ voice: "nonsense" }), "idle");
  assert.ok(COMPOSER_STATES.includes("off"));
});

test("composerHint(): German, one line per state", () => {
  assert.equal(composerHint("idle"), "Mikrofon halten oder schreiben");
  assert.equal(composerHint("idle", { voiceOn: false }), "Schreib an Muse, Enter sendet");
  assert.equal(composerHint("idle", { connected: false }), "Keine Verbindung zu Home Assistant");
  assert.equal(composerHint("idle", { demo: true, connected: false }), "Demo ohne Antworten");
  assert.equal(composerHint("listening"), "Ich höre … Loslassen sendet");
  assert.equal(composerHint("thinking", { connected: false }), "Muse denkt …");
  assert.equal(composerHint("speaking"), "Muse spricht");
  assert.equal(composerHint("error", { detail: "Mikrofon nicht erlaubt" }), "Mikrofon nicht erlaubt");
  assert.equal(composerHint("error"), "Das hat nicht geklappt");
  for (const s of COMPOSER_STATES) assert.ok(!/[–—]/.test(composerHint(s)), `${s}: no dash`);
});

test("canSend(): text, a connection and nothing under way", () => {
  assert.equal(canSend("Hallo"), true);
  assert.equal(canSend(""), false);
  assert.equal(canSend("   \n"), false, "blank is empty");
  assert.equal(canSend(null), false);
  assert.equal(canSend("Hallo", { busy: true }), false);
  assert.equal(canSend("Hallo", { connected: false }), false);
  assert.equal(canSend("Hallo", { state: "listening" }), false);
  assert.equal(canSend("Hallo", { state: "thinking" }), false);
  assert.equal(canSend("Hallo", { state: "speaking" }), true, "the next question may go while Muse speaks");
  assert.equal(canSend("Hallo", { state: "error" }), true);
});

test("levelOf(): silence is 0, loud speech is 1, in between by decibels", () => {
  assert.equal(levelOf(null), 0);
  assert.equal(levelOf(new Float32Array(128)), 0);
  assert.equal(levelOf(new Float32Array(128).fill(0.0005)), 0, "below -60 dB");
  assert.equal(levelOf(new Float32Array(128).fill(0.5)), 1, "above -12 dB");
  const quiet = levelOf(new Float32Array(128).fill(0.01));
  const loud = levelOf(new Float32Array(128).fill(0.1));
  assert.ok(quiet > 0.3 && quiet < 0.5, `-40 dB is ${quiet}`);
  assert.ok(loud > quiet && loud < 1);
  assert.equal(levelOf(new Float32Array(128).fill(-0.1)), loud, "the sign does not matter");
});

test("levelOfChunks(): the newest chunks only", () => {
  assert.equal(levelOfChunks([]), 0);
  assert.equal(levelOfChunks(null), 0);
  const loud = new Float32Array(128).fill(0.2);
  const silent = new Float32Array(128);
  const old = Array.from({ length: 20 }, () => loud);
  assert.equal(levelOfChunks([...old, ...Array.from({ length: 8 }, () => silent)]), 0, "old speech has faded");
  assert.equal(levelOfChunks([silent, loud], 1), levelOf(loud));
  assert.ok(levelOfChunks([silent, loud], 2) < levelOf(loud), "the mean over both");
  assert.equal(levelOfChunks([null, new Float32Array(0)]), 0);
});

test("smoothLevel(): fast up, slow down, inside 0..1", () => {
  const up = smoothLevel(0, 1);
  const down = smoothLevel(1, 0);
  assert.ok(up > 0.5, "more than half the way up in one step");
  assert.ok(down > 0.8, "a tenth of the way down");
  assert.equal(smoothLevel(0.4, 0.4), 0.4);
  assert.equal(smoothLevel(NaN, NaN), 0);
  assert.ok(smoothLevel(0, 7) <= 1);
  let v = 1;
  for (let i = 0; i < 200; i++) v = smoothLevel(v, 0);
  assert.ok(v < 0.001, "it reaches silence");
});

test("waveBars(): a floor in silence, highest in the middle, never outside 0..1", () => {
  const silent = waveBars(0, 0);
  assert.equal(silent.length, WAVE_BARS);
  assert.ok(silent.every((h) => h === 0.14), "a row of dots");
  // The mean over a swing period: the middle bar is higher than the outer ones.
  const mean = (i) => {
    let s = 0;
    for (let t = 0; t < 700; t += 10) s += waveBars(1, t)[i];
    return s / 70;
  };
  const mid = Math.floor(WAVE_BARS / 2);
  assert.ok(mean(mid) > mean(0) + 0.2 && mean(mid) > mean(WAVE_BARS - 1) + 0.2);
  for (const level of [0, 0.3, 1, 5, -1, NaN]) {
    for (const t of [0, 123, 99999]) assert.ok(waveBars(level, t).every((h) => h >= 0.14 && h <= 1), `${level} at ${t}`);
  }
  assert.deepEqual(waveBars(0.6, 500), waveBars(0.6, 500), "deterministic");
  assert.notDeepEqual(waveBars(0.6, 500), waveBars(0.6, 560), "it moves with the time");
  assert.equal(waveBars(0.5, 0, 5).length, 5);
  assert.equal(waveBars(0.5, 0, 0).length, 1);
});

test("clip(): one line, an ellipsis at the limit", () => {
  assert.equal(clip("  Hallo\n  Welt  "), "Hallo Welt");
  assert.equal(clip(null), "");
  const long = clip("a".repeat(500));
  assert.equal(long.length, HISTORY_MAX);
  assert.ok(long.endsWith("…"));
  assert.equal(clip("abcdef", 4), "abc…");
});

test("LastExchange: question, pending, answer, an answer on the display, a failure", () => {
  const ex = new LastExchange();
  assert.deepEqual(ex.view(), { visible: false, question: "", answer: "", tone: "" });
  assert.equal(ex.reply("ohne Frage"), false, "an answer needs a question");
  assert.equal(ex.ask("   "), false);
  assert.equal(ex.ask("Wie spät ist es?", "voice"), true);
  assert.equal(ex.source, "voice");
  assert.deepEqual(ex.view(), { visible: true, question: "Wie spät ist es?", answer: "…", tone: "pending" });
  ex.reply("Es ist 12 Uhr.");
  assert.deepEqual(ex.view(), { visible: true, question: "Wie spät ist es?", answer: "Es ist 12 Uhr.", tone: "answer" });
  // A new question drops the old answer.
  ex.ask("Und morgen?");
  assert.equal(ex.source, "text");
  assert.equal(ex.view().tone, "pending");
  ex.reply("");
  assert.equal(ex.view().tone, "card");
  assert.equal(ex.view().answer, "Antwort steht auf dem Display");
  ex.ask("Noch eine");
  ex.fail("Muse antwortet nicht");
  assert.deepEqual(ex.view(), { visible: true, question: "Noch eine", answer: "Muse antwortet nicht", tone: "error" });
  ex.ask("Leer");
  ex.fail();
  assert.equal(ex.view().answer, "Keine Antwort");
  ex.clear();
  assert.equal(ex.view().visible, false);
});

test("the page carries the composer: microphone beside the field, send disabled while empty", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const box = html.match(/<section id="rail-voice-box"[\s\S]*?<\/section>/);
  assert.ok(box, "the composer is one section");
  const order = ["rail-mic", "rail-text", "rail-text-input", "rail-wave", "rail-text-send", "rail-mic-label", "rail-voice-model", "rail-history"]
    .map((id) => box[0].indexOf(`id="${id}"`));
  assert.ok(order.every((i) => i > 0), "every part is there");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "in reading order");
  assert.match(box[0], /<input id="rail-text-input"[^>]*enterkeyhint="send"/, "Enter sends");
  assert.match(box[0], /<button id="rail-text-send" type="submit"[^>]*disabled/, "disabled until there is text");
  assert.match(box[0], /id="rail-mic-label" role="status" aria-live="polite"/, "the state line is announced");
  assert.match(html, /id="rail-time"/);
  assert.match(html, /id="rail-date"/);
  assert.match(html, /id="rail-mode-hint"/);
  const sw = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  assert.ok(sw.includes('"./composer.js"'), "composer.js is in the service worker's shell");
  const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.match(css, /#rail-voice-box\[data-state="listening"\] #rail-wave/);
  assert.match(css, /html\.muse-tile #rail \*/);
  assert.match(css, /#rail\[data-density="compact"\]/);
});
