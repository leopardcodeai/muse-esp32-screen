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

export const SETTINGS_KEY = "muse-web-settings";
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
// layoutVersion 2 moves a stored box layout once to square, the Mosaico default; an
// explicit choice after that is kept.
export const LAYOUT_VERSION = 2;
export const DEFAULTS = Object.freeze({
  url: "", token: "", device: DEFAULT_DEVICE, inputText: "", name: "Muse", integer: false, sound: true,
  fps: DEFAULT_FPS, figureSource: "placeholder", figureUrl: "", bare: false, layout: "square",
  theme: "auto", pixel: false, urlAway: "", figureUrlAway: "", layoutVersion: LAYOUT_VERSION,
  tabletProfile: "tab", voice: true, speak: true, camera: false, cameraFacing: "user", personBoxes: true,
  autoBrightness: true, vision: true, visionAuto: false, visionEntity: "ai_task.google_ai_task",
  visionModel: "Gemini 3.5 Flash Lite", visionDailyLimit: 1000,
  voiceModel: "Gemini Sprache", voiceDailyLimit: 1000,
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
  s.device = String(s.device || "").trim() || DEFAULT_DEVICE;
  s.fps = normaliseFps(s.fps);
  if (!FIGURE_SOURCES.includes(s.figureSource)) s.figureSource = DEFAULTS.figureSource;
  s.bare = s.bare === true;
  s.pixel = s.pixel === true;
  for (const key of ["voice", "speak", "camera", "personBoxes", "autoBrightness", "vision", "visionAuto"]) {
    s[key] = stored[key] === undefined ? DEFAULTS[key] : stored[key] === true;
  }
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
// "Prüfe Dyson …" on every start (19.11.2026). Only content is restored.
export const TRANSIENT_ACTIONS = ["set_status", "set_status_text", "reload", "camera", "photo", "vision"];
export function restorable(action) {
  return Boolean(action) && !TRANSIENT_ACTIONS.includes(String(action));
}
