// The compute worker: runs kernels.js jobs off the main thread for WorkerBackend (compute.js).
// Messages in:  { op: 'run', id, job } · { op: 'pause', id, paused } · { op: 'cancel', id }
// Messages out: { id, type: 'patterns', from, count, data } (4D scan, in chunks) · { id, type: 'epie' | 'msepie',
//               iter, k, errHist, ... object } (snapshots) · { id, type: 'tomo', x, iter, resid } (a reconstruction,
//               after every SIRT iteration) · { id, type: 'spa', snap } (spa.spaResult) · { id, type: 'error', message }
//               · final: true at the end
//               · { type: 'gpu', label } once, when WebGPU is (or is not: label null) available here
// The 4D data set of a scan stays here (the last two), so ptychography jobs reuse it without copying 26 MB.
// Jobs with gpu: true (a 4D-STEM scan without precession, tomography) run on WebGPU (gpu.js) when this worker has
// it; anything the GPU cannot take, or a GPU error, falls back to the same JS kernels.
const V = self.location.search; // the page's cache-busting stamp, passed on to the kernels
let K = null, TOMO = null, SPA = null, PT = null, G = null;
const pending = [], tasks = new Map(), datasets = new Map();
const now = () => performance.now();
self.onmessage = (e) => (K ? handle(e.data) : pending.push(e.data));
const gpuReady = import(`./gpu.js${V}`).then((m) => m.createGPU()).catch(() => null);
Promise.all([import(`./kernels.js${V}`), import(`./tomo.js${V}`), import(`./spa.js${V}`), import(`./ptychotomo.js${V}`), gpuReady]).then(([m, t, sp, pt, g]) => {
  K = m; TOMO = t; SPA = sp; PT = pt; G = g;
  self.postMessage({ type: 'gpu', label: g ? g.label : null });
  for (const d of pending.splice(0)) handle(d);
});

function handle(m) {
  if (m.op === 'cancel') { const t = tasks.get(m.id); if (t) { t.cancelled = true; t.wake?.(); } tasks.delete(m.id); return; }
  if (m.op === 'pause') { const t = tasks.get(m.id); if (t) { t.paused = m.paused; if (!m.paused) { if (t.onGPU) t.wake?.(); else schedule(t); } } return; }
  if (m.op !== 'run') return;
  const job = m.job, t = { id: m.id, job, paused: false, cancelled: false, lastPost: 0 };
  try {
    if (job.kind === 'fd-scan') {
      const g = job.geom;
      t.data = new Float32Array(g.N * g.N * g.n4 * g.n4);
      t.st = K.fdInit(job, t.data); t.sent = t.st.done;
      datasets.set(m.id, t.data);
      while (datasets.size > 2) { const k = datasets.keys().next().value; datasets.delete(k); self.postMessage({ type: 'dropped', id: k }); }
    } else if (job.kind === 'spa') {
      t.st = SPA.spaInit(job.params);
    } else if (job.kind === 'ptychotomo') {
      t.st = PT.ptInit(job.params);
    } else if (job.kind !== 'tomo') {
      t.data = job.data ?? datasets.get(job.dataset);
      if (!t.data) throw new Error('the 4D data set is not in the worker any more: restart the scan');
      t.T = {};
      job.kind === 'epie' ? K.epieInit(t.T, job.geom, job.pr, job.pi, job.seed) : K.msInit(t.T, job.geom, job.seed);
    }
  } catch (err) { self.postMessage({ id: m.id, type: 'error', message: String(err.message ?? err), final: true }); return; }
  tasks.set(m.id, t);
  if (job.gpu && G && !G.lost && (job.kind === 'tomo' ? G.tomoFits(job.ser.N, job.ser.angles.length) : job.kind === 'fd-scan' && G.fdFits(job))) { runGPU(t); return; }
  startCPU(t);
}
function startCPU(t) {
  const j = t.job;
  t.onGPU = false;
  if (j.kind === 'tomo' && j.method === 'sirt') t.st = TOMO.sirtInit(j.ser, { iterations: j.iterations, positivity: true });
  schedule(t);
}

// ---------------------------------------------------------------- WebGPU (gpu.js)
const waitWhilePaused = (t) => (t.paused && !t.cancelled ? new Promise((r) => { t.wake = r; }).then(() => waitWhilePaused(t)) : null);
async function runGPU(t) {
  const j = t.job;
  t.onGPU = true;
  let r = null;
  try {
    if (j.kind === 'tomo') {
      r = G.tomo(j.ser);
      if (j.method !== 'sirt') {
        const x = await r.wbp(TOMO.filterSeries(j.ser, j.filter), TOMO.intervals(j.ser.angles));
        if (!t.cancelled) self.postMessage({ id: t.id, type: 'tomo', x, iter: 1, resid: [], device: G.label, final: true }, [x.buffer]);
      } else {
        r.sirtInit({ iterations: j.iterations, positivity: true });
        let more = true;
        while (more && !t.cancelled) {
          await waitWhilePaused(t);
          if (t.cancelled) break;
          more = await r.sirtStep();
          if (more && now() - t.lastPost < 200) continue; // a fast GPU: send the volume ~5 times a second
          t.lastPost = now();
          const x = await r.readX();
          self.postMessage({ id: t.id, type: 'tomo', x, iter: r.iter, resid: [...r.resid], device: G.label, final: !more }, [x.buffer]);
        }
      }
    } else {
      const g = j.geom, n2 = g.n4 * g.n4, total = g.N * g.N;
      r = G.fdScan(j);
      while (t.st.done < total && !t.cancelled) {
        await waitWhilePaused(t);
        if (t.cancelled) break;
        const from = t.st.done, count = Math.min(r.B, total - from), pat = await r.run(from, count);
        t.data.set(pat, from * n2);
        t.st.done = from + count;
        const end = t.st.done >= total;
        if (end || now() - t.lastPost > 60) {
          const chunk = t.data.slice(t.sent * n2, t.st.done * n2);
          self.postMessage({ id: t.id, type: 'patterns', from: t.sent, count: t.st.done - t.sent, data: chunk, device: G.label, final: end }, [chunk.buffer]);
          t.sent = t.st.done; t.lastPost = now();
        }
      }
    }
    tasks.delete(t.id);
  } catch (err) {
    // carry on in JS from where the GPU stopped (a 4D scan keeps the patterns it has)
    self.postMessage({ id: t.id, type: 'gpu-error', message: String(err?.message ?? err) });
    if (!t.cancelled) startCPU(t);
  } finally { r?.destroy(); }
}

// ---------------------------------------------------------------- JS kernels
// work in ~25 ms slices so pause and cancel messages get through; send results every ~60 ms (scan) / 250 ms
function schedule(t) { if (!t.scheduled) { t.scheduled = true; setTimeout(() => { t.scheduled = false; work(t); }, 0); } }
function work(t) {
  if (t.cancelled || t.paused) return;
  const j = t.job, g = j.geom;
  if (j.kind === 'ptychotomo') {
    // the ptychographic tomography preview (ptychotomo.js): everything after each tilt, progress every ~250 ms
    const before = `${t.st.stage}${t.st.t}`, more = PT.ptStep(t.st, 25, now), changed = `${t.st.stage}${t.st.t}` !== before || !more;
    if (changed || now() - t.lastPost > 250) { self.postMessage({ id: t.id, type: 'ptychotomo', snap: PT.ptResult(t.st, { light: !changed }), final: !more }); t.lastPost = now(); }
    if (!more) { tasks.delete(t.id); return; }
    schedule(t);
    return;
  }
  if (j.kind === 'spa') {
    // the SPA pipeline (spa.js) in ~25 ms slices; everything at each new stage, the counters every ~250 ms
    const before = t.st.stage, more = SPA.spaStep(t.st, 25, now), changed = t.st.stage !== before || !more;
    if (changed || now() - t.lastPost > 250) { self.postMessage({ id: t.id, type: 'spa', snap: SPA.spaResult(t.st, { light: !changed }), final: !more }); t.lastPost = now(); }
    if (!more) { tasks.delete(t.id); return; }
    schedule(t);
    return;
  }
  if (j.kind === 'tomo') {
    // WBP in one go; SIRT an iteration per slice of work (an iteration is the unit: ~0.1–2 s)
    const x = j.method === 'sirt' ? (TOMO.sirtStep(t.st, j.ser, 0, now), t.st.x) : TOMO.wbp(j.ser, { filter: j.filter });
    const iter = j.method === 'sirt' ? t.st.iter : 1, end = iter >= (j.method === 'sirt' ? j.iterations : 1);
    const snap = x.slice();
    self.postMessage({ id: t.id, type: 'tomo', x: snap, iter, resid: t.st ? [...t.st.resid] : [], device: 'cpu', final: end }, [snap.buffer]);
    if (end) { tasks.delete(t.id); return; }
    schedule(t);
    return;
  }
  if (j.kind === 'fd-scan') {
    K.fdStep(t.st, 25, now);
    const end = t.st.done >= g.N * g.N;
    if (end || now() - t.lastPost > 60) {
      const n2 = g.n4 * g.n4, chunk = t.data.slice(t.sent * n2, t.st.done * n2);
      self.postMessage({ id: t.id, type: 'patterns', from: t.sent, count: t.st.done - t.sent, data: chunk, device: 'cpu', final: end }, [chunk.buffer]);
      t.sent = t.st.done; t.lastPost = now();
    }
    if (end) { tasks.delete(t.id); return; }
  } else {
    const T = t.T, more = j.kind === 'epie' ? K.epieStep(T, g, j.pr, j.pi, t.data, 25, now) : K.msStep(T, g, j.pr, j.pi, j.prop, t.data, 25, now);
    const end = !more || T.iter >= T.maxIter, newIter = T.iter !== t.lastIter;
    if (end || newIter || now() - t.lastPost > 250) {
      const snap = { id: t.id, type: j.kind, iter: T.iter, k: T.k, errHist: [...T.errHist], err: T.err, final: end };
      const tr = [];
      if (j.kind === 'epie') { snap.re = T.re.slice(); snap.im = T.im.slice(); tr.push(snap.re.buffer, snap.im.buffer); }
      else { snap.O = T.O.map((o) => ({ re: o.re.slice(), im: o.im.slice() })); for (const o of snap.O) tr.push(o.re.buffer, o.im.buffer); }
      self.postMessage(snap, tr);
      t.lastPost = now(); t.lastIter = T.iter;
    }
    if (end) { tasks.delete(t.id); return; }
  }
  schedule(t);
}
