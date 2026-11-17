// Optional VR view (WebXR): the cutaway column stands in the room at table scale, with controller or hand
// pointing at floating panels. The same simulator runs underneath; nothing here changes the physics.
//
//   left panel   mode menu
//   right panel  the live knobs of the current mode (sliders you drag with the trigger)
//   the column   point at a part and pull the trigger: its instrument-physics card opens beside it
//   menu         "Exploded" pulls the column apart along its axis; "Screens" floats the detector images, big;
//                "Size" switches tabletop / life size; "Reset" puts it back in front of you
//   screens      drag one to move it; drag its bottom-right corner to resize it
//   Training     start an alignment task (not recorded in VR), watch the timer, rate it, read the result
//   Narrate/Talk spoken explanations (also for each part's card); voice commands, with a floating caption
//   Ride beam    stand inside the column and follow the beam from the gun to the spectrometer
//   AR           the same scene over the room, in a passthrough headset session (enter('ar'))
//   grip         grab the microscope and move / turn it (both hands: scale)
//   thumbstick   left-right turns it, forward-back scales it
//
// Without a headset the same room can be previewed on screen (startPreview): mouse stands in for the controller.
import * as THREE from 'three';
import { Y } from './scene3d.js';

const TABLE = 0.11; // scene units to metres: the 10-unit column becomes about 1.2 m tall
const PX = 2.5;     // particle size boost: the headset's eye buffers are far denser than the desktop canvas
const FONT = 'system-ui, -apple-system, sans-serif';

// A floating canvas panel: draw() paints it, hit() turns a ray into pixel coordinates on it.
class Panel {
  constructor(width, pw, ph, draw) {
    this.w = width; this.h = (width * ph) / pw; this.pw = pw; this.ph = ph; this.draw = draw; this.sig = null;
    const cv = (this.cv = document.createElement('canvas')); cv.width = pw; cv.height = ph;
    this.tex = new THREE.CanvasTexture(cv); this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(this.w, this.h), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, toneMapped: false }));
    this.rc = new THREE.Raycaster();
  }
  dispose() { this.tex.dispose(); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
  place(x, y, z, rotY) { this.mesh.position.set(x, y, z); this.mesh.rotation.y = rotY; return this; }
  paint(sig) {
    if (sig !== undefined) { if (sig === this.sig) return; this.sig = sig; }
    const x = this.cv.getContext('2d'); x.clearRect(0, 0, this.pw, this.ph); this.draw(x, this.pw, this.ph); this.tex.needsUpdate = true;
  }
  // pixel position of a ray on this panel; with `loose` the ray's plane crossing counts even outside the panel
  hit(ray, loose = false) {
    const m = this.mesh; if (!m.visible) return null;
    m.updateMatrixWorld();
    let local;
    if (!loose) {
      this.rc.ray.copy(ray);
      const h = this.rc.intersectObject(m)[0];
      if (!h) return null;
      local = m.worldToLocal(h.point.clone());
    } else {
      const n = new THREE.Vector3(0, 0, 1).transformDirection(m.matrixWorld);
      const pt = ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(n, m.position), new THREE.Vector3());
      if (!pt) return null;
      local = m.worldToLocal(pt);
    }
    return { x: (local.x / this.w + 0.5) * this.pw, y: (0.5 - local.y / this.h) * this.ph };
  }
}

function wrap(x, text, maxW) {
  const out = []; let line = '';
  for (const w of String(text).split(/\s+/)) {
    const t = line ? line + ' ' + w : w;
    if (x.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t;
  }
  if (line) out.push(line);
  return out;
}
const rr = (x, a, b, w, h, r) => { x.beginPath(); x.roundRect(a, b, w, h, r); };

export class VR {
  constructor(sc, { modes, getMode, setMode, onChange, sliders, component, getS, screens, data, acquire, clarity, training, narr, talk, listening, caption }) {
    this.sc = sc; this.modes = modes; this.getMode = getMode; this.setMode = setMode; this.onChange = onChange || (() => {});
    this.sliders = sliders || (() => []); this.component = component || (() => null); this.getS = getS || (() => ({}));
    this.screensFn = screens || (() => []);
    this.dataFn = data || (() => ({ lines: [], n: 0, last: null })); this.acquireFn = acquire || (() => {});
    this.clarity = clarity || { real: () => false, toggle: () => {} };
    this.opt = {
      training: training || { list: () => [], start() {}, state: () => ({ active: false }), finish: () => ({ head: '', body: '' }) },
      narr: narr || { on: () => false, toggle() {}, speak() {}, toggleId() {}, stop() {}, playing: () => null },
      talk: talk || (() => false), listening: listening || (() => false), caption: caption || (() => null),
    };
    this.tr = { view: 'list', res: null, btns: [] };
    this.ride = { on: false, y: 5.6, v: 0.6, paused: false, name: '', btns: [] };
    this.ex = { t: 0, on: false, slots: null }; // exploded view: 0 assembled .. 1 pulled apart
    this.scr = { on: false, list: [] };
    this.active = false;
    this.session = null;
    this.hover = -1;
    this.grabs = new Map(); // controller -> { offset: Matrix4 }
    this.pinch = null;      // two-hand baseline
    this.sl = { page: 0, list: [], drag: null, tracks: [], hover: -1 };
    this.card = { name: null, page: 0, html: '' };
    this.acc = 0;
  }

  static async supported() {
    try { return !!(navigator.xr && (await navigator.xr.isSessionSupported('immersive-vr'))); } catch { return false; }
  }

  static async supportedAR() {
    try { return !!(navigator.xr && (await navigator.xr.isSessionSupported('immersive-ar'))); } catch { return false; }
  }

  async enter(kind = 'vr') {
    if (this.active) return;
    const R = this.sc.renderer;
    const session = await navigator.xr.requestSession(kind === 'ar' ? 'immersive-ar' : 'immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
    try {
      R.xr.enabled = true;
      R.xr.setReferenceSpaceType('local-floor');
      session.addEventListener('end', () => this.leave());
      await R.xr.setSession(session);
    } catch (e) { R.xr.enabled = false; try { await session.end(); } catch { /* already ended */ } throw e; }
    this.ar = kind === 'ar';
    this.session = session;
    this.rig(true);
    R.setAnimationLoop(this.loop);
    this.onChange(true);
  }

  // Desktop preview for people without a headset: the same tabletop room and floating panels, looked at
  // through the normal camera. Drag to orbit, scroll to zoom, click and drag on the panels, click the parts.
  startPreview() {
    if (this.active) return;
    const sc = this.sc, C = sc.controls, cv = sc.canvas;
    this.ar = false;
    this.preview = true;
    this.rig(true);
    this.saved = { min: C.minDistance, max: C.maxDistance, fov: sc.camera.fov, auto: C.autoRotate };
    C.enabled = true; C.minDistance = 0.25; C.maxDistance = 6; C.maxPolarAngle = Math.PI * 0.52;
    C.target.set(0.1, 1.1, -1.0);
    sc.camera.position.set(0.9, 1.5, 1.4);
    sc.camera.fov = 52; sc.camera.updateProjectionMatrix();
    sc.fullFrame = true; sc.resize(sc.W, sc.H, null);
    // the on-screen view runs through the bloom pass (a headset does not), which would smear bright panel text
    for (const m of [this.menu, this.slP.mesh, this.cardP.mesh]) m.material.color.setScalar(0.62);
    this.ptr = new THREE.Vector2();
    const rayOf = (e) => {
      const r = cv.getBoundingClientRect();
      this.ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      const rc = (this._pc ??= new THREE.Raycaster()); rc.setFromCamera(this.ptr, sc.camera);
      return rc.ray.clone();
    };
    let down = null;
    this.onDown = (e) => {
      down = [e.clientX, e.clientY];
      if (this.rayDown(rayOf(e), 'mouse')) { e.stopImmediatePropagation(); down = null; } // a panel took it: do not orbit
    };
    this.onMove = (e) => {
      const ray = rayOf(e);
      if (this.sl.drag || this.sd) { this.rayMove(ray, 'mouse'); return; }
      this.pvHit = this.hitRay(ray).idx;
      cv.style.cursor = this.pvHit >= 0 || this.overPanel(ray) || (this.scr.on && this.screenHit(ray)) ? 'pointer' : '';
    };
    this.onUp = (e) => {
      this.rayUp('mouse');
      if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) <= 5) this.rayClick(rayOf(e)); // a click, not an orbit drag
      down = null;
    };
    this.onKey = (e) => { if (e.key === 'Escape') this.exit(); };
    cv.addEventListener('pointerdown', this.onDown, true); cv.addEventListener('pointermove', this.onMove); cv.addEventListener('pointerup', this.onUp);
    window.addEventListener('keydown', this.onKey);
    this.onChange(true);
  }

  async exit() { try { await this.session?.end(); } catch { /* already ended */ } if (this.active) this.leave(); }

  leave() {
    if (!this.active) return;
    const R = this.sc.renderer, sc = this.sc;
    R.setAnimationLoop(null);
    this.rig(false);
    if (this.preview) {
      const cv = sc.canvas;
      cv.removeEventListener('pointerdown', this.onDown, true); cv.removeEventListener('pointermove', this.onMove); cv.removeEventListener('pointerup', this.onUp);
      window.removeEventListener('keydown', this.onKey);
      cv.style.cursor = '';
      Object.assign(sc.controls, { minDistance: this.saved.min, maxDistance: this.saved.max, maxPolarAngle: Math.PI });
      sc.camera.fov = this.saved.fov; sc.camera.updateProjectionMatrix();
      sc.resetView();
      this.preview = false; sc.fullFrame = false;
    }
    R.xr.enabled = false;
    this.session = null;
    this.onChange(false);
  }

  // Put the whole scene on a movable, scaled "world" group (and take it back off again).
  // Public so it can be exercised without a headset.
  rig(on) {
    const sc = this.sc, scene = sc.scene;
    if (on === this.active) return;
    this.active = on;
    sc.labelLayer.style.visibility = on ? 'hidden' : '';
    sc.controls.enabled = !on;
    if (on) {
      const world = (this.world = new THREE.Group());
      for (const c of [...scene.children]) world.add(c);
      scene.add(world);
      world.scale.setScalar(TABLE);
      world.position.set(0, 1.25 - 0.8 * TABLE, -1.05);
      // the beam light is a point light with inverse-square falloff: keep it equally bright at the smaller scale
      this.beamI = sc.beamLight.intensity; this.beamD = sc.beamLight.distance;
      this.setScale(TABLE);
      this.life = false;
      this.buildRoom();
      this.buildMenu();
      this.buildPanels();
      this.buildControllers();
      this.setScreens(true); // the detector images are the data: show them from the start
      if (this.ar) { // passthrough: let the room show through
        this.bg = scene.background; scene.background = null; sc.renderer.setClearAlpha(0);
        this.room.visible = false;
      }
    } else {
      if (this.bg !== undefined && this.ar) { scene.background = this.bg; sc.renderer.setClearAlpha(1); this.bg = undefined; }
      this.ar = false;
      this.closeCard(); this.stopRide(); this.stopSpoken(); if (this.opt.listening()) this.opt.talk(false);
      this.ex.on = false; this.ex.t = 0; this.applyExplode(); this.unwrapSlots(); // parts back in place, beams back on
      for (const P of [this.slP, this.cardP, this.trainP, this.rideP, this.capP, this.dataP]) P?.dispose();
      if (this.menu) { this.mtex.dispose(); this.menu.geometry.dispose(); this.menu.material.dispose(); }
      for (const g of [this.room, this.menu, this.slP?.mesh, this.cardP?.mesh, this.trainP?.mesh, this.rideP?.mesh, this.capP?.mesh, this.dataP?.mesh, ...(this.ctrl || [])]) g && scene.remove(g);
      for (const c of [...this.world.children]) scene.add(c);
      scene.remove(this.world);
      this.world = null;
      sc.beamLight.intensity = this.beamI; sc.beamLight.distance = this.beamD;
      this.pointMats().forEach((m) => { m.uniforms.uWS.value = 1; });
      this.grabs.clear(); this.pinch = null; this.sl.drag = null; this.sd = null;
      this.setScreens(false);
    }
  }

  pointMats() {
    const out = [];
    this.world?.traverse((o) => { if (o.isPoints && o.material.uniforms?.uWS) out.push(o.material); });
    return out;
  }

  setScale(s) {
    this.world.scale.setScalar(s);
    this.sc.beamLight.intensity = this.beamI * s * s;
    this.sc.beamLight.distance = this.beamD * s;
    this.pointMats().forEach((m) => { m.uniforms.uWS.value = s * PX; });
  }

  // tabletop (about 1.2 m tall) or life size (about 3 m; stand beside it), always back in front of you, upright
  setLife(on) {
    this.stopRide();
    this.life = on;
    const s = on ? 0.3 : TABLE;
    this.world.rotation.set(0, 0, 0);
    this.setScale(s);
    this.world.position.set(0, on ? 4.5 * s : 1.25 - 0.8 * TABLE, on ? -2.4 : -1.05);
    this.placeScreens();
  }

  buildRoom() {
    const g = new THREE.Group();
    const grid = new THREE.GridHelper(8, 32, 0x2a4a5a, 0x16232b);
    grid.material.transparent = true; grid.material.opacity = 0.55;
    g.add(grid);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.44, 64), new THREE.MeshBasicMaterial({ color: 0x6fd6ff, side: THREE.DoubleSide, transparent: true, opacity: 0.5 }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(0, 0.005, -1.05);
    g.add(ring);
    this.room = g;
    this.sc.scene.add(g);
  }

  // ---- floating mode menu (left)
  buildMenu() {
    const cols = 3, rows = Math.ceil((this.modes.length + 12) / cols); // modes, then the twelve tool buttons ending in Exit
    this.mcols = cols; this.mrows = rows;
    const W = 768, H = rows * 128 + 96;
    const cv = (this.mcv = document.createElement('canvas')); cv.width = W; cv.height = H;
    this.mtex = new THREE.CanvasTexture(cv); this.mtex.colorSpace = THREE.SRGBColorSpace;
    const w = 0.56, h = (w * H) / W;
    this.menu = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: this.mtex, transparent: true, toneMapped: false }));
    this.menu.position.set(-0.78, 1.15, -0.62);
    this.menu.rotation.y = 0.62;
    this.sc.scene.add(this.menu);
    this.paintMenu();
  }

  paintMenu() {
    const cv = this.mcv, x = cv.getContext('2d'), W = cv.width, H = cv.height, cur = this.getMode();
    x.clearRect(0, 0, W, H);
    x.fillStyle = 'rgba(10,14,19,0.92)'; rr(x, 0, 0, W, H, 36); x.fill();
    x.strokeStyle = 'rgba(111,214,255,0.35)'; x.lineWidth = 3; x.stroke();
    x.fillStyle = '#6fd6ff'; x.font = `600 34px ${FONT}`; x.textAlign = 'left';
    x.fillText('TEM-view · choose a mode', 36, 62);
    const cw = (W - 72) / this.mcols, top = 96;
    const items = [...this.modes.map((m) => ({ id: m[0], label: m[1], sub: m[2] })), { id: '__explode', label: 'Exploded', sub: 'pull it apart' }, { id: '__screens', label: 'Screens', sub: 'big detectors' }, { id: '__size', label: 'Size', sub: 'table / life size' }, { id: '__reset', label: 'Reset', sub: 'in front of me' }, { id: '__real', label: 'Realistic', sub: 'noise, real detectors' }, { id: '__acq', label: 'Acquire', sub: 'record the data' }, { id: '__data', label: 'Data', sub: 'live + last shot' }, { id: '__train', label: 'Training', sub: 'align a task' }, { id: '__narr', label: 'Narrate', sub: 'hear explanations' }, { id: '__talk', label: 'Talk', sub: 'voice commands' }, { id: '__ride', label: 'Ride beam', sub: 'follow the electrons' }, { id: '__exit', label: this.ar ? 'Exit AR' : 'Exit VR', sub: '' }];
    items.forEach((it, i) => {
      const exit = it.id === '__exit';
      const c = i % this.mcols, r = Math.floor(i / this.mcols);
      const bx = 36 + c * cw + 6, by = top + r * 128 + 6, bw = cw - 12, bh = 116;
      const on = it.id === cur || (it.id === '__explode' && this.ex.on) || (it.id === '__screens' && this.scr.on) || (it.id === '__data' && this.dataP?.mesh.visible) || (it.id === '__real' && this.clarity.real()) || (it.id === '__size' && this.life) || (it.id === '__train' && this.trainP?.mesh.visible) || (it.id === '__narr' && this.opt.narr.on()) || (it.id === '__talk' && this.opt.listening()) || (it.id === '__ride' && this.ride.on), hov = this.hover === i;
      x.fillStyle = on ? 'rgba(111,214,255,0.22)' : hov ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)';
      rr(x, bx, by, bw, bh, 20); x.fill();
      if (on || hov) { x.strokeStyle = on ? '#6fd6ff' : 'rgba(255,255,255,0.5)'; x.lineWidth = 3; x.stroke(); }
      x.fillStyle = exit ? '#ff9b8a' : '#e8edf2'; x.textAlign = 'center';
      x.font = `600 34px ${FONT}`; x.fillText(it.label, bx + bw / 2, by + (it.sub ? 52 : 70));
      if (it.sub) { x.fillStyle = '#8b97a4'; x.font = `22px ${FONT}`; x.fillText(it.sub.length > 22 ? it.sub.slice(0, 21) + '…' : it.sub, bx + bw / 2, by + 88); }
    });
    this.mtex.needsUpdate = true;
    this.items = items; this.drawn = this.menuDrawn = this.menuSig();
  }

  // everything that changes how the menu looks, as one string (repaint when it changes)
  menuSig() {
    return [this.getMode(), this.hover, this.ex.on, this.scr.on, this.clarity.real(), this.dataP?.mesh.visible, this.life, this.trainP?.mesh.visible, this.opt.narr.on(), this.opt.listening(), this.ride.on].join('|');
  }

  menuHit(ctrl) { return this.hitRay(this.ctrlRay(ctrl)); }

  hitRay(ray) {
    const rc = (this._rc2 ??= new THREE.Raycaster());
    rc.ray.copy(ray);
    this.menu.updateMatrixWorld();
    const hit = rc.intersectObject(this.menu)[0];
    if (!hit) return { idx: -1 };
    const u = hit.uv.x, v = 1 - hit.uv.y, W = this.mcv.width, H = this.mcv.height;
    const px = u * W, py = v * H, top = 96, cw = (W - 72) / this.mcols;
    const r = Math.floor((py - top) / 128);
    if (r < 0 || r >= this.mrows) return { idx: -1, dist: hit.distance };
    const c = Math.floor((px - 36) / cw), idx = c < 0 || c >= this.mcols ? -1 : r * this.mcols + c;
    return { idx: idx >= this.items.length ? -1 : idx, dist: hit.distance };
  }

  ctrlRay(c) {
    c.updateMatrixWorld();
    const m = new THREE.Matrix4().extractRotation(c.matrixWorld);
    return new THREE.Ray(new THREE.Vector3().setFromMatrixPosition(c.matrixWorld), new THREE.Vector3(0, 0, -1).applyMatrix4(m));
  }

  // ---- knobs panel (right) and component card
  buildPanels() {
    const ROW = 120, N = 6, HEAD = 96, FOOT = 92, PW = 768, PH = HEAD + N * ROW + FOOT;
    this.sl = { page: 0, list: [], drag: null, tracks: [], hover: -1 };
    this.slP = new Panel(0.56, PW, PH, (x, W, H) => {
      const L = this.sl;
      x.fillStyle = 'rgba(10,14,19,0.92)'; rr(x, 0, 0, W, H, 36); x.fill();
      x.strokeStyle = 'rgba(111,214,255,0.35)'; x.lineWidth = 3; x.stroke();
      x.fillStyle = '#6fd6ff'; x.font = `600 34px ${FONT}`; x.textAlign = 'left';
      const name = (this.modes.find((m) => m[0] === this.getMode()) || [0, ''])[1];
      x.fillText(`Controls · ${name}`, 36, 62);
      const pages = Math.max(1, Math.ceil(L.list.length / N));
      L.page = Math.min(L.page, pages - 1);
      L.tracks = [];
      L.list.slice(L.page * N, L.page * N + N).forEach((s, i) => {
        const y = HEAD + i * ROW, tx0 = 48, tx1 = W - 48, ty = y + 80, dragging = L.drag?.s === s;
        x.textAlign = 'left'; x.fillStyle = '#e8edf2'; x.font = `600 28px ${FONT}`;
        let lab = s.label; while (x.measureText(lab).width > 420 && lab.length > 4) lab = lab.slice(0, -2);
        x.fillText(lab === s.label ? lab : lab + '…', 36, y + 44);
        x.textAlign = 'right'; x.fillStyle = dragging ? '#ffffff' : '#6fd6ff'; x.font = `600 28px ${FONT}`;
        x.fillText(s.val, W - 36, y + 44);
        x.fillStyle = 'rgba(255,255,255,0.14)'; rr(x, tx0, ty - 6, tx1 - tx0, 12, 6); x.fill();
        const kx = tx0 + s.frac * (tx1 - tx0);
        x.fillStyle = 'rgba(111,214,255,0.55)'; rr(x, tx0, ty - 6, Math.max(12, kx - tx0), 12, 6); x.fill();
        x.fillStyle = dragging ? '#ffffff' : '#bfeaff'; x.beginPath(); x.arc(kx, ty, dragging ? 22 : 18, 0, 7); x.fill();
        L.tracks.push({ s, y0: y + 4, y1: y + ROW - 6, tx0, tx1 });
      });
      if (!L.list.length) { x.textAlign = 'center'; x.fillStyle = '#8b97a4'; x.font = `26px ${FONT}`; x.fillText('This mode has no sliders.', W / 2, HEAD + 100); }
      const fy = H - FOOT + 14, bw = 200;
      L.btn = { prev: [36, fy, bw, 64], next: [W - 36 - bw, fy, bw, 64] };
      x.textAlign = 'center'; x.font = `600 28px ${FONT}`;
      for (const [k, t] of [['prev', '◀ Prev'], ['next', 'Next ▶']]) {
        const b = L.btn[k]; x.fillStyle = 'rgba(255,255,255,0.08)'; rr(x, ...b, 18); x.fill();
        x.fillStyle = pages > 1 ? '#e8edf2' : '#566170'; x.fillText(t, b[0] + b[2] / 2, b[1] + 43);
      }
      x.fillStyle = '#8b97a4'; x.font = `24px ${FONT}`; x.fillText(`${L.page + 1} / ${pages}`, W / 2, fy + 42);
    }).place(0.8, 1.02, -0.5, -0.62);

    const CW = 1024, CH = 1320;
    this.cardP = new Panel(0.78, CW, CH, (x, W, H) => this.paintCard(x, W, H)).place(1.55, 1.38, -1.05, -1.05);
    this.cardP.mesh.visible = false;
    this.trainP = new Panel(0.62, 800, 1000, (x, W, H) => this.paintTrain(x, W, H)).place(-1.45, 1.35, -0.5, 1.15);
    this.trainP.mesh.visible = false;
    this.rideP = new Panel(0.46, 640, 440, (x, W, H) => this.paintRide(x, W, H)).place(-0.38, 1.02, -0.5, 0.4);
    this.rideP.mesh.visible = false;
    this.capP = new Panel(0.7, 1024, 220, (x, W, H) => this.paintCaption(x, W, H)).place(0, 0.78, -0.7, 0);
    this.capP.mesh.visible = false;
    this.dataP = new Panel(0.62, 960, 640, (x, W, H) => this.paintData(x, W, H)).place(0, 0.9, -0.55, 0);
    this.dataP.mesh.visible = false;
    this.sc.scene.add(this.slP.mesh, this.cardP.mesh, this.trainP.mesh, this.rideP.mesh, this.capP.mesh, this.dataP.mesh);
    this.refreshSliders(); this.slP.paint();
  }

  refreshSliders() {
    const L = this.sl;
    L.list = this.sliders();
    // a drag keeps its slider object even if the list is rebuilt
    if (L.drag) { const k = L.list.find((s) => s.key === L.drag.s.key); if (k) L.drag.s = k; }
    return L.list.map((s) => s.label + s.val + s.frac.toFixed(3)).join('|') + '|' + L.page + '|' + (L.drag ? L.drag.s.key : '') + '|' + this.getMode();
  }

  // ---- the card for a touched component
  openCard(name, hitLocal) {
    const html = this.component(name);
    if (!html) return false;
    this.card = { name, page: 0, html };
    this.cardP.mesh.visible = true; this.cardP.sig = null; this.cardP.paint();
    if (this.opt.narr.on()) this.say(name);
    if (!this.mark) {
      this.mark = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), new THREE.MeshBasicMaterial({ color: 0x6fd6ff, transparent: true, opacity: 0.8, depthTest: false }));
      this.mark.renderOrder = 10;
    }
    this.sc.column.add(this.mark);
    this.mark.position.copy(hitLocal);
    return true;
  }
  // narration VR started (so leaving does not cut off something the visitor was already listening to)
  say(id) { this.spoke = id; this.opt.narr.speak(id); }
  stopSpoken() { if (this.spoke && this.opt.narr.playing() === this.spoke) this.opt.narr.stop(); this.spoke = null; }
  closeCard() {
    if (this.card.name && this.opt.narr.playing() === this.card.name) this.opt.narr.stop();
    this.card.name = null;
    if (this.cardP) this.cardP.mesh.visible = false;
    this.mark?.parent?.remove(this.mark);
  }

  paintCard(x, W, H) {
    const C = this.card; if (!C.name) return;
    x.fillStyle = 'rgba(10,14,19,0.94)'; rr(x, 0, 0, W, H, 40); x.fill();
    x.strokeStyle = 'rgba(111,214,255,0.4)'; x.lineWidth = 3; x.stroke();
    const doc = new DOMParser().parseFromString(C.html, 'text/html');
    const kicker = doc.querySelector('.eyebrow')?.textContent || '', title = doc.querySelector('h3')?.textContent || C.name;
    const blocks = [];
    let sec = null;
    for (const el of doc.body.children) {
      if (el.tagName === 'H4') { sec = el.textContent; blocks.push({ t: 'h', text: sec, p: ['How it works', 'Right now'].includes(sec) ? 0 : 1 }); }
      else if (el.classList.contains('role')) blocks.push({ t: 'role', text: el.textContent, p: 0 });
      else if (el.tagName === 'P' && !el.classList.contains('eyebrow')) blocks.push({ t: 'p', text: el.textContent, p: ['How it works', 'Right now'].includes(sec) ? 0 : 1 });
      else if (el.tagName === 'TABLE') blocks.push({ t: 'kv', rows: [...el.querySelectorAll('tr')].map((r) => [...r.children].map((c) => c.textContent)), p: sec === 'Right now' ? 0 : 1 });
    }
    x.textAlign = 'left'; x.fillStyle = '#8b97a4'; x.font = `600 24px ${FONT}`; x.fillText(kicker.toUpperCase(), 48, 70);
    x.fillStyle = '#ffffff'; x.font = `600 46px ${FONT}`; x.fillText(title, 48, 124);
    x.fillStyle = this.opt.narr.playing() === C.name ? 'rgba(111,214,255,0.3)' : 'rgba(255,255,255,0.1)'; rr(x, W - 300, 36, 164, 72, 20); x.fill();
    x.fillStyle = '#bfeaff'; x.font = `600 28px ${FONT}`; x.textAlign = 'center'; x.fillText(this.opt.narr.playing() === C.name ? '■ Stop' : '▶ Listen', W - 218, 84);
    x.fillStyle = 'rgba(255,255,255,0.1)'; rr(x, W - 120, 36, 72, 72, 20); x.fill();
    x.fillStyle = '#e8edf2'; x.font = `600 44px ${FONT}`; x.textAlign = 'center'; x.fillText('×', W - 84, 88);
    let y = 176; const maxY = H - 150, lh = 38;
    x.textAlign = 'left';
    for (const b of blocks.filter((b) => b.p === C.page)) {
      if (b.t === 'h') { y += 14; x.fillStyle = '#6fd6ff'; x.font = `600 28px ${FONT}`; x.fillText(b.text, 48, y); y += 40; continue; }
      if (b.t === 'kv') {
        x.font = `26px ${FONT}`;
        for (const [k, v] of b.rows) { if (y > maxY) break; x.fillStyle = '#8b97a4'; x.fillText(k, 48, y); x.fillStyle = '#e8edf2'; x.textAlign = 'right'; x.fillText(v, W - 48, y); x.textAlign = 'left'; y += 38; }
        continue;
      }
      x.fillStyle = b.t === 'role' ? '#ffffff' : '#c3cad3'; x.font = `${b.t === 'role' ? '600 ' : ''}27px ${FONT}`;
      for (const ln of wrap(x, b.text, W - 96)) { if (y > maxY) { x.fillStyle = '#8b97a4'; x.fillText('…', 48, y); y = H; break; } x.fillText(ln, 48, y); y += lh; }
      y += 8;
    }
    const by = H - 108;
    C.btn = [48, by, W - 96, 72];
    x.fillStyle = 'rgba(111,214,255,0.14)'; rr(x, ...C.btn, 20); x.fill();
    x.fillStyle = '#bfeaff'; x.textAlign = 'center'; x.font = `600 28px ${FONT}`;
    x.fillText(C.page === 0 ? 'Specs, calibration and limits ▶' : '◀ How it works and live values', W / 2, by + 47);
  }

  // Which part of the column did the ray touch? Raycast the solid meshes, then take the nearest label that is
  // present in the current mode (the labels already say where each component sits).
  pickComponent(ray) {
    const sc = this.sc, meshes = [];
    // Raycaster ignores visibility, and a hidden parent (corrector off, no dewar...) leaves its meshes flagged visible
    const shown = (o) => { for (; o && o !== sc.column.parent; o = o.parent) if (!o.visible) return false; return true; };
    sc.column.traverse((o) => { if (o.isMesh && !o.material.transparent && o.material.type !== 'ShaderMaterial' && shown(o)) meshes.push(o); });
    const rc = (this._rc3 ??= new THREE.Raycaster());
    rc.ray.copy(ray);
    this.world.updateMatrixWorld(true);
    const hit = rc.intersectObjects(meshes, false)[0];
    if (!hit) return false;
    const p = sc.column.worldToLocal(hit.point.clone()), S = this.getS();
    let slot = hit.object; while (slot && slot.parent !== sc.column) slot = slot.parent;
    p.y -= slot?.userData.dy || 0; // the labels know where parts sit when assembled
    let best = null, bs = 1e9;
    for (const L of sc.labels) {
      if (!L.text || !sc.labelOn(L, S) || !this.component(L.text)) continue;
      const sco = Math.abs(p.y - L.pos.y) + 0.35 * Math.hypot(p.x - L.pos.x, p.z - L.pos.z);
      if (sco < bs) { bs = sco; best = L; }
    }
    if (!best || bs > 1.3) return false;
    if (this.card.name === best.text) { this.closeCard(); return true; }
    return this.openCard(best.text, p);
  }

  // ---- input: one path for controllers (trigger) and the mouse in the on-screen preview
  overPanel(ray) {
    return !!(this.slP?.hit(ray) || this.trainP?.hit(ray) || this.rideP?.hit(ray) || (this.cardP?.mesh.visible && this.cardP.hit(ray)));
  }

  // press: true when a panel or the menu took it
  rayDown(ray, id) {
    const h = this.hitRay(ray);
    if (h.idx >= 0) { this.pick(h.idx); return true; }
    const sp = this.slP.hit(ray);
    if (sp) {
      const L = this.sl, inb = (b) => sp.x >= b[0] && sp.x <= b[0] + b[2] && sp.y >= b[1] && sp.y <= b[1] + b[3];
      if (L.btn && inb(L.btn.prev)) { L.page = Math.max(0, L.page - 1); this.slP.sig = null; return true; }
      if (L.btn && inb(L.btn.next)) { L.page += 1; this.slP.sig = null; return true; }
      const t = L.tracks.find((t) => sp.y >= t.y0 && sp.y <= t.y1);
      if (t) { L.drag = { id, s: t.s, t }; this.rayMove(ray, id); return true; }
      return true;
    }
    if (this.cardP.mesh.visible) {
      const cp = this.cardP.hit(ray);
      if (cp) {
        const b = this.card.btn;
        if (cp.x > this.cardP.pw - 130 && cp.y < 120) this.closeCard();
        else if (cp.x > this.cardP.pw - 300 && cp.x < this.cardP.pw - 136 && cp.y < 120) { this.opt.narr.toggleId(this.card.name); this.cardP.sig = null; this.cardP.paint(); }
        else if (b && cp.x >= b[0] && cp.x <= b[0] + b[2] && cp.y >= b[1] && cp.y <= b[1] + b[3]) { this.card.page ^= 1; this.cardP.sig = null; this.cardP.paint(); }
        return true;
      }
    }
    for (const [P, list] of [[this.trainP, this.tr.btns], [this.rideP, this.ride.btns]]) {
      const hp = P.hit(ray);
      if (hp) { const b = list.find((b) => hp.x >= b.x && hp.x <= b.x + b.w && hp.y >= b.y && hp.y <= b.y + b.h); b?.act(); P.sig = null; return true; }
    }
    const sh = this.scr.on ? this.screenHit(ray) : null;
    if (sh) { // a screen: drag to move it, drag the corner to resize it
      const corner = sh.uv.x > 0.8 && sh.uv.y < 0.2;
      this.sd = { id, s: sh.s, mode: corner ? 'size' : 'move', off: sh.s.mesh.position.clone().sub(sh.point) };
      return true;
    }
    return false;
  }
  rayMove(ray, id) {
    const sd = this.sd;
    if (sd && sd.id === id) {
      const m = sd.s.mesh; m.updateMatrixWorld();
      const n = new THREE.Vector3(0, 0, 1).transformDirection(m.matrixWorld);
      const pt = ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(n, m.position), new THREE.Vector3());
      if (!pt) return;
      if (sd.mode === 'move') m.position.copy(pt.add(sd.off));
      else sd.s.w = THREE.MathUtils.clamp((sd.s.w * m.worldToLocal(pt).x) / 0.5, 0.3, 2.6);
      this.fitScreen(sd.s);
      return;
    }
    const d = this.sl.drag; if (!d || d.id !== id) return;
    const h = this.slP.hit(ray, true); if (!h) return;
    d.s.set(Math.max(0, Math.min(1, (h.x - d.t.tx0) / (d.t.tx1 - d.t.tx0))));
    this.acc = 1; // repaint right away
  }
  rayUp(id) { if (this.sl.drag?.id === id) { this.sl.drag = null; this.acc = 1; } if (this.sd?.id === id) this.sd = null; }
  rayClick(ray) { this.pickComponent(ray); }

  pick(idx) {
    const it = this.items[idx];
    if (it.id === '__exit') this.exit();
    else if (it.id === '__explode') { this.ex.on = !this.ex.on; this.paintMenu(); }
    else if (it.id === '__screens') { this.setScreens(!this.scr.on); this.paintMenu(); }
    else if (it.id === '__size') { this.setLife(!this.life); this.paintMenu(); }
    else if (it.id === '__reset') { this.stopRide(); this.ex.on = false; this.setLife(this.life); this.toMe(); this.paintMenu(); }
    else if (it.id === '__real') { this.clarity.toggle(); this.paintMenu(); }
    else if (it.id === '__acq') { this.acquireFn(); this.dataP.mesh.visible = true; this.dataP.sig = null; this.toMeData(); this.paintMenu(); }
    else if (it.id === '__data') { const m = this.dataP.mesh; m.visible = !m.visible; if (m.visible) this.toMeData(); this.dataP.sig = null; this.paintMenu(); }
    else if (it.id === '__train') { const m = this.trainP.mesh; m.visible = !m.visible; this.tr.view = this.opt.training.state().active ? 'run' : this.tr.view; this.trainP.sig = null; this.paintMenu(); }
    else if (it.id === '__narr') { this.opt.narr.toggle(); this.paintMenu(); }
    else if (it.id === '__talk') { this.opt.talk(!this.opt.listening()); this.paintMenu(); }
    else if (it.id === '__ride') { this.ride.on ? this.stopRide() : this.startRide(); this.paintMenu(); }
    else { this.setMode(it.id); this.paintMenu(); this.sl.page = 0; this.acc = 1; }
  }

  // ---- controllers (also covers hand tracking: three exposes a pinch as select, and the hand's pose as the ray)
  buildControllers() {
    const R = this.sc.renderer, scene = this.sc.scene;
    this.ctrl = [0, 1].map((i) => {
      const c = R.xr.getController(i);
      const ray = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]), new THREE.LineBasicMaterial({ color: 0x6fd6ff, transparent: true, opacity: 0.7 }));
      ray.scale.z = 1.2; c.add(ray); c.userData.ray = ray;
      c.add(new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff })));
      c.addEventListener('selectstart', () => this.onSelect(c));
      c.addEventListener('selectend', () => this.rayUp(c));
      c.addEventListener('squeezestart', () => this.grabStart(c));
      c.addEventListener('squeezeend', () => this.grabEnd(c));
      scene.add(c);
      return c;
    });
  }

  onSelect(c) {
    const ray = this.ctrlRay(c);
    if (!this.rayDown(ray, c)) this.rayClick(ray);
  }

  // ---- grabbing the microscope
  grabStart(c) {
    if (this.ride.on) return;
    c.updateMatrixWorld();
    this.grabs.set(c, { offset: c.matrixWorld.clone().invert().multiply(this.world.matrix) });
    this.rebase();
  }
  grabEnd(c) { this.grabs.delete(c); this.rebase(); }
  rebase() {
    const g = [...this.grabs.keys()];
    if (g.length === 1) { this.grabs.get(g[0]).offset = g[0].matrixWorld.clone().invert().multiply(this.world.matrix); this.pinch = null; }
    else if (g.length === 2) {
      const a = new THREE.Vector3().setFromMatrixPosition(g[0].matrixWorld), b = new THREE.Vector3().setFromMatrixPosition(g[1].matrixWorld);
      this.pinch = { d: a.distanceTo(b), ang: Math.atan2(b.x - a.x, b.z - a.z), s: this.world.scale.x, rotY: this.world.rotation.y, mid: a.clone().add(b).multiplyScalar(0.5), pos: this.world.position.clone() };
    } else this.pinch = null;
  }

  // ---- per-frame
  loop = (t) => { this.frameFn?.(t); };
  attach(frameFn) { this.frameFn = frameFn; }

  // knob panel, open card and the touched-part marker keep up with the simulator
  panels(dt) {
    this.acc += dt;
    if (this.acc > 0.2) {
      this.acc = 0;
      this.slP.paint(this.refreshSliders());
      const C = this.card;
      if (C.name) { const h = this.component(C.name); if (h !== C.html) C.html = h; this.cardP.paint(C.page + '|' + this.opt.narr.playing() + '|' + C.html); }
    }
    if (this.mark?.parent) this.mark.scale.setScalar(1 + 0.25 * Math.sin(this.sc.time * 6));
    this.animateExplode(dt);
    this.updateScreens(dt);
    this.updateRide(dt);
    this.t2 = (this.t2 || 0) + dt;
    if (this.t2 > 0.3) {
      this.t2 = 0;
      const st = this.opt.training.state();
      if (this.trainP.mesh.visible) this.trainP.paint([this.tr.view, st.active, st.secs, this.tr.res?.head].join('|'));
      const cap = this.opt.caption();
      this.capP.mesh.visible = !!cap;
      if (cap) { this.capText = cap; this.capP.paint(cap); }
      if (this.dataP.mesh.visible) this.dataP.paint(); // live: redraw with the detector
      if (this.menuSig() !== this.menuDrawn) { this.paintMenu(); }
    }
  }

  // ---- training panel
  trainStart(id) { this.opt.training.start(id); this.tr.view = 'run'; }
  paintTrain(x, W, H) {
    const T = this.tr, tr = this.opt.training, st = tr.state();
    T.btns = [];
    x.fillStyle = 'rgba(10,14,19,0.94)'; rr(x, 0, 0, W, H, 36); x.fill();
    x.strokeStyle = 'rgba(111,214,255,0.35)'; x.lineWidth = 3; x.stroke();
    x.fillStyle = '#6fd6ff'; x.font = `600 34px ${FONT}`; x.textAlign = 'left'; x.fillText('Training · align the microscope', 36, 62);
    const btn = (bx, by, bw, bh, label, act, strong) => {
      x.fillStyle = strong ? 'rgba(111,214,255,0.22)' : 'rgba(255,255,255,0.08)'; rr(x, bx, by, bw, bh, 20); x.fill();
      x.fillStyle = '#e8edf2'; x.textAlign = 'center'; x.font = `600 28px ${FONT}`; x.fillText(label, bx + bw / 2, by + bh / 2 + 10); T.btns.push({ x: bx, y: by, w: bw, h: bh, act });
    };
    if (st.active && T.view === 'list') T.view = 'run';
    if (!st.active && T.view === 'run') T.view = 'list';
    if (T.view === 'list') {
      tr.list().slice(0, 6).forEach((t, i) => {
        const y = 96 + i * 138;
        x.fillStyle = 'rgba(255,255,255,0.06)'; rr(x, 30, y, W - 60, 126, 18); x.fill();
        x.textAlign = 'left'; x.fillStyle = '#e8edf2'; x.font = `600 28px ${FONT}`; x.fillText(t.title, 48, y + 40);
        x.fillStyle = '#8b97a4'; x.font = `22px ${FONT}`;
        wrap(x, t.short, W - 100).slice(0, 3).forEach((l, j) => x.fillText(l, 48, y + 72 + j * 26));
        T.btns.push({ x: 30, y, w: W - 60, h: 126, act: () => this.trainStart(t.id) });
      });
      x.textAlign = 'center'; x.fillStyle = '#8b97a4'; x.font = `22px ${FONT}`; x.fillText('Each task hides a misalignment. Use the controls panel. Not recorded in VR.', W / 2, H - 28);
    } else if (T.view === 'run') {
      const s = Math.floor(st.secs || 0);
      x.textAlign = 'left'; x.fillStyle = '#ffffff'; x.font = `600 30px ${FONT}`; x.fillText(st.title || '', 36, 112);
      x.textAlign = 'right'; x.fillStyle = '#6fd6ff'; x.fillText(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, W - 36, 112);
      x.textAlign = 'left'; x.fillStyle = '#c3cad3'; x.font = `24px ${FONT}`;
      const lines = wrap(x, st.brief || '', W - 72);
      lines.slice(0, 20).forEach((l, i) => x.fillText(i === 19 && lines.length > 20 ? l + ' …' : l, 36, 164 + i * 33));
      btn(36, H - 112, 340, 76, "I'm done: it's aligned", () => { T.view = 'rate'; }, true);
      btn(W - 36 - 300, H - 112, 300, 76, 'Give up', () => { T.res = tr.finish('gave_up'); T.view = 'result'; });
    } else if (T.view === 'rate') {
      x.textAlign = 'center'; x.fillStyle = '#ffffff'; x.font = `600 32px ${FONT}`; x.fillText('How well aligned is it?', W / 2, 200);
      x.fillStyle = '#8b97a4'; x.font = `24px ${FONT}`; x.fillText('1 = still clearly off · 5 = as good as it gets', W / 2, 250);
      for (let r = 1; r <= 5; r++) btn(36 + (r - 1) * 142, 320, 126, 110, String(r), () => { T.res = tr.finish('done', r); T.view = 'result'; }, r >= 4);
      btn(36, H - 112, 300, 76, 'Keep adjusting', () => { T.view = 'run'; });
    } else {
      x.textAlign = 'left'; x.fillStyle = '#6fd6ff'; x.font = `600 34px ${FONT}`;
      wrap(x, T.res?.head || '', W - 72).slice(0, 2).forEach((l, i) => x.fillText(l, 36, 120 + i * 42));
      x.fillStyle = '#c3cad3'; x.font = `24px ${FONT}`;
      wrap(x, T.res?.body || '', W - 72).slice(0, 20).forEach((l, i) => x.fillText(l, 36, 230 + i * 33));
      btn(36, H - 112, 340, 76, 'Try another task', () => { T.view = 'list'; }, true);
      btn(W - 36 - 220, H - 112, 220, 76, 'Close', () => { T.view = 'list'; this.trainP.mesh.visible = false; this.paintMenu(); });
    }
  }

  // ---- captions for voice commands
  paintCaption(x, W, H) {
    x.fillStyle = 'rgba(10,14,19,0.92)'; rr(x, 0, 0, W, H, 32); x.fill();
    x.strokeStyle = 'rgba(111,214,255,0.4)'; x.lineWidth = 3; x.stroke();
    x.textAlign = 'center'; x.fillStyle = '#e8edf2'; x.font = `600 32px ${FONT}`;
    const lines = wrap(x, this.capText || '', W - 80).slice(0, 4);
    lines.forEach((l, i) => x.fillText(l, W / 2, H / 2 - ((lines.length - 1) * 21) + i * 42 + 10));
  }

  // ---- ride the beam: scale the microscope up around you and slide it past, gun to spectrometer
  startRide() {
    const R = this.ride; if (R.on) return;
    this.closeCard(); this.ex.on = false;
    R.on = true; R.y = 5.7; R.paused = false; R.name = '';
    R.saved = this.preview ? { pos: this.sc.camera.position.clone(), tgt: this.sc.controls.target.clone() } : null;
    R.pose = { pos: this.world.position.clone(), rot: this.world.rotation.y, s: this.world.scale.x };
    this.grabs.clear(); this.pinch = null;
    this.world.rotation.set(0, 0, 0);
    this.setScale(0.55);
    if (this.preview) { this.sc.controls.target.set(0, 1.6, -0.3); this.sc.camera.position.set(0.55, 1.75, 0.95); this.sc.controls.update(); }
    this.rideP.mesh.visible = true; this.rideP.sig = null;
  }
  stopRide() {
    const R = this.ride; if (!R.on) return;
    R.on = false;
    this.rideP.mesh.visible = false;
    this.stopSpoken();
    if (this.preview && R.saved) { this.sc.camera.position.copy(R.saved.pos); this.sc.controls.target.copy(R.saved.tgt); this.sc.controls.update(); }
    const P = R.pose; R.pose = null;
    if (P) { this.setScale(P.s); this.world.position.copy(P.pos); this.world.rotation.set(0, P.rot, 0); }
  }
  updateRide(dt) {
    const R = this.ride; if (!R.on || !this.world) return;
    if (!R.paused) { R.y -= R.v * dt; if (R.y < -4.6) R.y = 5.8; }
    const s = this.world.scale.x;
    this.world.position.set(0, 1.6 - s * R.y, -0.12); // the point of the axis at height y stays at eye level
    const S = this.getS(); let best = null, bd = 1e9;
    for (const L of this.sc.labels) { if (!L.text || !this.sc.labelOn(L, S) || !this.component(L.text)) continue; const d = Math.abs(L.pos.y - R.y); if (d < bd) { bd = d; best = L.text; } }
    if (best && best !== R.name) { R.name = best; this.rideP.sig = null; if (this.opt.narr.on()) this.say(best); }
    this.rideP.paint(`${R.name}|${Math.round(R.y * 4)}|${R.paused}|${R.v}`);
  }
  paintRide(x, W, H) {
    const R = this.ride; R.btns = [];
    x.fillStyle = 'rgba(10,14,19,0.92)'; rr(x, 0, 0, W, H, 32); x.fill();
    x.strokeStyle = 'rgba(111,214,255,0.4)'; x.lineWidth = 3; x.stroke();
    x.textAlign = 'left'; x.fillStyle = '#6fd6ff'; x.font = `600 30px ${FONT}`; x.fillText('Riding the beam', 32, 58);
    x.fillStyle = '#ffffff'; x.font = `600 38px ${FONT}`;
    wrap(x, R.name || '…', W - 64).slice(0, 2).forEach((l, i) => x.fillText(l, 32, 128 + i * 46));
    const p = (5.8 - R.y) / 10.4;
    x.fillStyle = 'rgba(255,255,255,0.14)'; rr(x, 32, 214, W - 64, 12, 6); x.fill();
    x.fillStyle = '#6fd6ff'; x.beginPath(); x.arc(32 + p * (W - 64), 220, 14, 0, 7); x.fill();
    x.fillStyle = '#8b97a4'; x.font = `22px ${FONT}`; x.fillText('gun', 32, 258); x.textAlign = 'right'; x.fillText('spectrometer', W - 32, 258);
    const bw = 134, y = H - 130;
    [[R.paused ? '▶ Play' : '❚❚ Pause', () => { R.paused = !R.paused; }], ['Slower', () => { R.v = Math.max(0.15, R.v * 0.6); }], ['Faster', () => { R.v = Math.min(4, R.v / 0.6); }], ['Stop', () => { this.stopRide(); this.paintMenu(); }]].forEach(([label, act], i) => {
      const bx = 32 + i * (bw + 8);
      x.fillStyle = 'rgba(255,255,255,0.08)'; rr(x, bx, y, bw, 76, 18); x.fill();
      x.fillStyle = '#e8edf2'; x.textAlign = 'center'; x.font = `600 24px ${FONT}`; x.fillText(label, bx + bw / 2, y + 47);
      R.btns.push({ x: bx, y, w: bw, h: 76, act });
    });
  }

  // ---- exploded view: every top-level part of the column rides in its own slot that slides along the axis
  buildSlots() {
    const col = this.sc.column, slots = [];
    for (const c of [...col.children]) { const slot = new THREE.Group(); col.add(slot); slot.add(c); slots.push({ slot, cy: 1 }); }
    this.ex.slots = slots;
  }
  // part centres, measured fresh each time it starts to open (the screen, apertures and holder move with the mode)
  measureSlots() {
    const col = this.sc.column;
    this.world.updateMatrixWorld(true);
    for (const sl of this.ex.slots) {
      sl.slot.position.y = 0; sl.slot.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(sl.slot);
      sl.cy = box.isEmpty() ? 1 : col.worldToLocal(box.getCenter(new THREE.Vector3())).y;
    }
  }
  unwrapSlots() {
    const sl = this.ex.slots; if (!sl) return;
    for (const { slot } of sl) { for (const c of [...slot.children]) this.sc.column.add(c); this.sc.column.remove(slot); }
    this.ex.slots = null;
  }
  applyExplode() {
    if (!this.ex.slots) return;
    const k = 0.6 * this.ex.t;
    for (const { slot, cy } of this.ex.slots) { slot.position.y = (cy - 1.0) * k; slot.userData.dy = slot.position.y; }
    // beams and electrons are drawn at their assembled heights: out of the way while it is apart
    const hide = this.ex.t > 0.02, s = hide ? 1e-4 : 1;
    this.sc.beamGroups.forEach((g) => g.scale.setScalar(s));
    this.sc.shell?.scale.setScalar(s); // the glass tube around the column would just hide the parts
    this.world?.traverse((o) => { if (o.isPoints) o.scale.setScalar(s); });
  }
  animateExplode(dt) {
    const E = this.ex, want = E.on ? 1 : 0;
    if (E.t === want) return;
    if (!E.slots) this.buildSlots();
    if (E.t === 0) this.measureSlots();
    const d = want - E.t, st = Math.min(Math.abs(d), dt * 1.2);
    E.t += Math.sign(d) * st;
    if (Math.abs(want - E.t) < 1e-3) E.t = want;
    this.applyExplode();
  }

  // ---- placing things where you are looking: the head's position and the horizontal direction it faces
  head() {
    const cam = this.preview ? this.sc.camera : this.sc.renderer.xr.getCamera();
    cam.updateMatrixWorld(true);
    const p = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
    const f = new THREE.Vector3(0, 0, -1).transformDirection(cam.matrixWorld); f.y = 0;
    if (f.lengthSq() < 1e-4) f.set(0, 0, -1); f.normalize();
    return { p, f, r: new THREE.Vector3(-f.z, 0, f.x) };
  }
  // put a mesh `fwd` in front of the head, `right` to its right and `up` above it, turned to face it
  placeAt(mesh, H, right, up, fwd, yawAdd = 0) {
    mesh.position.set(H.p.x + H.f.x * fwd + H.r.x * right, H.p.y + up, H.p.z + H.f.z * fwd + H.r.z * right);
    mesh.rotation.set(0, Math.atan2(H.p.x - mesh.position.x, H.p.z - mesh.position.z) + yawAdd, 0);
  }
  toMeData() { this.placeAt(this.dataP.mesh, this.head(), 0, -0.3, 0.7); }
  // bring the microscope, menu, knobs, data and screens in front of you (Reset)
  toMe() {
    const H = this.head();
    this.world.position.x = H.p.x + H.f.x * (this.life ? 2.4 : 1.05); this.world.position.z = H.p.z + H.f.z * (this.life ? 2.4 : 1.05);
    this.placeAt(this.menu, H, -0.55, -0.15, 0.75, 0);
    this.placeAt(this.slP.mesh, H, 0.55, -0.1, 0.7);
    this.toMeData();
    this.placeScreens(H.f.clone().negate());
    this.scrT = 1;
  }
  paintData(x, W, H) {
    const d = this.dataFn();
    x.fillStyle = 'rgba(10,14,19,0.93)'; rr(x, 0, 0, W, H, 34); x.fill();
    x.strokeStyle = 'rgba(111,214,255,0.35)'; x.lineWidth = 3; x.stroke();
    x.textAlign = 'left'; x.fillStyle = '#6fd6ff'; x.font = `600 34px ${FONT}`; x.fillText('Data · live detector and last acquisition', 32, 58);
    x.fillStyle = '#e8edf2'; x.font = `28px ${FONT}`;
    d.lines.forEach((t, i) => x.fillText(t, 32, 108 + i * 38));
    const iy = 108 + d.lines.length * 38 + 14, ih = H - iy - 90, iw = (W - 96) / 2, side = Math.min(iw, ih);
    const frame = (label, draw, ox) => {
      x.fillStyle = '#000'; x.fillRect(ox, iy, side, side);
      draw(ox, side);
      x.strokeStyle = 'rgba(255,255,255,0.25)'; x.lineWidth = 2; x.strokeRect(ox, iy, side, side);
      x.fillStyle = '#8b97a4'; x.font = `24px ${FONT}`; x.fillText(label, ox, iy + side + 32);
    };
    const live = this.screensFn()[0]?.canvas;
    frame('live (updates as the beam scans)', (ox, sd) => { if (live && live.width > 8) { try { x.drawImage(live, ox, iy, sd, sd); } catch (e) { /* not drawn yet */ } } }, 32);
    const L = d.last;
    if (L) {
      if (this.dataImg?.id !== L.id) { const im = new Image(); im.onload = () => { this.dataImg.ok = true; this.dataP.sig = null; }; im.src = L.png; this.dataImg = { id: L.id, im, ok: false }; }
      frame(`acquired #${L.id} · ${L.mode.toUpperCase()}`, (ox, sd) => { if (this.dataImg.ok) x.drawImage(this.dataImg.im, ox, iy, sd, sd); }, 64 + iw);
      x.fillStyle = '#aab4bf'; x.font = `22px ${FONT}`;
      x.fillText(wrap(x, L.summary, W - 64)[0] ?? '', 32, H - 20);
    } else frame('nothing acquired yet · use Acquire', () => {}, 64 + iw);
  }

  // ---- big floating detector screens (the same canvases the page's results panel draws)
  setScreens(on) {
    const L = this.scr; L.on = on;
    for (const s of L.list) { this.sc.scene.remove(s.mesh, s.handle); for (const m of [s.mesh, s.handle]) { m.geometry.dispose(); m.material.dispose(); } s.tex.dispose(); }
    this.sd = null;
    L.list = [];
    if (!on || !this.active) return;
    const defs = [[0, 0, 0, 0.55], [0, 0, 0, 0.34]]; // widths (m); the places come from placeScreens()
    this.screensFn().forEach((sc, i) => {
      const d = defs[i]; if (!d) return;
      const tex = new THREE.CanvasTexture(sc.canvas); tex.colorSpace = THREE.SRGBColorSpace;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide }));
      if (this.preview) mesh.material.color.setScalar(0.75);
      this.sc.scene.add(mesh);
      const handle = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.06), new THREE.MeshBasicMaterial({ color: 0x6fd6ff, transparent: true, opacity: 0.85, toneMapped: false }));
      handle.rotation.y = mesh.rotation.y;
      this.sc.scene.add(handle);
      L.list.push({ mesh, tex, canvas: sc.canvas, ver: sc.ver, seen: null, w: d[3], handle });
    });
    this.placeScreens();
    this.scrT = 1;
  }
  // the screens stand at the bottom of the column, where the detectors are, tilted back like bench monitors; `toward` is where you are
  placeScreens(toward) {
    if (!this.world || !this.scr.list.length) return;
    const to = toward ? toward.clone().setY(0).normalize() : new THREE.Vector3(0, 0, 1), side = new THREE.Vector3(-to.z, 0, to.x);
    const base = this.world.localToWorld(new THREE.Vector3(0, Y.cam, 0));
    const sc = this.world.scale.x / TABLE;
    this.scr.list.forEach((s, i) => {
      const h = s.w * (s.canvas.height / s.canvas.width || 1), off = (0.62 + 0.08 * i) * sc, sd = (i ? 0.5 : 0) * sc;
      s.mesh.position.copy(base).addScaledVector(to, off).addScaledVector(side, sd); s.mesh.position.y = base.y + h * 0.5 - 0.03 * sc;
      s.mesh.rotation.set(-0.3, Math.atan2(to.x, to.z), 0, 'YXZ');
      s.handle.rotation.copy(s.mesh.rotation);
    });
  }
  fitScreen(s) {
    const c = s.canvas;
    s.mesh.scale.set(s.w, (s.w * c.height) / c.width, 1);
    s.mesh.updateMatrixWorld();
    s.handle.position.copy(s.mesh.localToWorld(new THREE.Vector3(0.5, -0.5, 0.004)));
    s.handle.visible = s.mesh.visible;
  }
  screenHit(ray) {
    const rc = (this._rc4 ??= new THREE.Raycaster());
    rc.ray.copy(ray);
    const meshes = this.scr.list.filter((s) => s.mesh.visible).map((s) => s.mesh);
    const h = rc.intersectObjects(meshes, false)[0];
    return h ? { s: this.scr.list.find((x) => x.mesh === h.object), uv: h.uv, point: h.point } : null;
  }
  updateScreens(dt) {
    const L = this.scr; if (!L.on) return;
    this.scrT = (this.scrT || 0) + dt;
    if (this.scrT < 0.1) return;
    this.scrT = 0;
    for (const s of L.list) {
      const c = s.canvas, ok = c.width > 8 && c.height > 8 && c.clientWidth > 8;
      s.mesh.visible = ok;
      if (!ok) continue;
      this.fitScreen(s);
      const v = s.ver ? s.ver() : -1;
      if (v !== s.seen || v === -1) { s.seen = v; s.tex.needsUpdate = true; } // only when the page redrew it
    }
  }

  update(dt) {
    if (!this.active || !this.world) return;
    this.panels(dt);
    if (this.preview) { // mouse hover stands in for the controller ray
      if (this.pvHit !== this.hover || this.drawn !== this.menuSig()) { this.hover = this.pvHit ?? -1; this.paintMenu(); }
      return;
    }
    const g = [...this.grabs.keys()];
    const W = this.world;
    if (g.length === 1) {
      g[0].updateMatrixWorld();
      const m = g[0].matrixWorld.clone().multiply(this.grabs.get(g[0]).offset);
      const pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
      m.decompose(pos, q, sc);
      // keep it upright: take the hand's yaw only
      const yaw = new THREE.Euler().setFromQuaternion(q, 'YXZ').y;
      W.position.copy(pos); W.rotation.set(0, yaw, 0);
    } else if (g.length === 2 && this.pinch) {
      const a = new THREE.Vector3().setFromMatrixPosition(g[0].matrixWorld), b = new THREE.Vector3().setFromMatrixPosition(g[1].matrixWorld);
      const P = this.pinch, k = a.distanceTo(b) / Math.max(1e-3, P.d);
      this.setScale(THREE.MathUtils.clamp(P.s * k, 0.02, 0.6));
      W.rotation.y = P.rotY + (Math.atan2(b.x - a.x, b.z - a.z) - P.ang);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      W.position.copy(P.pos).add(mid.sub(P.mid));
    }
    // thumbsticks
    for (const src of this.session?.inputSources || []) {
      const ax = src.gamepad?.axes; if (!ax || ax.length < 4) continue;
      const sx = Math.abs(ax[2]) > 0.15 ? ax[2] : 0, sy = Math.abs(ax[3]) > 0.15 ? ax[3] : 0;
      if (sx && !this.ride.on) W.rotation.y -= sx * dt * 1.6;
      if (sy && !this.ride.on) this.setScale(THREE.MathUtils.clamp(W.scale.x * (1 - sy * dt * 0.9), 0.02, 0.6));
    }
    // a held trigger drags a slider
    const held = this.sl.drag || this.sd;
    if (held?.id?.isObject3D) this.rayMove(this.ctrlRay(held.id), held.id);
    // ray feedback on the menu
    let best = -1;
    for (const c of this.ctrl) {
      c.updateMatrixWorld();
      const h = this.menuHit(c);
      if (h.idx >= 0) best = h.idx;
      c.userData.ray.scale.z = h.dist ?? 1.2;
    }
    if (best !== this.hover || this.drawn !== this.menuSig()) { this.hover = best; this.paintMenu(); }
  }
}
