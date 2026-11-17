// Drive mode: steer the stage like a joystick instead of dragging the image. Press on the image and pull a tether;
// the stage travels toward where you pull, faster the further you pull, and coasts to a stop when you let go. A thin
// instrument tray along the bottom shows live readouts. Idea borrowed from the cockpit-style HUD of
// chuanqisun.github.io/spaceship (pull-vector steering, tabular readout bar).
const NS = 'http://www.w3.org/2000/svg';
const FULL = 130;      // px of pull for full speed
const DEAD = 8;        // px of pull ignored
const TOP = 1.4;       // field widths per second at full pull
const KEYS = ['mode', 'kV', 'fov', 'defocus', 'dose', 'stage', 'speed', 'frame'];

export class Drive {
  // opts: canvas, allowed() -> bool, fovA() -> field of view in Å, move(dxA, dyA), done(), readouts() -> {mode,kV,fov,defocus,dose,x,y}
  constructor(opts) {
    this.o = opts;
    this.on = false;
    this.pull = null;          // { x0, y0, x, y } in client px while a pull is active
    this.v = [0, 0];           // current stage velocity, Å/s
    this.moved = false;
    this.acc = 0;
    const cv = opts.canvas;
    cv.addEventListener('pointerdown', (e) => this.down(e), true);
    cv.addEventListener('pointermove', (e) => this.mv(e), true);
    for (const ev of ['pointerup', 'pointercancel']) cv.addEventListener(ev, (e) => this.up(e), true);
  }

  build() {
    if (this.tray) return;
    const svg = document.createElementNS(NS, 'svg');
    svg.id = 'driveHud'; svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = '<circle class="dz" r="' + DEAD + '"/><line class="tether"/><path class="ticks"/><circle class="ring" r="' + FULL + '"/><circle class="dot" r="3"/><text class="lab"></text>';
    document.body.append(svg);
    this.svg = svg;
    const tray = document.createElement('footer');
    tray.id = 'driveTray'; tray.setAttribute('aria-label', 'Drive readouts');
    tray.innerHTML = KEYS.map((k) => `<span data-k="${k}"><abbr>${k}</abbr><b></b></span>`).join('') +
      '<button type="button" id="driveOff" aria-label="Leave drive mode">drive<b>on</b></button>';
    document.body.append(tray);
    this.tray = tray;
    this.f = Object.fromEntries(KEYS.map((k) => [k, tray.querySelector(`[data-k="${k}"] b`)]));
    tray.querySelector('#driveOff').addEventListener('click', () => this.set(false));
  }

  set(on) {
    this.on = !!on;
    if (on) this.build();
    document.body.classList.toggle('driving', this.on);
    document.getElementById('btnDrive')?.setAttribute('aria-pressed', String(this.on));
    if (!this.on) this.cancel();
    else this.paint(0);
    return this.on;
  }
  toggle() { return this.set(!this.on); }

  active() { return this.on && this.o.allowed(); }

  down(e) {
    if (!this.active() || (e.button && e.button !== 0)) return;
    e.stopImmediatePropagation(); // the image drag must not also start
    e.target.setPointerCapture?.(e.pointerId);
    this.pull = { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
    this.show(true);
  }
  mv(e) {
    if (!this.pull) return;
    e.stopImmediatePropagation();
    this.pull.x = e.clientX; this.pull.y = e.clientY;
  }
  up(e) {
    if (!this.pull) return;
    e.stopImmediatePropagation();
    this.cancel();
  }
  cancel() { this.pull = null; this.show(false); }
  show(on) { if (this.svg) this.svg.dataset.live = on ? '1' : ''; }

  // pull in px -> fraction of full speed (0 inside the dead zone, then a soft power curve)
  static rate(d) { return d <= DEAD ? 0 : Math.min(1.2, Math.pow((d - DEAD) / (FULL - DEAD), 1.5)); }

  // called every frame; dt in seconds
  tick(dt) {
    let tx = 0, ty = 0, d = 0, ux = 0, uy = 0;
    if (this.pull && this.active()) {
      const dx = this.pull.x - this.pull.x0, dy = this.pull.y - this.pull.y0;
      d = Math.hypot(dx, dy);
      if (d > 0) { ux = dx / d; uy = dy / d; }
      const s = Drive.rate(d) * TOP * this.o.fovA(); // Å/s
      tx = ux * s; ty = uy * s;
    }
    const k = Math.min(1, dt * (this.pull ? 9 : 4)); // quick to respond, gentle coast
    this.v[0] += (tx - this.v[0]) * k; this.v[1] += (ty - this.v[1]) * k;
    if (!this.pull && Math.hypot(this.v[0], this.v[1]) < 0.002 * this.o.fovA()) { this.v[0] = this.v[1] = 0; }
    if (this.v[0] || this.v[1]) { this.o.move(this.v[0] * dt, this.v[1] * dt); this.moved = true; }
    else if (this.moved && !this.pull) { this.moved = false; this.o.done?.(); }
    if (this.on) { this.acc += dt; if (this.acc > 0.15 || this.pull) { this.acc = 0; this.paint(dt); } }
  }

  paint(dt) {
    if (!this.tray) return;
    const r = this.o.readouts(), sp = Math.hypot(this.v[0], this.v[1]) / 10; // nm/s
    const f = this.f;
    f.mode.textContent = r.mode; f.kV.textContent = r.kV + ' kV'; f.fov.textContent = fmt(r.fov) + ' nm';
    f.defocus.textContent = (r.defocus > 0 ? '+' : '') + r.defocus.toFixed(1) + ' nm'; f.dose.textContent = Math.round(r.dose) + ' e/Å²';
    f.stage.textContent = `${(r.x / 10).toFixed(1)}, ${(r.y / 10).toFixed(1)} nm`;
    f.speed.textContent = fmt(sp) + ' nm/s'; f.frame.textContent = dt ? Math.round(dt * 1000) + ' ms' : '–';
    f.speed.parentNode.dataset.live = sp > 0.01 ? '1' : '';
    // tether
    const s = this.svg;
    if (!s) return;
    const p = this.pull;
    if (p) {
      const dx = p.x - p.x0, dy = p.y - p.y0, d = Math.hypot(dx, dy), fr = Drive.rate(d);
      const set = (el, o) => { for (const k in o) el.setAttribute(k, o[k]); };
      set(s.querySelector('.dz'), { cx: p.x0, cy: p.y0 });
      set(s.querySelector('.ring'), { cx: p.x0, cy: p.y0 });
      set(s.querySelector('.tether'), { x1: p.x0, y1: p.y0, x2: p.x, y2: p.y });
      set(s.querySelector('.dot'), { cx: p.x, cy: p.y });
      let t = '';
      if (d > 0) for (let q = 24; q < d; q += 24) { const a = [dx / d, dy / d]; t += `M${p.x0 + a[0] * q - a[1] * 4} ${p.y0 + a[1] * q + a[0] * 4}L${p.x0 + a[0] * q + a[1] * 4} ${p.y0 + a[1] * q - a[0] * 4}`; }
      s.querySelector('.ticks').setAttribute('d', t);
      const lab = s.querySelector('.lab');
      set(lab, { x: p.x + 10, y: p.y - 8 });
      lab.textContent = fr ? `${Math.round(fr * 100)} %` : 'hold';
    }
  }
}

const fmt = (v) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));
