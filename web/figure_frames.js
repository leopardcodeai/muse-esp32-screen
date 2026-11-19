// figure_frames.js: where the figure's pictures come from and how they are drawn: the
// chosen figure style (figure_styles.js; today "Muse", the owner's frames in his own
// folder), or, only on a screen that names no figure folder, the neutral placeholder
// drawn in code (figure.js).
//
// A screen with a figure folder (the owner's Tab, iPad, Mac, Mosaico layout and the
// camera add-on) loads the six pictures of its style at the start: `idle` and the small
// avatar at once (idle with high fetch priority), the four other poses as soon as idle's
// file is in (IDLE_HEAD_START_MS at most), so a slow line serves idle first and the
// others download while idle decodes. Each pose is drawn as soon as its pictures are
// decoded (apng.js turns every frame into an ImageBitmap before it is handed over, so a
// picture is never shown half decoded). Until then the figure's place stays empty, after
// PULSE_DELAY_MS with a small neutral dot that pulses; nothing else stands in. A pose the
// set lacks borrows a pose of the same set (SAME_SET); a set that fails completely
// leaves the place empty and says so in the log and in the settings. The blue figure of
// the project (figure-default/, up to 1.8.20) is gone.
//
// Every set is played as the box plays it: ping-pong one step per 160 ms in a scene and
// 200 ms on the cards, confetti once, the avatar as a still.
//
// Pitfalls:
//  * The owner's frames may come from another origin (web/tools/serve_frames.py on
//    127.0.0.1), so that server must send Access-Control-Allow-Origin; same-origin
//    ./local on the add-on or the Mac needs nothing. The service worker keeps ./local's
//    pictures (sw.js), so the second start draws from the cache at once.
//  * Meta's Muse artwork never goes into git or a deployment: the folder is web/local
//    (ignored) or another machine. tools/check_private.py guards the repository.
//  * Until use() is called the source draws nothing at all; app.js calls it before the
//    first frame, so neither the placeholder nor anything else flashes on an owner screen.
//  * loadDefault() is kept for the camera add-on's renderer (homeassistant repo), which
//    still calls it: there is no project figure any more, so it loads nothing.
//  * From a page served over HTTPS, an http:// folder is mixed content unless it is on
//    this machine (http://127.0.0.1, http://localhost); Chrome and Edge then ask once
//    whether the page may reach this device (Local Network Access).
import { Figure, SIZE, AVATAR, STEP_MS, pingPongStep, onceStep, neutralTone } from "./figure.js";
import { decodeApng } from "./apng.js";
import { css } from "./render.js";

export const FIGURE_NAMES = ["idle", "wave", "working", "making", "confetti", "avatar"];
// The owner's figure folder beside the page (the add-on and the Mac's local server).
export const DEFAULT_FOLDER = "./local";
// How long an empty figure place stays plain before the loading dot appears: a figure
// from the service worker's cache is there well before, so a warm start shows no dot.
export const PULSE_DELAY_MS = 600;
// The longest the other poses wait for idle's file before they are requested anyway.
export const IDLE_HEAD_START_MS = 1500;
// A pose the chosen set lacks borrows one of the same set, never another figure.
export const SAME_SET = Object.freeze({
  idle: [], wave: ["idle"], working: ["idle"], making: ["working", "idle"], confetti: ["wave", "idle"], avatar: ["idle"],
});

// The URL of one picture in folder `base`; the dark theme has the same six files under
// base/dark, their page faded to black (tools/make_figure_dark.py).
export function frameUrl(base, name, dark = false) {
  return `${String(base || "").trim().replace(/\/+$/, "")}${dark ? "/dark" : ""}/muse_${name}.png`;
}

// The fetch options of one picture: idle first, since the ready screen shows it.
export function fetchOptions(name) {
  return { mode: "cors", cache: "no-cache", credentials: "omit", priority: name === "idle" ? "high" : "auto" };
}

// The two frames and the mix between them at time t, for a smooth 60 fps draw of a
// 6 fps animation. Looping poses ping-pong, confetti runs once; the avatar stays.
export function frameBlend(sub, t, count, stepMs = STEP_MS) {
  if (count <= 1 || sub === "avatar") return { i: 0, j: 0, mix: 0 };
  const raw = Math.max(0, t) / stepMs;
  if (sub === "confetti") {
    const pos = Math.min(count - 1, raw);
    const i = Math.floor(pos);
    return { i, j: Math.min(count - 1, i + 1), mix: pos - i };
  }
  const cycle = 2 * (count - 1);
  const p = raw % cycle;
  const forward = p <= count - 1;
  const pos = forward ? p : cycle - p;
  const i = Math.floor(pos);
  const j = forward ? Math.min(count - 1, i + 1) : Math.max(0, i - 1);
  return { i, j, mix: pos - i };
}

// Which of `count` frames shows t ms after the animation started.
export function frameIndex(sub, t, count, stepMs = STEP_MS) {
  if (count <= 1 || sub === "avatar") return 0;
  if (sub === "confetti") return onceStep(t, stepMs, count, false);
  return pingPongStep(t, stepMs, count);
}

// The opacity of the loading dot `ms` after the load began: 0 before PULSE_DELAY_MS,
// then a slow breath between 0.15 and 0.45 (1.6 s a cycle).
export function pulseAlpha(ms) {
  if (!(ms >= PULSE_DELAY_MS)) return 0;
  const p = ((ms - PULSE_DELAY_MS) % 1600) / 1600;
  return 0.15 + 0.3 * (0.5 - 0.5 * Math.cos(2 * Math.PI * p));
}

export class FigureSource {
  constructor({ placeholder = new Figure(), fetchImpl, decode = decodeApng, log = () => {}, now } = {}) {
    this.placeholder = placeholder; // the neutral figure drawn in code, public page only
    this.fetchImpl = fetchImpl || ((url, opts) => fetch(url, opts));
    this.decode = decode;
    this.log = log;
    this.now = now || (() => (globalThis.performance ? globalThis.performance.now() : Date.now()));
    this.chosen = false; // use() was called: before that nothing is drawn
    this.url = ""; // the folder of the chosen set; "" draws the placeholder
    this.name = ""; // the style's name, for describe()
    this.dark = false; // load base/dark (the black-page copies) instead of base
    this.frames = new Map(); // name -> [ImageBitmap] of the chosen set
    this.failed = [];
    this.loading = false;
    this.loadingSince = 0;
    this.serial = 0;
    this.version = 0; // grows with every change of what draw() shows (square.js redraws)
    this.waiters = [];
    this.defaults = new Map(); // kept empty: readers of the old API see no project figure
  }

  get smooth() {
    return this.placeholder.smooth;
  }

  set smooth(v) {
    this.placeholder.smooth = v;
  }

  // "none" before use(), "placeholder" without a folder, "frames" with one.
  get mode() {
    return !this.chosen ? "none" : this.url ? "frames" : "placeholder";
  }

  // The chosen set is done loading and not one picture arrived.
  get failedAll() {
    return this.mode === "frames" && !this.loading && this.frames.size === 0;
  }

  // The pictures for pose `sub`: its own, else a pose of the same set; null without.
  framesFor(sub) {
    const own = this.frames.get(sub);
    if (own) return own;
    for (const other of SAME_SET[sub] || ["idle"]) {
      const f = this.frames.get(other);
      if (f) return f;
    }
    return null;
  }

  // Whether what draw() shows for `sub` changes from frame to frame by itself (the
  // placeholder moves, the loading dot pulses); pictures step and need no such redraw.
  moving(sub) {
    if (this.mode === "placeholder") return true;
    if (this.mode !== "frames" || this.framesFor(sub)) return false;
    return this.loading;
  }

  // Resolves once pose `sub` can be drawn as a picture, or the load is over without it.
  whenReady(sub = "idle") {
    if (this.mode === "placeholder" || this.frames.has(sub) || (this.chosen && !this.loading)) return Promise.resolve(this.frames.has(sub));
    return new Promise((resolve) => this.waiters.push({ sub, resolve }));
  }

  notify(done = false) {
    this.waiters = this.waiters.filter((w) => {
      if (done || this.frames.has(w.sub)) {
        w.resolve(this.frames.has(w.sub));
        return false;
      }
      return true;
    });
  }

  // Compatibility with the camera add-on's renderer (homeassistant repo): the project
  // ships no figure of its own any more, so there is nothing to load.
  async loadDefault() {
    return { loaded: 0, failed: [] };
  }

  // Fetches and decodes one picture, with one retry: six requests at once against a
  // small local server lost one now and then ("Failed to fetch", 08.10.2026).
  // `onBytes` is called once the file has arrived (or failed), before it is decoded.
  async fetchOne(url, opts, onBytes = () => {}) {
    const get = () => this.fetchImpl(url, opts);
    let bytes;
    try {
      let res;
      try {
        res = await get();
      } catch {
        await new Promise((r) => setTimeout(r, 300));
        res = await get();
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      bytes = new Uint8Array(await res.arrayBuffer());
    } finally {
      onBytes();
    }
    const frames = await this.decode(bytes);
    if (!frames || !frames.length) throw new Error("no frames");
    return frames;
  }

  // Switches to the set in folder `url` (named `name` in describe()), or to the neutral
  // placeholder with "". All six pictures load at once; each pose is drawn as soon as its
  // own pictures are decoded. Resolves with {loaded, failed} once every picture has
  // loaded or failed; a later call makes an earlier one stale ({stale: true}).
  async use(url, { name = "" } = {}) {
    const serial = ++this.serial;
    this.chosen = true;
    this.url = String(url || "").trim();
    this.name = String(name || "").trim();
    this.frames = new Map();
    this.failed = [];
    this.version++;
    if (!this.url) {
      this.loading = false;
      this.notify(true);
      return { loaded: 0, failed: [] };
    }
    this.loading = true;
    this.loadingSince = this.now();
    const base = this.url;
    const dark = this.dark;
    // Idle gets a head start: the four big poses wait until idle's file is here (or
    // IDLE_HEAD_START_MS passed), so they do not share the line with it; its decoding
    // then overlaps their download. The small avatar goes at once.
    let idleArrived;
    const idleGate = new Promise((resolve) => {
      idleArrived = resolve;
      const timer = setTimeout(resolve, IDLE_HEAD_START_MS);
      if (timer && timer.unref) timer.unref();
    });
    await Promise.all(FIGURE_NAMES.map(async (name) => {
      if (name !== "idle" && name !== "avatar") await idleGate;
      if (serial !== this.serial) return;
      // The small card avatar stays light in the dark theme, like the question view in
      // the light theme; its dark copy is only the fallback.
      const urls = name === "avatar" && dark ? [frameUrl(base, name, false), frameUrl(base, name, true)] : [frameUrl(base, name, dark)];
      let error = null;
      for (const u of urls) {
        try {
          const frames = await this.fetchOne(u, fetchOptions(name), name === "idle" ? idleArrived : undefined);
          if (serial !== this.serial) return;
          this.frames.set(name, frames);
          this.version++;
          this.notify();
          return;
        } catch (e) {
          error = e;
        }
      }
      if (serial !== this.serial) return;
      this.failed.push(name);
      this.log(`figure ${name} not loaded from ${urls[0]}: ${error ? error.message : "no frames"}`);
    }));
    if (serial !== this.serial) return { loaded: 0, failed: [], stale: true };
    this.failed.sort((a, b) => FIGURE_NAMES.indexOf(a) - FIGURE_NAMES.indexOf(b));
    this.loading = false;
    this.version++;
    this.notify(true);
    return { loaded: this.frames.size, failed: [...this.failed] };
  }

  // A short German line for the settings dialog and the display's info.
  describe() {
    if (this.mode === "none") return "";
    if (this.mode === "placeholder") return "neutraler Platzhalter";
    const name = this.name || "Figur";
    if (this.loading) return `${name} lädt …`;
    if (this.frames.size === 0) return `${name} nicht erreichbar, der Platz der Figur bleibt leer`;
    return `${name}, ${this.frames.size} von ${FIGURE_NAMES.length} Bildern`;
  }

  // Draws like Figure.draw(): the chosen set's picture; without one the place stays
  // empty (a pulsing dot while it loads); the placeholder only on a screen without a set.
  // `drawSize` (optional) draws the frame that many px wide (the square layout's figure).
  draw(r, sub, t, x0, y0, stepMs = STEP_MS, drawSize = 0) {
    const mode = this.mode;
    if (mode === "none") return;
    if (mode === "placeholder") {
      this.placeholder.draw(r, sub, t, x0, y0, stepMs, drawSize);
      return;
    }
    const size = drawSize > 0 ? drawSize : sub === "avatar" ? AVATAR : SIZE;
    const frames = this.framesFor(sub);
    if (!frames) {
      if (this.loading && sub !== "avatar") this.drawPulse(r, x0, y0, size);
      return;
    }
    const pace = frames.delayMs > 0 && frames.delayMs < stepMs ? frames.delayMs : stepMs;
    const ctx = r.ctx;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    if (!this.smooth || frames.length <= 1 || sub === "avatar") {
      ctx.drawImage(frames[frameIndex(sub, t, frames.length, pace)], x0, y0, size, size);
    } else {
      // Blend the two neighbouring pictures so the figure moves continuously at 60 fps.
      const { i, j, mix } = frameBlend(sub, t, frames.length, pace);
      ctx.drawImage(frames[i], x0, y0, size, size);
      if (mix > 0 && j !== i) {
        ctx.globalAlpha = mix;
        ctx.drawImage(frames[j], x0, y0, size, size);
      }
    }
    ctx.restore();
  }

  // The loading dot: small, grey in either theme, in the middle of the figure's place.
  drawPulse(r, x0, y0, size) {
    const alpha = pulseAlpha(this.now() - this.loadingSince);
    if (alpha <= 0) return;
    const ctx = r.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = css(neutralTone(0.5));
    ctx.beginPath();
    ctx.arc(x0 + size / 2, y0 + size / 2, Math.max(3, size * 0.025), 0, 2 * Math.PI);
    ctx.fill();
    ctx.restore();
  }
}
