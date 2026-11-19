// camera.js: the opt-in camera beta of Muse Web Screen.
//
// The camera is a small floating card, not part of the 480 x 480 canvas. It shows a
// mirrored live view, draws local person boxes with MediaPipe, estimates the room
// brightness for the dim layer, takes a local photo card and (on demand) asks Home
// Assistant's AI Task to describe one snapshot.
//
// Privacy: no image leaves the device for the local boxes or the local caption. Only
// the explicit Vision button (or the opt-in minute timer) uploads one JPEG to the
// owner's Home Assistant, which passes it to the configured AI Task entity. The file
// is removed after the answer.
//
// Pitfalls:
//  * The camera is off by default and the browser permission may be refused; every
//    failure becomes a German caption, never a retry loop.
//  * The MediaPipe JavaScript, WASM and model are large (about 14 MB together); they
//    are loaded on the first camera start and cached by the service worker. If they
//    fail, the camera and Vision still work, only the boxes are missing.
//  * `getUserMedia` needs a secure context. A page on plain HTTP disables the feature.
//  * The Vision upload endpoint needs an admin token; a restricted token gets a clear
//    message while camera, voice and local boxes keep working.
//  * Only one Vision run at a time; a second press is ignored.
//
// The pure helpers are exported for the Node tests; the class is only built in the
// browser, with all browser APIs injectable.

export const PERSON_MODEL_URL = "https://storage.googleapis.com/mediapipe-tasks/object_detector/efficientdet_lite0_uint8.tflite";
export const VISION_JS_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/vision_bundle.mjs";
export const VISION_WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm";
export const VISION_PROMPT = "Beschreibe in einem kurzen deutschen Satz, was auf diesem Bild zu sehen ist. Nenne Personen, Tiere und auffällige Gegenstände. Keine Aufzählung, keine technische Analyse.";
export const VISION_FOLDER = "media-source://media_source/local/muse-camera";
const VISION_MS = 30000;
const DETECT_MS = 500;
const LUMA_MS = 2000;

// The German caption of the local detection.
export function captionFor(count, state = "ready") {
  if (state === "starting") return "Kamera startet …";
  if (state === "loading") return "Erkenne Personen …";
  if (state === "failed") return "Erkennung nicht verfügbar";
  if (!(count > 0)) return "Niemand im Bild";
  return count === 1 ? "Ich sehe dich" : `Ich sehe ${count} Personen`;
}

// A MediaPipe bounding box (pixels of the video frame) in the displayed, optionally
// mirrored video rectangle.
export function mapBox(box, videoW, videoH, displayW, displayH, mirrored = false) {
  if (!box || !(videoW > 0) || !(videoH > 0)) return { x: 0, y: 0, w: 0, h: 0 };
  const sx = displayW / videoW;
  const sy = displayH / videoH;
  const x = box.originX * sx;
  const y = box.originY * sy;
  const w = box.width * sx;
  const h = box.height * sy;
  return { x: mirrored ? displayW - x - w : x, y, w, h };
}

// Rec. 709 luma of RGBA bytes, 0 to 1.
export function lumaFromRgba(data) {
  if (!data || data.length < 4) return 0;
  let sum = 0;
  let n = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    n++;
  }
  return n ? sum / n / 255 : 0;
}

// The black overlay's opacity for a luma value. Bright: 0. Dark: up to 0.55. A small
// move keeps the previous value, so a cloud does not make the screen flicker.
export function dimFor(luma, previous = 0) {
  const l = Math.max(0, Math.min(1, Number(luma) || 0));
  const target = Math.max(0, Math.min(0.55, 0.55 * (1 - Math.min(1, l / 0.6))));
  return Math.abs(target - previous) > 0.05 ? target : previous;
}

// The fixed upload filename per profile; overwriting instead of accumulating.
export function visionFilename(profile) {
  const p = profile === "ipad" ? "ipad" : profile === "square" ? "square" : profile === "box" ? "box" : "tab";
  return `muse-${p}-camera.jpg`;
}

// The exact ai_task.generate_data payload. An empty entity lets HA use its preferred
// AI Task entity.
export function visionPayload(entity, mediaId) {
  const payload = {
    task_name: "Muse Kamera",
    instructions: VISION_PROMPT,
    attachments: [{ media_content_id: mediaId, media_content_type: "image/jpeg" }],
  };
  const id = String(entity || "").trim();
  if (id) payload.entity_id = id;
  return payload;
}

export function mediaIdFromUpload(json) {
  return json && typeof json.media_content_id === "string" ? json.media_content_id : "";
}

export function cameraErrorMessage(err) {
  const name = err && err.name ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Kamera nicht erlaubt";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "Keine Kamera gefunden";
  if (name === "NotReadableError") return "Kamera ist belegt";
  return "Kamera nicht verfügbar";
}

export function visionErrorMessage(status, message = "") {
  if (status === 401 || status === 403) return "Vision braucht einen Admin-Token";
  if (status === 404) return "Vision ist nicht eingerichtet";
  if (/entity|not found|unknown/i.test(String(message))) return "Vision ist nicht eingerichtet";
  return "Vision antwortet nicht";
}

// A data URL as a Blob, without a network round trip.
export function dataUrlBlob(dataUrl) {
  const text = String(dataUrl || "");
  const comma = text.indexOf(",");
  if (comma < 0) return null;
  const head = text.slice(0, comma);
  const mime = /data:([^;,]+)/.exec(head);
  const type = mime ? mime[1] : "image/jpeg";
  const binary = atob(text.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

const byId = (id) => (typeof document !== "undefined" ? document.getElementById(id) : null);

export class Camera {
  constructor(opts = {}) {
    this.el = opts.elements || {
      root: byId("camera"), video: byId("camera-video"), boxes: byId("camera-boxes"),
      caption: byId("camera-caption"), badge: byId("camera-badge"), power: byId("camera-power"),
      photo: byId("camera-photo"), vision: byId("camera-vision"), drag: byId("camera-drag"),
      swap: byId("camera-swap"), torch: byId("camera-torch"),
    };
    this.getSettings = opts.getSettings || (() => ({}));
    this.getDisplay = opts.getDisplay || (() => null);
    this.getHa = opts.getHa || (() => null);
    this.baseUrl = opts.baseUrl || (() => (typeof location !== "undefined" ? location.origin : ""));
    this.token = opts.token || (() => "");
    this.onFacing = opts.onFacing || (() => {});
    this.onPowerOff = opts.onPowerOff || null;
    this.getUserMedia = opts.getUserMedia || ((constraints) => {
      const md = typeof navigator !== "undefined" ? navigator.mediaDevices : null;
      return md && md.getUserMedia ? md.getUserMedia(constraints) : Promise.reject(new Error("no camera API"));
    });
    this.fetchImpl = opts.fetchImpl || ((...args) => fetch(...args));
    this.onLight = opts.onLight || (() => {});
    this.say = opts.say || (() => {});
    this.log = opts.log || (() => {});
    this.now = opts.now || (() => performance.now());
    this.profile = "tab";
    this.isWebView = typeof navigator !== "undefined" && /; wv\)/.test(navigator.userAgent);
    this.facing = opts.facing === "environment" ? "environment" : "user";
    this.track = null;
    this.torch = false;
    this.torchAvailable = false;
    this.beta = false;
    this.on = false;
    this.starting = false;
    this.resumeOnVisible = false;
    this.stream = null;
    this.detector = null;
    this.detectorState = "idle";
    this.detectorDelegate = "GPU";
    this.cpuTried = false;
    this.lastDetectError = "";
    this.persons = [];
    this.luma = null;
    this.dim = 0;
    this.visionText = "";
    this.visionUntil = 0;
    this.visionPending = false;
    this.visionBusy = false;
    this.autoBrightness = true;
    this.hasLightSensor = false;
    this.personBoxes = true;
    this.vision = true;
    this.visionAuto = false;
    this.visionEntity = "";
    this.detectTimer = null;
    this.lumaTimer = null;
    this.visionAutoTimer = null;
    this.visionClearTimer = null;
    this.lastDetect = 0;
    this.detectFails = 0;
    this.scratch = null;
    this.bind();
  }

  bind() {
    if (this.el.power) {
      this.el.power.addEventListener("click", () => {
        if (this.onPowerOff) this.onPowerOff();
        else this.toggle();
      });
    }
    if (this.el.photo) this.el.photo.addEventListener("click", () => this.takePhoto());
    if (this.el.vision) this.el.vision.addEventListener("click", () => this.describe());
    if (this.el.swap) this.el.swap.addEventListener("click", () => this.swap());
    if (this.el.torch) this.el.torch.addEventListener("click", () => this.toggleTorch());
    if (this.el.drag) this.bindDrag();
  }

  // ---------------------------------------------------------- public state --

  setProfile(profile) {
    this.profile = profile === "ipad" ? "ipad" : profile === "square" || profile === "box" ? profile : "tab";
  }

  setBeta(enabled) {
    this.beta = enabled === true;
    if (typeof document !== "undefined") document.documentElement.classList.toggle("camera-beta", this.beta);
    if (this.el.root) this.el.root.hidden = !this.beta;
    if (!this.beta) {
      this.resumeOnVisible = false;
      this.stop();
    }
    this.updateCaption();
  }

  setOptions(settings = {}) {
    const nextFacing = settings.cameraFacing === "environment" ? "environment" : "user";
    const facingChanged = nextFacing !== this.facing;
    this.facing = nextFacing;
    this.updateFacingUi();
    this.personBoxes = settings.personBoxes !== false;
    this.autoBrightness = settings.autoBrightness !== false;
    this.vision = settings.vision !== false;
    this.visionAuto = settings.visionAuto === true;
    this.visionEntity = String(settings.visionEntity || "").trim();
    if (this.el.vision) this.el.vision.disabled = !this.vision;
    if (!this.personBoxes) this.clearBoxes();
    else if (this.on && this.detectorState === "idle") this.startDetection();
    if (!this.autoBrightness) this.stopLuma();
    else if (this.on && !this.lumaTimer) this.startLuma();
    this.startVisionAuto();
    if (facingChanged && this.on) {
      this.stop();
      this.start({ quiet: true });
    }
  }

  get active() { return this.on; }

  // --------------------------------------------------------------- stream --

  async start({ quiet = false } = {}) {
    if (!this.beta || this.on || this.starting) return this.on;
    if (typeof isSecureContext !== "undefined" && !isSecureContext) {
      this.fail("Kamera braucht HTTPS", quiet);
      return false;
    }
    this.starting = true;
    this.resumeOnVisible = false;
    this.updateCaption("starting");
    try {
      const stream = await this.getUserMedia({
        video: { facingMode: { ideal: this.facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      this.stream = stream;
      this.track = stream.getVideoTracks ? (stream.getVideoTracks()[0] || null) : null;
      this.torch = false;
      this.updateCapabilities();
      this.updateFacingUi();
      const video = this.el.video;
      if (!video) throw new Error("no video element");
      video.srcObject = stream;
      video.onloadedmetadata = () => this.resizeBoxes();
      await video.play().catch(() => {});
      this.on = true;
      this.starting = false;
      if (this.el.power) this.el.power.setAttribute("aria-pressed", "true");
      this.updateCaption();
      if (this.personBoxes) this.startDetection();
      if (this.autoBrightness && !this.hasLightSensor) this.startLuma();
      this.startVisionAuto();
      this.log(`camera on (${this.profile})`);
      return true;
    } catch (err) {
      this.starting = false;
      this.on = false;
      this.fail(cameraErrorMessage(err), quiet);
      this.log("camera failed: " + (err && err.message ? err.message : err));
      return false;
    }
  }

  stop() {
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    if (this.el.video) this.el.video.srcObject = null;
    this.on = false;
    this.starting = false;
    this.clearTimers();
    this.clearBoxes();
    this.stopLuma();
    if (this.el.power) this.el.power.setAttribute("aria-pressed", "false");
    this.visionPending = false;
    this.visionText = "";
    if (this.el.badge) this.el.badge.hidden = true;
    this.updateCaption();
  }

  toggle() {
    return this.on ? (this.stop(), false) : this.start();
  }

  pause() {
    if (!this.on) return;
    this.resumeOnVisible = true;
    this.stop();
  }

  resume() {
    if (this.resumeOnVisible && this.beta) {
      this.resumeOnVisible = false;
      this.start({ quiet: true });
    }
  }

  fail(text, quiet = false) {
    this.updateCaption();
    if (!quiet) this.say(text);
    if (this.el.caption) this.el.caption.textContent = text;
  }

  clearTimers() {
    for (const key of ["detectTimer", "lumaTimer", "visionAutoTimer"]) {
      if (this[key]) clearInterval(this[key]);
      this[key] = null;
    }
  }

  // ----------------------------------------------------------- detection --

  async startDetection() {
    if (!this.personBoxes || this.detectorState === "loading" || this.detectorState === "ready") return;
    this.detectorState = "loading";
    this.detectorDelegate = "CPU";
    this.updateCaption();
    try {
      const vision = await import(VISION_JS_URL);
      const fileset = await vision.FilesetResolver.forVisionTasks(VISION_WASM_URL);
      this.detector = await vision.ObjectDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: PERSON_MODEL_URL, delegate: "CPU" },
        runningMode: "IMAGE",
        scoreThreshold: 0.35,
        maxResults: 5,
      });
      this.detectorState = "ready";
      this.detectFails = 0;
      if (this.detectTimer) clearInterval(this.detectTimer);
      this.detectTimer = setInterval(() => this.detect(), DETECT_MS);
      this.updateCaption();
      this.log("person detector ready");
    } catch (err) {
      this.detectorState = "failed";
      this.updateCaption();
      this.log("person detector failed: " + (err && err.message ? err.message : err));
    }
  }

  detect() {
    if (!this.on || !this.personBoxes || !this.detector || typeof document === "undefined" || document.hidden) return;
    const video = this.el.video;
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
    const at = this.now();
    if (at - this.lastDetect < DETECT_MS - 50) return;
    this.lastDetect = at;
    try {
      const result = this.detector.detect(video);
      this.persons = (result && result.detections ? result.detections : [])
        .filter((d) => d && d.categories && d.categories[0] && d.categories[0].categoryName === "person");
      this.detectFails = 0;
      this.drawBoxes();
      this.updateCaption();
    } catch (err) {
      this.detectFails++;
      this.lastDetectError = err && err.message ? err.message : String(err);
      this.log("detection failed: " + this.lastDetectError);
      if (this.detectFails >= 3) {
        if (this.detectTimer) clearInterval(this.detectTimer);
        this.detectTimer = null;
        try { this.detector?.close?.(); } catch { /* ignore */ }
        this.detector = null;
        this.persons = [];
        this.clearBoxes();
        this.detectorState = "failed";
        this.updateCaption();
      }
    }
  }

  resizeBoxes() {
    const canvas = this.el.boxes;
    const video = this.el.video;
    if (!canvas || !video) return;
    const dpr = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
    const w = Math.max(1, Math.round(video.clientWidth * dpr));
    const h = Math.max(1, Math.round(video.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    this.drawBoxes();
  }

  drawBoxes() {
    const canvas = this.el.boxes;
    const video = this.el.video;
    if (!canvas || !video) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
    const wantW = Math.max(1, Math.round(video.clientWidth * dpr));
    const wantH = Math.max(1, Math.round(video.clientHeight * dpr));
    if (canvas.width !== wantW || canvas.height !== wantH) {
      canvas.width = wantW;
      canvas.height = wantH;
    }
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!this.persons.length || !video.videoWidth) return;
    ctx.font = "600 11px Inter, system-ui, sans-serif";
    ctx.textBaseline = "top";
    ctx.textBaseline = "top";
    for (const d of this.persons) {
      const b = mapBox(d.boundingBox, video.videoWidth, video.videoHeight, w, h, this.facing === "user");
      if (!(b.w > 1) || !(b.h > 1)) continue;
      ctx.strokeStyle = "#ff9f0a";
      ctx.lineWidth = 2;
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      const label = `Person ${Math.round((d.categories[0].score || 0) * 100)} %`;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = "rgba(0,0,0,0.65)";
      ctx.fillRect(b.x, Math.max(0, b.y - 18), tw + 10, 18);
      ctx.fillStyle = "#fff";
      ctx.fillText(label, b.x + 5, Math.max(0, b.y - 16));
    }
  }

  clearBoxes() {
    const canvas = this.el.boxes;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    this.persons = [];
  }

  // --------------------------------------------------------------- luma --

  startLuma() {
    if (this.hasLightSensor || !this.autoBrightness || this.lumaTimer) return;
    this.lumaTimer = setInterval(() => this.sampleLuma(), LUMA_MS);
    this.sampleLuma();
  }

  stopLuma() {
    if (this.lumaTimer) clearInterval(this.lumaTimer);
    this.lumaTimer = null;
    this.luma = null;
    this.dim = 0;
    this.applyDim();
    this.onLight(null);
  }

  sampleLuma() {
    if (this.hasLightSensor || !this.on || !this.autoBrightness || typeof document === "undefined" || document.hidden) return;
    const video = this.el.video;
    if (!video || video.readyState < 2) return;
    try {
      if (!this.scratch) this.scratch = document.createElement("canvas");
      const s = this.scratch;
      s.width = 32;
      s.height = 18;
      const ctx = s.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, 32, 18);
      const data = ctx.getImageData(0, 0, 32, 18).data;
      const l = lumaFromRgba(data);
      this.luma = this.luma === null ? l : this.luma * 0.7 + l * 0.3;
      const next = dimFor(this.luma, this.dim);
      if (next !== this.dim) {
        this.dim = next;
        this.applyDim();
      }
      this.onLight(this.luma);
    } catch {
      // A tainted canvas only costs the dimming, never the camera.
    }
  }

  applyDim() {
    if (typeof document === "undefined") return;
    const el = document.getElementById("dim");
    if (el) el.style.opacity = String(this.dim);
  }

  // --------------------------------------------------------------- photo --

  snapshot() {
    const video = this.el.video;
    if (!this.on || !video || !video.videoWidth || typeof document === "undefined") return null;
    const width = Math.min(1280, video.videoWidth);
    const height = Math.round(width * video.videoHeight / video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", 0.85);
  }

  async takePhoto() {
    const display = this.getDisplay();
    if (!display) return;
    if (!this.on) {
      const started = await this.start();
      if (!started) return;
    }
    const url = this.snapshot();
    if (!url) {
      this.say("Das Foto hat nicht geklappt.");
      return;
    }
    display.showImageTimed("Kamera", "Gerade aufgenommen", url, 30);
    this.log("photo card");
  }

  // -------------------------------------------------------------- vision --

  updateCaption(state = "ready") {
    const caption = this.el.caption;
    if (!caption) return;
    const visible = this.visionText && Date.now() < this.visionUntil;
    if (this.el.badge) this.el.badge.hidden = !visible;
    if (this.visionPending) {
      caption.textContent = "Vision denkt …";
      return;
    }
    if (visible) {
      caption.textContent = this.visionText;
      return;
    }
    if (!this.on) {
      caption.textContent = this.starting ? "Kamera startet …" : "Kamera aus";
      return;
    }
    if (this.detectorState === "failed") {
      caption.textContent = "Erkennung nicht verfügbar";
      return;
    }
    if (this.detectorState === "loading" && !this.persons.length) {
      caption.textContent = captionFor(0, "loading");
      return;
    }
    caption.textContent = captionFor(this.persons.length, "ready");
  }

  startVisionAuto() {
    if (this.visionAutoTimer) clearInterval(this.visionAutoTimer);
    this.visionAutoTimer = null;
    if (!this.visionAuto || !this.beta) return;
    this.visionAutoTimer = setInterval(() => {
      if (this.on && typeof document !== "undefined" && !document.hidden) this.describe({ quiet: true });
    }, 60000);
  }

  async describe({ quiet = false } = {}) {
    if (!this.vision) {
      if (!quiet) this.say("Vision ist in den Einstellungen ausgeschaltet.");
      return "";
    }
    if (this.visionBusy) return "";
    if (!this.on) {
      const started = await this.start({ quiet });
      if (!started) return "";
    }
    const dataUrl = this.snapshot();
    if (!dataUrl) {
      if (!quiet) this.say("Die Kamera liefert gerade kein Bild.");
      return "";
    }
    const blob = dataUrlBlob(dataUrl);
    if (!blob) return "";
    this.visionBusy = true;
    this.visionPending = true;
    this.updateCaption();
    if (this.el.vision) this.el.vision.disabled = true;
    const base = String(this.baseUrl() || "").trim();
    const token = String(this.token() || "");
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    let mediaId = "";
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), 30000) : null;
    try {
      const form = new FormData();
      form.append("media_content_id", VISION_FOLDER);
      form.append("file", blob, visionFilename(this.profile));
      const upload = await this.fetchImpl(new URL("/api/media_source/local_source/upload", base), {
        method: "POST", headers, body: form, signal: controller ? controller.signal : undefined,
      });
      if (!upload.ok) throw Object.assign(new Error("upload"), { status: upload.status });
      const uploaded = await upload.json().catch(() => ({}));
      mediaId = mediaIdFromUpload(uploaded);
      if (!mediaId) throw Object.assign(new Error("no media id"), { status: 500 });
      const entity = String(this.getSettings().visionEntity || this.visionEntity || "").trim();
      const response = await this.fetchImpl(new URL("/api/services/ai_task/generate_data?return_response", base), {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(visionPayload(entity, mediaId)),
        signal: controller ? controller.signal : undefined,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw Object.assign(new Error(body || "ai task"), { status: response.status });
      }
      const json = await response.json().catch(() => ({}));
      const text = json && json.service_response && typeof json.service_response.data === "string"
        ? json.service_response.data.trim() : "";
      if (!text) throw Object.assign(new Error("empty answer"), { status: 502 });
      this.visionText = text;
      this.visionUntil = Date.now() + VISION_MS;
      if (this.visionClearTimer) clearTimeout(this.visionClearTimer);
      this.visionClearTimer = setTimeout(() => {
        this.visionText = "";
        this.updateCaption();
      }, VISION_MS);
      this.log("vision: " + text.slice(0, 120));
      return text;
    } catch (err) {
      const message = err && err.name === "AbortError"
        ? "Vision antwortet nicht"
        : visionErrorMessage(err && err.status, err && err.message);
      if (!quiet) this.say(message);
      this.log("vision failed: " + (err && err.message ? err.message : err));
      return "";
    } finally {
      if (timeout) clearTimeout(timeout);
      this.visionPending = false;
      this.visionBusy = false;
      if (this.el.vision) this.el.vision.disabled = !this.vision;
      this.updateCaption();
      if (mediaId) {
        const ha = this.getHa();
        if (ha && ha.command) {
          ha.command({ type: "media_source/local_source/remove", media_content_id: mediaId }).catch(() => {});
        }
      }
    }
  }

  // ---------------------------------------------------------- front / back --

  updateFacingUi() {
    if (this.el.root) this.el.root.dataset.facing = this.facing;
    if (this.el.swap) {
      this.el.swap.textContent = this.facing === "environment" ? "Front" : "Hinten";
      this.el.swap.title = this.facing === "environment" ? "Vorderkamera" : "Rückkamera";
    }
  }

  updateCapabilities() {
    const caps = this.track && this.track.getCapabilities ? this.track.getCapabilities() : null;
    this.torchAvailable = !!(caps && caps.torch === true);
    if (this.el.torch) {
      this.el.torch.hidden = !this.torchAvailable;
      this.el.torch.setAttribute("aria-pressed", this.torch ? "true" : "false");
      this.el.torch.textContent = this.torch ? "Licht aus" : "Licht";
    }
  }

  async swap() {
    if (!this.beta) return;
    this.facing = this.facing === "user" ? "environment" : "user";
    this.onFacing(this.facing);
    this.updateFacingUi();
    if (this.on || this.starting) {
      this.stop();
      await this.start({ quiet: true });
    }
  }

  async toggleTorch() {
    if (!this.track || !this.torchAvailable) return;
    this.torch = !this.torch;
    try {
      await this.track.applyConstraints({ advanced: [{ torch: this.torch }] });
    } catch {
      this.torch = false;
    }
    this.updateCapabilities();
  }

  // --------------------------------------------------------------- drag --

  bindDrag() {
    const drag = this.el.drag;
    const root = this.el.root;
    if (!drag || !root || typeof window === "undefined") return;
    let start = null;
    const onMove = (ev) => {
      if (!start) return;
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      const left = Math.max(4, Math.min(window.innerWidth - root.offsetWidth - 4, start.left + dx));
      const top = Math.max(4, Math.min(window.innerHeight - root.offsetHeight - 4, start.top + dy));
      root.style.left = `${left}px`;
      root.style.top = `${top}px`;
      root.style.right = "auto";
    };
    const onUp = () => {
      if (!start) return;
      start = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      try {
        localStorage.setItem("muse-camera-pos", JSON.stringify({ left: root.style.left, top: root.style.top }));
      } catch {
        // storage blocked: the position lasts for this visit only
      }
    };
    drag.addEventListener("pointerdown", (ev) => {
      const rect = root.getBoundingClientRect();
      start = { x: ev.clientX, y: ev.clientY, left: rect.left, top: rect.top };
      drag.setPointerCapture?.(ev.pointerId);
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      ev.preventDefault();
    });
    drag.addEventListener("dblclick", () => {
      root.style.left = "";
      root.style.top = "";
      root.style.right = "";
      try { localStorage.removeItem("muse-camera-pos"); } catch { /* ignore */ }
    });
    try {
      const saved = JSON.parse(localStorage.getItem("muse-camera-pos") || "null");
      const tablet = document.documentElement.classList.contains("tablet");
      if (saved && !tablet && typeof saved.left === "string" && typeof saved.top === "string") {
        root.style.left = saved.left;
        root.style.top = saved.top;
        root.style.right = "auto";
      }
    } catch {
      // no saved position
    }
  }
}
