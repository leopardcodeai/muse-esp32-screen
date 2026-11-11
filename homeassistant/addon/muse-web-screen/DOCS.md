# Muse Web Screen

Serves Muse Web Screen from Home Assistant OS over HTTPS, so Chrome can install it as a
real app, and proxies Home Assistant's `/api/` through the same origin. That proxy is the
point: an HTTPS page may not open a `ws://` socket to a Home Assistant that still runs on
`http://`, but it may open `wss://` to this add-on, which forwards to Home Assistant.

The web app itself lives in `/config/www/muse-web` and is not part of this add-on's
image. Updating the app is a file copy, not an add-on rebuild.

## Requirements

- Home Assistant OS with the **Samba share** add-on (or SSH) to copy files.
- `mkcert` on the Mac that will install the app.
- Port **8322** free. Port 8321 may already be the Muse camera add-on.

## 1. Create the certificate

On the Mac:

```bash
brew install mkcert
mkcert -install
mkdir -p ~/muse-ha-ssl
mkcert -cert-file ~/muse-ha-ssl/muse-web.crt -key-file ~/muse-ha-ssl/muse-web.key \
  homeassistant.local muse.local
```

If you reach Home Assistant by IP, add that IP here and use it in the browser URL too.
The certificate must contain every name or address you type into Chrome.

If `mkcert -install` cannot install the CA (it needs your admin password), run:

```bash
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain "$(mkcert -CAROOT)/rootCA.pem"
```

Then quit and reopen Chrome. A CA trusted only in the login keychain passes
`security verify-cert` but Chrome still shows `ERR_CERT_AUTHORITY_INVALID`; it needs the
System keychain.

For an iPad, iPhone or another computer that should use the app, install
`$(mkcert -CAROOT)/rootCA.pem` there and trust it. Do not put the private key on a device
you do not control.

## 2. Copy the files to Home Assistant

In Finder: **Go → Connect to Server →** `smb://homeassistant.local`, then use the shares
`config`, `ssl` and `addons`.

| From | To on Home Assistant |
|---|---|
| the contents of `web/` | `/config/www/muse-web/` |
| `muse-web.crt` and `muse-web.key` | `/ssl/` |
| this `muse-web-screen/` folder | `/addons/muse-web-screen/` |

Copy `web/local/` only if you use your own figure frames. That folder is Meta's artwork
or your own; it stays private and is never committed to the repository. Do **not** copy
the certificate or key into `/config/www`; they belong in `/ssl`.

## 3. Install and start the add-on

Settings → Add-ons → Add-on Store → ⋮ → **Check for updates** → **Local add-ons** →
**Muse Web Screen** → **Install**.

Open the add-on's **Configuration** tab and set:

```yaml
ha_url: "http://homeassistant:8123"
```

`http://homeassistant:8123` often works inside the add-on network too. If the add-on logs
`502 Bad Gateway`, use the IP address. Then **Start** the add-on.

The log should end with:

```text
Muse Web Screen: serving /config/www/muse-web on https://[host]:8322, HA at http://...
```

## 4. Install the app

Open:

```text
https://homeassistant.local:8322/
```

Use Chrome's install symbol in the address bar (or menu ⋮ → Cast, save and share →
Install page as app). The certificate must be trusted for the install to appear.

In the app, press **E** and set:

| Field | Value |
|---|---|
| Home Assistant URL | `https://homeassistant.local:8322` |
| Long-lived access token | a token for this screen |
| Device name | your box's name, or the default |
| Figure source | *Eigene Bilder aus einem Ordner* |
| Folder URL of the images | `https://homeassistant.local:8322/local` |
| Nur Display | on, if you want no toolbar |

The Home Assistant URL is the **add-on**, not the HA IP. The app connects to
`wss://homeassistant.local:8322/api/websocket`; the add-on forwards that to `ha_url`.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Chrome: `ERR_CERT_AUTHORITY_INVALID` | mkcert CA is not trusted | run `mkcert -install` or the System-keychain command above, quit Chrome, open the page again |
| 502 Bad Gateway | add-on cannot reach `ha_url` | set `ha_url` to the HA IP, check the add-on log, start HA |
| 404 on the page | web files are not in `/config/www/muse-web` | copy the contents of `web/`, not the folder itself |
| Add-on stops at start | `/ssl/muse-web.crt` or `muse-web.key` missing | copy both files to `/ssl`; see the add-on log |
| App installs but shows no cards | token or HA URL wrong for this origin | press E, set the add-on URL and paste the token again |
| Port 8322 already used | another service on the HA host | change `8322` in `config.yaml` (`ports`, `webui`) and in `nginx.conf.template` (`listen`), then rebuild |
| iPad/iPhone warns about the certificate | the mkcert CA is only on the Mac | install and trust `rootCA.pem` on the device |

The add-on is meant for the local network. Do not forward port 8322 from the internet.
