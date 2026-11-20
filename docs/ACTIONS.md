# Actions: what the box can show, hear and answer

Every action is an ESPHome action in Home Assistant, named `esphome.<device>_muse_<action>`
(device `muse-esp32-s3-box-3-screen` gives `esphome.muse_esp32_s3_box_3_screen_muse_show_text`). Home Assistant makes every
argument mandatory; send `""` where nothing is meant. `tools/muse_screen.py` wraps all of them.

## Cards wait in line, touch moves on

Since 3.3 a new card waits while another one is on screen; the line holds up to 12. Three
kinds go first: a question, the doorbell, a voice conversation (the card on screen comes
back after it). A card with the title of the one on screen replaces it at once, so the door
photo follows "Es klingelt" without a tap, and a scene replaces a scene.

| Touch | On a card | On the ready screen |
|---|---|---|
| tap | the next card in line, or the status | Muse is cuddled: it waves and wiggles, hearts rise for 2.6 s |
| swipe left | the next card | |
| swipe right | the card before (the last six are kept; the one on screen goes back to the front of the line) | the last card again |
| swipe down | every card gone | |
| long press (0.7 s) | every card gone | Muse listens (voice assistant), unless the mute switch is on |
| tap on the top bar | the box about itself for 15 s: battery, Wi-Fi, room air, uptime, free memory, what waits | the same |
| on a question | the button under the finger answers (yes/no, or one of up to four choices) | |
| on a scene with `button`s | the button under the finger answers with its text (`muse_wait_answer`) | |

Every answer a touch gives lands in `sensor.muse_esp32_s3_box_3_screen_answer` as
`<answer>: <question>` (`none: ...` when a question left the screen unanswered, `<text>:
Szene` for a scene button).
## The actions

An assistant calls these through Home Assistant with its own long-lived token.

| Home Assistant action | Data | Shows |
|---|---|---|
| `esphome.muse_esp32_s3_box_3_screen_muse_set_status` | `status`: `ready`, `listening`, `thinking`, `speaking`, `error`, `off` | the matching animation and pill; `off` dims the display |
| `esphome.muse_esp32_s3_box_3_screen_muse_set_status_text` | `status` as above, `label`: free text | the same animation, and `label` in the pill instead of its default text |
| `esphome.muse_esp32_s3_box_3_screen_muse_show_text` | `title`, `message` | Muse (or a weather icon) with title, the text on a card; line breaks stay |
| `esphome.muse_esp32_s3_box_3_screen_muse_show_weather` | `condition`, `temperature`, `message` | big weather icon, temperature, condition, text below |
| `esphome.muse_esp32_s3_box_3_screen_muse_show_event` | `icon`, `title`, `message` | a coloured disc with an icon, title and text |
| `esphome.muse_esp32_s3_box_3_screen_muse_show_image` | `title`, `message`, `url` | a photo or an animated GIF (section "Pictures"), title and text below |
| `esphome.muse_esp32_s3_box_3_screen_muse_show_image_timed` | `title`, `message`, `url`, `seconds` | the same photo or GIF card, on screen for 1 to 600 s |
| `esphome.muse_esp32_s3_box_3_screen_muse_show_live` | `title`, `url`, `seconds` | the picture at `url` again and again for 5 to 120 s: a live camera view |
| `esphome.muse_esp32_s3_box_3_screen_muse_show_route` | `title`, `from`, `to`, `mode` | a map with the way, start green, destination red, distance and time |
| `esphome.muse_esp32_s3_box_3_screen_muse_show_agenda` | `title`, `events` | a calendar sheet and the appointments, one per line of `events` |
| `esphome.muse_esp32_s3_box_3_screen_muse_show_list` | `title`, `items` | a list with ticks, one item per line of `items` |
| `esphome.muse_esp32_s3_box_3_screen_muse_show_timer` | `label`, `duration` | a timer on the box: ring and time left, the chime when it ends |
| `esphome.muse_esp32_s3_box_3_screen_muse_cancel_timer` | `label` | ends the box's own timers: all with `label` empty, else those with that name |
| `esphome.muse_esp32_s3_box_3_screen_muse_ask` | `question`, `yes_label`, `no_label` | a question with two buttons; answers which one was tapped |
| `esphome.muse_esp32_s3_box_3_screen_muse_choose` | `question`, `options` | a question with two to four answers (`options` one per line); answers the chosen text |
| `esphome.muse_esp32_s3_box_3_screen_muse_wait_answer` | `seconds` | nothing; waits up to 60 s for the next answer a touch gives (question or scene button) |
| `esphome.muse_esp32_s3_box_3_screen_muse_clear` | none | every card gone, the line emptied, the status back |
| `esphome.muse_esp32_s3_box_3_screen_muse_get_state` | none | nothing; answers with what the box shows and knows (mode, title, waiting, last answer, listening, muted, presence, battery, timers, volume) |
| `esphome.muse_esp32_s3_box_3_screen_muse_show_value` | `label`, `value`, `unit` | a large value, e.g. `21,5` `°C` |
| `esphome.muse_esp32_s3_box_3_screen_muse_celebrate` | `title`, `message` | confetti once, then the title |
| `esphome.muse_esp32_s3_box_3_screen_muse_draw` | `scene` | a picture of Muse's own design (section "Scenes"); answers with what went wrong |
| `esphome.muse_esp32_s3_box_3_screen_muse_hw_check` | none | nothing; answers with every chip, pin and memory reading (section "Hardware") |
| `media_player.play_media` on `media_player.muse_esp32_s3_box_3_screen_speaker` | a sound or music URL | plays it on the box's speaker (section "Sound") |
| `script.muse_wetter` | none | the current weather from `weather.forecast_home`, today's low and high, when the rain starts |

- `condition`: Home Assistant's weather states (`sunny`, `partlycloudy`,
  `rainy`, `pouring`, `lightning-rainy`, `snowy`, `fog`, `windy`, ...) or a word
  such as "Regen" or "bewölkt".
- `icon`: `klingel`, `garage`, `garage_zu`, `rollladen_runter`,
  `rollladen_hoch`, `mail`, `kalender`, `muell`, `tv_an`, `tv_aus`, `zuhause`,
  `briefkasten`, `tuer`, `nachrichten`, `licht`, `solar`, `timer`, `erledigt`,
  `info`. English names (`doorbell`, `calendar`, `news`, ...) work too.
- `url`: http or https, from the house or the web (section "Pictures"). An empty `url`
  gives an event card with title and text, not the doorbell picture.
- `seconds` (`muse_show_image_timed`, int): 1 to 600; smaller or larger values are
  clamped. The photo stays that long instead of the fixed 90 s of `muse_show_image`.
- Route: `from` and `to` as `"52.5163,13.3777"`, a place name (looked up with
  OpenStreetMap's Nominatim) or `"zuhause"` (zone.home); `mode` `car`, `bike` or `foot`
  (also `auto`, `fahrrad`, `zu fuss`).
- Agenda: `title` empty gives "Heute"; `events` one appointment per line,
  `09:00-10:00 Teammeeting @ Büro`, `ganztägig Urlaub` or `09:00 | Teammeeting | Büro`;
  four per page, the pages turn every 8 s.
- Question: `muse_ask` and `muse_choose` wait up to 25 s for a tap and answer
  `{"answer": ..., "question": ...}` (ask with `?return_response`): `yes`/`no` for
  `muse_ask`, the chosen text for `muse_choose`, `pending` while the question is still on
  screen (it stays 2 min; the answer then lands in the sensor `Antwort`). A short "pling"
  plays when a question appears. Empty labels give "Ja" and "Nein".
- List: `items` one per line, `[x] Milch` done, `[ ] Brot`, `- Brot` or `Brot` open; five per
  page, the pages turn every 8 s; the header counts what is done.
- Timer: `duration` as `5`, `5 min`, `1:30`, `90 s` or `1 h 20 min` (a bare number means
  minutes); `label` names it. Answers `{"ok", "seconds", "timers"}`. The card shows the
  timer that ends first and stays while it runs; a tap moves on and the time left shows in
  the top bar. When it ends: the chime, and "Zeit ist um" with the name for 30 s.
- Every card action answers `{"on_screen": true | false, "waiting": N}`: whether the card
  went up at once or waits behind N others.
- Emojis: the fonts have none. Weather emojis become weather icons, every other
  emoji is dropped; Markdown marks (`**`, `#`, `*` bullets) are cleaned up.

`muse_show_image_timed` takes `title`, `message` and `url` as strings and `seconds` as an
int; every field is mandatory, as everywhere in Home Assistant. A REST call with the answer:

```bash
curl -s -X POST \
  "http://homeassistant.local:8123/api/services/esphome/muse_esp32_s3_box_3_screen_muse_show_image_timed?return_response" \
  -H "Authorization: Bearer $HA_TOKEN" -H "Content-Type: application/json" \
  -d '{"title": "Garten", "message": "Kamera 2", "url": "http://homeassistant.local:8123/local/garden.jpg", "seconds": 20}'
```

It answers `{"on_screen": true, "waiting": 0}` like every card action.

`muse_set_status_text` lets the caller write the pill's text, like the progress text of
the Muse app, for example `{"status": "thinking", "label": "Ich lese deine E-Mails …"}`.
The label is one line: line breaks become spaces, emojis and unsupported characters
are dropped, and text that is wider than the pill (254 px of text, 296 px with the
pill) is cut between two characters and ends with "…". It stays while the status
stays. A new status brings the default text back: a call to `muse_set_status`, the
voice assistant moving on (listening, thinking, speaking), the wave when someone steps
up, an error. An empty `label` gives the default text at once.

Why a second action and why `label`: Home Assistant makes **every** declared argument
of an ESPHome action mandatory (`esphome/manager.py` in HA 2026.9.4, `vol.Required`;
a call without one answers HTTP 400). A `text` on `muse_set_status` would break every
caller that sends only `status`, so that action stays as it is. ESPHome reserves
`text` as a name (`RESERVED_IDS`), hence `label`.

The German status values Muse proposed first (`bereit`, `hoert`, `denkt`,
`spricht`, `fehler`, `aus`) are accepted as well. `muse_show_page` is gone with
the pages.

### Buttons in a scene

A scene (`muse_draw`) may hold `button x y w h "Text" color` (keys `size`, `r`, and the
usual timing keys; `knopf` and `taste` work too). A touch on one answers with its text:
the scene ends, the text lands in the sensor `Antwort`, and `muse_wait_answer` returns it.
So Muse can build its own menus:

```text
bg #1e3c72 #2a5298
text 160 50 "Was möchtest du hören?" size=l color=white align=center
button 20 110 130 50 "Jazz" purple
button 170 110 130 50 "Rock" orange
button 20 170 130 50 "Klassik" teal
button 170 170 130 50 "Nichts" gray
seconds 60
```

Then `muse_wait_answer` with `seconds: 30` answers `{"answered": true, "answer": "Jazz"}`,
or `{"answered": false, "answer": ""}` when nobody tapped in time.
## Moves of the figure (web screen: `animate`)

The web screen (browser, Tab, iPad, the Mosaico layout and the camera add-on, all
`web/`) can move Muse on the ready screen. The moves are drawn in code over the figure's
own frames (`web/motion.js`): they turn, shift and squash the whole picture and add a few
shapes, so they work with the project's figure and with the owner's own Muse frames
alike. The BOX-3 firmware has no `muse_animate` action yet; the action reaches the web
screen through the `muse_web` event (`script.muse_screen_animate`,
`homeassistant/scripts/muse_screen_animate.yaml`), and through the box's `call_service`
mirror as soon as a firmware declares `muse_animate`.

| Action | Data | Shows |
|---|---|---|
| `muse_web` event, `action: animate` | `motion`, `seconds` (optional), `device` (optional) | the move on the ready screen, then the figure is idle again |

`motion` is one of the names below (English or the German word in brackets), or `stop`
(`stopp`, `aus`) to end the move that runs. `seconds` is 0.5 to 30 (a comma works,
`"2,5"`); without it each move has its own length. `device` limits the move to one screen
(`muse_tab_screen`, ...). The answer is `{"ok": true, "motion": "dance", "seconds": 6,
"on_screen": true}`; an unknown name answers `{"ok": false, "motions": [...]}`.

| `motion` | default | How it looks |
|---|---|---|
| `dance` (tanzen) | 6 s | a bounce on every beat (120 per minute) with a squash where it lands, swaying left and right |
| `party` (Party, Disco) | 8 s | a faster, bigger dance with the waving frames, confetti falling over the screen and coloured disco light sweeping across it |
| `jump` (springen, hüpfen) | 2 s | two jumps: a crouch, a stretched take-off, the flight, a squash on landing |
| `hop` | 0.9 s | one small jump |
| `spin` (drehen) | 2 s | a turn on the spot: the figure narrows, mirrors and widens again, lifting a little |
| `nod` (nicken, ja) | 1.6 s | three nods |
| `shake` (Kopfschütteln, nein) | 1.6 s | a shake of the head, left and right |
| `bow` (verbeugen) | 2.4 s | down, held, up again |
| `shiver` (frieren, kalt) | 3 s | a fast tremble, slightly huddled, with cold marks left and right |
| `sleep` (schlafen, müde) | 8 s | a slow sway and breathing, Zs floating up from the head |
| `love` (Herz, Liebe) | 4 s | a heartbeat pulse (lub-dub) with hearts rising |
| `look` (umschauen) | 3 s | looks left, then right, leaning into each look, back to the middle |
| `celebrate` (feiern, jubeln) | 5 s | jumps with the confetti frames, confetti and a short light sweep |
| `wave` (winken) | 3 s | the waving frames with a gentle sway |

Rules:
- Status poses win: while Muse listens, thinks or speaks, or a card is on screen, the
  move is not drawn. A move asked for while a card shows starts once the ready screen is
  back (within 60 s); cards never move.
- With "Muse folgt mir" the person's offsets add to the move; the person's tilt is damped
  while a move runs, so the two do not pull against each other. A moved figure is
  clipped below the top bar.
- `prefers-reduced-motion`: every move becomes a gentle pulse of size and opacity,
  without travel, turns or particles.
- "Muse bewegt sich von selbst" (settings, Figur, on by default): after 30 to 90 s of a
  still ready screen Muse looks around, hops or nods, softly, never the same one twice
  in a row. Not with reduced motion and not while "Muse folgt mir" sees a person.
- A move is never restored after a reload.

### Muse copies your moves (web screen, camera)

"Muse macht meine Bewegungen nach (Beta)" (settings, Kamera) recognises gestures from the
pose landmarks of the camera (`web/gestures.js`, local only, the same MediaPipe
PoseLandmarker frames as "Muse folgt mir") and answers each with its move. It works in
every layout with a camera (Tab, iPad, Mosaico, the box layout of the Mac app).

| Gesture | Move | Recognised when |
|---|---|---|
| dance | `dance` | a regular bounce (1.2 to 3.5 Hz) or sway (0.6 to 3.5 Hz) over 3 s, on the spot |
| dance with both arms up | `party` | the same with both hands above the head |
| jump | `jump` | shoulders and hips rise at least 0.375 shoulder widths and land again within 0.8 s |
| turn around | `spin` | the shoulder width collapses or the face disappears, then the person faces the camera again at the same place |
| bow | `bow` | shoulders drop and the nose comes down to the shoulder line while the hips stay |
| both arms up, held | `celebrate` | both hands above the head and apart for 0.8 s |
| heart with the hands | `love` | both wrists together at the chest or above the head for 0.6 s |
| arms crossed, hugging oneself | `shiver` | each wrist past the middle towards the other shoulder for 1 s |
| wave | `wave` | one hand above the shoulder moving side to side, or (like "Muse folgt mir") held above the head for 1 s |
| head shake | `shake` | the nose left and right twice while the shoulders stay |
| nod | `nod` | the nose down and up twice while the shoulders stay |
| standing still, head down | `look` | 6 s still with the head lowered (at most every 45 s) |

Each gesture has a confidence and a threshold; the highest-priority gesture over its
threshold wins (the order of the table), each has a cooldown of 4 to 6 s and any two are
at least 2 s apart. A gesture plays only on the plain ready screen (cards and status poses
win; nothing is queued for later) and never replaces a move asked for with `animate`; the
same gesture again extends its move. Each played gesture is logged once, e.g. `gesture
jump (0.82)` (browser console, remote log, HA logbook). The setting is on by default
whenever "Muse folgt mir" is on, and it turns the pose tracker on by itself while the
camera is on.

### Camera mode (web screen: `camera_mode`)

The camera's features are one choice in the Tab and iPad rail (a segmented control of
icons above the action buttons) and in the settings dialog (Kamera, Modus):

| `mode` | Label | Sets |
|---|---|---|
| `off` (aus) | Aus | the camera off; the features keep their last state |
| `follow` (folgen) | Folgen | camera on, "Muse folgt mir" on, copying off, object boxes off |
| `mimic` (nachmachen) | Nachmachen | camera on, "Muse folgt mir" and "Muse macht meine Bewegungen nach" on, object boxes off |
| `detect` (erkennen) | Erkennen | camera on, object boxes and the Vision button on, no pose tracker |
| `all` (alles) | Alles | everything on |

The Vision timer ("Vision jede Minute") is never switched by a mode. Switches set one by
one show no lit segment. From HA:

| Action | Data | Does |
|---|---|---|
| `muse_web` event, `action: camera_mode` | `mode` (English or German, above), `device` (optional) | sets the mode and stores it; an unknown mode is logged and ignored |

```yaml
event: muse_web
event_data:
  action: camera_mode
  mode: nachmachen
  device: muse_tab_screen
```

A camera mode is never restored after a reload (it is stored as settings instead).

### Figure style (web screen: `figure_style`)

A web screen with a figure folder (settings: Figur, Eigene Figur, Bilderordner; `./local`
on the Home Assistant add-on and the Mac) plays one **figure style**, a set of six animated
PNGs: `muse_idle.png`, `muse_wave.png`, `muse_working.png`, `muse_making.png`,
`muse_confetti.png`, `muse_avatar.png`, and the same six under `dark/` for the dark theme.
Since Web 1.8.23 the page first asks for `muse_<name>.webp`, the same frames as one compact
WebP sheet (about 300 KB instead of 5 to 6 MB; `tools/make_figure_sheets.py --src <folder>`
writes them from the PNGs), and for `muse_start.webp`, a single still of idle that is drawn
in the very first frame until the animated idle is decoded; the PNGs stay the fallback.
Today there is one, **Muse**, the files directly in the folder. Another style is a
subfolder plus one line in `figures.json` in the same folder:

```json
{"styles": [
  {"id": "muse", "name": "Muse"},
  {"id": "winter", "name": "Muse Winter", "path": "winter"}
]}
```

`winter` then plays `./local/winter/muse_*.png` and `./local/winter/dark/muse_*.png`.
Without `path` the id is the folder. Muse always stays at the folder itself (an entry
may rename it, not move it), so the first start never waits for the manifest. Ids and
paths take lower-case letters, digits, `-` and `_` only. The folder and the manifest are
the owner's (git and Vercel ignore `web/local/`); the public repository carries no set.
The settings dialog lists the folder's styles under "Figur-Stil".

| Action | Data | Does |
|---|---|---|
| `muse_web` event, `action: figure_style` | `style` (id or name, any case; `placeholder` or `platzhalter` for the neutral placeholder), `device` (optional) | stores the style and loads it; an unknown value is logged and ignored, a style the manifest does not (yet) name shows Muse with a log line |

```yaml
event: muse_web
event_data:
  action: figure_style
  style: muse
  device: muse_tab_screen
```

While a style loads, the figure's place stays empty (after 0.6 s a small grey dot
pulses); nothing else stands in. A style whose pictures all fail leaves the place empty,
logs `figure Muse: no picture arrived, the figure's place stays empty` and tries again
after 10 s, 30 s, 60 s and then every 5 minutes. A figure style is never restored after a
reload (it is stored as a setting instead).

## Pictures

Since 3.4 a task of its own on the second core loads and decodes photos, GIFs, live views
and route maps (`muse_media.h`); the display only copies the finished picture, so nothing
on the box waits for a download any more.

- **Formats** come from the file's first bytes, not from its Content-Type: baseline JPEG,
  progressive JPEG (only its first scan, so at 1/8 of its size and blurred), PNG (with
  transparency over the page colour), GIF (animated, with the frame times of the file,
  looping while the card shows, at most 480 px wide). WebP does not decode.
- **JPEG is reduced while it decodes** (1/2, 1/4, 1/8), as far as it still covers 300 ×
  168. Measured on 07.10.2026: the doorbell picture 1152 × 864 in 0.54 s (online_image
  took 5.6 s), the garage camera 2880 × 1616 in 2.8 s (27 to 32 s), a picture from the
  web in 3.8 s, most of it the TLS handshake. A GIF of 1 MB (400 × 400, 44 frames) loaded
  in 6.3 s and played.
- **Live view**: HA's `camera_proxy` with the camera's token and `&width=300&height=168`
  gave 18 pictures in 15 s.
- **Routes** come from routing.openstreetmap.de (OSRM on OpenStreetMap data, TLS 1.3
  only); the map is stitched from the 256 px tiles of the server in the substitution
  `map_tiles` (OpenStreetMap's own by default, 320 × 210 below the status bar, up to six
  tiles over one kept connection), and the box draws the way, the two points and the
  tiles' attribution itself. Start and destination leave the house with these requests.
  Measured with the static map of 3.4: 1.4 km on foot, 19 min, the card in about 7 s.
- **Limits**: 3 MB per file, 15 s timeout, five redirects. A file that does not come or
  does not decode turns the card into an event card with the reason ("Bild: HTTP 404",
  "Route: ..."), and the log says the same (`muse.media`).
## Sound

Since 3.2 the box has a media player, `media_player.muse_esp32_s3_box_3_screen_speaker`
("Lautsprecher"): sounds and music from a URL, Home Assistant's TTS, Music Assistant.
Home Assistant converts what it sends to FLAC, so OGG, MP3 or WAV all play. An
announcement lays itself over music, which steps back by 20 dB meanwhile. The voice
assistant speaks through the same player. Volume 30 to 90 %, 60 % at start.

The box's own sounds are generated, not downloaded: `make_muse_sounds.py` writes
`sounds/timer.wav` (three rising tones, 1.1 s) and `sounds/ask.wav` (one "pling",
0.35 s), 16 kHz mono, 46 KB of flash together; the media player embeds them (`files:`) and
plays them as announcements over anything else.

Until 3.2 the box made no sound and heard nothing: the audio chips were never set up and
the amplifier was off (section "Hardware"). Both chips fail to set up at boot although
they answer on the bus; the script `audio_init` sets them up again three seconds after
boot until they answer right (first try on every boot since), then starts the speaker
and keeps it running, because starting it with the amplifier on clicked before the first
sound.
