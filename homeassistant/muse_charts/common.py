"""Shared helpers for the Muse chart and image scripts.

What: the small toolkit both scripts use: the dark palette, the target sizes, the
  Inter font loader, a slug for the file name, an atomic write, the versioned
  ``/local`` URL and the JSON answer Home Assistant reads from stdout.
Why: Home Assistant calls the scripts through ``shell_command``; the process must
  never leave a half-written PNG in ``/config/www`` and must always print exactly
  one JSON object, even when it fails.
Pitfalls:
  * The font files sit in ``fonts/`` next to this file and are copied with the
    scripts. Without them the loader falls back to a system font, which changes
    the metrics but never stops a chart.
  * The output directory is created on demand. A path outside ``/config/www``
    cannot be served by Home Assistant; the URL then uses the directory's name
    under ``/local/``, which is a hint, not a promise.
  * ``?v=`` is the first ten hex digits of the PNG's SHA-256. Home Assistant's
    ``/local`` view caches for 31 days, so the same URL must mean the same bytes.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
import unicodedata
from functools import lru_cache
from io import BytesIO
from pathlib import Path
from typing import Iterable
from urllib.parse import quote

from PIL import Image, ImageFont

# The dark chart palette (docs and the HA script name the same values).
BG = (0x14, 0x16, 0x1C)
GRID = (0x2A, 0x2F, 0x3A)
BLUE = (0x4D, 0xA3, 0xFF)
ORANGE = (0xFF, 0x9F, 0x0A)
GREEN = (0x30, 0xD1, 0x58)
TEXT = (0xF5, 0xF7, 0xFA)
SUB = (0x9F, 0xB0, 0xC8)
WHITE = (0xFF, 0xFF, 0xFF)

# The panel sizes: the box's picture area, the square web/Mosaico card, its 2x
# source for the 1280x720 camera/Apple TV layout, and that layout itself.
TARGETS = {
    "box": (300, 168),
    "square": (432, 280),
    "square_hq": (864, 560),
    "wide": (1280, 720),
}

DEFAULT_OUTPUT_DIR = Path("/config/www/muse_images")
DEFAULT_BASE_URL = "http://homeassistant.local:8123"
FONT_DIR = Path(__file__).resolve().parent / "fonts"
FONT_WEIGHTS = (500, 700, 800)
MAX_TITLE = 200
MAX_LABEL = 120
MAX_POINTS = 24

# The system fonts used only when fonts/ is missing (a source checkout without
# the copied TTFs). DejaVu is in most Home Assistant and Linux images; Arial and
# Helvetica are on macOS.
_FALLBACK_FONTS = {
    500: (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/dejavu/DejaVuSans.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/Library/Fonts/Arial.ttf",
    ),
    700: (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/Library/Fonts/Arial Bold.ttf",
    ),
    800: (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/Library/Fonts/Arial Bold.ttf",
    ),
}


class MuseError(ValueError):
    """A bad request that the scripts report as JSON and exit 1."""


class JsonArgumentParser(argparse.ArgumentParser):
    """An ArgumentParser whose usage errors become one JSON line, not a traceback."""

    def error(self, message: str) -> None:
        raise MuseError(message)


def slugify(text: object, fallback: str = "muse-image") -> str:
    """A file-name-safe slug: lower-case ASCII letters, digits and single hyphens.

    German umlauts become their base letter (ä -> a), ß becomes ss, everything
    else is dropped. No slash, dot or quote survives, so a client name can never
    climb out of the output directory.
    """
    raw = (str(text or "").replace("ß", "ss").replace("ẞ", "SS")
           .replace("–", "-").replace("—", "-").replace("−", "-"))
    raw = unicodedata.normalize("NFKD", raw)
    raw = raw.encode("ascii", "ignore").decode("ascii").lower()
    raw = re.sub(r"[^a-z0-9]+", "-", raw)
    raw = re.sub(r"-{2,}", "-", raw).strip("-")
    if len(raw) > 60:
        raw = raw[:60].rstrip("-")
    return raw or fallback


def clean_text(value: object, limit: int) -> str:
    """One line of text with collapsed whitespace, capped without splitting a word."""
    text = " ".join(str(value or "").replace("\r", " ").replace("\n", " ").split())
    if len(text) > limit:
        cut = text[:limit].rsplit(" ", 1)[0].rstrip(" ,.;:-")
        text = (cut or text[:limit]).rstrip() + "…"
    return text


def target_size(target: str) -> tuple[int, int]:
    """The pixel size of a target name, or MuseError with the allowed names."""
    key = str(target or "box").strip().lower()
    if key not in TARGETS:
        allowed = ", ".join(TARGETS)
        raise MuseError(f"unknown target '{target}'; use {allowed}")
    return TARGETS[key]


@lru_cache(maxsize=64)
def font(size: int, weight: int = 500) -> ImageFont.FreeTypeFont:
    """Inter at a pixel size, cached. Falls back to a system font, then Pillow's."""
    size = max(6, int(round(size)))
    if weight <= 500:
        weight = 500
    elif weight <= 700:
        weight = 700
    else:
        weight = 800
    bundled = FONT_DIR / f"Inter-{weight}.ttf"
    candidates: Iterable[Path | str] = (bundled, *_FALLBACK_FONTS[weight])
    for candidate in candidates:
        try:
            if Path(candidate).is_file():
                return ImageFont.truetype(str(candidate), size)
        except OSError:
            continue
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # Pillow before 10.1
        return ImageFont.load_default()


def text_width(draw, text: str, font_obj: ImageFont.FreeTypeFont) -> int:
    """The inked width of a text, independent of its left side bearing."""
    box = draw.textbbox((0, 0), text, font=font_obj)
    return max(0, box[2] - box[0])


def fit_text(draw, text: str, font_obj: ImageFont.FreeTypeFont, max_width: float) -> str:
    """The longest beginning of text that fits, with an ellipsis when cut."""
    text = str(text)
    if max_width <= 0 or not text:
        return ""
    if text_width(draw, text, font_obj) <= max_width:
        return text
    ellipsis = "…"
    if text_width(draw, ellipsis, font_obj) > max_width:
        return ""
    low, high = 0, len(text)
    while low < high:
        middle = (low + high + 1) // 2
        candidate = text[:middle].rstrip() + ellipsis
        if text_width(draw, candidate, font_obj) <= max_width:
            low = middle
        else:
            high = middle - 1
    return (text[:low].rstrip() + ellipsis) if low else ellipsis


def _one_decimal(value: float) -> str:
    """One decimal with a German comma, without a trailing ,0 or a bare minus."""
    text = f"{value:.1f}".replace(".", ",")
    if "," in text:
        text = text.rstrip("0").rstrip(",")
    if text in ("", "-", "-0"):
        text = "0"
    return text


def format_number(value: float) -> str:
    """A short label for a value: integers without a dot, decimals with a comma."""
    if abs(value) >= 1_000_000:
        return _one_decimal(value / 1_000_000) + "M"
    if abs(value) >= 10_000:
        return _one_decimal(value / 1_000) + "k"
    if float(value).is_integer():
        return str(int(value))
    return _one_decimal(value)


def png_bytes(image: Image.Image) -> bytes:
    """Encode an image as PNG once, so size and hash describe the written bytes."""
    buffer = BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def atomic_write(path: Path, data: bytes) -> None:
    """Write bytes to path in one os.replace, fsynced, with mode 0644."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, 0o644)
        os.replace(temporary, path)
    except BaseException:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise


def version_of(data: bytes) -> str:
    """The cache-busting part: the first ten hex digits of the content hash."""
    return hashlib.sha256(data).hexdigest()[:10]


def output_dir(value: str | os.PathLike[str] | None = None) -> Path:
    """The output directory from --output-dir, MUSE_IMAGE_DIR or the HA default."""
    chosen = value or os.environ.get("MUSE_IMAGE_DIR") or DEFAULT_OUTPUT_DIR
    return Path(chosen).expanduser()


def base_url(value: str | None = None) -> str:
    """The Home Assistant base URL from --base-url, MUSE_IMAGE_BASE_URL or the default."""
    chosen = value or os.environ.get("MUSE_IMAGE_BASE_URL") or DEFAULT_BASE_URL
    return str(chosen).rstrip("/")


def public_url(directory: Path, slug: str, version: str, root: str | None = None) -> str:
    """The absolute ``/local`` URL of a written file, always with ``?v=``.

    Home Assistant serves /config/www as /local. A directory outside /config/www
    is labelled with its last name; that keeps the answer useful for tests while
    the README says that only /config/www is reachable.
    """
    directory = Path(directory)
    try:
        relative = directory.resolve().relative_to(Path("/config/www").resolve())
        prefix = "/local" if relative == Path(".") else f"/local/{relative.as_posix()}"
    except ValueError:
        prefix = f"/local/{directory.name}"
    return f"{base_url(root)}{prefix}/{quote(slug)}.png?v={version}"


def emit(payload: dict) -> None:
    """Print the one JSON object Home Assistant parses; keep stdout clean."""
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), flush=True)


def fail(message: object) -> int:
    """Print ``{ok: false, error}`` and return the process exit code 1."""
    emit({"ok": False, "error": str(message)})
    return 1


def main_guard(handler) -> int:
    """Run a script's handler, turning every exception into one JSON error line."""
    try:
        return int(handler())
    except MuseError as error:
        return fail(error)
    except KeyboardInterrupt:
        return fail("interrupted")
    except Exception as error:  # noqa: BLE001 - the shell must always get JSON
        if os.environ.get("MUSE_DEBUG"):
            import traceback

            traceback.print_exc(file=sys.stderr)
        return fail(f"{type(error).__name__}: {error}")


def image_has_alpha(image: Image.Image) -> bool:
    """Whether the image carries transparency that a PNG can keep."""
    return image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info)
