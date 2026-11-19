#!/usr/bin/env python3
"""Builds the Muse figure for the web screen from the installed Muse app (private use only).

What: cuts the Hatch*.mp4 animations of /Applications/Muse.app at their own 24 fps into
  animated PNGs of SIZE x SIZE for web/local/muse_<name>.png, faded into the page colour
  by the squircle vignette of make_muse_assets.py, then writes the dark set to
  web/local/dark through make_figure_dark.py. The avatar is left alone (it is a still).
Why: the first web set was 280 px at 15 fps with 48 frames, sampled down from the
  24 fps originals; the figure moved in visible steps on the tablet (owner, 19.11.2026:
  "Muse smoother"). Meta publishes no other source; the app's own videos (512 px,
  24 fps) are the best there is, so every original frame is kept.
Usage:
  uv run --python 3.14 --with pillow --with numpy tools/make_muse_web.py            # build what is missing
  uv run --python 3.14 --with pillow --with numpy tools/make_muse_web.py --force    # rebuild everything
  uv run --python 3.14 --with pillow --with numpy tools/make_muse_web.py --dry-run  # show the plan
Pitfalls:
  * Meta's artwork: web/local is ignored by git and Vercel and must never be published.
  * Memory: the page decodes every frame. SIZE 320 and about 3 s per clip keep one clip
    near 30 MB decoded; more pixels or longer clips grow that linearly.
  * The page plays the poses ping-pong at the APNG's own frame delay (figure_frames.js
    takes delayMs as its pace), so no other code changes with the frame rate.
"""
import argparse
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "web" / "local"
SOURCE = Path("/Applications/Muse.app/Contents/Resources")
SIZE = 320
INNER = 280
FADE = 28
FPS = 24
BACKGROUND = "0xF3F3F3"

# name: (video, start second, length in seconds)
ANIMATIONS = {
    "idle": ("HatchIdle.mp4", 0.0, 3.0),
    "working": ("HatchWorking.mp4", 0.0, 3.0),
    "wave": ("HatchWave.mp4", 0.4, 3.0),
    "making": ("HatchMaking.mp4", 1.5, 3.0),
    "confetti": ("HatchMilestoneConfetti.mp4", 1.0, 3.0),
}


def run(cmd, dry):
    print("  $", " ".join(str(c) for c in cmd))
    if not dry:
        subprocess.run(cmd, check=True)


def build(force, dry):
    margin = (SIZE - INNER) // 2
    dist = "pow(pow(abs(X-W/2+0.5)/(W/2),4)+pow(abs(Y-H/2+0.5)/(H/2),4),0.25)"
    vignette = f"255*clip((1-{dist})*(W/2)/{FADE},0,1)"
    built = False
    for name, (video, start, length) in ANIMATIONS.items():
        target = OUT / f"muse_{name}.png"
        if target.exists() and not force:
            print(f"{name}: present")
            continue
        print(f"{name}: {video} from {start} s, {length} s, {FPS} fps, {SIZE} px")
        graph = (f"[1:v]setpts=PTS-STARTPTS,fps={FPS},scale={INNER}:{INNER}:flags=lanczos,format=rgba,"
                 f"geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='{vignette}'[fg];"
                 f"[0:v][fg]overlay=x={margin}:y={margin}:shortest=1,format=rgb24")
        run(["ffmpeg", "-v", "error", "-y",
             "-f", "lavfi", "-i", f"color=c={BACKGROUND}:s={SIZE}x{SIZE}:r={FPS}",
             "-ss", str(start), "-t", str(length), "-i", str(SOURCE / video),
             "-filter_complex", graph, "-f", "apng", "-plays", "0", str(target)], dry)
        built = True
    if built or force:
        run([sys.executable, str(HERE / "make_figure_dark.py"),
             "--src", str(OUT), "--out", str(OUT / "dark"), "--prefix", "muse_"], dry)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--force", action="store_true", help="rebuild everything")
    ap.add_argument("--dry-run", action="store_true", help="show the plan, write nothing")
    args = ap.parse_args()
    if not SOURCE.exists():
        print(f"missing {SOURCE}: install the Muse app", file=sys.stderr)
        return 1
    OUT.mkdir(parents=True, exist_ok=True)
    build(args.force, args.dry_run)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
