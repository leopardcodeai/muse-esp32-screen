// figure_sheet.js: the compact figure format, one lossy WebP per pose that holds all its
// frames in a grid (a sprite sheet), and the decoder that turns any figure picture
// (sheet WebP, plain WebP still, PNG or APNG) into the list of frames the figure plays.
//
// Why a sheet: the owner's poses were animated PNGs of 72 frames at 320 px, 5 to 6 MB
// each (33 MB for the six), and Muse took about 4 s to appear on the Samsung Tab on a
// cold start. The same frames as one lossy WebP are about 300 KB, with no difference to
// see on the 480 px canvas (their background is flat, no alpha is needed). An animated
// WebP would be smaller still, but playing it frame by frame needs WebCodecs'
// ImageDecoder, which Safari (the iPad) lacks; a still WebP decodes everywhere through
// createImageBitmap, and cutting it into frames is one more createImageBitmap per frame.
//
// The layout travels inside the file, in its XMP chunk (tools/make_figure_sheets.py):
//   muse-sheet="frames=72 columns=9 size=320 delay=41.667"
// frames left to right, top to bottom, each `size` px square, `delay` ms per frame. A
// WebP without that line is one still picture (the start pose, a still avatar).
//
// Pitfalls:
//  * The sheet decodes to one big bitmap (2880 x 2560 for 72 frames, about 29 MB) next
//    to its frames; it is closed as soon as the frames are cut, so the peak is short.
//  * WebP stills are capped at 16383 px a side; the generator keeps the grid square-ish.
//  * parseSheetMeta() and sniffFormat() run in Node for the tests; decodeSheet() needs a
//    browser (createImageBitmap).
import { decodeApng } from "./apng.js";

const ascii = (b, i, n) => String.fromCharCode(...b.subarray(i, i + n));
const u32le = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

// "png", "webp" or "" for the first bytes of a picture.
export function sniffFormat(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length >= 8 && b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71) return "png";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "webp";
  return "";
}

// The text of a WebP's XMP chunk, or "" without one.
export function webpXmp(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (sniffFormat(b) !== "webp") return "";
  for (let i = 12; i + 8 <= b.length;) {
    const type = ascii(b, i, 4);
    const len = u32le(b, i + 4);
    if (type === "XMP ") return new TextDecoder("latin1").decode(b.subarray(i + 8, Math.min(b.length, i + 8 + len)));
    i += 8 + len + (len & 1); // RIFF chunks are padded to an even length
  }
  return "";
}

// The sheet layout {frames, columns, size, delayMs} from a WebP's XMP, or null for a
// still picture. Anything implausible is null too, so a broken file shows as one still
// instead of a grid of nonsense.
export function parseSheetMeta(bytes) {
  const m = /muse-sheet="([^"]*)"/.exec(webpXmp(bytes));
  if (!m) return null;
  const v = Object.fromEntries(m[1].trim().split(/\s+/).map((kv) => kv.split("=")).filter((p) => p.length === 2));
  const frames = Number.parseInt(v.frames, 10);
  const columns = Number.parseInt(v.columns, 10);
  const size = Number.parseInt(v.size, 10);
  const delayMs = Number.parseFloat(v.delay);
  if (!(frames >= 1 && frames <= 1000 && columns >= 1 && columns <= frames && size >= 8 && size <= 4096)) return null;
  return { frames, columns, size, delayMs: delayMs > 0 && delayMs < 10000 ? delayMs : 0 };
}

// Where frame `i` of a sheet sits: {sx, sy}.
export function sheetCell(i, columns, size) {
  return { sx: (i % columns) * size, sy: Math.floor(i / columns) * size };
}

// Decodes a WebP into frames: a sheet into its cells, a plain WebP into one still.
// Returns an array of ImageBitmaps with `delayMs` set, like decodeApng().
export async function decodeSheet(bytes, { createBitmap = (src, ...rect) => createImageBitmap(src, ...rect) } = {}) {
  const meta = parseSheetMeta(bytes);
  const sheet = await createBitmap(new Blob([bytes], { type: "image/webp" }));
  if (!meta) {
    const still = [sheet];
    still.delayMs = 0;
    return still;
  }
  const cells = [];
  for (let i = 0; i < meta.frames; i++) {
    const { sx, sy } = sheetCell(i, meta.columns, meta.size);
    cells.push(createBitmap(sheet, sx, sy, meta.size, meta.size));
  }
  const frames = await Promise.all(cells);
  sheet.close?.();
  frames.delayMs = Math.round(meta.delayMs);
  return frames;
}

// Any figure picture into frames: PNG and APNG through apng.js, WebP through the sheet.
export async function decodeFigure(bytes, options = {}) {
  const format = sniffFormat(bytes);
  if (format === "png") return decodeApng(bytes, options);
  if (format === "webp") return decodeSheet(bytes, options);
  throw new Error("neither PNG nor WebP");
}
