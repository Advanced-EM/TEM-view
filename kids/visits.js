// The kiosk's visitor numbers: anonymous totals per day, kept in this browser only (kiosk.js writes them, the staff
// menu and report.html read them). A day holds counts, never single visits:
//   sessions (visits), dwell (seconds, summed), bins (visits per stay band), hours (visits by starting hour),
//   missions / reached (visits that finished / got to each mission), allMissions, engaged (stayed 30 s or finished a
//   mission), beam, snaps, prints, qr, hints, whats, parts, cooked, read, a11y (visits using any option),
//   a11yOpts, inputs (visits using touch / mouse / keyboard / console), langs, samples.
export const STATS = 'kids-stats';
export const BINS = [30, 60, 120, 300, 600, Infinity];
export const BIN_NAMES = ['under 30 s', '30–60 s', '1–2 min', '2–5 min', '5–10 min', 'over 10 min'];
export const FORMAT = 'electron-explorer-visits/1';

export function loadStats() { try { return JSON.parse(localStorage.getItem(STATS) || '{"days":{}}'); } catch { return { days: {} }; } }

// add one day's totals into another (numbers add, arrays add by position, objects add by key)
export function addDay(into, d) {
  for (const [k, v] of Object.entries(d ?? {})) {
    if (typeof v === 'number') into[k] = (into[k] ?? 0) + v;
    else if (Array.isArray(v)) { into[k] ??= v.map(() => 0); v.forEach((x, i) => (into[k][i] = (into[k][i] ?? 0) + x)); }
    else if (v && typeof v === 'object') { into[k] ??= {}; for (const [kk, x] of Object.entries(v)) into[k][kk] = (into[k][kk] ?? 0) + x; }
  }
  return into;
}
// several kiosks' exports (or this one's) into one set of days
export function mergeDays(...sets) {
  const out = {};
  for (const days of sets) for (const [k, d] of Object.entries(days ?? {})) out[k] = addDay(out[k] ?? {}, d);
  return out;
}

const pairs = (o) => Object.entries(o ?? {}).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${n}`).join(' ');
export function csv(days) {
  const head = ['day', 'visits', 'engaged_visits', 'total_seconds', 'average_stay_s', ...BIN_NAMES.map((b) => `stay ${b}`), ...Array.from({ length: 24 }, (_, h) => `started ${h}h`),
    'missions_completed', 'finished_all_missions', 'turned_on_beam', 'pictures', 'stickers_printed', 'qr_shown', 'hints', 'whats_this', 'parts_tapped', 'samples_cooked',
    'read_aloud_visits', 'accessibility_visits', 'high_contrast', 'bigger_text', 'calm_motion', 'touch', 'mouse', 'keyboard', 'console_or_controller',
    'languages', 'samples', 'missions_reached', 'missions_done'];
  const rows = Object.keys(days).sort().map((k) => {
    const d = days[k], n = d.sessions ?? 0, sum = (o) => Object.values(o ?? {}).reduce((a, b) => a + b, 0);
    return [k, n, d.engaged ?? '', d.dwell ?? 0, n ? Math.round((d.dwell ?? 0) / n) : 0, ...(d.bins ?? BINS.map(() => 0)), ...(d.hours ?? Array(24).fill('')),
      sum(d.missions), d.allMissions ?? 0, d.beam ?? '', d.snaps ?? 0, d.prints ?? 0, d.qr ?? 0, d.hints ?? '', d.whats ?? '', d.parts ?? '', d.cooked ?? '',
      d.read ?? '', d.a11y ?? 0, d.a11yOpts?.hc ?? '', d.a11yOpts?.big ?? '', d.a11yOpts?.calm ?? '', d.inputs?.touch ?? '', d.inputs?.mouse ?? '', d.inputs?.keyboard ?? '', d.inputs?.console ?? '',
      pairs(d.langs), pairs(d.samples), pairs(d.reached), pairs(d.missions)].join(',');
  });
  return [head.join(','), ...rows].join('\n');
}
export const exportJson = (days, site = '') => JSON.stringify({ format: FORMAT, site, exported: new Date().toISOString().slice(0, 10), days }, null, 1);

export function download(name, text, type) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
