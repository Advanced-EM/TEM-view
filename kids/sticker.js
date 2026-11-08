// sticker.html: a visitor's snap, redrawn on a phone from the numbers in the address (render.js encodeSnap):
// the sample, the view, focus, brightness and colors. Nothing about the visitor is in the address or kept here.
import { SPECIMENS } from './specimens.js';
import { Picture, optics, viewOf, decodeSnap } from './render.js';
import { packIndex, packSpecimen } from './packs.js';
import { tr, msg, setLang, applyStatic, lang } from './i18n.js';

const $ = (id) => document.getElementById(id);
const fmtLen = (nm) => nm >= 1e6 ? `${+(nm / 1e6).toPrecision(2)} mm` : nm >= 1e3 ? `${+(nm / 1e3).toPrecision(2)} µm` : `${+nm.toPrecision(2)} nm`;
const s = decodeSnap(location.hash.slice(1));
setLang(s.lang, false); applyStatic();

async function specimen(id) {
  const sp = SPECIMENS.find((x) => x.id === id); if (sp) return sp;
  // a museum's sample pack, if this site has it
  const entry = (await packIndex()).find((e) => e.id === id); if (!entry) return null;
  const url = new URL(`packs/${entry.path ?? `${id}/pack.json`}`, import.meta.url), p = await (await fetch(url)).json(), images = {};
  await Promise.all(p.layers.map(async (L) => { const im = new Image(); im.src = new URL(L.src, url).href; await im.decode(); images[L.src] = im; }));
  return packSpecimen(p, images);
}

const sp = await specimen(s.sample);
if (!sp) { $('stName').textContent = tr(['This sticker\'s sample is not on this website.', 'La muestra de este sticker no está en este sitio web.']); }
else {
  const pic = new Picture(document.createElement('canvas'));
  pic.canvas.width = pic.canvas.height = 720;
  const v = viewOf(s.cx, s.cy, s.fov, s.pal);
  pic.draw(sp, v, s.burns);
  pic.show({ beam: true, blur: optics.blur(s.err, sp, s.fov), bright: s.bright, pal: s.pal });
  const url = pic.sticker(720);
  $('stImg').src = url; $('stImg').alt = tr(sp.name);
  $('stName').innerHTML = `${sp.icon} <b>${tr(sp.name)}</b>`;
  $('stWhat').textContent = tr(sp.what(v));
  $('stSize').textContent = tr(msg(['The picture is {w} wide.', 'La imagen mide {w} de ancho.'], { w: fmtLen(s.fov) }));
  $('stStars').textContent = '⭐'.repeat(s.stars);
  const name = `electron-explorer-${sp.id}.png`;
  $('stSave').href = url; $('stSave').download = name;
  const blob = await (await fetch(url)).blob(), file = new File([blob], name, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) { $('stShare').hidden = false; $('stShare').onclick = () => navigator.share({ files: [file], title: tr(['My Electron Explorer sticker', 'Mi sticker de Explorador de Electrones']) }).catch(() => {}); }
}
$('stPlay').href = `./?lang=${lang}`;
