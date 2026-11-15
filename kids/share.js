// Sending a kiosk's daily totals (visits.js) to the collector (js/config.js KIOSK, hf/worker /kiosk), when the
// museum's staff turn it on in the staff menu. Only days whose totals changed since they were last accepted are
// sent, at most every two minutes and whenever a visit ends; a kiosk that was offline catches up when it is back.
// What leaves the kiosk: its random id, its name, the exhibit version and those daily totals. No single visits.
import { KIOSK } from '../js/config.js';
import { loadStats } from './visits.js';
import { settings, saveSettings } from './settings.js';

const SENT = 'kids-sent'; // day -> fingerprint of the totals the collector accepted
const store = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); localStorage.setItem(k, JSON.stringify(v)); } catch { return null; } return null; };
const print = (o) => { let h = 0; for (const c of JSON.stringify(o)) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0; return h.toString(36); };
const version = () => (document.querySelector('script[type=module][src]')?.getAttribute('src').match(/v=(\w+)/) ?? [])[1] ?? '';
let last = 0, busy = false;

export const sharingOn = () => !!(KIOSK.url && settings.share);
// the kiosk's own random id, made once
export function kioskId() {
  if (!settings.kioskId) saveSettings({ kioskId: `kiosk-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)}` });
  return settings.kioskId;
}

// send what changed; force skips the two-minute pause (staff "Send now")
export async function sync(force = false) {
  if (!sharingOn() || busy || (!force && Date.now() - last < 120_000)) return null;
  busy = true; last = Date.now();
  try {
    const days = loadStats().days ?? {}, sent = store(SENT) ?? {}, out = {};
    const cut = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
    for (const [d, t] of Object.entries(days)) if (d >= cut && t.sessions && sent[d] !== print(t)) out[d] = t;
    const keys = Object.keys(out).sort();
    if (!keys.length) { store('kids-sent-at', new Date().toISOString()); store('kids-sent-error', null); return 0; }
    // in batches of 20 days, well under the collector's 64 KB limit
    for (let i = 0; i < keys.length; i += 20) {
      const batch = keys.slice(i, i + 20);
      const body = JSON.stringify({ format: 'electron-explorer-kiosk/1', kiosk: kioskId(), site: settings.site || '', version: version(), days: Object.fromEntries(batch.map((k) => [k, out[k]])) });
      const r = await fetch(KIOSK.url, { method: 'POST', body, keepalive: body.length < 60_000, headers: { 'content-type': 'text/plain' } });
      if (!r.ok) throw new Error(`collector ${r.status}`);
      for (const k of batch) sent[k] = print(out[k]);
      store(SENT, sent);
    }
    store('kids-sent-at', new Date().toISOString()); store('kids-sent-error', null);
    return keys.length;
  } catch (e) { store('kids-sent-error', `${new Date().toISOString().slice(0, 16)} ${e.message}`); return null; }
  finally { busy = false; }
}
export const lastSent = () => ({ at: store('kids-sent-at'), error: store('kids-sent-error') });
