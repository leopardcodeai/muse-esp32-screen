# What leaves the house

The box talks to Home Assistant on the local network and to nothing else, with these
exceptions, each of which you can switch off by not using the feature:

| Feature | Goes to | What exactly | Policy |
|---|---|---|---|
| the microphone in the web screen (push-to-talk) | Home Assistant's Assist pipeline (local or cloud, as you configured it) | your voice while the button is held | Home Assistant's |
| the camera in the web screen (local person boxes, photo card) | nowhere | the video stays in the browser; no image leaves the device | yours |
| the camera brightness | nowhere | the mean luma stays in the browser | yours |
| the Vision button (`ai_task.generate_data`) | the AI Task provider configured in Home Assistant (Google AI by default) | one JPEG per press, uploaded to `/media/muse-camera/` first, then deleted | the provider's |
| the person detector | jsDelivr and Google Storage | the download of the MediaPipe JavaScript, WASM and EfficientDet-Lite0 model, about 14 MB on the first camera start; no image | [4] [5] |
| a picture from the web (`muse_show_image`, `muse_show_image_timed`, `muse_show_live`) | the host in the URL | the URL you send, the box's user agent | yours |
| a route (`muse_show_route`) | routing.openstreetmap.de (FOSSGIS e.V.), the tile server in `map_tiles` (tile.openstreetmap.org by default, OpenStreetMap Foundation), nominatim.openstreetmap.org for place names | start and destination coordinates or names, the tiles around the route (which say where it is) | [1] [2] [3] |
| the voice assistant | Home Assistant's pipeline (local or cloud, as you configured it) | your voice | Home Assistant's |
| Spotify through Music Assistant | Spotify | what you play | Spotify's |
| the firmware build | GitHub, jsDelivr, Google Fonts, PlatformIO registry | downloads of fonts, icons, libraries | theirs |

Nothing is sent to LeopardCode.AI, and the firmware has no telemetry.

The user agent of the box's own picture task names this repository, as the tile and
routing services ask for a way to reach whoever sends requests
(`Muse-ESP32-Screen/4.3 (ESPHome; +https://github.com/leopardcodeai/muse-esp32-screen)`).
Until 4.0 the map came as one picture from maps.wikimedia.org; its terms allow that for
Wikimedia projects only, so 4.1 switched to tiles from a server you choose.

[1] FOSSGIS e.V., routing.openstreetmap.de usage policy, https://routing.openstreetmap.de/about.html
[2] OpenStreetMap Foundation, Tile usage policy, https://operations.osmfoundation.org/policies/tiles/ (a distinct user agent, light use, attribution on the map; the card shows it)
[3] OpenStreetMap Foundation, Nominatim usage policy, https://operations.osmfoundation.org/policies/nominatim/

[4] jsDelivr, MediaPipe Tasks Vision package, https://www.jsdelivr.com/package/npm/@mediapipe/tasks-vision (the runtime and WASM files)
[5] Google AI Edge, EfficientDet-Lite0 object detector model, https://developers.google.com/edge/mediapipe/solutions/vision/object_detector (the model file)

## The web screen's camera and microphone

The camera beta is off until the owner switches it on. Local person boxes and the
brightness estimate never leave the browser. The Vision button uploads exactly one JPEG
to the owner's Home Assistant, which passes it to the configured AI Task provider, and
the app deletes the file after the answer. An optional "Vision automatisch" does the
same once a minute and is off by default. The microphone is open only while the
push-to-talk button is held; the audio goes to Home Assistant's Assist pipeline and
never to Meta Muse. The Muse bridge is text-only.
