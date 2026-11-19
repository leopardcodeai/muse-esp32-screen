// tablet.js: the rail beside the 480 x 480 canvas in the Tab and iPad profiles, and
// the small geometry decisions the layout needs.
//
// The canvas keeps the square layout; the rail is plain DOM and shows the clock, the
// connection, the timer, the push-to-talk button and the device controls. It is the
// only part of the app that is not drawn on the canvas, so it stays crisp at any
// device pixel ratio and the text is real text.
//
// Pitfalls:
//  * The rail is optional: mount() tolerates a page without it (the Node tests and
//    the box/square layouts), and update() never throws when an element is missing.
//  * The rail width is the leftover width that makes the page square. In portrait the
//    rail moves to the bottom and the height comes from CSS.
//  * No DOM in the pure helpers, so the tests can call them in Node.
import { timeLeft } from "./text.js";

// The rail width in landscape: the viewport width minus the height, which is exactly
// the width the square canvas leaves. Capped so a very wide window cannot grow an
// unusable rail; 0 in portrait.
export function railWidth(width, height) {
  if (!(width > height)) return 0;
  return Math.max(240, Math.min(520, width - height));
}

export function railSide(width, height) {
  return width > height ? "right" : "bottom";
}

export function profileLabel(profile) {
  return profile === "ipad" ? "iPad" : "Tab";
}

const STATUS = {
  on: "verbunden",
  connecting: "verbindet …",
  off: "getrennt",
  demo: "Demo",
};

const VOICE = {
  idle: "Halten zum Sprechen",
  listening: "Ich höre …",
  thinking: "Muse denkt …",
  speaking: "Muse spricht",
  error: "Mikrofon nicht verfügbar",
  off: "Mikrofon aus",
};

const TIME = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
const DATE = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long" });

export class TabletRail {
  constructor(opts = {}) {
    this.doc = opts.document || (typeof document !== "undefined" ? document : null);
    this.log = opts.log || (() => {});
    this.root = null;
    this.profile = "tab";
    this.elements = {};
  }

  mount() {
    const doc = this.doc;
    if (!doc || !doc.getElementById) return this;
    this.root = doc.getElementById("rail");
    if (!this.root) return this;
    const id = (name) => doc.getElementById(name);
    this.elements = {
      time: id("rail-time"),
      date: id("rail-date"),
      profile: id("rail-profile"),
      dot: id("rail-dot"),
      status: id("rail-status-text"),
      timer: id("rail-timer"),
      mic: id("rail-mic"),
      micLabel: id("rail-mic-label"),
      light: id("rail-light"),
      battery: id("rail-battery"),
      fullscreen: id("rail-fullscreen"),
    };
    this.setProfile(this.profile);
    return this;
  }

  setProfile(profile) {
    this.profile = profile === "ipad" ? "ipad" : "tab";
    if (!this.root) return;
    this.root.dataset.profile = this.profile;
    if (this.elements.profile) this.elements.profile.textContent = profileLabel(this.profile);
  }

  update(state = {}) {
    if (!this.root) return;
    const e = this.elements;
    const clock = state.clock instanceof Date ? state.clock : new Date();
    if (e.time) e.time.textContent = TIME.format(clock);
    if (e.date) e.date.textContent = DATE.format(clock);
    const connection = STATUS[state.connection] ? state.connection : "off";
    this.root.dataset.connection = connection;
    if (e.dot) e.dot.dataset.connection = connection;
    if (e.status) e.status.textContent = STATUS[connection];
    if (state.profile) this.setProfile(state.profile);
    const timer = state.timer;
    if (e.timer) {
      e.timer.hidden = !timer;
      e.timer.textContent = timer ? `${timer.name} · ${timeLeft(timer.left)}` : "";
    }
    if (e.light) {
      if (state.sensorText) {
        e.light.hidden = false;
        e.light.textContent = state.sensorText;
      } else {
        e.light.hidden = state.light === null || state.light === undefined;
        if (!e.light.hidden) e.light.textContent = `Licht ${Math.round(Math.max(0, Math.min(1, state.light)) * 100)} %`;
      }
    }
    if (e.battery) {
      const b = state.battery;
      e.battery.hidden = !b;
      e.battery.textContent = b ? `${Math.round(b.level * 100)} %${b.charging ? " · lädt" : ""}` : "";
    }
    if (e.fullscreen) {
      e.fullscreen.setAttribute("aria-pressed", state.fullscreen ? "true" : "false");
      e.fullscreen.title = state.fullscreen ? "Vollbild verlassen" : "Vollbild";
    }
    if (state.voice) this.setVoice(state.voice, state.voiceDetail);
  }

  setVoice(state = "idle", detail = "") {
    if (!this.root) return;
    const s = VOICE[state] ? state : "idle";
    this.root.dataset.voice = s;
    const e = this.elements;
    if (e.mic) e.mic.dataset.state = s;
    if (e.micLabel) e.micLabel.textContent = s === "error" && detail ? detail : VOICE[s];
  }
}
