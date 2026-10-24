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
export const PHOTO_W = 300;
export const PHOTO_H = 168;
export const PHOTO_TOP = 30;

export class MediaOverlay {
  constructor(container) {
    this.container = container;
    this.img = null;
    this.state = "none"; // none, loading, ready, failed
    this.live = null; // {url, until, timer}
    this.box = null; // {x, y, w, h} in logical px of the picture on screen
    this.k = 1;
    this.serial = 0;
    // A layout of its own (square.js) sets `frame` to {x, y, w, h, radius}: the picture
    // then covers that box instead of being fitted into the box's 300 x 168, and
    // `caption` ({text, color}) shows as a strip at its bottom. Unset, nothing changes.
    this.frame = null;
    this.caption = null;
    this.captionEl = null;
  }

  // Shows the picture at `url`; `liveSeconds` > 0 reloads it once a second that long.
  show(url, liveSeconds = 0, now = Date.now()) {
    this.hide();
    const serial = ++this.serial;
    const img = this.container.ownerDocument.createElement("img");
    img.className = "photo";
    img.alt = "";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    this.state = "loading";
    this.box = null;
    img.addEventListener("load", () => {
      if (serial !== this.serial) return;
      this.state = "ready";
      this.fit(img);
      img.style.visibility = "visible";
    });
    img.addEventListener("error", () => {
      if (serial !== this.serial) return;
      this.state = "failed";
      img.style.visibility = "hidden";
    });
    img.style.visibility = "hidden";
    if (this.frame) img.classList.add("framed");
    img.src = liveSeconds > 0 ? bust(url, now) : url;
    this.container.appendChild(img);
    this.img = img;
    if (liveSeconds > 0) {
      this.live = { url, until: now + liveSeconds * 1000 };
      this.live.timer = setInterval(() => this.reload(), 1000);
    }
  }

  reload() {
    if (!this.live || !this.img) return;
    const now = Date.now();
    if (now > this.live.until) {
      clearInterval(this.live.timer);
      this.live = null;
      return;
    }
    this.img.src = bust(this.live.url, now);
  }

  // The box fits the picture into 300 x 168 and centres it there; a smaller one stays.
  fit(img) {
    if (this.frame) {
      const f = this.frame;
      this.box = { x: f.x, y: f.y, w: f.w, h: f.h };
      this.place();
      this.showCaption();
      return;
    }
    const s = Math.min(1, PHOTO_W / img.naturalWidth, PHOTO_H / img.naturalHeight);
    const w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
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
