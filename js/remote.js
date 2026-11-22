// Tier 2 compute (M11): reconstructions on a computer of your own (a lab GPU box, this machine's Python) through a
// temview-connect/1 compute connector (tools/connect: `temview-connect serve --adapter recon`).
//
//   const b = new RemoteBackend(url, desc)      desc: the connector's GET /describe
//   b.run(job, sink)                            the same interface as compute.js (task.pump, task.finished, cancel)
//
// A job goes out as POST /jobs (kind reconstruct, its data as base64 arrays), progress comes back as server-sent
// events (GET /jobs/<id>/events, read with fetch so it also works in Node and through tunnels), and the result as
// TEM-view .npz (GET /jobs/<id>/result). Tomography is routed here today; the protocol also carries 4D-STEM
// ptychography and simulated series for Python and agents.
import { readNpy } from './npy.js';

export const CONNECT_FORMAT = 'temview-connect/1';

function b64(u8) {
  if (typeof Buffer !== 'undefined') return Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('base64');
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
// a protocol array (temview_connect.protocol.decode_array): little-endian float32 (or interleaved complex64)
export function encodeArray(f32, shape, dtype = 'float32') { return { dtype, shape, b64: b64(new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength)) }; }
// stored-entry zip (.npz) → { name: ArrayBuffer }
export function unzipStored(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf), out = {};
  for (let p = 0; p + 30 <= u8.length && dv.getUint32(p, true) === 0x04034b50;) {
    const size = dv.getUint32(p + 18, true), nlen = dv.getUint16(p + 26, true), xlen = dv.getUint16(p + 28, true), start = p + 30 + nlen + xlen;
    out[new TextDecoder().decode(u8.slice(p + 30, p + 30 + nlen))] = buf.slice(start, start + size);
    p = start + size;
  }
  return out;
}
// server-sent events through fetch: calls onEvent(kind, data) until the stream ends or signal aborts
export async function readEvents(url, onEvent, signal) {
  const r = await fetch(url, { signal, cache: 'no-store' });
  if (!r.ok || !r.body) throw new Error(`events: HTTP ${r.status}`);
  const rd = r.body.getReader(), dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await rd.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      let kind = 'message', data = '';
      for (const line of block.split('\n')) { if (line.startsWith('event:')) kind = line.slice(6).trim(); else if (line.startsWith('data:')) data += line.slice(5).trim(); }
      if (data) onEvent(kind, JSON.parse(data));
    }
  }
}

class RemoteTask {
  constructor(b, job, sink) {
    this.remote = true; this.b = b; this.job = job; this.sink = sink; this.queue = []; this.finished = false; this.error = null; this.device = b.label;
    this.ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    if (job.kind !== 'tomo') throw new Error(`the lab connector takes tomography jobs here, not ${job.kind}`);
    Object.assign(sink.out, { method: job.method, iter: 0, iterations: job.method === 'sirt' ? job.iterations : 1, resid: [], x: null, device: b.label });
    this.start().catch((e) => { if (!this.cancelled) this.queue.push({ type: 'error', message: String(e.message ?? e) }); });
  }
  async start() {
    const { ser, method, filter, iterations } = this.job, N = ser.N, T = ser.proj.length, st = new Float32Array(T * N * N);
    ser.proj.forEach((p, t) => st.set(p, t * N * N));
    const body = { format: CONNECT_FORMAT, kind: 'reconstruct', mode: 'tomo', method, filter, iterations, engine: this.b.engine ?? 'auto', angles_deg: Array.from(ser.angles, Number), arrays: { tilt_series: encodeArray(st, [T, N, N]) } };
    const r = await fetch(`${this.b.url}/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: this.ctrl?.signal });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
    this.id = j.id;
    let failed = null;
    await readEvents(`${this.b.url}/jobs/${j.id}/events`, (kind, data) => {
      if (kind === 'progress') this.queue.push({ type: 'progress', fraction: data.fraction, message: data.message });
      if (kind === 'error') failed = data.error;
    }, this.ctrl?.signal);
    if (failed) throw new Error(failed);
    const res = await fetch(`${this.b.url}/jobs/${j.id}/result`, { signal: this.ctrl?.signal });
    if (!res.ok) throw new Error(`result: HTTP ${res.status}`);
    const files = unzipStored(await res.arrayBuffer()), meta = JSON.parse(new TextDecoder().decode(files['metadata.json']));
    const rec = readNpy(files['reconstruction.npy']);
    this.queue.push({ type: 'done', x: rec.data, meta });
  }
  pump() {
    let n = 0;
    for (const m of this.queue.splice(0)) {
      const o = this.sink.out;
      if (m.type === 'progress') { o.iter = Math.round((m.fraction ?? 0) * o.iterations); o.message = m.message; n++; }
      else if (m.type === 'done') { Object.assign(o, { x: m.x, iter: o.iterations, resid: m.meta.residual ?? [], device: `${this.b.label} · ${m.meta.engine}`, seconds: m.meta.seconds }); this.finished = true; n++; }
      else if (m.type === 'error') { this.error = m.message; this.finished = true; }
    }
    return n;
  }
  cancel() { this.cancelled = true; this.ctrl?.abort(); this.finished = true; }
}

export class RemoteBackend {
  constructor(url, desc = {}) {
    this.name = 'lab'; this.url = url.replace(/\/$/, ''); this.desc = desc;
    const g = desc.resources?.gpus?.[0];
    this.label = `lab · ${desc.name ?? url}${g ? ` · ${g.name}` : ''}`;
    this.engine = 'auto';
  }
  // whether this connector can take a job of this kind
  takes(kind) { return kind === 'tomo' && (this.desc.acquisitions ?? []).includes('reconstruct') && (this.desc.modes ?? []).includes('tomo'); }
  run(job, sink) { return new RemoteTask(this, job, sink); }
}
// probe connector URLs for compute connectors (Status panel): [{ url, desc }]
export async function findCompute(urls, timeoutMs = 900) {
  const out = [];
  await Promise.all(urls.map(async (url) => {
    try {
      const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), timeoutMs);
      const r = await fetch(`${url.replace(/\/$/, '')}/describe`, { signal: ctrl.signal, cache: 'no-store' });
      clearTimeout(t);
      if (!r.ok) return;
      const d = await r.json();
      if (d.format === CONNECT_FORMAT) out.push({ url: url.replace(/\/$/, ''), desc: d });
    } catch { /* nothing there */ }
  }));
  return out;
}
