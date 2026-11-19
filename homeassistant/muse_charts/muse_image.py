#!/usr/bin/env python3
"""Ingest a PNG or JPEG from Home Assistant and write a Muse-sized copy.

What: decodes a base64 image or data URI, checks the PNG/JPEG magic and the pixel
  size, resizes with LANCZOS to one of the four Muse targets (contain or cover),
  writes it atomically below ``/config/www/muse_images`` and prints the same JSON
  answer as ``muse_chart.py``. Home Assistant's webhook automation calls it
  through ``shell_command.muse_image_ingest``.
Why: the box downloads pictures itself; a phone screenshot, a camera snapshot or
  a chart from another tool first needs one predictable size and one cache-busted
  URL. Doing it here keeps the box firmware and the browser free of image code.
Pitfalls:
  * The input is capped at 100000 base64 characters; the webhook automation
    enforces the same cap before it renders this command.
  * Only PNG and JPEG are accepted. GIF, WebP, SVG and PDF are refused by magic,
    not by a client-provided MIME type or file name.
  * The client's ``name`` is a slug, never a path: ``../../x`` becomes ``x`` and
    the file always ends in ``.png``.
  * Transparency is composited on the chart's dark background; RGB565 on the box
    has no alpha, and a transparent PNG would otherwise turn black there.

Usage:
  python3 muse_image.py --image-b64 "$B64" --name doorbell --target box --mode contain
  python3 muse_image.py --image-b64 "data:image/png;base64,..." --name photo --target square_hq --mode cover
"""

from __future__ import annotations

import argparse
import base64
import binascii
import re
from io import BytesIO

from PIL import Image, ImageOps, UnidentifiedImageError

import common

MAX_B64 = 100_000
MAX_PIXELS = 25_000_000
MAX_SIDE = 8192
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
JPEG_MAGIC = b"\xff\xd8\xff"

# A small bomb guard before Pillow's default (about 89 million pixels): a
# 100000-character upload cannot legitimately be a 100-megapixel picture.
Image.MAX_IMAGE_PIXELS = MAX_PIXELS


def decode_image(image_b64: object) -> Image.Image:
    """Decode and validate a base64 PNG/JPEG, returning a loaded Pillow image."""
    raw = str(image_b64 or "").strip()
    if not raw:
        raise common.MuseError("--image-b64 is empty")
    if len(raw) > MAX_B64 + 256:
        raise common.MuseError(f"image is larger than {MAX_B64} base64 characters")
    if raw[:5].lower() == "data:":
        header, separator, payload = raw.partition(",")
        if not separator or ";base64" not in header.lower():
            raise common.MuseError("data URI must be base64 encoded")
        if not re.match(r"^data:image/(png|jpe?g);base64$", header.strip(), re.IGNORECASE):
            raise common.MuseError("data URI must be image/png or image/jpeg")
        raw = payload
    raw = "".join(raw.split())
    if not raw:
        raise common.MuseError("image is empty after the data URI")
    if len(raw) > MAX_B64:
        raise common.MuseError(f"image is larger than {MAX_B64} base64 characters")
    try:
        data = base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError) as error:
        raise common.MuseError(f"image is not valid base64: {error}") from None
    if data.startswith(PNG_MAGIC):
        expected = "PNG"
    elif data.startswith(JPEG_MAGIC):
        expected = "JPEG"
    else:
        raise common.MuseError("image is neither PNG nor JPEG")
    try:
        image = Image.open(BytesIO(data))
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
        raise common.MuseError(f"image cannot be decoded: {error}") from None
    if image.format != expected:
        raise common.MuseError(f"image says {expected} but decodes as {image.format}")
    width, height = image.size
    if width < 1 or height < 1:
        raise common.MuseError("image has no pixels")
    if max(width, height) > MAX_SIDE or width * height > MAX_PIXELS:
        raise common.MuseError(
            f"image is too large: {width}x{height}; at most {MAX_SIDE} px per side and {MAX_PIXELS} pixels"
        )
    try:
        image.load()
    except (OSError, Image.DecompressionBombError) as error:
        raise common.MuseError(f"image cannot be decoded: {error}") from None
    try:
        image = ImageOps.exif_transpose(image)
    except (OSError, ValueError, SyntaxError):
        pass
    if common.image_has_alpha(image):
        image = image.convert("RGBA")
        canvas = Image.new("RGBA", image.size, (*common.BG, 255))
        canvas.alpha_composite(image)
        image = canvas.convert("RGB")
    else:
        image = image.convert("RGB")
    return image


def fit_image(image: Image.Image, target: str, mode: str) -> Image.Image:
    """Contain (pad with the dark background) or cover (crop) at the target size."""
    width, height = common.target_size(target)
    if mode == "cover":
        return ImageOps.fit(image, (width, height), Image.Resampling.LANCZOS, centering=(0.5, 0.5))
    resized = ImageOps.contain(image, (width, height), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (width, height), common.BG)
    canvas.paste(resized, ((width - resized.width) // 2, (height - resized.height) // 2))
    return canvas


def build_parser() -> argparse.ArgumentParser:
    parser = common.JsonArgumentParser(description="Ingest a base64 PNG/JPEG for the Muse display.")
    parser.add_argument("--image-b64", required=True, help="base64 image bytes or an image data URI")
    parser.add_argument("--name", default="muse-image", help="file slug and answer title (no path)")
    parser.add_argument("--target", default="box", help="output size: " + ", ".join(common.TARGETS))
    parser.add_argument("--mode", default="contain", help="contain (fit and pad) or cover (crop)")
    parser.add_argument("--output-dir", default=None,
                        help="target folder (default: /config/www/muse_images or MUSE_IMAGE_DIR)")
    parser.add_argument("--base-url", default=None,
                        help=f"Home Assistant base URL for the answer (default: {common.DEFAULT_BASE_URL})")
    return parser


def main(argv: list[str] | None = None) -> int:
    def run() -> int:
        args = build_parser().parse_args(argv)
        target = str(args.target or "box").strip().lower()
        mode = str(args.mode or "contain").strip().lower()
        if mode not in ("contain", "cover"):
            raise common.MuseError(f"mode must be contain or cover, not '{args.mode}'")
        common.target_size(target)
        image = decode_image(args.image_b64)
        result = fit_image(image, target, mode)
        data = common.png_bytes(result)
        directory = common.output_dir(args.output_dir)
        title = common.clean_text(args.name, 80) or "muse-image"
        # The target is part of the file name: the same picture may be ingested
        # for the box and for the 2x camera layout without one replacing the other.
        slug = f"{common.slugify(title, 'muse-image')}-{target}"
        path = directory / f"{slug}.png"
        common.atomic_write(path, data)
        common.emit({
            "ok": True,
            "url": common.public_url(directory, slug, common.version_of(data), args.base_url),
            "width": result.width,
            "height": result.height,
            "bytes": len(data),
            "title": title,
        })
        return 0

    return common.main_guard(run)


if __name__ == "__main__":
    raise SystemExit(main())
