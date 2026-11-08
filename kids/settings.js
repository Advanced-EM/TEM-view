// Kiosk settings, kept in this browser (the museum's kiosk) and changed in the staff menu (kiosk.js).
// Nothing here identifies a visitor.

export const DEFAULTS = {
  kiosk: false,          // kiosk mode on this device (or add ?kiosk to the address)
  pin: '1933',           // staff menu PIN
  lang: '',              // language a visitor starts in ('' = the browser's)
  langs: ['en', 'es', 'pt', 'fr', 'de'], // languages offered on the screen
  voice: 'female', read: false, volume: 0.8,
  reset: 180,            // seconds without a touch before the exhibit starts over
  pal: 'color',
  hc: false, big: false, calm: false, // accessibility defaults: high contrast, bigger text, calm motion
  takeHome: 'both',      // 'off', 'print', 'qr' or 'both'
  label: '2in',          // sticker printer: '2in' round labels, '58mm' receipt roll, '4x6' photo paper
  printMax: 3,           // stickers one visitor may print
  stickerUrl: 'https://advanced-em.github.io/TEM-view/kids/sticker.html',
  packs: null,           // enabled sample packs (null = the packs marked default)
};
const KEY = 'kids-kiosk';
let cur;
try { cur = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { cur = { ...DEFAULTS }; }
export const settings = cur;
export function saveSettings(patch = {}) {
  Object.assign(cur, patch);
  try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch { /* private mode: this session only */ }
}
export const kioskMode = () => (typeof location !== 'undefined' && new URLSearchParams(location.search).has('kiosk')) || cur.kiosk;
