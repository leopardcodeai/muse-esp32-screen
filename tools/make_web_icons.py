#!/usr/bin/env python3
"""Draws the web app's installed-app icons: a neutral grey silhouette on a dark squircle.

What: writes web/icons/icon-192.png, icon-512.png, icon-maskable-512.png and
  apple-touch-icon.png (180 px). The figure is the same plain stand-in the page draws
  without a figure folder (web/figure.js: a round body with a darker lower half and two
  eyes), in greys only, on a near-black rounded square. With --own PICTURE the same four
  files are cut from the owner's own square app icon instead and written to
  web/local/icons/, which the Muse Web Screen deploy puts in place of the public ones on
  the add-on (dashboard/deploy_muse_web.py in the homeassistant repository).
Why: up to 1.8.22 the icons showed the old blue character, which the owner retired on
  19.11.2026 ("blau raus"). The public repository must never carry Meta's Muse artwork,
  so the public icons are drawn here from shapes; the owner's face stays in web/local.
Usage:
  uv run --python 3.14 --with pillow tools/make_web_icons.py               # public icons
  uv run --python 3.14 --with pillow tools/make_web_icons.py --dry-run
  uv run --python 3.14 --with pillow tools/make_web_icons.py --own web/local/mac_app_icon.png
Pitfalls:
  * "any" icons keep transparent corners around the squircle; the maskable and the Apple
    icon are full-bleed squares, because Android and iOS cut their own shape (the figure
    sits inside the maskable safe zone, the middle 80 %).
  * --own expects a square picture whose content may sit inside a transparent margin (a
    macOS app icon); the margin is cropped by its alpha before scaling.
  * Never write --own output anywhere but web/local (ignored by git and Vercel);
    tools/check_private.py refuses pictures in web/ outside web/icons/.
"""
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
WEB = HERE.parent / "web"
PUBLIC = WEB / "icons"
OWN = WEB / "local" / "icons"
SCALE = 4  # supersampling for clean edges

BACKGROUND = (28, 28, 30)
BODY = (199, 199, 204)
SHADE = (174, 174, 178)
EYES = (28, 28, 30)

# name: (size, full bleed, share of the size the figure's body diameter takes)
ICONS = {
    "icon-192.png": (192, False, 0.50),
    "icon-512.png": (512, False, 0.50),
    "icon-maskable-512.png": (512, True, 0.42),
    "apple-touch-icon.png": (180, True, 0.50),
}


def squircle_mask(size: int, inset: float, radius: float) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    a = round(size * inset)
    ImageDraw.Draw(mask).rounded_rectangle((a, a, size - 1 - a, size - 1 - a), radius=round(size * radius), fill=255)
    return mask


def neutral_icon(size: int, bleed: bool, share: float) -> Image.Image:
    s = size * SCALE
    art = Image.new("RGBA", (s, s), BACKGROUND + (255,))
    d = ImageDraw.Draw(art)
    r = s * share / 2
    cx, cy = s / 2, s * 0.52
    box = (cx - r, cy - r, cx + r, cy + r)
    d.ellipse(box, fill=BODY)
    d.chord(box, 20, 160, fill=SHADE)  # the darker lower half, as in figure.js
    ex, ey, er = r * 0.34, cy - r * 0.12, r * 0.09
    for sx in (-1, 1):
        x = cx + sx * ex
        d.ellipse((x - er, ey - er, x + er, ey + er), fill=EYES)
    if not bleed:
        out = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        out.paste(art, (0, 0), squircle_mask(s, 0.06, 0.2))
        art = out
    return art.resize((size, size), Image.LANCZOS)


def own_icon(source: Image.Image, size: int, bleed: bool) -> Image.Image:
    src = source.convert("RGBA")
    bbox = src.getchannel("A").point(lambda v: 255 if v > 200 else 0).getbbox() or (0, 0, *src.size)
    content = src.crop(bbox)
    if not bleed:
        return content.resize((size, size), Image.LANCZOS)
    # Full bleed: the picture's own square, its rounded corners filled with its edge colour.
    s = size * SCALE
    edge = content.getpixel((content.width // 2, 2))
    out = Image.new("RGBA", (s, s), edge[:3] + (255,))
    out.alpha_composite(content.resize((s, s), Image.LANCZOS))
    return out.convert("RGB").resize((size, size), Image.LANCZOS)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--own", type=Path, help="the owner's square app icon; writes web/local/icons/")
    ap.add_argument("--out", type=Path, help="write here instead (default web/icons, or web/local/icons with --own)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    out_dir = args.out or (OWN if args.own else PUBLIC)
    source = Image.open(args.own) if args.own else None
    if not args.dry_run:
        out_dir.mkdir(parents=True, exist_ok=True)
    for name, (size, bleed, share) in ICONS.items():
        target = out_dir / name
        if args.dry_run:
            print(f"would write {target} ({size} px)")
            continue
        image = own_icon(source, size, bleed) if source else neutral_icon(size, bleed, share)
        if bleed:
            image = image.convert("RGB")
        image.save(target, optimize=True)
        print(f"{target}  {size} px, {target.stat().st_size // 1024} KiB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
