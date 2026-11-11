#!/usr/bin/env python3
"""Render a small, readable chart for the Muse display from a base64 JSON spec.

What: turns ``{title, labels, values, type, target}`` into a dark PNG with large
  value numbers above the bars or points, a subtle grid, the years or categories
  below, and no title inside the picture (the image card shows the HA title
  itself). Home Assistant calls it through ``shell_command.muse_chart_render``;
  the agent can call it directly on the Mac.
Why: matplotlib is not in the Home Assistant container and adds a large
  dependency; Pillow is already there. A chart drawn here is one deterministic
  file, one JSON answer and one cache-busted URL, with no add-on to install.
Pitfalls:
  * The spec arrives as base64 because the shell_command template splits its
    arguments with shlex; a JSON string with spaces and quotes would not survive.
  * Values are drawn from zero, not from a compressed min-max range, so a small
    change does not look dramatic. The one exception is a negative series, whose
    zero line sits inside the plot.
  * The PNG must not duplicate the title: the box's image card, the web twin and
    the camera layout draw the title from the action's ``title`` field.
  * A failed render still prints one JSON object and exits 1; Home Assistant then
    shows "Keine Daten" instead of an empty picture.

Usage:
  python3 muse_chart.py --spec-b64 "$(printf '%s' '{"title":"Yoga","labels":"2019,2020","values":"41,31","type":"bar","target":"box"}' | base64)"
  python3 muse_chart.py --spec-b64 ... --output-dir /config/www/muse_images --base-url http://homeassistant.local:8123
"""

from __future__ import annotations

import argparse
import base64
import binascii
import json
import math
from dataclasses import dataclass

from PIL import Image, ImageDraw

import common

MAX_SPEC_B64 = 20_000
MAX_SPEC_JSON = 12_000


@dataclass(frozen=True)
class ChartSpec:
    """A validated chart request."""

    title: str
    labels: list[str]
    values: list[float]
    values2: list[float] | None
    kind: str
    target: str


def _as_list(value: object, field: str) -> list[str]:
    """Accept the documented comma string, a JSON array and one bare scalar.

    Home Assistant's template renderer turns a numeric comma string such as
    "2019,2020" into a Python tuple before it reaches ``tojson``; a single
    numeric label or value arrives as a number. Both are valid here.
    """
    if isinstance(value, (list, tuple)):
        items = [str(item).strip() for item in value]
    elif isinstance(value, str):
        items = [item.strip() for item in value.split(",")]
    elif isinstance(value, (int, float)) and not isinstance(value, bool):
        items = [str(value)]
    else:
        raise common.MuseError(f"{field} must be a comma-separated string")
    if any(not item for item in items):
        raise common.MuseError(f"{field} contains an empty entry")
    return items


def parse_spec(raw: object) -> ChartSpec:
    """Validate the decoded JSON and return a ChartSpec, or raise MuseError."""
    if not isinstance(raw, dict):
        raise common.MuseError("the spec must be a JSON object")
    title = common.clean_text(raw.get("title"), common.MAX_TITLE)
    if not title:
        raise common.MuseError("title is required")
    labels = _as_list(raw.get("labels"), "labels")
    values_raw = _as_list(raw.get("values"), "values")
    if not labels:
        raise common.MuseError("labels is empty")
    if len(labels) > common.MAX_POINTS:
        raise common.MuseError(f"at most {common.MAX_POINTS} labels are supported")
    for index, label in enumerate(labels, start=1):
        if len(label) > common.MAX_LABEL:
            raise common.MuseError(f"label {index} is longer than {common.MAX_LABEL} characters")
    if len(labels) != len(values_raw):
        raise common.MuseError(f"labels and values differ: {len(labels)} labels, {len(values_raw)} values")
    values: list[float] = []
    for index, item in enumerate(values_raw, start=1):
        try:
            number = float(item)
        except (TypeError, ValueError):
            raise common.MuseError(f"value {index} is not a number: '{item}'") from None
        if not math.isfinite(number):
            raise common.MuseError(f"value {index} is not finite: '{item}'")
        if abs(number) > 1_000_000_000_000:
            raise common.MuseError(f"value {index} is out of range: '{item}'")
        values.append(number)
    values2: list[float] | None = None
    if raw.get("values2") not in (None, ""):
        values2_raw = _as_list(raw.get("values2"), "values2")
        if len(values2_raw) != len(labels):
            raise common.MuseError(f"labels and values2 differ: {len(labels)} labels, {len(values2_raw)} values")
        values2 = []
        for index, item in enumerate(values2_raw, start=1):
            try:
                number = float(item)
            except (TypeError, ValueError):
                raise common.MuseError(f"value2 {index} is not a number: '{item}'") from None
            if not math.isfinite(number):
                raise common.MuseError(f"value2 {index} is not finite: '{item}'")
            values2.append(number)
    kind = str(raw.get("type") or "bar").strip().lower()
    if kind not in ("bar", "line"):
        raise common.MuseError(f"type must be bar or line, not '{raw.get('type')}'")
    target = str(raw.get("target") or "box").strip().lower()
    common.target_size(target)  # raises with the allowed names
    return ChartSpec(title=title, labels=labels, values=values, values2=values2, kind=kind, target=target)


def decode_spec(spec_b64: str) -> ChartSpec:
    """Decode the base64 JSON with strict limits before parsing it."""
    text = "".join(str(spec_b64 or "").split())
    if not text:
        raise common.MuseError("--spec-b64 is empty")
    if len(text) > MAX_SPEC_B64:
        raise common.MuseError(f"spec is larger than {MAX_SPEC_B64} base64 characters")
    try:
        data = base64.b64decode(text, validate=True)
    except (binascii.Error, ValueError) as error:
        raise common.MuseError(f"spec is not valid base64: {error}") from None
    if len(data) > MAX_SPEC_JSON:
        raise common.MuseError(f"spec is larger than {MAX_SPEC_JSON} bytes")
    try:
        raw = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise common.MuseError(f"spec is not valid JSON: {error}") from None
    return parse_spec(raw)


def _value_span(values: list[float]) -> tuple[float, float]:
    """The y range, always including zero, with a little headroom above the data."""
    low = min(0.0, min(values))
    high = max(0.0, max(values))
    if high == low:
        high = low + 1.0
    span = high - low
    if max(values) > 0:
        high += span * 0.10
    if min(values) < 0:
        low -= span * 0.10
    if not math.isfinite(high - low) or high == low:
        raise common.MuseError("values leave no room for a chart")
    return low, high


def _blend(a: tuple[int, int, int], b: tuple[int, int, int], amount: float) -> tuple[int, int, int]:
    """A flat colour between a and b, for the line's translucent-looking area."""
    return tuple(round(a[i] + (b[i] - a[i]) * amount) for i in range(3))


def render_chart(spec: ChartSpec, size: tuple[int, int] | None = None) -> Image.Image:
    """Draw the chart at the target size; the title is deliberately not drawn."""
    width, height = size or common.target_size(spec.target)
    image = Image.new("RGB", (width, height), common.BG)
    draw = ImageDraw.Draw(image)

    # One unit is the box's 300x168 scale; the wide layout stops at 3.2 so the
    # type does not become billboard-sized on a 1280x720 picture.
    unit = min(width / 300.0, height / 168.0, 3.2)
    value_size = round(14 * unit)
    label_size = round(11 * unit)
    value_font = common.font(value_size, 700)
    value_font_max = common.font(round(15 * unit), 800)
    label_font = common.font(label_size, 500)
    grid_width = max(1, round(1 * unit))

    left = round(12 * unit)
    right = width - round(12 * unit)
    plot_width = max(1, right - left)
    label_baseline = height - round(10 * unit)
    plot_bottom = label_baseline - label_size - round(6 * unit)

    low, high = _value_span(spec.values + (spec.values2 or []))
    if spec.kind == "bar" and min(spec.values) < 0:
        # Negative bars need room for a value label below their end.
        plot_bottom -= value_size + round(5 * unit)
    plot_top = round(8 * unit) + value_size
    plot_height = max(1, plot_bottom - plot_top)
    if plot_height < value_size * 2:
        raise common.MuseError("target is too small for a chart")

    def y_of(value: float) -> float:
        return plot_bottom - (value - low) / (high - low) * plot_height

    zero_y = y_of(0.0)
    count = len(spec.values)
    slot = plot_width / count
    bar_width = max(2.0, min(slot * 0.58, 60 * unit))

    # The grid: three interior lines and a brighter zero line.
    for step in range(1, 4):
        grid_y = round(plot_top + plot_height * step / 4)
        draw.line((left, grid_y, right, grid_y), fill=common.GRID, width=grid_width)
    zero_line = round(zero_y)
    draw.line((left, zero_line, right, zero_line), fill=(54, 62, 78), width=grid_width)

    centers = [left + slot * (index + 0.5) for index in range(count)]

    if spec.kind == "bar":
        for index, value in enumerate(spec.values):
            center = centers[index]
            x0 = round(center - bar_width / 2)
            x1 = round(center + bar_width / 2)
            value_y = y_of(value)
            top = min(value_y, zero_y)
            bottom = max(value_y, zero_y)
            if bottom - top < max(1.5, 1.2 * unit):
                if value >= 0:
                    top = zero_y - max(1.5, 1.2 * unit)
                else:
                    bottom = zero_y + max(1.5, 1.2 * unit)
            radius = max(1, round(2 * unit))
            corners = (True, True, False, False) if value >= 0 else (False, False, True, True)
            draw.rounded_rectangle((x0, round(top), x1, round(bottom)), radius=radius,
                                   fill=common.BLUE, corners=corners)
    else:
        series = [(spec.values, common.ORANGE if spec.values2 is None else common.BLUE, "Hoch")]
        if spec.values2 is not None:
            series.append((spec.values2, common.GREEN, "Tief"))
        line_width = max(2, round(2.2 * unit))
        dot_radius = max(2, round(2.2 * unit))
        for values, color, _ in series:
            points = [(centers[index], y_of(value)) for index, value in enumerate(values)]
            if count > 1:
                area = points + [(points[-1][0], zero_y), (points[0][0], zero_y)]
                draw.polygon(area, fill=_blend(common.BG, color, 0.10))
                draw.line(points, fill=color, width=line_width, joint="curve")
            for x, y in points:
                draw.ellipse((x - dot_radius, y - dot_radius, x + dot_radius, y + dot_radius), fill=color)
        if spec.values2 is not None:
            legend_x = width - round(58 * unit)
            legend_y = round(3 * unit)
            for index, (_, color, name) in enumerate(series):
                y = legend_y + index * round(12 * unit)
                draw.line((legend_x, y, legend_x + round(10 * unit), y), fill=color, width=line_width)
                draw.text((legend_x + round(14 * unit), y), name, font=label_font, fill=common.SUB, anchor="lm")

    # Value labels: every value up to twelve points, then only the ends, the
    # maximum and the minimum. The maximum gets the heavier weight.
    if count <= 12:
        value_indices = set(range(count))
    else:
        value_indices = {0, count - 1, spec.values.index(max(spec.values)),
                         spec.values.index(min(spec.values))}
    gap = round(4 * unit)
    label_series = [(spec.values, True)]
    if spec.kind != "bar" and spec.values2 is not None:
        label_series.append((spec.values2, False))
    for values, above in label_series:
        for index in sorted(value_indices):
            text = common.format_number(values[index])
            font_obj = value_font_max if values[index] == max(values) else value_font
            x = centers[index]
            if spec.kind == "bar":
                value = values[index]
                if value >= 0:
                    y = y_of(value) - gap
                    anchor = "ms"
                else:
                    y = y_of(value) + gap
                    anchor = "mt"
            else:
                y = y_of(values[index]) + (-gap if above else gap)
                anchor = "ms" if above else "mt"
                # The low line can sit on the zero line; its label then has no
                # room below and moves above the line instead of into the dates.
                if not above and y + value_size > plot_bottom:
                    y = y_of(values[index]) - gap
                    anchor = "ms"
            draw.text((x, y), text, font=font_obj, fill=common.TEXT, anchor=anchor,
                      stroke_width=max(1, round(1.0 * unit)), stroke_fill=common.BG)

    # Category labels below the plot. Short years all fit; long room names get
    # fewer labels rather than eight three-letter stumps. A label wider than the
    # picture is the only one cut with an ellipsis.
    def category_layout(wanted: int):
        if wanted <= 1:
            indices = [0]
        else:
            indices = sorted({round(i * (count - 1) / (wanted - 1)) for i in range(wanted)})
        placements = []
        for index in indices:
            text = spec.labels[index]
            text = common.fit_text(draw, text, label_font, width - 4)
            text_w = common.text_width(draw, text, label_font)
            x = centers[index]
            x = min(max(x, 2 + text_w / 2), width - 2 - text_w / 2)
            placements.append((x, text, text_w))
        placements.sort(key=lambda placement: placement[0])
        for before, after in zip(placements, placements[1:]):
            if after[0] - after[2] / 2 < before[0] + before[2] / 2 + 1:
                return None
        return placements

    wanted = min(count, 8)
    placements = category_layout(wanted)
    while placements is None and wanted > 1:
        wanted -= 1
        placements = category_layout(wanted)
    for x, text, _ in placements or []:
        draw.text((x, label_baseline), text, font=label_font, fill=common.SUB, anchor="ms")

    return image


def build_parser() -> argparse.ArgumentParser:
    parser = common.JsonArgumentParser(description="Render a Muse chart PNG from a base64 JSON spec.")
    parser.add_argument("--spec-b64", required=True, help="base64 of the JSON chart spec")
    parser.add_argument("--output-dir", default=None,
                        help="target folder (default: /config/www/muse_images or MUSE_IMAGE_DIR)")
    parser.add_argument("--base-url", default=None,
                        help=f"Home Assistant base URL for the answer (default: {common.DEFAULT_BASE_URL})")
    return parser


def main(argv: list[str] | None = None) -> int:
    def run() -> int:
        args = build_parser().parse_args(argv)
        spec = decode_spec(args.spec_b64)
        image = render_chart(spec)
        data = common.png_bytes(image)
        directory = common.output_dir(args.output_dir)
        slug = common.slugify(spec.title, "chart")
        path = directory / f"{slug}.png"
        common.atomic_write(path, data)
        common.emit({
            "ok": True,
            "url": common.public_url(directory, slug, common.version_of(data), args.base_url),
            "width": image.width,
            "height": image.height,
            "bytes": len(data),
            "title": spec.title,
        })
        return 0

    return common.main_guard(run)


if __name__ == "__main__":
    raise SystemExit(main())
