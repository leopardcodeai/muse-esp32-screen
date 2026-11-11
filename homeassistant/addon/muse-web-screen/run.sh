#!/bin/sh
# run.sh: writes the nginx configuration from the add-on options and starts nginx.
#
# The web app is a static folder under /config/www/muse-web; the certificate and key
# are /ssl/muse-web.crt and /ssl/muse-web.key. Both are mapped read-only in config.yaml.
# The /api/ proxy is what lets an HTTPS page talk to a Home Assistant that still runs
# on http://: the browser opens wss://<this add-on>/api/websocket, nginx forwards it to
# <ha_url>/api/websocket over the local network.
set -eu

OPTIONS=/data/options.json
HA_URL="http://homeassistant:8123"
if [ -f "$OPTIONS" ]; then
    HA_URL=$(jq -r '.ha_url // empty' "$OPTIONS")
    [ -n "$HA_URL" ] || HA_URL="http://homeassistant:8123"
fi
HA_URL=${HA_URL%/}

case "$HA_URL" in
    http://*|https://*) ;;
    *)
        echo "Muse Web Screen: ha_url must start with http:// or https:// (got: $HA_URL)" >&2
        exit 1
        ;;
esac

if [ ! -s /ssl/muse-web.crt ] || [ ! -s /ssl/muse-web.key ]; then
    echo "Muse Web Screen: /ssl/muse-web.crt or /ssl/muse-web.key is missing." >&2
    echo "Create the certificate with mkcert and copy both files to Home Assistant's /ssl folder." >&2
    exit 1
fi

if [ ! -s /config/www/muse-web/index.html ]; then
    echo "Muse Web Screen: /config/www/muse-web/index.html is missing." >&2
    echo "Copy the web/ folder to /config/www/muse-web (including local/ for your own figure)." >&2
    exit 1
fi

echo "Muse Web Screen: serving /config/www/muse-web on https://[host]:8322, HA at $HA_URL"
sed "s|__HA_URL__|${HA_URL}|g" /etc/nginx/templates/muse-web.conf.template > /etc/nginx/conf.d/default.conf
exec nginx -g 'daemon off;'
