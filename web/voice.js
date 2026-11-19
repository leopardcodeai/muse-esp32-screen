// voice.js: push-to-talk with Home Assistant's Assist pipeline.
//
// The microphone is open only while the button is held. On release the buffered audio
// becomes 16 kHz PCM (pcm.js) and goes over the existing websocket to
// `assist_pipeline/run` (start `stt`, end `tts`). Home Assistant runs Whisper,
// conversation.muse and Piper; the `tts-end` URL is played through the speaker, and the
// existing Muse actions put the answer card on the screen. If no card arrives, a local
// fallback card shows the answer text.
//
// Pitfalls:
//  * AudioContext must be unlocked by the pointer press; start() is called from there.
//  * The pipeline sends events with the command id; ha.js routes them and sends the
//    buffered PCM when run-start names the binary handler.
//  * One run at a time. A denial or a network error becomes a German state, not a loop.
//  * The microphone capture uses the native sample rate; only the copy sent to HA is
//    resampled to 16 kHz.
//  * `chunks` is read from outside while the button is held (app.js takes the newest
//    one for the rail's level wave): keep pushing whole Float32Arrays to it.
import { makeCard } from "./queue.js";
import { mergeFloat32, downsample, toPcm16 } from "./pcm.js";

const MAX_MS = 30000;
const MIN_SAMPLES = 1600; // 0.1 s at 16 kHz: below that a press was a tap

const LABELS = {
  idle: "",
  listening: "Ich höre …",
  thinking: "Muse denkt …",
  speaking: "Muse spricht",
  error: "Mikrofon nicht verfügbar",
};

export function resolveTtsUrl(url, base) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw, String(base || "http://localhost/")).toString();
  } catch {
    return raw;
  }
}

// The spoken answer of an intent result, or "".
export function responseText(intentOutput) {
  const speech = intentOutput && intentOutput.response && intentOutput.response.speech
    && intentOutput.response.speech.plain && intentOutput.response.speech.plain.speech;
  if (typeof speech === "string") return speech.trim();
  const text = intentOutput && intentOutput.response && intentOutput.response.text;
  return typeof text === "string" ? text.trim() : "";
}

export class Voice {
  constructor(opts = {}) {
    this.getHa = opts.getHa || (() => null);
    this.getSettings = opts.getSettings || (() => ({}));
    this.getDisplay = opts.getDisplay || (() => null);
    this.sounds = opts.sounds || null;
    this.say = opts.say || (() => {});
    this.log = opts.log || (() => {});
    this.onState = opts.onState || (() => {});
    // The sentence speech-to-text understood and the agent's answer text, for the rail's
    // last question and answer (composer.js); both stay in the page.
    this.onHeard = opts.onHeard || (() => {});
    this.onReply = opts.onReply || (() => {});
    this.getUserMedia = opts.getUserMedia || ((constraints) => {
      const md = typeof navigator !== "undefined" ? navigator.mediaDevices : null;
      return md && md.getUserMedia ? md.getUserMedia(constraints) : Promise.reject(new Error("no microphone API"));
    });
    this.AudioContextImpl = opts.AudioContextImpl
      || (typeof AudioContext !== "undefined" ? AudioContext : null)
      || (typeof webkitAudioContext !== "undefined" ? webkitAudioContext : null);
    this.AudioWorkletNodeImpl = opts.AudioWorkletNodeImpl
      || (typeof AudioWorkletNode !== "undefined" ? AudioWorkletNode : null);
    this.fetchImpl = opts.fetchImpl || ((...args) => fetch(...args));
    this.urlBase = opts.urlBase || (() => (typeof location !== "undefined" ? location.origin : ""));
    this.token = opts.token || (() => "");
    this.fallbackMs = typeof opts.fallbackMs === "number" ? opts.fallbackMs : 1000;
    this.enabled = true;
    this.state = "idle";
    this.detail = "";
    this.active = false;
    this.stream = null;
    this.ctx = null;
    this.source = null;
    this.node = null;
    this.gain = null;
    this.chunks = [];
    this.startedAt = 0;
    this.maxTimer = null;
    this.fallbackTimer = null;
    this.button = null;
  }

  setEnabled(enabled) {
    this.enabled = enabled !== false;
    if (!this.enabled) this.cancel();
  }

  bindButton(el) {
    if (!el || this.button === el) return;
    this.button = el;
    const down = (ev) => {
      ev.preventDefault();
      this.start();
    };
    const up = (ev) => {
      ev.preventDefault();
      this.stop();
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("pointerleave", up);
    el.addEventListener("contextmenu", (ev) => ev.preventDefault());
  }

  setState(state, detail = "") {
    const s = LABELS[state] !== undefined ? state : "idle";
    this.state = s;
    this.detail = detail || "";
    this.onState(s, this.detail);
  }

  hint() {
    return this.detail || LABELS[this.state] || "";
  }

  async start() {
    if (!this.enabled || this.active || this.state === "thinking" || this.state === "speaking") return false;
    if (typeof isSecureContext !== "undefined" && !isSecureContext) {
      this.setState("error", "Mikrofon braucht HTTPS");
      this.say("Mikrofon braucht HTTPS.");
      return false;
    }
    this.active = true;
    this.chunks = [];
    this.startedAt = Date.now();
    this.setState("listening");
    try {
      try {
        if (this.sounds && this.sounds.unlock) this.sounds.unlock();
      } catch (e) {
        this.log("audio unlock failed: " + (e && e.message ? e.message : e));
      }
      const stream = await this.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (!this.active) {
        for (const track of stream.getTracks()) track.stop();
        return false;
      }
      this.stream = stream;
      const Ctx = this.AudioContextImpl;
      if (!Ctx) throw new Error("no AudioContext");
      this.ctx = this.ctx || new Ctx();
      if (this.ctx.state === "suspended") await this.ctx.resume();
      this.source = this.ctx.createMediaStreamSource(stream);
      this.gain = this.ctx.createGain();
      this.gain.gain.value = 0; // the microphone must not be audible locally
      if (this.ctx.audioWorklet && this.AudioWorkletNodeImpl) {
        await this.ctx.audioWorklet.addModule("./pcm-worklet.js");
        this.node = new this.AudioWorkletNodeImpl(this.ctx, "muse-pcm");
        this.node.port.onmessage = (ev) => this.chunks.push(ev.data);
        this.source.connect(this.node);
        this.node.connect(this.gain);
      } else {
        this.node = this.ctx.createScriptProcessor(4096, 1, 1);
        this.node.onaudioprocess = (ev) => this.chunks.push(new Float32Array(ev.inputBuffer.getChannelData(0)));
        this.source.connect(this.node);
        this.node.connect(this.gain);
      }
      this.gain.connect(this.ctx.destination);
      this.maxTimer = setTimeout(() => this.stop(), MAX_MS);
      return true;
    } catch (err) {
      this.active = false;
      this.cleanupCapture();
      const name = err && err.name ? err.name : "";
      const message = name === "NotAllowedError" || name === "SecurityError"
        ? "Mikrofon nicht erlaubt" : "Mikrofon nicht verfügbar";
      this.setState("error", message);
      this.say(message + ".");
      this.log("microphone failed: " + (err && err.message ? err.message : err));
      return false;
    }
  }

  cleanupCapture() {
    if (this.maxTimer) clearTimeout(this.maxTimer);
    this.maxTimer = null;
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    try { this.source?.disconnect(); } catch { /* ignore */ }
    try { this.node?.disconnect(); } catch { /* ignore */ }
    try { this.gain?.disconnect(); } catch { /* ignore */ }
    this.source = null;
    this.node = null;
    this.gain = null;
    this.active = false;
  }

  async stop() {
    if (!this.active) return;
    const chunks = this.chunks;
    const rate = this.ctx && this.ctx.sampleRate ? this.ctx.sampleRate : 48000;
    this.cleanupCapture();
    this.setState("thinking");
    const pcm = toPcm16(downsample(mergeFloat32(chunks), rate, 16000));
    if (pcm.length < MIN_SAMPLES) {
      this.setState("idle");
      this.say("Zu kurz. Halte den Knopf beim Sprechen gedrückt.");
      return;
    }
    await this.run(pcm);
  }

  cancel() {
    this.cleanupCapture();
    this.chunks = [];
    if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
    this.fallbackTimer = null;
    this.setState("idle");
  }

  async run(pcm) {
    const ha = this.getHa();
    const display = this.getDisplay();
    const settings = this.getSettings() || {};
    if (!ha) {
      this.setState("error", "Keine Verbindung");
      this.say("Keine Verbindung zu Home Assistant.");
      return false;
    }
    const before = display ? display.version : 0;
    let answer = "";
    let ttsUrl = "";
    let error = null;
    this.setState("thinking");
    try {
      const result = await ha.runPipeline({
        audio: pcm,
        sampleRate: 16000,
        onEvent: (ev) => {
          if (!ev || !ev.type) return;
          if (ev.type === "stt-end") {
            const text = ev.data && ev.data.stt_output && ev.data.stt_output.text;
            if (!String(text || "").trim()) error = { message: "Nichts verstanden" };
            else {
              this.setState("thinking");
              this.onHeard(String(text).trim());
            }
          } else if (ev.type === "intent-end") {
            answer = responseText(ev.data && ev.data.intent_output);
            this.armFallback(before, answer);
            this.onReply(answer);
          } else if (ev.type === "tts-start") {
            this.setState("speaking");
          } else if (ev.type === "tts-end") {
            ttsUrl = ev.data && ev.data.tts_output && ev.data.tts_output.url ? ev.data.tts_output.url : "";
          } else if (ev.type === "error") {
            error = ev.data || { message: "Pipeline error" };
          }
        },
      });
      if (result && result.error) error = result.error;
      if (error && !(error.code === "stt-no-text-recognized")) {
        if (answer) this.say(answer);
      }
      if (ttsUrl && settings.speak !== false) {
        this.setState("speaking");
        try {
          await this.playTts(ttsUrl);
        } catch (e) {
          this.log("tts failed: " + (e && e.message ? e.message : e));
          this.say("Ton nicht verfügbar.");
        }
      }
      if (error && !answer) {
        const text = error.message || "Muse hat nichts geantwortet.";
        this.setState("error", text);
        this.say(text);
      } else {
        this.setState("idle");
      }
      return true;
    } catch (e) {
      const text = e && e.message ? e.message : "Muse ist nicht erreichbar.";
      this.log("voice failed: " + text);
      this.setState("error", text);
      this.say(text);
      return false;
    }
  }

  armFallback(before, answer) {
    if (!answer) return;
    if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
    this.fallbackTimer = setTimeout(() => {
      this.fallbackTimer = null;
      const display = this.getDisplay();
      if (!display || display.version !== before) return;
      display.offer(makeCard({
        mode: 1, title: "Muse", body: answer, event: "info", ms: 20000,
      }));
    }, this.fallbackMs);
  }

  async playTts(url) {
    const full = resolveTtsUrl(url, this.urlBase());
    if (!full) return false;
    const token = String(this.token() || "");
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await this.fetchImpl(full, { headers });
    if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);
    const data = await res.arrayBuffer();
    if (!this.sounds || !this.sounds.playBuffer) return false;
    return this.sounds.playBuffer(data);
  }
}
