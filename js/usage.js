// Usage metrics: how the exhibits are used, for general statistics (privacy.html says what and why).
//
// One record per page visit ("tem-view-usage/1"), sent to the collector (hf/worker, POST /usage) a minute after the
// page opens, then once a minute while it changes, and when the page is hidden or closed; each report replaces the
// last. It holds the page, the time in each mode and specimen (only while the page is visible), counts of what was
// used (acquisitions, training, Python, …), the kinds of input, the device class, a rounded screen size, the
// language and the referring site. No cookies, no stored identifier, nothing typed or recorded: the id is random
// for each page load. The collector adds the city-level location Cloudflare derives from the connection; it does
// not store the IP address.
//
// Off when USAGE.url is empty, on localhost (add ?track to test), with Do Not Track or Global Privacy Control,
// with ?notrack, or after "Turn off" (kept in localStorage, which privacy.html also sets). The Kids exhibit does
// not use it.
import { USAGE } from './config.js';

export const USAGE_FORMAT = 'tem-view-usage/1';
const OFF = 'tv-usage-off', SEEN = 'tv-usage-notice';
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private window */ } } };

export function usageAllowed() {
  const q = new URLSearchParams(location.search);
  if (!USAGE.url || q.has('notrack') || store.get(OFF)) return false;
  if (navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true) return false;
  return !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || q.has('track');
}
export const setUsageOff = (off) => store.set(OFF, off ? '1' : null);

const device = () => {
  const coarse = matchMedia('(pointer: coarse)').matches, w = Math.min(screen.width, screen.height);
  return coarse && w < 600 ? 'phone' : coarse ? 'tablet' : 'desktop';
};
const referrer = () => { try { const u = new URL(document.referrer); return u.host === location.host ? '' : u.host; } catch { return ''; } };
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

const stamp = () => document.querySelector('script[src*="main.js"]')?.getAttribute('src')?.split('v=')[1] ?? 'dev';

// page: 'tem-view' | 'ruska' | 'scanning'; dims: () => ({ mode, specimen, … }), sampled each second while visible;
// privacy: the link to privacy.html from this page. Returns { count(name), input(kind) }; a no-op when off.
export function startUsage({ page, version = stamp(), dims = () => ({}), privacy = 'privacy.html' }) {
  const noop = { count() {}, input() {} };
  if (!usageAllowed()) return noop;
  const t0 = Date.now(), rec = {
    format: USAGE_FORMAT, id: newId(), page, version, seq: 0, started: new Date(t0).toISOString(), duration_s: 0, active_s: 0,
    lang: navigator.language || '', device: device(), screen: [],
    referrer: referrer(), kiosk: new URLSearchParams(location.search).has('kiosk') || matchMedia('(display-mode: fullscreen)').matches,
    inputs: [], time: {}, counts: {},
  };
  let dirty = true, sentActive = -1;
  const input = (k) => { if (!rec.inputs.includes(k)) { rec.inputs.push(k); dirty = true; } };
  const count = (name) => { rec.counts[name] = (rec.counts[name] ?? 0) + 1; dirty = true; };

  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    rec.active_s++;
    let d = {};
    try { d = dims() ?? {}; } catch { /* page still starting */ }
    for (const [k, v] of Object.entries(d)) {
      if (v == null || v === '') continue;
      const t = (rec.time[k] ??= {}), key = String(v).slice(0, 32);
      if (Object.keys(t).length < 60 || key in t) t[key] = (t[key] ?? 0) + 1;
    }
  }, 1000);

  const send = (beacon) => {
    if (!USAGE.url || (!dirty && rec.active_s === sentActive)) return;
    rec.duration_s = Math.round((Date.now() - t0) / 1000); rec.seq++;
    rec.screen = [Math.round(innerWidth / 100) * 100, Math.round(innerHeight / 100) * 100];
    const body = JSON.stringify(rec);
    dirty = false; sentActive = rec.active_s;
    // text/plain keeps it a simple request (no CORS preflight)
    if (beacon && navigator.sendBeacon?.(USAGE.url, new Blob([body], { type: 'text/plain' }))) return;
    fetch(USAGE.url, { method: 'POST', body, keepalive: true, headers: { 'content-type': 'text/plain' } }).catch(() => {});
  };
  setTimeout(() => { send(false); setInterval(() => send(false), 60_000); }, 60_000);
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && rec.active_s >= 3) send(true); });
  addEventListener('pagehide', () => { if (rec.active_s >= 3) send(true); });

  addEventListener('pointerdown', (e) => input(e.pointerType === 'touch' ? 'touch' : e.pointerType === 'pen' ? 'pen' : 'mouse'), { capture: true, passive: true });
  addEventListener('keydown', () => input('keyboard'), { capture: true, passive: true });
  addEventListener('gamepadconnected', () => input('gamepad'));

  if (!store.get(SEEN)) setTimeout(() => notice(privacy), 1500); // after the page has set its language
  return { count, input };
}

const TEXT = {
  en: ['This exhibit counts anonymous usage (which parts are used, and the city it is used from). It does not store your IP address or use cookies.', 'Privacy', 'Turn off', 'OK'],
  de: ['Diese Ausstellung zählt die Nutzung anonym (welche Teile genutzt werden und aus welcher Stadt). Sie speichert keine IP-Adresse und setzt keine Cookies.', 'Datenschutz', 'Ausschalten', 'OK'],
};

// a short notice the first time, at the bottom left, in the page's language; "Turn off" stops this visit too
function notice(privacy) {
  const [msg, link, off, ok] = TEXT[document.documentElement.lang?.startsWith('de') ? 'de' : 'en'];
  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:9999;max-width:min(420px,calc(100vw - 24px));padding:10px 12px;border-radius:10px;'
    + 'background:rgba(12,14,18,.94);color:#e8ecf2;border:1px solid rgba(255,255,255,.16);font:13px/1.45 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.4)';
  el.innerHTML = `${msg} <a href="${privacy}" style="color:#8fd6ff">${link}</a><span style="display:flex;gap:8px;margin-top:8px;justify-content:flex-end">`
    + `<button data-a="off" style="font:inherit;padding:4px 10px;border-radius:7px;border:1px solid rgba(255,255,255,.25);background:none;color:inherit;cursor:pointer">${off}</button>`
    + `<button data-a="ok" style="font:inherit;padding:4px 12px;border-radius:7px;border:0;background:#8fd6ff;color:#081018;cursor:pointer">${ok}</button></span>`;
  el.addEventListener('click', (e) => {
    const a = e.target.closest('button')?.dataset.a;
    if (!a) return;
    store.set(SEEN, '1');
    if (a === 'off') { setUsageOff(true); USAGE.url = ''; }
    el.remove();
  });
  document.body.appendChild(el);
}
