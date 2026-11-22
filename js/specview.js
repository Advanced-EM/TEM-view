// Specimen structure viewer: the specimen in 3D (structure.js), with the beam, the imaged field or scan box,
// multislice slices and (later) in situ cell layers drawn around it.
//
// One canvas, moved between hosts (the card in the controls, or the results panel). It has its own small
// WebGL renderer, created when a host is visible and released (with its context) when none is, or while a
// headset session runs, so it never competes with the column for long. Every rebuild frees the previous
// geometry and materials; info() reports what the renderer holds so tests can check for leaks.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { POINTS_ABOVE } from './structure.js';

const DEG = Math.PI / 180;
const BEAM = 0x6fd6ff;

export class SpecViewer {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'svCanvas';
    this.canvas.setAttribute('aria-label', 'Specimen structure in 3D: drag to orbit, scroll to zoom');
    this.hud = document.createElement('div');
    this.hud.className = 'svHud';
    this.host = null; this.R = null; this.st = null; this.ov = {}; this.opts = { bonds: false, overlays: true, sync: true };
    this.paused = false; this.view = 'iso'; this._raf = 0; this._dirty = true;
    this.ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.resize()) : null;
  }

  // ---------------------------------------------------------------- hosts and the renderer's lifetime
  attach(host) {
    if (this.host === host) return;
    if (this.host) this.ro?.unobserve(this.host);
    this.host = host;
    if (!host) { this.release(); return; }
    host.append(this.canvas, this.hud);
    this.ro?.observe(host);
    this.ensure();
    this.resize();
    this.loop();
  }
  release() {
    cancelAnimationFrame(this._raf); this._raf = 0;
    if (!this.R) return;
    this.clearGroup(this.specG); this.clearGroup(this.ovG); this.clearGroup(this.envG);
    this.controls.dispose();
    this.sphere.dispose(); this.box.dispose(); this.cone.dispose();
    this.R.forceContextLoss(); this.R.dispose();
    this.R = null; this.built = null; this._ovKey = null;
  }
  ensure() {
    if (this.R) return;
    const R = (this.R = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, preserveDrawingBuffer: true }));
    R.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.01, 500);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.1;
    this.controls.addEventListener('change', () => { this._dirty = true; });
    this.scene.add(new THREE.HemisphereLight(0xe8f0ff, 0x1a1f28, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(4, 6, 10); this.scene.add(key);
    this.world = new THREE.Group(); this.world.rotation.x = -Math.PI / 2; // structure z (the beam axis) is up on screen
    this.specG = new THREE.Group(); this.ovG = new THREE.Group(); this.envG = new THREE.Group();
    this.world.add(this.specG, this.ovG, this.envG);
    this.scene.add(this.world);
    this.sphere = new THREE.SphereGeometry(1, 14, 10); this.box = new THREE.BoxGeometry(1, 1, 1); this.cone = new THREE.ConeGeometry(0.28, 1, 10);
    this.built = null;
    if (this.st) this.rebuild();
    this.setView(this.view);
  }
  pause(p) { this.paused = p; if (p) this.release(); else if (this.host) { this.ensure(); this.loop(); } }
  visible() { return !!this.host && !this.paused && this.host.offsetParent !== null && document.visibilityState !== 'hidden'; }
  resize() {
    if (!this.R || !this.host) return;
    const w = Math.max(10, this.host.clientWidth), h = Math.max(10, this.host.clientHeight);
    this.R.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this._dirty = true;
  }
  loop() {
    if (this._raf) return;
    const tick = () => {
      this._raf = 0;
      if (!this.R) return;
      if (!this.visible()) { this._idle = (this._idle ?? 0) + 1; if (this._idle > 180) { this.release(); return; } this._raf = requestAnimationFrame(tick); return; } // ~3 s hidden: give the context back
      this._idle = 0;
      this.controls.update();
      if (this._dirty) { this.R.render(this.scene, this.camera); this.drawHud(); this._dirty = false; }
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }
  wake() { if (this.host && !this.paused) { this.ensure(); this.loop(); this._dirty = true; } }

  // ---------------------------------------------------------------- content
  // st: a structure from structure.js; key: changes when it must be rebuilt
  setStructure(st, key) {
    if (key && key === this.key) return;
    this.key = key; this.st = st;
    if (this.R) this.rebuild();
  }
  setOptions(o) { Object.assign(this.opts, o); if (this.R && this.st) this.rebuild(); }
  // overlays in the beam's frame: { mode, family ('tem'|'probe'), fov_A, scan_A, probe: [x, y] Å, slices, tiltX, tiltY, zone, label }
  setOverlay(ov) {
    const k = JSON.stringify(ov);
    if (k === this._ovKey) return;
    this._ovKey = k; this.ov = ov;
    if (this.R && this.st) { this.buildOverlay(); this.applyTilt(); this._dirty = true; }
  }

  rebuild() {
    const st = this.st;
    this.clearGroup(this.specG);
    // scene scale: the structure's largest dimension spans ~10 units
    const L = Math.max(...st.box, 1);
    this.k = 10 / L;
    const c = [0, 1, 2].map((d) => (st.lo[d] + st.hi[d]) / 2);
    this.center = c;
    this.specG.scale.setScalar(this.k); this.ovG.scale.setScalar(this.k); this.envG.scale.setScalar(this.k);
    this.specG.position.set(0, 0, 0);
    const g = new THREE.Group(); g.position.set(-c[0], -c[1], -c[2]); this.specG.add(g); this.inner = g;
    if (st.count) (st.count > POINTS_ABOVE ? this.addPoints(g, st) : this.addAtoms(g, st));
    if (st.count && this.opts.bonds && st.count <= 20000) this.addBonds(g, st);
    for (const v of st.voxels) this.addVoxels(g, v);
    for (const s of st.shells) this.addShell(g, s);
    if (st.slab) this.addSlab(g, st.slab);
    if (st.arrows) this.addArrows(g, st.arrows);
    this.buildOverlay();
    this.applyTilt();
    this.setView(this.view, true);
    this._dirty = true;
  }

  addAtoms(g, st) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    st.species.forEach((sp, si) => {
      if (!sp.count) return;
      const mat = new THREE.MeshStandardMaterial({ color: sp.color, roughness: 0.45, metalness: 0.05 });
      const mesh = new THREE.InstancedMesh(this.sphere, mat, sp.count);
      const r = 0.6 * sp.r;
      let k = 0;
      for (let i = 0; i < st.count; i++) {
        if (st.el[i] !== si) continue;
        p.set(st.pos[3 * i], st.pos[3 * i + 1], st.pos[3 * i + 2]); sc.setScalar(r);
        mesh.setMatrixAt(k++, m.compose(p, q, sc));
      }
      mesh.instanceMatrix.needsUpdate = true;
      g.add(mesh);
    });
  }
  addPoints(g, st) {
    const geo = new THREE.BufferGeometry(), col = new Float32Array(3 * st.count), c = new THREE.Color();
    geo.setAttribute('position', new THREE.BufferAttribute(st.pos.slice(0, 3 * st.count), 3));
    for (let i = 0; i < st.count; i++) { c.set(st.species[st.el[i]].color); col[3 * i] = c.r; col[3 * i + 1] = c.g; col[3 * i + 2] = c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({ size: 1.2, vertexColors: true, sizeAttenuation: true });
    g.add(new THREE.Points(geo, mat));
    // bounding box, so the extent stays readable
    const b = new THREE.Box3(new THREE.Vector3(...st.lo), new THREE.Vector3(...st.hi));
    const bh = new THREE.Box3Helper(b, 0x5a6472); g.add(bh);
  }
  addBonds(g, st) {
    const G = 3.2, grid = new Map(), key = (i, j, k) => `${i},${j},${k}`, pos = st.pos, seg = [], col = [], c1 = new THREE.Color(), c2 = new THREE.Color();
    for (let a = 0; a < st.count; a++) { const k = key(Math.floor(pos[3 * a] / G), Math.floor(pos[3 * a + 1] / G), Math.floor(pos[3 * a + 2] / G)); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(a); }
    for (let a = 0; a < st.count; a++) {
      const i = Math.floor(pos[3 * a] / G), j = Math.floor(pos[3 * a + 1] / G), l = Math.floor(pos[3 * a + 2] / G), ra = st.species[st.el[a]].r;
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (let dl = -1; dl <= 1; dl++)
        for (const b of grid.get(key(i + di, j + dj, l + dl)) ?? []) {
          if (b <= a) continue;
          const d = Math.hypot(pos[3 * a] - pos[3 * b], pos[3 * a + 1] - pos[3 * b + 1], pos[3 * a + 2] - pos[3 * b + 2]);
          if (d < 0.4 || d > 1.15 * (ra + st.species[st.el[b]].r)) continue;
          seg.push(pos[3 * a], pos[3 * a + 1], pos[3 * a + 2], pos[3 * b], pos[3 * b + 1], pos[3 * b + 2]);
          c1.set(st.species[st.el[a]].color); c2.set(st.species[st.el[b]].color);
          col.push(c1.r, c1.g, c1.b, c2.r, c2.g, c2.b);
        }
    }
    if (!seg.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.7 })));
  }
  addVoxels(g, v) {
    if (v.matrix) return this.addSheets(g, v);
    const mat = new THREE.MeshStandardMaterial({ color: v.color, transparent: v.opacity < 1, opacity: v.opacity, depthWrite: v.opacity >= 0.6, roughness: 0.9 });
    const mesh = new THREE.InstancedMesh(this.box, mat, v.n), m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    for (let i = 0; i < v.n; i++) { const b = v.boxes; p.set(b[6 * i], b[6 * i + 1], b[6 * i + 2]); s.set(b[6 * i + 3], b[6 * i + 4], b[6 * i + 5]); mesh.setMatrixAt(i, m.compose(p, q, s)); }
    mesh.instanceMatrix.needsUpdate = true; mesh.renderOrder = 2;
    g.add(mesh);
  }
  // a translucent matrix (support film, ice, oxide) as its top and bottom surfaces: drawing every cell's box
  // would stack internal faces into an opaque block
  addSheets(g, v) {
    const plane = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: v.color, transparent: true, opacity: Math.min(0.5, v.opacity * 1.6), depthWrite: false, side: THREE.DoubleSide, roughness: 0.9 });
    const mesh = new THREE.InstancedMesh(plane, mat, 2 * v.n), m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    const b = v.boxes;
    for (let i = 0; i < v.n; i++) {
      sc.set(b[6 * i + 3], b[6 * i + 4], 1);
      p.set(b[6 * i], b[6 * i + 1], b[6 * i + 2] + b[6 * i + 5] / 2); mesh.setMatrixAt(2 * i, m.compose(p, q, sc));
      p.set(b[6 * i], b[6 * i + 1], b[6 * i + 2] - b[6 * i + 5] / 2); mesh.setMatrixAt(2 * i + 1, m.compose(p, q, sc));
    }
    mesh.instanceMatrix.needsUpdate = true; mesh.renderOrder = 2;
    g.add(mesh);
  }
  addShell(g, s) {
    const mat = new THREE.MeshStandardMaterial({ color: s.color, transparent: s.opacity < 1, opacity: s.opacity, depthWrite: s.opacity >= 0.6, roughness: 0.6 });
    const m = new THREE.Mesh(this.sphere, mat); m.position.set(s.x, s.y, s.z); m.scale.setScalar(s.R); m.renderOrder = 3;
    g.add(m);
  }
  addSlab(g, s) {
    const geo = s.shape === 'disc' ? new THREE.CylinderGeometry(s.w / 2, s.w / 2, s.t, 64) : new THREE.BoxGeometry(s.w, s.h, s.t);
    if (s.shape === 'disc') geo.rotateX(Math.PI / 2);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: s.color, transparent: true, opacity: s.opacity, depthWrite: false }));
    g.add(m);
  }
  // magnetization: cones along m, coloured by the in-plane direction (hue) and brightened by the out-of-plane part
  addArrows(g, a) {
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.5 });
    const mesh = new THREE.InstancedMesh(this.cone, mat, a.n), M = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), d = new THREE.Vector3(), p = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
    for (let i = 0; i < a.n; i++) {
      d.set(a.dir[3 * i], a.dir[3 * i + 1], a.dir[3 * i + 2]);
      const len = d.length() || 1; d.divideScalar(len);
      q.setFromUnitVectors(up, d); p.set(a.pos[3 * i], a.pos[3 * i + 1], a.pos[3 * i + 2] + a.len * 0.2); s.setScalar(a.len);
      mesh.setMatrixAt(i, M.compose(p, q, s));
      c.setHSL(((Math.atan2(d.y, d.x) / (2 * Math.PI)) + 1) % 1, 0.75, 0.55 + 0.25 * Math.abs(d.z)); mesh.setColorAt(i, c);
    }
    mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    g.add(mesh);
  }

  // ---------------------------------------------------------------- overlays (the beam's frame: not tilted)
  buildOverlay() {
    this.clearGroup(this.ovG);
    const st = this.st, ov = this.ov, c = this.center ?? [0, 0, 0];
    if (!st || !this.opts.overlays) return;
    const g = new THREE.Group(); g.position.set(-c[0], -c[1], -c[2]); this.ovG.add(g);
    const top = st.hi[2] + 0.12 * Math.max(...st.box, 1), bot = st.lo[2];
    // the beam: an arrow down the optical axis, from above the entrance face
    const L = Math.max(...st.box, 1), from = new THREE.Vector3(c[0], c[1], top + 0.22 * L);
    const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), from, 0.22 * L, BEAM, 0.07 * L, 0.035 * L);
    g.add(arrow);
    // field of view, scan box or probe position, on the entrance face and through the thickness
    const lineMat = new THREE.LineBasicMaterial({ color: BEAM, transparent: true, opacity: 0.9 });
    const dash = new THREE.LineDashedMaterial({ color: BEAM, transparent: true, opacity: 0.45, dashSize: 0.02 * L, gapSize: 0.015 * L });
    const zt = st.hi[2] + 0.01 * L, zb = bot;
    const rect = (w, h, z) => { const x = w / 2, y = h / 2; return [x, y, z, -x, y, z, -x, y, z, -x, -y, z, -x, -y, z, x, -y, z, x, -y, z, x, y, z]; };
    const box = (w, h) => {
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(rect(w, h, zt), 3)); g.add(new THREE.LineSegments(geo, lineMat));
      const v = [], x = w / 2, y = h / 2; for (const [a, b] of [[x, y], [-x, y], [-x, -y], [x, -y]]) v.push(a, b, zt, a, b, zb);
      v.push(...rect(w, h, zb));
      const g2 = new THREE.BufferGeometry(); g2.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); const ls = new THREE.LineSegments(g2, dash); ls.computeLineDistances(); g.add(ls);
    };
    if (ov.probe) {
      const [px, py] = ov.probe, r = 0.03 * L, pts = [];
      for (let i = 0; i <= 32; i++) pts.push(px + r * Math.cos((i / 32) * 2 * Math.PI), py + r * Math.sin((i / 32) * 2 * Math.PI), zt);
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); g.add(new THREE.Line(geo, lineMat));
      const cone = new THREE.BufferGeometry(); cone.setAttribute('position', new THREE.Float32BufferAttribute([px, py, zt, px, py, zb], 3)); g.add(new THREE.LineSegments(cone, lineMat));
    }
    if (ov.scan_A) box(ov.scan_A, ov.scan_A);
    else if (ov.fov_A) box(ov.fov_A, ov.fov_A);
    // multislice: the slices the specimen is cut into
    if (ov.slices > 1) {
      const n = Math.min(ov.slices, 40), w = (ov.scan_A || ov.fov_A || L) * 1.05;
      const mat = new THREE.MeshBasicMaterial({ color: BEAM, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false });
      const plane = new THREE.PlaneGeometry(w, w);
      for (let i = 1; i < n; i++) { const m = new THREE.Mesh(plane, mat); m.position.set(0, 0, st.hi[2] - (i / n) * (st.hi[2] - st.lo[2])); g.add(m); }
    }
  }
  applyTilt() {
    const ov = this.ov;
    const k = ov.tiltShow ?? 1, a = this.opts.sync ? (ov.tiltX ?? 0) * DEG * k : 0, b = this.opts.sync ? (ov.tiltY ?? 0) * DEG * k : 0;
    this.specG.rotation.set(a, b, 0, 'XYZ'); this.envG.rotation.set(a, b, 0, 'XYZ');
  }

  // In situ hook (M13–M16): translucent layers in the specimen frame, e.g. windows with bulge, a liquid
  // layer, electrodes. layers: [{ z, t, w, h, color, opacity, bulge (Å at the centre, optional) }], Å.
  setEnvironment(layers = []) {
    this._env = layers;
    if (!this.R) return;
    this.clearGroup(this.envG);
    const c = this.center ?? [0, 0, 0], g = new THREE.Group(); g.position.set(-c[0], -c[1], -c[2]); this.envG.add(g);
    for (const L of layers) {
      const geo = new THREE.BoxGeometry(L.w, L.h, L.t, L.bulge ? 24 : 1, L.bulge ? 24 : 1, 1);
      if (L.bulge) { const p = geo.attributes.position; for (let i = 0; i < p.count; i++) { const u = (2 * p.getX(i)) / L.w, v = (2 * p.getY(i)) / L.h; p.setZ(i, p.getZ(i) + Math.sign(L.z || 1) * L.bulge * Math.max(0, (1 - u * u) * (1 - v * v))); } geo.computeVertexNormals(); }
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: L.color ?? '#9fb4c8', transparent: true, opacity: L.opacity ?? 0.2, depthWrite: false }));
      m.position.z = L.z; g.add(m);
    }
    this._dirty = true;
  }

  // ---------------------------------------------------------------- camera
  setView(name, keepDist = false) {
    this.view = name;
    if (!this.R) return;
    const d = keepDist && this._dist ? this._dist : 27, cam = this.camera;
    // world: structure z is screen up (world y); the beam travels down
    const dirs = { beam: [0, 1, 0.0001], side: [0, 0.02, 1], iso: [0.75, 0.6, 0.9] };
    const v = new THREE.Vector3(...(dirs[name] ?? dirs.iso)).normalize().multiplyScalar(d);
    cam.position.copy(v); cam.up.set(0, name === 'beam' ? 0 : 1, name === 'beam' ? -1 : 0);
    this.controls.target.set(0, 0, 0); cam.lookAt(0, 0, 0); this.controls.update();
    this._dist = d; this._dirty = true;
  }

  // the beam direction and the crystal's zone axis, and a triad of the specimen axes in screen space
  drawHud() {
    const ov = this.ov ?? {}, st = this.st;
    if (!st) { this.hud.innerHTML = ''; return; }
    const ax = (v) => { const p = v.clone().applyQuaternion(this.world.quaternion).applyQuaternion(this.specG.quaternion).project(this.camera); const o = new THREE.Vector3().project(this.camera); return [p.x - o.x, -(p.y - o.y)]; };
    const s = 18, X = ax(new THREE.Vector3(1, 0, 0)), Y = ax(new THREE.Vector3(0, 1, 0)), Z = ax(new THREE.Vector3(0, 0, 1));
    const n = (v) => { const l = Math.hypot(...v) || 1; return [v[0] / l * s, v[1] / l * s]; };
    const line = (v, col, t) => { const [x, y] = n(v); return `<line x1="24" y1="24" x2="${24 + x}" y2="${24 + y}" stroke="${col}" stroke-width="1.6"/><text x="${24 + x * 1.3}" y="${27 + y * 1.3}" fill="${col}" font-size="9" text-anchor="middle">${t}</text>`; };
    this.hud.innerHTML = `<svg width="48" height="48" viewBox="0 0 48 48" aria-hidden="true">${line(X, '#ff8a8a', 'x')}${line(Y, '#8aff9a', 'y')}${line(Z, '#8ab4ff', 'z')}</svg><span>beam ↓${ov.zone && ov.zone !== '—' ? ` ∥ ${ov.zone}` : ''}${this.opts.sync && (ov.tiltX || ov.tiltY) ? ` · tilt α ${(+ov.tiltX).toFixed(1)}° β ${(+ov.tiltY).toFixed(1)}°${(ov.tiltShow ?? 1) > 1 ? ` (shown ×${ov.tiltShow})` : ''}` : ''}${st.count > POINTS_ABOVE ? ' · point cloud' : ''}</span>`;
  }

  // a small picture of a structure (for the specimen cards); needs the renderer
  thumbnail(st, w = 120, h = 84) {
    if (!this.R) return null;
    const keep = { st: this.st, key: this.key, ov: this.ov, view: this.view, size: this.R.getSize(new THREE.Vector2()), ovOn: this.opts.overlays };
    this.st = st; this.opts.overlays = false; this.ov = {};
    this.R.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.rebuild(); this.setView('iso'); this.R.render(this.scene, this.camera);
    const url = this.canvas.toDataURL('image/png');
    Object.assign(this, { st: keep.st, key: keep.key, ov: keep.ov }); this.opts.overlays = keep.ovOn;
    this.R.setSize(keep.size.x, keep.size.y, false); this.camera.aspect = keep.size.x / keep.size.y; this.camera.updateProjectionMatrix();
    if (this.st) this.rebuild(); else this.clearGroup(this.specG);
    this.setView(keep.view);
    return url;
  }

  info() { return this.R ? { ...this.R.info.memory, programs: this.R.info.programs?.length ?? 0, live: true } : { geometries: 0, textures: 0, live: false }; }

  clearGroup(g) {
    if (!g) return;
    const shared = new Set([this.sphere, this.box, this.cone]);
    g.traverse((o) => {
      if (o.geometry && !shared.has(o.geometry)) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      if (o.dispose && o.isInstancedMesh) o.dispose();
    });
    while (g.children.length) g.remove(g.children[0]);
  }
}
