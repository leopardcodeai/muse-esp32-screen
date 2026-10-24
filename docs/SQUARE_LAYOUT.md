# Square layout: Muse on 480 x 480

One design for three renderers, so that they show the same thing:

| Renderer | Where | Status |
|---|---|---|
| ESP-Mosaico firmware (ESP32-S31, 2.16" 480 x 480 touch display) | an ESP-GSP scene and a C controller, built in Espressif's simulator (to be published here once tested on the board) | in work |
| Muse Web Screen, square mode | `web/` of this repository, `?layout=square` (`web/square.js`) | done 24.10.2026: every action, demo, motion; route and scene scaled from the box |
| Muse camera for Home Assistant | a local Home Assistant add-on that renders `web/` in Chromium and serves it as a camera (for Apple TV picture in picture) | in work |

The 320 x 240 layout of the ESP32-S3-BOX-3 stays as it is. This file is the source for the square
one; a renderer that differs from it is wrong, not the file.

## Canvas, colours, fonts

- Logical canvas 480 x 480, origin top left. The web renderer scales it with its aspect kept, like
  the 320 x 240 one.
- Colours (same names as `web/render.js`): `PAGE #F3F3F3` background, `INK #1C1C1E`, `SUB #636368`,
  `CARD #FFFFFF`, `TXT #2C2C2E`, `SHADOW #E2E2E7`, `ORANGE #FF9500`.
- Status colours and default status texts (`PILLS` in `web/tables.js`): ready `#34C759` „Bereit",
  listening `#0A84FF` „Ich höre zu …", thinking `#FF9F0A` „Ich denke nach …", speaking `#BF5AF2`
  „Ich antworte …", error `#FF453A` „Da ging etwas schief", off `#8E8E93` „Ruhe".
- Fonts: Inter Medium (500), Bold (700), ExtraBold (800); Material Design Icons 7.4.47 for event and
  weather glyphs (same code points as `EVENTS` in `web/tables.js`).
- Figure: the project's own frames in `web/figure-default/` (idle, wave, working, making,
  confetti, avatar). Pose per status: ready idle, listening wave, thinking working, speaking
  making, error idle, off idle at 40 % opacity; celebrate confetti. Meta's Muse frames are never
  part of a commit or an image; they come only from a local folder at run time.

## Regions

Every screen has the top bar (y 0 to 62), like a phone's status bar and like the box's top bar
(`drawTopBar` in `web/cards.js`); the content starts at y 62 below it. The ready screen shows the
status once, in the bubble under the figure (as the box's `drawStatus` shows its pill); there is
no status pill in the top bar and no second status line. A tap on the top bar shows the display
about itself.

| Element | x | y | w | h | Style |
|---|---|---|---|---|---|
| Name | 24 | 10 | 120 | 44 | top bar: Inter 800 30 INK, left, vertically centred, ellipsis (default „Muse") |
| Clock | 165 | 12 | 150 | 40 | top bar: Inter 700 28 INK, centred, `H:MM`; when the timer chip and the queue badge both show and would reach into it, it moves right so that its text starts 12 px after the last chip |
| Connection dot | 444 | 26 | 12 | 12 | top bar: green connected, ORANGE connecting, teal demo, red off (the box's colours) |
| Timer chip and queue badge | 116 | 16 | 64 (grows with the text) | 32 | top bar, right after the name: ORANGE, radius 16, Inter 800 19 white, centred, 8 apart; the soonest timer's time left first (not on the timer card), then „+N" of waiting cards (not on the ready screen); hidden when there is nothing to show |
| Idle figure | 100 | 62 | 280 | 280 | contain |
| Status bubble | 105 | 358 | 270 | 52 | the one status on the ready screen: CARD, radius 26, shadow 0 2 8 rgba(0,0,0,.10); dot 12 at bubble x 20 (centred vertically) in the status colour; text Inter 700 21 INK centred in bubble x 40 to 254, ellipsis |
| Celebration title | 24 | 350 | 432 | 40 | replaces the bubble: Inter 800 32 INK, centred, top at y 350, one line |
| Celebration message | 24 | 402 | 432 | 26 | Inter 500 20 SUB, centred, top at y 402, one line, ellipsis |
| Card avatar or disc | 24 | 72 | 84 | 84 | avatar image, or a disc radius 42 in the icon colour with a 48 px glyph in white |
| Card title | 124 | 72 | 332 | 84 | Inter 800 30 INK, up to 2 lines, vertically centred, ellipsis |
| Panel | 24 | 176 | 432 | 272 | CARD, radius 28, shadow 0 4 16 rgba(0,0,0,.08); inner padding 24 |

Panel contents, coordinates relative to the panel:

| Card | Content |
|---|---|
| text (`show_text`) | body Inter 500 24 TXT, line height 32, at (24, 22, 384, 228), wraps, clips with „…" |
| value (`show_value`) | value Inter 800 104 INK centred at (24, 36, 384, 120); unit Inter 700 30 SUB centred at (24, 160, 384, 44) |
| weather (`show_weather`) | disc in the weather colour with its glyph; title the condition in German; value the temperature with „°"; unit line the message, one line |
| event (`show_event`) | disc with the event's glyph and colour; title; body as for text |
| image (`show_image`, `show_live`) | the picture fills the panel (cover, radius 28); title above as usual; message, if any, as a 1-line caption on a 50 % white strip at the panel's bottom |
| list (`show_list`) | up to 5 rows of 48 px from y 14: a 10 px ORANGE dot at x 24, text Inter 500 24 TXT at x 46; more than 5: last row „+N weitere" in SUB |
| agenda (`show_agenda`) | title empty gives „Heute"; rows as list, time Inter 700 20 SUB in a 110 px column, text Inter 500 22 TXT after it |
| ask (`show_ask`/`muse_ask`) | question Inter 700 24 INK at (24, 22, 384, 96), up to 3 lines; buttons below |
| choose (`muse_choose`) | as ask, two to four options |
| timer (`show_timer`) | arc 196 x 196 at (118, 18), thickness 16, track SHADOW, fill ORANGE, full at start; time left Inter 800 44 INK centred in the arc (`m:ss`, `h:mm:ss` above an hour) |
| route, scene (`show_route`, `draw`) | web and camera: as on the box, scaled into the panel; firmware: a text card until ported |

Buttons (ask, choose): grid of 2 x 2 at (16 + col × 208, 128 + row × 68), 192 x 56, radius 28,
INK with Inter 700 20 white text, centred, one line, ellipsis. Ask uses the bottom row (row 1):
yes left, no right. A pressed button shows ORANGE for 150 ms.

## Behaviour

- Queue of up to 8 cards. A card with the title of the one on screen replaces it at once; a
  doorbell event (`icon` klingel/doorbell/bell) goes first. The badge shows how many wait.
- Dwell: 20 s, then the next card or idle. Questions: until answered, at most 60 s (then the answer
  `none`). Timer: until it ends, then „Fertig" for 5 s. A tap on the panel shows the next card.
- Answers go back as the box sends them: `<answer>: <question>`, `none: <question>` on time-out.
- Status: `set_status` changes the bubble and the pose; `set_status_text` replaces only the bubble's
  text until the status changes. `clear` empties the queue and returns to idle.
- Celebrate: idle layout with the confetti pose, the title and the message in the bubble's place,
  for 6 s; the web and camera renderers add a particle burst (the box's formula).

## Motion

| What | Web and camera | Firmware (ESP-GSP) |
|---|---|---|
| Card in | slide up 24 px and fade in, 220 ms, ease-out | the same where the runtime animates position and opacity, else a cut |
| Card out | fade out 160 ms | cut |
| Bubble dot | pulse (scale 1 to 1.3, 1.2 s) while listening or thinking | colour change only |
| Figure | its own APNG frames | the same frames |
| Timer arc | smooth per frame | once a second |

The web renderer draws at the display's own resolution up to 60 fps from the time in
milliseconds; the camera renders at its output rate and only encodes frames that changed.
