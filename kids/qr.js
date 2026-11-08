// A small QR Code encoder (ISO/IEC 18004) for the take-home code: byte mode, error correction level L,
// versions 1–15 (up to 520 bytes), the mask chosen by the standard penalty rules.
// qr(text) → { size, get(x, y) }; drawQR(canvas, text) paints it with the 4-module quiet zone.

const EC_L = [ // version → [EC codewords per block, [blocks, data codewords per block]…]
  null, [7, [1, 19]], [10, [1, 34]], [15, [1, 55]], [20, [1, 80]], [26, [1, 108]], [18, [2, 68]], [20, [2, 78]], [24, [2, 97]],
  [30, [2, 116]], [18, [2, 68], [2, 69]], [20, [4, 81]], [24, [2, 92], [2, 93]], [26, [4, 107]], [30, [3, 115], [1, 116]], [22, [5, 87], [1, 88]],
];
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70]];

// GF(256) with x^8 + x^4 + x^3 + x^2 + 1
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
function rsRem(data, n) { // remainder of data·x^n divided by the generator polynomial of degree n
  let g = [1];
  for (let i = 0; i < n; i++) { const h = new Array(g.length + 1).fill(0); for (let j = 0; j < g.length; j++) { h[j] ^= g[j]; h[j + 1] ^= mul(g[j], EXP[i]); } g = h; }
  const r = [...data, ...new Array(n).fill(0)];
  for (let i = 0; i < data.length; i++) { const c = r[i]; if (c) for (let j = 0; j < g.length; j++) r[i + j] ^= mul(g[j], c); }
  return r.slice(data.length);
}
const MASKS = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0];

export function qr(text) {
  const bytes = [...new TextEncoder().encode(text)];
  let ver = 1, cap = 0;
  for (; ver <= 15; ver++) { cap = EC_L[ver].slice(1).reduce((a, [b, d]) => a + b * d, 0); if (4 + (ver < 10 ? 8 : 16) + bytes.length * 8 <= cap * 8) break; }
  if (ver > 15) throw new Error('QR: text too long');
  // data: byte mode, length, the bytes, terminator, then padding
  const bits = []; const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  put(4, 4); put(bytes.length, ver < 10 ? 8 : 16); bytes.forEach((b) => put(b, 8));
  put(0, Math.min(4, cap * 8 - bits.length)); while (bits.length % 8) bits.push(0);
  const data = []; for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let p = 0; data.length < cap; p++) data.push(p % 2 ? 0x11 : 0xec);
  // blocks with their error correction, interleaved
  const [ecn, ...groups] = EC_L[ver], blocks = []; let k = 0;
  for (const [b, d] of groups) for (let i = 0; i < b; i++) { blocks.push(data.slice(k, k + d)); k += d; }
  const ecs = blocks.map((b) => rsRem(b, ecn)), cw = [];
  for (let i = 0; i < Math.max(...blocks.map((b) => b.length)); i++) for (const b of blocks) if (i < b.length) cw.push(b[i]);
  for (let i = 0; i < ecn; i++) for (const e of ecs) cw.push(e[i]);

  const N = 17 + 4 * ver, M = new Uint8Array(N * N), F = new Uint8Array(N * N); // modules; function-pattern flags
  const set = (x, y, v) => { if (x >= 0 && y >= 0 && x < N && y < N) { M[y * N + x] = v ? 1 : 0; F[y * N + x] = 1; } };
  for (let i = 0; i < N; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const finder = (cx, cy) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)); set(cx + dx, cy + dy, d !== 2 && d !== 4); } };
  finder(3, 3); finder(N - 4, 3); finder(3, N - 4);
  const A = ALIGN[ver], last = A.length - 1;
  A.forEach((ay, i) => A.forEach((ax, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  const format = (mask) => { // both copies of the format information (level L = 01) and the dark module
    const d = (1 << 3) | mask; let rem = d; for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const b = ((d << 10) | rem) ^ 0x5412, bit = (i) => (b >>> i) & 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(N - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, N - 15 + i, bit(i));
    set(8, N - 8, 1);
  };
  format(0); // reserve its cells
  if (ver >= 7) {
    let rem = ver; for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const b = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) { const v = (b >>> i) & 1, a = N - 11 + (i % 3), c = Math.floor(i / 3); set(a, c, v); set(c, a, v); }
  }
  // the codewords, in two-column zigzags from the bottom right
  let i = 0;
  for (let right = N - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < N; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, y = ((right + 1) & 2) === 0 ? N - 1 - vert : vert;
      if (!F[y * N + x] && i < cw.length * 8) { M[y * N + x] = (cw[i >>> 3] >>> (7 - (i & 7))) & 1; i++; }
    }
  }
  // try every mask and keep the one with the lowest penalty
  const base = M.slice(); let best = null, bestP = Infinity;
  for (let m = 0; m < 8; m++) {
    M.set(base);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!F[y * N + x] && MASKS[m](x, y)) M[y * N + x] ^= 1;
    format(m);
    const p = penalty(M, N); if (p < bestP) { bestP = p; best = M.slice(); }
  }
  return { size: N, get: (x, y) => best[y * N + x] === 1 };
}

function penalty(M, N) {
  let p = 0; const at = (x, y) => M[y * N + x];
  for (let t = 0; t < 2; t++) for (let a = 0; a < N; a++) { // runs of five or more in rows, then columns
    let run = 1;
    for (let b = 1; b <= N; b++) {
      if (b < N && (t ? at(a, b) === at(a, b - 1) : at(b, a) === at(b - 1, a))) run++;
      else { if (run >= 5) p += run - 2; run = 1; }
    }
  }
  for (let y = 0; y < N - 1; y++) for (let x = 0; x < N - 1; x++) { const v = at(x, y); if (v === at(x + 1, y) && v === at(x, y + 1) && v === at(x + 1, y + 1)) p += 3; }
  const pat = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], rev = [...pat].reverse();
  for (let a = 0; a < N; a++) for (let b = 0; b <= N - 11; b++) for (const P of [pat, rev]) {
    if (P.every((v, k) => at(b + k, a) === v)) p += 40;
    if (P.every((v, k) => at(a, b + k) === v)) p += 40;
  }
  let dark = 0; for (let k = 0; k < N * N; k++) dark += M[k];
  return p + Math.floor(Math.abs((dark * 100) / (N * N) - 50) / 5) * 10;
}

export function drawQR(canvas, text, px = 8) {
  const q = qr(text), n = q.size + 8;
  canvas.width = canvas.height = n * px; const g = canvas.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, n * px, n * px); g.fillStyle = '#000';
  for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (q.get(x, y)) g.fillRect((x + 4) * px, (y + 4) * px, px, px);
  return canvas;
}
