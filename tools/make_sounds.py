#!/usr/bin/env python3
"""make_muse_sounds.py: the box's own short sounds, generated instead of downloaded.

What: writes sounds/timer.wav (a timer ran out: three rising soft bell tones, about
  1.45 s) and sounds/ask.wav (a question appeared: one soft "pling", 0.50 s). 16 kHz,
  mono, 16 bit, so the two together take about 62 KB of flash. The media player embeds
  them (`files:` in the firmware) and plays them with
  media_player.speaker.play_on_device_media_file.
Why: a timer that ends silently is no timer, and a question that nobody notices gets
  no answer. Generated tones carry no licence and need no network at build time.
Pitfalls:
  * Sine tones with a soft attack and an exponential decay; a hard start clicks on
    the box's small speaker.
  * Change the files, then rebuild: ESPHome reads them at build time.
Usage:
  python3 make_muse_sounds.py --dry-run
  python3 make_muse_sounds.py
"""
import argparse
import math
import struct
import sys
import wave
from pathlib import Path

HERE = Path(__file__).resolve().parent
RATE = 16000


def bell(freq, start, length, volume, out):
    """A soft FM bell: a gentle attack, a long decay and a quiet octave shimmer."""
    n0 = int(start * RATE)
    for i in range(int(length * RATE)):
        t = i / RATE
        env = min(1.0, t / 0.008) * math.exp(-t * 3.2)
        mod = 0.9 * math.exp(-t * 2.2) * math.sin(2 * math.pi * freq * 2.0 * t)
        car = math.sin(2 * math.pi * freq * t + mod)
        car += 0.12 * math.sin(2 * math.pi * freq * 2 * t) * math.exp(-t * 5.0)
        if n0 + i < len(out):
            out[n0 + i] += volume * env * car


def render(notes, total):
    out = [0.0] * int(total * RATE)
    for freq, start, length, volume in notes:
        bell(freq, start, length, volume, out)
    # One-pole low-pass: the little speaker gets a round tone instead of a bright edge.
    alpha, y = 0.7, 0.0
    for i, x in enumerate(out):
        y += alpha * (x - y)
        out[i] = y
    # Fade the last 40 ms to zero; a cut at the buffer end clicks.
    fade = int(0.04 * RATE)
    for i in range(min(fade, len(out))):
        out[-1 - i] *= i / fade
    peak = max(abs(v) for v in out) or 1.0
    return b"".join(struct.pack("<h", int(max(-1.0, min(1.0, v / peak * 0.65)) * 32767)) for v in out)


SOUNDS = {
    # C6, E6, G6: a small rising bell arpeggio with a longer, softer tail.
    "timer.wav": ([(1046.5, 0.0, 0.55, 0.8), (1318.5, 0.20, 0.55, 0.8), (1568.0, 0.40, 1.0, 1.0)], 1.45),
    # One soft A6 bell with a quiet fifth above.
    "ask.wav": ([(1760.0, 0.0, 0.50, 1.0), (2637.0, 0.0, 0.35, 0.18)], 0.50),
}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="say what would be written, write nothing")
    args = ap.parse_args()
    out_dir = HERE.parent / "firmware" / "sounds"
    for name, (notes, total) in SOUNDS.items():
        data = render(notes, total)
        path = out_dir / name
        state = "unveraendert" if path.exists() and path.read_bytes()[44:] == data else ("neu" if not path.exists() else "geaendert")
        print(f"  {name}: {total:.2f} s, {len(data) + 44} Bytes, {state}")
        if args.dry_run or state == "unveraendert":
            continue
        out_dir.mkdir(exist_ok=True)
        with wave.open(str(path), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(RATE)
            w.writeframes(data)
    if args.dry_run:
        print("(Probelauf, nichts geschrieben)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
