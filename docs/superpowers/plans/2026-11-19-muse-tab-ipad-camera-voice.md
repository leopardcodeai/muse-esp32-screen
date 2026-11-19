# Muse Tab and iPad Profiles, Camera Beta, Voice and Vision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Tab and iPad full-screen profiles, an opt-in camera beta with local person boxes and an HA Vision path, and push-to-talk voice with spoken answers to Muse Web Screen 1.7.0.

**Architecture:** Keep the existing 480 x 480 square renderer untouched. Add a DOM rail beside it for the tablet layout. Add three focused browser modules (`tablet.js`, `camera.js`, `voice.js`) plus a pure PCM helper (`pcm.js`); extend `settings.js`, `ha.js`, `app.js`, `index.html`, `style.css` and `sw.js`. The HA add-on still serves the static files and proxies `/api/`; no add-on image change is needed.

**Tech Stack:** Plain ES modules, no build step; Node 22 `node:test`; MediaPipe Tasks Vision ObjectDetector; Home Assistant websocket `assist_pipeline/run`; Home Assistant REST upload plus `ai_task.generate_data`.

---

### Task 1: Settings values and layout parsing

**Files:**
- Modify: `web/settings.js`
- Test: `web/test/settings.test.js`

- [ ] **Step 1: Write the failing tests**

Add to `web/test/settings.test.js`:

```js
import {
  LAYOUTS, TABLET_PROFILES, layoutChoice, parseLayoutChoice, tabletProfileFor,
} from "../settings.js";

test("tablet profiles: Tab and iPad are layouts, not device strings", () => {
  assert.deepEqual(LAYOUTS, ["box", "square", "tablet"]);
  assert.deepEqual(TABLET_PROFILES, ["tab", "ipad"]);
  assert.equal(layoutChoice("square", "tab"), "square");
  assert.equal(layoutChoice("tablet", "ipad"), "tablet-ipad");
  assert.deepEqual(parseLayoutChoice("tablet-tab"), { layout: "tablet", tabletProfile: "tab" });
  assert.deepEqual(parseLayoutChoice("tablet-ipad"), { layout: "tablet", tabletProfile: "ipad" });
  assert.deepEqual(parseLayoutChoice("box"), { layout: "box", tabletProfile: null });
  assert.equal(parseLayoutChoice("nonsense"), null);
});

test("tabletProfileFor(): URL wins, then setting, then tab", () => {
  assert.equal(tabletProfileFor("", { tabletProfile: "ipad" }), "ipad");
  assert.equal(tabletProfileFor("?device=tab", { tabletProfile: "ipad" }), "tab");
  assert.equal(tabletProfileFor("?layout=tablet-ipad", { tabletProfile: "tab" }), "ipad");
  assert.equal(tabletProfileFor("?device=nope", { tabletProfile: "ipad" }), "ipad");
  assert.equal(tabletProfileFor("", { tabletProfile: "nope" }), "tab");
});

test("loadSettings(): the new device switches have safe defaults", () => {
  const s = loadSettings(memory());
  assert.equal(s.layout, "square");
  assert.equal(s.tabletProfile, "tab");
  assert.equal(s.voice, true);
  assert.equal(s.speak, true);
  assert.equal(s.camera, false);
  assert.equal(s.personBoxes, true);
  assert.equal(s.autoBrightness, true);
  assert.equal(s.vision, true);
  assert.equal(s.visionAuto, false);
  assert.equal(s.visionEntity, "ai_task.google_ai_task");
  const bad = loadSettings(memory({ [SETTINGS_KEY]: JSON.stringify({ tabletProfile: "x", visionEntity: 7, camera: "yes" }) }));
  assert.equal(bad.tabletProfile, "tab");
  assert.equal(bad.visionEntity, "ai_task.google_ai_task");
  assert.equal(bad.camera, false);
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `node --test web/test/settings.test.js`
Expected: FAIL because `LAYOUTS`, `TABLET_PROFILES`, `layoutChoice`, `parseLayoutChoice` and `tabletProfileFor` are missing.

- [ ] **Step 3: Implement**

In `web/settings.js`:

```js
export const LAYOUTS = ["box", "square", "tablet"];
export const TABLET_PROFILES = ["tab", "ipad"];

DEFAULTS adds:
  tabletProfile: "tab", voice: true, speak: true, camera: false, personBoxes: true,
  autoBrightness: true, vision: true, visionAuto: false, visionEntity: "ai_task.google_ai_task",

export function layoutChoice(layout, profile) {
  return layout === "tablet" ? `tablet-${TABLET_PROFILES.includes(profile) ? profile : "tab"}` : layout;
}

export function parseLayoutChoice(value) {
  const v = String(value || "").trim().toLowerCase();
  if (v === "tablet-tab") return { layout: "tablet", tabletProfile: "tab" };
  if (v === "tablet-ipad") return { layout: "tablet", tabletProfile: "ipad" };
  if (v === "tablet") return { layout: "tablet", tabletProfile: null };
  if (v === "box" || v === "square") return { layout: v, tabletProfile: null };
  return null;
}

export function tabletProfileFor(search, settings) {
  const p = new URLSearchParams(search);
  const fromLayout = p.has("layout") ? parseLayoutChoice(p.get("layout")) : null;
  const want = p.get("device") || (fromLayout && fromLayout.tabletProfile) || settings.tabletProfile;
  return TABLET_PROFILES.includes(String(want || "").toLowerCase())
    ? String(want).toLowerCase() : DEFAULTS.tabletProfile;
}
```

`loadSettings` validates `tabletProfile`, the five booleans (strict `=== true`) and `visionEntity` (non-empty string, else default). Keep `layoutVersion` at 2 and keep all existing keys.

- [ ] **Step 4: Run the tests**

Run: `node --test web/test/settings.test.js`
Expected: PASS, including all existing settings tests.

- [ ] **Step 5: Commit**

```bash
git add web/settings.js web/test/settings.test.js
git commit -m "Settings: Tab and iPad profiles, camera beta and voice switches"
```

---

### Task 2: Tablet geometry and rail

**Files:**
- Create: `web/tablet.js`
- Create: `web/test/tablet.test.js`
- Modify: `web/index.html`
- Modify: `web/style.css`

- [ ] **Step 1: Write failing tests for the pure geometry**

`web/test/tablet.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { railWidth, railSide, profileLabel } from "../tablet.js";

test("railWidth(): the leftover width makes the page square", () => {
  assert.equal(railWidth(960, 600), 360);
  assert.equal(railWidth(1180, 820), 360);
  assert.equal(railWidth(1024, 768), 256);
  assert.equal(railWidth(700, 900), 0, "portrait uses the bottom bar");
  assert.equal(railWidth(2000, 500), 520, "capped");
});

test("railSide() and profileLabel()", () => {
  assert.equal(railSide(960, 600), "right");
  assert.equal(railSide(700, 900), "bottom");
  assert.equal(profileLabel("tab"), "Tab");
  assert.equal(profileLabel("ipad"), "iPad");
  assert.equal(profileLabel("x"), "Tab");
});
```

- [ ] **Step 2: Run and see them fail**

Run: `node --test web/test/tablet.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `web/tablet.js`**

Export the three pure helpers and a `TabletRail` class:

```js
export function railWidth(width, height) {
  if (!(width >= height)) return 0;
  return Math.max(240, Math.min(520, width - height));
}
export function railSide(width, height) { return width >= height ? "right" : "bottom"; }
export function profileLabel(profile) { return profile === "ipad" ? "iPad" : "Tab"; }

export class TabletRail {
  constructor(opts = {}) {
    this.doc = opts.document || (typeof document !== "undefined" ? document : null);
    this.log = opts.log || (() => {});
    this.profile = "tab";
    this.root = null;
  }
  mount() { /* query #rail and all children, return this; missing elements are tolerated */ }
  setProfile(profile) { this.profile = profile === "ipad" ? "ipad" : "tab"; }
  update(state) {
    // time HH:MM, date "Donnerstag, 19. November" via Intl.DateTimeFormat("de-DE"),
    // dot class from state.connection, status text, timer name + time, light "Licht N %",
    // battery "82 %" + "lädt", mic data-state and label, fullscreen label.
  }
  setVoice(state, detail) { /* root.dataset.voice = state; label text */ }
}
```

Use the existing `timeLeft` from `text.js` for the timer. `update` must no-op without a root.

- [ ] **Step 4: Add the rail markup to `web/index.html`**

Wrap the existing `#page` in `<div id="tablet-shell">` and add `<aside id="rail" hidden>` after it. The rail contains `#rail-time`, `#rail-date`, `#rail-status-dot`, `#rail-status-text`, `#rail-timer`, `#rail-mic`, `#rail-mic-label`, `#rail-camera`, `#rail-photo`, `#rail-vision`, `#rail-fullscreen`, `#rail-settings`, `#rail-light`, `#rail-battery`. Add `#camera`, `#dim`, `#voice-hint` after the shell. Icons are inline SVG with `aria-label` and `title`; no emoji.

Add the new toolbar buttons `#btn-mic` and `#btn-camera` after `#btn-float`. Both start `hidden`.

- [ ] **Step 5: Add tablet CSS to `web/style.css`**

```css
#rail { display: none; }
#tablet-shell { display: contents; }
html.tablet #tablet-shell {
  position: fixed; inset: 0; display: grid;
  grid-template-columns: minmax(0, 1fr) var(--rail-w, 360px);
  height: 100dvh; width: 100vw; overflow: hidden;
}
html.tablet #page { position: static; inset: auto; min-width: 0; min-height: 0; height: 100%; }
html.tablet #rail { display: flex; flex-direction: column; gap: 12px; padding: 12px; overflow: hidden; }
html.tablet #toolbar { display: none; }
html.tablet #camera { width: calc(var(--rail-w, 360px) - 24px); }
@media (orientation: portrait) {
  html.tablet #tablet-shell { grid-template-columns: 1fr; grid-template-rows: minmax(0, 1fr) var(--rail-h, 260px); }
  html.tablet #rail { flex-direction: row; flex-wrap: wrap; }
  html.tablet #camera { width: min(220px, 42vw); }
}
```

Add the rail typography, buttons, camera card, dim layer (`z-index: 20`), camera (`z-index: 30`) and voice hint (`z-index: 35`). Use the existing theme variables.

- [ ] **Step 6: Run the tests and check the page loads**

Run: `node --test web/test/tablet.test.js`
Expected: PASS.
Open `http://localhost:8321/web/?demo=1&layout=tablet` after `npm run serve`, or use the HA URL later. Expected: the demo canvas fills the height and the rail shows the clock and controls.

- [ ] **Step 7: Commit**

```bash
git add web/tablet.js web/test/tablet.test.js web/index.html web/style.css
git commit -m "Tablet layout: Tab and iPad rail"
```

---

### Task 3: Camera pure helpers

**Files:**
- Create: `web/camera.js`
- Create: `web/test/camera.test.js`

- [ ] **Step 1: Write failing tests**

`web/test/camera.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { captionFor, mapBox, lumaFromRgba, dimFor, visionFilename } from "../camera.js";

test("captionFor(): German, counts people", () => {
  assert.equal(captionFor(0, "ready"), "Niemand im Bild");
  assert.equal(captionFor(1, "ready"), "Ich sehe dich");
  assert.equal(captionFor(3, "ready"), "Ich sehe 3 Personen");
  assert.equal(captionFor(0, "loading"), "Erkenne Personen …");
  assert.equal(captionFor(0, "failed"), "Erkennung nicht verfügbar");
  assert.equal(captionFor(0, "starting"), "Kamera startet …");
});

test("mapBox(): pixels to display pixels, mirrored when asked", () => {
  const box = { originX: 100, originY: 50, width: 200, height: 400 };
  assert.deepEqual(mapBox(box, 1000, 500, 500, 250, false), { x: 50, y: 25, w: 100, h: 200 });
  assert.deepEqual(mapBox(box, 1000, 500, 500, 250, true), { x: 350, y: 25, w: 100, h: 200 });
});

test("lumaFromRgba(): Rec. 709 mean", () => {
  assert.equal(Math.round(lumaFromRgba(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255])) * 100), 50);
  assert.equal(lumaFromRgba(new Uint8ClampedArray([0, 0, 0, 255])), 0);
});

test("dimFor(): bright is 0, dark is capped, small changes are ignored", () => {
  assert.equal(dimFor(1, 0), 0);
  assert.equal(dimFor(0, 0), 0.55);
  assert.equal(dimFor(0.3, 0.5), 0.5, "a small move keeps the last value");
  assert.ok(dimFor(0.2, 0.5) >= 0.5);
});

test("visionFilename(): fixed per profile", () => {
  assert.equal(visionFilename("tab"), "muse-tab-camera.jpg");
  assert.equal(visionFilename("ipad"), "muse-ipad-camera.jpg");
  assert.equal(visionFilename("square"), "muse-square-camera.jpg");
});
```

- [ ] **Step 2: Run and see them fail**

Run: `node --test web/test/camera.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the pure helpers**

In `web/camera.js`, export `captionFor`, `mapBox`, `lumaFromRgba`, `dimFor`, `visionFilename` and `VISION_PROMPT`. Use the formulas from the spec:

```js
export const VISION_PROMPT = "Beschreibe in einem kurzen deutschen Satz, was auf diesem Bild zu sehen ist. Nenne Personen, Tiere und auffällige Gegenstände. Keine Aufzählung, keine technische Analyse.";

export function mapBox(b, vw, vh, dw, dh, mirrored) {
  const sx = dw / vw, sy = dh / vh;
  const x = b.originX * sx, y = b.originY * sy, w = b.width * sx, h = b.height * sy;
  return { x: mirrored ? dw - x - w : x, y, w, h };
}
export function dimFor(luma, previous = 0) {
  const target = Math.max(0, Math.min(0.55, 0.55 * (1 - Math.min(1, luma / 0.6))));
  return Math.abs(target - previous) > 0.05 ? target : previous;
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test web/test/camera.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/camera.js web/test/camera.test.js
git commit -m "Camera: pure caption, box, luma and dim helpers"
```

---

### Task 4: Camera stream, detection, photo and dim

**Files:**
- Modify: `web/camera.js`
- Modify: `web/index.html`
- Modify: `web/style.css`
- Modify: `web/sw.js`

- [ ] **Step 1: Add the `Camera` class**

Implement `Camera` with injected dependencies:

```js
new Camera({
  elements: { root, video, boxes, caption, badge, power, photo, vision, drag, slot },
  getSettings: () => settings,
  getDisplay: () => display,
  getHa: () => ha,
  baseUrl: () => settings.url || location.origin,
  token: () => settings.token,
  getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
  onLight: (luma) => { ... },
  say, log,
})
```

Methods: `setBeta(bool)`, `setProfile(profile)`, `start({quiet})`, `stop()`, `toggle()`, `pause()`, `resume()`, `snapshot()`, `takePhoto()`, `describe()`, `setVisionEntity()`, `setAutoBrightness()`, `setVisionAuto()`.

Detection: lazy `import(VISION_URL)`, `FilesetResolver.forVisionTasks(WASM_URL)`, `ObjectDetector.createFromOptions` with `runningMode: "VIDEO"`, `scoreThreshold: 0.5`, `maxResults: 5`, model `MODEL_URL`, GPU with CPU fallback. Pin exact tested CDN URLs in constants. Run at most every 500 ms, only visible and `video.readyState >= 2`. Draw mirrored boxes on `#camera-boxes` at device pixel ratio. Update the caption with `captionFor`.

Luma: every 2 s draw the video into a 32 x 18 canvas, `lumaFromRgba`, EMA 0.3, `dimFor`, set `#dim.style.opacity`.

Photo: `snapshot()` draws the frame at up to 1280 x 720, JPEG 0.85; `takePhoto()` calls `display.showImageTimed("Kamera", "Gerade aufgenommen", url, 30)`.

Lifecycle: stop tracks, clear boxes, reset dim, handle `visibilitychange`, permission errors with German messages.

- [ ] **Step 2: Add the camera card to `web/index.html`**

Markup with `#camera`, `#camera-video`, `#camera-boxes`, `#camera-caption`, `#camera-badge`, `#camera-power`, `#camera-photo`, `#camera-vision`, and a drag header. Add `#dim`. Keep it `hidden` by default.

- [ ] **Step 3: Add the camera CSS**

Rounded card, 16:9 video, mirrored via `transform: scaleX(-1)`, boxes canvas absolute, caption pill, power switch, footer buttons, drag cursor, mobile sizes. `#dim` is a fixed black overlay with `pointer-events: none; transition: opacity 1.5s;`.

- [ ] **Step 4: Update `web/sw.js`**

Bump `VERSION` to `muse-web-screen-1.7.0`, add `./tablet.js`, `./camera.js`, `./voice.js`, `./pcm.js`, `./pcm-worklet.js` to the shell. Add a runtime cache for `cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/` and `storage.googleapis.com/mediapipe-` requests in the fetch handler, cache-first.

- [ ] **Step 5: Test manually without wiring**

Temporarily call `camera.setBeta(true); camera.start()` from the browser console on the local server, grant the camera, and check the mirror, boxes, caption, photo and dim. Expected: no console errors, camera stops with `camera.stop()`.

- [ ] **Step 6: Commit**

```bash
git add web/camera.js web/index.html web/style.css web/sw.js
git commit -m "Camera beta: live overlay, local person boxes, photo and dimming"
```

---

### Task 5: PCM, HA pipeline and voice

**Files:**
- Create: `web/pcm.js`
- Create: `web/pcm-worklet.js`
- Create: `web/voice.js`
- Create: `web/test/pcm.test.js`
- Create: `web/test/voice.test.js`
- Modify: `web/ha.js`
- Modify: `web/audio.js`
- Modify: `web/test/ha.test.js`

- [ ] **Step 1: Write failing PCM tests**

`web/test/pcm.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { downsample, toPcm16, mergeFloat32 } from "../pcm.js";

test("downsample(): 48 kHz to 16 kHz keeps a third of the samples", () => {
  const input = new Float32Array(4800).fill(0.5);
  const out = downsample(input, 48000, 16000);
  assert.equal(out.length, 1600);
  assert.equal(out[0], 0.5);
});
test("toPcm16(): clips and scales", () => {
  const out = toPcm16(new Float32Array([-2, -1, 0, 1, 2]));
  assert.equal(out[0], -32768);
  assert.equal(out[1], -32768);
  assert.equal(out[2], 0);
  assert.equal(out[3], 32767);
  assert.equal(out[4], 32767);
});
test("mergeFloat32(): concatenates in order", () => {
  const out = mergeFloat32([new Float32Array([1, 2]), new Float32Array([3])]);
  assert.deepEqual([...out], [1, 2, 3]);
});
```

Run: `node --test web/test/pcm.test.js` -> FAIL.

- [ ] **Step 2: Implement `web/pcm.js` and `web/pcm-worklet.js`**

Box-average downsample, clamp/convert to `Int16Array`, merge. The worklet posts copies of each input channel:

```js
class PCMProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor("muse-pcm", PCMProcessor);
```

Run the tests -> PASS.

- [ ] **Step 3: Write failing voice tests**

`web/test/voice.test.js`: inject a fake HA with `runPipeline` that emits `run-start`, `stt-end`, `intent-end`, `tts-end`, `run-end`, and a fake display with `version`. Assert the state sequence, fallback only when `display.version` did not change, and `resolveTtsUrl`.

- [ ] **Step 4: Extend `web/ha.js`**

Add `sendRaw(bytes)`; `runPipeline({ audio, sampleRate, onEvent })` with a `streams` map keyed by command id; route `event` messages with that id to `onEvent`; on `run-start` read `runner_data.stt_binary_handler_id`, send `Uint8Array([handlerId]) + 16-bit little-endian PCM` chunks of 4096 samples, then the one-byte terminator; resolve on the command `result`, reject on socket close. Reject cleanly when not authenticated.

- [ ] **Step 5: Add TTS playback to `web/audio.js`**

Add `playUrl(url, base)` that fetches, `decodeAudioData`, stops the previous TTS source, plays through the existing context, and returns a promise. Keep the chimes unchanged. Add unit tests with a fake context if practical; otherwise test only URL resolution.

- [ ] **Step 6: Implement `web/voice.js`**

State machine `idle`, `listening`, `thinking`, `speaking`, `error`; `start()`, `stop()`, `cancel()`, `bindButton(el)`, `setEnabled(bool)`. Capture with AudioWorklet or ScriptProcessor, resample with `pcm.js`, call `ha.runPipeline`, play `tts-end` audio when `settings.speak`, and offer a fallback text card when `display.version` did not change one second after `intent-end`. Max 30 s, one run at a time, injected dependencies for tests.

- [ ] **Step 7: Run tests**

Run: `node --test web/test/pcm.test.js web/test/voice.test.js web/test/ha.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add web/pcm.js web/pcm-worklet.js web/voice.js web/test/pcm.test.js web/test/voice.test.js web/ha.js web/audio.js web/test/ha.test.js
git commit -m "Voice: PCM capture, Assist pipeline and Piper playback"
```

---

### Task 6: Vision upload and AI Task

**Files:**
- Modify: `web/camera.js`
- Create: `web/test/vision.test.js`

- [ ] **Step 1: Write failing tests**

Test pure/injected pieces: `visionFilename` (already), `visionRequest(mediaId, entity)` returns the exact `ai_task.generate_data` payload, `mediaIdFromUpload` reads the response, and a failed AI call still triggers removal. Use a fake `fetch` and fake `ha.command`.

- [ ] **Step 2: Implement `Camera.describe()`**

1. `snapshot()`.
2. `FormData` with `media_content_id = media-source://media_source/local/muse-camera` and the fixed filename.
3. `POST {base}/api/media_source/local_source/upload` with the Bearer token; parse `media_content_id`.
4. `POST {base}/api/services/ai_task/generate_data?return_response` with the payload from the spec; read `service_response.data`.
5. Show the text in the caption for 30 s with the `Vision` badge.
6. `ha.command({type:"media_source/local_source/remove", media_content_id})` in `finally`.
7. Map 401/403, missing entity, timeout and network errors to the German messages.
8. Guard one run at a time; support `visionAuto` every 60 s while visible.

- [ ] **Step 3: Run the tests**

Run: `node --test web/test/vision.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/camera.js web/test/vision.test.js
git commit -m "Vision: upload a snapshot and describe it with HA ai_task"
```

---

### Task 7: Wire app, settings dialog and toolbar

**Files:**
- Modify: `web/app.js`
- Modify: `web/index.html`
- Modify: `web/style.css`
- Modify: `web/test/settings.test.js` (dialog labels, if checked)

- [ ] **Step 1: Add the settings fields**

In the Layout select add `tablet-tab` ("Tab") and `tablet-ipad` ("iPad"). Add sections "Sprache" (`voice`, `speak`) and "Kamera (Beta)" (`camera`, `personBoxes`, `autoBrightness`, `vision`, `visionAuto`, `visionEntity`) with the notes from the spec.

- [ ] **Step 2: Wire `web/app.js`**

- `layout = layoutFor(...)`; `tablet = layout === "tablet"`; `square = layout !== "box"`; `tabletProfile = tabletProfileFor(...)`.
- `Display` gets `layout: square ? "square" : "box"`.
- Toggle `html.tablet`; set `--rail-w`/`--rail-h` on resize before `fit()`.
- Mount the rail, camera and voice; bind the rail buttons, toolbar buttons and `M`/`C` keys.
- Start the camera only when `settings.camera` is true; start voice only on press; stop both on hidden.
- On settings submit, parse the composite layout, update `tabletProfile` without reload, apply `camera`, `personBoxes`, `autoBrightness`, `vision`, `visionAuto`, `visionEntity`, `voice`, `speak`; reload only when the layout changes.
- Update `openSettings` and the form reset for all new fields.
- Add `window.muse.camera`, `window.muse.voice`, `window.muse.rail`.
- Keep the existing demo, figure, last-card, Float and Kiosk paths working.

- [ ] **Step 3: Rail and voice UI states**

Update `TabletRail` on a one-second interval and on connection/voice changes. Show/hide `#btn-mic` and `#btn-camera` by setting. In Mosaico/box, show a `#voice-hint` pill while listening/thinking/speaking/error.

- [ ] **Step 4: Run all tests**

Run: `node --test web/test`
Expected: PASS, including the existing tests and the README/device consistency test.

- [ ] **Step 5: Manual smoke test**

`npm run serve` -> `http://localhost:8321/web/?demo=1&layout=tablet` and `?layout=square`; check the rail, microphone button, camera placeholder and settings fields. No real HA needed for the layout.

- [ ] **Step 6: Commit**

```bash
git add web/app.js web/index.html web/style.css web/settings.js web/tablet.js
git commit -m "App: wire Tab and iPad profiles, camera beta and voice controls"
```

---

### Task 8: Docs, version, bundle, deploy and live test

**Files:**
- Modify: `web/README.md`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/PRIVACY.md`
- Modify: `web/display.js`
- Modify: `web/package.json`
- Modify: `homeassistant/addon/muse-web-screen/DOCS.md` (admin token note)

- [ ] **Step 1: Bump 1.7.0 and document**

Set `VERSION = "1.7.0"` in `display.js`, `"version": "1.7.0"` in `package.json`, and the service worker cache name. Document Tab/iPad, the camera beta, local detection, Vision via `ai_task`, voice, ambient dimming and privacy in `web/README.md`, `README.md`, `CHANGELOG.md`, `docs/PRIVACY.md` and the add-on doc.

- [ ] **Step 2: Run all tests**

Run: `node --test web/test`
Expected: PASS.

- [ ] **Step 3: Build the bundle**

Run: `tools/make_ha_bundle.sh`
Expected: `web/local/ha-bundle/config/www/muse-web/` contains the new modules and 1.7.0.

- [ ] **Step 4: Fix the deployment host**

The private `web/local/ha-samba-host` currently says `<old LAN address>` (stale). Set it to the working Pi address (`<LAN address of the Pi>` on the LAN, or `<tailscale-ip>` over Tailscale) and test the SMB connection. Do not commit this file.

- [ ] **Step 5: Deploy**

Run: `tools/sync_ha_web.py`
Expected: `deployed N changed file(s)` and no error. No add-on restart needed.

- [ ] **Step 6: Mac live test**

Open `https://<tailscale-ip>:8322/` in Chrome. Verify:
- version 1.7.0 in the console log;
- Tab layout at 960 x 600 and iPad layout at 1180 x 820 (responsive mode);
- camera overlay, local boxes, caption, photo, dim;
- Vision returns a German sentence and the `/media` file is removed;
- hold-to-talk reaches the Muse pipeline, Piper audio plays and the answer card appears;
- existing Mosaico and box views are unchanged with the camera beta off.

- [ ] **Step 7: Tablet check**

Reload the app on the Samsung Tab A11+ and the iPad. Verify the layout, safe areas, camera and microphone permissions, TTS and dimming. If the devices are not reachable from this session, record exactly what was verified in responsive mode and what needs the owner's one-time permission.

- [ ] **Step 8: Commit and record**

```bash
git add web/README.md README.md CHANGELOG.md docs/PRIVACY.md web/display.js web/package.json homeassistant/addon/muse-web-screen/DOCS.md
git commit -m "Release Muse Web Screen 1.7.0: Tab and iPad, camera beta, voice and vision"
```

Record the live check in `CHANGELOG.md` or the next status report.

---

## Self-review

- Spec coverage: layout profiles (Task 1, 2, 7), camera beta (Task 3, 4, 7), Vision (Task 6), voice (Task 5, 7), ambient brightness (Task 4), settings (Task 1, 7), docs/deploy (Task 8), privacy (Task 8).
- No placeholders: every step names a file, a command or a concrete function; the DOM/network steps name the exact endpoints and payloads.
- Type consistency: `layout` values `box|square|tablet`, `tabletProfile` `tab|ipad`, `cameraOn`, `Vision`, `railWidth`, `captionFor`, `dimFor`, `visionFilename`, `runPipeline`, `sendRaw` are used consistently.
