import { test } from "node:test";
import assert from "node:assert/strict";
import { Voice, resolveTtsUrl, responseText } from "../voice.js";

function fakeDisplay(version = 1) {
  const offered = [];
  return {
    version,
    offered,
    offer(card) { this.offered.push(card); this.version++; return { on_screen: true, waiting: 0 }; },
  };
}

function fakeHa(events = []) {
  return {
    calls: 0,
    async runPipeline({ audio, sampleRate, onEvent }) {
      this.calls++;
      assert.equal(sampleRate, 16000);
      assert.ok(audio.length > 0);
      for (const ev of events) onEvent(ev);
      return {};
    },
  };
}

const NORMAL = [
  { type: "stt-end", data: { stt_output: { text: "Hallo" } } },
  { type: "intent-end", data: { intent_output: { response: { speech: { plain: { speech: "Hallo Alex" } } } } } },
  { type: "tts-end", data: { tts_output: { url: "/api/tts_proxy/x.mp3" } } },
];

test("resolveTtsUrl(): relative URL against the HA base", () => {
  assert.equal(resolveTtsUrl("/api/tts_proxy/x.mp3", "https://ha:8322"), "https://ha:8322/api/tts_proxy/x.mp3");
  assert.equal(resolveTtsUrl("http://ha:8123/api/x", "https://ha:8322"), "http://ha:8123/api/x");
  assert.equal(resolveTtsUrl("", "https://ha:8322"), "");
});

test("responseText(): the plain speech, then the text field", () => {
  assert.equal(responseText({ response: { speech: { plain: { speech: "  Hi  " } } } }), "Hi");
  assert.equal(responseText({ response: { text: "Hi" } }), "Hi");
  assert.equal(responseText(null), "");
});

test("run(): thinking, answer, no TTS, fallback card when no action arrived", async () => {
  const display = fakeDisplay(1);
  const states = [];
  const said = [];
  const voice = new Voice({
    getHa: () => fakeHa(NORMAL),
    getDisplay: () => display,
    getSettings: () => ({ speak: false }),
    sounds: { playBuffer: async () => true },
    onState: (s) => states.push(s),
    say: (t) => said.push(t),
    fallbackMs: 10,
    urlBase: () => "https://ha:8322",
  });
  const ok = await voice.run(new Int16Array(1600));
  assert.equal(ok, true);
  assert.deepEqual(states, ["thinking", "thinking", "idle"]);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(display.offered.length, 1);
  assert.equal(display.offered[0].body, "Hallo Alex");
  assert.deepEqual(said, []);
});

test("run(): no fallback when a card arrived during the run", async () => {
  const display = fakeDisplay(1);
  const ha = {
    async runPipeline({ onEvent }) {
      for (const ev of NORMAL) {
        onEvent(ev);
        if (ev.type === "intent-end") display.version++;
      }
      return {};
    },
  };
  const voice = new Voice({
    getHa: () => ha,
    getDisplay: () => display,
    getSettings: () => ({ speak: false }),
    onState: () => {},
    fallbackMs: 10,
  });
  await voice.run(new Int16Array(1600));
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(display.offered.length, 0);
});

test("run(): a pipeline error becomes an error state", async () => {
  const display = fakeDisplay(1);
  const states = [];
  const said = [];
  const ha = fakeHa([{ type: "stt-end", data: { stt_output: { text: "" } } }, { type: "error", data: { message: "boom" } }]);
  const voice = new Voice({
    getHa: () => ha,
    getDisplay: () => display,
    getSettings: () => ({ speak: false }),
    onState: (s, d) => states.push([s, d]),
    say: (t) => said.push(t),
    fallbackMs: 10,
  });
  await voice.run(new Int16Array(1600));
  assert.ok(states.some(([s]) => s === "error"));
  assert.ok(said.includes("boom"));
});

test("setEnabled(false) cancels without a run", () => {
  const voice = new Voice({ onState: () => {} });
  voice.setEnabled(false);
  assert.equal(voice.state, "idle");
  assert.equal(voice.enabled, false);
});
