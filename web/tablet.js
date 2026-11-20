// tablet.js: the rail beside the 480 x 480 canvas in the Tab and iPad profiles, and
// the small geometry decisions the layout needs.
//
// The canvas keeps the square layout; the rail is plain DOM and shows, from the top: a
// status header (clock, date, connection), the camera card, the timer chip, the camera
// mode and a row of round action buttons. Talking to Muse is not part of the page: Meta's
// own voice runs in the Muse OS app around it (owner, 20.11.2026). The rail is the only part
// of the app that is not drawn on the canvas, so it stays crisp at any device pixel
// ratio and the text is real text.
//
// Pitfalls:
//  * The rail is optional: mount() tolerates a page without it (the Node tests and
//    the box/square layouts), and update() never throws when an element is missing.
//  * The rail width is the leftover width that makes the page square. In portrait the
//    rail moves to the bottom and the height comes from CSS.
//  * A narrow rail (1024 x 768 leaves 256 px) is "compact": the CSS then drops the
//    labels under the icons, so the hint line names the chosen camera mode instead.
//  * Everything must fit the height without scrolling: the texts set here are single
//    lines or clamped by CSS, never free-flowing.
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

// "compact" for a rail too narrow for five labelled columns (under 330 px), else
// "regular". The bottom rail of portrait (width 0 here) is regular: it has the width.
export function railDensity(width) {
  return width > 0 && width < 330 ? "compact" : "regular";
}

export function profileLabel(profile) {
  return profile === "ipad" ? "iPad" : "Tab";
}

// `?tile=1` shows the page as Muse OS's small tile for a local check (app.js listens
// for the shell's `muse-os-tile` event otherwise); null when the URL does not say.
export function tileParam(search) {
  const v = new URLSearchParams(search || "").get("tile");
  if (v === "1" || v === "true") return true;
  if (v === "0" || v === "false") return false;
  return null;
}

// The detail of the shell's `muse-os-tile` event as a boolean: true, 1 and "true" turn
// the tile on, everything else off.
export function tileDetail(detail) {
  return detail === true || detail === 1 || detail === "1" || detail === "true";
}

// What each camera mode does, one line under the segmented control. A compact rail has
// no labels under the icons, so the line starts with the mode's name there.
const MODE_HINTS = {
  off: ["Aus", "Kamera aus"],
  follow: ["Folgen", "Muse bewegt sich mit dir"],
  mimic: ["Nachmachen", "Muse macht deine Bewegungen nach"],
  detect: ["Erkennen", "Objekte markieren und Vision"],
  all: ["Alles", "Folgen, Nachmachen und Erkennen"],
  custom: ["Eigene Auswahl", "Einzeln eingestellt (Einstellungen)"],
};
export function cameraModeHint(mode, density = "regular") {
  const key = Object.hasOwn(MODE_HINTS, mode) ? mode : "custom";
  const [name, text] = MODE_HINTS[key];
  if (key === "off") return text;
  return density === "compact" || key === "custom" ? `${name}: ${text}` : text;
}

const STATUS = {
  on: "verbunden",
  connecting: "verbindet …",
  off: "getrennt",
  demo: "Demo",
};

const TIME = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
const DATE = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long" });
const DATE_SHORT = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "numeric", month: "short" });

// The header's date: the long form, or the short one for a compact rail
// ("Donnerstag, 19. November" or "Do., 19. Nov.").
export function railDate(clock, density = "regular") {
  return (density === "compact" ? DATE_SHORT : DATE).format(clock);
}

export class TabletRail {
  constructor(opts = {}) {
    this.doc = opts.document || (typeof document !== "undefined" ? document : null);
    this.log = opts.log || (() => {});
    this.root = null;
    this.profile = "tab";
    this.density = "regular";
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
      modeHint: id("rail-mode-hint"),
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

  // "regular" or "compact" (railDensity); the CSS reads it from the rail's data-density.
  setDensity(density) {
    this.density = density === "compact" ? "compact" : "regular";
    if (this.root) this.root.dataset.density = this.density;
  }

  update(state = {}) {
    if (!this.root) return;
    const e = this.elements;
    const clock = state.clock instanceof Date ? state.clock : new Date();
    if (e.time) e.time.textContent = TIME.format(clock);
    if (e.date) e.date.textContent = railDate(clock, this.density);
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
    if (state.cameraMode) this.setCameraMode(state.cameraMode);
  }

  // The line under the camera mode control.
  setCameraMode(mode) {
    const hint = this.elements.modeHint;
    if (!hint) return;
    const text = cameraModeHint(mode, this.density);
    if (hint.textContent !== text) hint.textContent = text;
  }
}
