#!/bin/sh
# make_ha_bundle.sh: puts the add-on, the web app and the mkcert files into one folder
# that can be copied to Home Assistant OS with Samba.
#
# What: writes web/local/ha-bundle/ by default:
#   addons/muse-web-screen/   the local add-on
#   config/www/muse-web/      the web app, including local/ (your own figure)
#   ssl/muse-web.crt|key      the mkcert certificate for the add-on
#   README.txt                the three copies, in one place
#
# Why: Home Assistant's Samba shares are config, ssl and addons. One folder with the same
# three names avoids copying the wrong files into the wrong share, and keeps the private
# certificate out of config/www.
#
# Pitfalls:
#   * web/local/ha-cert and web/local/ha-bundle are excluded from the web root. The key
#     must never be reachable over HTTP.
#   * The certificate must contain the name or IP you type into Chrome. Generate it with
#     the names in homeassistant/addon/muse-web-screen/DOCS.md.
#   * The output defaults to web/local/, which git and Vercel ignore.
#
# Usage:
#   tools/make_ha_bundle.sh                 # web/local/ha-bundle
#   tools/make_ha_bundle.sh /tmp/muse-ha    # another output folder
set -eu

ROOT=$(unset CDPATH; cd -- "$(dirname "$0")/.." && pwd)
OUT=${1:-"$ROOT/web/local/ha-bundle"}
ADDON="$ROOT/homeassistant/addon/muse-web-screen"
WEB="$ROOT/web"
CERT="$WEB/local/ha-cert/muse-web.crt"
KEY="$WEB/local/ha-cert/muse-web.key"

[ -f "$ADDON/config.yaml" ] || { echo "missing add-on folder: $ADDON" >&2; exit 1; }
[ -f "$WEB/index.html" ] || { echo "missing web app: $WEB/index.html" >&2; exit 1; }
[ -f "$CERT" ] || { echo "missing certificate: $CERT" >&2; exit 1; }
[ -f "$KEY" ] || { echo "missing key: $KEY" >&2; exit 1; }

rm -rf "$OUT"
mkdir -p "$OUT/addons" "$OUT/config/www" "$OUT/ssl"

rsync -a --delete "$ADDON/" "$OUT/addons/muse-web-screen/"
# The repository icon is the project's blue figure. If the owner has the black Muse icon
# (web/local/mac_app_icon.png, gitignored), use it for the add-on on this HA only.
if [ -f "$WEB/local/mac_app_icon.png" ]; then
    sips -z 128 128 "$WEB/local/mac_app_icon.png" --out "$OUT/addons/muse-web-screen/icon.png" >/dev/null
    echo "using the private Muse icon for the add-on"
fi
rsync -a --delete \
    --exclude '.vercel' \
    --exclude 'tools' \
    --exclude '.gitignore' \
    --exclude '.vercelignore' \
    --exclude 'README.md' \
    --exclude 'local/ha-cert' \
    --exclude 'local/ha-bundle' \
    --exclude 'local/mac_app_icon.png' \
    "$WEB/" "$OUT/config/www/muse-web/"
cp "$CERT" "$OUT/ssl/muse-web.crt"
cp "$KEY" "$OUT/ssl/muse-web.key"
chmod 600 "$OUT/ssl/muse-web.key"

cat > "$OUT/README.txt" <<'EOF'
Muse Web Screen: the three folders for Home Assistant OS

Copy with the Samba share add-on, or with scp:

  addons/muse-web-screen  ->  /addons/muse-web-screen
  config/www/muse-web     ->  /config/www/muse-web
  ssl/muse-web.crt        ->  /ssl/muse-web.crt
  ssl/muse-web.key        ->  /ssl/muse-web.key

Then install the local add-on in Home Assistant, set ha_url to the Home
Assistant address (for example http://homeassistant:8123), and start it.
Open https://homeassistant.local:8322/ in Chrome and install it as an app.

Full guide: homeassistant/addon/muse-web-screen/DOCS.md
The private figure frames are in config/www/muse-web/local/ and must not be
published. The key in ssl/ must not be copied into config/www.
EOF

echo "wrote $OUT"
echo "  add-on: $(du -sh "$OUT/addons/muse-web-screen" | cut -f1)"
echo "  web:    $(du -sh "$OUT/config/www/muse-web" | cut -f1)"
echo "  ssl:    $(find "$OUT/ssl" -maxdepth 1 -type f -exec basename {} \; | tr '\n' ' ')"
