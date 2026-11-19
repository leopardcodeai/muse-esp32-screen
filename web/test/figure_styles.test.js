// figure_styles.test.js: the figure styles ("Figur-Stil"): the manifest beside the
// frames, the built-in Muse, the choice of the settings and of the figure_style action,
// and the loading order: Muse at once without the manifest, another style after it, the
// folder for away when home gives nothing, and an empty place (never a stand-in) when
// the set fails.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BUILTIN_STYLES, DEFAULT_STYLE, cleanStyleId, cleanStylePath, parseManifest, mergeStyles, pickStyle,
  parseStyleChoice, styleBase, manifestUrl, loadStyles, figurePlan, loadChosenFigure,
} from "../figure_styles.js";
import { FigureSource, FIGURE_NAMES } from "../figure_frames.js";
import { DEFAULTS, loadSettings, SETTINGS_KEY, restorable } from "../settings.js";

const MANIFEST = JSON.stringify({
  styles: [
    { id: "muse", name: "Muse klassisch", path: "elsewhere" },
    { id: "winter", name: "Muse Winter", path: "winter" },
    { id: "pixel", name: "Pixel" },
    { id: "../etc", name: "bad id" },
    { id: "evil", path: "../../secret" },
    { id: "far", path: "https://example.com/x" },
    { id: "winter", name: "duplicate" },
    "nonsense",
  ],
});

test("ids and paths are cleaned hard", () => {
  assert.equal(cleanStyleId(" Muse "), "muse");
  assert.equal(cleanStyleId("winter-2026_b"), "winter-2026_b");
  assert.equal(cleanStyleId("../x"), "");
  assert.equal(cleanStyleId(""), "");
  assert.equal(cleanStylePath("./winter/"), "winter");
  assert.equal(cleanStylePath("sets/winter"), "sets/winter");
  assert.equal(cleanStylePath(""), "");
  assert.equal(cleanStylePath("../up"), null);
  assert.equal(cleanStylePath("a/../b"), null);
  assert.equal(cleanStylePath("https://example.com"), null);
  assert.equal(cleanStylePath("x?y=1"), null);
});

test("parseManifest(): valid entries only; Muse stays at the folder itself", () => {
  const styles = parseManifest(MANIFEST);
  assert.deepEqual(styles, [
    { id: "muse", name: "Muse klassisch", path: "" },
    { id: "winter", name: "Muse Winter", path: "winter" },
    { id: "pixel", name: "Pixel", path: "pixel" },
  ]);
  assert.deepEqual(parseManifest("not json"), []);
  assert.deepEqual(parseManifest({}), []);
  assert.deepEqual(parseManifest([{ id: "solo" }]), [{ id: "solo", name: "solo", path: "solo" }], "a bare array works too");
});

test("mergeStyles(): Muse first (renamed if the manifest says so), the others in the manifest's order", () => {
  assert.deepEqual(mergeStyles([]), [{ id: "muse", name: "Muse", path: "" }]);
  const merged = mergeStyles(parseManifest(MANIFEST));
  assert.deepEqual(merged.map((s) => [s.id, s.name, s.path]), [
    ["muse", "Muse klassisch", ""], ["winter", "Muse Winter", "winter"], ["pixel", "Pixel", "pixel"],
  ]);
  assert.equal(BUILTIN_STYLES[0].id, DEFAULT_STYLE);
});

test("pickStyle() and styleBase(): a known style, else Muse", () => {
  const styles = mergeStyles(parseManifest(MANIFEST));
  assert.deepEqual(pickStyle(styles, "winter"), { style: styles[1], known: true });
  assert.deepEqual(pickStyle(styles, "summer"), { style: styles[0], known: false });
  assert.deepEqual(pickStyle(styles, ""), { style: styles[0], known: true });
  assert.equal(styleBase("./local/", styles[0]), "./local");
  assert.equal(styleBase("./local", styles[1]), "./local/winter");
  assert.equal(styleBase("https://ha:8322/local", styles[2]), "https://ha:8322/local/pixel");
  assert.equal(manifestUrl("./local/"), "./local/figures.json");
});

test("parseStyleChoice(): by id or by name, the placeholder words, unknown values", () => {
  const styles = mergeStyles(parseManifest(MANIFEST));
  assert.deepEqual(parseStyleChoice("muse", styles), { id: "muse" });
  assert.deepEqual(parseStyleChoice("Muse Winter", styles), { id: "winter" });
  assert.deepEqual(parseStyleChoice("PIXEL", styles), { id: "pixel" });
  assert.deepEqual(parseStyleChoice("Platzhalter", styles), { placeholder: true });
  assert.deepEqual(parseStyleChoice("placeholder", styles), { placeholder: true });
  assert.deepEqual(parseStyleChoice("summer", styles), { id: "summer", unlisted: true });
  assert.deepEqual(parseStyleChoice("../x", styles), { unknown: "../x" });
  assert.deepEqual(parseStyleChoice("", styles), { unknown: "" });
});

test("loadStyles(): the folder's figures.json, the built-in list on any failure", async () => {
  const asked = [];
  const ok = await loadStyles("./local", async (url) => { asked.push(url); return { ok: true, text: async () => MANIFEST }; });
  assert.deepEqual(asked, ["./local/figures.json"]);
  assert.deepEqual(ok.map((s) => s.id), ["muse", "winter", "pixel"]);
  assert.deepEqual((await loadStyles("./local", async () => ({ ok: false, status: 404 }))).map((s) => s.id), ["muse"]);
  assert.deepEqual((await loadStyles("./local", async () => { throw new Error("offline"); })).map((s) => s.id), ["muse"]);
  assert.deepEqual((await loadStyles("", async () => { throw new Error("never asked"); })).map((s) => s.id), ["muse"]);
});

test("figurePlan(): a folder means the chosen style; no folder or ?figure=placeholder the placeholder", () => {
  const owner = { figureSource: "url", figureUrl: " ./local ", figureUrlAway: "https://100.64.0.10:8322/local", figureStyle: "Winter" };
  assert.deepEqual(figurePlan(owner, ""), { placeholder: false, folder: "./local", away: "https://100.64.0.10:8322/local", style: "winter" });
  assert.deepEqual(figurePlan({ ...owner, figureStyle: "" }, "").style, "muse");
  assert.deepEqual(figurePlan(owner, "?figure=placeholder"), { placeholder: true });
  assert.deepEqual(figurePlan({ ...owner, figureSource: "placeholder" }, ""), { placeholder: true });
  assert.deepEqual(figurePlan({ ...owner, figureUrl: "" }, ""), { placeholder: true });
  assert.deepEqual(figurePlan(DEFAULTS, ""), { placeholder: true }, "the public page: the placeholder");
});

// A FigureSource whose fetch answers from a table: url -> true (a picture) or false (404).
function sourceWith(files, asked = []) {
  return new FigureSource({
    fetchImpl: async (url) => {
      asked.push(url);
      if (url.endsWith("figures.json")) {
        return files[url] ? { ok: true, text: async () => files[url] } : { ok: false, status: 404 };
      }
      return files[url] ? { ok: true, arrayBuffer: async () => new TextEncoder().encode(url).buffer } : { ok: false, status: 404 };
    },
    decode: async (bytes) => [new TextDecoder().decode(bytes)],
  });
}
const setAt = (base) => Object.fromEntries(FIGURE_NAMES.map((n) => [`${base}/muse_${n}.png`, true]));

test("loading order: Muse starts at once, without waiting for the manifest", async () => {
  const asked = [];
  const src = sourceWith(setAt("./local"), asked);
  const pending = loadChosenFigure(src, { placeholder: false, folder: "./local", away: "", style: "muse" },
    { fetchImpl: src.fetchImpl });
  assert.equal(src.mode, "frames", "chosen synchronously, so the first frame never shows anything else");
  assert.deepEqual(asked, ["./local/muse_idle.png", "./local/muse_avatar.png"], "idle is the very first request");
  const r = await pending;
  assert.deepEqual(asked.slice().sort(), FIGURE_NAMES.map((n) => `./local/muse_${n}.png`).sort(), "then the other four");
  assert.equal(r.loaded, 6);
  assert.equal(r.style.id, "muse");
  assert.ok(!asked.some((u) => u.endsWith("figures.json")), "no manifest for the built-in style");
});

test("loading order: another style reads figures.json first, then its own folder", async () => {
  const asked = [];
  const files = { "./local/figures.json": MANIFEST, ...setAt("./local/winter") };
  const src = sourceWith(files, asked);
  const lines = [];
  const r = await loadChosenFigure(src, { placeholder: false, folder: "./local", away: "", style: "winter" },
    { fetchImpl: src.fetchImpl, log: (l) => lines.push(l) });
  assert.equal(asked[0], "./local/figures.json");
  assert.equal(asked[1], "./local/winter/muse_idle.png");
  assert.deepEqual(asked.slice(1).sort(), FIGURE_NAMES.map((n) => `./local/winter/muse_${n}.png`).sort());
  assert.deepEqual([r.loaded, r.style.name, r.folder], [6, "Muse Winter", "./local"]);
  assert.equal(src.describe(), "Muse Winter, 6 von 6 Bildern");
  assert.ok(lines.some((l) => l.includes("Muse Winter from ./local/winter: 6 of 6")));
});

test("a style the manifest does not name shows Muse, with a log line", async () => {
  const lines = [];
  const src = sourceWith({ "./local/figures.json": MANIFEST, ...setAt("./local") });
  const r = await loadChosenFigure(src, { placeholder: false, folder: "./local", away: "", style: "summer" },
    { fetchImpl: src.fetchImpl, log: (l) => lines.push(l) });
  assert.deepEqual([r.loaded, r.style.id], [6, "muse"]);
  assert.ok(lines.some((l) => l.includes("'summer' is not in ./local/figures.json")));
});

test("home gives nothing: the folder for away; both give nothing: an empty place, never a stand-in", async () => {
  const away = "https://100.64.0.10:8322/local";
  const lines = [];
  const src = sourceWith(setAt(away));
  const r = await loadChosenFigure(src, { placeholder: false, folder: "./local", away, style: "muse" },
    { fetchImpl: src.fetchImpl, log: (l) => lines.push(l) });
  assert.deepEqual([r.loaded, r.folder], [6, away]);
  assert.ok(lines.some((l) => l.includes("did not answer; trying")));

  const calls = [];
  const empty = sourceWith({});
  empty.placeholder = { smooth: false, draw: (...a) => calls.push(a[1]) };
  const lines2 = [];
  const r2 = await loadChosenFigure(empty, { placeholder: false, folder: "./local", away, style: "muse" },
    { fetchImpl: empty.fetchImpl, log: (l) => lines2.push(l) });
  assert.equal(r2.loaded, 0);
  assert.equal(empty.failedAll, true);
  empty.draw({ ctx: {} }, "idle", 0, 0, 0);
  assert.deepEqual(calls, [], "the placeholder is not drawn on an owner screen");
  assert.ok(lines2.some((l) => l.includes("the figure's place stays empty")));
});

test("a later choice wins over one still waiting for its manifest", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const src = new FigureSource({
    fetchImpl: async (url) => {
      if (url.endsWith("figures.json")) {
        await gate;
        return { ok: true, text: async () => MANIFEST };
      }
      return { ok: true, arrayBuffer: async () => new TextEncoder().encode(url).buffer };
    },
    decode: async (bytes) => [new TextDecoder().decode(bytes)],
  });
  const slow = loadChosenFigure(src, { placeholder: false, folder: "./local", away: "", style: "winter" }, { fetchImpl: src.fetchImpl });
  const fast = loadChosenFigure(src, { placeholder: false, folder: "./local", away: "", style: "muse" }, { fetchImpl: src.fetchImpl });
  await fast;
  release();
  assert.equal((await slow).stale, true);
  assert.equal(src.url, "./local", "Muse stays");
});

test("the placeholder plan: the neutral figure, and nothing fetched", async () => {
  const asked = [];
  const src = sourceWith({}, asked);
  const r = await loadChosenFigure(src, { placeholder: true }, { fetchImpl: src.fetchImpl });
  assert.equal(r.placeholder, true);
  assert.equal(src.mode, "placeholder");
  assert.deepEqual(asked, []);
});

test("settings: figureStyle defaults to Muse and is cleaned; figure_style is never replayed", () => {
  const memory = (obj) => ({ getItem: (k) => (k === SETTINGS_KEY ? JSON.stringify(obj) : null), setItem() {} });
  assert.equal(DEFAULTS.figureStyle, "muse");
  assert.equal(loadSettings(memory({ figureStyle: "Winter" })).figureStyle, "winter");
  assert.equal(loadSettings(memory({ figureStyle: "../x" })).figureStyle, "muse");
  assert.equal(loadSettings(memory({ figureUrl: " ./local " })).figureUrl, "./local");
  assert.equal(restorable("figure_style"), false);
});

test("the docs name the figure_style action and the manifest", () => {
  const actions = readFileSync(new URL("../../docs/ACTIONS.md", import.meta.url), "utf8");
  assert.ok(actions.includes("action: figure_style"));
  assert.ok(actions.includes("figures.json"));
});
