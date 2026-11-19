// composer.js: the pure logic of the tablet rail's "talk to Muse" composer: one card
// with the push-to-talk button beside the text field, a state line, a live level wave
// while the microphone is open, and the last question with its answer below (owner,
// 19.11.2026: speak and write as one area, like the composer of iOS Messages).
//
// What exists as data, and nothing more: the voice state of voice.js (idle, listening,
// thinking, speaking, error), the microphone samples voice.js buffers while the button
// is held (the level comes from the newest chunk), the sentence Home Assistant's
// speech-to-text understood, the answer text of the conversation agent, and the typed
// question with its answer (textask.js). The last exchange lives in memory only: it is
// never stored and never sent anywhere.
//
// Pitfalls:
//  * No DOM here, so the Node tests can call everything; tablet.js writes the result
//    into the page.
//  * The level is a display value, not a measurement: decibels of the RMS mapped to
//    0..1, fast up and slow down, so speech moves the bars and silence lets them rest.
//  * A typed question has no voice state of its own; app.js passes `busy` while it waits
//    for the answer, which reads as "thinking" here.

export const COMPOSER_STATES = ["idle", "listening", "thinking", "speaking", "error", "off"];
export const WAVE_BARS = 21;
export const HISTORY_MAX = 220; // characters kept of a question or an answer

// The state the composer shows: the voice state, "thinking" while a typed question
// waits, and "error" for a typed question that failed.
export function composerState({ voice = "idle", busy = false, textError = "" } = {}) {
  const v = COMPOSER_STATES.includes(voice) ? voice : "idle";
  if (v === "listening" || v === "speaking") return v;
  if (busy || v === "thinking") return "thinking";
  if (textError) return "error";
  return v;
}

// The one hint line under the field, German. `detail` is the voice error's own text.
export function composerHint(state, { detail = "", voiceOn = true, connected = true, demo = false } = {}) {
  switch (state) {
    case "listening": return "Ich höre … Loslassen sendet";
    case "thinking": return "Muse denkt …";
    case "speaking": return "Muse spricht";
    case "error": return detail || "Das hat nicht geklappt";
    default: break;
  }
  if (demo) return "Demo ohne Antworten";
  if (!connected) return "Keine Verbindung zu Home Assistant";
  return voiceOn ? "Mikrofon halten oder schreiben" : "Schreib an Muse, Enter sendet";
}

// Whether the send button is live: text to send, a connection, nothing under way.
export function canSend(text, { busy = false, connected = true, state = "idle" } = {}) {
  if (busy || !connected) return false;
  if (state === "listening" || state === "thinking") return false;
  return String(text ?? "").trim().length > 0;
}

// The level of one chunk of samples (Float32, -1..1): the RMS in decibels, -60 dB and
// below is 0, -12 dB and above is 1.
export function levelOf(samples) {
  if (!samples || !samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / samples.length);
  if (!(rms > 0)) return 0;
  const db = 20 * Math.log10(rms);
  return Math.max(0, Math.min(1, (db + 60) / 48));
}

// The level of the newest `last` chunks of a growing list (voice.js pushes blocks of 128
// samples; eight of them are about 20 ms at 48 kHz).
export function levelOfChunks(chunks, last = 8) {
  if (!Array.isArray(chunks) || !chunks.length) return 0;
  let sum = 0;
  let n = 0;
  for (let c = Math.max(0, chunks.length - last); c < chunks.length; c++) {
    const samples = chunks[c];
    if (!samples || !samples.length) continue;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    n += samples.length;
  }
  if (!n) return 0;
  const rms = Math.sqrt(sum / n);
  if (!(rms > 0)) return 0;
  return Math.max(0, Math.min(1, (20 * Math.log10(rms) + 60) / 48));
}

// Fast attack, slow release, so the wave follows a syllable and does not flicker.
export function smoothLevel(previous, next) {
  const p = Number.isFinite(previous) ? previous : 0;
  const n = Math.max(0, Math.min(1, Number.isFinite(next) ? next : 0));
  return n > p ? p + (n - p) * 0.6 : p + (n - p) * 0.12;
}

// The heights (0..1) of the wave's bars for a level at time t (ms): highest in the
// middle, each bar swinging at its own phase; a floor keeps a row of dots in silence.
export function waveBars(level, t = 0, count = WAVE_BARS) {
  const n = Math.max(1, Math.floor(count));
  const l = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0));
  const bars = new Array(n);
  for (let i = 0; i < n; i++) {
    const pos = n === 1 ? 0 : (i / (n - 1)) * 2 - 1; // -1..1 across the row
    const envelope = 0.35 + 0.65 * Math.cos((pos * Math.PI) / 2) ** 2;
    const swing = 0.6 + 0.4 * Math.sin(t / 110 + i * 1.7);
    bars[i] = Math.max(0.14, Math.min(1, 0.14 + l * envelope * swing * 0.95));
  }
  return bars;
}

// One line of text for the history: whitespace folded, clipped with an ellipsis.
export function clip(text, max = HISTORY_MAX) {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, Math.max(1, max - 1)).trimEnd() + "…" : s;
}

// The last question and its answer, typed or spoken. ask() starts a new exchange (the
// old answer goes), answer() and fail() end it; view() is what the rail shows.
export class LastExchange {
  constructor() {
    this.question = "";
    this.answer = "";
    this.source = ""; // "text" or "voice"
    this.pending = false;
    this.failed = false;
  }

  ask(question, source = "text") {
    const q = clip(question);
    if (!q) return false;
    this.question = q;
    this.answer = "";
    this.source = source === "voice" ? "voice" : "text";
    this.pending = true;
    this.failed = false;
    return true;
  }

  reply(answer) {
    const a = clip(answer);
    if (!this.question) return false;
    this.pending = false;
    this.failed = false;
    // Muse often answers with a card and no text: the question stays, the line says so.
    this.answer = a;
    return true;
  }

  fail(message = "") {
    if (!this.question) return false;
    this.pending = false;
    this.failed = true;
    this.answer = clip(message) || "Keine Antwort";
    return true;
  }

  clear() {
    this.question = "";
    this.answer = "";
    this.source = "";
    this.pending = false;
    this.failed = false;
  }

  // {visible, question, answer, tone}: tone "pending", "error", "card" (answered on the
  // display without text) or "answer".
  view() {
    if (!this.question) return { visible: false, question: "", answer: "", tone: "" };
    if (this.pending) return { visible: true, question: this.question, answer: "…", tone: "pending" };
    if (this.failed) return { visible: true, question: this.question, answer: this.answer, tone: "error" };
    if (!this.answer) return { visible: true, question: this.question, answer: "Antwort steht auf dem Display", tone: "card" };
    return { visible: true, question: this.question, answer: this.answer, tone: "answer" };
  }
}
