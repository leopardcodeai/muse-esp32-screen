#!/usr/bin/env python3
"""Copies the built Muse Web Screen bundle to Home Assistant's /config/www/muse-web.

What: uploads every file under `web/local/ha-bundle/config/www/muse-web` whose SHA-256
differs from the last upload, and remembers the hashes in
`web/local/ha-bundle/.deployed.json`. The add-on serves the folder; no restart is needed.

Why: `tools/deploy_ha.sh` runs this from a LaunchAgent, so the installed app follows the
repository without a manual Samba drag.

Pitfalls:
  * The Samba password stays in `web/local/ha-samba-password` (ignored by git); it is
    read here, never printed.
  * Only the web root is synced. The add-on image and the HA scripts are separate.
  * A removed file stays on the server; this script never deletes the owner's private
    figures or anything it did not upload.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

import smbclient

ROOT = Path(__file__).resolve().parents[1]
BUNDLE = ROOT / "web" / "local" / "ha-bundle" / "config" / "www" / "muse-web"
MANIFEST = ROOT / "web" / "local" / "ha-deployed.json"
PASSWORD = ROOT / "web" / "local" / "ha-samba-password"
# House-specific, so not in the repository: MUSE_HA_HOST, or web/local/ha-samba-host.
HOST = os.environ.get("MUSE_HA_HOST", "").strip()
if not HOST:
    host_file = ROOT / "web" / "local" / "ha-samba-host"
    if host_file.is_file():
        HOST = host_file.read_text().strip()
if not HOST:
    raise SystemExit("set MUSE_HA_HOST or write web/local/ha-samba-host")
USER = "homeassistant"
REMOTE = f"\\\\{HOST}\\config\\www\\muse-web"


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> None:
    if not BUNDLE.is_dir():
        raise SystemExit(f"missing bundle: {BUNDLE} (run tools/make_ha_bundle.sh)")
    if not PASSWORD.is_file():
        raise SystemExit(f"missing Samba password: {PASSWORD}")
    smbclient.register_session(HOST, username=USER, password=PASSWORD.read_text().strip())
    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.is_file() else {}
    changed = 0
    for path in sorted(BUNDLE.rglob("*")):
        if path.is_dir():
            continue
        rel = str(path.relative_to(BUNDLE)).replace(os.sep, "/")
        sha = digest(path)
        if manifest.get(rel) == sha:
            continue
        remote = REMOTE + "\\" + rel.replace("/", "\\")
        smbclient.makedirs(remote.rsplit("\\", 1)[0], exist_ok=True)
        with smbclient.open_file(remote, mode="wb") as f:
            f.write(path.read_bytes())
        manifest[rel] = sha
        changed += 1
    MANIFEST.write_text(json.dumps(manifest, indent=1, sort_keys=True))
    print(f"deployed {changed} changed file(s)")


if __name__ == "__main__":
    main()
