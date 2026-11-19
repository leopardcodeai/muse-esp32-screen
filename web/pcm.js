// pcm.js: the two pure steps between the microphone and Home Assistant's pipeline.
//
// The browser captures float samples at its own audio rate (often 48 kHz); the Assist
// pipeline wants 16 kHz mono signed 16-bit little-endian PCM. Box-average downsampling
// is enough for speech and cheap on a tablet. No DOM and no audio API, so the Node
// tests run it directly.

// Average each input block into one output sample. A rate lower than the input keeps
// one sample in one; the same rate returns a copy.
export function downsample(input, inputRate, outputRate = 16000) {
  if (!input || !input.length || !(inputRate > 0) || !(outputRate > 0)) return new Float32Array(0);
  if (inputRate === outputRate) return new Float32Array(input);
  const ratio = inputRate / outputRate;
  const length = Math.max(0, Math.floor(input.length / ratio));
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = end > start ? sum / (end - start) : 0;
  }
  return out;
}

// Clamp to [-1, 1] and scale to signed 16-bit.
export function toPcm16(input) {
  const out = new Int16Array(input ? input.length : 0);
  for (let i = 0; i < out.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

// Concatenate the captured Float32 chunks in order.
export function mergeFloat32(chunks) {
  if (!Array.isArray(chunks) || !chunks.length) return new Float32Array(0);
  let total = 0;
  for (const c of chunks) total += c && c.length ? c.length : 0;
  const out = new Float32Array(total);
  let at = 0;
  for (const c of chunks) {
    if (!c || !c.length) continue;
    out.set(c, at);
    at += c.length;
  }
  return out;
}

// One websocket audio frame: the handler id byte followed by little-endian PCM16.
export function audioFrame(handlerId, pcm16) {
  const frame = new Uint8Array(1 + pcm16.length * 2);
  frame[0] = handlerId & 0xff;
  const view = new DataView(frame.buffer);
  for (let i = 0; i < pcm16.length; i++) view.setInt16(1 + i * 2, pcm16[i], true);
  return frame;
}
