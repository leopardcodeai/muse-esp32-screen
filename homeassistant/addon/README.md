# A Home Assistant add-on for Muse Web Screen

`muse-web-screen/` is a local Home Assistant add-on. It serves the web app from
`/config/www/muse-web` over HTTPS on port 8322 and proxies `/api/` to Home Assistant, so
an HTTPS page can talk to a Home Assistant that still runs on HTTP.

The install steps, the mkcert commands and the troubleshooting table are in
[`muse-web-screen/DOCS.md`](muse-web-screen/DOCS.md).

Why not just put the page in `/config/www`? Home Assistant's own `/local/` path is served
over the address and scheme you use for Home Assistant. Without Nabu Casa that is usually
`http://`, and Chrome only installs a page as an app from HTTPS or `localhost`. This add-on
provides the HTTPS origin and the websocket proxy; Home Assistant itself stays on HTTP.

The add-on does not contain the web app or any artwork. The private figure frames stay in
`web/local/` and are copied to `/config/www/muse-web/local/` by hand.
