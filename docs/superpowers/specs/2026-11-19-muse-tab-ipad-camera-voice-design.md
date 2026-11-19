# Muse Web Screen: Tab and iPad profiles, camera beta, voice

Status: approved in chat on 19 November 2026. This spec is the source for the
implementation plan. The web app version becomes 1.7.0.

Repository: `~/Coding/muse-esp32-s3-box-3-screen`, branch `main`.

## Goal

Muse Web Screen gets two full-screen tablet profiles, **Tab** and **iPad**, plus a
separate camera beta and a push-to-talk voice channel:

1. The Layout dropdown offers `Tab` and `iPad` next to the existing Mosaico and
   box layouts. A tablet profile fills the whole display: the 480 x 480 Muse
   canvas takes the full height and a rail on the right uses the remaining
   width. No black bars, no letterboxing on 16:10 and 4:3 landscape screens.
2. The camera is a beta feature with its own switch, off by default. When it is
   on, a small mirrored live view floats at the top right (a tile in the tablet
   rail, a draggable window in Mosaico and box), with local person boxes and a
   short caption. It also works in Mosaico.
3. Microphone and speaker become a normal feature, not beta: hold the microphone
   button, speak, release. Home Assistant's preferred Assist pipeline ("Muse":
   Whisper, `conversation.muse`, Piper) answers, and the answer is spoken through
   the tablet's speaker.
4. The camera also estimates the room brightness and dims the page; mobile
   browsers expose no real ambient light sensor.
5. A **Vision** button sends one snapshot through Home Assistant's existing
   `ai_task.google_ai_task` and shows a short German description under the live
   view. This is the agreed workaround while Muse itself cannot receive images.

The default view stays as it is today when the camera beta is off. The camera
feature is opt-in; the microphone records only while its button is held.

## Non-goals

- No change to `conversation.muse`, the Muse bridge, the Muse pipeline, the
  add-on image, or the ESPHome device.
- No image or video sent to Meta Muse. The bridge is text-only. The Vision
  description comes from an AI Task entity in Home Assistant, not from Muse.
- No true ambient light sensor, no system brightness control, no wake word, no
  continuous listening, no face recognition or identity.
- No video calls, no recording to disk, no camera stream in Home Assistant.
- No redesign of the 480 x 480 square layout. The tablet layout reuses it.
- No new API key in the web app, in the repository, or in this spec. The Vision
  path uses the AI Task integration that Home Assistant already has.

## Context

### Existing web app

- `web/index.html` has a settings dialog with a Layout dropdown: `square`
  (480 x 480 Mosaico, default) and `box` (320 x 240).
- `web/settings.js` stores everything in `localStorage` under
  `muse-web-settings`. `layoutFor`, `themeFor`, `layoutReload` and the defaults
  live here. The module has no DOM so the Node tests can run it.
- `web/app.js` picks the layout once at start, builds the renderer, display,
  Home Assistant client, figure source, demo and toolbar, and reloads the page
  when the layout changes.
- `web/square.js` draws the complete 480 x 480 design. `web/display.js` is the
  state machine, independent of the browser.
- `web/ha.js` is the websocket client. It authenticates with a long-lived token,
  subscribes to `call_service` and `muse_web` events, and exposes
  `command`, `callService`, `getState`, `fireEvent`.
- `web/media.js` shows photos as an `<img>` element above the canvas. A data URL
  works as a picture URL.
- `web/sw.js` caches the app shell. The project has no build step and plain ES
  modules.
- The repository has uncommitted work in `web/cards.js`, `web/display.js`,
  `web/media.js`, `web/queue.js` and their tests (timed image cards, chart
  containment, a status fix). It must be preserved.

### Deployment

- The add-on `local_muse_web_screen` serves `/config/www/muse-web` over HTTPS on
  port 8322 and proxies `/api/` to Home Assistant. The add-on image does not
  contain the web app.
- `tools/make_ha_bundle.sh` builds `web/local/ha-bundle/`;
  `tools/sync_ha_web.py` uploads changed files. A LaunchAgent runs the sync
  every 15 minutes.
- The certificate includes `<tailscale-ip>`, `homeassistant.local`, `muse.local`
  and the Tailscale name. The tablet app uses `https://<tailscale-ip>:8322/`.
- Camera and microphone need a secure context and a permission grant. The
  mkcert CA must be trusted on the iPad.

### Home Assistant

- HA 2026.11.2 is reachable over Tailscale at
  `http://<ha-host>.<tailnet>.ts.net:8123`.
- The preferred Assist pipeline is "Muse": faster-whisper (`de`),
  `conversation.muse`, Piper (`de_DE-thorsten-medium`).
- `ai_task.google_ai_task` exists and supports image tasks. The live check
  below returned a German description.
- `POST /api/media_source/local_source/upload` is available to the owner's token
  (admin) and stores files in `/media`.
- `ai_task.generate_data` accepts `attachments` with a local media source ID.
- `media_source/local_source/remove` over the websocket deletes the uploaded
  file again.

### Live-checked Vision path (19 November 2026)

The following was executed against the live HA instance with the owner token,
without printing the token:

1. Uploaded `docs/screens/mac-desktop.jpg` as
   `media-source://media_source/local/muse-test/muse-test.jpg`.
2. Called `ai_task.generate_data` with
   `entity_id: ai_task.google_ai_task`, the media attachment and the German
   prompt "Beschreibe in einem kurzen deutschen Satz, was auf diesem Bild zu
   sehen ist."
3. Received `service_response.data`:
   "Das Bild zeigt ein GitHub-Repository für ein ESP32-S3-BOX-Projekt mit einer
   laufenden „Muse Web Screen"-Anwendung, die einen Geburtstagsgruß anzeigt."
4. Deleted the test file with `media_source/local_source/remove`.

This proves the Vision route needs no new key and no Mac proxy.

## 1. Layout profiles Tab and iPad

### 1.1 Dropdown and stored values

The Layout dropdown gets two more options, labelled exactly **Tab** and **iPad**:

| Option label | Stored `layout` | Stored `tabletProfile` |
|---|---|---|
| 480 x 480, Mosaico (Standard) | `square` | unchanged |
| 320 x 240, wie die Box | `box` | unchanged |
| Tab | `tablet` | `tab` |
| iPad | `tablet` | `ipad` |

- `LAYOUTS` becomes `["box", "square", "tablet"]`.
- `DEFAULTS.layout` stays `square`. `DEFAULTS.tabletProfile` is `tab`.
- `loadSettings` validates `tabletProfile` against `["tab", "ipad"]`.
- `openSettings` maps `layout === "tablet"` plus the profile to `tablet-tab` or
  `tablet-ipad`.
- The form submit maps a composite value back to `layout` and
  `tabletProfile`.
- Changing between two tablet profiles does not reload the page. It updates the
  profile label and the rail. Changing between box, square and tablet reloads,
  as the existing `layoutReload` does.

### 1.2 URL parameters

- `?layout=tablet&device=tab` and `?layout=tablet&device=ipad` apply to one
  visit.
- `?layout=tablet-tab` and `?layout=tablet-ipad` are accepted as a shorthand.
- `?demo=1&layout=tablet` shows the tablet layout in demo mode.
- The existing `?layout=square|box` behaviour is unchanged.

### 1.3 Geometry

The tablet layout is a CSS grid with two areas: the page (canvas) and the rail.

- In landscape, `--rail-w = clamp(240px, 100vw - 100vh, 520px)`.
  The page is therefore exactly as wide as the viewport is tall, so the
  480 x 480 canvas scales to the full height with no side bars.
- In portrait, the rail moves below the page and gets a height of
  `clamp(180px, 32vh, 320px)`. The canvas fills the width; the page keeps the
  square aspect.
- Safe-area insets (`env(safe-area-inset-*)`) pad the page and rail.
- The existing `fit()` keeps using the stage's parent rectangle; in tablet mode
  that parent is the page area. The canvas backing store stays at the device
  pixel ratio.
- `html.tablet` hides `#toolbar`. The rail carries the settings and fullscreen
  buttons instead. `bare` and `?bare=1` do not hide the rail.
- The page uses the full viewport, including under a browser's translucent
  bars where the platform allows it. The installed app or a fullscreen tap
  removes the remaining browser chrome; no auto-fullscreen is attempted,
  because browsers require a gesture.

### 1.4 Rail

The rail is a DOM element (`#rail`), not part of the canvas. It has, top to
bottom:

1. A camera slot. It is reserved even when the camera is off; the slot then
   shows a camera icon and "Kamera einschalten" (or "Kamera (Beta)" when the
   beta is disabled in the settings). The floating camera element sits over
   this slot; see section 2.
2. A large clock (`HH:MM`, about 64 px) and the weekday and date below it.
3. The connection status: a coloured dot and "Muse" plus one of "verbunden",
   "verbindet …", "getrennt" or "Demo". The values come from `display.connection`.
4. The timer chip when a timer runs: name and remaining time.
5. The microphone button, about 88 px round, with the label
   "Halten zum Sprechen". Its ring pulses while listening, thinking or
   speaking; the label changes with the voice state.
6. A row of action buttons: camera (stream on/off), photo, vision, fullscreen,
   settings.
7. A footer with "Licht 64 %" when the camera is on and `autoBrightness` is on,
   and the battery percentage and charging state when the Battery API is
   available.

The rail updates once a second and immediately on voice or connection changes.
It has no canvas and no animation beyond the microphone ring and the CSS
transitions. Labels are German data; the code is English.

### 1.5 Default view

With the camera beta off, the tablet layout shows the canvas, the clock, the
status, the microphone button (when voice is on) and the action row. It does not
show a camera slot; the space is used by the clock. The Mosaico and box layouts
keep their current appearance, plus the microphone button in the toolbar when
voice is on.

## 2. Camera beta

### 2.1 Switches and defaults

- `settings.camera` (default `false`) is the beta master switch. It is the
  "Kamera (Beta)" checkbox in the settings. When false, no camera element, no
  camera button in the toolbar and no rail camera slot exist.
- When true, the camera UI exists. A runtime `cameraOn` state controls the
  stream. The overlay has its own power switch; the tablet rail placeholder and
  the toolbar camera button toggle the same state.
- `settings.personBoxes` (default `true`) controls the local person boxes and
  the local caption. It has no effect when the camera is off.
- `settings.autoBrightness` (default `true`) controls the camera-based dimming.
  It has no effect when the camera is off.
- `settings.vision` (default `true`) shows the Vision button. It sends nothing
  until pressed.
- `settings.visionAuto` (default `false`) sends one snapshot every 60 seconds
  while the camera is on and the page is visible. It is labelled as a beta that
  sends images and may cost money.
- The camera stream does not start in demo mode, without a secure context, or
  without `navigator.mediaDevices.getUserMedia`.

### 2.2 Overlay

The camera element (`#camera`) is a rounded card with:

- a header: camera icon, "Kamera", a small "Beta" badge, and a power switch;
- a 16:9 live video, mirrored for the front camera, `playsinline`, muted,
  `autoplay`;
- a transparent overlay canvas for person boxes;
- a caption below the video: the local person text, or the Vision description
  with a small "Vision" badge;
- a footer with "Foto" and "Vision" buttons, plus a drag handle.

Placement:

- Tablet: fixed at the top right, width `calc(var(--rail-w) - 24px)`, over the
  reserved rail slot. Not draggable while docked. The rail clock starts below
  it.
- Mosaico and box: fixed at the top right, width `min(220px, 40vw)`,
  draggable. The position is stored in `localStorage` under
  `muse-camera-pos` as `{left, top}` in CSS pixels. A double tap on the header
  resets it to the top right.
- The overlay is hidden when `cameraOn` is false in Mosaico and box. In tablet,
  the slot shows the placeholder instead.

### 2.3 Local person detection

- The detector is MediaPipe Tasks Vision ObjectDetector with the
  EfficientDet-Lite0 model, pinned to a tested version in code.
- It loads lazily on the first camera start. The JavaScript, WASM and model come
  from the CDNs the MediaPipe documentation names; the exact URLs are recorded
  in `camera.js` and cached by the service worker at runtime.
- Configuration: `runningMode: "VIDEO"`, `scoreThreshold: 0.5`,
  `maxResults: 5`, GPU delegate when available, CPU fallback.
- Only detections with `categoryName === "person"` are used.
- Detection runs at most twice a second, only while the page is visible and the
  video has a frame. It never runs while the camera is off.
- Boxes are mapped from the video's intrinsic size to the displayed video size,
  including the mirror flip for the front camera. The mapping is a pure
  function with unit tests.
- The caption is local and German:
  - no person: "Niemand im Bild"
  - one person: "Ich sehe dich"
  - more than one: "Ich sehe N Personen"
  - detector loading: "Erkenne Personen …"
  - detector failed: "Erkennung nicht verfügbar"
  - camera starting: "Kamera startet …"
- If the model cannot be loaded, the camera and the Vision button still work;
  only the boxes and the local caption are missing.

### 2.4 Photo

- The photo button draws the current video frame into a canvas at up to
  1280 x 720, encodes JPEG at quality 0.85, and calls
  `display.showImageTimed("Kamera", "Gerade aufgenommen", dataUrl, 30)`.
- The photo card is a normal Muse image card and stays local. It is not
  uploaded, not sent to HA and not stored on disk.
- If the camera is off, the photo button starts it, waits for the first frame
  and then takes the picture. A failure shows a notice.

### 2.5 Lifecycle and errors

- `enable()` requests
  `getUserMedia({video: {facingMode: "user", width: {ideal: 1280}, height: {ideal: 720}}, audio: false})`.
- `disable()` stops every track, clears the video source, clears the boxes and
  resets the dim layer.
- On `visibilitychange` to hidden, the stream and detection stop. On visible,
  they restart when `cameraOn` was true.
- Permission denied: the placeholder says "Kamera nicht erlaubt" and offers a
  retry; no retry loop.
- No camera: "Keine Kamera gefunden".
- The browser's own camera indicator remains visible; the app does not hide it.
- The camera never starts automatically when `settings.camera` is false.

### 2.6 Mosaico and box

- The toolbar gets a camera button when `settings.camera` is true. It toggles
  `cameraOn` and shows or hides the floating overlay.
- The overlay works over the 480 x 480 canvas and over the 320 x 240 canvas.
- The overlay can cover the top bar while it is on. It is opt-in, draggable and
  can be switched off with one tap.

## 3. Vision description

### 3.1 Flow

1. The user presses "Vision" on the camera overlay. If `visionAuto` is on, the
   same flow runs every 60 seconds while the camera is on.
2. The app takes a JPEG snapshot (the same encoder as the photo button).
3. It uploads the snapshot to Home Assistant:
   `POST {ha}/api/media_source/local_source/upload`, multipart form with
   `media_content_id=media-source://media_source/local/muse-camera` and a fixed
   filename per profile (`muse-tab-camera.jpg`, `muse-ipad-camera.jpg`,
   `muse-square-camera.jpg`, `muse-box-camera.jpg`). The fixed name overwrites
   the previous image instead of accumulating files.
4. It calls
   `POST {ha}/api/services/ai_task/generate_data?return_response` with:
   ```json
   {
     "task_name": "Muse Kamera",
     "entity_id": "ai_task.google_ai_task",
     "instructions": "Beschreibe in einem kurzen deutschen Satz, was auf diesem Bild zu sehen ist. Nenne Personen, Tiere und auffällige Gegenstände. Keine Aufzählung, keine technische Analyse.",
     "attachments": [
       {"media_content_id": "<returned id>", "media_content_type": "image/jpeg"}
     ]
   }
   ```
5. It reads `service_response.data` and shows it in the caption for 30 seconds
   with a "Vision" badge. After that the local caption returns.
6. It removes the uploaded image with the websocket command
   `media_source/local_source/remove` and the returned media ID, even when the
   AI call failed.
7. Only one Vision run at a time per page. A second press while a run is active
   is ignored.

### 3.2 Provider and settings

- `settings.visionEntity` defaults to `ai_task.google_ai_task`. The settings
  dialog has a text field for it. If Claude, OpenAI or another provider is added
  to HA as an AI Task entity later, the owner changes this field; no web code
  changes.
- If the field is empty, `entity_id` is omitted and HA uses its preferred AI
  Task entity.
- No API key is stored in the browser, the repository or the add-on. The AI
  Task integration holds its own credentials in Home Assistant.
- The prompt is fixed in `camera.js` as a German string; it is data, not code.

### 3.3 Errors and privacy

- Upload 401/403: "Vision braucht einen Admin-Token." The camera and local
  boxes keep working.
- Missing AI Task entity or service error: "Vision ist nicht eingerichtet."
- Timeout after 30 seconds: "Vision antwortet nicht."
- The image leaves the house only on an explicit Vision press (or every 60 s
  when `visionAuto` is on). The settings text says so.
- The uploaded file is deleted after the call. If deletion fails, the next run
  overwrites the same fixed filename.
- The Vision description is not written to Home Assistant's state machine and
  not sent to Muse.

## 4. Voice

### 4.1 Push-to-talk

- One large round microphone button in the tablet rail. In Mosaico and box, a
  microphone button in the toolbar. Keyboard shortcut `M` (keydown starts,
  keyup ends) for a desktop.
- Pointer down starts recording; pointer up, pointer cancel or leaving the
  button ends it. Holding longer than 30 seconds stops automatically.
- The button shows listening, thinking, speaking and error states. A small
  floating status pill appears in Mosaico and box; the rail label carries it in
  tablet mode.
- Only one voice run at a time. A new press while a run is active is ignored
  with a short hint.
- The microphone is never open in the background.

### 4.2 Capture and resampling

- `getUserMedia({audio: {channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true}})`.
- Audio is captured through an AudioWorklet (`web/pcm-worklet.js`) when
  available, with a ScriptProcessor fallback.
- The audio context runs at its native rate. `web/pcm.js` resamples the
  Float32 chunks to 16 kHz and converts them to signed 16-bit little-endian PCM.
  The pure functions have unit tests.
- The buffers are held in memory only. Nothing is written to disk.

### 4.3 Pipeline protocol

- On release, `HaClient.runPipeline` sends:
  ```json
  {
    "type": "assist_pipeline/run",
    "start_stage": "stt",
    "end_stage": "tts",
    "input": {"sample_rate": 16000}
  }
  ```
  The preferred pipeline is used (the "Muse" pipeline). No wake word stage.
- `run-start` carries `runner_data.stt_binary_handler_id`. Every binary
  websocket message starts with that one-byte handler ID, followed by raw PCM.
  The end of the audio is a one-byte message containing only the handler ID.
- The client handles `stt-end` (recognised text), `intent-end` (answer text),
  `tts-end` (audio URL), `error` and `run-end`. The pipeline may take 10 to 30
  seconds; the status stays "Muse denkt …".
- If `stt-end` is empty, the run stops with "Nichts verstanden".
- The existing `conversation.muse` pipeline still sends `set_status_text` and
  `show_text` to the screen through HA. The answer card therefore appears as
  today.

### 4.4 Speaker

- `tts-end.tts_output.url` is resolved against the Home Assistant base URL
  (the add-on origin on the tablet), fetched with the page's token when the
  proxy requires it, decoded with the already unlocked `AudioContext` and
  played through the speaker.
- The microphone press is the user gesture that unlocks audio. A short
  "Ton an" confirmation is not needed when the context is already running.
- A new answer stops the previous TTS. The UI sounds (timer, question) use the
  same context but their own gain.
- If TTS fails, the answer card is still shown; the rail says "Ton nicht
  verfügbar".

### 4.5 Fallback card

- If no new display card arrives within one second after `intent-end`, the app
  offers the answer text as a local text card (`mode 1`, title "Muse", 20 s).
  This covers a Muse answer that does not call the screen action.
- If a card arrived, no fallback is shown.

### 4.6 Permissions and limits

- The microphone permission is requested on the first press. A denial is shown
  in the rail and as a notice, and the button stays available for a retry.
- Secure context required. On a plain HTTP page the button is disabled with a
  note.
- No wake word, no continuous listening, no voice activity detection.
- The Muse pipeline itself is text-only towards Muse; audio never goes to Meta
  Muse. Whisper and Piper run in Home Assistant.

## 5. Ambient brightness

- A real ambient light sensor is not available to mobile browsers. The camera
  frame is the sensor.
- Every two seconds the camera draws a 32 x 18 frame into a scratch canvas and
  computes the mean luma (0 to 1).
- An exponential moving average smooths the value (alpha 0.3).
- The target dim is `0.55 * (1 - min(1, luma / 0.6))`, clamped to 0 to 0.55.
  Bright light: no dim. Dark room: up to 55 % black.
- Changes apply only when the target differs from the current dim by more than
  0.05, at most once every five seconds. A CSS transition of 1.5 seconds removes
  visible steps.
- The dim layer is a fixed black overlay with `pointer-events: none`, above the
  canvas and rail but below the camera overlay, so the self-view stays visible.
- "Licht 64 %" in the rail is the smoothed luma, not a calibrated lux value.
- When the camera is off or `autoBrightness` is false, the dim is 0.
- No system brightness is changed. On the tablet the operating system's own
  brightness applies; the page only darkens its own content.

## 6. Settings reference

New fields in `muse-web-settings`:

| Key | Default | UI label (German) | Notes |
|---|---|---|---|
| `layout` | `square` | Layout | now also `tablet` |
| `tabletProfile` | `tab` | (part of the Layout select) | `tab` or `ipad` |
| `voice` | `true` | Mikrofon: mit Muse sprechen | push-to-talk only |
| `speak` | `true` | Antworten vorlesen | Piper audio |
| `camera` | `false` | Kamera (Beta) | master switch |
| `personBoxes` | `true` | Personen im Kamerabild markieren | local model |
| `autoBrightness` | `true` | Helligkeit über die Kamera anpassen | camera only |
| `vision` | `true` | Vision-Beschreibung anbieten | button only |
| `visionAuto` | `false` | Vision automatisch, jede Minute | sends images |
| `visionEntity` | `ai_task.google_ai_task` | AI-Task-Entität für Vision | text field |

The settings dialog gets two new sections:

**Sprache**
- checkbox `voice`
- checkbox `speak`
- note: "Das Mikrofon hört nur, solange der Knopf gedrückt ist. Whisper und
  Piper laufen in Home Assistant; an Meta Muse geht nur Text."

**Kamera (Beta)**
- checkbox `camera`
- checkbox `personBoxes`
- checkbox `autoBrightness`
- checkbox `vision`
- checkbox `visionAuto`
- text `visionEntity`
- note: "Kamera und Mikrofon brauchen HTTPS und eine einmalige Freigabe. Einen
  echten Umgebungssensor geben mobile Browser nicht frei; die Helligkeit wird
  aus dem Kamerabild geschätzt. Die Vision-Beschreibung schickt ein Foto an die
  AI-Task-Entität in Home Assistant und wird nach der Antwort gelöscht."

The existing fields and defaults stay unchanged. `layoutVersion` stays 2; no
migration is needed for the new keys.

## 7. Architecture and files

New modules:

- `web/tablet.js`: tablet rail and geometry helpers. Exports pure helpers
  (`railWidth`, `railSide`, `profileLabel`) and a `TabletRail` class that mounts
  the DOM and updates it from a state object. DOM access is injected for tests.
- `web/camera.js`: camera stream, MediaPipe loading, person detection, box
  mapping, caption, luma, dim, photo and Vision. Pure helpers are exported for
  tests.
- `web/voice.js`: push-to-talk state machine, capture, pipeline, TTS and
  fallback. Dependencies (`getUserMedia`, `AudioContext`, `HaClient`, `display`,
  `sounds`) are injected.
- `web/pcm.js`: resampling and PCM16 conversion, pure functions.
- `web/pcm-worklet.js`: the AudioWorklet processor.

Modified modules:

- `web/settings.js`: new keys, validation, composite layout parsing, URL
  helpers.
- `web/app.js`: build the tablet rail, camera and voice; wire the buttons,
  shortcuts, visibility and settings; apply the tablet CSS class and rail width.
- `web/index.html`: new settings fields, rail container, camera element, voice
  hint, dim layer.
- `web/style.css`: tablet grid, rail, camera card, voice states, dim layer,
  portrait layout.
- `web/ha.js`: streaming `runPipeline`, binary send, media removal helper and a
  REST helper that resolves against the configured HA base URL.
- `web/sw.js`: cache the new modules and runtime-cache the MediaPipe JavaScript,
  WASM and model.
- `web/display.js`: version 1.7.0.
- `web/package.json`: version 1.7.0.

Not modified: `web/square.js`, `web/cards.js`, `web/media.js`, `web/queue.js`.
The uncommitted changes in the working tree stay as they are; the implementation
builds on top of them.

## 8. Data flow

```
Camera stream -> <video> -> overlay canvas (local boxes)
                        -> scratch canvas (luma) -> dim layer
                        -> snapshot -> HA media upload -> ai_task -> caption

Mic -> AudioWorklet -> PCM16 16 kHz -> HA websocket (assist_pipeline/run)
    -> Whisper -> conversation.muse -> Piper -> tts URL -> AudioContext
    -> show_text action -> display card
```

## 9. Error handling

| Situation | Behaviour |
|---|---|
| No secure context | Camera and microphone buttons disabled with a note |
| Camera permission denied | Placeholder "Kamera nicht erlaubt", retry available |
| No camera device | "Keine Kamera gefunden"; Vision and photo disabled |
| Detector model fails | Camera and Vision work; boxes and local caption off |
| Vision upload 401/403 | "Vision braucht einen Admin-Token" |
| AI Task missing | "Vision ist nicht eingerichtet" |
| Vision timeout | "Vision antwortet nicht" after 30 s |
| Microphone denied | Rail and notice; button stays for retry |
| No HA connection | Voice disabled with "Keine Verbindung" |
| Empty STT | "Nichts verstanden" |
| Pipeline error | Message from the error event; state returns to idle |
| TTS fetch fails | Answer card remains; "Ton nicht verfügbar" |

All errors are shown in German in the UI and logged in English to the console.
No error loop retries automatically except the existing HA websocket reconnect.

## 10. Privacy and security

- The camera is off by default and has a master switch. The microphone records
  only while held.
- Local person detection runs in the browser. No image is uploaded for the
  local boxes or the local caption.
- Vision is explicit (button or opt-in auto). It uploads one JPEG to the
  owner's Home Assistant, which passes it to the configured AI Task provider.
  The file is removed after the answer.
- No API key is stored in the browser, the repository or the add-on.
- The HA token remains in the browser's `localStorage`, as today. It is sent
  only to the configured HA base URL (the add-on origin).
- The uploaded file name is fixed per profile and contains no personal data.
- No photo or video is written to disk, no recording is kept, and nothing is
  sent to Meta Muse.
- The camera overlay is visible whenever the stream is on; the browser's own
  camera indicator stays.

## 11. Testing

### 11.1 Unit tests (Node)

- `web/test/settings.test.js`: new defaults, validation, composite layout
  parsing, URL handling, unchanged migration.
- `web/test/pcm.test.js`: resampling from 48 kHz and 44.1 kHz to 16 kHz, PCM16
  clipping, chunk merge, empty input.
- `web/test/camera.test.js`: caption for zero, one and many persons; box mapping
  with and without mirroring; luma computation; dim curve and hysteresis;
  filename per profile.
- `web/test/tablet.test.js`: rail width for 16:10, 4:3 and portrait; profile
  labels "Tab" and "iPad".
- `web/test/voice.test.js`: state machine with injected fakes; pipeline event
  order; fallback card only when no card arrived; TTS URL resolution.
- `web/test/vision.test.js`: upload form fields, service payload, media ID
  extraction, removal even on failure, error messages.

The existing tests must keep passing. The README test that checks the settings
dialog against `DEFAULT_DEVICE` must be updated for the new fields if it
inspects the dialog text.

### 11.2 Manual live checks

1. Chrome on the Mac, `https://<tailscale-ip>:8322/`, camera permission:
   - Tab layout fills a 16:10 window; iPad layout fills a 4:3 window.
   - Camera overlay shows the mirrored self-view; person boxes follow; the
     caption is correct.
   - Vision returns a German sentence and removes the file from `/media`.
   - Photo shows a card.
   - Dim layer follows a hand over the camera.
2. Voice, with the "Muse" pipeline:
   - Hold the microphone, say "Hallo Alex", release.
   - `stt-end`, `intent-end`, `tts-end` arrive; Piper audio plays.
   - The answer card appears; no fallback duplicate.
   - A second run while the first is active is ignored.
3. Samsung Tab A11+ and iPad, in the installed app:
   - Layout, safe areas, rail, camera permission, microphone permission, TTS
     and dimming.
   - The mkcert CA is trusted and the page is a secure context.
4. Mosaico and box layouts:
   - No camera UI when the beta is off.
   - Camera button appears when the beta is on; the overlay is draggable and
     switches off.
5. Existing layouts and features: demo mode, figure sources, last-card restore,
   Float/Kiosk, timer and question sounds.

No real token, image or API key appears in a test or a log.

## 12. Deployment

1. Bump the web version to 1.7.0 in `display.js` and `package.json`.
2. Update `web/README.md`, `README.md`, `CHANGELOG.md` and `docs/PRIVACY.md`.
3. Run `node --test web/test` from the repository root.
4. Run `tools/make_ha_bundle.sh`.
5. Run `tools/sync_ha_web.py` (the host file must point at the current Pi;
   the last known working address is `<LAN address of the Pi>`, and the Tailscale address
   is `<tailscale-ip>`). No add-on rebuild and no restart are needed.
6. Open `https://<tailscale-ip>:8322/` in Chrome, verify the new version and the
   Tab/iPad profiles, and check the console.
7. On the tablets, reload the installed app. Install the mkcert CA first if it
   is not trusted; camera and microphone need it.
8. Record the live check in `CHANGELOG.md` or the next status report.

If the add-on's Samba host file still points at the old `.133` address, update
the private `web/local/ha-samba-host` to the current address before syncing.
This file is not committed.

## 13. Risks and limitations

- iOS Safari may restrict `getUserMedia` in a home-screen web app or require a
  fresh permission prompt. The UI degrades to a placeholder with a note.
- The MediaPipe download is about 14 MB on first use. It is cached; without
  internet the camera still works, but the boxes do not.
- Vision depends on the AI Task provider, its quota and its latency. It is
  on-demand by default; auto mode can cost money.
- The upload endpoint needs an admin token. If the tablet uses a restricted
  token, Vision is unavailable while camera and voice still work.
- The camera overlay can cover content in Mosaico and box. It is opt-in,
  draggable and switchable.
- Camera and detection use battery and produce heat. Detection is throttled and
  stops when the page is hidden. There is no low-power schedule in this version.
- A browser cannot change system brightness, and there is no real lux sensor.
  The dim layer is relative, not calibrated.
- Muse still does not see the camera. The "Muse sieht" text is the Vision
  description from the AI Task, labelled as such.

## 14. Acceptance criteria

- The Layout dropdown contains exactly the labels Tab and iPad, and both fill
  a 16:10 and a 4:3 landscape screen without letterboxing.
- With the camera beta off, the Mosaico and box views look as they do today.
- The camera switch is present when the beta is on, works in tablet, Mosaico
  and box, and stops the stream immediately.
- Local person boxes and the German caption work without a network after the
  model is cached.
- Vision returns a German description through `ai_task.google_ai_task`,
  displays it with a Vision badge, and removes the uploaded file.
- Push-to-talk reaches the Muse pipeline, plays Piper audio and shows the
  answer card without a duplicate fallback.
- The ambient dim changes with the light and does not flicker.
- The photo button shows a local image card.
- All existing tests and the new tests pass; the live check is recorded.
- No API key, token or personal image is added to the repository.

## Appendix A: German UI strings

- Layout options: `480 x 480, Mosaico (Standard)`, `320 x 240, wie die Box`,
  `Tab`, `iPad`
- Rail: `Halten zum Sprechen`, `Ich höre …`, `Muse denkt …`, `Muse spricht`,
  `Verbunden`, `Verbinde …`, `Getrennt`, `Demo`
- Camera: `Kamera`, `Beta`, `Kamera einschalten`, `Kamera startet …`,
  `Kamera nicht erlaubt`, `Keine Kamera gefunden`, `Niemand im Bild`,
  `Ich sehe dich`, `Ich sehe N Personen`, `Erkenne Personen …`,
  `Erkennung nicht verfügbar`
- Vision: `Vision`, `Vision denkt …`, `Vision antwortet nicht`,
  `Vision ist nicht eingerichtet`, `Vision braucht einen Admin-Token`
- Photo: `Foto`, `Gerade aufgenommen`
- Brightness: `Licht N %`
- Settings notes as in section 6.

## Appendix B: Implementation order

1. Settings values, composite layout, URL parsing and tests.
2. Tablet grid, rail skeleton, clock/status and tests.
3. Camera stream, local detection, caption, photo, dim and tests.
4. Voice capture, PCM, pipeline, TTS, fallback and tests.
5. Vision upload, AI Task call, cleanup, error states and tests.
6. Wire the settings dialog, toolbar, shortcuts and visibility.
7. Docs, version bump, bundle, live check and deployment.
