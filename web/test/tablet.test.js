import { test } from "node:test";
import assert from "node:assert/strict";
import { railWidth, railSide, profileLabel, railDensity, tileParam, tileDetail, cameraModeHint, railDate, TabletRail } from "../tablet.js";
import { WAVE_BARS } from "../composer.js";

test("railWidth(): the leftover width makes the page square", () => {
  assert.equal(railWidth(960, 600), 360);
  assert.equal(railWidth(1180, 820), 360);
  assert.equal(railWidth(1024, 768), 256);
  assert.equal(railWidth(700, 900), 0, "portrait uses the bottom bar");
  assert.equal(railWidth(2000, 500), 520, "capped");
  assert.equal(railWidth(900, 900), 0, "a square window uses the bottom bar");
});

test("railSide() and profileLabel()", () => {
  assert.equal(railSide(960, 600), "right");
  assert.equal(railSide(700, 900), "bottom");
  assert.equal(railSide(900, 900), "bottom");
  assert.equal(profileLabel("tab"), "Tab");
  assert.equal(profileLabel("ipad"), "iPad");
  assert.equal(profileLabel("x"), "Tab");
});

test("railDensity(): compact below 330 px, regular otherwise and in portrait", () => {
  assert.equal(railDensity(railWidth(1024, 768)), "compact", "an iPad's 256 px rail");
  assert.equal(railDensity(railWidth(1214, 800)), "regular", "Muse OS on the Galaxy Tab: 414 px");
  assert.equal(railDensity(329), "compact");
  assert.equal(railDensity(330), "regular");
  assert.equal(railDensity(0), "regular", "the bottom rail of portrait has the width");
});

test("tileParam() and tileDetail(): the URL hook and the shell's event detail", () => {
  assert.equal(tileParam("?tile=1"), true);
  assert.equal(tileParam("?demo=1&tile=true"), true);
  assert.equal(tileParam("?tile=0"), false);
  assert.equal(tileParam("?tile=yes"), null);
  assert.equal(tileParam(""), null);
  assert.equal(tileParam(undefined), null);
  for (const on of [true, 1, "1", "true"]) assert.equal(tileDetail(on), true, String(on));
  for (const off of [false, 0, null, undefined, "", "false", {}, "0"]) assert.equal(tileDetail(off), false, String(off));
});

test("cameraModeHint(): one line per mode; a compact rail names the mode", () => {
  assert.equal(cameraModeHint("off"), "Kamera aus");
  assert.equal(cameraModeHint("off", "compact"), "Kamera aus");
  assert.equal(cameraModeHint("mimic"), "Muse macht deine Bewegungen nach");
  assert.equal(cameraModeHint("mimic", "compact"), "Nachmachen: Muse macht deine Bewegungen nach");
  assert.ok(cameraModeHint("custom").startsWith("Eigene Auswahl"));
  assert.equal(cameraModeHint("nonsense"), cameraModeHint("custom"));
  for (const m of ["follow", "mimic", "detect", "all"]) {
    assert.ok(cameraModeHint(m).length <= 40, `${m} fits one line of the rail`);
    assert.ok(!/[–—]/.test(cameraModeHint(m, "compact")), `${m}: no dash`);
  }
});

test("railDate(): long for the regular rail, short for the compact one", () => {
  const day = new Date(2026, 10, 19, 19, 15);
  assert.equal(railDate(day), "Donnerstag, 19. November");
  assert.ok(railDate(day, "compact").length < 16, railDate(day, "compact"));
  assert.match(railDate(day, "compact"), /19/);
});

// A document with just what TabletRail touches.
function fakeDocument(ids) {
  const make = (id) => ({
    id, dataset: {}, style: {}, hidden: false, textContent: "", title: "", disabled: false, children: [], firstChild: null,
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    appendChild(el) { this.children.push(el); this.firstChild = this.children[0]; return el; },
  });
  const els = Object.fromEntries(ids.map((id) => [id, make(id)]));
  return { els, getElementById: (id) => els[id] || null, createElement: () => make("") };
}

test("TabletRail: clock, connection, composer state, wave, history and mode hint", () => {
  const doc = fakeDocument(["rail", "rail-time", "rail-date", "rail-dot", "rail-status-text", "rail-timer", "rail-voice-box",
    "rail-mic", "rail-mic-label", "rail-wave", "rail-text-send", "rail-history", "rail-history-q", "rail-history-a",
    "rail-mode-hint", "rail-light", "rail-fullscreen"]);
  const rail = new TabletRail({ document: doc }).mount();
  const e = doc.els;
  assert.equal(e["rail-wave"].children.length, WAVE_BARS, "mount() makes the wave's bars");
  rail.setDensity("compact");
  assert.equal(e.rail.dataset.density, "compact");
  rail.update({ clock: new Date(2026, 10, 19, 9, 5), connection: "on", cameraMode: "follow", timer: { name: "Tee", left: 272 } });
  assert.equal(e["rail-time"].textContent, "09:05");
  assert.match(e["rail-date"].textContent, /19/);
  assert.equal(e["rail-status-text"].textContent, "verbunden");
  assert.equal(e["rail-dot"].dataset.connection, "on");
  assert.equal(e["rail-timer"].hidden, false);
  assert.match(e["rail-timer"].textContent, /^Tee · /);
  assert.equal(e["rail-mode-hint"].textContent, "Folgen: Muse bewegt sich mit dir");
  assert.equal(e["rail-light"].hidden, true, "no light reading, no line");
  assert.equal(e["rail-fullscreen"].attrs["aria-pressed"], "false");

  rail.setVoice("listening", "", "Ich höre … Loslassen sendet");
  assert.equal(e["rail-voice-box"].dataset.state, "listening");
  assert.equal(e["rail-mic"].dataset.state, "listening");
  assert.equal(e["rail-mic-label"].textContent, "Ich höre … Loslassen sendet");
  rail.setLevel(0.8, 300);
  assert.ok(e["rail-wave"].children.every((bar) => /^scaleY\([01]\.\d{3}\)$/.test(bar.style.transform)), "every bar has a height");
  rail.setVoice("thinking");
  assert.equal(e["rail-mic-label"].textContent, "Muse denkt …");
  assert.ok(e["rail-wave"].children.every((bar) => bar.style.transform === ""), "leaving listening hands the bars back to CSS");
  rail.setVoice("error", "Mikrofon nicht erlaubt");
  assert.equal(e["rail-mic-label"].textContent, "Mikrofon nicht erlaubt");
  rail.setVoice("nonsense");
  assert.equal(e.rail.dataset.voice, "idle");

  rail.setSendEnabled(true);
  assert.equal(e["rail-text-send"].disabled, false);
  rail.setSendEnabled(false);
  assert.equal(e["rail-text-send"].disabled, true);

  rail.setHistory({ visible: true, question: "Wie spät?", answer: "12 Uhr", tone: "answer" });
  assert.equal(e["rail-history"].hidden, false);
  assert.equal(e["rail-history"].dataset.tone, "answer");
  assert.equal(e["rail-history-q"].textContent, "Wie spät?");
  assert.equal(e["rail-history-a"].textContent, "12 Uhr");
  rail.setHistory({ visible: false });
  assert.equal(e["rail-history"].hidden, true);
});

test("TabletRail: a page without the rail or without the new parts never throws", () => {
  const none = new TabletRail({ document: fakeDocument([]) }).mount();
  none.update({ connection: "on" });
  none.setVoice("listening");
  none.setLevel(0.5);
  none.setHistory({ visible: true, question: "q", answer: "a" });
  none.setCameraMode("all");
  none.setSendEnabled(true);
  none.setDensity("compact");
  assert.equal(none.root, null);
  const bare = new TabletRail({ document: fakeDocument(["rail"]) }).mount();
  bare.update({ connection: "demo", cameraMode: "mimic", voice: "speaking" });
  bare.setLevel(0.5);
  bare.setSendEnabled(true);
  bare.setHistory(null);
  assert.equal(bare.root.dataset.voice, "speaking");
  assert.equal(bare.root.dataset.connection, "demo");
});
