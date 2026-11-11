# Muse ESP32 Screen: one device layer, Mosaico default, dark AMOLED

Status: approved in chat on 11 November 2026. This spec is the source for the
implementation plan; the German Muse prompt in the appendix is part of the deliverable.

## Goal

One Home Assistant entry point for every Muse screen. Muse calls
`script.muse_esp32_screen_<action>`; the script fires the `muse_web` event for the browser
twin, the camera/Apple TV view and any webhook, then starts the per-device helpers. The
ESP-Mosaico (ESP32-S31, 480 x 480 AMOLED) becomes the reference device, the
ESP32-S3-BOX-3 becomes the second device, and the web app adopts the Mosaico display as
its default with a switchable dark theme.

## Non-goals

- No Mosaico firmware in this repository. The port stays "in progress" in
  `docs/SQUARE_LAYOUT.md`; only its display data and design become the web default.
- No rename of the live BOX-3 ESPHome device or its `esphome.*` actions. Existing
  automations, scripts and the assistant prompt keep working.
- No re-authoring of scenes for dark mode. `draw` keeps the colours the author wrote.

## 1. Names and compatibility

| Layer | Name | State |
|---|---|---|
| Family / public API | `script.muse_esp32_screen_<action>` | new |
| Web event | `muse_web` | unchanged |
| Web answer event | `muse_web_answer` | unchanged |
| Common answer sensor | `sensor.muse_esp32_screen_answer` | new |
| BOX-3 device helpers | `script.muse_box_<action>` | already live |
| BOX-3 ESPHome actions | `esphome.muse_esp32boxs3_screen_muse_<action>` (live) / `esphome.muse_esp32_s3_box_3_screen_muse_<action>` (public name) | unchanged |
| Mosaico device helpers | `script.muse_mosaico_<action>` | future, not in this change |

`script.muse_broadcast_*` was created on 11 November 2026 and has no external users. It is
replaced by `script.muse_esp32_screen_*`; no alias is kept.

The web app keeps `muse_esp32_s3_box_3_screen` as its default device for legacy
`call_service` events. The `muse_web` event carries no device name, so the new layer does
not depend on it.

## 2. Public actions and payloads

All fields are required; send `""` where nothing is meant. Numbers travel as strings.
`items`, `events` and `scene` are multiline text.

| Script | Fields | Shows |
|---|---|---|
| `script.muse_esp32_screen_set_status` | `status` | the status animation and pill |
| `script.muse_esp32_screen_set_status_text` | `status`, `label` | the same, with a custom label |
| `script.muse_esp32_screen_show_text` | `title`, `message` | text card |
| `script.muse_esp32_screen_show_value` | `label`, `value`, `unit` | large value |
| `script.muse_esp32_screen_show_weather` | `condition`, `temperature`, `message` | weather card |
| `script.muse_esp32_screen_show_event` | `icon`, `title`, `message` | icon disc and text |
| `script.muse_esp32_screen_show_image` | `title`, `message`, `url` | photo or GIF |
| `script.muse_esp32_screen_show_image_timed` | `title`, `message`, `url`, `seconds` | photo or GIF for 1 to 600 s |
| `script.muse_esp32_screen_show_live` | `title`, `url`, `seconds` | live camera view |
| `script.muse_esp32_screen_show_route` | `title`, `from`, `to`, `mode` | map with the way |
| `script.muse_esp32_screen_show_agenda` | `title`, `events` | appointments |
| `script.muse_esp32_screen_show_list` | `title`, `items` | list with ticks |
| `script.muse_esp32_screen_show_timer` | `label`, `duration` | countdown ring |
| `script.muse_esp32_screen_cancel_timer` | `label` | ends timers |
| `script.muse_esp32_screen_ask` | `question`, `yes_label`, `no_label` | question with two buttons |
| `script.muse_esp32_screen_choose` | `question`, `options` | question with two to four answers |
| `script.muse_esp32_screen_celebrate` | `title`, `message` | confetti and title |
| `script.muse_esp32_screen_draw` | `scene` | a scene in the drawing language |
| `script.muse_esp32_screen_clear` | none | every card gone |

`wait_answer`, `get_state` and `hw_check` stay device-specific: they return a response
and, for `wait_answer`, must wait on the device that shows the question. The prompt names
the BOX-3 action for them.

### `muse_web` event

Fired once per public action, before any device call. Payload: `action` plus the same
fields as the script, values as sent (`seconds` may be a number). Example:

```yaml
event: muse_web
event_data:
  action: ask
  question: "Licht an?"
  yes_label: "Ja"
  no_label: "Nein"
```

### `muse_web_answer` event

Fired by the web app when someone taps. Payload: `answer` (`yes`, `no`, the chosen text,
or a scene button's text), `question` (the question or `Szene`), and `action` (`ask`,
`choose` or `draw`).

### Answer sensors

- `sensor.muse_web_screen_antwort` and `input_text.muse_web_answer` stay as they are.
- New `input_text.muse_esp32_screen_answer` plus
  `sensor.muse_esp32_screen_answer` mirror the latest answer from any screen in the form
  `<answer>: <question>`. The web answer automation writes it; a second automation copies
  the BOX-3 answer sensor when it changes. The BOX-3 entity id is a single marked line in
  the package because it depends on the device name: `sensor.muse_esp32boxs3_screen_antwort`
  in this installation, `sensor.muse_esp32_s3_box_3_screen_answer` for a box flashed
  under the public name.

## 3. Fan-out

Each public script runs in `parallel` mode with `max: 20`:

1. `event: muse_web` with the payload.
2. One `script.turn_on` per device helper, with `variables:` nested under `data:`.
3. A `choose` guard before each device call:
   `{{ states('script.muse_box_ask') not in ['unknown', 'unavailable'] }}` so an absent
   Mosaico helper is skipped instead of failing the call.

`script.turn_on` must receive `variables:`, not the fields directly:
`data: {variables: {question: ...}}`. A flat `data:` returns HTTP 400.

Why this shape (measured 11 November 2026): a script whose sequence contains the
blocking `esphome..._muse_ask` call returned after 25.2 s, and the browser saw the event
only then. With the event first and the box call moved into `script.muse_box_ask` started
by `script.turn_on`, the public call returned in 0.021 s and the browser logged the action
after 0.029 s. The same holds for every other action, so the layer never waits for a
device.

Rejected alternative: one generic `muse_screen` event bus with per-device automations.
It scales to more devices but loses the service fields, the validation, the script traces
and the direct `ask`/`choose` response that Muse uses today.

## 4. Web app: Mosaico default

- New visitors and existing installs land on the square layout (`480 x 480`). Stored
  settings get a `layoutVersion: 2` marker; without it the app switches once to `square`.
  After that the Layout setting wins, and `?layout=box` still forces the BOX-3 view.
- The stage is 1:1 at 480 CSS pixels when the window allows it. The canvas backing store
  may scale up to 2x (was 1.5x for square), so a 960 px stage is drawn at 1920 px and
  stays sharp on a Retina display.
- Default frame rate stays 60. The existing signature skip stays: a still card costs no
  draw. New frame-budget guard: if the median frame time over 60 frames exceeds 20 ms,
  the backing scale drops to 1.5, then 1.0, and logs once. `?fps=10|30|60` still works.
- `prefers-reduced-motion` and the existing timings are untouched.

## 5. Dark AMOLED theme

New setting `theme: dark | light | auto`. `auto` (default) gives dark on the square layout
and light on the box layout. `?theme=dark|light` overrides it for one visit; the camera
add-on appends `theme=dark` to its URL so Apple TV and the camera show the same look.

The theme changes the chrome and the cards, never the content of a `draw` scene: a scene
keeps the colours its author wrote.

| Token | Light (unchanged) | Dark (AMOLED) |
|---|---|---|
| Page | `#F3F3F3` | `#000000` |
| Card | `#FFFFFF` | `#141416` |
| Ink | `#1C1C1E` | `#F5F5F7` |
| Sub | `#636368` | `#A1A1A8` |
| Text | `#2C2C2E` | `#E8E8ED` |
| Edge / shadow | shadow `rgba(0,0,0,.08)` | 1 px edge `#2C2C2E`, no shadow |
| Orange | `#FF9500` | `#FF9F0A` |
| Ready | `#34C759` | `#30D158` |
| Listening | `#0A84FF` | `#409CFF` |
| Thinking | `#FF9F0A` | `#FF9F0A` |
| Speaking | `#BF5AF2` | `#BF5AF2` |
| Error | `#FF453A` | `#FF453A` |
| Off | `#8E8E93` | `#8E8E93` |
| Button text | `#FFFFFF` | `#FFFFFF` |

`web/square.js` imports the palette as constants from `render.js`; the implementation
turns those into a per-theme palette object, and `render.js` keeps the box layout on the
light palette. Tests assert the token table above.

Panel data recorded in `docs/SQUARE_LAYOUT.md`: 2.16" LTPS-AMOLED, 480 x 480 RGB,
16.7 M colours, active area 38.39 x 38.39 mm, 314 ppi, 700 cd/m², 50,000:1, 108 % NTSC,
60 Hz, 2 to 4 ms, CO5300 over QSPI, CST9220 touch. The panel is RGB565 in firmware; the
web keeps full 8-bit colour.

## 6. Docs, prompt and versions

- `README.md`: Mosaico first (standard), BOX-3 second, web twin as the no-hardware path.
  Hardware and quick-start order follow.
- `web/README.md`: square is the default; theme section; performance notes.
- `docs/SQUARE_LAYOUT.md`: both palettes, the theme rule, the panel table.
- `docs/ACTIONS.md`: a "one entry point for all screens" section with the table above and
  a note that `wait_answer`, `get_state` and `hw_check` stay device-specific.
- `homeassistant/scripts/muse_esp32_screen.yaml`: the 19 scripts plus the box helpers,
  ready for `scripts.yaml`.
- `homeassistant/automations/muse_esp32_screen_answer.yaml`: web answer copy and BOX-3
  answer copy.
- `docs/ASSISTANT_PROMPT.md`: the German and English prompt replaced with the text in the
  appendix (English translation of the same content).
- Versions: web 1.6.0, add-on 1.0.2, firmware stays 4.3.0 (no firmware change).

## 7. Error handling

- A missing device helper is skipped by the `choose` guard; the web event still fires.
- A box that is offline fails inside its helper with `continue_on_error`; the public
  script never fails.
- A browser that is closed misses the event and restores
  `input_text.muse_web_last` on the next connect, as today.
- Answers are last-write-wins; the value always carries the question, so a late answer
  from another screen is recognisable.
- Image URLs from Home Assistant stay rewritten to the add-on's `/ha-local/`; a failed
  image falls back to an event card with title and message.

## 8. Testing and acceptance

Host tests:

- `node --test web/test` with new cases for the theme table, the square default, the
  layout migration and the 2x backing cap.
- `pytest tools/` and `python3 tools/check_private.py`.

Live acceptance, all from `script.muse_esp32_screen_*`:

- 19 actions reach the web within 300 ms and the box reports the matching mode/title.
- `ask` returns in under 100 ms; the box shows the question; a web tap writes
  `sensor.muse_esp32_screen_answer` and `sensor.muse_web_screen_antwort`, a box tap writes
  `sensor.muse_esp32boxs3_screen_antwort` and the common sensor.
- Reload restores the last card; a short Home Assistant restart reconnects.
- `?layout=box` still renders the 320 x 240 view pixel for pixel; the BOX-3 app keeps its
  saved device name.
- Dark and light screenshots at 480 x 480; the camera add-on shows the same theme on the
  Apple TV.
- Median frame time at 960 px stage under 20 ms on the Mac; no `[W]` or `[E]` in the box
  log after a flash-free deploy (firmware unchanged).

## Appendix: Muse prompt (German, paste-ready)

This replaces the previous prompt. It is the text for Meta's Muse; the English version in
`docs/ASSISTANT_PROMPT.md` says the same.

```text
Du steuerst die Bildschirme im Haus über Home Assistant. Es gibt drei, und alle zeigen
dasselbe: den neuen ESP-Mosaico mit 2,16-Zoll-AMOLED (480 x 480, das Standardgerät), die
ESP32-S3-BOX-3 (320 x 240, das zweite Gerät) und den Muse Web Screen im Browser, der auch
auf dem Apple TV als Kamerabild läuft.

REGELN
- Ruf immer script.muse_esp32_screen_<aktion> auf, nie die gerätespezifischen
  esphome.*-Aktionen. Ein Aufruf erreicht alle Bildschirme; fehlt ein Gerät, zeigen die
  anderen trotzdem.
- Jedes Feld ist Pflicht; sende "", wo nichts gemeint ist. Zahlen als Text.
- Karten stellen sich an: Läuft eine Karte, wartet die nächste ("+N"); ein Tipp zeigt die
  nächste. Gleicher Titel ersetzt die gezeigte Karte. script.muse_esp32_screen_clear
  räumt alles ab.
- Standzeiten: Text, Wert, Ereignis 20 s; Konfetti 30 s; Liste und Kalender ab 30 s;
  Wetter und Route 60 s; Foto 90 s (oder 1 bis 600 s mit show_image_timed); Frage 2 min;
  Timer solange er läuft; Live und Szene wie angegeben.
- Keine Emojis (die Schrift hat keine), nimm Icons.
- Antworten landen in sensor.muse_esp32_screen_answer als "<Antwort>: <Frage>".

1. WENN WIR REDEN
- Zu Beginn script.muse_esp32_screen_set_status_text mit status "thinking" und label =
  was du tust ("Ich lese deine E-Mails …").
- Antwort: script.muse_esp32_screen_show_text (title, message), oder eine Szene
  (Teil 5), wenn ein Bild mehr sagt.
- Zum Schluss script.muse_esp32_screen_set_status mit status "ready".
- Sprechen: tts.speak mit media_player_entity_id media_player.muse_box_lautsprecher
  (so heißt der Lautsprecher dieser Box in Home Assistant).

2. FERTIGE KARTEN
- show_event: icon, title, message. icon: klingel, garage, garage_zu, rollladen_runter,
  rollladen_hoch, mail, kalender, muell, tv_an, tv_aus, zuhause, briefkasten, tuer,
  nachrichten, licht, solar, timer, erledigt, info.
- show_value: label, value, unit.
- show_weather: condition, temperature, message.
- celebrate: title, message.
- show_image: title, message, url. JPEG, PNG oder animiertes GIF; Kamerabilder aus Home
  Assistant als entity_picture mit &width=300&height=168.
- show_image_timed: title, message, url, seconds (1 bis 600).
- show_live: title, url, seconds (5 bis 120).
- show_agenda: title ("" = Heute), events: ein Termin pro Zeile,
  "09:00-10:00 Teammeeting @ Büro" oder "ganztägig Urlaub".
- show_list: title, items: ein Eintrag pro Zeile, "[x] Milch" erledigt, "[ ] Brot" offen.
- show_route: title, from, to ("52.52,13.37", Ortsname oder "zuhause"),
  mode (car, bike, foot).

3. TIMER
- show_timer: label ("Pizza"), duration ("12 min", "1:30", "90 s", "1 h 20 min").
- cancel_timer: label ("" = alle).

4. FRAGEN UND ANTWORTEN
- ask: question, yes_label, no_label ("" = Ja/Nein). Antwortet
  {"answer": "yes"|"no"|"pending"}.
- choose: question, options (2 bis 4 Zeilen). Antwortet mit dem gewählten Text oder
  "pending".
- Beide warten 25 s auf einen Tipp; bei "pending" bleibt die Frage 2 min. Die Antwort
  steht dann in sensor.muse_esp32_screen_answer.
- wait_answer und get_state sind Gerätesachen: dafür
  esphome.muse_esp32boxs3_screen_muse_wait_answer bzw. ..._get_state aufrufen.

5. DEINE BÜHNE: draw (Feld scene)
Ein Bild in Zeilen, 320 x 240, 0 0 oben links; der Mosaico und der Web Screen skalieren es
auf 480 x 480. Ein Befehl pro Zeile oder mit ; getrennt, Texte mit Leerzeichen in
Anführungszeichen, \n ist Zeilenumbruch, Kommentare mit #.
bg color [to]            Hintergrund, mit to ein Verlauf (dir=right waagerecht)
rect x y w h color       r=Radius oder pill, line=Randbreite
circle x y r color       line=Randbreite
line x y x2 y2 color     w=Breite
tri x y x2 y2 x3 y3 color
star x y r color         points, inner, rot
poly x y r sides color   rot
text x y "Text"          size=xs|s|m|l|xl|xxl, color, align, valign, w, lines, lh
icon x y name color      size=s|l
muse x y anim            idle, wave, working, making, avatar; r bis 80
bar x y w h value color  Fortschritt 0 bis 100, bg=Spurfarbe
particles kind count color  confetti, snow, rain, sparkle, bubbles
button x y w h "Text" color eine Taste; der Tipp antwortet mit dem Text
seconds n                Dauer 3 bis 3600 (sonst 20)
frame ms / frame end / once  Einzelbild-Animation
Jedes Element kann opacity, delay, dur, fade, blink, move, spin, pulse, type. Farben:
#rrggbb oder white, black, ink, page, gray, red, orange, yellow, gold, green, mint, teal,
cyan, blue, navy, indigo, purple, pink, brown.

Beispiel:
bg #1e3c72 #2a5298
text 160 50 "Was möchtest du hören?" size=l color=white align=center
button 20 110 130 50 "Jazz" purple
button 170 110 130 50 "Rock" orange
button 20 170 130 50 "Klassik" teal
button 170 170 130 50 "Nichts" gray
seconds 60

6. WAS MENSCHEN AM BILDSCHIRM TUN
Tippen: nächste Karte. Nach rechts wischen: letzte Karte zurück. Nach unten wischen oder
lang drücken: alles weg. Tipp auf die obere Leiste: Infokarte. Im Ruhebildschirm tippen:
Kuscheln; lang drücken: zuhören. Der Schalter oben schaltet die Mikrofone ab.
```
