// sw.js: a minimal service worker so the page installs as an app (Chrome "Install",
// Safari "Add to Dock"). It caches the app shell only, the files of this folder; it
// never touches Home Assistant, the fonts or the icon CDNs, whose requests go to the
// network as before (the browser's own cache keeps the fonts).
//
// Shell files come from the network when it answers and from the cache when it does
// not, so an edited file reaches an installed app on the next start and the app still
// opens without the server. Bump VERSION to drop files that no longer exist. The hosted
// page serves this file with Cache-Control: no-cache (vercel.json), so a new version is
// seen on the next visit. The project ships no figure pictures any more (its blue figure
// folder was removed on 19.11.2026); the owner's figure under ./local is kept
// in this cache, see PRIVATE below. Frames from another origin are left alone.
const VERSION = "muse-web-screen-1.8.24";
const RUNTIME = "muse-web-runtime-1.7.0";
const SHELL = [
  "./", "./index.html", "./style.css", "./manifest.webmanifest",
  "./app.js", "./display.js", "./cards.js", "./draw.js", "./render.js", "./figure.js", "./scene.js", "./icons.js",
  "./particles.js", "./text.js", "./tables.js", "./queue.js", "./timers.js", "./weather.js", "./media.js",
  "./audio.js", "./ha.js", "./pip.js", "./demo.js", "./settings.js", "./pace.js", "./apng.js", "./figure_sheet.js", "./figure_frames.js", "./figure_styles.js",
  "./square.js", "./theme.js", "./tablet.js", "./camera.js", "./sensors.js", "./remotelog.js", "./follow.js", "./motion.js", "./gestures.js",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png", "./icons/apple-touch-icon.png",
];

// The owner's Muse figure is private and lives under /local; it is not in the public
// shell list, but an installed app must still show it when the LAN address is gone.
// Each file is optional: on the public site the requests 404 and are skipped. Since
// 1.8.23 these are the compact sheet WebPs and the start pose (figure_sheet.js); a folder
// that still has only the animated PNGs gets them cached on first use, like other
// figure styles (./local/<style>/muse_*, named in ./local/figures.json).
const PRIVATE = ["", "dark/"].flatMap((d) => ["start", "idle", "wave", "working", "making", "confetti", "avatar"]
  .map((n) => `./local/${d}muse_${n}.webp`));

// A picture of a figure style under ./local: ./local/muse_idle.webp or .png,
// ./local/dark/muse_start.webp, ./local/winter/muse_idle.webp, ./local/winter/dark/...
const FIGURE_FRAME = /^\.\/local\/(?:[a-z0-9][a-z0-9_-]*\/){0,3}muse_[a-z]+\.(?:png|webp)$/i;
function isFigureFrame(rel) {
  return FIGURE_FRAME.test(rel);
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(SHELL);
    await Promise.allSettled(PRIVATE.map(async (url) => {
      try {
        const res = await fetch(url, { cache: "no-cache" });
        if (res.ok) await cache.put(url, res);
      } catch {
        // no owner figure on this host (the public page): nothing to keep
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== RUNTIME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// An older add-on build sends a Permissions-Policy that forbids the camera, and a CSP
// that predates the person detector. A service worker may answer a navigation with its
// own headers; the document then gets the policy this app needs, without an add-on
// rebuild. The same response keeps the add-on's other headers. The page has no
// microphone since 1.8.24 (talking to Muse is Meta's own voice in Muse OS), so the
// policy keeps it closed.
const APP_CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com; img-src 'self' https: http: data: blob:; connect-src 'self' https: wss: ws:; media-src 'self' blob: mediastream:; manifest-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
const APP_PERMISSIONS = "camera=(self), microphone=(), geolocation=(), fullscreen=(self), picture-in-picture=(self), screen-wake-lock=(self)";

async function navigation(request) {
  const response = await fetch(request);
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", APP_CSP);
  headers.set("Permissions-Policy", APP_PERMISSIONS);
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.delete("transfer-encoding");
  return new Response(await response.blob(), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

const RUNTIME_HOSTS = new Set(["cdn.jsdelivr.net", "storage.googleapis.com"]);
function isDetectorAsset(url) {
  if (!RUNTIME_HOSTS.has(url.hostname)) return false;
  return url.pathname.includes("/@mediapipe/tasks-vision/")
    || url.pathname.includes("/mediapipe-tasks/")
    || url.pathname.includes("/mediapipe-assets/")
    || url.pathname.includes("/mediapipe-models/"); // the pose model of "Muse folgt mir"
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  const navScope = new URL("./", self.location.href).pathname;
  if (event.request.mode === "navigate" && url.origin === self.location.origin && url.pathname.startsWith(navScope)) {
    event.respondWith(navigation(event.request));
    return;
  }
  // The person detector is large and only needed after the first camera start. Keep
  // it in a runtime cache so the second start (and an offline start) does not download
  // the WASM and model again.
  if (isDetectorAsset(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME);
      const hit = await cache.match(event.request);
      if (hit) return hit;
      const res = await fetch(event.request);
      if (res.ok) cache.put(event.request, res.clone());
      return res;
    })().catch(() => fetch(event.request)));
    return;
  }
  if (url.origin !== self.location.origin) return;
  const scope = new URL("./", self.location.href).pathname;
  if (!url.pathname.startsWith(scope)) return;
  const rel = "./" + url.pathname.slice(scope.length);
  // The figure's pictures come from the cache at once (the figure is the first thing a
  // panel shows) and are refreshed behind it for the next start: a regenerated set shows
  // after one more reload.
  if (isFigureFrame(rel)) {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const hit = await cache.match(event.request, { ignoreSearch: true });
      const fresh = fetch(event.request).then((res) => {
        if (res.ok) cache.put(event.request, res.clone());
        return res;
      });
      if (hit) {
        event.waitUntil(fresh.catch(() => null));
        return hit;
      }
      return fresh;
    })());
    return;
  }
  const shell = rel === "./" || SHELL.includes(rel) || rel.startsWith("./demo/") || rel === "./local/figures.json";
  if (!shell) return;
  event.respondWith(
    fetch(event.request).then((res) => {
      if (res.ok) caches.open(VERSION).then((cache) => cache.put(event.request, res.clone()));
      return res;
    }).catch(() => caches.match(event.request, { ignoreSearch: true })),
  );
});
