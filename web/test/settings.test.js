// settings.test.js: the stored settings, the landing in demo mode, the frame rate of a
// visit, the mixed-content warning, and that the docs name the box as the code does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_DEVICE } from "../ha.js";
import {
  DEFAULTS, SETTINGS_KEY, loadSettings, saveSettings, hasStoredSettings, landingTarget, fpsFor, insecureFromHttps,
  layoutFor, layoutReload, LAYOUTS, TABLET_PROFILES, layoutChoice, parseLayoutChoice, tabletProfileFor,
  MIXED_CONTENT_NOTE, LOOKS, lookFor,
} from "../settings.js";

function memory(initial = {}) {
  const data = { ...initial };
  return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, data };
}

test("defaults: the box's device name, 60 frames a second, the project's figure", () => {
  assert.equal(DEFAULTS.device, DEFAULT_DEVICE);
  assert.equal(DEFAULTS.fps, 60);
  assert.equal(DEFAULTS.figureSource, "placeholder");
  assert.deepEqual(loadSettings(memory()), { ...DEFAULTS });
});

test("loadSettings(): stored values over the defaults, cleaned", () => {
  const s = loadSettings(memory({ [SETTINGS_KEY]: JSON.stringify({ url: "http://ha.local:8123", device: "", fps: 45, figureSource: "x" }) }));
  assert.equal(s.url, "http://ha.local:8123");
  assert.equal(s.device, DEFAULT_DEVICE, "an empty device name falls back");
  assert.equal(s.fps, 60, "an unknown rate falls back");
  assert.equal(s.figureSource, "placeholder");
  assert.equal(loadSettings(memory({ [SETTINGS_KEY]: "{broken" })).device, DEFAULT_DEVICE);
  const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.deepEqual(loadSettings(throwing), { ...DEFAULTS });
  assert.equal(hasStoredSettings(throwing), false);
  assert.equal(saveSettings(throwing, DEFAULTS), false);
  const m = memory();
  assert.equal(hasStoredSettings(m), false);
  assert.ok(saveSettings(m, { ...DEFAULTS, fps: 10 }));
  assert.equal(hasStoredSettings(m), true);
  assert.equal(loadSettings(m).fps, 10);
});

test("landingTarget(): a first visit without settings lands in demo mode, nothing else does", () => {
  assert.equal(landingTarget("https://muse.example/", false), "https://muse.example/index.html?demo=1");
  assert.equal(landingTarget("http://localhost:8321/web/", false), "http://localhost:8321/web/index.html?demo=1");
  assert.equal(landingTarget("https://muse.example/index.html?fps=10", false), "https://muse.example/index.html?fps=10&demo=1");
  assert.equal(landingTarget("https://muse.example/", true), null, "stored settings: stay");
  assert.equal(landingTarget("https://muse.example/?demo=1", false), null);
  assert.equal(landingTarget("https://muse.example/?demo=0", false), null, "Demo aus stays out of the demo");
});

test("fpsFor(): ?fps= in the URL wins for this visit, else the setting", () => {
  assert.equal(fpsFor("", { fps: 60 }), 60);
  assert.equal(fpsFor("?fps=10", { fps: 60 }), 10);
  assert.equal(fpsFor("?demo=1&fps=30", { fps: 60 }), 30);
  assert.equal(fpsFor("?fps=99", { fps: 30 }), 30, "an unknown rate keeps the setting");
});

test("insecureFromHttps(): http from an https page, except this machine", () => {
  assert.equal(insecureFromHttps("https:", "http://homeassistant.local:8123"), true);
  assert.equal(insecureFromHttps("https:", "http://192.168.0.10:8123"), true);
  assert.equal(insecureFromHttps("https:", " HTTP://ha.example.com "), true);
  assert.equal(insecureFromHttps("https:", "https://ha.example.ts.net"), false);
  assert.equal(insecureFromHttps("https:", "http://localhost:8123"), false);
  assert.equal(insecureFromHttps("https:", "http://127.0.0.1:8123"), false);
  assert.equal(insecureFromHttps("http:", "http://homeassistant.local:8123"), false);
  assert.equal(insecureFromHttps("https:", ""), false);
});

test("the warning is one German sentence without dashes", () => {
  assert.equal((MIXED_CONTENT_NOTE.match(/[.!?](\s|$)/g) || []).length, 1);
  assert.ok(!/[–—]| - |--/.test(MIXED_CONTENT_NOTE));
  assert.match(MIXED_CONTENT_NOTE, /HTTPS-Adresse/);
  assert.match(MIXED_CONTENT_NOTE, /http:\/\/localhost/);
});

test("README and the settings dialog name the box as DEFAULT_DEVICE does", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  for (const [name, text] of [["README.md", readme], ["index.html", html]]) {
    assert.ok(!/muse_box|muse-box\b|esp32boxs3|ESP32BoxS3/i.test(text), `${name} still names the old box`);
  }
  assert.ok(readme.includes(`esphome.${DEFAULT_DEVICE}_muse_show_text`), "README shows the action prefix");
  assert.ok(readme.includes(`\`${DEFAULT_DEVICE}\``), "README names the default device");
});

test("layoutReload(): a choice other than the layout on screen reloads without ?layout=", () => {
  // Review 24.10.2026: with ?layout=square and box saved, saving box kept the square page.
  const href = "https://muse.example/index.html?layout=square&demo=1";
  const active = layoutFor(new URL(href).search, { ...DEFAULTS, layout: "box" });
  assert.equal(active, "square");
  assert.equal(layoutReload(href, active, "box"), "https://muse.example/index.html?demo=1");
  assert.equal(layoutReload(href, active, "square"), null, "the layout on screen: no reload");
  assert.equal(layoutReload("https://muse.example/", "box", "box"), null);
  assert.equal(layoutReload("https://muse.example/", "box", "square"), "https://muse.example/");
});

test("tablet profiles: Tab and iPad are layouts, not device strings", () => {
  assert.deepEqual(LAYOUTS, ["box", "square", "tablet"]);
  assert.deepEqual(TABLET_PROFILES, ["tab", "ipad"]);
  assert.equal(layoutChoice("square", "tab"), "square");
  assert.equal(layoutChoice("tablet", "ipad"), "tablet-ipad");
  assert.equal(layoutChoice("tablet", "nope"), "tablet-tab");
  assert.deepEqual(parseLayoutChoice("tablet-tab"), { layout: "tablet", tabletProfile: "tab" });
  assert.deepEqual(parseLayoutChoice("tablet-ipad"), { layout: "tablet", tabletProfile: "ipad" });
  assert.deepEqual(parseLayoutChoice("tablet"), { layout: "tablet", tabletProfile: null });
  assert.deepEqual(parseLayoutChoice("box"), { layout: "box", tabletProfile: null });
  assert.equal(parseLayoutChoice("nonsense"), null);
});

test("layoutFor(): tablet and its shorthand reach the tablet layout", () => {
  assert.equal(layoutFor("?layout=tablet", { ...DEFAULTS, layout: "square" }), "tablet");
  assert.equal(layoutFor("?layout=tablet-tab", { ...DEFAULTS, layout: "square" }), "tablet");
  assert.equal(layoutFor("?layout=tablet-ipad", { ...DEFAULTS, layout: "square" }), "tablet");
  assert.equal(layoutFor("?layout=nope", { ...DEFAULTS, layout: "tablet" }), "tablet");
  assert.equal(layoutFor("", { ...DEFAULTS, layout: "tablet" }), "tablet");
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
  assert.equal(s.cameraFacing, "user");
  assert.equal(s.personBoxes, true);
  assert.equal(s.autoBrightness, true);
  assert.equal(s.vision, true);
  assert.equal(s.visionAuto, false);
  assert.equal(s.visionEntity, "ai_task.google_ai_task");
  const bad = loadSettings(memory({ [SETTINGS_KEY]: JSON.stringify({ tabletProfile: "x", visionEntity: 7, camera: "yes" }) }));
  assert.equal(bad.tabletProfile, "tab");
  assert.equal(bad.visionEntity, "ai_task.google_ai_task");
  assert.equal(bad.camera, false);
  assert.equal(bad.cameraFacing, "user");
  const stored = loadSettings(memory({ [SETTINGS_KEY]: JSON.stringify({ camera: true, vision: false, voice: false }) }));
  assert.equal(stored.camera, true);
  assert.equal(stored.vision, false);
  assert.equal(stored.voice, false);
});

test("updateWanted(): a different server version, only when idle", async () => {
  const { updateWanted } = await import("../settings.js");
  assert.equal(updateWanted("1.8.5", "1.8.6", true), true);
  assert.equal(updateWanted("1.8.5", "1.8.5", true), false);
  assert.equal(updateWanted("1.8.5", "1.8.6", false), false);
  assert.equal(updateWanted("1.8.5", "", true), false);
  assert.equal(updateWanted("1.8.5", undefined, true), false);
});

test("a status is never restored after a reload, content is", async () => {
  const { restorable } = await import("../settings.js");
  assert.equal(restorable("set_status_text"), false);
  assert.equal(restorable("set_status"), false);
  assert.equal(restorable("reload"), false);
  assert.equal(restorable("show_text"), true);
  assert.equal(restorable(""), false);
});

test("lookFor(): iOS by default on the tablet, classic on box and square", () => {
  assert.equal(DEFAULTS.look, "auto");
  assert.deepEqual(LOOKS, ["auto", "ios", "classic"]);
  assert.equal(lookFor("", DEFAULTS, "tablet"), "ios");
  assert.equal(lookFor("", DEFAULTS, "square"), "classic");
  assert.equal(lookFor("", DEFAULTS, "box"), "classic");
  assert.equal(lookFor("", { ...DEFAULTS, look: "ios" }, "square"), "ios", "the setting can choose iOS anywhere");
  assert.equal(lookFor("", { ...DEFAULTS, look: "classic" }, "tablet"), "classic", "and keep the classic tablet");
  assert.equal(lookFor("?look=classic", DEFAULTS, "tablet"), "classic", "?look= wins for one visit");
  assert.equal(lookFor("?look=IOS", { ...DEFAULTS, look: "classic" }, "box"), "ios");
  assert.equal(lookFor("?look=glass", DEFAULTS, "tablet"), "ios", "an unknown value counts as auto");
  assert.equal(lookFor("", {}, "tablet"), "ios");
});

test("loadSettings(): an unknown look falls back to auto, a known one is kept", () => {
  assert.equal(loadSettings(memory({ [SETTINGS_KEY]: JSON.stringify({ look: "glass" }) })).look, "auto");
  assert.equal(loadSettings(memory({ [SETTINGS_KEY]: JSON.stringify({ look: "classic" }) })).look, "classic");
});

test("the settings dialog offers every look as a Stil choice", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  for (const look of LOOKS) assert.match(html, new RegExp(`name="look" value="${look}"`));
});
