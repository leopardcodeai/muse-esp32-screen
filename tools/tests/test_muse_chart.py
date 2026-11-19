"""Tests for the Home Assistant chart and image scripts (Pillow only, no HA needed).

Run from the project folder:
  uv run --python 3.14 --with pillow --with pytest -m pytest tools/tests/test_muse_chart.py -q
or, with Pillow and pytest already installed:
  python3 -m pytest tools/tests/test_muse_chart.py -q

The scripts are imported, not started as subprocesses, so a failure shows the
Python exception; two tests still run main() to check the JSON and the file.
"""

from __future__ import annotations

import base64
import json
import sys
from io import BytesIO
from pathlib import Path

import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "homeassistant" / "muse_charts"))

import common  # noqa: E402
import muse_chart  # noqa: E402
import muse_image  # noqa: E402

YOGA = {
    "title": "Yoga (bar, box)",
    "labels": "2019,2020,2021,2022,2023,2024,2025,2026",
    "values": "41,31,8,17,26,20,20,18",
    "type": "bar",
    "target": "box",
}


def spec(**changes):
    data = dict(YOGA)
    data.update(changes)
    return muse_chart.parse_spec(data)


def b64_spec(data) -> str:
    return base64.b64encode(json.dumps(data).encode("utf-8")).decode("ascii")


def png_b64(image: Image.Image) -> str:
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def jpeg_b64(image: Image.Image) -> str:
    buffer = BytesIO()
    image.save(buffer, format="JPEG", quality=90)
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def has_colour(image: Image.Image, colour: tuple[int, int, int], minimum: int = 100) -> bool:
    counts = image.convert("RGB").getcolors(maxcolors=image.width * image.height)
    return any(count >= minimum and rgb == colour for count, rgb in (counts or []))


# ------------------------------------------------------------------ charts --


@pytest.mark.parametrize("target,size", sorted(common.TARGETS.items()))
@pytest.mark.parametrize("kind", ["bar", "line"])
def test_chart_target_sizes(target, size, kind):
    image = muse_chart.render_chart(spec(target=target, type=kind))
    assert image.size == size
    assert image.mode == "RGB"


def test_bar_is_blue_and_line_is_orange():
    bar = muse_chart.render_chart(spec(type="bar"))
    line = muse_chart.render_chart(spec(type="line"))
    assert has_colour(bar, common.BLUE)
    assert has_colour(line, common.ORANGE)
    assert not has_colour(line, common.BLUE, minimum=500)


def test_title_is_not_drawn_into_the_png():
    first = muse_chart.render_chart(spec(title="Yoga"))
    second = muse_chart.render_chart(spec(title="Something entirely different"))
    assert common.png_bytes(first) == common.png_bytes(second)


def test_the_value_labels_are_large_enough_to_read():
    image = muse_chart.render_chart(spec(target="box"))
    # 41 is the maximum: 800 weight, about 16 px tall at the box size. Count the
    # near-white pixels in the top-left eighth, where the first value sits.
    crop = image.crop((0, 0, image.width // 4, image.height // 2)).convert("RGB")
    pixels = crop.load()
    white = sum(1 for y in range(crop.height) for x in range(crop.width)
                if min(pixels[x, y]) > 220)
    assert white > 40


@pytest.mark.parametrize(
    "change,message",
    [
        ({"labels": "2019,2020", "values": "41"}, "differ"),
        ({"values": "41,31,x,17,26,20,20,18"}, "not a number"),
        ({"values": "41,31,8,17,26,20,20,"}, "empty entry"),
        ({"labels": "", "values": ""}, "empty entry"),
        ({"type": "pie"}, "bar or line"),
        ({"target": "poster"}, "unknown target"),
        ({"title": ""}, "title is required"),
        ({"values": "41,31,8,17,26,20,20,nan"}, "not finite"),
    ],
)
def test_invalid_specs_name_the_problem(change, message):
    with pytest.raises(common.MuseError, match=message):
        spec(**change)


def test_too_many_points_are_refused():
    labels = ",".join(str(2000 + i) for i in range(25))
    values = ",".join("1" for _ in range(25))
    with pytest.raises(common.MuseError, match="at most 24"):
        spec(labels=labels, values=values)


def test_cli_writes_a_versioned_png_and_prints_json(tmp_path, capsys):
    code = muse_chart.main(["--spec-b64", b64_spec(YOGA), "--output-dir", str(tmp_path)])
    assert code == 0
    answer = json.loads(capsys.readouterr().out)
    assert answer["ok"] is True
    assert answer["width"] == 300 and answer["height"] == 168
    assert answer["bytes"] > 0 and answer["title"] == YOGA["title"]
    assert answer["url"].endswith("/yoga-bar-box.png?v=" + common.version_of(
        (tmp_path / "yoga-bar-box.png").read_bytes()))
    assert answer["url"].startswith(common.DEFAULT_BASE_URL + "/local/")
    written = tmp_path / "yoga-bar-box.png"
    assert written.is_file()
    with Image.open(written) as image:
        assert image.size == (300, 168)


def test_cli_error_is_json_and_exit_1(tmp_path, capsys):
    bad = base64.b64encode(b'{"title":"X","labels":"a,b","values":"1","type":"bar"}').decode()
    code = muse_chart.main(["--spec-b64", bad, "--output-dir", str(tmp_path)])
    assert code == 1
    answer = json.loads(capsys.readouterr().out)
    assert answer["ok"] is False
    assert "differ" in answer["error"]
    assert not list(tmp_path.glob("*.png"))


def test_bad_base64_and_bad_json_are_refused():
    with pytest.raises(common.MuseError, match="valid base64"):
        muse_chart.decode_spec("not base64!")
    with pytest.raises(common.MuseError, match="valid JSON"):
        muse_chart.decode_spec(base64.b64encode(b"{not json").decode())


def test_spec_can_come_as_arrays_too():
    # Home Assistant's native template parsing turns "2019,2020" into a tuple
    # of ints before tojson, so the script must accept arrays as well.
    parsed = muse_chart.parse_spec({"title": "T", "labels": [2019, 2020], "values": [1, 2],
                                    "type": "line", "target": "square"})
    assert parsed.labels == ["2019", "2020"] and parsed.values == [1.0, 2.0]


def test_one_bare_numeric_label_and_value():
    parsed = muse_chart.parse_spec({"title": "T", "labels": 2026, "values": 41})
    assert parsed.labels == ["2026"] and parsed.values == [41.0]


# ------------------------------------------------------------------ images --


def test_ingest_png_contain_pads_with_the_dark_background(tmp_path, capsys):
    source = Image.new("RGB", (100, 100), (220, 40, 40))
    code = muse_image.main(["--image-b64", png_b64(source), "--name", "square-image",
                            "--target", "box", "--mode", "contain", "--output-dir", str(tmp_path)])
    assert code == 0
    answer = json.loads(capsys.readouterr().out)
    assert answer["ok"] is True and answer["width"] == 300 and answer["height"] == 168
    written = tmp_path / "square-image-box.png"
    assert written.is_file()
    with Image.open(written) as image:
        assert image.size == (300, 168)
        assert image.getpixel((0, 0)) == common.BG
        assert image.getpixel((150, 84)) == (220, 40, 40)


def test_ingest_jpeg_cover_fills_the_target(tmp_path, capsys):
    source = Image.new("RGB", (100, 100), (20, 180, 90))
    code = muse_image.main(["--image-b64", jpeg_b64(source), "--name", "cover-image",
                            "--target", "square", "--mode", "cover", "--output-dir", str(tmp_path)])
    assert code == 0
    answer = json.loads(capsys.readouterr().out)
    assert answer["ok"] is True and answer["width"] == 432 and answer["height"] == 280
    with Image.open(tmp_path / "cover-image-square.png") as image:
        # LANCZOS + JPEG ringing: allow a few points around the green, but no
        # letterbox in the corner.
        r, g, b = image.getpixel((2, 2))
        assert g > 150 and r < 80 and b < 120


def test_data_uri_is_stripped(tmp_path):
    source = Image.new("RGB", (60, 30), (10, 10, 200))
    data = "data:image/png;base64," + png_b64(source)
    image = muse_image.decode_image(data)
    assert image.size == (60, 30)


def test_client_name_cannot_escape_the_output_folder(tmp_path, capsys):
    source = Image.new("RGB", (10, 10), (1, 2, 3))
    code = muse_image.main(["--image-b64", png_b64(source), "--name", "../../evil",
                            "--target", "box", "--output-dir", str(tmp_path)])
    assert code == 0
    answer = json.loads(capsys.readouterr().out)
    assert answer["ok"] is True
    assert (tmp_path / "evil-box.png").is_file()
    assert not (tmp_path.parent / "evil-box.png").exists()


def test_ingest_rejects_a_non_image():
    with pytest.raises(common.MuseError, match="neither PNG nor JPEG"):
        muse_image.decode_image(base64.b64encode(b"GIF89a not an image").decode())


def test_ingest_caps_the_base64_input():
    with pytest.raises(common.MuseError, match="100000"):
        muse_image.decode_image("A" * 100_001)


def test_ingest_rejects_an_oversized_picture():
    source = Image.new("RGB", (9000, 1), (0, 0, 0))
    with pytest.raises(common.MuseError, match="too large"):
        muse_image.decode_image(png_b64(source))


def test_ingest_rejects_a_bad_data_uri():
    with pytest.raises(common.MuseError, match="image/png or image/jpeg"):
        muse_image.decode_image("data:image/gif;base64,R0lGODlhAQABAAAAACw=")


def test_fit_image_uses_the_named_target():
    source = Image.new("RGB", (400, 200), (200, 200, 200))
    for target, size in common.TARGETS.items():
        result = muse_image.fit_image(source, target, "cover")
        assert result.size == size


def test_slugify_is_safe_and_readable():
    assert common.slugify("Yoga 2019–2026") == "yoga-2019-2026"
    assert common.slugify("../../etc/passwd") == "etc-passwd"
    assert common.slugify("") == "muse-image"
    assert common.slugify("Größe / Straße") == "grosse-strasse"


def test_number_format_is_german_and_short():
    assert common.format_number(41) == "41"
    assert common.format_number(8.5) == "8,5"
    assert common.format_number(12000) == "12k"
    assert common.format_number(1_500_000) == "1,5M"
