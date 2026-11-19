import { test } from "node:test";
import assert from "node:assert/strict";
import { downsample, toPcm16, mergeFloat32, audioFrame } from "../pcm.js";

test("downsample(): 48 kHz to 16 kHz keeps a third of the samples", () => {
  const input = new Float32Array(4800).fill(0.5);
  const out = downsample(input, 48000, 16000);
  assert.equal(out.length, 1600);
  assert.equal(out[0], 0.5);
  assert.equal(out[1599], 0.5);
});

test("downsample(): 44.1 kHz to 16 kHz and same-rate copy", () => {
  const input = new Float32Array(4410).fill(0.25);
  const out = downsample(input, 44100, 16000);
  assert.equal(out.length, 1600);
  assert.equal(out[0], 0.25);
  const same = downsample(input, 16000, 16000);
  assert.notEqual(same, input);
  assert.deepEqual([...same], [...input]);
  assert.equal(downsample([], 48000, 16000).length, 0);
  assert.equal(downsample(null, 48000, 16000).length, 0);
});

test("toPcm16(): clips and scales", () => {
  const out = toPcm16(new Float32Array([-2, -1, 0, 1, 2]));
  assert.equal(out[0], -32768);
  assert.equal(out[1], -32768);
  assert.equal(out[2], 0);
  assert.equal(out[3], 32767);
  assert.equal(out[4], 32767);
});

test("mergeFloat32(): concatenates in order", () => {
  const out = mergeFloat32([new Float32Array([1, 2]), new Float32Array([3])]);
  assert.deepEqual([...out], [1, 2, 3]);
  assert.equal(mergeFloat32([]).length, 0);
});

test("audioFrame(): handler byte and little-endian samples", () => {
  const frame = audioFrame(1, new Int16Array([0x1234, -2]));
  assert.equal(frame[0], 1);
  assert.equal(frame[1], 0x34);
  assert.equal(frame[2], 0x12);
  assert.equal(frame[3], 0xfe);
  assert.equal(frame[4], 0xff);
  assert.equal(frame.length, 5);
});
