"""Tests for the generated muse_esp32_screen Home Assistant scripts (no HA needed).

Run from the project folder:
  python3 -m pytest tools/tests/test_muse_scripts.py -q
"""
from __future__ import annotations

import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))

import make_muse_scripts as gen  # noqa: E402


def test_every_action_has_a_public_script_and_a_box_helper():
    scripts = gen.build()
    assert len(scripts) == len(gen.ACTIONS) * 2
    for action in gen.ACTIONS:
        assert f"muse_esp32_screen_{action}" in scripts
        assert f"muse_box_{action}" in scripts
    assert not any("muse_broadcast" in key for key in scripts)


def test_the_event_comes_before_the_box_and_never_blocks():
    scripts = gen.build()
    for action, fields in gen.ACTIONS.items():
        sequence = scripts[f"muse_esp32_screen_{action}"]["sequence"]
        assert sequence[0]["event"] == "muse_web"
        assert sequence[0]["event_data"]["action"] == action
        for name in fields:
            assert sequence[0]["event_data"][name] == "{{ " + name + " }}"
        start = sequence[1]["choose"][0]["sequence"][0]
        assert start["action"] == "script.turn_on"
        assert start["target"]["entity_id"] == f"script.muse_box_{action}"
        if fields:
            assert start["data"]["variables"] == {name: "{{ " + name + " }}" for name in fields}
        else:
            assert "data" not in start


def test_the_box_helper_calls_the_esphome_service():
    scripts = gen.build("muse_esp32boxs3_screen")
    call = scripts["muse_box_ask"]["sequence"][0]
    assert call["action"] == "esphome.muse_esp32boxs3_screen_muse_ask"
    assert call["continue_on_error"] is True
    assert call["data"] == {"question": "{{ question }}", "yes_label": "{{ yes_label }}", "no_label": "{{ no_label }}"}


def test_clear_has_no_fields_and_no_variables():
    scripts = gen.build()
    assert scripts["muse_esp32_screen_clear"]["fields"] == {}
    assert scripts["muse_box_clear"]["fields"] == {}
    assert "data" not in scripts["muse_box_clear"]["sequence"][0]


def test_the_yaml_round_trips_and_keeps_the_field_selectors():
    text = yaml.safe_dump(gen.build(), sort_keys=False, allow_unicode=True)
    parsed = yaml.safe_load(text)
    assert parsed["muse_esp32_screen_show_list"]["fields"]["items"]["selector"]["text"]["multiline"] is True
    assert parsed["muse_esp32_screen_show_text"]["fields"]["title"]["selector"]["text"] == {}
    assert parsed["muse_esp32_screen_ask"]["mode"] == "parallel"
    assert parsed["muse_esp32_screen_ask"]["max"] == 20
