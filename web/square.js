// square.js: the square layout, Muse on a 480 x 480 logical canvas, exactly as
// docs/SQUARE_LAYOUT.md specifies it (that file is the source; a difference here is a
// bug here). The same display state machine (display.js) drives it: the same actions,
// queue, timers and questions; only the geometry, the fonts, a few times and the motion
// are the square layout's own. It is the web twin of the ESP-Mosaico firmware's screen
// and what the Muse camera add-on for Home Assistant renders.
//
// Layout: a top bar like a phone's status bar on every screen, as the box's drawTopBar
// draws it (the name top left with the soonest timer and the "+N" of waiting cards right
// after it, the clock in the middle, a dot for the connection on the right); the ready
// screen shows the figure at 280 px with one status bubble under it, as the box's
// drawStatus shows its pill; the celebration puts a title and a message in the bubble's
// place; every card has an avatar or a coloured disc, a title of up to two lines and a
// white panel of 432 x 280 with the card's content.
//
// Motion (SQUARE_LAYOUT.md, Motion): a new card slides up 24 px and fades in over 220 ms
// (ease-out) while the one before fades out over 160 ms (a snapshot of the last picture
// drawn over it); the bubble's dot pulses while listening or thinking; the timer arc moves
// on every frame; a celebration throws a burst of confetti and lets it fall.
//
// Pitfalls:
//  * Nothing is drawn when nothing moves: a signature of everything a still picture
//    depends on (status, texts, queue, the clock's minute, the figure's step, the canvas
//    size) is compared with the last one, and only a change or an animation draws. A
//    resize clears the canvas, so the canvas size is part of the signature.
//  * Scenes and the route are the box's drawings, scaled into the panel through a
//    renderer whose begin() sets the scaled transform (draw.js calls begin() itself).
//  * Wrapped lines are kept per card (cleared when the card changes), so a frame at 60 a
//    second measures no text it measured before.
//  * The figure's frames are opaque squares in the page colour; the ready screen and the
//    celebration stand on the page, so the square is invisible there.
//  * Tile mode (`d.tile`, Muse OS shows the canvas as a square of about 184 dp): no top
//    bar text and no bubble, the figure fills the square, one status dot, and a card is
//    reduced to what stays readable at a third of the size (TILE below). It is a flag of
//    the tablet page only; without it every picture here is the spec's, unchanged.
import { wrap, fitLine, timeLeft, clockText, WEATHER } from "./text.js";
import { PILLS, event as eventIcon } from "./tables.js";
import { particles, rnd, PALETTE } from "./particles.js";
import { css, iconFont, INTER, PAGE, INK, SUB, CARD, TXT, SHADOW, WHITE, ORANGE, BUTTON, BUTTON_TEXT, EDGE, W as BOX_W, H as BOX_H } from "./render.js";
import { Item, mix } from "./scene.js";
import { CARD_STEP_MS } from "./figure.js";
import { drawRoute } from "./cards.js";
import { figureMotion, followPose, withFigureMotion } from "./follow.js";
import { withMotionPose, drawMotionEffects, followDamp } from "./motion.js";

export const SQUARE_W = 480;
export const SQUARE_H = 480;

// The regions of SQUARE_LAYOUT.md, in logical px.
export const TOP_BAR = { h: 62 }; // everything below it is the screen's content
export const NAME = { x: 24, y: 10, w: 120, h: 44 };
export const CLOCK = { x: 165, y: 12, w: 150, h: 40 };
export const DOT = { x: 444, y: 26, size: 12 };
export const BADGE = { x: 116, y: 16, w: 64, h: 32, radius: 16, gap: 8 };
// The ready screen: figure (280) + 16 + bubble (52) = 348 px, centred in y 62 to 480
// (35 px above and below), as the ESP-Mosaico firmware draws it.
export const FIGURE = { x: 100, y: 97, size: 280 };
export const BUBBLE = { x: 105, y: 393, w: 270, h: 52, radius: 26, dotX: 20, dot: 12, textX: 40, textW: 214 };
export const CELEBRATION = { titleY: 385, bodyY: 437, w: 432 };
export const AVATAR = { x: 24, y: 72, size: 84 };
export const TITLE = { x: 124, y: 72, w: 332, h: 84, lineH: 38 };
export const PANEL = { x: 24, y: 176, w: 432, h: 280, radius: 28 }; // 24 px from the sides and the bottom

// Tile mode (Muse OS shows the canvas as a small square, see the pitfalls above): the
// figure fills the square, the status is one dot in the top right corner (where the
// figure's frame is empty), the soonest timer a chip top left; a celebration keeps its
// title, a card its picture or its title in large type.
export const TILE = {
  figure: { x: 20, y: 30, size: 440 },
  dot: { x: 438, y: 42, r: 14 },
  chip: { x: 20, y: 20, h: 52, radius: 26 },
  celebration: { figure: { x: 70, y: 16, size: 340 }, titleY: 372, w: 440 },
  disc: { size: 168, gap: 26 }, // centred with the title below it
  title: { w: 432, lineH: 62, max: 3 },
  value: { labelY: 76, y: 250, unitY: 384, w: 440, px: 150 },
};

// The colour of the tile's one dot: the connection while it is not there (red, orange),
// else the status (green ready, blue listening, ...), so one glance says both.
export function tileDotColor(d) {
  if (d.connection === "off" || d.connection === "connecting") return connectionColor(d.connection);
  const state = d.status >= 0 && d.status <= 6 ? d.status : 0;
  return PILLS[state].color;
}

// What a card shows in the tile: "full" (its picture fills the panel anyway), "value"
// (a big number), "timer" (the time left) or "title" (disc or avatar and the title).
export function tileCardKind(mode) {
  if (mode === 5 || mode === 7 || mode === 9) return "full";
  if (mode === 2 || mode === 4) return "value";
  if (mode === 11) return "timer";
  return "title";
}

const F = (weight, px) => `${weight} ${px}px ${INTER}`;
export const SQUARE_FONTS = {
  name: F(800, 30), clock: F(700, 28), badge: F(800, 19), status: F(700, 21), celebrate: F(800, 32),
  sub: F(500, 20), title: F(800, 30), body: F(500, 24),
  value: F(800, 104), unit: F(700, 30), rowTime: F(700, 20), rowText: F(500, 22), question: F(700, 24),
  button: F(700, 20), timer: F(800, 44), label: F(500, 18),
};
// The tile's own sizes: about three times smaller on the glass, so three times larger here.
const TILE_FONTS = { chip: F(800, 30), title: F(800, 50), celebrate: F(800, 46), label: F(800, 44), unit: F(700, 46) };
const GLYPH_PX = 48;

// Every font of this layout, for document.fonts.load().
export function squareFonts() {
  return [...new Set([...Object.values(SQUARE_FONTS), iconFont(GLYPH_PX), iconFont(GLYPH_PX * 2), iconFont(36)])];
}

// The scene and the route are the box's 320 x 240 pictures scaled into the panel.
const SCENE_K = Math.min(PANEL.w / BOX_W, PANEL.h / BOX_H);
export const SCENE_BOX = {
  k: SCENE_K, w: BOX_W * SCENE_K, h: BOX_H * SCENE_K,
  x: PANEL.x + (PANEL.w - BOX_W * SCENE_K) / 2, y: PANEL.y + (PANEL.h - BOX_H * SCENE_K) / 2,
};
// The route: the box's picture below its title pill (box y 68 to 240), scaled to the
// panel's width; the square layout shows the title above the panel already.
const ROUTE_SRC = { y: 68, h: BOX_H - 68 };
const ROUTE_K = Math.min(PANEL.w / BOX_W, PANEL.h / ROUTE_SRC.h);
const ROUTE_BOX = { k: ROUTE_K, x: PANEL.x + (PANEL.w - BOX_W * ROUTE_K) / 2, y: PANEL.y + (PANEL.h - ROUTE_SRC.h * ROUTE_K) / 2 };

// Box coordinates of a point on the square canvas inside the scene (scene buttons).
export function toScene(x, y) {
  return [(x - SCENE_BOX.x) / SCENE_BOX.k, (y - SCENE_BOX.y) / SCENE_BOX.k];
}

// The times and limits of the square layout (SQUARE_LAYOUT.md, Behaviour and Motion).
export const SQUARE = {
  w: SQUARE_W, h: SQUARE_H,
  queueMax: 8,
  dwellMs: 20000,
  questionMs: 60000,
  celebrateMs: 6000,
  doneMs: 5000,
  pressMs: 150,
  inMs: 220,
  outMs: 160,
  slide: 24,
  topBarH: TOP_BAR.h, // a tap above this line shows the display about itself
  photo: { x: PANEL.x, y: PANEL.y, w: PANEL.w, h: PANEL.h, radius: PANEL.radius, fit: "cover", captionH: 44, captionPx: 20 },
  // A chart is a PNG too, but must never be cropped: contain it in the panel, no caption.
  chartPhoto: { x: PANEL.x, y: PANEL.y, w: PANEL.w, h: PANEL.h, radius: PANEL.radius, fit: "contain" },
  // A card's time on screen: 20 s, a celebration 6 s; a live view keeps its seconds, and
  // a timed image or chart (show_image_timed, show_chart) its own.
  cardMs(card) {
    if (card.mode === 3) return SQUARE.celebrateMs;
    if (card.mode === 5 && card.imageSeconds > 0) return card.imageSeconds * 1000;
    if (card.mode === 5 && card.liveSeconds > 0) return card.ms;
    if (card.mode === 7 || card.mode === 8 || card.mode === 11 || card.mode === 12) return card.ms;
    return SQUARE.dwellMs;
  },
};

// Button i of n of a question: a 2 x 2 grid in the panel; two options (ask: yes left,
// no right) use the bottom row. Canvas coordinates.
export function squareButton(n, i) {
  const slot = n <= 2 ? 2 + i : i;
  const col = slot % 2, row = Math.floor(slot / 2);
  return { x: PANEL.x + 16 + col * 208, y: PANEL.y + 136 + row * 68, w: 192, h: 56 };
}

export function squareButtonAt(n, px, py) {
  for (let i = 0; i < n && i < 4; i++) {
    const b = squareButton(n, i);
    if (px >= b.x && px < b.x + b.w && py >= b.y && py < b.y + b.h) return i;
  }
  return -1;
}

// The caption strip of a picture card (media.js draws it above the picture).
export function squareCaption(card) {
  if (!card.body) return null;
  return { text: card.body, color: card.body === "Live" ? "rgb(255,59,48)" : css(INK) };
}

// Weather numbers (text.js WEATHER) as Material Design Icons glyphs on a coloured disc.
const SUN = [255, 159, 10], NIGHT = [88, 86, 214], GREY = [142, 142, 147], BLUE = [0, 122, 255];
const TEAL = [48, 176, 199], PURPLE = [175, 82, 222], RED = [255, 59, 48];
export const WEATHER_GLYPHS = {
  clear_day: [0xF0599, SUN], clear_night: [0xF0594, NIGHT], partly_day: [0xF0595, SUN],
  partly_night: [0xF0F31, NIGHT], cloudy: [0xF0590, GREY], overcast: [0xF0590, GREY], fog: [0xF0591, GREY],
  drizzle: [0xF0597, TEAL], rain: [0xF0597, BLUE], extreme_rain: [0xF0596, BLUE], showers: [0xF0F33, BLUE],
  thunder: [0xF0593, PURPLE], thunder_rain: [0xF067E, PURPLE], snow: [0xF0598, TEAL], sleet: [0xF067F, TEAL],
  hail: [0xF0592, TEAL], wind: [0xF059D, TEAL], tornado: [0xF0F38, RED], umbrella: [0xF054A, BLUE],
  thermometer: [0xF050F, RED], raindrop: [0xF058C, BLUE], sunrise: [0xF059C, ORANGE], sunset: [0xF059B, ORANGE],
};
export function weatherGlyph(index) {
  const g = WEATHER_GLYPHS[WEATHER[index]];
  return g ? { glyph: g[0], color: g[1] } : null;
}

const G_LIST = 0xF0756, G_CALENDAR = 0xF00F0, G_TIMER = 0xF051B, G_HEART = 0xF02D1;

// `?figurebg=card` compares the dark theme's black figure with the same figure on a
// rounded light card, as the question view's avatar. The app sets it before the first
// draw; the default is the black background.
let figureCard = false;
export function setFigureCard(v) {
  figureCard = v === true;
}
const ROUTE_GLYPH = { bike: 0xF00A3, foot: 0xF0583, car: 0xF010B };
const ELL = "…";

// The connection's dot, in the colours of the box's top bar.
export function connectionColor(c) {
  return c === "on" ? [52, 199, 89] : c === "connecting" ? ORANGE : c === "demo" ? [48, 176, 199] : [255, 59, 48];
}

const easeOut = (p) => 1 - (1 - p) ** 3;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// The status bubble's text: the default of the status, or set_status_text's label while
// that status holds (the same rule as the box's pill in cards.js).
export function statusLabel(d) {
  const state = d.status >= 0 && d.status <= 6 ? d.status : 0;
  if (state !== d.labelState) {
    if (state !== d.statusTextState) d.statusText = "";
    d.labelState = state;
  }
  return d.statusText && state === d.statusTextState ? d.statusText : PILLS[state].text;
}

function poseOf(status) {
  return status === 1 || status === 6 ? "wave" : status === 2 ? "working" : status === 3 ? "making" : "idle";
}

// Whether the figure of `sub` is a picture (else the figure drawn in code, which moves
// on every frame).
function isPicture(fig, sub) {
  return !!((fig.frames && fig.frames.get && fig.frames.get(sub)) || (fig.defaults && fig.defaults.get && fig.defaults.get(sub)));
}

export class SquareView {
  constructor() {
    this.key = null; // mode and version of the content on screen
    this.since = -Infinity; // when it came (the slide in)
    this.ghost = null; // the last picture of the content before (the fade out)
    this.ghostAt = -Infinity;
    this.sig = null; // the signature of the last still picture
    this.size = "";
    this.pending = false; // something drawn was not ready; draw again
    this.cache = new Map();
  }

  // ------------------------------------------------------------ the frame --

  render(r, d, now, clock) {
    const key = `${d.mode}:${d.version}`;
    const size = `${r.canvas.width}x${r.canvas.height}`;
    if (key !== this.key) {
      const canFade = this.key !== null && size === this.size && this.sig !== null;
      if (canFade && this.snapshot(r)) this.ghostAt = now;
      else this.ghostAt = -Infinity;
      this.key = key;
      this.since = now;
      this.cache.clear();
    }
    const tin = now - this.since, tout = now - this.ghostAt;
    const moving = tin < SQUARE.inMs || tout < SQUARE.outMs || this.animates(d, now);
    const sig = moving ? "" : this.signature(d, now, clock, size, r.k);
    if (!moving && sig === this.sig) return false; // nothing moved: the picture stays
    this.sig = sig;
    this.size = size;
    this.pending = false;
    this.draw(r, d, now, clock, tin, tout);
    if (this.pending) this.sig = "";
    return true;
  }

  animates(d, now) {
    return (d.mode === 0 && d.status !== 5 && Boolean(d.figure && d.figure.smooth))
      || d.status === 1 || d.status === 2 || d.mode === 3 || d.mode === 7 || d.mode === 11
      || d.cuddleUntil > now || !!d.pressed || this.pending
      || (d.mode === 0 && !!(d.follow && d.follow.active))
      || (d.mode === 0 && !!(d.motion && d.motion.busy(now)));
  }

  // Everything a still picture depends on.
  signature(d, now, clock, size, k) {
    const fig = d.figure || {};
    const soonest = d.timers.soonest();
    const parts = [size, k, this.key, d.tile ? "tile" : "", d.hideClock ? "noclock" : "", d.status, statusLabel(d), d.queue.waiting.length, d.name,
      d.connection, soonest ? `${soonest.name}:${soonest.left}` : "",
      d.media ? d.media.state : "", clock.getHours(), clock.getMinutes(), clock.getDate(),
      fig.defaults ? fig.defaults.size : -1, fig.frames ? fig.frames.size : -1];
    if (d.mode === 0) parts.push(poseOf(d.status), Math.floor((now - d.animSince) / CARD_STEP_MS));
    if (d.mode === 12) parts.push(Math.floor(now / 60000), d.connection, d.host, d.displayInfo, d.browserInfo, d.timers.size);
    return parts.join("|");
  }

  // Keeps the picture on the canvas for the fade out of the content it shows.
  snapshot(r) {
    const src = r.canvas;
    const doc = src.ownerDocument;
    if (!doc || !src.width) return false;
    if (!this.ghost || this.ghost.ownerDocument !== doc) this.ghost = doc.createElement("canvas");
    const g = this.ghost;
    if (g.width !== src.width || g.height !== src.height) {
      g.width = src.width;
      g.height = src.height;
    }
    const c = g.getContext("2d");
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(src, 0, 0);
    return true;
  }

  draw(r, d, now, clock, tin, tout) {
    const ctx = r.ctx;
    r.begin();
    r.fill(PAGE);
    const tile = d.tile === true;
    if (!tile) this.drawTopBar(r, d, clock);
    const e = easeOut(clamp01(tin / SQUARE.inMs));
    const slide = SQUARE.slide * (1 - e);
    ctx.save();
    ctx.globalAlpha = e;
    ctx.translate(0, slide);
    switch (d.mode) {
      case 0: this.drawIdle(r, d, now, clock); break;
      case 3: this.drawCelebration(r, d, now); break;
      default:
        if (tile) this.drawTileCard(r, d, now, clock, slide);
        else this.drawCard(r, d, now, clock, slide);
        break;
    }
    ctx.restore();
    if (tout < SQUARE.outMs && this.ghost) {
      // The content before, fading out over the new one (the top bar stays as it is).
      const top = tile ? 0 : Math.floor(TOP_BAR.h * r.k);
      const w = r.canvas.width, h = r.canvas.height - top;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1 - tout / SQUARE.outMs;
      if (h > 0) ctx.drawImage(this.ghost, 0, top, w, h, 0, top, w, h);
      ctx.restore();
    }
    if (tile) this.drawTileStatus(r, d, now);
  }

  // --------------------------------------------------------------- helpers --

  // Wrapped lines, kept while the card is on screen.
  lines(r, name, text, font, width, max) {
    const hit = this.cache.get(name);
    if (hit && hit.text === text && hit.width === width) return hit.lines;
    const widthOf = r.widthOf(font);
    let lines = wrap(text || "", widthOf, width);
    if (max > 0 && lines.length > max) {
      lines = lines.slice(0, max);
      lines[max - 1] = fitLine(lines[max - 1] + ELL, width, widthOf, ELL);
    }
    this.cache.set(name, { text, width, lines });
    return lines;
  }

  fit(r, name, text, font, width) {
    const hit = this.cache.get(name);
    if (hit && hit.text === text && hit.width === width) return hit.line;
    const line = fitLine(text || "", width, r.widthOf(font), ELL);
    this.cache.set(name, { text, width, line });
    return line;
  }

  shadowed(r, blur, offsetY, alpha, fn) {
    const ctx = r.ctx;
    ctx.save();
    ctx.shadowColor = `rgba(0,0,0,${alpha})`;
    ctx.shadowBlur = blur * r.k;
    ctx.shadowOffsetY = offsetY * r.k;
    fn();
    ctx.restore();
  }

  figureTile(r, d, sub, t, x, y, size, radius = 28) {
    if (figureCard) {
      r.roundRect(x, y, size, size, radius, [243, 243, 243]);
      const ctx = r.ctx;
      ctx.save();
      r.roundRectPath(x, y, size, size, radius);
      ctx.clip();
      this.figure(r, d, sub, t, x, y, size);
      ctx.restore();
      if (EDGE) r.roundRectOutline(x, y, size, size, radius, 1, EDGE);
      return;
    }
    this.figure(r, d, sub, t, x, y, size);
  }

  figure(r, d, sub, t, x, y, size) {
    if (!isPicture(d.figure, sub)) this.pending = true;
    d.figure.draw(r, sub, t, x, y, CARD_STEP_MS, size);
  }

  // ------------------------------------------------------------- the top --

  // The top bar as the box's drawTopBar draws it: the name on the left with the soonest
  // timer and the orange "+N" of waiting cards right after it, the clock in the middle,
  // the connection's dot on the right. With both chips the clock would sit under the
  // second one, so it then moves right of them (12 px apart).
  drawTopBar(r, d, clock) {
    const mid = NAME.y + NAME.h / 2;
    const name = this.fit(r, "name", d.name, SQUARE_FONTS.name, NAME.w);
    r.print(NAME.x, mid, SQUARE_FONTS.name, INK, "CL", name);
    r.circle(DOT.x + DOT.size / 2, DOT.y + DOT.size / 2, DOT.size / 2, connectionColor(d.connection));
    // The chips start at 116, or right after a name wider than "Muse".
    let x = Math.max(BADGE.x, Math.ceil(NAME.x + r.width(name, SQUARE_FONTS.name)) + BADGE.gap);
    const chip = (text) => {
      const w = Math.max(BADGE.w, Math.round(r.width(text, SQUARE_FONTS.badge)) + 28);
      r.roundRect(x, BADGE.y, w, BADGE.h, BADGE.radius, ORANGE);
      r.print(x + w / 2, BADGE.y + BADGE.h / 2, SQUARE_FONTS.badge, WHITE, "C", text);
      x += w + BADGE.gap;
    };
    const soonest = d.timers.soonest();
    if (soonest && d.mode !== 11) chip(timeLeft(soonest.left));
    const waiting = d.queue.waiting.length;
    if (waiting > 0 && d.mode !== 0) chip(`+${waiting}`);
    // The clock in the middle; when both chips reach into it, it moves right of them.
    // On the Tab and iPad the rail's status header shows the clock already (owner,
    // 19.11.2026: "doppelte Uhrzeit"): the canvas leaves it out there.
    if (d.hideClock === true) return;
    const time = clockText(clock);
    const half = r.width(time, SQUARE_FONTS.clock) / 2;
    const cx = Math.max(CLOCK.x + CLOCK.w / 2, Math.ceil(x + 4 + half));
    r.print(cx, CLOCK.y + CLOCK.h / 2, SQUARE_FONTS.clock, INK, "C", time);
  }

  // ------------------------------------------------- ready and celebration --

  drawIdle(r, d, now, clock) {
    const state = d.status;
    // "Muse folgt mir": the camera's pose tracker (follow.js) moves the figure; null when off.
    const motion = d.follow ? d.follow.sample(now) : null;
    // A move asked for with `animate` or the idle variety (motion.js), only on the ready screen.
    const moving = d.motionPose ? d.motionPose(now) : null;
    const pose = state === 0 ? (moving ? moving.anim : followPose(poseOf(state), motion)) : poseOf(state);
    if (pose !== d.animName) {
      d.animName = pose;
      d.animSince = now;
    }
    const ctx = r.ctx;
    // Tile mode: the figure fills the square and nothing is clipped at a top bar.
    const tile = d.tile === true;
    const f = tile ? TILE.figure : FIGURE;
    const top = tile ? 0 : TOP_BAR.h;
    const cuddle = d.cuddleUntil - now;
    const wiggle = cuddle > 0 ? Math.round(6 * Math.sin(now / 70)) : 0;
    ctx.save();
    if (state === 5) ctx.globalAlpha *= 0.4; // quiet: the figure at 40 %
    let move = figureMotion(motion, f.size);
    if (move && moving) move = { ...move, angle: followDamp(move.angle, moving.weight) };
    if (move || moving) {
      // The figure's page-coloured square must not cover the top bar when it tilts or rises.
      ctx.beginPath();
      ctx.rect(0, top, SQUARE_W, SQUARE_H - top);
      ctx.clip();
    }
    withFigureMotion(ctx, move, f.x + f.size / 2, f.y + f.size / 2,
      () => withMotionPose(ctx, moving, f.x, f.y, f.size,
        () => this.figureTile(r, d, pose, now - d.animSince, f.x + wiggle, f.y, f.size)));
    if (moving) {
      drawMotionEffects(ctx, moving, f.x, f.y, f.size,
        { x: 0, y: top, w: SQUARE_W, h: SQUARE_H - top });
    }
    ctx.restore();
    if (cuddle > 0) this.drawHearts(r, cuddle, f);
    if (!tile) this.drawBubble(r, d, now);
  }

  // The one status bubble under the figure: a dot in the status colour (it pulses while
  // listening or thinking) and the status text, as the box's pill under its figure.
  drawBubble(r, d, now) {
    const state = d.status >= 0 && d.status <= 6 ? d.status : 0;
    const b = BUBBLE;
    const font = SQUARE_FONTS.status;
    this.shadowed(r, 8, 2, 0.10, () => r.roundRect(b.x, b.y, b.w, b.h, b.radius, CARD));
    if (EDGE) r.roundRectOutline(b.x, b.y, b.w, b.h, b.radius, 1, EDGE);
    let k = 1;
    if (state === 1 || state === 2) k = 1 + 0.3 * (0.5 - 0.5 * Math.cos((2 * Math.PI * now) / 1200));
    r.circle(b.x + b.dotX + b.dot / 2, b.y + b.h / 2, (b.dot / 2) * k, PILLS[state].color);
    const label = this.fit(r, "status", statusLabel(d), font, b.textW);
    r.print(b.x + b.textX + b.textW / 2, b.y + b.h / 2, font, INK, "C", label);
  }

  // Cuddled (a tap on the ready screen): hearts rise for 2.6 s, as on the box.
  drawHearts(r, cuddle, f = FIGURE) {
    const hearts = new Item("particles");
    Object.assign(hearts, { sub: "bubbles", count: 9, glyph: G_HEART, hasColor: true, color: [255, 45, 85],
      x: f.x + 20, y: f.y + 10, w: f.size - 40, h: f.size - 20, size: 0, speed: 2.2 });
    const fade = cuddle < 600 ? cuddle / 600 : 1;
    for (const q of particles(hearts, 4242, 2600 - cuddle)) {
      r.print(q.x, q.y, iconFont(36), fade >= 1 ? q.color : mix(q.color, PAGE, fade), "C", String.fromCodePoint(G_HEART));
    }
  }

  // The ready layout with the confetti pose, the title and the message in the bubble's
  // place; a burst of
  // confetti from the figure, then confetti falling (the particle formula of the box).
  drawCelebration(r, d, now) {
    const c = d.card;
    const t = now - d.since;
    if (d.tile === true) {
      // Tile mode: the figure larger, the title alone under it in large type.
      const tc = TILE.celebration;
      this.figure(r, d, "confetti", t, tc.figure.x, tc.figure.y, tc.figure.size);
      r.print(SQUARE_W / 2, tc.titleY, TILE_FONTS.celebrate, INK, "TC", this.fit(r, "tile-title", c.title, TILE_FONTS.celebrate, tc.w));
      this.drawConfetti(r, t, d.until - now);
      return;
    }
    this.figure(r, d, "confetti", t, FIGURE.x, FIGURE.y, FIGURE.size);
    const cx = SQUARE_W / 2, w = CELEBRATION.w;
    r.print(cx, CELEBRATION.titleY, SQUARE_FONTS.celebrate, INK, "TC", this.fit(r, "title", c.title, SQUARE_FONTS.celebrate, w));
    r.print(cx, CELEBRATION.bodyY, SQUARE_FONTS.sub, SUB, "TC", this.fit(r, "body", c.body, SQUARE_FONTS.sub, w));
    this.drawConfetti(r, t, d.until - now);
  }

  drawConfetti(r, t, left) {
    const ctx = r.ctx;
    const base = ctx.globalAlpha;
    const s = t / 1000;
    // The burst: 48 pieces thrown from the figure's middle, falling back with gravity.
    const cx = FIGURE.x + FIGURE.size / 2, cy = FIGURE.y + FIGURE.size * 0.45;
    if (s < 1.6) {
      ctx.globalAlpha = base * clamp01(1 - s / 1.6);
      for (let i = 0; i < 48; i++) {
        const a = rnd(i, 11) * 2 * Math.PI, v = 260 + rnd(i, 12) * 340;
        const x = cx + Math.cos(a) * v * s;
        const y = cy + Math.sin(a) * v * s + 450 * s * s;
        const spin = s * (rnd(i, 13) * 12 - 6);
        const w = 5 + rnd(i, 14) * 6;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(spin);
        ctx.fillStyle = css(PALETTE[i % 8]);
        ctx.fillRect(-w / 2, -4, w, 8);
        ctx.restore();
      }
    }
    // Then confetti falls over the whole screen, fading in and, at the end, out.
    const fall = new Item("particles");
    Object.assign(fall, { sub: "confetti", count: 40, hasColor: false, x: 0, y: 0, w: SQUARE_W, h: SQUARE_H, speed: 1.4 });
    ctx.globalAlpha = base * clamp01((t - 300) / 500) * clamp01(left / 600);
    if (ctx.globalAlpha > 0) {
      for (const q of particles(fall, 7, t)) {
        const w = 3 + Math.trunc(6 * Math.abs(Math.sin(q.secs * 4 + q.r4 * 2 * Math.PI)));
        ctx.fillStyle = css(q.color);
        ctx.fillRect(Math.trunc(q.x), Math.trunc(q.y), w, 9);
      }
    }
    ctx.globalAlpha = base;
  }

  // ----------------------------------------------------------------- tile --

  // The tile's status: one dot top right (it pulses while listening or thinking) and the
  // soonest timer as a chip top left, both large enough to read at a third of the size.
  drawTileStatus(r, d, now) {
    const state = d.status >= 0 && d.status <= 6 ? d.status : 0;
    const dot = TILE.dot;
    let k = 1;
    if (state === 1 || state === 2) k = 1 + 0.25 * (0.5 - 0.5 * Math.cos((2 * Math.PI * now) / 1200));
    r.circle(dot.x, dot.y, dot.r + 4, PAGE);
    r.circle(dot.x, dot.y, dot.r * k, tileDotColor(d));
    const soonest = d.timers.soonest();
    if (soonest && d.mode !== 11) {
      const c = TILE.chip;
      const text = timeLeft(soonest.left);
      const w = Math.round(r.width(text, TILE_FONTS.chip)) + 40;
      r.roundRect(c.x, c.y, w, c.h, c.radius, ORANGE);
      r.print(c.x + w / 2, c.y + c.h / 2, TILE_FONTS.chip, WHITE, "C", text);
    }
  }

  // A card in the tile (tileCardKind): pictures, scenes and routes as they are; a value
  // or the time left as one big number; everything else as its disc and its title.
  drawTileCard(r, d, now, clock, slide) {
    const c = d.card;
    const kind = tileCardKind(c.mode);
    if (kind === "full") {
      this.drawCard(r, d, now, clock, slide);
      return;
    }
    const cx = SQUARE_W / 2;
    if (kind === "value" || kind === "timer") {
      const v = TILE.value;
      const tm = kind === "timer" ? d.timers.soonest() : null;
      if (kind === "timer") {
        // The card stays while its timer runs, as drawTimer keeps it.
        const keep = now + 2500;
        if (keep > d.until) d.until = keep;
      }
      const label = kind === "timer" ? (tm ? tm.name : c.title) : c.label;
      const value = String((kind === "timer" ? (tm ? timeLeft(tm.left) : "") : c.value) || "");
      const unit = kind === "value" && c.mode === 2 ? c.unit : "";
      r.print(cx, v.labelY, TILE_FONTS.label, SUB, "C", this.fit(r, "tile-label", label, TILE_FONTS.label, v.w));
      // The number as large as the width allows, never larger than v.px.
      const wide = r.width(value, F(800, v.px));
      const px = wide > v.w ? Math.max(48, Math.floor((v.px * v.w) / wide)) : v.px;
      r.print(cx, v.y, F(800, px), kind === "timer" ? ORANGE : INK, "C", value);
      if (unit) r.print(cx, v.unitY, TILE_FONTS.unit, SUB, "C", this.fit(r, "tile-unit", unit, TILE_FONTS.unit, v.w));
      return;
    }
    // Disc (weather glyph, event icon, list, calendar) or the avatar, then the title;
    // the two together are centred in the square.
    const title = c.mode === 12 ? "Muse Web Screen" : c.mode === 10 ? (c.title || "Heute") : c.mode === 13 ? (c.title || "Liste") : (c.title || d.name);
    const t = TILE.title;
    const lines = this.lines(r, "tile-head", title, TILE_FONTS.title, t.w, t.max);
    const b = TILE.disc;
    const top = Math.round((SQUARE_H - (b.size + b.gap + lines.length * t.lineH)) / 2);
    const x = cx - b.size / 2;
    const disc = this.tileDisc(c);
    if (disc) {
      r.circle(cx, top + b.size / 2, b.size / 2, disc.color);
      r.print(cx, top + b.size / 2, iconFont(GLYPH_PX * 2), WHITE, "C", String.fromCodePoint(disc.glyph));
    } else if (figureCard || EDGE) {
      // The avatar on its light rounded tile, as head() shows it in the dark theme.
      const ctx = r.ctx;
      r.roundRect(x, top, b.size, b.size, 40, [243, 243, 243]);
      ctx.save();
      r.roundRectPath(x, top, b.size, b.size, 40);
      ctx.clip();
      this.figure(r, d, "avatar", 0, x, top, b.size);
      ctx.restore();
      r.roundRectOutline(x, top, b.size, b.size, 40, 1, [218, 218, 223]);
    } else {
      this.figure(r, d, "avatar", 0, x, top, b.size);
    }
    const y = top + b.size + b.gap;
    lines.forEach((line, k) => r.print(cx, y + t.lineH * k + t.lineH / 2, TILE_FONTS.title, INK, "C", line));
  }

  // The disc of a card in the tile, as head() picks it; null means the avatar.
  tileDisc(c) {
    if (c.mode === 1) return c.icon >= 0 && c.icon < WEATHER.length ? weatherGlyph(c.icon) : null;
    if (c.mode === 6) {
      const ev = eventIcon(c.event);
      return { glyph: ev.glyph, color: ev.color };
    }
    if (c.mode === 10) return { glyph: G_CALENDAR, color: [255, 45, 85] };
    if (c.mode === 13) return { glyph: G_LIST, color: TEAL };
    return null;
  }

  // ---------------------------------------------------------------- cards --

  // The avatar, or a disc in the icon's colour with its glyph in white.
  head(r, d, title, disc = null) {
    if (disc) {
      const cx = AVATAR.x + AVATAR.size / 2, cy = AVATAR.y + AVATAR.size / 2;
      r.circle(cx, cy, AVATAR.size / 2, disc.color);
      r.print(cx, cy, iconFont(GLYPH_PX), WHITE, "C", String.fromCodePoint(disc.glyph));
    } else if (figureCard || EDGE) {
      // The small avatar is a light tile, like the question view in the light theme; the
      // dark theme loads the light avatar for this one spot. The large figure stays black.
      const tile = [243, 243, 243];
      r.roundRect(AVATAR.x, AVATAR.y, AVATAR.size, AVATAR.size, 20, tile);
      const ctx = r.ctx;
      ctx.save();
      r.roundRectPath(AVATAR.x, AVATAR.y, AVATAR.size, AVATAR.size, 20);
      ctx.clip();
      this.figure(r, d, "avatar", 0, AVATAR.x, AVATAR.y, AVATAR.size);
      ctx.restore();
      r.roundRectOutline(AVATAR.x, AVATAR.y, AVATAR.size, AVATAR.size, 20, 1, [218, 218, 223]);
    } else {
      this.figure(r, d, "avatar", 0, AVATAR.x, AVATAR.y, AVATAR.size);
    }
    const lines = this.lines(r, "head", title, SQUARE_FONTS.title, TITLE.w, 2);
    const mid = TITLE.y + TITLE.h / 2;
    lines.forEach((line, k) => {
      r.print(TITLE.x, mid + (k - (lines.length - 1) / 2) * TITLE.lineH, SQUARE_FONTS.title, INK, "CL", line);
    });
  }

  panel(r, color = CARD) {
    this.shadowed(r, 16, 4, 0.08, () => r.roundRect(PANEL.x, PANEL.y, PANEL.w, PANEL.h, PANEL.radius, color));
    // On black a shadow disappears; a hairline keeps the panel's edge visible.
    if (EDGE) r.roundRectOutline(PANEL.x, PANEL.y, PANEL.w, PANEL.h, PANEL.radius, 1, EDGE);
  }

  // Runs `fn` with the panel's top left corner as the origin.
  inPanel(r, fn) {
    const ctx = r.ctx;
    ctx.save();
    ctx.translate(PANEL.x, PANEL.y);
    fn();
    ctx.restore();
  }

  // Text of up to seven lines of 32 px at (24, 22, 384, 228) of the panel.
  body(r, text, name = "body") {
    const lines = this.lines(r, name, text, SQUARE_FONTS.body, 384, Math.floor(228 / 32));
    lines.forEach((line, k) => r.print(24, 22 + 32 * k + 16, SQUARE_FONTS.body, TXT, "CL", line));
  }

  drawCard(r, d, now, clock, slide) {
    const c = d.card;
    switch (c.mode) {
      case 1: { // text
        const w = c.icon >= 0 && c.icon < WEATHER.length ? weatherGlyph(c.icon) : null;
        this.head(r, d, c.title, w);
        this.panel(r);
        this.inPanel(r, () => this.body(r, c.body));
        break;
      }
      case 2: // value
        this.head(r, d, c.label);
        this.panel(r);
        this.inPanel(r, () => this.value(r, c.value, c.unit));
        break;
      case 4: // weather
        this.head(r, d, c.label, weatherGlyph(c.icon) || { glyph: 0xF0590, color: GREY });
        this.panel(r);
        this.inPanel(r, () => this.value(r, c.value, c.body));
        break;
      case 5: // picture or live view
        this.head(r, d, c.title);
        this.drawPicture(r, d);
        break;
      case 6: { // event
        const ev = eventIcon(c.event);
        this.head(r, d, c.title, { glyph: ev.glyph, color: ev.color });
        this.panel(r);
        this.inPanel(r, () => this.body(r, c.body));
        break;
      }
      case 7: // scene
        this.head(r, d, d.name);
        this.drawScene(r, d, now, clock, slide);
        break;
      case 8:
        this.head(r, d, "Frage");
        this.panel(r);
        this.drawQuestion(r, d);
        break;
      case 9:
        this.head(r, d, c.title || "Route", { glyph: ROUTE_GLYPH[c.profile] || ROUTE_GLYPH.car, color: BLUE });
        this.drawRoute(r, d, slide);
        break;
      case 10:
        this.head(r, d, c.title || "Heute", { glyph: G_CALENDAR, color: [255, 45, 85] });
        this.panel(r);
        this.inPanel(r, () => this.drawAgenda(r, d));
        break;
      case 11: {
        const tm = d.timers.soonest();
        this.head(r, d, tm ? tm.name : c.title, { glyph: G_TIMER, color: ORANGE });
        this.panel(r);
        if (tm) this.inPanel(r, () => this.drawTimer(r, d, tm, now));
        break;
      }
      case 12:
        this.head(r, d, `Muse Web Screen ${d.version_string}`);
        this.panel(r);
        this.inPanel(r, () => this.drawInfo(r, d, now));
        break;
      case 13:
        this.head(r, d, c.title || "Liste", { glyph: G_LIST, color: TEAL });
        this.panel(r);
        this.inPanel(r, () => this.drawList(r, d));
        break;
      default:
        break;
    }
  }

  // A big value with its unit line below (value and weather cards).
  value(r, value, unit) {
    const v = this.fit(r, "value", value, SQUARE_FONTS.value, 384);
    r.print(24 + 192, 36 + 60, SQUARE_FONTS.value, INK, "C", v);
    const u = this.fit(r, "unit", unit, SQUARE_FONTS.unit, 384);
    r.print(24 + 192, 160 + 22, SQUARE_FONTS.unit, SUB, "C", u);
  }

  // The picture itself is media.js's <img> covering the panel; until it is there the
  // panel says so.
  drawPicture(r, d) {
    const state = d.media ? d.media.state : "none";
    this.panel(r);
    if (state === "ready") return;
    this.inPanel(r, () => {
      this.figureTile(r, d, "avatar", 0, PANEL.w / 2 - 42, 64, 84, 20);
      const text = state === "failed" ? "Bild nicht erreichbar" : "Bild lädt …";
      r.print(PANEL.w / 2, 186, SQUARE_FONTS.sub, SUB, "C", text);
    });
  }

  // A scene of the box, scaled into the panel with round corners.
  drawScene(r, d, now, clock, slide) {
    if (!d.scene) return;
    const b = SCENE_BOX;
    const ctx = r.ctx;
    this.shadowed(r, 16, 4, 0.08, () => r.roundRect(b.x, b.y, b.w, b.h, PANEL.radius, PAGE));
    ctx.save();
    r.roundRectPath(b.x, b.y, b.w, b.h, PANEL.radius);
    ctx.clip();
    d.sceneDrawer.draw(scaled(r, b.x, b.y + slide, b.k), d.scene, d.version, now - d.since, clock);
    ctx.restore();
  }

  // The box's route card, scaled into the panel (the map is the box's alone).
  drawRoute(r, d, slide) {
    const ctx = r.ctx;
    this.panel(r, PAGE);
    ctx.save();
    r.roundRectPath(PANEL.x, PANEL.y, PANEL.w, PANEL.h, PANEL.radius);
    ctx.clip();
    const b = ROUTE_BOX;
    const sr = scaled(r, b.x, b.y + slide - ROUTE_SRC.y * b.k, b.k);
    sr.begin();
    drawRoute(sr, { card: { ...d.card, title: "" } });
    ctx.restore();
  }

  // The question at the top of the panel, the buttons below (canvas coordinates).
  drawQuestion(r, d) {
    const qs = d.question;
    this.inPanel(r, () => {
      const lines = this.lines(r, "question", d.card.title, SQUARE_FONTS.question, 384, 3);
      lines.forEach((line, k) => r.print(24, 22 + 32 * k + 16, SQUARE_FONTS.question, INK, "CL", line));
    });
    const n = Math.min(4, qs.options.length);
    for (let i = 0; i < n; i++) {
      const b = squareButton(n, i);
      const on = d.pressed && d.pressed.i === i;
      r.roundRect(b.x, b.y, b.w, b.h, 28, on ? ORANGE : BUTTON);
      const t = this.fit(r, `button${i}`, qs.options[i], SQUARE_FONTS.button, b.w - 24);
      r.print(b.x + b.w / 2, b.y + b.h / 2, SQUARE_FONTS.button, on ? WHITE : BUTTON_TEXT, "C", t);
    }
  }

  // Rows of 48 px from y 14: a dot, then the row's own drawing; more than five rows
  // show four and "+N weitere".
  rows(r, count, empty, drawRow) {
    const shown = count > 5 ? 4 : count;
    const y = (k) => 14 + 48 * k + 24;
    if (count === 0) {
      r.print(24, y(0), SQUARE_FONTS.body, SUB, "CL", empty);
      return;
    }
    for (let k = 0; k < shown; k++) {
      r.circle(24 + 5, y(k), 5, ORANGE);
      drawRow(k, y(k));
    }
    if (count > 5) r.print(46, y(4), SQUARE_FONTS.body, SUB, "CL", `+${count - 4} weitere`);
  }

  drawList(r, d) {
    const items = d.list;
    this.rows(r, items.length, "Nichts drauf", (k, y) => {
      const t = this.fit(r, `row${k}`, items[k].text, SQUARE_FONTS.body, 408 - 46);
      r.print(46, y, SQUARE_FONTS.body, items[k].done ? SUB : TXT, "CL", t);
    });
  }

  drawAgenda(r, d) {
    const items = d.agenda;
    this.rows(r, items.length, "Keine Termine", (k, y) => {
      const a = items[k];
      const time = this.fit(r, `time${k}`, a.time, SQUARE_FONTS.rowTime, 104);
      r.print(46, y, SQUARE_FONTS.rowTime, SUB, "CL", time);
      const what = a.title + (a.place ? " · " + a.place : "");
      const t = this.fit(r, `row${k}`, what, SQUARE_FONTS.rowText, 408 - 156);
      r.print(156, y, SQUARE_FONTS.rowText, TXT, "CL", t);
    });
  }

  // The arc empties smoothly with the time in ms; the text counts whole seconds.
  drawTimer(r, d, tm, now) {
    const keep = now + 2500;
    if (keep > d.until) d.until = keep;
    const cx = 118 + 98, cy = 18 + 98;
    r.ringArc(cx, cy, 98, 82, 0, 360, SHADOW);
    const share = tm.total > 0 ? clamp01((tm.endMs - now) / (tm.total * 1000)) : 0;
    if (share > 0) r.ringArc(cx, cy, 98, 82, 0, 360 * share, ORANGE);
    r.print(cx, cy, SQUARE_FONTS.timer, INK, "C", timeLeft(tm.left));
    if (d.timers.size > 1) r.print(cx, 244, SQUARE_FONTS.sub, SUB, "C", `+${d.timers.size - 1} weitere`);
  }

  // The display about itself (a tap on the top bar).
  drawInfo(r, d, now) {
    const up = Math.floor(now / 1000);
    const values = [
      d.connection === "on" ? "verbunden" : d.connection === "connecting" ? "verbindet …" : d.connection === "demo" ? "Demo" : "getrennt",
      d.host || "nicht eingerichtet",
      `${Math.floor(up / 3600)} h ${String(Math.floor(up / 60) % 60).padStart(2, "0")} min`,
      `${d.queue.waiting.length} warten  ·  ${d.queue.history.length} zurück  ·  ${d.timers.size} Timer`,
      d.displayInfo || "",
      d.browserInfo || "",
    ];
    const LABELS = ["Verbindung", "Home Assistant", "Läuft seit", "Karten", "Anzeige", "Browser"];
    for (let k = 0; k < 6; k++) {
      const y = 16 + 40 * k + 20;
      r.print(24, y, SQUARE_FONTS.label, SUB, "CL", LABELS[k]);
      const room = 408 - 24 - Math.ceil(r.width(LABELS[k], SQUARE_FONTS.label)) - 20;
      r.print(408, y, SQUARE_FONTS.label, TXT, "CR", fitLine(values[k], room, r.widthOf(SQUARE_FONTS.label), ELL));
    }
  }
}

// A renderer that draws the box's 320 x 240 picture at (x, y) of the square canvas,
// `s` times larger: begin() sets that transform (draw.js calls it itself), fill() fills
// the box's area only. Everything else is the renderer's own.
function scaled(r, x, y, s) {
  const p = Object.create(r);
  p.k = r.k * s;
  p.w = BOX_W;
  p.h = BOX_H;
  p.begin = () => {
    const ctx = r.ctx;
    ctx.setTransform(p.k, 0, 0, p.k, r.k * x, r.k * y);
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";
  };
  return p;
}
