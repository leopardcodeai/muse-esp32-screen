// figure_styles.js: which figure styles a screen can show and where each one's pictures
// live. A figure style ("Figur-Stil") is one set of the six animated PNGs the display
// plays (muse_idle.png, muse_wave.png, muse_working.png, muse_making.png,
// muse_confetti.png, muse_avatar.png, plus the same six under dark/ for the dark theme).
//
// Today there is one set, "Muse": the owner's frames directly in his figure folder
// (settings "Bilderordner", `./local` on the add-on and the Mac). More sets come by
// dropping files and naming them in a manifest beside them, `<folder>/figures.json`:
//
//   {"styles": [
//     {"id": "muse", "name": "Muse"},
//     {"id": "winter", "name": "Muse Winter", "path": "winter"}
//   ]}
//
// A style with `path` "winter" plays <folder>/winter/muse_*.png and
// <folder>/winter/dark/muse_*.png. No DOM in here, so the tests run it in Node.
//
// Pitfalls:
//  * The built-in "Muse" always lives at the folder itself (path ""): a manifest may
//    rename it but never move it. That keeps the first load of every owner screen free of
//    a round trip for the manifest; only another style waits for figures.json.
//  * The manifest sits in the owner's private folder (web/local is ignored by git and
//    Vercel), like the frames: it is not part of the public repository.
//  * Ids and paths are cleaned hard (lower-case letters, digits, "-" and "_"; a path is
//    one or more such segments): a manifest can never point a screen at "..", another
//    host or a query string.
//  * A missing or broken manifest is no error: the screen then knows only "Muse".

export const DEFAULT_STYLE = "muse";
export const MANIFEST = "figures.json";
export const BUILTIN_STYLES = Object.freeze([Object.freeze({ id: DEFAULT_STYLE, name: "Muse", path: "" })]);
// Values of the figure_style action that switch to the neutral placeholder instead of a set.
export const PLACEHOLDER_WORDS = ["placeholder", "platzhalter", "neutral", "none", "keine", "aus", "off"];

const ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const SEGMENT = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

// A style id from any spelling ("Muse", " muse ") or "" when it cannot be one.
export function cleanStyleId(value) {
  const id = String(value ?? "").trim().toLowerCase();
  return ID.test(id) ? id : "";
}

// A relative folder of a style ("winter", "sets/winter") or "" for the folder itself;
// null when the path is not allowed.
export function cleanStylePath(value) {
  const path = String(value ?? "").trim().replace(/^\.\/+/, "").replace(/\/+$/, "");
  if (!path) return "";
  const parts = path.split("/");
  return parts.every((p) => SEGMENT.test(p)) ? parts.join("/") : null;
}

// The styles a manifest names, cleaned; anything that is not a valid entry is dropped.
export function parseManifest(json) {
  let data = json;
  if (typeof json === "string") {
    try {
      data = JSON.parse(json);
    } catch {
      return [];
    }
  }
  const list = Array.isArray(data) ? data : data && Array.isArray(data.styles) ? data.styles : [];
  const out = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const id = cleanStyleId(entry.id);
    const path = cleanStylePath(entry.path ?? entry.id);
    if (!id || path === null || out.some((s) => s.id === id)) continue;
    const name = String(entry.name ?? "").trim().slice(0, 40) || id;
    out.push({ id, name, path: id === DEFAULT_STYLE ? "" : path });
  }
  return out;
}

// The built-in styles with the manifest's: the manifest may rename a built-in one (never
// move it) and adds the rest in its order, after the built-in ones.
export function mergeStyles(manifest = [], builtin = BUILTIN_STYLES) {
  const out = builtin.map((b) => {
    const over = manifest.find((m) => m.id === b.id);
    return { ...b, name: over ? over.name : b.name };
  });
  for (const m of manifest) if (!out.some((s) => s.id === m.id)) out.push({ ...m });
  return out;
}

// The style `wanted` among `styles`, else the default one; `known` says whether it was found.
export function pickStyle(styles, wanted) {
  const id = cleanStyleId(wanted) || DEFAULT_STYLE;
  const hit = styles.find((s) => s.id === id);
  if (hit) return { style: hit, known: true };
  return { style: styles.find((s) => s.id === DEFAULT_STYLE) || BUILTIN_STYLES[0], known: false };
}

// What the figure_style action asked for: {placeholder: true}, {id} of a known style
// (by id or by its name, any case), or {unknown} for a value no style matches.
export function parseStyleChoice(value, styles = BUILTIN_STYLES) {
  const raw = String(value ?? "").trim();
  const low = raw.toLowerCase();
  if (!raw) return { unknown: raw };
  if (PLACEHOLDER_WORDS.includes(low)) return { placeholder: true };
  const hit = styles.find((s) => s.id === low || s.name.toLowerCase() === low);
  if (hit) return { id: hit.id };
  const id = cleanStyleId(raw);
  // A style that is not (yet) in the list: kept as an id, the manifest may name it soon.
  return id ? { id, unlisted: true } : { unknown: raw };
}

// The folder of a style's pictures inside the owner's figure folder.
export function styleBase(folder, style) {
  const base = String(folder || "").trim().replace(/\/+$/, "");
  const path = style && style.path ? style.path : "";
  return path ? `${base}/${path}` : base;
}

// The manifest URL of a figure folder.
export function manifestUrl(folder) {
  return `${String(folder || "").trim().replace(/\/+$/, "")}/${MANIFEST}`;
}

// Fetches <folder>/figures.json and resolves with the merged style list; on any failure
// (404, no answer, bad JSON) with the built-in styles alone.
export async function loadStyles(folder, fetchImpl = (u, o) => fetch(u, o)) {
  if (!String(folder || "").trim()) return mergeStyles([]);
  try {
    const res = await fetchImpl(manifestUrl(folder), { mode: "cors", cache: "no-cache", credentials: "omit" });
    if (!res || !res.ok) return mergeStyles([]);
    return mergeStyles(parseManifest(await res.text()));
  } catch {
    return mergeStyles([]);
  }
}

// What this screen shows, from the settings and the URL: {placeholder: true} (no figure
// folder, or `?figure=placeholder` for public screenshots), else the folder, the folder
// for away from home and the style id.
export function figurePlan(settings, search = "") {
  const p = new URLSearchParams(search);
  const folder = String((settings && settings.figureUrl) || "").trim();
  if (p.get("figure") === "placeholder" || !settings || settings.figureSource !== "url" || !folder) return { placeholder: true };
  return {
    placeholder: false,
    folder,
    away: String(settings.figureUrlAway || "").trim(),
    style: cleanStyleId(settings.figureStyle) || DEFAULT_STYLE,
  };
}

// Loads what `plan` names into `source` (a figure_frames.js FigureSource): the built-in
// style at once, another style after one look at the folder's manifest; the folder for
// away when the home folder gave nothing. A total failure stays a failure (the place of
// the figure stays empty); nothing else is drawn instead. Resolves with {loaded, failed,
// style, folder}, or {stale: true} when a later call took over.
export async function loadChosenFigure(source, plan, { fetchImpl, log = () => {} } = {}) {
  const token = (source.planSerial = (source.planSerial || 0) + 1);
  const stale = () => source.planSerial !== token;
  if (plan.placeholder) {
    await source.use("");
    return { loaded: 0, failed: [], placeholder: true };
  }
  let { style, known } = pickStyle(mergeStyles([]), plan.style);
  if (!known) {
    const styles = await loadStyles(plan.folder, fetchImpl);
    if (stale()) return { stale: true };
    ({ style, known } = pickStyle(styles, plan.style));
    if (!known) log(`figure style '${plan.style}' is not in ${manifestUrl(plan.folder)}; showing ${style.name}`);
  }
  let folder = plan.folder;
  let r = await source.use(styleBase(folder, style), { name: style.name });
  if (r.stale || stale()) return { stale: true };
  if (r.loaded === 0 && plan.away && plan.away !== plan.folder) {
    log(`figure ${style.name} from ${styleBase(folder, style)} did not answer; trying ${styleBase(plan.away, style)}`);
    folder = plan.away;
    r = await source.use(styleBase(folder, style), { name: style.name });
    if (r.stale || stale()) return { stale: true };
  }
  log(`figure ${style.name} from ${styleBase(folder, style)}: ${r.loaded} of 6 loaded${r.failed.length ? ", missing " + r.failed.join(", ") : ""}`);
  if (r.loaded === 0) log(`figure ${style.name}: no picture arrived, the figure's place stays empty`);
  return { ...r, style, folder };
}
