// theme.js: the two palettes of the square layout. Light is the box's page and the
// shared design in docs/SQUARE_LAYOUT.md; dark is the ESP-Mosaico's AMOLED look (true
// black, the panel's 50,000:1 contrast) and the web twin's default for square.
//
// The theme changes the chrome and the cards, never the colours inside a draw scene:
// a scene keeps what its author wrote. The box layout always stays light.
import { setPalette } from "./render.js";
import { PILLS } from "./tables.js";

export const PALETTES = Object.freeze({
  light: Object.freeze({
    page: [243, 243, 243],
    card: [255, 255, 255],
    ink: [28, 28, 30],
    sub: [99, 99, 104],
    text: [44, 44, 46],
    shadow: [226, 226, 231],
    edge: null,
    orange: [255, 149, 0],
    button: [28, 28, 30],
    buttonText: [255, 255, 255],
    pills: [[52, 199, 89], [10, 132, 255], [255, 159, 10], [191, 90, 242], [255, 69, 58], [142, 142, 147], [48, 176, 199]],
  }),
  dark: Object.freeze({
    page: [0, 0, 0],
    card: [20, 20, 22],
    ink: [245, 245, 247],
    sub: [161, 161, 168],
    text: [232, 232, 237],
    shadow: [0, 0, 0],
    edge: [44, 44, 46],
    orange: [255, 159, 10],
    button: [245, 245, 247],
    buttonText: [0, 0, 0],
    pills: [[48, 209, 88], [64, 156, 255], [255, 159, 10], [191, 90, 242], [255, 69, 58], [142, 142, 147], [48, 176, 199]],
  }),
});

// The token set in use, for the renderer's edge check and the tests.
let current = "light";
export const activeTheme = () => current;

export function applyTheme(name) {
  current = name === "dark" ? "dark" : "light";
  const p = PALETTES[current];
  setPalette(p);
  p.pills.forEach((color, i) => {
    if (PILLS[i]) PILLS[i].color = color;
  });
  return current;
}
