// WebGPU kernels (M8): the hot loops on the graphics card, where the browser offers WebGPU.
//
//   const g = await createGPU()            null without WebGPU (or without an adapter): callers keep the JS path
//   await g.fft2(re, im, n, inv, batch)     batched 2D FFT (Stockham radix 2), the same convention as kernels.fft2
//   g.fdScan(job)                           4D-STEM multislice (transmit × propagate, far field), a batch of probe
//                                           positions per dispatch: await r.run(from, count) → Float32 patterns
//   g.tomo(ser)                             tomography operators: await t.wbp(filtered, weights) (back-projection
//                                           of the projections filtered by tomo.filterSeries), t.sirtInit(o),
//                                           await t.sirtStep() (one iteration), await t.readX()
//
// The JS kernels (kernels.js, tomo.js) stay the reference: every GPU operator computes the same sums in the same
// discretisation (the projector gathers exactly the weights the JS projector splats), in single precision, and
// tools/gpu-check.mjs checks GPU against JS in headless Chromium. Works in a window and in a worker.
const WG = 64;
const STORAGE = 0x80, COPY_SRC = 0x4, COPY_DST = 0x8, UNIFORM = 0x40, MAP_READ = 0x1; // GPUBufferUsage

// a linear thread index over a 2D dispatch (one dimension is limited to 65 535 workgroups)
const LIN = 'let t = g.x + g.y * nw.x * 64u;';
const ENTRY = '@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g: vec3u, @builtin(num_workgroups) nw: vec3u';

// ---------------------------------------------------------------- shaders
// one radix-2 Stockham stage along x (axis 0) or y (axis 1) of a batch of n × n arrays; dir +1 forward (e^−iωt,
// as kernels.fft2), −1 inverse; the output is in natural order after log₂ n stages, scaled by `scale`. The
// twiddles e^{−2πi m/n} come from a table computed in double precision (the WGSL sin/cos are only good to ~1e-4
// on some adapters)
const FFT = /* wgsl */ `
struct P { n: u32, half: u32, ns: u32, axis: u32, total: u32, dir: f32, scale: f32, pad: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> src: array<vec2f>;
@group(0) @binding(2) var<storage, read_write> dst: array<vec2f>;
@group(0) @binding(3) var<storage, read> tw: array<vec2f>;
${ENTRY}) {
  ${LIN}
  if (t >= p.total) { return; }
  let j = t % p.half; let line = t / p.half; let nn = p.n * p.n; let b = line / p.n; let r = line % p.n;
  var base = b * nn + r * p.n; var st = 1u;
  if (p.axis == 1u) { base = b * nn + r; st = p.n; }
  let k = j % p.ns;
  let w0 = tw[k * (p.half / p.ns)]; let w = vec2f(w0.x, p.dir * w0.y);
  let v0 = src[base + j * st]; let x1 = src[base + (j + p.half) * st];
  let v1 = vec2f(x1.x * w.x - x1.y * w.y, x1.x * w.y + x1.y * w.x);
  let d = (j / p.ns) * p.ns * 2u + k;
  dst[base + d * st] = (v0 + v1) * p.scale;
  dst[base + (d + p.ns) * st] = (v0 - v1) * p.scale;
}`;

// multislice pieces: a batch of n × n waves (one per probe position)
const MS_HEAD = 'struct P { n: u32, gridN: u32, sbase: u32, total: u32 }\n@group(0) @binding(0) var<uniform> p: P;\n';
const cmul = 'fn cmul(a: vec2f, b: vec2f) -> vec2f { return vec2f(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }\n';
const MS_INIT = MS_HEAD + /* wgsl */ `
@group(0) @binding(1) var<storage, read> probe: array<vec2f>;
@group(0) @binding(2) var<storage, read_write> wave: array<vec2f>;
${ENTRY}) { ${LIN} if (t >= p.total) { return; } wave[t] = probe[t % (p.n * p.n)]; }`;
// wave × the slice's transmission function in the window of this position (corner: left, top)
const MS_TRANSMIT = MS_HEAD + cmul + /* wgsl */ `
@group(0) @binding(1) var<storage, read> slices: array<vec2f>;
@group(0) @binding(2) var<storage, read> corner: array<vec2u>;
@group(0) @binding(3) var<storage, read_write> wave: array<vec2f>;
${ENTRY}) {
  ${LIN}
  if (t >= p.total) { return; }
  let n2 = p.n * p.n; let b = t / n2; let q = t % n2; let y = q / p.n; let x = q % p.n; let c = corner[b];
  wave[t] = cmul(slices[p.sbase + (c.y + y) * p.gridN + c.x + x], wave[t]);
}`;
// wave × H (the Fresnel propagator, in Fourier space)
const MS_MUL = MS_HEAD + cmul + /* wgsl */ `
@group(0) @binding(1) var<storage, read> h: array<vec2f>;
@group(0) @binding(2) var<storage, read_write> wave: array<vec2f>;
${ENTRY}) { ${LIN} if (t >= p.total) { return; } wave[t] = cmul(wave[t], h[t % (p.n * p.n)]); }`;
// the far-field intensity, centred (as kernels.fdStep)
const MS_INT = MS_HEAD + /* wgsl */ `
@group(0) @binding(1) var<storage, read> wave: array<vec2f>;
@group(0) @binding(2) var<storage, read_write> out: array<f32>;
${ENTRY}) {
  ${LIN}
  if (t >= p.total) { return; }
  let n2 = p.n * p.n; let b = t / n2; let q = t % n2; let y = q / p.n; let x = q % p.n; let h = p.n / 2u; let w = wave[t];
  out[b * n2 + ((y + h) % p.n) * p.n + (x + h) % p.n] = w.x * w.x + w.y * w.y;
}`;

// tomography: vol[x + N (y + N z)], proj[t][x + N v], v = (y − c) cos θ − (z − c) sin θ + c; ang[t] = (cos, sin, w)
// projector, gathered per detector bin: the weights the JS projector splats (1 − f into ⌊v⌋, f into ⌊v⌋ + 1);
// mode 1 projects a volume of ones and stores 1/row sum (SIRT's R)
const TOMO_HEAD = 'struct P { N: u32, T: u32, total: u32, mode: u32, c: f32, relax: f32, pos: u32, pad: u32 }\n@group(0) @binding(0) var<uniform> p: P;\n@group(0) @binding(1) var<storage, read> ang: array<vec4f>;\n';
const TOMO_PROJECT = TOMO_HEAD + /* wgsl */ `
@group(0) @binding(2) var<storage, read> vol: array<f32>;
@group(0) @binding(3) var<storage, read_write> out: array<f32>;
${ENTRY}) {
  ${LIN}
  if (t >= p.total) { return; }
  let N = p.N; let x = t % N; let vb = i32((t / N) % N); let k = t / (N * N); let a = ang[k]; let cs = a.x; let sn = a.y; let c = p.c;
  var s = 0.0;
  for (var z = 0u; z < N; z++) {
    let bv = c - (f32(z) - c) * sn;
    var y0 = 0; var y1 = i32(N) - 1;
    if (abs(cs) > 1e-6) {
      let lo = (f32(vb) - 1.0 - bv) / cs + c; let hi = (f32(vb) + 1.0 - bv) / cs + c;
      y0 = max(0, i32(floor(min(lo, hi))) - 1); y1 = min(i32(N) - 1, i32(ceil(max(lo, hi))) + 1);
    }
    for (var y = y0; y <= y1; y++) {
      let v = (f32(y) - c) * cs + bv; let v0 = floor(v); let f = v - v0; let iv = i32(v0);
      var wt = 0.0;
      if (iv == vb) { wt = 1.0 - f; } else if (iv + 1 == vb) { wt = f; }
      if (wt != 0.0) { if (p.mode == 1u) { s += wt; } else { s += wt * vol[x + N * (u32(y) + N * z)]; } }
    }
  }
  if (p.mode == 1u) { if (s > 1e-6) { s = 1.0 / s; } else { s = 0.0; } }
  out[t] = s;
}`;
// SIRT residual: d = p − Ax (into ax, × R), and per-workgroup sums of d² and p²
const TOMO_RESID = TOMO_HEAD + /* wgsl */ `
@group(0) @binding(2) var<storage, read> meas: array<f32>;
@group(0) @binding(3) var<storage, read> rinv: array<f32>;
@group(0) @binding(4) var<storage, read_write> ax: array<f32>;
@group(0) @binding(5) var<storage, read_write> part: array<vec2f>;
var<workgroup> sh: array<vec2f, 64>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g: vec3u, @builtin(num_workgroups) nw: vec3u, @builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wid: vec3u) {
  ${LIN}
  _ = ang[0]; // (the shared layout binds the angles)
  var e = vec2f(0.0, 0.0);
  if (t < p.total) { let m = meas[t]; let d = m - ax[t]; e = vec2f(d * d, m * m); ax[t] = d * rinv[t]; }
  sh[li] = e;
  workgroupBarrier();
  for (var s = 32u; s > 0u; s = s >> 1u) { if (li < s) { sh[li] = sh[li] + sh[li + s]; } workgroupBarrier(); }
  if (li == 0u) { part[wid.x + wid.y * nw.x] = sh[0]; }
}`;
// back-projector, gathered per voxel (the adjoint of the projector): s = Σ_t w_t [(1 − f) p_t(⌊v⌋) + f p_t(⌊v⌋ + 1)]
// mode 0: vol = s (WBP) · 1: x ← max(0, x + C s) (SIRT) · 2: of a projection of ones, C = relax / s
const TOMO_BACK = TOMO_HEAD + /* wgsl */ `
@group(0) @binding(2) var<storage, read> pr: array<f32>;
@group(0) @binding(3) var<storage, read> aux: array<f32>;
@group(0) @binding(4) var<storage, read_write> vol: array<f32>;
${ENTRY}) {
  ${LIN}
  if (t >= p.total) { return; }
  let N = p.N; let x = t % N; let y = (t / N) % N; let z = t / (N * N); let c = p.c;
  var s = 0.0;
  for (var k = 0u; k < p.T; k++) {
    let a = ang[k];
    let v = (f32(y) - c) * a.x - (f32(z) - c) * a.y + c; let v0 = floor(v); let f = v - v0; let iv = i32(v0);
    if (iv < -1 || iv >= i32(N)) { continue; }
    let pb = k * N * N + x;
    var acc = 0.0;
    if (p.mode == 2u) {
      if (iv >= 0) { acc += 1.0 - f; }
      if (iv + 1 < i32(N)) { acc += f; }
    } else {
      if (iv >= 0) { acc += (1.0 - f) * pr[pb + N * u32(iv)]; }
      if (iv + 1 < i32(N)) { acc += f * pr[pb + N * u32(iv + 1)]; }
    }
    s += a.z * acc;
  }
  if (p.mode == 0u) { vol[t] = s; }
  else if (p.mode == 1u) { var v = vol[t] + aux[t] * s; if (p.pos == 1u && v < 0.0) { v = 0.0; } vol[t] = v; }
  else { if (s > 1e-6) { vol[t] = p.relax / s; } else { vol[t] = 0.0; } }
}`;

// ---------------------------------------------------------------- the device
export async function createGPU({ powerPreference = 'high-performance' } = {}) {
  const gpu = globalThis.navigator?.gpu;
  if (!gpu) return null;
  try {
    const adapter = await gpu.requestAdapter({ powerPreference });
    if (!adapter) return null;
    // ask for large buffers when the adapter has them (a 256³ volume is 64 MB; the 4D-STEM slices can be more)
    const want = 2 ** 31;
    const requiredLimits = {
      maxBufferSize: Math.min(adapter.limits.maxBufferSize, want),
      maxStorageBufferBindingSize: Math.min(adapter.limits.maxStorageBufferBindingSize, want),
      maxStorageBuffersPerShaderStage: Math.min(adapter.limits.maxStorageBuffersPerShaderStage, 8),
    };
    const device = await adapter.requestDevice({ requiredLimits });
    const info = adapter.info ?? (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : {});
    return new GPUCompute(device, { vendor: info.vendor || '', architecture: info.architecture || '', description: info.description || '' });
  } catch { return null; }
}

// a uniform block of 8 four-byte fields: [value, 'u' | 'f'] pairs
function uniformData(fields) {
  const b = new ArrayBuffer(32), v = new DataView(b);
  fields.forEach(([x, k], i) => (k === 'f' ? v.setFloat32(i * 4, x, true) : v.setUint32(i * 4, x >>> 0, true)));
  return b;
}
const interleave = (re, im, out = new Float32Array(2 * re.length), o = 0) => { for (let i = 0; i < re.length; i++) { out[o + 2 * i] = re[i]; out[o + 2 * i + 1] = im[i]; } return out; };

export class GPUCompute {
  constructor(device, info) {
    this.device = device; this.info = info; this.lost = false; this.pipes = new Map();
    this.limits = { maxBuffer: device.limits.maxBufferSize, maxBinding: device.limits.maxStorageBufferBindingSize };
    device.lost?.then(() => { this.lost = true; });
    this.label = [info.vendor, info.architecture].filter(Boolean).join(' · ') || 'WebGPU';
  }
  pipe(code) {
    let p = this.pipes.get(code);
    if (!p) { p = this.device.createComputePipeline({ layout: 'auto', compute: { module: this.device.createShaderModule({ code }), entryPoint: 'main' } }); this.pipes.set(code, p); }
    return p;
  }
  buffer(bytes, usage = STORAGE | COPY_SRC | COPY_DST) { return this.device.createBuffer({ size: Math.max(16, Math.ceil(bytes / 4) * 4), usage }); }
  upload(arr, usage) { const b = this.buffer(arr.byteLength, usage); this.device.queue.writeBuffer(b, 0, arr.buffer, arr.byteOffset, arr.byteLength); return b; }
  uniform(fields) { const b = this.buffer(32, UNIFORM | COPY_DST); this.device.queue.writeBuffer(b, 0, uniformData(fields)); return b; }
  bind(code, buffers) { const pipe = this.pipe(code); return { pipe, bg: this.device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } })) }) }; }
  // one dispatch of `threads` invocations (2D when it needs more than 65 535 workgroups)
  dispatch(pass, { pipe, bg }, threads) {
    const groups = Math.ceil(threads / WG), gx = Math.min(groups, 65535), gy = Math.ceil(groups / gx);
    pass.setPipeline(pipe); pass.setBindGroup(0, bg); pass.dispatchWorkgroups(gx, gy);
    return gx * gy;
  }
  groups(threads) { const groups = Math.ceil(threads / WG), gx = Math.min(groups, 65535); return gx * Math.ceil(groups / gx); }
  async read(buf, bytes, offset = 0) {
    const st = this.buffer(bytes, MAP_READ | COPY_DST), enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(buf, offset, st, 0, Math.ceil(bytes / 4) * 4);
    this.device.queue.submit([enc.finish()]);
    await st.mapAsync(MAP_READ);
    const out = st.getMappedRange(0, bytes).slice(0);
    st.unmap(); st.destroy();
    return out;
  }
  // a batched 2D FFT on buffer A (B is scratch, same size): the stages ping-pong and end in A (2·log₂ n stages)
  fftPlan(n, batch, A, B) {
    const lv = Math.round(Math.log2(n));
    if (1 << lv !== n) throw new Error(`FFT size ${n} is not a power of 2`);
    const tw = new Float32Array(n);
    for (let m = 0; m < n / 2; m++) { tw[2 * m] = Math.cos((2 * Math.PI * m) / n); tw[2 * m + 1] = -Math.sin((2 * Math.PI * m) / n); }
    const twb = this.upload(tw);
    const total = batch * n * (n / 2), mk = (dir, scale) => {
      const steps = [];
      let src = A, dst = B, s = 0;
      for (const axis of [0, 1]) for (let ns = 1; ns < n; ns <<= 1, s++) {
        const last = axis === 1 && ns === n / 2;
        steps.push(this.bind(FFT, [this.uniform([[n, 'u'], [n / 2, 'u'], [ns, 'u'], [axis, 'u'], [total, 'u'], [dir, 'f'], [last ? scale : 1, 'f'], [0, 'u']]), src, dst, twb]));
        [src, dst] = [dst, src];
      }
      return steps;
    };
    const fwd = mk(1, 1), inv = mk(-1, 1 / (n * n));
    return { encode: (pass, inverse = false) => { for (const st of inverse ? inv : fwd) this.dispatch(pass, st, total); } };
  }
  // kernels.fft2 on the GPU, for a batch of n × n arrays (re, im: batch·n²); returns { re, im } (Float32)
  async fft2(re, im, n, inv = false, batch = 1) {
    const A = this.upload(interleave(re, im)), B = this.buffer(8 * batch * n * n), plan = this.fftPlan(n, batch, A, B);
    const enc = this.device.createCommandEncoder(), pass = enc.beginComputePass();
    plan.encode(pass, inv); pass.end();
    this.device.queue.submit([enc.finish()]);
    const c = new Float32Array(await this.read(A, 8 * batch * n * n));
    A.destroy(); B.destroy();
    const outR = new Float32Array(batch * n * n), outI = new Float32Array(batch * n * n);
    for (let i = 0; i < outR.length; i++) { outR[i] = c[2 * i]; outI[i] = c[2 * i + 1]; }
    return { re: outR, im: outI };
  }
  fdScan(job, batch) { return new FDScanGPU(this, job, batch); }
  tomo(ser) { return new TomoGPU(this, ser); }
  // whether a tomography job of N³ voxels and T projections fits this device's largest buffer
  tomoFits(N, T) { const v = 4 * N ** 3, s = 4 * T * N * N, m = Math.min(this.limits.maxBinding, this.limits.maxBuffer); return v <= m && s <= m; }
  fdFits(job) { const g = job.geom; return 8 * g.K * g.gridN * g.gridN <= Math.min(this.limits.maxBinding, this.limits.maxBuffer) && !job.ped; }
}

// ---------------------------------------------------------------- 4D-STEM multislice (kernels.fdStep)
const corner = (g, i) => Math.round(g.gridN / 2 + (-g.scan / 2 + (i + 0.5) * g.step) / g.dx) - g.n4 / 2;
class FDScanGPU {
  constructor(G, job, batch) {
    const g = job.geom, n = g.n4, n2 = n * n, gg = g.gridN * g.gridN;
    this.G = G; this.g = g; this.B = batch ?? Math.max(1, Math.min(256, Math.floor(2 ** 22 / n2)));
    const B = this.B, total = B * n2;
    const sl = new Float32Array(2 * g.K * gg);
    job.slices.forEach((s, k) => interleave(s.re, s.im, sl, 2 * k * gg));
    this.slices = G.upload(sl);
    this.probe = G.upload(interleave(job.pr, job.pi)); this.H = G.upload(interleave(job.prop.re, job.prop.im));
    this.corner = G.buffer(8 * B); this.A = G.buffer(8 * total); this.Bb = G.buffer(8 * total); this.out = G.buffer(4 * total);
    this.fft = G.fftPlan(n, B, this.A, this.Bb);
    const u = (sbase) => G.uniform([[n, 'u'], [g.gridN, 'u'], [sbase, 'u'], [total, 'u']]);
    const u0 = u(0);
    this.init = G.bind(MS_INIT, [u0, this.probe, this.A]);
    this.trans = Array.from({ length: g.K }, (_, k) => G.bind(MS_TRANSMIT, [u(k * gg), this.slices, this.corner, this.A]));
    this.mul = G.bind(MS_MUL, [u0, this.H, this.A]);
    this.int = G.bind(MS_INT, [u0, this.A, this.out]);
    this.total = total; this.n2 = n2;
  }
  // patterns of scan positions from … from + count − 1 (count ≤ B): Float32 count·n4², centred
  async run(from, count) {
    const { G, g, B, total } = this, c = new Uint32Array(2 * B);
    for (let b = 0; b < B; b++) { const idx = Math.min(from + b, g.N * g.N - 1); c[2 * b] = corner(g, idx % g.N); c[2 * b + 1] = corner(g, (idx / g.N) | 0); }
    G.device.queue.writeBuffer(this.corner, 0, c);
    const enc = G.device.createCommandEncoder(), pass = enc.beginComputePass();
    G.dispatch(pass, this.init, total);
    for (let k = 0; k < g.K; k++) {
      G.dispatch(pass, this.trans[k], total);
      if (k < g.K - 1) { this.fft.encode(pass, false); G.dispatch(pass, this.mul, total); this.fft.encode(pass, true); }
    }
    this.fft.encode(pass, false);
    G.dispatch(pass, this.int, total);
    pass.end();
    G.device.queue.submit([enc.finish()]);
    return new Float32Array(await G.read(this.out, 4 * count * this.n2));
  }
  destroy() { for (const b of [this.slices, this.probe, this.H, this.corner, this.A, this.Bb, this.out]) b.destroy(); }
}

// ---------------------------------------------------------------- tomography (tomo.js project / backproject)
const DEG = Math.PI / 180;
class TomoGPU {
  constructor(G, ser) {
    const N = ser.N, T = ser.angles.length, N3 = N ** 3, S = T * N * N;
    Object.assign(this, { G, N, T, N3, S, c: N / 2 - 0.5, angles: ser.angles });
    const st = new Float32Array(S);
    ser.proj.forEach((p, t) => st.set(p, t * N * N));
    this.meas = G.upload(st);
    this.angU = this.angleBuffer(ser.angles.map(() => 1));
  }
  angleBuffer(w) { const a = new Float32Array(4 * this.T); this.angles.forEach((th, t) => { a[4 * t] = Math.cos(th * DEG); a[4 * t + 1] = Math.sin(th * DEG); a[4 * t + 2] = w[t]; }); return this.G.upload(a); }
  u(mode, total, relax = 1, pos = 1) { return this.G.uniform([[this.N, 'u'], [this.T, 'u'], [total, 'u'], [mode, 'u'], [this.c, 'f'], [relax, 'f'], [pos, 'u'], [0, 'u']]); }
  submit(fn) { const enc = this.G.device.createCommandEncoder(), pass = enc.beginComputePass(); fn(pass); pass.end(); this.G.device.queue.submit([enc.finish()]); }
  // WBP: back-projection of the filtered projections (tomo.filterSeries) with the interval weights (tomo.intervals)
  async wbp(filtered, weights) {
    const { G, N, N3 } = this, st = new Float32Array(this.S);
    filtered.forEach((p, t) => st.set(p, t * N * N));
    const fp = G.upload(st), ang = this.angleBuffer(weights), vol = G.buffer(4 * N3), dummy = G.buffer(16);
    this.submit((pass) => G.dispatch(pass, G.bind(TOMO_BACK, [this.u(0, N3), ang, fp, dummy, vol]), N3));
    const x = new Float32Array(await G.read(vol, 4 * N3));
    for (const b of [fp, ang, vol, dummy]) b.destroy();
    return x;
  }
  // SIRT (tomo.sirtInit / sirtStep): R and C from projections of ones, x from 0
  sirtInit({ iterations = 30, relax = 1, positivity = true } = {}) {
    const { G, N3, S } = this;
    Object.assign(this, { iterations, iter: 0, resid: [] });
    this.x = G.buffer(4 * N3); this.colInv = G.buffer(4 * N3); this.rowInv = G.buffer(4 * S); this.ax = G.buffer(4 * S);
    this.part = G.buffer(8 * G.groups(S)); this.dummy = G.buffer(16);
    this.pProject = G.bind(TOMO_PROJECT, [this.u(0, S), this.angU, this.x, this.ax]);
    this.pResid = G.bind(TOMO_RESID, [this.u(0, S), this.angU, this.meas, this.rowInv, this.ax, this.part]);
    this.pUpdate = G.bind(TOMO_BACK, [this.u(1, N3, relax, positivity ? 1 : 0), this.angU, this.ax, this.colInv, this.x]);
    this.submit((pass) => {
      G.dispatch(pass, G.bind(TOMO_PROJECT, [this.u(1, S), this.angU, this.x, this.rowInv]), S);
      G.dispatch(pass, G.bind(TOMO_BACK, [this.u(2, N3, relax), this.angU, this.dummy, this.dummy, this.colInv]), N3);
    });
  }
  // one iteration: x ← x + λ C Aᵀ R (p − A x); returns more iterations to go
  async sirtStep() {
    const { G, S, N3 } = this;
    this.submit((pass) => { G.dispatch(pass, this.pProject, S); G.dispatch(pass, this.pResid, S); G.dispatch(pass, this.pUpdate, N3); });
    const part = new Float32Array(await G.read(this.part, 8 * G.groups(S)));
    let r2 = 0, p2 = 0;
    for (let i = 0; i < part.length; i += 2) { r2 += part[i]; p2 += part[i + 1]; }
    this.resid.push(Math.sqrt(r2 / (p2 || 1)));
    this.iter++;
    return this.iter < this.iterations;
  }
  async readX() { return new Float32Array(await this.G.read(this.x, 4 * this.N3)); }
  destroy() { for (const b of [this.meas, this.angU, this.x, this.colInv, this.rowInv, this.ax, this.part, this.dummy]) b?.destroy(); }
}
