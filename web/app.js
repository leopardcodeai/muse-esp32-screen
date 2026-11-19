// app.js: wires the page: the stage (canvas plus picture overlay) scaled to the window
// at the device pixel ratio, the display state machine drawn at the chosen frame rate,
// the settings panel, the Home Assistant connection, the figure source, the demo mode,
// the Float and Kiosk buttons, the sounds and the service worker.
//
// Pitfalls:
//  * The drawing loop runs on the requestAnimationFrame of the window the stage is in;
//    Float moves the stage into another window, so the loop is restarted there (and on
//    the way back), with a generation number that ends the old one.
//  * A first visit without stored settings is sent to demo mode (settings.js,
//    landingTarget) before anything starts, so the hosted page shows the display at once.
//  * The layout (320 x 240 of the box, or 480 x 480, `?layout=square` or the setting) is
//    chosen once at the start: renderer, display and stage are built for it. A change in
//    the settings reloads the page.
import { Renderer, allFonts, W, H } from "./render.js";
import { SQUARE_W, SQUARE_H, squareFonts, setFigureCard } from "./square.js";
import { Figure } from "./figure.js";
import { FigureSource, FIGURE_NAMES } from "./figure_frames.js";
import { WeatherIcons } from "./weather.js";
import { MediaOverlay } from "./media.js";
import { Display, VERSION } from "./display.js";
import { Sounds } from "./audio.js";
import { HaClient, EVENT_WEB, DEFAULT_DEVICE } from "./ha.js";
import { Demo, SQUARE_DEMO_CARDS } from "./demo.js";
import { floatDocument, floatVideo, unfloatVideo, hasDocumentPip, hasVideoPip, Kiosk } from "./pip.js";
import { FrameClock, BOX_FPS, fitScale, normaliseFps } from "./pace.js";
import {
  DEFAULTS, THEMES, loadSettings, saveSettings, hasStoredSettings, landingTarget, fpsFor, layoutFor, layoutReload,
  layoutChoice, parseLayoutChoice, tabletProfileFor, themeFor, insecureFromHttps, MIXED_CONTENT_NOTE,
} from "./settings.js";
import { TabletRail, railWidth, railSide } from "./tablet.js";
import { Camera } from "./camera.js";
import { Voice } from "./voice.js";
import { Sensors } from "./sensors.js";
import { applyTheme } from "./theme.js";

const $ = (id) => document.getElementById(id);
const stage = $("stage");
const canvas = $("screen");
const overlayEl = $("overlay");
const notice = $("notice");
const params = new URLSearchParams(location.search);
const demoMode = params.get("demo") === "1";

function storage() {
  try {
    return window.localStorage;
  } catch {
    return { getItem: () => null, setItem: () => { throw new Error("no storage"); } };
  }
}
let settings = loadSettings(storage());
// The HA add-on is the Muse screen: its default character is the owner's Muse figure in
// ./local, not the project's public placeholder. The migration runs once per browser
// and never touches the public Vercel demo or an explicit figure URL.
const addonOrigin = location.port === "8322" || location.pathname.startsWith("/local/muse-web/");
if (addonOrigin && !settings.figureVersion) {
  settings.figureVersion = 1;
  if (settings.figureSource === "placeholder" || !settings.figureUrl) {
    settings.figureSource = "url";
    settings.figureUrl = "./local";
    saveSettings(storage(), settings);
  }
}
const layout = layoutFor(location.search, settings);
const tablet = layout === "tablet";
let tabletProfile = tabletProfileFor(location.search, settings);
const square = layout !== "box";
// ?figurebg=card compares the black figure with the same figure on a rounded light card.
const figureCard = params.get("figurebg") === "card";
setFigureCard(figureCard);
// The logical size of the display: the box's 320 x 240, or 480 x 480.
const LW = square ? SQUARE_W : W;
const LH = square ? SQUARE_H : H;
const theme = themeFor(location.search, settings, square ? "square" : "box");
applyTheme(theme);
document.documentElement.dataset.theme = theme;
document.documentElement.classList.toggle("square", square);
document.documentElement.classList.toggle("tablet", tablet);
const themeColor = document.querySelector('meta[name="theme-color"]');
if (themeColor) themeColor.content = theme === "dark" ? "#000000" : "#f3f3f3";
const fonts = () => (square ? [...allFonts(), ...squareFonts()] : allFonts());

const log = (line) => console.info("[muse] " + line);
const renderer = new Renderer(canvas, { width: LW, height: LH });
const figure = new FigureSource({ placeholder: new Figure(), log });
figure.dark = theme === "dark" && !figureCard;
const weather = new WeatherIcons();
const media = new MediaOverlay(overlayEl);
const sounds = new Sounds();
sounds.enabled = settings.sound;
let ha = null;
let demo = null;
let restored = false;
let lastActionKey = "";
let lastActionAt = 0;
const LAST_STATE_ENTITY = "input_text.muse_web_last";
const LAST_STATE_KEY = "muse-web-last";
let hostWindow = window;
let pipWindow = null;
let videoPipActive = false;
const kiosk = new Kiosk(document.documentElement);
const frames = new FrameClock(fpsFor(location.search, settings));
figure.smooth = frames.fps > BOX_FPS;

const display = new Display({
  renderer, figure, weather, media, layout: square ? "square" : "box",
  now: () => performance.now(),
  clock: () => new Date(),
  name: settings.name || "Muse",
  sound: sounds,
  log,
  onAnswer: (answer, question) => {
    log(`answer "${answer}" to "${question}"`);
    if (ha) ha.answer(answer, question, settings.inputText).catch((e) => log("answer not sent: " + e.message));
  },
});
display.browserInfo = browserName();

// ------------------------------------------------------- tablet, camera, voice --

const rail = tablet ? new TabletRail({ log }).mount() : null;
if (rail) rail.setProfile(tabletProfile);

let cameraLight = null;
let battery = null;
let camera = null;
let voice = null;

const sensors = new Sensors({
  log,
  onUpdate: (s) => {
    if (camera && s.hasLight) camera.hasLightSensor = true;
    updateRail();
  },
  onWake: () => updateRail(),
});
sensors.start();

camera = new Camera({
  getSettings: () => settings,
  getDisplay: () => display,
  getHa: () => ha,
  baseUrl: () => settings.url || location.origin,
  token: () => settings.token,
  onFacing: (facing) => { settings.cameraFacing = facing; saveSettings(storage(), settings); },
  onLight: (luma) => { cameraLight = luma; updateRail(); },
  say,
  log,
});
camera.setProfile(tabletProfile);
camera.hasLightSensor = sensors.hasLight;
camera.setOptions(settings);
camera.setBeta(settings.camera && !demoMode);

voice = new Voice({
  getHa: () => ha,
  getSettings: () => settings,
  getDisplay: () => display,
  sounds,
  say,
  log,
  urlBase: () => settings.url || location.origin,
  token: () => settings.token,
  onState: (state, detail) => {
    if (rail) rail.setVoice(state, detail);
    updateVoiceHint(state, detail);
  },
});
voice.setEnabled(settings.voice && !demoMode);
voice.bindButton($("rail-mic"));
voice.bindButton($("btn-mic"));

// The camera mode: one switch for the rail button, the power icon on the card, the C
// key and Muse's `camera` action. It is stored, so a reload keeps the mode.
function setCameraMode(on) {
  const next = on === true && !demoMode;
  if (settings.camera === next && camera.beta === next) {
    if (next && !camera.active) camera.start({ quiet: true });
    return next;
  }
  settings.camera = next;
  saveSettings(storage(), settings);
  applyFeatureVisibility();
  updateRail();
  log(`camera mode ${next ? "on" : "off"}`);
  return next;
}
camera.onPowerOff = () => setCameraMode(false);

$("rail-camera")?.addEventListener("click", () => setCameraMode(!settings.camera));
$("rail-photo")?.addEventListener("click", () => camera.takePhoto());
$("rail-vision")?.addEventListener("click", () => camera.describe());
$("rail-fullscreen")?.addEventListener("click", () => toggleKiosk());
$("rail-settings")?.addEventListener("click", () => openSettings());
$("btn-camera")?.addEventListener("click", () => setCameraMode(!settings.camera));

function syncCameraButtons() {
  const on = !!settings.camera && !demoMode;
  const btn = $("btn-camera");
  if (btn) btn.textContent = on ? "Kamera aus" : "Kamera";
  const railBtn = $("rail-camera");
  if (railBtn) {
    railBtn.setAttribute("aria-pressed", on ? "true" : "false");
    const label = railBtn.querySelector("span");
    if (label) label.textContent = on ? "Kamera aus" : "Kamera";
  }
}

function updateMicVisibility() {
  const on = settings.voice && !demoMode;
  $("btn-mic").hidden = !on;
  $("rail-mic").hidden = !on;
  $("rail-mic-label").hidden = !on;
}

function applyFeatureVisibility() {
  const cam = settings.camera && !demoMode;
  camera.setBeta(cam);
  const camButton = $("rail-camera");
  if (camButton) camButton.hidden = demoMode;
  const toolbarCam = $("btn-camera");
  if (toolbarCam) toolbarCam.hidden = demoMode;
  for (const id of ["rail-photo", "rail-vision"]) {
    const el = $(id);
    if (el) el.hidden = !cam;
  }
  updateMicVisibility();
  camera.setOptions(settings);
  voice.setEnabled(settings.voice && !demoMode);
  if (cam) camera.start({ quiet: true });
  syncCameraButtons();
}

// Actions only this web screen understands; the box has no camera. A `device` field
// limits the action to one screen (muse_tab_screen, muse_ipad_screen, ...).
async function screenAction(action, fields) {
  const target = String(fields.device || "").trim();
  if (target && target !== settings.device) return true;
  const mode = String(fields.mode ?? fields.state ?? "").trim().toLowerCase();
  if (action === "camera") {
    const on = mode === "toggle" ? !settings.camera : !["off", "aus", "false", "0", "stop"].includes(mode);
    setCameraMode(on);
    if (on && fields.facing) {
      const facing = /back|hinten|environment|rück/.test(String(fields.facing).toLowerCase()) ? "environment" : "user";
      if (facing !== camera.facing) await camera.swap();
    }
    return true;
  }
  if (action === "photo") {
    setCameraMode(true);
    await new Promise((r) => setTimeout(r, camera.active ? 0 : 1500));
    await camera.takePhoto();
    return true;
  }
  if (action === "vision") {
    setCameraMode(true);
    await new Promise((r) => setTimeout(r, camera.active ? 0 : 1500));
    const text = await camera.describe({ quiet: true });
    if (text) {
      display.dispatch("show_text", { title: "Muse sieht", message: text });
      if (ha) ha.fireEvent("muse_web_vision", { text, device: settings.device }).catch(() => {});
    }
    return true;
  }
  return false;
}

function updateVoiceHint(state, detail = "") {
  const el = $("voice-hint");
  if (!el) return;
  if (tablet || state === "idle") {
    el.hidden = true;
    return;
  }
  const text = state === "listening" ? "Ich höre … Loslassen sendet."
    : state === "thinking" ? "Muse denkt …"
      : state === "speaking" ? "Muse spricht"
        : detail || "Mikrofon nicht verfügbar";
  el.textContent = text;
  el.hidden = false;
}

function updateRail() {
  if (!rail) return;
  rail.update({
    clock: new Date(),
    connection: display.connection,
    timer: display.timers.soonest(),
    light: camera && camera.active ? camera.luma : null,
    sensorText: sensors.lightText(),
    battery: sensors.battery || battery,
    profile: tabletProfile,
    voice: voice ? voice.state : "idle",
    voiceDetail: voice ? voice.detail : "",
    fullscreen: kiosk.active,
  });
  syncCameraButtons();
}

async function watchBattery() {
  if (typeof navigator === "undefined" || !navigator.getBattery) return;
  try {
    const b = await navigator.getBattery();
    const update = () => { battery = { level: b.level, charging: b.charging }; updateRail(); };
    update();
    b.addEventListener?.("levelchange", update);
    b.addEventListener?.("chargingchange", update);
  } catch {
    // no battery information on this browser
  }
}

setInterval(updateRail, 1000);
updateRail();
updateMicVisibility();
watchBattery();

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    camera.pause();
    if (voice.state === "listening") voice.cancel();
  } else {
    camera.resume();
  }
});


function browserName() {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return "Edge";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Safari\//.test(ua)) return "Safari";
  return "Browser";
}

// --------------------------------------------------------------- scaling --

// The stage in whole CSS pixels, the canvas backing store in device pixels: the 320 x 240
// (or 480 x 480) logical layout stays, the text is drawn at the screen's own resolution.
let quality = 1;
// 100 %: the square layout at exactly 480 x 480 CSS and 480 x 480 backing pixels, no
// device-pixel scaling. `?pixel=1|0` overrides the setting for one visit.
const pixelMode = params.has("pixel") ? params.get("pixel") === "1" : settings.pixel;

// The tablet rail takes exactly the width the full-height square leaves, so the canvas
// has no side bars. In portrait it becomes a bottom bar and CSS owns its height.
function applyTabletMetrics() {
  if (!tablet) return;
  const w = hostWindow.innerWidth || window.innerWidth;
  const h = hostWindow.innerHeight || window.innerHeight;
  const side = railSide(w, h);
  document.documentElement.classList.toggle("portrait", side === "bottom");
  if (side === "right") {
    document.documentElement.style.setProperty("--rail-w", `${railWidth(w, h)}px`);
    document.documentElement.style.removeProperty("--rail-h");
  } else {
    document.documentElement.style.removeProperty("--rail-w");
    document.documentElement.style.setProperty("--rail-h", `${Math.max(180, Math.min(320, Math.round(h * 0.32)))}px`);
  }
}

function fit() {
  applyTabletMetrics();
  const host = hostWindow;
  const rect = stage.parentElement.getBoundingClientRect();
  const dpr = host.devicePixelRatio || 1;
  if (layout === "square" && pixelMode) {
    stage.style.width = `${LW}px`;
    stage.style.height = `${LH}px`;
    renderer.resize(1);
    media.rescale(1);
    display.displayInfo = `${LW} x ${LH} px, 1:1`;
    display.browserInfo = `${browserName()}  ·  ${frames.fps} Bilder/s`;
    render();
    return;
  }
  let k = square && !settings.integer
    ? Math.min(rect.width / LW, rect.height / LH)
    : fitScale(rect.width, rect.height, LW, LH, settings.integer);
  // The Mosaico layout is crisp at 1:1 and stays sharp when a big window scales it up;
  // 2x is the ceiling, and a slow frame lowers it a step (noteDraw below).
  if (square) k = Math.min(k, 2) * quality;
  stage.style.width = `${Math.round(LW * k)}px`;
  stage.style.height = `${Math.round(LH * k)}px`;
  renderer.resize(k * dpr);
  media.rescale(k);
  display.displayInfo = `${Math.round(LW * k * dpr)} x ${Math.round(LH * k * dpr)} px`;
  display.browserInfo = `${browserName()}  ·  ${frames.fps} Bilder/s`;
  render();
}

// devicePixelRatio changes when the window moves to another screen or the page is zoomed.
let dprQuery = null;
function watchPixelRatio() {
  if (dprQuery) dprQuery.removeEventListener("change", onPixelRatio);
  dprQuery = hostWindow.matchMedia(`(resolution: ${hostWindow.devicePixelRatio || 1}dppx)`);
  dprQuery.addEventListener("change", onPixelRatio);
}
function onPixelRatio() {
  fit();
  watchPixelRatio();
}

// ------------------------------------------------------------- the loop --

let lastDraw = 0;
let fontsReady = false;
let frameTimes = [];
// 60 drawn frames decide; a median over 20 ms means the stage costs more than 50 fps,
// so the square layout drops its backing scale one step instead of stuttering.
function noteDraw(ms) {
  if (!square) return;
  frameTimes.push(ms);
  if (frameTimes.length > 60) frameTimes.shift();
  if (frameTimes.length < 60 || quality <= 0.5) return;
  const median = [...frameTimes].sort((a, b) => a - b)[30];
  if (median > 20) {
    quality = Math.max(0.5, quality - 0.25);
    frameTimes = [];
    log(`frame budget: ${median.toFixed(1)} ms per picture, backing scale ${quality}`);
    hostWindow.requestAnimationFrame(fit);
  }
}
function render() {
  if (!fontsReady) return;
  const started = performance.now();
  display.tick();
  display.render();
  noteDraw(performance.now() - started);
  lastDraw = performance.now();
  if (bare) sampleEdge(lastDraw);
}

// ------------------------------------------------------------ Nur Display --

// The window shows nothing but the display: no toolbar until the pointer nears the bottom
// edge, no frame, and the strip beside a display that does not fill the window takes the
// colour of the display's own top left pixel, read four times a second.
let bare = false;
let lastEdge = 0;
function applyBare() {
  bare = settings.bare || params.get("bare") === "1";
  document.documentElement.classList.toggle("bare", bare);
  // The installed app is a display: no toolbar at the bottom edge either. `?bar=1`
  // keeps the old hover reveal for a browser tab; the keys E, F and K still work.
  document.documentElement.classList.remove("show-bar");
  fit();
}
function sampleEdge(now) {
  if (now - lastEdge < 250) return;
  lastEdge = now;
  try {
    const c = $("screen");
    const [r, g, b] = c.getContext("2d").getImageData(1, 1, 1, 1).data;
    document.documentElement.style.setProperty("--edge", `rgb(${r}, ${g}, ${b})`);
  } catch {
    // A picture from another origin can taint the canvas; the page colour stays then.
  }
}
let barTimer = null;
document.addEventListener("pointermove", (ev) => {
  if (!bare) return;
  const near = ev.clientY > window.innerHeight - 72;
  document.documentElement.classList.toggle("show-bar", near);
  clearTimeout(barTimer);
  if (near) barTimer = setTimeout(() => document.documentElement.classList.remove("show-bar"), 4000);
});
document.addEventListener("keydown", (ev) => {
  if (dialog.open || ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const k = ev.key.toLowerCase();
  if (k === "f") $("btn-float").click();
  else if (k === "k") $("btn-kiosk").click();
  else if (k === "e" || k === ",") openSettings();
  else if (k === "m" && !ev.repeat && settings.voice && !demoMode) { ev.preventDefault(); voice.start(); }
  else if (k === "c" && !ev.repeat && !demoMode) { ev.preventDefault(); setCameraMode(!settings.camera); }
});
document.addEventListener("keyup", (ev) => {
  if (ev.key.toLowerCase() === "m" && settings.voice && !demoMode) voice.stop();
});
let loopGeneration = 0;
function startLoop() {
  const generation = ++loopGeneration;
  const win = hostWindow;
  const step = () => {
    if (generation !== loopGeneration) return;
    if (frames.due(performance.now())) render();
    win.requestAnimationFrame(step);
  };
  win.requestAnimationFrame(step);
}
// A hidden tab stops requestAnimationFrame; this keeps the state machine moving.
setInterval(() => {
  if (performance.now() - lastDraw >= 100) render();
}, 100);

function setFps(fps) {
  frames.set(fps);
  figure.smooth = frames.fps > BOX_FPS;
  if (video.srcObject) video.srcObject = null; // the Float video picks up the new rate next time
  fit();
}

// ---------------------------------------------------------------- touch --

function logical(ev) {
  const rect = canvas.getBoundingClientRect();
  return [((ev.clientX - rect.left) / rect.width) * LW, ((ev.clientY - rect.top) / rect.height) * LH];
}
function bindTouch(el) {
  el.addEventListener("pointerdown", (ev) => {
    sounds.unlock();
    el.setPointerCapture(ev.pointerId);
    const [x, y] = logical(ev);
    display.touchStart(x, y);
  });
  el.addEventListener("pointermove", (ev) => {
    if (display.touch) {
      const [x, y] = logical(ev);
      display.touchMove(x, y);
    }
  });
  const end = (ev) => {
    if (!display.touch) return;
    const [x, y] = logical(ev);
    display.touchMove(x, y);
    display.touchEnd();
    render();
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", () => { display.touch = null; });
}
bindTouch(stage);

// ------------------------------------------------------- Home Assistant --

function connect() {
  if (ha) {
    ha.close();
    ha = null;
  }
  display.host = settings.url ? settings.url.replace(/^https?:\/\//, "") : "";
  if (demoMode || !settings.url || !settings.token) {
    display.connection = demoMode ? "demo" : "off";
    return;
  }
  if (insecureFromHttps(location.protocol, settings.url)) {
    log("an http Home Assistant URL from an https page: browsers may block it as mixed content (see the settings)");
  }
  ha = new HaClient({
    urls: [settings.url, settings.urlAway].filter(Boolean),
    token: settings.token,
    device: settings.device || DEFAULT_DEVICE,
    pageProtocol: location.protocol,
    log,
    onState: (state, detail) => {
      display.connection = state;
      if (detail) log(`connection ${state}: ${detail}`);
      if (state === "on" && !restored) {
        restored = true;
        restoreLast();
      }
    },
    onAction: (a) => applyAction(a),
  });
  ha.connect();
}

// One action from either channel (the box's call_service or a muse_web event). The
// broadcast scripts call both, so the same action arrives twice within a few ms; the
// second is dropped. The last action is kept in localStorage for a reload; HA's
// input_text.muse_web_last is the source that survives another browser.
function applyAction({ action, fields = {} }) {
  const sorted = Object.keys(fields).sort().reduce((o, k) => ((o[k] = fields[k]), o), {});
  const key = action + "?" + JSON.stringify(sorted);
  const now = performance.now();
  if (key === lastActionKey && now - lastActionAt < 1200) return;
  lastActionKey = key;
  lastActionAt = now;
  log(`action ${action} ${JSON.stringify(fields).slice(0, 120)}`);
  if (["camera", "photo", "vision"].includes(action)) {
    screenAction(action, fields).then(() => render());
    return;
  }
  display.dispatch(action, fields);
  render();
  try {
    localStorage.setItem(LAST_STATE_KEY, JSON.stringify({ action, fields, at: Date.now() }));
  } catch {
    // A browser with storage disabled still shows the live actions.
  }
}

async function restoreLast() {
  let entry = null;
  try {
    const state = await ha.getState(LAST_STATE_ENTITY);
    if (state && state.state) entry = JSON.parse(state.state);
  } catch (e) {
    log("last display from HA: " + e.message);
  }
  if (!entry) {
    try {
      entry = JSON.parse(localStorage.getItem(LAST_STATE_KEY) || "null");
    } catch {
      entry = null;
    }
  }
  if (!entry || !entry.action) return;
  const flat = entry.fields && typeof entry.fields === "object" && !Array.isArray(entry.fields)
    ? entry.fields
    : Object.fromEntries(Object.entries(entry).filter(([k]) => k !== "action" && k !== "fields" && k !== "at"));
  applyAction({ action: entry.action, fields: flat });
  log(`restored ${entry.action}`);
}

// ---------------------------------------------------------------- figure --

const figureStatus = $("figure-status");
// The project's figure (figure-default/) loads once at the start; until it is there the
// figure drawn in code stands in.
async function loadDefaultFigure() {
  const r = await figure.loadDefault();
  if (r.failed.length) log(`project figure: ${r.loaded} of ${FIGURE_NAMES.length} loaded, missing ${r.failed.join(", ")}`);
  if (settings.figureSource !== "url") figureStatus.textContent = "";
}

async function useFigure() {
  // ?figure=placeholder shows the project's own figure for this visit only, whatever the
  // setting says: screenshots for the public repository never carry Meta's artwork.
  const forcePlaceholder = params.get("figure") === "placeholder";
  const url = !forcePlaceholder && settings.figureSource === "url" ? settings.figureUrl : "";
  figureStatus.textContent = url ? "lädt …" : "";
  let used = url;
  let r = await figure.use(url);
  if (r.stale) return;
  if (url && r.loaded === 0 && settings.figureUrlAway && settings.figureUrlAway !== url) {
    log(`figure from ${url} did not answer; trying ${settings.figureUrlAway}`);
    used = settings.figureUrlAway;
    r = await figure.use(used);
    if (r.stale) return;
  }
  if (used) {
    log(`figure from ${used}: ${r.loaded} of ${FIGURE_NAMES.length} loaded${r.failed.length ? ", missing " + r.failed.join(", ") : ""}`);
    if (r.loaded === 0) say("Die eigenen Bilder der Figur kamen nicht an: die Anzeige zeigt die Figur des Projekts (Konsole und Einstellungen sagen mehr).");
  }
  figureStatus.textContent = used ? figure.describe() + (r.failed.length && r.loaded ? `, fehlt: ${r.failed.join(", ")}` : "") : "";
}

// ------------------------------------------------------------- settings --

const dialog = $("settings");
const form = $("settings-form");
const mixedNote = $("mixed-note");
form.device.placeholder = DEFAULT_DEVICE;
$("device-example").textContent = DEFAULT_DEVICE;
$("device-action").textContent = `esphome.${DEFAULT_DEVICE}_muse_show_text`;
mixedNote.textContent = MIXED_CONTENT_NOTE;

function updateDialog() {
  mixedNote.hidden = !insecureFromHttps(location.protocol, form.url.value);
  const own = form.figureSource.value === "url";
  $("figure-url-row").hidden = !own;
  $("figure-url-away-row").hidden = !own;
}
function openSettings() {
  form.url.value = settings.url;
  form.urlAway.value = settings.urlAway;
  form.token.value = settings.token;
  form.device.value = settings.device;
  form.inputText.value = settings.inputText;
  form.name.value = settings.name;
  form.fps.value = String(settings.fps);
  form.figureSource.value = settings.figureSource;
  form.figureUrl.value = settings.figureUrl;
  form.figureUrlAway.value = settings.figureUrlAway;
  form.integer.checked = settings.integer;
  form.sound.checked = settings.sound;
  form.bare.checked = settings.bare;
  form.pixel.checked = settings.pixel;
  form.layout.value = layoutChoice(settings.layout, settings.tabletProfile);
  form.theme.value = settings.theme;
  form.voice.checked = settings.voice;
  form.speak.checked = settings.speak;
  form.camera.checked = settings.camera;
  form.personBoxes.checked = settings.personBoxes;
  form.autoBrightness.checked = settings.autoBrightness;
  form.vision.checked = settings.vision;
  form.visionAuto.checked = settings.visionAuto;
  form.visionEntity.value = settings.visionEntity;
  updateDialog();
  dialog.showModal();
}
form.addEventListener("input", updateDialog);
form.addEventListener("change", updateDialog);
form.addEventListener("submit", (ev) => {
  ev.preventDefault();
  const before = settings;
  const choice = parseLayoutChoice(form.layout.value) || { layout: "square", tabletProfile: null };
  settings = {
    url: form.url.value.trim(),
    urlAway: form.urlAway.value.trim(),
    token: form.token.value.trim(),
    device: form.device.value.trim() || DEFAULT_DEVICE,
    inputText: form.inputText.value.trim(),
    name: form.name.value.trim() || DEFAULTS.name,
    fps: normaliseFps(form.fps.value),
    figureSource: form.figureSource.value === "url" && form.figureUrl.value.trim() ? "url" : "placeholder",
    figureUrl: form.figureUrl.value.trim(),
    figureUrlAway: form.figureUrlAway.value.trim(),
    integer: form.integer.checked,
    sound: form.sound.checked,
    bare: form.bare.checked,
    pixel: form.pixel.checked,
    layout: choice.layout,
    tabletProfile: choice.tabletProfile || settings.tabletProfile || DEFAULTS.tabletProfile,
    theme: THEMES.includes(form.theme.value) ? form.theme.value : "auto",
    voice: form.voice.checked,
    speak: form.speak.checked,
    camera: form.camera.checked,
    cameraFacing: settings.cameraFacing,
    personBoxes: form.personBoxes.checked,
    autoBrightness: form.autoBrightness.checked,
    vision: form.vision.checked,
    visionAuto: form.visionAuto.checked,
    visionEntity: form.visionEntity.value.trim() || DEFAULTS.visionEntity,
    layoutVersion: DEFAULTS.layoutVersion,
  };
  if (!saveSettings(storage(), settings)) say("Dieser Browser speichert nichts: die Einstellungen gelten nur bis zum Neuladen.");
  dialog.close();
  // The theme picks the figure's light or dark copies, so it needs a fresh load; the
  // page keeps its last card through input_text.muse_web_last either way.
  const clean = new URL(location.href);
  clean.searchParams.delete("theme");
  history.replaceState(null, "", clean);
  if (themeFor("", settings, layout) !== theme) {
    location.href = clean.toString();
    return;
  }
  // Another layout than the one on screen (a ?layout= of the URL counts): the page starts
  // again with it, without the ?layout=, which would win.
  const reload = layoutReload(location.href, layout, settings.layout);
  if (reload) {
    const u = new URL(reload);
    if (demoMode && settings.url && settings.token && (settings.url !== before.url || settings.token !== before.token)) {
      u.searchParams.delete("demo");
    }
    location.href = u.toString();
    return;
  }
  // New credentials in demo mode: leave the demo for the real connection.
  if (demoMode && settings.url && settings.token && (settings.url !== before.url || settings.token !== before.token)) {
    const u = new URL(location.href);
    u.searchParams.delete("demo");
    location.href = u.toString();
    return;
  }
  display.name = settings.name;
  sounds.enabled = settings.sound;
  tabletProfile = settings.tabletProfile;
  if (camera) camera.setProfile(tabletProfile);
  if (rail) rail.setProfile(tabletProfile);
  applyBare();
  applyFeatureVisibility();
  updateRail();
  if (settings.fps !== before.fps) setFps(settings.fps); // a ?fps= of the URL holds until the setting changes
  else fit();
  if (settings.figureSource !== before.figureSource || settings.figureUrl !== before.figureUrl || settings.figureUrlAway !== before.figureUrlAway) useFigure();
  if (settings.url !== before.url || settings.urlAway !== before.urlAway || settings.token !== before.token || settings.device !== before.device || !ha) connect();
});
$("settings-cancel").addEventListener("click", () => dialog.close());
$("settings-close").addEventListener("click", () => dialog.close());
$("settings-version").textContent = `Version ${VERSION}`;
// The "i" buttons open the short hint of their field or card; a label must not take the
// click for its input, so the event stops here.
form.addEventListener("click", (ev) => {
  const info = ev.target.closest("button.info");
  if (!info) return;
  ev.preventDefault();
  ev.stopPropagation();
  const box = info.closest(".field, .switch, .s-card");
  if (box) box.classList.toggle("show-hint");
});
// A click on the backdrop closes the dialog like Abbrechen.
dialog.addEventListener("click", (ev) => {
  if (ev.target === dialog) dialog.close();
});
$("btn-settings").addEventListener("click", openSettings);

// ------------------------------------------------------------ float --

const video = $("pip-video");
async function toggleFloat() {
  sounds.unlock();
  if (pipWindow) {
    pipWindow.close();
    return;
  }
  if (videoPipActive) {
    await unfloatVideo(video);
    return;
  }
  const k = parseFloat(stage.style.width) / LW || 1;
  if (hasDocumentPip()) {
    try {
      pipWindow = await floatDocument(stage, {
        width: Math.round(LW * Math.min(k, square ? 1.5 : 2)),
        height: Math.round(LH * Math.min(k, square ? 1.5 : 2)),
        fonts: fonts(),
        onMove: (win) => {
          hostWindow = win;
          if (win !== window) win.addEventListener("resize", fit);
          watchPixelRatio();
          fit();
          startLoop();
        },
        onClose: () => {
          pipWindow = null;
          $("btn-float").textContent = "Float";
          fit();
        },
      });
      $("btn-float").textContent = "Zurück";
      return;
    } catch (e) {
      log("document picture-in-picture refused: " + e.message);
    }
  }
  if (hasVideoPip(video)) {
    try {
      await floatVideo(canvas, video, () => {
        videoPipActive = false;
        $("btn-float").textContent = "Float";
        video.pause();
      }, frames.fps);
      videoPipActive = true;
      $("btn-float").textContent = "Zurück";
      say("Dieser Browser kennt kein Document Picture-in-Picture: das Bild schwebt als Video, ohne Tippen und ohne Fotos.");
      return;
    } catch (e) {
      log("video picture-in-picture refused: " + e.message);
    }
  }
  say("Float braucht Chrome oder Edge (Document Picture-in-Picture) oder Safari (Video).");
}
$("btn-float").addEventListener("click", toggleFloat);
if (!hasDocumentPip() && !hasVideoPip(video)) $("btn-float").disabled = true;

// ------------------------------------------------------------- kiosk --

async function toggleKiosk() {
  sounds.unlock();
  if (kiosk.active) {
    await kiosk.exit();
    $("btn-kiosk").textContent = "Kiosk";
  } else {
    await kiosk.enter();
    $("btn-kiosk").textContent = "Zurück";
    if (!("wakeLock" in navigator)) say("Kein Wake Lock in diesem Browser: der Bildschirm kann sich abschalten.");
  }
  fit();
}
$("btn-kiosk").addEventListener("click", toggleKiosk);
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && kiosk.active) {
    kiosk.exit();
    $("btn-kiosk").textContent = "Kiosk";
  }
  fit();
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && kiosk.active) toggleKiosk();
});

// -------------------------------------------------------------- demo --

// "Demo aus" sets demo=0 instead of dropping the parameter, so a page without stored
// settings does not land in the demo again.
$("btn-demo").addEventListener("click", () => {
  const u = new URL(location.href);
  u.searchParams.set("demo", demoMode ? "0" : "1");
  location.href = u.toString();
});

let noticeTimer = null;
function say(text) {
  notice.textContent = text;
  notice.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.hidden = true; }, 8000);
}

// ------------------------------------------------------------- start --

async function start() {
  const target = landingTarget(location.href, hasStoredSettings(storage()));
  if (target) {
    location.replace(target);
    return;
  }
  await Promise.all(fonts().map((f) => document.fonts.load(f).catch(() => null)));
  await document.fonts.ready;
  fontsReady = true;
  applyTabletMetrics();
  applyBare();
  window.addEventListener("resize", fit);
  watchPixelRatio();
  startLoop();
  loadDefaultFigure();
  useFigure();
  if (demoMode) {
    $("btn-demo").textContent = "Demo aus";
    demo = new Demo(display, {
      fetchText: async (path) => {
        const res = await fetch(path);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      },
      log,
      extraCards: square ? SQUARE_DEMO_CARDS : [],
      endQuestions: square,
    });
    demo.start();
  } else {
    connect();
    if (!settings.url || !settings.token) openSettings();
  }
  applyFeatureVisibility();
  updateRail();
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    const first = !navigator.serviceWorker.controller;
    navigator.serviceWorker.register("./sw.js").then(async () => {
      await navigator.serviceWorker.ready;
      // The add-on's document headers forbid camera and microphone. The worker answers
      // the next navigation with its own policy; one reload on the very first start
      // moves the page under that response. Later SW updates do not reload the panel.
      if (first && !sessionStorage.getItem("muse-sw-reload")) {
        try { sessionStorage.setItem("muse-sw-reload", "1"); } catch { /* storage blocked */ }
        location.reload();
      }
    }).catch((e) => log("service worker not registered: " + e.message));
  }
  log(`Muse Web Screen ${VERSION}; ${layout}${tablet ? " (" + tabletProfile + ")" : ""} layout ${LW} x ${LH}; ${frames.fps} frames a second; muse_web events: ${EVENT_WEB}`);
}
start();

// For the browser console: muse.dispatch("show_text", {title: "Hallo", message: "Welt"}).
window.muse = {
  display,
  camera,
  voice,
  rail,
  sensors,
  dispatch: (action, fields) => { const r = display.dispatch(action, fields); render(); return r; },
  settings: () => ({ ...settings, token: settings.token ? "(set)" : "" }),
  fps: (n) => { if (n !== undefined) setFps(n); return frames.fps; },
};
