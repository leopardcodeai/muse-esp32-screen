# Home Assistant side

The box is an ESPHome device; Home Assistant discovers it and lists its actions as
`esphome.<device>_muse_*` (device `muse-esp32-s3-box-3-screen` gives `esphome.muse_esp32_s3_box_3_screen_muse_show_text`).
Every argument is mandatory in Home Assistant, send `""` where nothing is meant.

- `automations/`: five examples to import or copy (doorbell with photo, garage with a
  live view, someone comes home, waste tomorrow, and the image webhook). Replace the
  entity ids.
- `scripts/muse_weather.yaml`: today's weather as a card; the assistant can call
  `script.muse_weather` instead of composing the weather itself.
- `scripts/muse_screen.yaml`: the 19 public `script.muse_screen_*` actions
  (the same fields as the firmware) plus the `muse_box_*` helpers. Use these: they fire
  the `muse_web` event for the web twin, the ESP-Mosaico app and the camera, then start
  the box helper. A box automation that still calls `esphome.*` directly reaches only the
  box; the web mirrors that legacy path only when its settings name the box's live
  ESPHome device (`muse_esp32boxs3_screen`).
- `scripts/muse_weather_week.yaml`: next week's high and low as one server-rendered
  chart (`script.muse_weather_week`); `muse_charts/` and `script.muse_show_chart` draw
  any bar or line chart with an optional second series (`values2`).
- `muse_charts/`: server-rendered bar and line charts (Pillow, no add-on) and a
  `POST` image webhook. `script.muse_show_chart` draws a chart and shows it on the box;
  `automations/muse_image_webhook.yaml` accepts a base64 PNG/JPEG and resizes it for the
  box, the web twin or the camera layout. See `muse_charts/README.md` for the install,
  the target sizes, the REST examples and the webhook security.
- `addon/muse-web-screen/`: an optional local Home Assistant add-on that serves the web
  app over HTTPS on port 8322 and proxies Home Assistant's websocket, so Chrome can
  install it as an app even when Home Assistant itself runs on HTTP. See
  `addon/muse-web-screen/DOCS.md`.
- An assistant (Muse, Claude, a Grok bot, anything that can call Home Assistant) uses
  the same actions; see `../docs/ASSISTANT_PROMPT.md` for the text that teaches it, and
  `../tools/muse_screen.py` for a command line that wraps them.
