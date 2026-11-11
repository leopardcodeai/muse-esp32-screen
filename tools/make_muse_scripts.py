#!/usr/bin/env python3
"""Writes the Home Assistant scripts of one Muse screen family.

What: emits `muse_screen_<action>` (the public entry point) and
`muse_box_<action>` (the BOX-3 helper) for every display action. The public script fires
the `muse_web` event first, then starts the box helper through `script.turn_on` with
`variables:`. A blocking `ask` on the box therefore never delays the browser, the camera
add-on or the ESP-Mosaico app, which all listen to the event.

Why a generator: the 19 actions share one shape, and a field added to one place must not
drift between the YAML, the live Home Assistant config and the tests.

Pitfalls:
  * `script.turn_on` needs the fields under `data.variables`, not directly under `data`
    (a flat `data:` answers HTTP 400; measured 11.11.2026).
  * The box prefix is the device's ESPHome name with underscores. The default is the
    owner's live name; pass `--box-prefix` for a box flashed with the public name.
  * The public script needs `mode: parallel`, or a second action waits behind a question.
  * `wait_answer`, `get_state` and `hw_check` stay device-specific: they return a
    response or wait on the box that shows the question.

Usage:
  python3 tools/make_muse_scripts.py
  python3 tools/make_muse_scripts.py --box-prefix muse_esp32_s3_box_3_screen
  python3 tools/make_muse_scripts.py --stdout
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "homeassistant" / "scripts" / "muse_screen.yaml"
DEFAULT_BOX = "muse_esp32boxs3_screen"

# action -> fields in the order the assistant sends them
ACTIONS: dict[str, tuple[str, ...]] = {
    "set_status": ("status",),
    "set_status_text": ("status", "label"),
    "show_text": ("title", "message"),
    "show_value": ("label", "value", "unit"),
    "show_weather": ("condition", "temperature", "message"),
    "show_event": ("icon", "title", "message"),
    "show_image": ("title", "message", "url"),
    "show_image_timed": ("title", "message", "url", "seconds"),
    "show_live": ("title", "url", "seconds"),
    "show_route": ("title", "from", "to", "mode"),
    "show_agenda": ("title", "events"),
    "show_list": ("title", "items"),
    "show_timer": ("label", "duration"),
    "cancel_timer": ("label",),
    "ask": ("question", "yes_label", "no_label"),
    "choose": ("question", "options"),
    "celebrate": ("title", "message"),
    "draw": ("scene",),
    "clear": (),
}

MULTILINE = {"items", "events", "scene"}
NAMES = {
    "set_status": "Set status",
    "set_status_text": "Set status with label",
    "show_text": "Show text",
    "show_value": "Show value",
    "show_weather": "Show weather",
    "show_event": "Show event",
    "show_image": "Show image",
    "show_image_timed": "Show image for seconds",
    "show_live": "Show live view",
    "show_route": "Show route",
    "show_agenda": "Show agenda",
    "show_list": "Show list",
    "show_timer": "Show timer",
    "cancel_timer": "Cancel timer",
    "ask": "Ask yes or no",
    "choose": "Ask with choices",
    "celebrate": "Celebrate",
    "draw": "Draw a scene",
    "clear": "Clear every card",
}


def fields(action: str) -> dict:
    out = {}
    for name in ACTIONS[action]:
        selector = {"multiline": True} if name in MULTILINE else {}
        out[name] = {"name": name.replace("_", " ").title(), "required": True, "selector": {"text": selector}}
    return out


def local_fields(action: str) -> dict:
    return {name: "{{ " + name + " }}" for name in ACTIONS[action]}


def guard(action: str) -> str:
    return f"{{{{ states('script.muse_box_{action}') not in ['unknown', 'unavailable'] }}}}"


def box_script(action: str, box_prefix: str) -> dict:
    call = {"action": f"esphome.{box_prefix}_muse_{action}", "continue_on_error": True}
    if ACTIONS[action]:
        call["data"] = local_fields(action)
    return {
        "alias": f"Muse box {NAMES[action].lower()}",
        "mode": "parallel",
        "max": 20,
        "fields": fields(action),
        "sequence": [call],
    }


def public_script(action: str) -> dict:
    event_data = {"action": action, **local_fields(action)}
    start = {"action": "script.turn_on", "target": {"entity_id": f"script.muse_box_{action}"}}
    if ACTIONS[action]:
        start["data"] = {"variables": local_fields(action)}
    return {
        "alias": f"Muse screen {NAMES[action].lower()}",
        "mode": "parallel",
        "max": 20,
        "fields": fields(action),
        "sequence": [
            {"event": "muse_web", "event_data": event_data},
            {
                "choose": [
                    {
                        "conditions": [{"condition": "template", "value_template": guard(action)}],
                        "sequence": [start],
                    }
                ]
            },
        ],
    }


def build(box_prefix: str = DEFAULT_BOX) -> dict:
    scripts = {}
    for action in ACTIONS:
        scripts[f"muse_box_{action}"] = box_script(action, box_prefix)
        scripts[f"muse_screen_{action}"] = public_script(action)
    return scripts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--box-prefix", default=DEFAULT_BOX)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--stdout", action="store_true")
    args = parser.parse_args()

    text = "# Generated by tools/make_muse_scripts.py; edit the generator, not this file.\n"
    text += yaml.safe_dump(build(args.box_prefix), sort_keys=False, allow_unicode=True, width=1000)
    if args.stdout:
        sys.stdout.write(text)
        return
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(text, encoding="utf-8")
    print(f"wrote {args.out} ({len(ACTIONS) * 2} scripts)")


if __name__ == "__main__":
    main()
