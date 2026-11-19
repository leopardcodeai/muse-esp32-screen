# Inter fonts

`Inter-500.ttf`, `Inter-700.ttf` and `Inter-800.ttf` are unmodified copies of the
Inter font, taken from the Muse camera add-on's assets
(`homeassistant/addons/muse_camera/assets/` on the author's machine). They are
the same weights the display uses, so the chart's typography matches the rest
of Muse.

Inter is Copyright (c) 2016 The Inter Project Authors
(https://github.com/rsms/inter) and is licensed under the **SIL Open Font
License, Version 1.1**. The full license text and copyright line are in
`OFL.txt` next to this note. The fonts may be bundled and redistributed with
this project, including in the Home Assistant configuration folder; they may
not be sold on their own and a modified version may not use the reserved name
"Inter" without permission.

Do not replace these files with a subset or a renamed build: `common.py` asks
for exactly `Inter-500.ttf`, `Inter-700.ttf` and `Inter-800.ttf`. If the files
are missing, the renderer falls back to DejaVu Sans or Arial and still works,
but the metrics differ.
