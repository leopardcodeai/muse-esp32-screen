// audio.js: the display's two sounds, generated with the Web Audio API the way
// tools/make_sounds.py generates the box's files: the chime when a timer ends (three
// rising soft bell tones, 1.45 s) and the "pling" when a question appears (0.50 s).
// Same notes, FM timbre, low-pass and envelope, so both screens sound alike.
//
// Pitfalls: a browser plays nothing before the first click or key on the page; unlock()
// runs on the first user gesture and the sounds stay silent until then.
const RATE = 16000;
const SOUNDS = {
  // C6, E6, G6: a small rising bell arpeggio with a longer, softer tail.
  timer: { notes: [[1046.5, 0.0, 0.55, 0.8], [1318.5, 0.20, 0.55, 0.8], [1568.0, 0.40, 1.0, 1.0]], total: 1.45 },
  // One soft A6 bell with a quiet fifth above.
  ask: { notes: [[1760.0, 0.0, 0.50, 1.0], [2637.0, 0.0, 0.35, 0.18]], total: 0.50 },
};

// The samples of a sound, as make_sounds.py computes them: an FM bell, a gentle
// attack, a one-pole low-pass and a 40 ms fade-out so the buffer never clicks.
export function samples(name) {
  const { notes, total } = SOUNDS[name];
  const out = new Float32Array(Math.floor(total * RATE));
  for (const [freq, start, length, volume] of notes) {
    const n0 = Math.floor(start * RATE);
    const n = Math.floor(length * RATE);
    for (let i = 0; i < n; i++) {
      const t = i / RATE;
      const env = Math.min(1, t / 0.008) * Math.exp(-t * 3.2);
      const mod = 0.9 * Math.exp(-t * 2.2) * Math.sin(2 * Math.PI * freq * 2.0 * t);
      const car = Math.sin(2 * Math.PI * freq * t + mod)
        + 0.12 * Math.sin(2 * Math.PI * freq * 2 * t) * Math.exp(-t * 5.0);
      if (n0 + i < out.length) out[n0 + i] += volume * env * car;
    }
  }
  let y = 0;
  for (let i = 0; i < out.length; i++) {
    y += 0.7 * (out[i] - y);
    out[i] = y;
  }
  const fade = Math.floor(0.04 * RATE);
  for (let i = 0; i < Math.min(fade, out.length); i++) out[out.length - 1 - i] *= i / fade;
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  peak = peak || 1;
  for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, Math.min(1, (out[i] / peak) * 0.65));
  return out;
}

export class Sounds {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.enabled = true;
    this.tts = null;
  }

  // Creates the audio context on the first user gesture (browsers block it before).
  unlock() {
    if (this.ctx || typeof AudioContext === "undefined") return;
    this.ctx = new AudioContext({ sampleRate: RATE });
    for (const name of Object.keys(SOUNDS)) {
      const s = samples(name);
      const b = this.ctx.createBuffer(1, s.length, RATE);
      b.copyToChannel(s, 0);
      this.buffers[name] = b;
    }
  }

  play(name) {
    if (!this.enabled || !this.ctx || !this.buffers[name]) return;
    if (this.ctx.state === "suspended") this.ctx.resume();
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers[name];
    src.connect(this.ctx.destination);
    src.start();
  }

  stopTts() {
    if (!this.tts) return;
    try { this.tts.stop(); } catch { /* already ended */ }
    this.tts = null;
  }

  // A decoded file (an ArrayBuffer from the TTS proxy) through the same context that
  // the presses unlocked. Returns false when the browser has no audio at all.
  async playBuffer(data) {
    if (!data || !this.ctx) return false;
    if (this.ctx.state === "suspended") await this.ctx.resume();
    const buffer = await this.ctx.decodeAudioData(data);
    this.stopTts();
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.ctx.destination);
    return new Promise((resolve) => {
      src.onended = () => {
        if (this.tts === src) this.tts = null;
        resolve(true);
      };
      this.tts = src;
      src.start();
    });
  }

  chime() {
    this.play("timer");
  }

  ask() {
    this.play("ask");
  }
}
