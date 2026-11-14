// report.html: the kiosk's visitor numbers (visits.js) as a report to print or save as PDF: headline numbers,
// charts and tables for a chosen period. Other kiosks' exported data (Download data → .json) can be added to
// combine sites; it is read in this page only and not stored.
import { loadStats, mergeDays, addDay, csv, exportJson, download, BIN_NAMES, FORMAT } from './visits.js';
import { settings } from './settings.js';
import { QUESTS } from './lines.js';
import { SPECIMENS } from './specimens.js';
import { packIndex } from './packs.js';
import { LANG_NAMES } from './i18n.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const num = (n) => Math.round(n).toLocaleString('en-US');
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)} %` : '—');
const mmss = (s) => `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, '0')} s`;
const KIOSK = new URLSearchParams(location.search).has('kiosk');

// names for missions and samples, including the sample packs'
const missionNames = Object.fromEntries(Object.entries(QUESTS).map(([id, q]) => [id, `${q.icon} ${q.title[0]}`]));
const sampleNames = Object.fromEntries(SPECIMENS.map((s) => [s.id, `${s.icon} ${s.name[0]}`]));
const order = Object.keys(QUESTS);
for (const e of await packIndex()) {
  try {
    const p = await (await fetch(new URL(`packs/${e.path ?? `${e.id}/pack.json`}`, import.meta.url))).json();
    sampleNames[p.id ?? e.id] = `${p.icon ?? ''} ${p.name?.en ?? e.id}`;
    if (p.mission) { missionNames[`pack:${p.id ?? e.id}`] = `${p.mission.icon ?? ''} ${p.mission.title?.en ?? p.id}`; order.push(`pack:${p.id ?? e.id}`); }
  } catch { /* a pack that cannot be read keeps its id */ }
}

const local = loadStats().days ?? {};
const added = []; // { site, days } from other kiosks
let days = local;

// ---------------------------------------------------------------- charts: one series each, plain SVG
// drawn at the width they are shown (wide card ≈ 1000 px, half card ≈ 480 px), so the text stays 12 px
const WIDE = 1000, HALF = 480;
function vbars(items, h = 170, W = HALF) {
  const max = Math.max(1, ...items.map((d) => d.value)), n = items.length, pad = 26, bw = (W - pad) / n, gap = n > 40 ? 1 : 2;
  const every = Math.ceil(n / 12), ticks = [0, Math.ceil(max / 2), max];
  let s = `<svg viewBox="0 0 ${W} ${h + 34}" role="img">`;
  for (const t of ticks) { const y = h - (t / max) * h; s += `<line class="ax" x1="${pad}" x2="${W}" y1="${y}" y2="${y}"/><text x="${pad - 6}" y="${y + 4}" text-anchor="end">${num(t)}</text>`; }
  items.forEach((d, i) => {
    const x = pad + i * bw + gap / 2, bh = (d.value / max) * h, w = Math.max(1, bw - gap);
    s += `<g class="m" data-tip="${esc(d.tip ?? `${d.label}: ${num(d.value)}`)}"><rect x="${x}" y="0" width="${w}" height="${h}" fill="transparent"/>`
      + (bh > 0 ? `<path class="bar" d="M${x},${h} V${h - bh + Math.min(4, bh)} q0,-${Math.min(4, bh)} ${Math.min(4, w / 2)},-${Math.min(4, bh)} H${x + w - Math.min(4, w / 2)} q${Math.min(4, w / 2)},0 ${Math.min(4, w / 2)},${Math.min(4, bh)} V${h} Z"/>` : '') + '</g>';
    if (i % every === 0) s += `<text x="${x + w / 2}" y="${h + 16}" text-anchor="middle">${esc(d.short ?? d.label)}</text>`;
  });
  return `${s}<line class="ax" x1="${pad}" x2="${W}" y1="${h}" y2="${h}" style="stroke:#9aa3c2"/></svg>`;
}
function hbars(items, fmt = (d) => num(d.value), W = HALF) {
  const max = Math.max(1, ...items.map((d) => d.value)), lw = Math.min(210, W * 0.4), rh = 26, h = items.length * rh;
  let s = `<svg viewBox="0 0 ${W} ${h + 4}" role="img">`;
  items.forEach((d, i) => {
    const y = i * rh, bw = ((W - lw - 70) * d.value) / max;
    s += `<g class="m" data-tip="${esc(d.tip ?? `${d.label}: ${fmt(d)}`)}"><rect x="0" y="${y}" width="${W}" height="${rh}" fill="transparent"/>`
      + `<text x="0" y="${y + 17}" style="fill:var(--ink)">${esc(d.label)}</text>`
      + (bw > 0 ? `<rect class="bar" x="${lw}" y="${y + 5}" width="${bw}" height="${rh - 10}" rx="4"/>` : '')
      + `<text class="val" x="${lw + bw + 8}" y="${y + 17}">${esc(fmt(d))}</text></g>`;
  });
  return `${s}</svg>`;
}
const table = (head, rows) => `<details><summary>Show the numbers</summary><table><tr>${head.map((h, i) => `<th${i ? ' class="n"' : ''}>${esc(h)}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c, i) => `<td${i ? ' class="n"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</table></details>`;
const card = (title, note, body, wide) => `<section class="card${wide ? ' wide' : ''}"><h2>${esc(title)}</h2>${note ? `<p class="note">${note}</p>` : ''}${body}</section>`;

// ---------------------------------------------------------------- the period
function period() {
  const r = $('range').value, today = new Date(), keys = Object.keys(days).sort();
  $('from').hidden = $('to').hidden = r !== 'custom';
  if (r === 'custom') return [$('from').value || keys[0] || ymd(today), $('to').value || ymd(today)];
  if (r === 'all') return [keys[0] ?? ymd(today), keys.at(-1) ?? ymd(today)];
  if (r === 'year') return [`${today.getFullYear()}-01-01`, ymd(today)];
  const from = new Date(today); from.setDate(from.getDate() - (+r - 1)); return [ymd(from), ymd(today)];
}

function render() {
  days = mergeDays(local, ...added.map((a) => a.days));
  const [from, to] = period(), keys = Object.keys(days).filter((k) => k >= from && k <= to).sort();
  const sites = [settings.site || 'this kiosk', ...added.map((a) => a.site || 'another kiosk')];
  $('sub').textContent = `${sites.join(' + ')} · ${from} to ${to} · made ${ymd(new Date())}`;
  const T = keys.reduce((acc, k) => addDay(acc, days[k]), {}), n = T.sessions ?? 0;
  if (!n) {
    $('out').innerHTML = `<div class="empty">No visits in this period yet. Visits are counted in kiosk mode (<code>?kiosk</code>) on this device; you can also add another kiosk's data.</div>`;
    return;
  }
  // newer counters only exist on days recorded after they were added: rate them against those days' visits
  const has = (f) => keys.filter((k) => days[k][f] != null).reduce((a, k) => a + (days[k].sessions ?? 0), 0);
  const sum = (o) => Object.values(o ?? {}).reduce((a, b) => a + b, 0);
  const missions = sum(T.missions), nEng = has('engaged'), nIn = has('inputs'), nRead = has('read'), nCur = has('whats');
  const tiles = [
    [num(n), `visits on ${keys.filter((k) => days[k].sessions).length} days`],
    [pct(T.engaged ?? 0, nEng), 'engaged visits (30 s or a mission)'],
    [mmss((T.dwell ?? 0) / n), 'average stay'],
    [`${((T.dwell ?? 0) / 3600).toFixed(1)} h`, 'total time spent exploring'],
    [num(missions), `missions completed (${(missions / n).toFixed(1)} per visit)`],
    [pct(T.allMissions ?? 0, n), 'finished every mission'],
    [num(T.snaps ?? 0), `pictures taken · ${num(T.prints ?? 0)} stickers printed · ${num(T.qr ?? 0)} QR codes`],
    [nCur ? ((T.whats + T.parts + T.hints) / nCur).toFixed(1) : '—', 'questions per visit ("What\'s this?", parts, hints)'],
    [pct(T.read ?? 0, nRead), 'visits with Zip reading aloud'],
    [pct(T.inputs?.console ?? 0, nIn), 'visits using the Console or a controller'],
  ];
  const D = keys.map((k) => ({ label: k, short: k.slice(5), value: days[k].sessions ?? 0, tip: `${k}: ${num(days[k].sessions ?? 0)} visits, average stay ${mmss((days[k].dwell ?? 0) / Math.max(1, days[k].sessions ?? 0))}` }));
  const bins = (T.bins ?? []).map((v, i) => ({ label: BIN_NAMES[i], value: v, tip: `${BIN_NAMES[i]}: ${num(v)} visits (${pct(v, n)})` }));
  const hours = (T.hours ?? Array(24).fill(0)).map((v, h) => ({ label: `${h}:00`, short: `${h}h`, value: v, tip: `${h}:00–${h + 1}:00: ${num(v)} visits` }));
  const mrows = order.filter((id) => missionNames[id]).map((id) => ({ label: missionNames[id], value: T.missions?.[id] ?? 0, reached: T.reached?.[id] }));
  const langs = Object.entries(T.langs ?? {}).sort((a, b) => b[1] - a[1]).map(([l, v]) => ({ label: LANG_NAMES[l] ?? l, value: v }));
  const samples = Object.entries(T.samples ?? {}).sort((a, b) => b[1] - a[1]).map(([s, v]) => ({ label: sampleNames[s] ?? s, value: v }));
  const inputs = [['touch', 'Touch screen'], ['mouse', 'Mouse'], ['keyboard', 'Keyboard'], ['console', 'Console or controller']].map(([k, l]) => ({ label: l, value: T.inputs?.[k] ?? 0 })).filter((d) => nIn);
  const a11y = [['hc', 'High contrast'], ['big', 'Bigger text'], ['calm', 'Calm motion']].map(([k, l]) => ({ label: l, value: T.a11yOpts?.[k] ?? 0 }));
  const share = (base) => (d) => `${num(d.value)} (${pct(d.value, base)})`;
  $('out').innerHTML = `<div class="tiles">${tiles.map(([b, s]) => `<div class="tile"><b>${esc(b)}</b><span>${esc(s)}</span></div>`).join('')}</div>
  <div class="grid">
    ${card('Visits per day', '', vbars(D, 170, WIDE) + table(['Day', 'Visits', 'Engaged', 'Average stay (s)'], keys.map((k) => [k, days[k].sessions ?? 0, days[k].engaged ?? '', Math.round((days[k].dwell ?? 0) / Math.max(1, days[k].sessions ?? 0))])), true)}
    ${card('How long visitors stay', 'Visits by length.', vbars(bins, 150) + table(['Stay', 'Visits', 'Share'], bins.map((b) => [b.label, b.value, pct(b.value, n)])))}
    ${card('When visitors come', 'Visits by the hour they started (kiosk time).', vbars(hours, 150) + table(['Hour', 'Visits'], hours.filter((h) => h.value).map((h) => [h.label, h.value])))}
    ${card('Missions', 'Share of visits that finished each mission, in the order they come.', hbars(mrows, share(n)) + table(['Mission', 'Reached', 'Finished', 'Share of visits'], mrows.map((m) => [m.label, m.reached ?? '', m.value, pct(m.value, n)])))}
    ${card('Languages', 'Visits that used each language.', hbars(langs, share(n)) + table(['Language', 'Visits'], langs.map((l) => [l.label, l.value])))}
    ${card('Samples explored', 'Visits that looked at each sample.', hbars(samples, share(n)) + table(['Sample', 'Visits'], samples.map((s) => [s.label, s.value])))}
    ${inputs.length ? card('How visitors drive it', 'Visits that used each kind of control (a visit can use several).', hbars(inputs, share(nIn)) + table(['Control', 'Visits'], inputs.map((i) => [i.label, i.value]))) : ''}
    ${card('Accessibility options', `${pct(T.a11y ?? 0, n)} of visits turned on at least one option.`, hbars(a11y, share(n)) + table(['Option', 'Visits'], a11y.map((a) => [a.label, a.value])))}
    ${nCur ? card('Curiosity and care', 'What visitors did besides the missions.', hbars([
      { label: '"What\'s this?" asked', value: T.whats ?? 0 }, { label: 'Microscope parts tapped', value: T.parts ?? 0 }, { label: 'Hints asked', value: T.hints ?? 0 },
      { label: 'Visits that turned the beam on', value: T.beam ?? 0 }, { label: 'Samples "cooked" by the beam', value: T.cooked ?? 0 }])) : ''}
  </div>`;
}

// ---------------------------------------------------------------- controls
$('range').addEventListener('change', render); $('from').addEventListener('change', render); $('to').addEventListener('change', render);
$('print').addEventListener('click', () => print());
$('csv').addEventListener('click', () => { const [f, t] = period(); download(`electron-explorer-visits-${f}-to-${t}.csv`, csv(Object.fromEntries(Object.entries(days).filter(([k]) => k >= f && k <= t))), 'text/csv'); });
$('json').addEventListener('click', () => download(`electron-explorer-visits-${ymd(new Date())}.json`, exportJson(days, [settings.site, ...added.map((a) => a.site)].filter(Boolean).join(' + ')), 'application/json'));
$('addBtn').addEventListener('click', () => $('add').click());
$('addBtn').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('add').click(); } });
$('add').addEventListener('change', async () => {
  for (const f of $('add').files) {
    try { const j = JSON.parse(await f.text()); if (j.format !== FORMAT || typeof j.days !== 'object') throw new Error('not an Electron Explorer export'); added.push({ site: j.site || f.name, days: j.days }); }
    catch (e) { alert(`${f.name}: ${e.message}`); }
  }
  $('add').value = ''; render();
});
// hover values
const tip = $('tip');
$('out').addEventListener('pointermove', (e) => { const g = e.target.closest('g.m'); if (!g) { tip.hidden = true; return; } tip.textContent = g.dataset.tip; tip.style.left = `${e.clientX}px`; tip.style.top = `${e.clientY}px`; tip.hidden = false; });
$('out').addEventListener('pointerleave', () => (tip.hidden = true));
// from a kiosk: back to the exhibit, and back on its own after five minutes untouched
if (KIOSK) {
  $('back').href = './?kiosk';
  let t = setTimeout(() => location.replace('./?kiosk'), 300000);
  ['pointerdown', 'keydown', 'wheel'].forEach((ev) => addEventListener(ev, () => { clearTimeout(t); t = setTimeout(() => location.replace('./?kiosk'), 300000); }, { passive: true }));
}
render();
