#!/usr/bin/env python3
"""Draws the Home Assistant add-on icon and logo from the project's own figure.

What: writes homeassistant/addon/muse-web-screen/icon.png (128 x 128) and logo.png
(250 x 100). The icon is the neutral pose on its black background with macOS-like rounded
corners; the logo puts the same icon beside the name on a dark blue gradient. With
--out DIR --title Muse --subtitle "Apple Screen" --badge play the same family covers the
Muse Apple Screen camera add-on. The figure is the project's generated character
(tools/figure_source/neutral.png), not Meta's Muse artwork, so both files are safe to commit.

Why: Home Assistant shows the add-on in the add-on store and on its page. The plain
manifest icon is square and light; a dark icon with the blue figure reads better next to
Home Assistant's own icons.

Pitfalls:
  * Needs Pillow:
      uv run --python 3.14 --with pillow tools/make_addon_icons.py
  * The neutral pose already has the black background and the blue rim light; do not cut
    it out or the glow disappears.
  * The logo text uses Arial Bold from macOS. On another machine, install a bold sans or
    change FONT.
Usage:
  uv run --python 3.14 --with pillow tools/make_addon_icons.py --dry-run
  uv run --python 3.14 --with pillow tools/make_addon_icons.py
  uv run --python 3.14 --with pillow tools/make_addon_icons.py \
    --out ~/Coding/homeassistant/addons/muse_camera \
    --title Muse --subtitle "Apple Screen" --badge play
"""
import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SOURCE = ROOT / "tools" / "figure_source" / "neutral.png"
OUT = ROOT / "homeassistant" / "addon" / "muse-web-screen"
FONT = Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf")

ICON = 128
LOGO_W, LOGO_H = 250, 100
RADIUS = 0.22          # the rounded square of a macOS icon


def rounded(image: Image.Image, radius: float) -> Image.Image:
    """The image with rounded corners, transparent outside."""
    size = image.size
    mask = Image.new("L", (size[0] * 4, size[1] * 4), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, size[0] * 4 - 1, size[1] * 4 - 1), radius=int(min(size) * 4 * radius), fill=255,
    )
    out = image.convert("RGBA")
    out.putalpha(mask.resize(size, Image.LANCZOS))
    return out


def play_badge(icon: Image.Image) -> Image.Image:
    """A small blue play badge in the lower right corner, for the camera add-on."""
    draw = ImageDraw.Draw(icon)
    cx, cy, r = ICON - 25, ICON - 25, 20
    draw.ellipse((cx - r - 2, cy - r - 2, cx + r + 2, cy + r + 2), fill=(255, 255, 255, 255))
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(36, 107, 255, 255))
    draw.polygon([(cx - 6, cy - 9), (cx - 6, cy + 9), (cx + 10, cy)], fill=(255, 255, 255, 255))
    return icon


def make_icon(badge: str) -> Image.Image:
    with Image.open(SOURCE) as im:
        icon = im.convert("RGBA").resize((ICON, ICON), Image.LANCZOS)
    icon = rounded(icon, RADIUS)
    return play_badge(icon) if badge == "play" else icon


def make_logo(icon: Image.Image, title: str, subtitle: str) -> Image.Image:
    logo = Image.new("RGBA", (LOGO_W, LOGO_H), (0, 0, 0, 255))
    draw = ImageDraw.Draw(logo)
    # A dark navy to near-black horizontal gradient, with a blue glow behind the icon.
    for x in range(LOGO_W):
        t = x / (LOGO_W - 1)
        r = round(6 + 4 * (1 - t))
        g = round(10 + 10 * (1 - t))
        b = round(20 + 22 * (1 - t))
        draw.line((x, 0, x, LOGO_H), fill=(r, g, b, 255))
    glow = Image.new("RGBA", (LOGO_W, LOGO_H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse((2, 4, 104, 106), fill=(30, 110, 255, 60))
    logo.alpha_composite(glow)

    icon_size = 84
    small = icon.resize((icon_size, icon_size), Image.LANCZOS)
    logo.alpha_composite(small, (8, (LOGO_H - icon_size) // 2))

    title_font = ImageFont.truetype(str(FONT), 24)
    sub_font = ImageFont.truetype(str(FONT), 13)
    draw.text((104, 27), title, font=title_font, fill=(255, 255, 255, 255))
    draw.text((106, 57), subtitle, font=sub_font, fill=(159, 184, 216, 255))
    return logo


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", type=Path, default=OUT, help="the add-on folder to write into")
    ap.add_argument("--title", default="Muse", help="the first logo line")
    ap.add_argument("--subtitle", default="Web Screen", help="the second logo line")
    ap.add_argument("--badge", choices=("none", "play"), default="none", help="a play badge for the camera add-on")
    ap.add_argument("--dry-run", action="store_true", help="say what would be written")
    a = ap.parse_args()
    if a.dry_run:
        print(f"would write {a.out / 'icon.png'} and {a.out / 'logo.png'} from {SOURCE}")
        return
    a.out.mkdir(parents=True, exist_ok=True)
    icon = make_icon(a.badge)
    icon.save(a.out / "icon.png")
    make_logo(icon, a.title, a.subtitle).convert("RGB").save(a.out / "logo.png")
    print(f"wrote {a.out / 'icon.png'} ({ICON} px) and {a.out / 'logo.png'} ({LOGO_W} x {LOGO_H})")


if __name__ == "__main__":
    main()
