# Muse Screen: device layer, Mosaico default, dark AMOLED — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One `script.muse_screen_*` entry point reaches the browser, the camera/Apple TV view, the ESP-Mosaico app and the BOX-3; the web app defaults to the 480 x 480 Mosaico layout with a switchable dark AMOLED theme.

**Architecture:** Home Assistant scripts fire the existing `muse_web` event first and then start the BOX-3 helper in the background. The browser and the ESP-Mosaico app subscribe to the event; the camera add-on renders the web app. The web app keeps the light box layout as a setting and adds a dark palette for the square layout.

**Tech Stack:** Home Assistant scripts/automations (YAML + REST API), plain ES modules in `web/`, Node's test runner, ESP-IDF/GSP for the Mosaico app.

---

### Task 1: Public Home Assistant scripts

**Files:**
- Create: `tools/make_muse_scripts.py`
- Create: `homeassistant/scripts/muse_screen.yaml`
- Test: `tools/tests/test_muse_scripts.py`

- [ ] **Step 1: Write the failing test** — assert 19 actions, the fields per action, and that every action except `clear` has at least one field.
- [ ] **Step 2: Run it and see it fail** — `pytest tools/tests/test_muse_scripts.py -v`.
- [ ] **Step 3: Write the generator** — a table of `(action, fields, multiline)`; the YAML writer emits 19 `muse_screen_<action>` scripts and 19 `muse_box_<action>` helpers. Each public script is `mode: parallel`, `max: 20`, fires `muse_web`, then a guarded `script.turn_on` to the box helper with `data: {variables: {...}}`.
- [ ] **Step 4: Generate and test** — `python3 tools/make_muse_scripts.py && pytest tools/tests/test_muse_scripts.py -v`.
- [ ] **Step 5: Deploy live** — POST each script config to `/api/config/script/config/<id>`, reload `script`, then delete `muse_broadcast_*`, `muse_ask_fast`, `muse_ask_event`, `muse_test_event` by removing their config entries.
- [ ] **Step 6: Verify** — call `script.muse_screen_show_text`; the web logs the action and the box reports `text / <title>`. Call `script.muse_screen_ask`; it returns in under 0.1 s.
- [ ] **Step 7: Commit** — `git add tools/make_muse_scripts.py tools/tests/test_muse_scripts.py homeassistant/scripts/muse_screen.yaml && git commit -m "Add the muse_screen entry point for every screen"`.

### Task 2: Common answer entity

**Files:**
- Create: `homeassistant/automations/muse_screen_answer.yaml`
- Create: `homeassistant/scripts/muse_screen_answer.yaml`
- Live: `input_text.muse_screen_answer`

- [ ] **Step 1: Add the helper** — `input_text.muse_screen_answer` (255 chars) through the HA config API.
- [ ] **Step 2: Add the automations** — one listens to `muse_web_answer` and writes `"<answer>: <question>"`; one listens to `sensor.muse_esp32boxs3_screen_antwort` changes and copies its state. Both write the same `input_text`.
- [ ] **Step 3: Add the template sensor** — `sensor.muse_screen_answer` reads the input_text. If the live template cannot be created without a restart, expose the `input_text` and note it in `docs/ACTIONS.md`.
- [ ] **Step 4: Test** — web tap on `/api/services/script/muse_screen_ask` writes `input_text.muse_screen_answer`; a box tap changes the same entity through the copy automation.
- [ ] **Step 5: Commit** — `git add homeassistant/automations/muse_screen_answer.yaml homeassistant/scripts/muse_screen_answer.yaml && git commit -m "One answer entity for every Muse screen"`.

### Task 3: Web defaults and settings

**Files:**
- Modify: `web/settings.js`
- Modify: `web/index.html`
- Modify: `web/app.js`
- Test: `web/test/settings.test.js`

- [ ] **Step 1: Write the failing tests** — `DEFAULTS.layout === "square"`; `DEFAULTS.theme === "auto"`; an old stored setting without `layoutVersion` loads as `square`; a stored `{layoutVersion: 2, layout: "box"}` stays `box`; `themeFor("dark", {theme: "auto"}, "square") === "dark"`; `themeFor("light", {theme: "auto"}, "box") === "light"`; `?theme=light` wins.
- [ ] **Step 2: Run them and see them fail** — `node --test web/test/settings.test.js`.
- [ ] **Step 3: Implement settings** — add `THEMES = ["auto", "dark", "light"]`, `DEFAULTS.layout = "square"`, `DEFAULTS.theme = "auto"`, `DEFAULTS.layoutVersion = 2`; in `loadSettings`, if `stored.layoutVersion` is missing, set `layout = "square"` once; add `themeFor(search, settings, layout)`.
- [ ] **Step 4: Add the form controls** — Layout options square first with "(Standard)"; new Design select `Automatisch / Dunkel (AMOLED) / Hell`; read and save `form.theme`.
- [ ] **Step 5: Apply the theme** — `app.js` imports `themeFor` and `applyTheme`; before the first render: `const theme = themeFor(location.search, settings, layout); applyTheme(theme); document.documentElement.dataset.theme = theme;`. On save, apply it live and remove `?theme=` with `history.replaceState`.
- [ ] **Step 6: Run the tests** — `node --test web/test/settings.test.js` passes.
- [ ] **Step 7: Commit** — `git add web/settings.js web/index.html web/app.js web/test/settings.test.js && git commit -m "Default the web twin to the Mosaico layout and add a theme setting"`.

### Task 4: Dark AMOLED palette

**Files:**
- Create: `web/theme.js`
- Modify: `web/render.js`
- Modify: `web/square.js`
- Modify: `web/tables.js`
- Modify: `web/style.css`
- Test: `web/test/theme.test.js`

- [ ] **Step 1: Write the failing test** — `PALETTES.dark.page` is `[0, 0, 0]`, `card` is `[20, 20, 22]`, `ink` is `[245, 245, 247]`, `edge` is `[44, 44, 46]`, and the pills match the spec; `applyTheme("dark")` updates the render tokens and `PILLS`.
- [ ] **Step 2: Run it and see it fail** — `node --test web/test/theme.test.js`.
- [ ] **Step 3: Implement `theme.js`** — export `PALETTES` with the light and dark token tables; `applyTheme(name)` calls `setPalette` in `render.js` and mutates `PILLS[i].color`.
- [ ] **Step 4: Make the render tokens swappable** — in `render.js`, change the palette `const` to `let` and add `setPalette(p)` that assigns `PAGE`, `INK`, `SUB`, `CARD`, `TXT`, `SHADOW`, `ORANGE` (light values stay the defaults).
- [ ] **Step 5: Draw the dark edge** — in `square.js`, `panel()` and `drawBubble()` call `r.roundRectOutline(..., 1, EDGE)` when `PALETTES.dark` is active; `shadowed()` skips the shadow when the edge is set.
- [ ] **Step 6: Style the page** — `style.css` gets `html[data-theme="dark"]` overriding `--page`, `--ink`, `--sub`, `--card`, `--shadow`, `--accent`; the stage keeps the same size.
- [ ] **Step 7: Run the tests** — `node --test web/test/theme.test.js` and `node --test web/test/square.test.js` pass.
- [ ] **Step 8: Commit** — `git add web/theme.js web/render.js web/square.js web/tables.js web/style.css web/test/theme.test.js && git commit -m "Add the dark AMOLED theme for the square layout"`.

### Task 5: Square stage and frame budget

**Files:**
- Modify: `web/app.js`
- Modify: `web/pace.js`
- Test: `web/test/pace.test.js`

- [ ] **Step 1: Write the failing test** — `fitScale(960, 960, 480, 480)` is `2`; `stageScale(2000, 2000, 480, 480, false, "square")` caps at `2`; `stageScale(..., "box")` keeps the old behavior.
- [ ] **Step 2: Run it and see it fail** — `node --test web/test/pace.test.js`.
- [ ] **Step 3: Implement the cap** — add `stageScale(w, h, lw, lh, integer, layout)` that calls `fitScale` and caps square at `2`; `app.js` uses it in `fit()`.
- [ ] **Step 4: Add the frame guard** — measure `performance.now()` around `display.render()`; keep a median of the last 60 draws; if it exceeds 20 ms, set `quality = Math.max(0.5, quality - 0.25)` and call `fit()` once, logging the new scale.
- [ ] **Step 5: Run the tests** — `node --test web/test/pace.test.js` passes.
- [ ] **Step 6: Commit** — `git add web/app.js web/pace.js web/test/pace.test.js && git commit -m "Cap the square stage at 2x and guard the frame budget"`.

### Task 6: Mosaico app listens to muse_web

**Files:**
- Modify: `~/Coding/esp/apps/muse/main/main.c`
- Modify: `~/Coding/esp/apps/muse/components/app_muse/ui/make_scene.py`
- Modify: `~/Coding/esp/apps/muse/MUSE_MOSAICO.md`
- Create: `docs/MOSAICO.md`

- [ ] **Step 1: Patch the subscription** — after `auth_ok`, send two `subscribe_events` messages: `call_service` and `muse_web`.
- [ ] **Step 2: Patch the event handler** — read `event.event_type`; for `muse_web`, take `event.data.action` as the action and every other key as a field; for `call_service`, keep the existing box-prefix path. Both build the same `action_msg_t`.
- [ ] **Step 3: Silence the button warning** — give the invisible top-bar button `bg_color` = the page colour `#F3F3F3` with `bg_opacity: 0`; regenerate `main.json` with `python3 components/app_muse/ui/make_scene.py`.
- [ ] **Step 4: Verify the host build** — `./sim.sh --frame` still writes `frame.png`; open it and confirm the 480 x 480 ready screen.
- [ ] **Step 5: Verify the device build** — `cd ~/Coding/esp/workspace && python3 mosaico.py iris system-update --project ../apps/muse --help` and the normal build path; record whether it needs the board or only compiles.
- [ ] **Step 6: Write the install guide** — `docs/MOSAICO.md`: read V1.2/V1.0, `python3 mosaico.py recover`, `iris system-update --project ../apps/muse`, Vibe Mode "Save Current Build", `tools/provision.py --port ...`, reboot, open Muse, check a card and an answer. Mark hardware steps as "with the board".
- [ ] **Step 7: Commit** — in `~/Coding/esp/apps/muse`: `git add main/main.c components/app_muse/ui/make_scene.py MUSE_MOSAICO.md && git commit -m "Mosaico: mirror muse_web, the common screen event"`. In the Muse repo: `git add docs/MOSAICO.md && git commit -m "Document the Mosaico install"`.

### Task 7: Documentation and prompt

**Files:**
- Modify: `README.md`
- Modify: `web/README.md`
- Modify: `docs/SQUARE_LAYOUT.md`
- Modify: `docs/ACTIONS.md`
- Modify: `docs/ASSISTANT_PROMPT.md`
- Modify: `homeassistant/README.md`
- Modify: `CHANGELOG.md`
- Modify: `web/display.js`
- Modify: `homeassistant/addon/muse-web-screen/config.yaml`

- [ ] **Step 1: README** — Mosaico first as the standard, BOX-3 second; web twin as the no-hardware path; the 480 x 480 screenshot leads.
- [ ] **Step 2: SQUARE_LAYOUT** — the panel data table, both palettes, the "theme changes chrome, never scenes" rule.
- [ ] **Step 3: ACTIONS** — the 19 public scripts, the event schemas, the answer entity, and the note that `wait_answer`, `get_state`, `hw_check` stay device-specific.
- [ ] **Step 4: Prompt** — replace both language blocks with the appendix text; English first, German second.
- [ ] **Step 5: Versions and changelog** — `web/display.js` VERSION `1.6.0`; add-on `1.0.1` → `1.0.2`; changelog entry for 11 November 2026.
- [ ] **Step 6: Commit** — `git add README.md web/README.md docs/SQUARE_LAYOUT.md docs/ACTIONS.md docs/ASSISTANT_PROMPT.md homeassistant/README.md CHANGELOG.md web/display.js homeassistant/addon/muse-web-screen/config.yaml && git commit -m "Document Muse Screen 1.6.0: Mosaico first, one entry point, dark theme"`.

### Task 8: Verification, deploy, GitHub

**Files:**
- Generated: `web/local/ha-bundle/` (git-ignored), live `/config/www/muse-web/`
- Live: `homeassistant/addon/muse-web-screen/` 1.0.2

- [ ] **Step 1: Host tests** — `node --test web/test` (all), `pytest tools/`, `python3 tools/check_private.py`; fix failures.
- [ ] **Step 2: Live scripts** — run all 19 from `script.muse_screen_*`; web event under 300 ms, box mode/title matching, `ask` under 0.1 s, answer sensor, reload restore.
- [ ] **Step 3: Themes** — screenshot 480 x 480 dark and light; check `?layout=box` still renders the box view; check the Apple TV/camera add-on URL with `theme=dark`.
- [ ] **Step 4: Mosaico** — `./sim.sh --frame`; keep `frame.png` out of git; the install guide's commands dry-run.
- [ ] **Step 5: Deploy web** — `tools/make_ha_bundle.sh`, copy `config/www/muse-web` to HA, bump the add-on to 1.0.2 and rebuild/install the local add-on.
- [ ] **Step 6: GitHub** — commit remaining changes, `git push origin main`; Vercel deploys from the same branch; check the live demo opens in square/dark.
- [ ] **Step 7: Final report** — exact service names, field table, event schemas, measured latencies, and what is still "with the board".

---

## Self-review

- **Spec coverage:** sections 1–8 map to tasks 1–8. The Mosaico app and install guide are tasks 6 and 7.
- **Placeholder scan:** no TBD/TODO; every task names files, commands and expected results.
- **Type consistency:** `themeFor`, `applyTheme`, `stageScale`, `PALETTES`, `muse_screen_<action>` and `muse_box_<action>` are used with the same names in every task.
