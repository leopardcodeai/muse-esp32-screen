# Charts and image ingest for the Muse screen

Two small Python scripts draw a chart or resize a photo **inside the Home
Assistant Core container** and put the PNG below `/config/www/muse_images`. An
HA script and an automation then hand the `/local` URL to the box and announce
the same picture as a `muse_web` event for the web twin and the camera/Apple TV
layout.

Why Pillow and not matplotlib: Pillow is already a Home Assistant Core dependency
(2026.11.1 ships Pillow 13.0.0), the whole renderer is a few hundred lines, and a
`shell_command` has a hard 60-second limit. No add-on, no `pip install`, no
long-running service.

## Files

| File | Purpose |
|---|---|
| `common.py` | palette, target sizes, Inter loader, slug, atomic write, versioned URL, JSON answer |
| `muse_chart.py` | `--spec-b64` JSON in, dark chart PNG out |
| `muse_image.py` | `--image-b64` PNG/JPEG in, resized PNG out |
| `fonts/` | Inter 500/700/800 (SIL OFL 1.1, see `fonts/OFL.txt` and `fonts/README.md`) |
| `shell_commands.yaml` | the three `shell_command` entries to merge into `configuration.yaml` |
| `../scripts/muse_show_chart.yaml` | `script.muse_show_chart` |
| `../automations/muse_image_webhook.yaml` | `POST /api/webhook/<secret>` image ingest |

## Install

1. **Copy the folder** to the Home Assistant configuration directory:

   ```bash
   # from this repository; your SSH user is scp's default
   ssh homeassistant.local 'mkdir -p /config/muse_charts'
   scp -r homeassistant/muse_charts/. homeassistant.local:/config/muse_charts/
   ```

   The target is `/config/muse_charts/` with `common.py`, `muse_chart.py`,
   `muse_image.py` and `fonts/` next to each other. The scripts import `common`
   from their own directory, so do not split them.

2. **Add the shell commands once.** `configuration.yaml` may already have a
   top-level `shell_command:` key. Merge the three entries from
   `shell_commands.yaml` under that one key; never add a second
   `shell_command:` key. If there is no key yet, the file's header shows the
   shape. Then reload **Settings > Tools > YAML > Shell commands** (or call
   `shell_command.reload`).

3. **Add the script and the automation.**
   - The script file is the **body** of one script, like
     `homeassistant/scripts/muse_weather.yaml`. Merge it under the key
     `muse_show_chart:` in `scripts.yaml`; the action is
     `script.muse_show_chart`. With `script: !include_dir_merge_named scripts/`,
     each file must be a mapping, so wrap this body in `muse_show_chart:` first.
   - The automation file is one automation body. Put it in `/config/automations/`
     if `automation:` uses `!include_dir_list`, or add it through the automation
     editor. It uses `!secret muse_image_webhook_id`.

4. **Create the webhook secret.** Generate a long random value and add it to
   `/config/secrets.yaml` (never to a tracked file):

   ```bash
   python3 -c 'import secrets; print(secrets.token_urlsafe(32))'
   ```

   ```yaml
   # secrets.yaml
   muse_image_webhook_id: "the-value-from-above"
   ```

5. **Pick the Home Assistant base URL.** The default in `common.py` is
   `http://homeassistant.local:8123`, the same address the examples use. If your
   HA is reachable at another name, an IP or HTTPS, add `--base-url` to the two
   renderer commands in `shell_commands.yaml`:

   ```yaml
   muse_chart_render: >-
     python3 /config/muse_charts/muse_chart.py --base-url "https://ha.example.com"
     --spec-b64 "{{ spec_b64 }}"
   ```

   The URL must be reachable by the **box** (it downloads the picture itself) and
   by the browser/Apple TV. The box may not resolve a public HTTPS name that only
   works through a reverse proxy; `homeassistant.local` or the LAN address is
   usually the safe choice for it.

6. **Replace the live service prefix if needed.** The script and the automation
   call the live box's `muse_esp32boxs3_screen` prefix. The public firmware name
   `muse-esp32-s3-box-3-screen` yields:

   - `esphome.muse_esp32_s3_box_3_screen_muse_show_image_timed`
   - `esphome.muse_esp32_s3_box_3_screen_muse_show_text`

   Replace both action names in the two YAML files on a public installation.

7. **The timed action must exist.** `muse_show_image_timed` (`title`, `message`,
   `url`, `seconds` 1 to 600) is the action this script uses. A firmware without
   it has no such service; the `muse_web` event is fired before the box call, so
   the web twin still mirrors the picture, but the box call fails. Flash a
   firmware that has the action, or edit the YAML to call `muse_show_image`
   (90 s) while you are between builds.

No restart of Home Assistant is needed after copying files; reload shell
commands, scripts and automations.

## Target sizes

| Target | Pixels | Where it is used |
|---|---|---|
| `box` | 300 x 168 | the box's image panel (it contains the picture, nearest-neighbour) |
| `square` | 432 x 280 | the web twin / ESP-Mosaico image card (the title sits above it) |
| `square_hq` | 864 x 560 | 2x source for the 1280 x 720 camera/Apple TV layout |
| `wide` | 1280 x 720 | the camera/Apple TV layout itself |

The chart is drawn for the target; it is not a box PNG upscaled later. The box
shows a 300 x 168 picture, the square layout a 432 x 280 card, and the camera
layout scales the 864 x 560 source at 2x inside its 1280 x 720 frame. A 300 x 168
chart upscaled to a television looks soft; render `square_hq` or `wide` for that
screen.

## The chart spec

`muse_chart.py` reads one base64 JSON object:

```json
{
  "title": "Yoga 2019-2026",
  "labels": "2019,2020,2021,2022,2023,2024,2025,2026",
  "values": "41,31,8,17,26,20,20,18",
  "type": "bar",
  "target": "box"
}
```

- `title` (required): used for the file name and returned in the JSON. **It is
  not drawn into the PNG**; the image card, the square layout and the camera
  layout draw the HA title themselves.
- `labels` (required): comma-separated categories, one per value.
- `values` (required): comma-separated finite numbers, one per label. Up to 24
  points. Decimals use a dot in the spec (`2.5`); the chart prints German
  decimals with a comma (`2,5`).
- `type`: `bar` or `line`, default `bar`.
- `target`: `box`, `square`, `square_hq` or `wide`, default `box`.

The dark palette is fixed: background `#14161C`, grid `#2A2F3A`, bars `#4DA3FF`,
line `#FF9F0A`, text `#F5F7FA` and `#9FB0C8`. Bars and line labels start at zero;
only a negative series puts the zero line inside the plot. Up to twelve points
show every value; more show the first, last, maximum and minimum, so the numbers
stay large instead of shrinking into a smear.

Direct use on the Mac:

```bash
cd /Users/you/Coding/muse-esp32-s3-box-3-screen/homeassistant/muse_charts
SPEC=$(python3 - <<'PY'
import base64, json
spec = {"title": "Yoga 2019-2026",
        "labels": "2019,2020,2021,2022,2023,2024,2025,2026",
        "values": "41,31,8,17,26,20,20,18",
        "type": "bar", "target": "box"}
print(base64.b64encode(json.dumps(spec).encode()).decode())
PY
)
python3 muse_chart.py --spec-b64 "$SPEC" --output-dir ../../web/local/chart-samples
```

The answer is one JSON line on stdout; errors are `{"ok": false, "error": "..."}`
and exit code 1, never a traceback on stdout:

```json
{"ok": true, "url": "http://homeassistant.local:8123/local/muse_images/yoga-2019-2026.png?v=8f3c1a2b90", "width": 300, "height": 168, "bytes": 4390, "title": "Yoga 2019-2026"}
```

The file name is the title's slug (`yoga-2019-2026.png`). The `?v=` part is the
first ten hex digits of the PNG's SHA-256, so the 31-day `/local` cache returns
the same bytes for the same URL and a changed chart gets a new URL.

## `script.muse_show_chart` over REST

The script takes `title`, `labels`, `values`, `type`, optional `target` (default
`box`) and optional `seconds` (default 30). It renders, fires the `muse_web`
event `{action: show_image_timed, title, message, url, seconds}`, and calls
`esphome.muse_esp32boxs3_screen_muse_show_image_timed`. On a render error it
fires the text event and calls `..._muse_show_text` with "Keine Daten".

The event is deliberately fired **before** the ESPHome action: a missing service
(no box, or a firmware without `muse_show_image_timed`) is a configuration error
that `continue_on_error` does not swallow, and the web twin must still mirror the
picture. The same order is used in the image webhook.

```bash
curl -s -X POST "$HA_URL/api/services/script/muse_show_chart" \
  -H "Authorization: Bearer $HA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Yoga 2019-2026",
    "labels": "2019,2020,2021,2022,2023,2024,2025,2026",
    "values": "41,31,8,17,26,20,20,18",
    "type": "bar",
    "target": "box",
    "seconds": 30
  }'
```

A line chart for the square layout:

```bash
curl -s -X POST "$HA_URL/api/services/script/muse_show_chart" \
  -H "Authorization: Bearer $HA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Yoga 2019-2026",
    "labels": "2019,2020,2021,2022,2023,2024,2025,2026",
    "values": "41,31,8,17,26,20,20,18",
    "type": "line",
    "target": "square_hq",
    "seconds": 60
  }'
```

The same from an automation or an assistant:

```yaml
action: script.muse_show_chart
data:
  title: "Yoga 2019-2026"
  labels: "2019,2020,2021,2022,2023,2024,2025,2026"
  values: "41,31,8,17,26,20,20,18"
  type: bar
  target: box
  seconds: 30
```

`seconds` is clamped to 1 to 600. The empty `message` is deliberate: the title
above/below the picture is enough, and a second line would crowd the 300 x 168
card.

## The image webhook

`POST /api/webhook/<muse_image_webhook_id>` with a JSON body:

```json
{
  "image": "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
  "title": "Doorbell",
  "message": "Front door, 18:31",
  "name": "doorbell",
  "target": "box",
  "mode": "contain"
}
```

- `image` (required): raw base64 or a `data:image/png;base64,` /
  `data:image/jpeg;base64,` URI. At most **100000 base64 characters** (about
  75 KB decoded). PNG and JPEG only; the magic bytes, the decoded format and the
  pixel count are checked in Python.
- `title`: card title, default `Bild`. It is also the default file slug.
- `message`: second line, default empty.
- `name`: file slug, default the title. A path such as `../../x` becomes `x`;
  the file name is always `<slug>-<target>.png`.
- `target`: `box` (default), `square`, `square_hq` or `wide`.
- `mode`: `contain` (default; pad with `#14161C`) or `cover` (crop). Transparency
  is flattened onto `#14161C`, because the box's RGB565 panel has no alpha.

```bash
IMAGE_B64=$(base64 < doorbell.jpg | tr -d '\n')
curl -s -X POST "$HA_URL/api/webhook/$MUSE_IMAGE_WEBHOOK_ID" \
  -H "Content-Type: application/json" \
  -d "{\"image\":\"$IMAGE_B64\",\"title\":\"Doorbell\",\"message\":\"Front door, 18:31\",\"name\":\"doorbell\",\"target\":\"box\",\"mode\":\"contain\"}"
```

The automation calls `shell_command.muse_image_ingest`, then fires `muse_web`
with `{action: show_image_timed, title, message, url, seconds: 60}` and calls
`esphome.muse_esp32boxs3_screen_muse_show_image_timed` for 60 seconds. The event
comes first for the same reason as in the chart script: a box without the service
must not stop the web/camera mirror. A failed ingest shows "Bild nicht
erreichbar" on the box and in the web event.

**Security.** The webhook ID is a password. The trigger is `POST` only,
`local_only: true` (Home Assistant Cloud and the internet get a 200 without the
automation running), `mode: queued` with `max: 5`, and `trace: stored_traces: 0`
because the payload carries a picture. The automation also caps the base64
length and allows only base64/data-URI characters, which keeps a quote out of
the `shell_command` arguments; the Python side repeats the length cap, checks
the magic and size, and slugifies the name. Do not weaken these checks for a
convenience endpoint.

## Fonts

`fonts/Inter-500.ttf`, `Inter-700.ttf` and `Inter-800.ttf` are unmodified copies
of Inter from the Muse camera add-on's assets. Inter is by Rasmus Andersson and
the Inter Project Authors, licensed under the **SIL Open Font License 1.1**; the
full text and the copyright line are in `fonts/OFL.txt`. The fonts may be
bundled and redistributed with this project; they may not be sold on their own.
If the folder is missing, `common.py` falls back to DejaVu Sans/Arial and then
Pillow's default font, which still renders but with different metrics.

## Limits and things to know

- **60 seconds** per `shell_command`. A 1280 x 720 chart or a 25-megapixel JPEG
  is far below that, but a pathological image is refused before it can hang.
- **100000 base64 characters** per image, **25 megapixels** and **8192 px** per
  side. The chart spec is capped at 20 KB base64.
- **`/local` caches for 31 days.** Every URL ends in `?v=<content hash>`; never
  strip it. `muse_chart_cleanup` deletes generated files older than 31 days
  (44640 minutes). The folder is only for generated pictures; do not point a
  dashboard's originals at it.
- **No live Home Assistant changes** are made by this folder. It is a set of
  files to copy; the service prefix, base URL and webhook secret are yours.
- The event action is `show_image_timed` as specified. The current web twin also
  has a `show_chart` action that contains an off-aspect picture without cropping;
  `show_image_timed` uses the image card, whose panel matches the `square` and
  `square_hq` aspect exactly. For the web/Apple TV without a box, render
  `square` or `square_hq` (or `wide`) so the picture fills that panel; a `box`
  chart is still shown, but the square panel has a different aspect and crops its
  edges.
- The box's image card draws the title, so the PNG intentionally has no title.
  A chart rendered with `target: box` is 300 x 168 and is contained, not
  stretched; a title added to the PNG would appear twice.
