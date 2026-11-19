// media.js: photos, GIFs and live views as an <img> laid over the canvas.
//
// The box decodes JPEG, PNG and GIF itself and copies the picture into its frame
// buffer. Here the browser does that: an <img> element in the overlay above the canvas,
// placed where the box places the picture (fitted into 300 x 168 below the top bar,
// corners rounded by 12 px). A GIF plays by itself; a live view reloads the picture
// once a second until its seconds are over.
//
// Pitfalls:
//  * The picture is a DOM element, not part of the canvas, so the video fallback of
//    Float (Safari, Firefox) does not carry it; the Document Picture-in-Picture window
//    (Chrome, Edge) does, because the whole stage moves there.
//  * An <img> never says why it failed (no status code), so the card only says that
//    the picture did not come.
//  * A picture that hangs says nothing at all: after 15 s the card treats it as failed,
//    and a failed picture reports through `onFailed` so display.js can turn the card
//    into an event card, as the box does.
export const PHOTO_W = 300;
export const PHOTO_H = 168;
export const PHOTO_TOP = 30;
export const IMAGE_TIMEOUT_MS = 15000;

// The URL to load for a picture. On HTTPS the page may not load an http:// picture from
// Home Assistant (mixed content); the local add-on serves /ha-local/ from /config/www,
// so a Home Assistant /local/ picture is rewritten to the page's own origin. The add-on's
// own /local/ (the figure frames) is a different path and stays untouched.
export function imageUrl(url, page = (typeof location !== "undefined" ? location : null)) {
  const raw = String(url || "");
  if (!page || page.protocol !== "https:") return raw;
  try {
    const u = new URL(raw, page.href);
    if (u.protocol === "http:" && u.pathname.startsWith("/local/")) {
      return page.origin + "/ha-local/" + u.pathname.slice("/local/".length) + u.search + u.hash;
    }
  } catch {
    // A relative or malformed URL stays as it is; the <img> reports the failure.
  }
  return raw;
}

// The size of a picture that fits into maxW x maxH with its aspect kept; a smaller
// picture stays as it is (the box's rule). Pure, so the tests can call it directly.
export function containSize(nw, nh, maxW, maxH) {
  const w = Number(nw), h = Number(nh);
  if (!(w > 0) || !(h > 0) || !(maxW > 0) || !(maxH > 0)) return { w: 0, h: 0 };
  const s = Math.min(1, maxW / w, maxH / h);
  return { w: Math.round(w * s), h: Math.round(h * s) };
}

export class MediaOverlay {
  constructor(container, opts = {}) {
    this.container = container;
    this.location = opts.location || (typeof location !== "undefined" ? location : null);
    this.img = null;
    this.state = "none"; // none, loading, ready, failed
    this.live = null; // {url, until, timer}
    this.box = null; // {x, y, w, h} in logical px of the picture on screen
    this.k = 1;
    this.serial = 0;
    this.timer = null; // the load timeout
    this.fail = null; // the fail closure of the picture on screen
    this.url = "";
    // A layout of its own (square.js) sets `frame` to {x, y, w, h, radius, fit}: the
    // picture then fills that box, with `fit: "cover"` (the default) or `fit: "contain"`
    // for a chart that must never be cropped; `caption` ({text, color}) shows as a strip
    // at its bottom. Unset, nothing changes.
    this.frame = null;
    this.caption = null;
    this.captionEl = null;
    this.onFailed = opts.onFailed || null; // (url) when the picture does not come
    this.loadMs = opts.loadMs || opts.timeoutMs || IMAGE_TIMEOUT_MS;
    this.setTimeout = opts.setTimeout || ((fn, ms) => setTimeout(fn, ms));
    this.clearTimeout = opts.clearTimeout || ((id) => clearTimeout(id));
  }

  // Shows the picture at `url`; `liveSeconds` > 0 reloads it once a second that long.
  // `onFailed(url)` is called once when the picture errors or does not arrive in time.
  show(url, liveSeconds = 0, now = Date.now(), onFailed = null) {
    this.hide();
    const serial = ++this.serial;
    const img = this.container.ownerDocument.createElement("img");
    img.className = "photo";
    img.alt = "";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    this.state = "loading";
    this.box = null;
    this.url = url;
    const fail = () => {
      if (serial !== this.serial || this.state === "failed") return;
      this.clearTimer();
      this.state = "failed";
      img.style.visibility = "hidden";
      const cb = onFailed || this.onFailed;
      if (cb) cb(url);
    };
    this.fail = fail;
    img.addEventListener("load", () => {
      if (serial !== this.serial) return;
      this.clearTimer();
      this.state = "ready";
      this.fit(img);
      img.style.visibility = "visible";
    });
    img.addEventListener("error", fail);
    img.style.visibility = "hidden";
    if (this.frame) {
      img.classList.add("framed");
      if (this.frame.fit === "contain") img.classList.add("contain");
    }
    this.container.appendChild(img);
    this.img = img;
    this.armTimer(fail);
    const src = imageUrl(url, this.location);
    img.src = liveSeconds > 0 ? bust(src, now) : src;
    if (liveSeconds > 0) {
      this.live = { url, until: now + liveSeconds * 1000 };
      this.live.timer = setInterval(() => this.reload(), 1000);
    }
  }

  // A picture that hangs fails after 15 s, like one that says so at once.
  armTimer(fail) {
    this.clearTimer();
    if (!fail) return;
    this.timer = this.setTimeout(() => {
      this.timer = null;
      fail();
    }, this.loadMs);
  }

  clearTimer() {
    if (this.timer === null) return;
    this.clearTimeout(this.timer);
    this.timer = null;
  }

  reload() {
    if (!this.live || !this.img) return;
    const now = Date.now();
    if (now > this.live.until) {
      clearInterval(this.live.timer);
      this.live = null;
      return;
    }
    this.armTimer(this.fail);
    this.img.src = bust(imageUrl(this.live.url, this.location), now);
  }

  // The box fits the picture into 300 x 168 and centres it there; a smaller one stays.
  // A framed picture fills its frame; a chart's frame lets CSS contain it whole.
  fit(img) {
    if (this.frame) {
      const f = this.frame;
      this.box = { x: f.x, y: f.y, w: f.w, h: f.h };
      this.place();
      this.showCaption();
      return;
    }
    const size = containSize(img.naturalWidth, img.naturalHeight, PHOTO_W, PHOTO_H);
    const w = size.w, h = size.h;
    this.box = { x: 160 - Math.floor(w / 2), y: PHOTO_TOP + Math.floor((PHOTO_H - h) / 2), w, h };
    this.place();
  }

  // Positions the picture for the current scale (k CSS px per logical px).
  place() {
    if (!this.img || !this.box) return;
    const b = this.box, k = this.k;
    Object.assign(this.img.style, {
      left: `${b.x * k}px`, top: `${b.y * k}px`, width: `${b.w * k}px`, height: `${b.h * k}px`,
      borderRadius: `${(this.frame ? this.frame.radius : 12) * k}px`,
    });
    if (this.captionEl && this.frame) {
      const f = this.frame, h = f.captionH || 44;
      Object.assign(this.captionEl.style, {
        left: `${f.x * k}px`, top: `${(f.y + f.h - h) * k}px`, width: `${f.w * k}px`, height: `${h * k}px`,
        lineHeight: `${h * k}px`, padding: `0 ${20 * k}px`, fontSize: `${(f.captionPx || 20) * k}px`,
        borderRadius: `0 0 ${f.radius * k}px ${f.radius * k}px`,
      });
    }
  }

  // The caption strip of a framed picture, once the picture is there.
  // A live view loads again every second; the one strip stays.
  showCaption() {
    if (!this.frame || !this.caption || !this.caption.text) return;
    let el = this.captionEl;
    if (!el) {
      el = this.container.ownerDocument.createElement("div");
      el.className = "caption";
      this.container.appendChild(el);
      this.captionEl = el;
    }
    el.textContent = this.caption.text;
    el.style.color = this.caption.color || "";
    this.place();
  }

  rescale(k) {
    this.k = k;
    this.place();
  }

  hide() {
    this.serial++;
    this.clearTimer();
    this.fail = null;
    this.url = "";
    if (this.live) {
      clearInterval(this.live.timer);
      this.live = null;
    }
    if (this.img) {
      this.img.remove();
      this.img = null;
    }
    if (this.captionEl) {
      this.captionEl.remove();
      this.captionEl = null;
    }
    this.state = "none";
    this.box = null;
  }
}

function bust(url, now) {
  return url + (url.includes("?") ? "&" : "?") + "t=" + now;
}
