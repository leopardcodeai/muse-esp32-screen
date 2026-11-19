// sw.js: a minimal service worker so the page installs as an app (Chrome "Install",
// Safari "Add to Dock"). It caches the app shell only, the files of this folder; it
// never touches Home Assistant, the fonts or the icon CDNs, whose requests go to the
// network as before (the browser's own cache keeps the fonts).
//
// Shell files come from the network when it answers and from the cache when it does
// not, so an edited file reaches an installed app on the next start and the app still
// opens without the server. Bump VERSION to drop files that no longer exist. The hosted
// page serves this file with Cache-Control: no-cache (vercel.json), so a new version is
// seen on the next visit. The project's figure (figure-default/) is part of the shell;
// the owner's own figure frames are never cached here: they come from another origin,
// which this worker leaves alone.
const VERSION = "muse-web-screen-1.8.14";
const RUNTIME = "muse-web-runtime-1.7.0";
const SHELL = [
  "./", "./index.html", "./style.css", "./manifest.webmanifest",
  "./app.js", "./display.js", "./cards.js", "./draw.js", "./render.js", "./figure.js", "./scene.js", "./icons.js",
  "./particles.js", "./text.js", "./tables.js", "./queue.js", "./timers.js", "./weather.js", "./media.js",
  "./audio.js", "./ha.js", "./pip.js", "./demo.js", "./settings.js", "./pace.js", "./apng.js", "./figure_frames.js",
  "./square.js", "./theme.js", "./tablet.js", "./camera.js", "./voice.js", "./sensors.js", "./pcm.js", "./pcm-worklet.js", "./remotelog.js", "./textask.js", "./follow.js",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png", "./icons/apple-touch-icon.png",
  "./figure-default/idle.png", "./figure-default/wave.png", "./figure-default/working.png",
  "./figure-default/making.png", "./figure-default/confetti.png", "./figure-default/avatar.png",
  "./figure-default/dark/idle.png", "./figure-default/dark/wave.png", "./figure-default/dark/working.png",
  "./figure-default/dark/making.png", "./figure-default/dark/confetti.png", "./figure-default/dark/avatar.png",
];

// The owner's Muse figure is private and lives under /local; it is not in the public
// shell list, but an installed app must still show it when the LAN address is gone.
// Each file is optional: on the public site the requests 404 and are skipped.
const PRIVATE = [
  "./local/muse_idle.png", "./local/muse_wave.png", "./local/muse_working.png",
  "./local/muse_making.png", "./local/muse_confetti.png", "./local/muse_avatar.png",
  "./local/dark/muse_idle.png", "./local/dark/muse_wave.png", "./local/dark/muse_working.png",
  "./local/dark/muse_making.png", "./local/dark/muse_confetti.png", "./local/dark/muse_avatar.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(SHELL);
    await Promise.allSettled(PRIVATE.map(async (url) => {
      try {
        const res = await fetch(url, { cache: "no-cache" });
        if (res.ok) await cache.put(url, res);
      } catch {
        // no owner figure on this host: the project's figure stands in
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

// The add-on sends a Permissions-Policy that forbids camera and microphone, and a CSP
// that predates the person detector. A service worker may answer a navigation with its
// own headers; the document then gets the policy this app needs, without an add-on
// rebuild. The same response keeps the add-on's other headers.
const APP_CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com; img-src 'self' https: http: data: blob:; connect-src 'self' https: wss: ws:; media-src 'self' blob: mediastream:; manifest-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
const APP_PERMISSIONS = "camera=(self), microphone=(self), geolocation=(), fullscreen=(self), picture-in-picture=(self), screen-wake-lock=(self)";

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
  const shell = rel === "./" || SHELL.includes(rel) || rel.startsWith("./demo/")
    || rel.startsWith("./local/muse_") || rel.startsWith("./local/dark/muse_");
  if (!shell) return;
  event.respondWith(
    fetch(event.request).then((res) => {
      if (res.ok) caches.open(VERSION).then((cache) => cache.put(event.request, res.clone()));
      return res;
    }).catch(() => caches.match(event.request, { ignoreSearch: true })),
  );
});
