#!/usr/bin/env python3
"""Makes the dark-figure copies: the same six animations on a black page.

What: reads the APNGs of a figure folder (`<prefix>idle.png` ... `<prefix>avatar.png`),
finds the background that touches the border, fades it to pure black with a soft edge,
and writes the six files to `<out>/<name>.png` (or `<prefix>` kept). The animation's
frame count, frame duration and size stay the same.

Why: the figure frames carry the light page (#F3F3F3) behind the character. On the
square AMOLED layout that light square is exactly what the dark theme must not show;
recolouring at build time keeps the browser's draw at one image per frame.

Pitfalls:
  * A busy background is not a flat page colour; this only works for the project's own
    frames and the owner's Muse frames, which have a plain light background.
  * The flood fill starts at the border and only follows background-coloured pixels, so
    a light shirt inside the character stays.
  * Meta's Muse frames are the owner's private artwork; write them under web/local/,
    never into a commit.

Usage:
  uv run --python 3.14 --with pillow --with numpy tools/make_figure_dark.py \
      --src web/local --out web/local/dark --prefix muse_
  uv run --python 3.14 --with pillow --with numpy tools/make_figure_dark.py \
      --src web/figure-default --out web/figure-default/dark
"""
from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

NAMES = ("idle", "wave", "working", "making", "confetti", "avatar")


def flatten(rgb: np.ndarray, tolerance: int, blur: float) -> np.ndarray:
    """The frame with its border-connected background faded to black."""
    h, w, _ = rgb.shape
    edge = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    background = np.median(edge, axis=0)
    distance = np.max(np.abs(rgb.astype(np.int16) - background), axis=2)

    mask = np.zeros((h, w), bool)
    queue: deque[tuple[int, int]] = deque()
    for x in range(w):
        for y in (0, h - 1):
            if distance[y, x] <= tolerance and not mask[y, x]:
                mask[y, x] = True
                queue.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if distance[y, x] <= tolerance and not mask[y, x]:
                mask[y, x] = True
                queue.append((y, x))
    while queue:
        y, x = queue.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not mask[ny, nx] and distance[ny, nx] <= tolerance:
                mask[ny, nx] = True
                queue.append((ny, nx))

    alpha = Image.fromarray(((~mask) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(blur))
    a = np.asarray(alpha, dtype=np.float32) / 255.0
    return (rgb.astype(np.float32) * a[..., None]).clip(0, 255).astype(np.uint8)


def vignette(image: Image.Image, inner: float = 0.74, outer: float = 1.0,
             bottom: float = 0.78) -> Image.Image:
    """An even, round fade to black, with an earlier fade at the bottom edge.

    The figure's own frames end flat at the bottom; the extra bottom ramp hides that
    cut in black instead of showing a horizontal line.
    """
    w, h = image.size
    yy, xx = np.ogrid[:h, :w]
    radius = np.sqrt((xx - (w - 1) / 2) ** 2 + (yy - (h - 1) / 2) ** 2) / (min(w, h) / 2)
    t = np.clip((outer - radius) / (outer - inner), 0, 1)
    t = t * t * (3 - 2 * t)
    y_norm = yy / max(1, h - 1)
    b = np.clip((1 - y_norm) / (1 - bottom), 0, 1)
    b = b * b * (3 - 2 * b)
    t = t * b
    return (np.asarray(image, dtype=np.float32) * t[..., None]).clip(0, 255).astype(np.uint8)


def round_avatar(image: Image.Image, feather: float = 1.5) -> Image.Image:
    """A clean circle, so the avatar's own light rim does not glow on black."""
    w, h = image.size
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).ellipse((1, 1, w - 2, h - 2), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(feather))
    return Image.composite(image, Image.new("RGB", (w, h), (0, 0, 0)), mask)


def convert(src: Path, out: Path, tolerance: int, blur: float, round_avatar_image: bool = True,
            vignette_image: bool = True) -> tuple[int, int]:
    image = Image.open(src)
    frames = []
    durations = []
    for index in range(getattr(image, "n_frames", 1)):
        image.seek(index)
        frame = Image.fromarray(flatten(np.asarray(image.convert("RGB")), tolerance, blur))
        if round_avatar_image and out.stem == "avatar":
            frame = round_avatar(frame)
        elif vignette_image:
            frame = Image.fromarray(vignette(frame))
        frames.append(frame)
        durations.append(image.info.get("duration", 167))
    if len(frames) == 1:
        frames[0].save(out)
    else:
        frames[0].save(out, save_all=True, append_images=frames[1:], duration=durations, loop=0)
    return len(frames), frames[0].width


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--src", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--prefix", default="")
    parser.add_argument("--tolerance", type=int, default=18)
    parser.add_argument("--blur", type=float, default=1.2)
    parser.add_argument("--no-avatar-round", action="store_true",
                        help="keep the avatar's square frame instead of a clean circle")
    parser.add_argument("--no-vignette", action="store_true",
                        help="keep the figure's own outline instead of the round fade")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    for name in NAMES:
        src = args.src / f"{args.prefix}{name}.png"
        if not src.exists():
            print(f"missing {src}")
            continue
        dst = args.out / f"{args.prefix}{name}.png"
        if args.dry_run:
            print(f"would write {dst}")
            continue
        count, size = convert(src, dst, args.tolerance, args.blur, not args.no_avatar_round, not args.no_vignette)
        print(f"{dst}  {size} px, {count} frame(s), {dst.stat().st_size // 1024} KiB")


if __name__ == "__main__":
    main()
