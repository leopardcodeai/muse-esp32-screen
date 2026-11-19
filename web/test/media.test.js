// media.test.js: the picture overlay without a browser: the pure contain helper, the
// box's 300 x 168 fit, the square frame (cover for a photo, contain for a chart), and
// what a failed or hanging picture reports.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MediaOverlay, containSize, imageUrl, PHOTO_W, PHOTO_H, PHOTO_TOP, IMAGE_TIMEOUT_MS } from "../media.js";

function element(tag) {
  const el = {
    tagName: tag, style: {}, classes: new Set(), listeners: {}, removed: false,
    naturalWidth: 0, naturalHeight: 0,
    addEventListener(type, fn) {
      (el.listeners[type] ||= []).push(fn);
    },
    fire(type) {
      for (const fn of el.listeners[type] || []) fn();
    },
    remove() {
      el.removed = true;
    },
  };
  el.classList = {
    add: (c) => el.classes.add(c),
    contains: (c) => el.classes.has(c),
  };
  return el;
}

function container() {
  const children = [];
  const c = {
    children,
    ownerDocument: { createElement: (tag) => element(tag) },
    appendChild(el) {
      children.push(el);
      el.parent = c;
    },
  };
  return c;
}

function timers() {
  const pending = new Map();
  let next = 1;
  return {
    pending,
    setTimeout(fn, ms) {
      const id = next++;
      pending.set(id, { fn, ms });
      return id;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
    runAll() {
      const due = [...pending.values()];
      pending.clear();
      for (const t of due) t.fn();
    },
  };
}

const frame = (extra = {}) => ({ x: 24, y: 176, w: 432, h: 280, radius: 28, ...extra });

test("containSize fits a picture into the bounds, keeps its aspect and never enlarges it", () => {
  assert.deepEqual(containSize(600, 336, 300, 168), { w: 300, h: 168 });
  assert.deepEqual(containSize(600, 300, 300, 168), { w: 300, h: 150 });
  assert.deepEqual(containSize(300, 600, 300, 168), { w: 84, h: 168 });
  assert.deepEqual(containSize(120, 60, 300, 168), { w: 120, h: 60 }, "a smaller picture stays");
  assert.deepEqual(containSize(1000, 400, 300, 168), { w: 300, h: 120 });
  assert.deepEqual(containSize(0, 60, 300, 168), { w: 0, h: 0 });
  assert.deepEqual(containSize(60, 0, 300, 168), { w: 0, h: 0 });
  assert.deepEqual(containSize(60, 60, 0, 168), { w: 0, h: 0 });
});

test("the box fits the picture into 300 x 168 and centres it", () => {
  const dom = container();
  const media = new MediaOverlay(dom);
  media.show("http://x/wide.jpg");
  const img = media.img;
  img.naturalWidth = 600;
  img.naturalHeight = 300;
  img.fire("load");
  assert.equal(media.state, "ready");
  assert.equal(img.style.visibility, "visible");
  assert.deepEqual(media.box, {
    x: 160 - Math.floor(PHOTO_W / 2),
    y: PHOTO_TOP + Math.floor((PHOTO_H - 150) / 2),
    w: 300, h: 150,
  });
  assert.equal(img.style.width, `${300 * media.k}px`);
  assert.equal(img.classList.contains("framed"), false, "the box has no frame");

  media.show("http://x/small.jpg");
  const small = media.img;
  small.naturalWidth = 120;
  small.naturalHeight = 60;
  small.fire("load");
  assert.deepEqual(media.box, { x: 100, y: PHOTO_TOP + 54, w: 120, h: 60 }, "a smaller picture stays centred");
});

test("a square photo covers its frame; a chart frame contains it and leaves the caption out", () => {
  const dom = container();
  const media = new MediaOverlay(dom);

  media.frame = frame();
  media.caption = { text: "Ein Bild", color: "#000" };
  media.show("http://x/photo.jpg");
  const photo = media.img;
  photo.naturalWidth = 1200;
  photo.naturalHeight = 800;
  photo.fire("load");
  assert.deepEqual(media.box, { x: 24, y: 176, w: 432, h: 280 });
  assert.ok(photo.classes.has("framed"));
  assert.ok(!photo.classes.has("contain"), "a photo covers the panel");
  assert.ok(media.captionEl, "a photo card carries its message as a caption");
  assert.equal(media.captionEl.textContent, "Ein Bild");

  media.frame = frame({ fit: "contain" });
  media.caption = null;
  media.show("http://x/chart.png");
  const chart = media.img;
  chart.naturalWidth = 900;
  chart.naturalHeight = 300;
  chart.fire("load");
  assert.deepEqual(media.box, { x: 24, y: 176, w: 432, h: 280 }, "the chart gets the whole frame");
  assert.ok(chart.classes.has("framed"));
  assert.ok(chart.classes.has("contain"), "CSS contains the chart, never crops it");
  assert.equal(media.captionEl, null, "a chart has no caption");
});

test("an error hides the picture and reports it once through onFailed", () => {
  const dom = container();
  const failed = [];
  const media = new MediaOverlay(dom);
  media.show("http://x/missing.jpg", 0, Date.now(), (url) => failed.push(url));
  const img = media.img;
  img.fire("error");
  img.fire("error");
  assert.equal(media.state, "failed");
  assert.equal(img.style.visibility, "hidden");
  assert.deepEqual(failed, ["http://x/missing.jpg"]);
});

test("a picture that hangs fails after 15 s; hide clears the timeout and the late events", () => {
  const dom = container();
  const clock = timers();
  const failed = [];
  const media = new MediaOverlay(dom, { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  media.show("http://x/slow.jpg", 0, Date.now(), (url) => failed.push(url));
  assert.equal(media.state, "loading");
  assert.deepEqual([...clock.pending.values()].map((t) => t.ms), [IMAGE_TIMEOUT_MS]);
  clock.runAll();
  assert.equal(media.state, "failed");
  assert.deepEqual(failed, ["http://x/slow.jpg"]);

  // A hidden picture takes neither a late load nor a late error with it.
  media.show("http://x/later.jpg", 0, Date.now(), (url) => failed.push(url));
  const late = media.img;
  media.hide();
  assert.equal(media.state, "none");
  assert.equal(media.img, null);
  assert.equal(media.box, null);
  assert.ok(late.removed);
  assert.equal(clock.pending.size, 0);
  late.fire("load");
  late.fire("error");
  assert.equal(media.state, "none");
  assert.deepEqual(failed, ["http://x/slow.jpg"], "no second report after hide");
});

test("a picture replaced before it loads reports nothing", () => {
  const dom = container();
  const failed = [];
  const media = new MediaOverlay(dom);
  media.show("http://x/one.jpg", 0, Date.now(), (url) => failed.push(url));
  const first = media.img;
  media.show("http://x/two.jpg", 0, Date.now(), (url) => failed.push(url));
  first.fire("error");
  assert.deepEqual(failed, [], "the error of the replaced picture changes nothing");
  media.img.fire("error");
  assert.deepEqual(failed, ["http://x/two.jpg"]);
});


test("imageUrl sends local HA pictures through the HTTPS add-on", () => {
  const https = { protocol: "https:", href: "https://ha:8322/", origin: "https://ha:8322" };
  assert.equal(imageUrl("http://ha:8123/local/muse_images/c.png?v=1", https), "https://ha:8322/ha-local/muse_images/c.png?v=1");
  assert.equal(imageUrl("http://ha:8123/local/other.jpg", https), "https://ha:8322/ha-local/other.jpg");
  assert.equal(imageUrl("https://cdn.example/x.png", https), "https://cdn.example/x.png");
  const http = { protocol: "http:", href: "http://ha:8321/", origin: "http://ha:8321" };
  assert.equal(imageUrl("http://ha:8123/local/a.png", http), "http://ha:8123/local/a.png");
});
