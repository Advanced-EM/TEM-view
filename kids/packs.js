// Sample packs: samples a museum adds without code, from kids/packs/<id>/pack.json plus images (SVG or raster,
// for instance real micrographs from its own collection). packs/index.json lists the installed packs; the staff
// menu turns each on or off. Layers are drawn at their size in nanometres, finer ones fading in as you zoom, so a
// pack can go from a whole organism down to its finest detail. Texts are { en, es, pt, fr, de } objects.
// The format is described in kids/packs/README.md.
import { SPECIMENS } from './specimens.js';
import { settings } from './settings.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const BASE = new URL('packs/', import.meta.url);

export async function packIndex() {
  try { const r = await fetch(new URL('index.json', BASE), { cache: 'no-cache' }); return r.ok ? await r.json() : []; } catch { return []; }
}
const enabled = (p) => (settings.packs ? settings.packs.includes(p.id) : !!p.default);

// the specimen a pack becomes, with the same shape as the built-in ones (specimens.js)
export function packSpecimen(p, images = {}) {
  const regions = p.regions ?? [];
  return {
    id: p.id, name: p.name, icon: p.icon ?? '🔬', blurb: p.blurb, pack: true, credit: p.credit,
    fovMax: p.fovMax, fovMin: p.fovMin, start: p.start, bound: p.bound, soft: !!p.soft,
    whats: [...regions.map((r) => r.what), p.what].filter(Boolean),
    bg: (mono) => (mono ? p.background?.mono ?? '#d9d9d9' : p.background?.color ?? '#f4fbff'),
    draw(ctx, v) {
      for (const L of p.layers) {
        const img = images[L.src]; if (!img) continue;
        const w = L.width, h = L.height ?? L.width, x0 = L.x - w / 2, y0 = L.y - h / 2;
        if (x0 > v.x1 || x0 + w < v.x0 || y0 > v.y1 || y0 + h < v.y0) continue;
        const max = L.maxFov ?? Infinity, min = L.minFov ?? 0;
        if (v.fov > max || v.fov < min) continue;
        // a finer layer fades in over the last 40 % of its range, so the detail appears as you zoom
        ctx.globalAlpha = Number.isFinite(max) ? clamp((max - v.fov) / (max * 0.4), 0, 1) : 1;
        if (v.mono) ctx.filter = 'grayscale(1) contrast(1.1)';
        ctx.drawImage(img, x0, y0, w, h);
        ctx.filter = 'none'; ctx.globalAlpha = 1;
      }
    },
    what(v) {
      for (const r of regions) if (Math.hypot(v.cx - r.x, v.cy - r.y) < r.r && (r.maxFov == null || v.fov <= r.maxFov)) return r.what;
      return p.what ?? p.name;
    },
  };
}

let loaded = [];
// load the enabled packs (with their images) and add them to SPECIMENS; the exhibit awaits this before starting
export async function loadPacks() {
  const index = await packIndex();
  const out = [];
  for (const entry of index) {
    let info = null;
    try {
      const url = new URL(entry.path ?? `${entry.id}/pack.json`, BASE);
      const p = await (await fetch(url, { cache: 'no-cache' })).json(); p.id ??= entry.id; p.default ??= entry.default;
      const files = p.layers.map((L) => new URL(L.src, url).href);
      info = { id: p.id, name: p.name, icon: p.icon, default: !!p.default, files: [url.href, ...files], on: enabled(p), pack: p };
      out.push(info);
      if (!info.on) continue;
      const images = {};
      await Promise.all(p.layers.map(async (L, i) => { const im = new Image(); im.src = files[i]; await im.decode(); images[L.src] = im; }));
      SPECIMENS.push(packSpecimen(p, images));
    } catch (e) { console.warn(`sample pack ${entry.id ?? entry.path}: ${e.message}`); if (info) info.on = false; }
  }
  loaded = out; packList.cached = out;
}
export async function packList() { return loaded.map(({ id, name, icon, on, files }) => ({ id, name, icon, on, files })); }
packList.cached = [];

// missions that enabled packs bring
export const packMissions = () => loaded.filter((p) => p.on && p.pack.mission).map((p) => ({ ...p.pack.mission, id: `pack:${p.id}`, spec: p.id }));
