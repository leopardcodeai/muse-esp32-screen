// sensors.js: the native sensor bridge of the wall-display app, and the web fallback.
//
// The Android app adds a `museSensors` JavaScript interface (Sensors.java). It exposes
// the tablet's own light sensor, accelerometer, gyroscope, magnetometer, rotation
// vector, pressure, temperature, humidity, battery, pick-up gesture and significant
// motion. The page calls `read()` once and then receives `update(json)` pushes four
// times a second.
//
// The light sensor is the real ambient sensor the browser cannot give us; it replaces
// the camera-based brightness estimate. A sharp drop to darkness is treated as a hand
// near the screen (the Tab has no standard proximity sensor) and wakes the native
// screensaver. Everything degrades to the camera estimate when the bridge is missing.
//
// No DOM at module load, so the Node tests can import the pure lux curve.

export const HAND_LUX = 5;
export const HAND_PREVIOUS_LUX = 40;

// The black overlay for a real lux value. Dark room: 45 %; a lit room: 0; in between
// a gentle curve. The old camera estimate remains for browsers without the bridge.
export function luxDim(lux) {
  const l = Number(lux);
  if (!Number.isFinite(l) || l <= 0) return 0.45;
  return Math.max(0, Math.min(0.45, 0.45 * (1 - Math.min(1, l / 120))));
}

export function isHandNear(previous, current) {
  return Number(previous) > HAND_PREVIOUS_LUX && Number(current) <= HAND_LUX;
}

export class Sensors {
  constructor(opts = {}) {
    this.onUpdate = opts.onUpdate || (() => {});
    this.onWake = opts.onWake || (() => {});
    this.log = opts.log || (() => {});
    this.bridge = opts.bridge || (typeof window !== "undefined" ? window.museSensors : null) || null;
    this.values = {};
    this.light = null;
    this.hasLight = false;
    this.handUntil = 0;
    this.motionUntil = 0;
    this.lastPickup = 0;
    this.lastMotion = 0;
    this.dim = 0;
  }

  start() {
    if (!this.bridge) return false;
    try {
      this.bridge.update = (json) => {
        try { this.apply(JSON.parse(json)); } catch (e) { this.log("sensor bridge: bad JSON"); }
      };
      this.apply(this.bridge.read());
      return true;
    } catch (e) {
      this.log("sensor bridge unavailable: " + (e && e.message ? e.message : e));
      return false;
    }
  }

  apply(data) {
    if (!data || typeof data !== "object") return;
    const previous = this.light;
    this.values = data;
    if (typeof data.light === "number") {
      this.hasLight = true;
      this.light = data.light;
      this.dim = luxDim(data.light);
      this.applyDim(this.dim);
      if (isHandNear(previous, data.light)) {
        this.handUntil = Date.now() + 5000;
        this.wake();
      }
    }
    if (data.pickup && data.pickup !== this.lastPickup) {
      this.lastPickup = data.pickup;
      this.motionUntil = Date.now() + 5000;
      this.wake();
    }
    if (data.motion && data.motion !== this.lastMotion) {
      this.lastMotion = data.motion;
      this.motionUntil = Date.now() + 5000;
      this.wake();
    }
    this.onUpdate(this);
  }

  wake() {
    try { this.bridge?.wake?.(); } catch { /* the native side is optional */ }
    this.onWake(this);
  }

  applyDim(value) {
    if (typeof document === "undefined") return;
    const el = document.getElementById("dim");
    if (el) el.style.opacity = String(Math.max(0, Math.min(0.55, value)));
  }

  get battery() {
    const b = this.values && this.values.battery;
    if (!b || typeof b.level !== "number") return null;
    return { level: b.level, charging: b.charging === true };
  }

  lightText() {
    if (!this.hasLight || this.light === null) return "";
    const now = Date.now();
    if (now < this.handUntil) return `Hand nah · ${Math.round(this.light)} lx`;
    if (now < this.motionUntil) return `Bewegung · ${Math.round(this.light)} lx`;
    return `Licht ${Math.round(this.light)} lx`;
  }

  // For the info card / debugging.
  summary() {
    return {
      light: this.light,
      lux: this.values.light,
      proximity: this.values.proximity,
      orientation: this.values.orientation,
      battery: this.battery,
      hasLight: this.hasLight,
    };
  }
}
