// ComputeBackend: one interface for the heavy loops, whatever runs them.
//
//   const task = backend.run(job, sink)   job: { kind: 'fd-scan' | 'epie' | 'msepie', ... }; sink: where results go
//   task.pump(budgetMs)                   called once per frame by Sim.update: computes (inline) or applies
//                                         what the worker has sent (worker); budget 0 pauses
//   task.done / task.finished             progress
//   task.cancel()
//
// InlineBackend runs the kernels (kernels.js) on the calling thread within the budget: headless runs, tests and
// browsers without workers. WorkerBackend runs the same kernels in a module Web Worker (compute-worker.js), so
// the page stays responsive; the 4D data set stays in the worker and the ptychography jobs reuse it. Both give
// identical results: the kernels are the same code and their visiting order is seeded.
// Tier 2/3 backends (a lab GPU worker, an HPC bundle) will implement the same run(job) (M11, M12).
import * as K from './kernels.js';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// ---------------------------------------------------------------- inline (same thread)
class InlineTask {
  constructor(job, sink) {
    this.job = job; this.sink = sink; this.finished = false;
    if (job.kind === 'fd-scan') { this.st = K.fdInit(job, sink.data); this.done = this.st.done; }
    else if (job.kind === 'epie') K.epieInit(sink.out, job.geom, job.pr, job.pi, job.seed);
    else if (job.kind === 'msepie') K.msInit(sink.out, job.geom, job.seed);
    else throw new Error(`unknown job kind ${job.kind}`);
  }
  pump(budget) {
    if (this.finished || this.cancelled || !(budget > 0)) return 0;
    const j = this.job, s = this.sink;
    if (j.kind === 'fd-scan') { const n = K.fdStep(this.st, budget, now); this.done = this.st.done; this.finished = this.done >= j.geom.N * j.geom.N; return n; }
    const more = j.kind === 'epie' ? K.epieStep(s.out, j.geom, j.pr, j.pi, s.data, budget, now) : K.msStep(s.out, j.geom, j.pr, j.pi, j.prop, s.data, budget, now);
    this.finished = s.out.iter >= s.out.maxIter || !more;
    return 1;
  }
  cancel() { this.cancelled = true; }
}
export class InlineBackend {
  constructor() { this.name = 'inline'; }
  run(job, sink) { return new InlineTask(job, sink); }
}

// ---------------------------------------------------------------- Web Worker
let nextId = 1;
class WorkerTask {
  constructor(backend, job, sink) {
    this.remote = true; // results arrive asynchronously (see Sim.syncCompute)
    this.b = backend; this.job = job; this.sink = sink; this.id = nextId++; this.queue = []; this.done = job.done ?? 0; this.finished = false; this.paused = false;
    if (job.kind === 'epie') K.epieInit(sink.out, job.geom, job.pr, job.pi, job.seed); // the display sees a start state at once
    if (job.kind === 'msepie') K.msInit(sink.out, job.geom, job.seed);
    const msg = { op: 'run', id: this.id, job: { ...job } };
    if (job.kind !== 'fd-scan') { msg.job.dataset = job.dataset; if (!backend.has(job.dataset)) msg.job.data = sink.data; } // the data are in the worker already
    backend.post(msg);
    backend.tasks.set(this.id, this);
  }
  receive(m) { this.queue.push(m); }
  // apply what arrived; budget 0 pauses the worker (as a paused simulation stops computing)
  pump(budget) {
    const pause = !(budget > 0);
    if (pause !== this.paused && !this.finished) { this.paused = pause; this.b.post({ op: 'pause', id: this.id, paused: pause }); }
    let n = 0;
    for (const m of this.queue.splice(0)) {
      if (m.type === 'patterns') { this.sink.data.set(m.data, m.from * this.job.geom.n4 * this.job.geom.n4); this.done = m.from + m.count; n += m.count; }
      else if (m.type === 'epie') { const T = this.sink.out; T.re.set(m.re); T.im.set(m.im); Object.assign(T, { iter: m.iter, k: m.k, errHist: m.errHist, err: m.err }); n++; }
      else if (m.type === 'msepie') { const T = this.sink.out; m.O.forEach((o, k) => { T.O[k].re.set(o.re); T.O[k].im.set(o.im); }); Object.assign(T, { iter: m.iter, k: m.k, errHist: m.errHist }); n++; }
      else if (m.type === 'error') { this.error = m.message; this.finished = true; }
      if (m.final) { this.finished = true; this.b.tasks.delete(this.id); }
    }
    if (this.job.kind === 'fd-scan' && this.finished) this.b.datasets.add(this.id);
    return n;
  }
  cancel() { if (!this.finished) this.b.post({ op: 'cancel', id: this.id }); this.finished = true; this.b.tasks.delete(this.id); }
}
export class WorkerBackend {
  constructor(url) {
    this.name = 'worker'; this.tasks = new Map(); this.datasets = new Set(); this.failed = null;
    this.w = new Worker(url, { type: 'module' });
    this.w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'dropped') { this.datasets.delete(m.id); return; }
      this.tasks.get(m.id)?.receive(m);
    };
    this.w.onerror = (e) => { this.failed = e.message || 'worker error'; for (const t of this.tasks.values()) t.receive({ type: 'error', message: this.failed, final: true }); };
  }
  has(id) { return this.datasets.has(id); }
  post(m) { this.w.postMessage(m); } // the slices and probe are copied once per job (a few MB)
  run(job, sink) { return new WorkerTask(this, job, sink); }
  terminate() { this.w.terminate(); }
}

// the best backend this environment offers: a worker in a browser, inline elsewhere (or if the worker fails)
export function defaultBackend(workerUrl) {
  if (typeof Worker === 'undefined' || !workerUrl) return new InlineBackend();
  try { return new WorkerBackend(workerUrl); } catch { return new InlineBackend(); }
}
