#!/usr/bin/env python3
"""Turns a figure folder's animated PNGs into compact WebP sheets plus a start pose.

What: for every <prefix><name>.png of a figure folder (and of its dark/ copy) writes
  <prefix><name>.webp: all frames of the animation in one lossy WebP, left to right and
  top to bottom in a square-ish grid, with the layout in the file's XMP chunk
  (muse-sheet="frames=72 columns=9 size=320 delay=41.667"; web/figure_sheet.js reads
  it). A one-frame picture (the avatar) becomes a plain WebP still. Beside them it writes
  <prefix>start.webp, idle's first frame as a small still that the page draws in its very
  first frame on a cold start (web/figure_frames.js, START_POSE).
Why: the owner's poses were 5 to 6 MB animated PNGs each (33 MB for six), and Muse took
  about 4 s to appear on the Samsung Tab on a cold start (owner, 19.11.2026: "schnell
  laden und eine schnelle start pose"). The frames carry a flat page colour, so no alpha
  is needed; quality 82 is about 300 KB a pose, 40 dB PSNR, no visible difference at
  480 px. The PNGs stay as the build source and as the page's fallback.
Usage:
  uv run --python 3.14 --with pillow tools/make_figure_sheets.py --src web/local
  uv run --python 3.14 --with pillow tools/make_figure_sheets.py --src web/local/winter   # another style
  ... --quality 88     sharper, about 1.6 times the bytes
  ... --dry-run        show the plan
Pitfalls:
  * A WebP is at most 16383 px a side: 72 frames of 320 px make 2880 x 2560, fine; very
    long or large clips would need fewer frames (the script refuses them).
  * Frames are read through Pillow's APNG support, which composites each frame onto the
    previous one, so delta frames (make_figure_dark.py writes those) come out whole.
  * Meta's Muse artwork: the source folder and its output are private (web/local is
    ignored by git and Vercel); never point --src into the repository's tracked files.
"""
from __future__ import annotations

import argparse
import math
from pathlib import Path

from PIL import Image

NAMES = ("idle", "wave", "working", "making", "confetti", "avatar")
WEBP_MAX = 16383


def read_frames(path: Path) -> tuple[list[Image.Image], float]:
    image = Image.open(path)
    frames = []
    for index in range(getattr(image, "n_frames", 1)):
        image.seek(index)
        frames.append(image.convert("RGB"))
    return frames, float(image.info.get("duration") or 0)


def sheet_of(frames: list[Image.Image]) -> tuple[Image.Image, int]:
    size = frames[0].width
    columns = math.ceil(math.sqrt(len(frames)))
    rows = math.ceil(len(frames) / columns)
    if columns * size > WEBP_MAX or rows * size > WEBP_MAX:
        raise SystemExit(f"{len(frames)} frames of {size} px do not fit a WebP; use fewer frames")
    sheet = Image.new("RGB", (columns * size, rows * size), frames[0].getpixel((0, 0)))
    for i, frame in enumerate(frames):
        sheet.paste(frame, ((i % columns) * size, (i // columns) * size))
    return sheet, columns


def xmp(frames: int, columns: int, size: int, delay: float) -> bytes:
    return (f'<x:xmpmeta xmlns:x="adobe:ns:meta/" '
            f'muse-sheet="frames={frames} columns={columns} size={size} delay={delay:.3f}"/>').encode()


def convert_folder(folder: Path, prefix: str, quality: int, dry: bool) -> list[tuple[Path, int, int]]:
    """Writes the sheets and the start pose of one folder; returns (file, png bytes, webp bytes)."""
    done = []
    for name in NAMES:
        src = folder / f"{prefix}{name}.png"
        if not src.exists():
            continue
        dst = src.with_suffix(".webp")
        if dry:
            print(f"would write {dst}")
            continue
        frames, delay = read_frames(src)
        if len(frames) == 1:
            frames[0].save(dst, "WEBP", quality=90, method=6)
        else:
            sheet, columns = sheet_of(frames)
            sheet.save(dst, "WEBP", quality=quality, method=6, xmp=xmp(len(frames), columns, frames[0].width, delay))
        done.append((dst, src.stat().st_size, dst.stat().st_size))
        if name == "idle":
            start = folder / f"{prefix}start.webp"
            frames[0].save(start, "WEBP", quality=90, method=6)
            done.append((start, 0, start.stat().st_size))
    return done


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--src", type=Path, required=True, help="the figure folder (its dark/ is done too)")
    ap.add_argument("--prefix", default="muse_")
    ap.add_argument("--quality", type=int, default=82)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    folders = [args.src] + ([args.src / "dark"] if (args.src / "dark").is_dir() else [])
    png_total = webp_total = 0
    for folder in folders:
        for dst, png, webp in convert_folder(folder, args.prefix, args.quality, args.dry_run):
            png_total += png
            webp_total += webp
            was = f"{png // 1024} KiB PNG -> " if png else ""
            print(f"{dst}  {was}{webp // 1024} KiB")
    if not args.dry_run:
        print(f"total {png_total / 1e6:.1f} MB PNG -> {webp_total / 1e6:.2f} MB WebP")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
