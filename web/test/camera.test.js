import { test } from "node:test";
import assert from "node:assert/strict";
import {
  captionFor, mapBox, lumaFromRgba, dimFor, visionFilename, visionPayload, mediaIdFromUpload,
  cameraErrorMessage, visionErrorMessage, dataUrlBlob,
} from "../camera.js";

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
  assert.deepEqual(mapBox(null, 1000, 500, 500, 250, true), { x: 0, y: 0, w: 0, h: 0 });
});

test("lumaFromRgba(): Rec. 709 mean", () => {
  assert.equal(Math.round(lumaFromRgba(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255])) * 100), 50);
  assert.equal(lumaFromRgba(new Uint8ClampedArray([0, 0, 0, 255])), 0);
  assert.equal(Math.round(lumaFromRgba(new Uint8ClampedArray([255, 255, 255, 255])) * 100), 100);
  assert.equal(lumaFromRgba(null), 0);
});

test("dimFor(): bright is 0, dark is capped, small changes are ignored", () => {
  assert.equal(dimFor(1, 0), 0);
  assert.equal(dimFor(0, 0), 0.55);
  assert.equal(dimFor(0.05, 0.5), 0.5, "a small move keeps the last value");
  assert.ok(dimFor(0, 0.5) > 0.5);
  assert.ok(dimFor(0.05, 0) > 0.4);
});

test("visionFilename(): fixed per profile", () => {
  assert.equal(visionFilename("tab"), "muse-tab-camera.jpg");
  assert.equal(visionFilename("ipad"), "muse-ipad-camera.jpg");
  assert.equal(visionFilename("square"), "muse-square-camera.jpg");
  assert.equal(visionFilename("box"), "muse-box-camera.jpg");
  assert.equal(visionFilename("x"), "muse-tab-camera.jpg");
});

test("visionPayload(): entity optional, media attachment exact", () => {
  const p = visionPayload("ai_task.google_ai_task", "media-source://media_source/local/muse-camera/muse-tab-camera.jpg");
  assert.equal(p.entity_id, "ai_task.google_ai_task");
  assert.equal(p.task_name, "Muse Kamera");
  assert.deepEqual(p.attachments, [{
    media_content_id: "media-source://media_source/local/muse-camera/muse-tab-camera.jpg",
    media_content_type: "image/jpeg",
  }]);
  assert.equal("entity_id" in visionPayload("", "m"), false);
});

test("upload and error helpers", () => {
  assert.equal(mediaIdFromUpload({ media_content_id: "media-source://x/y.jpg" }), "media-source://x/y.jpg");
  assert.equal(mediaIdFromUpload({}), "");
  assert.equal(cameraErrorMessage({ name: "NotAllowedError" }), "Kamera nicht erlaubt");
  assert.equal(cameraErrorMessage({ name: "NotFoundError" }), "Keine Kamera gefunden");
  assert.equal(cameraErrorMessage({ name: "NotReadableError" }), "Kamera ist belegt");
  assert.equal(cameraErrorMessage({ name: "Other" }), "Kamera nicht verfügbar");
  assert.equal(visionErrorMessage(401), "Vision braucht einen Admin-Token");
  assert.equal(visionErrorMessage(403), "Vision braucht einen Admin-Token");
  assert.equal(visionErrorMessage(404), "Vision ist nicht eingerichtet");
  assert.equal(visionErrorMessage(500, "entity not found"), "Vision ist nicht eingerichtet");
  assert.equal(visionErrorMessage(500, "boom"), "Vision antwortet nicht");
});

test("dataUrlBlob(): decodes JPEG bytes", () => {
  const blob = dataUrlBlob("data:image/jpeg;base64,AAECAw==");
  assert.ok(blob);
  assert.equal(blob.type, "image/jpeg");
  assert.equal(blob.size, 4);
  assert.equal(dataUrlBlob("nonsense"), null);
});

test("vision usage: counted per day, shown as a share of the daily limit", async () => {
  const { countVisionCall, visionUsage, visionUsageText } = await import("../camera.js");
  const store = {};
  const storage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } };
  const day1 = new Date("2026-11-19T10:00:00");
  assert.equal(visionUsage(storage, day1), 0);
  countVisionCall(storage, day1);
  countVisionCall(storage, day1);
  assert.equal(visionUsage(storage, day1), 2);
  assert.equal(visionUsage(storage, new Date("2026-11-20T08:00:00")), 0);
  assert.equal(visionUsageText("Gemini 3.5 Flash Lite", 2, 1000), "Gemini 3.5 Flash Lite · 0,2 % heute");
  assert.equal(visionUsageText("Gemini 3.5 Flash Lite", 250, 1000), "Gemini 3.5 Flash Lite · 25 % heute");
  assert.equal(visionUsageText("Gemini", 5, 0), "Gemini · 5 heute");
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(visionUsage(broken, day1), 0);
  countVisionCall(broken, day1);
});
