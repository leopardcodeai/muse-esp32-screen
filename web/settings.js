// settings.js: the display's settings in this browser's localStorage, their defaults,
// and the small decisions app.js takes from them at start: whether a first visit lands
// in demo mode, which frame rate applies, and whether the browser will refuse the Home
// Assistant URL from this page. No DOM in here, so the tests run it in Node.
//
// Pitfalls:
//  * localStorage can throw (blocked site data, some private windows); every access is
//    wrapped, and the page then runs with the defaults.
//  * The key stays "muse-web-settings" across the rename to Muse Web Screen, so settings
//    stored by an earlier version are kept.
import { DEFAULT_DEVICE } from "./ha.js";
import { normaliseFps, DEFAULT_FPS } from "./pace.js";
import { DEFAULT_STYLE, cleanStyleId } from "./figure_styles.js";

export const SETTINGS_KEY = "muse-web-settings";
// "url": a figure style from the folder `figureUrl` (figure_styles.js, `figureStyle`);
// "placeholder": the neutral placeholder drawn in code, for the public page only.
export const FIGURE_SOURCES = ["placeholder", "url"];
// "box": the box's 320 x 240; "square": 480 x 480 (docs/SQUARE_LAYOUT.md, square.js);
// "tablet": the same 480 x 480 canvas at full height beside a control rail (tablet.js).
export const LAYOUTS = ["box", "square", "tablet"];
// The two tablet presets in the Layout dropdown. The geometry is responsive; the
// profile only names the screen and picks the Vision upload filename.
export const TABLET_PROFILES = ["tab", "ipad"];
export const CAMERA_FACING = ["user", "environment"];
// "auto": dark on the square (Mosaico) layout, light on the box layout.
export const THEMES = ["auto", "dark", "light"];
// The style of the DOM chrome (rail, toolbar, camera card, settings dialog), separate
// from the light/dark palette: "ios" is the iOS 26 Liquid Glass look, "classic" the
// look before it. "auto": iOS on the tablet layout, classic on the box and square
// layouts. The canvas never changes with it.
export const LOOKS = ["auto", "ios", "classic"];
// layoutVersion 2 moves a stored box layout once to square, the Mosaico default; an
// explicit choice after that is kept.
export const LAYOUT_VERSION = 2;
// Keys earlier versions stored that no longer mean anything.
export const RETIRED_KEYS = Object.freeze(["voice", "speak", "voiceModel", "voiceDailyLimit"]);
export const DEFAULTS = Object.freeze({
  url: "", token: "", device: DEFAULT_DEVICE, inputText: "", name: "Muse", integer: false, sound: true,
  fps: DEFAULT_FPS, figureSource: "placeholder", figureUrl: "", figureStyle: DEFAULT_STYLE, bare: false, layout: "square",
  theme: "auto", look: "auto", pixel: false, urlAway: "", figureUrlAway: "", layoutVersion: LAYOUT_VERSION,
  tabletProfile: "tab", camera: false, cameraFacing: "user", personBoxes: true,
  autoBrightness: true, followMe: false, mimicMe: null, autoMotion: true, vision: true, visionAuto: false, visionEntity: "ai_task.google_ai_task",
  visionModel: "Gemini 3.5 Flash Lite", visionDailyLimit: 1000,
});

// The stored settings over the defaults, cleaned.
export function loadSettings(storage) {
  let stored = {};
  try {
    stored = JSON.parse(storage.getItem(SETTINGS_KEY) || "{}") || {};
  } catch {
    stored = {};
  }
  const s = { ...DEFAULTS, ...stored };
  // Settings of the removed voice and text path (1.8.24: talking to Muse is Meta's own
  // voice in Muse OS). An old browser may still store them; they are dropped, so the next
  // save leaves them out and nothing reads them.
  for (const key of RETIRED_KEYS) delete s[key];
  s.device = String(s.device || "").trim() || DEFAULT_DEVICE;
  s.fps = normaliseFps(s.fps);
  if (!FIGURE_SOURCES.includes(s.figureSource)) s.figureSource = DEFAULTS.figureSource;
  s.figureUrl = String(s.figureUrl || "").trim();
  s.figureStyle = cleanStyleId(s.figureStyle) || DEFAULTS.figureStyle;
  s.bare = s.bare === true;
  s.pixel = s.pixel === true;
  for (const key of ["camera", "personBoxes", "autoBrightness", "followMe", "autoMotion", "vision", "visionAuto"]) {
    s[key] = stored[key] === undefined ? DEFAULTS[key] : stored[key] === true;
  }
  // null: "Muse macht meine Bewegungen nach" goes with "Muse folgt mir" (mimicOn()).
  s.mimicMe = typeof stored.mimicMe === "boolean" ? stored.mimicMe : null;
  s.tabletProfile = TABLET_PROFILES.includes(s.tabletProfile) ? s.tabletProfile : DEFAULTS.tabletProfile;
  s.cameraFacing = CAMERA_FACING.includes(s.cameraFacing) ? s.cameraFacing : DEFAULTS.cameraFacing;
  const visionEntity = String(s.visionEntity || "").trim();
  s.visionEntity = /^[a-z0-9_]+\.[a-z0-9_]+$/i.test(visionEntity) ? visionEntity : DEFAULTS.visionEntity;
  if (!LAYOUTS.includes(s.layout)) s.layout = DEFAULTS.layout;
  // One-time move to the Mosaico default. A browser that already ran 1.6.0 or later has
  // the marker and keeps whatever Layout it chose.
  if ((Number(stored.layoutVersion) || 0) < LAYOUT_VERSION) s.layout = "square";
  s.layoutVersion = LAYOUT_VERSION;
  if (!THEMES.includes(s.theme)) s.theme = DEFAULTS.theme;
  if (!LOOKS.includes(s.look)) s.look = DEFAULTS.look;
  return s;
}

export function hasStoredSettings(storage) {
  try {
    return storage.getItem(SETTINGS_KEY) !== null;
  } catch {
    return false;
  }
}

export function saveSettings(storage, s) {
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

// Where a first visit goes: a page without stored settings and without a `demo`
// parameter lands in demo mode (index.html?demo=1), so a stranger sees the display at
// once instead of an empty settings form. null: stay. `?demo=0` stays without demo.
export function landingTarget(href, stored) {
  const u = new URL(href);
  if (stored || u.searchParams.has("demo")) return null;
  if (u.pathname.endsWith("/")) u.pathname += "index.html";
  u.searchParams.set("demo", "1");
  return u.toString();
}

// The frame rate of this visit: `?fps=10|30|60` in the URL, else the setting.
export function fpsFor(search, settings) {
  const p = new URLSearchParams(search);
  return p.has("fps") ? normaliseFps(p.get("fps"), settings.fps) : normaliseFps(settings.fps);
}

// The theme of this visit: `?theme=dark|light` in the URL, else the setting. "auto"
// gives dark on the square (Mosaico) layout and light on the box layout.
export function themeFor(search, settings, layout) {
  const p = new URLSearchParams(search);
  const want = p.has("theme") ? String(p.get("theme")).trim().toLowerCase() : settings.theme;
  if (want === "dark" || want === "light") return want;
  return layout === "square" ? "dark" : "light";
}

// The chrome style of this visit: `?look=ios|classic` in the URL, else the setting.
// "auto" (and anything unknown) gives iOS on the tablet layout and classic elsewhere.
export function lookFor(search, settings, layout) {
  const p = new URLSearchParams(search);
  const want = p.has("look") ? String(p.get("look")).trim().toLowerCase() : String(settings.look || "");
  if (want === "ios" || want === "classic") return want;
  return layout === "tablet" ? "ios" : "classic";
}

// The layout of this visit: `?layout=box|square|tablet` in the URL, else the setting.
// `?layout=tablet-tab` and `?layout=tablet-ipad` are shorthand for one profile.
export function layoutFor(search, settings) {
  const p = new URLSearchParams(search);
  const chosen = p.has("layout") ? parseLayoutChoice(p.get("layout")) : null;
  const want = chosen ? chosen.layout : settings.layout;
  return LAYOUTS.includes(want) ? want : LAYOUTS.includes(settings.layout) ? settings.layout : DEFAULTS.layout;
}

// The Layout dropdown value for a stored layout and profile ("tablet-ipad").
export function layoutChoice(layout, profile) {
  if (layout !== "tablet") return layout;
  return `tablet-${TABLET_PROFILES.includes(profile) ? profile : DEFAULTS.tabletProfile}`;
}

// A Layout dropdown (or URL) value as {layout, tabletProfile}; null when unknown.
export function parseLayoutChoice(value) {
  const v = String(value || "").trim().toLowerCase();
  if (v === "tablet-tab") return { layout: "tablet", tabletProfile: "tab" };
  if (v === "tablet-ipad") return { layout: "tablet", tabletProfile: "ipad" };
  if (v === "tablet") return { layout: "tablet", tabletProfile: null };
  if (v === "box" || v === "square") return { layout: v, tabletProfile: null };
  return null;
}

// The tablet profile of this visit: `?device=tab|ipad`, a `?layout=tablet-...`
// shorthand, else the setting.
export function tabletProfileFor(search, settings) {
  const p = new URLSearchParams(search);
  const device = String(p.get("device") || "").trim().toLowerCase();
  if (TABLET_PROFILES.includes(device)) return device;
  const fromLayout = p.has("layout") ? parseLayoutChoice(p.get("layout")) : null;
  if (fromLayout && TABLET_PROFILES.includes(fromLayout.tabletProfile)) return fromLayout.tabletProfile;
  const stored = String(settings.tabletProfile || "").trim().toLowerCase();
  return TABLET_PROFILES.includes(stored) ? stored : DEFAULTS.tabletProfile;
}

// The page to load after the settings were saved with layout `chosen`, or null when the
// visit's `active` layout (layoutFor: a ?layout= of the URL, else the setting) is already
// it. The ?layout= goes, so the saved choice is what the page starts with.
export function layoutReload(href, active, chosen) {
  if (chosen === active) return null;
  const u = new URL(href);
  u.searchParams.delete("layout");
  return u.toString();
}

// The host of a URL in lower case, or "" when it is none.
function hostOf(url) {
  try {
    return new URL(String(url || "").trim()).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function isLoopbackHost(host) {
  return host === "localhost" || host.endsWith(".localhost") || /^127\.\d+\.\d+\.\d+$/.test(host) || host === "[::1]";
}

// Whether a page loaded with `pageProtocol` opens an unencrypted connection to `url`
// that browsers treat as mixed content: an http URL from an https page, except to this
// machine (loopback counts as secure).
export function insecureFromHttps(pageProtocol, url) {
  const u = String(url || "").trim();
  if (pageProtocol !== "https:" || !/^http:\/\//i.test(u)) return false;
  return !isLoopbackHost(hostOf(u));
}

// The one German sentence the settings dialog shows when insecureFromHttps() holds.
export const MIXED_CONTENT_NOTE = "Von dieser HTTPS-Seite aus blockieren Safari und Firefox die unverschlüsselte "
  + "Verbindung zu einer http-Adresse, Chrome und Edge erlauben sie nur ins lokale Netz und erst nach einer "
  + "Freigabe: zuverlässig geht es mit einer HTTPS-Adresse für Home Assistant (wss://) oder mit der App lokal "
  + "über http://localhost.";

// Whether the page should load the newer version the server has: only when the server
// names one, it differs, and nothing is going on (no talking, no Vision request).
export function updateWanted(current, server, idle) {
  const next = String(server || "").trim();
  return Boolean(idle) && next !== "" && next !== String(current || "").trim();
}

// Whether an action may come back after a reload or a reconnect. A status ("thinking",
// "listening" ...) belongs to the moment it was sent; restoring it replayed an old
// "Prüfe Dyson …" on every start (19.11.2026). Only content is restored; a motion
// (animate) belongs to its moment too.
export const TRANSIENT_ACTIONS = ["set_status", "set_status_text", "reload", "camera", "camera_mode", "photo", "vision", "animate", "figure_style"];
export function restorable(action) {
  return Boolean(action) && !TRANSIENT_ACTIONS.includes(String(action));
}

// "Muse macht meine Bewegungen nach (Beta)" (gestures.js): on or off as chosen, and by
// default (mimicMe null) on exactly when "Muse folgt mir" is on.
export function mimicOn(settings) {
  const m = settings ? settings.mimicMe : null;
  return typeof m === "boolean" ? m : !!(settings && settings.followMe === true);
}

// The stored mimicMe for the two switches of the dialog: null while it matches "Muse
// folgt mir" (so it keeps going with it), the explicit choice otherwise.
export function mimicChoice(mimic, followMe) {
  return mimic === followMe ? null : mimic === true;
}

// The camera modes of the rail and the dialog: one control instead of four switches.
// Each sets the camera and its features together:
//   off     Aus         the camera off (the features keep their last state)
//   follow  Folgen      "Muse folgt mir" only
//   mimic   Nachmachen  "Muse folgt mir" and "Muse macht meine Bewegungen nach"
//   detect  Erkennen    object boxes and the Vision button, no pose tracker
//   all     Alles       everything at once
// The Vision timer (visionAuto) is never switched by a mode: it uploads pictures and
// stays an explicit choice in the dialog.
export const CAMERA_MODES = ["off", "follow", "mimic", "detect", "all"];
export const CAMERA_MODE_LABELS = Object.freeze({
  off: "Aus", follow: "Folgen", mimic: "Nachmachen", detect: "Erkennen", all: "Alles",
});
const MODE_FEATURES = Object.freeze({
  follow: { followMe: true, mimicMe: false, personBoxes: false },
  mimic: { followMe: true, mimicMe: true, personBoxes: false },
  detect: { followMe: false, mimicMe: false, personBoxes: true, vision: true },
  all: { followMe: true, mimicMe: true, personBoxes: true, vision: true },
});
const MODE_ALIASES = Object.freeze({
  off: "off", aus: "off", false: "off", stop: "off", none: "off",
  follow: "follow", folgen: "follow", followme: "follow", folgtmir: "follow",
  mimic: "mimic", nachmachen: "mimic", gestures: "mimic", gesten: "mimic", moves: "mimic",
  detect: "detect", erkennen: "detect", detection: "detect", boxes: "detect", vision: "detect", objects: "detect",
  all: "all", alles: "all", everything: "all", on: "all", an: "all", ein: "all",
});

// A mode's name, English or German ("nachmachen", "erkennen", "aus", ...), or null.
export function parseCameraMode(value) {
  const key = String(value ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  return Object.hasOwn(MODE_ALIASES, key) ? MODE_ALIASES[key] : null;
}

// The mode the settings are in: "off" with the camera off, else the mode whose features
// match, else "custom" (switched one by one in the dialog; no segment is lit).
export function cameraModeOf(settings) {
  if (!settings || settings.camera !== true) return "off";
  const follow = settings.followMe === true, mimic = mimicOn(settings), boxes = settings.personBoxes === true;
  if (follow && mimic && boxes) return "all";
  if (follow && mimic && !boxes) return "mimic";
  if (follow && !mimic && !boxes) return "follow";
  if (!follow && !mimic && boxes) return "detect";
  return "custom";
}

// The settings changes of mode `mode` ({} for an unknown one): `camera` and, except for
// "off", the features.
export function cameraModeSettings(mode) {
  if (mode === "off") return { camera: false };
  const f = MODE_FEATURES[mode];
  return f ? { camera: true, ...f } : {};
}
