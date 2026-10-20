// The 3D instrument: Ruska's 1933 brass column on its wooden table (after the museum's model), and a schematic
// of the 1931 two-coil tube. Units: cm. The beam envelope, screen glow and specimen heat follow the live optics.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export function createScene(stage, { onPick, label }) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const tip = stage.querySelector('#tip');
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.localClippingEnabled = true;
  stage.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(renderer), 0.04).texture;
  scene.add(new THREE.HemisphereLight(0xfff1dc, 0x2a2016, 0.5));
  const key = new THREE.DirectionalLight(0xffe8c8, 1.6); key.position.set(120, 300, 160); scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fc8ff, 0.9); rim.position.set(-200, 180, -220); scene.add(rim);
  const flashL = new THREE.PointLight(0xbfd8ff, 0, 400, 1.5); flashL.position.set(0, 236, 0); scene.add(flashL);

  const camera = new THREE.PerspectiveCamera(30, 1, 5, 3000);
  camera.position.set(170, 230, 260);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 150, 0);
  Object.assign(controls, { enableDamping: true, enablePan: false, minDistance: 120, maxDistance: 520, minPolarAngle: 0.2, maxPolarAngle: Math.PI * 0.62, autoRotate: !reduce, autoRotateSpeed: 0.55 });
  controls.addEventListener('start', () => renderer.domElement.classList.add('grab'));
  controls.addEventListener('end', () => renderer.domElement.classList.remove('grab'));

  // ------------------------------------------------------------------ materials
  const clip = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
  const M = {
    brass: new THREE.MeshStandardMaterial({ color: 0xc89a46, metalness: 0.92, roughness: 0.3, side: THREE.DoubleSide }),
    brassD: new THREE.MeshStandardMaterial({ color: 0x9b7232, metalness: 0.9, roughness: 0.42, side: THREE.DoubleSide }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xe6e8ea, metalness: 1, roughness: 0.12, side: THREE.DoubleSide }),
    iron: new THREE.MeshStandardMaterial({ color: 0x18191c, metalness: 0.5, roughness: 0.55 }),
    wood: null,
    copper: new THREE.MeshStandardMaterial({ color: 0xb4602e, metalness: 0.85, roughness: 0.35 }),
    pole: new THREE.MeshStandardMaterial({ color: 0x55585e, metalness: 0.9, roughness: 0.35 }),
    white: new THREE.MeshStandardMaterial({ color: 0xe9e6df, metalness: 0, roughness: 0.35 }),
    red: new THREE.MeshStandardMaterial({ color: 0xb8231c, metalness: 0.1, roughness: 0.4 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xcfe3e8, metalness: 0, roughness: 0.05, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
    phos: new THREE.MeshBasicMaterial({ color: 0x0b1a08, toneMapped: false }),
    phosI: new THREE.MeshBasicMaterial({ color: 0x0b1a08, toneMapped: false }),
    window: new THREE.MeshPhysicalMaterial({ color: 0x0b120a, metalness: 0, roughness: 0.04, clearcoat: 1, emissive: 0x000000 }),
    hot: new THREE.MeshStandardMaterial({ color: 0x3a3a3a, metalness: 0.6, roughness: 0.5, emissive: 0x000000 }),
    beam: new THREE.MeshBasicMaterial({ color: 0x7fd2ff, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
    glow: new THREE.MeshBasicMaterial({ color: 0x9a7bff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  };
  const clipped = [M.brass, M.brassD, M.chrome];
  {
    const c = document.createElement('canvas'); c.width = 512; c.height = 512; const g = c.getContext('2d');
    g.fillStyle = '#8a5326'; g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 140; i++) { const y = Math.random() * 512, a = 0.04 + Math.random() * 0.1; g.strokeStyle = `rgba(${Math.random() < 0.5 ? '50,25,8' : '190,120,60'},${a})`; g.lineWidth = 1 + Math.random() * 3; g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= 512; x += 32) g.lineTo(x, y + Math.sin(x / 60 + i) * 4); g.stroke(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    M.wood = new THREE.MeshStandardMaterial({ map: t, roughness: 0.55, metalness: 0 });
  }

  // ------------------------------------------------------------------ helpers
  const tag = (o, part) => { o.traverse((m) => { if (m.isMesh) m.userData.part = part; }); return o; };
  const cyl = (r, h, y, mat, seg = 48, r2 = r) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r2, r, h, seg, 1, true), mat); m.position.y = y + h / 2; const g = new THREE.Group(); g.add(m);
    const capT = new THREE.Mesh(new THREE.RingGeometry(0, r2, seg), mat); capT.rotation.x = -Math.PI / 2; capT.position.y = y + h; g.add(capT);
    const capB = new THREE.Mesh(new THREE.RingGeometry(0, r, seg), mat); capB.rotation.x = Math.PI / 2; capB.position.y = y; g.add(capB); return g; };
  const tube = (r, h, y, mat, seg = 48) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg, 1, true), mat); m.position.y = y + h / 2; return m; };
  const ring = (r, t, y, mat) => { const m = new THREE.Mesh(new THREE.TorusGeometry(r, t, 12, 64), mat); m.rotation.x = Math.PI / 2; m.position.y = y; return m; };
  const knurl = (r, h, y, mat) => { const g = new THREE.CylinderGeometry(r, r, h, 64, 1, false); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), a = Math.atan2(z, x), rr = Math.hypot(x, z); if (rr > r * 0.9) { const k = 1 + 0.035 * Math.sign(Math.sin(a * 48)); p.setX(i, x * k); p.setZ(i, z * k); } } g.computeVertexNormals(); const m = new THREE.Mesh(g, mat); m.position.y = y + h / 2; return m; };
  // a side knob sticking out of the column: shaft + knurled head
  const sideKnob = (r0, y, ang, len, head, mat = M.brass) => { const g = new THREE.Group(); const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, len, 16), mat); sh.rotation.z = Math.PI / 2; sh.position.x = r0 + len / 2; g.add(sh);
    const hd = knurl(head, 1.4, -0.7, mat); hd.rotation.z = Math.PI / 2; hd.position.set(r0 + len + 0.7, 0, 0); g.add(hd); g.position.y = y; g.rotation.y = ang; return g; };
  const windowRound = (r0, y, ang, rad, mat) => { const g = new THREE.Group(); const fr = new THREE.Mesh(new THREE.TorusGeometry(rad, 0.45, 12, 40), M.brass); fr.rotation.y = Math.PI / 2; fr.position.x = r0 + 0.2; g.add(fr);
    const gl = new THREE.Mesh(new THREE.CircleGeometry(rad, 40), mat); gl.rotation.y = Math.PI / 2; gl.position.x = r0 + 0.25; g.add(gl); g.position.y = y; g.rotation.y = ang; return g; };

  const world = new THREE.Group(); scene.add(world);
  // table and frame (both instruments)
  const table = new THREE.Group(); world.add(table);
  { const top = new THREE.Mesh(new THREE.BoxGeometry(64, 4, 64), M.wood); top.position.y = 72; table.add(top);
    for (const [x, z] of [[-28, -28], [28, -28], [-28, 28], [28, 28]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(4.5, 70, 4.5), M.wood); l.position.set(x, 35, z); table.add(l); }
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(58, 6, 58), M.wood); skirt.position.y = 67; table.add(skirt);
    tag(table, 'table'); }

  // ------------------------------------------------------------------ 1933 column
  const c33 = new THREE.Group(); world.add(c33);
  const ironFrame = new THREE.Group(); c33.add(ironFrame);
  for (const [x, z] of [[-24, -22], [24, -22], [-24, 22], [24, 22]]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 18, 16), M.iron); p.position.set(x, 83, z); ironFrame.add(p); const f = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 1.4, 20), M.iron); f.position.set(x, 74.7, z); ironFrame.add(f); }
  for (const z of [-22, 22]) { const r = new THREE.Mesh(new THREE.BoxGeometry(52, 2.6, 3), M.iron); r.position.set(0, 92, z); ironFrame.add(r); }
  for (const x of [-12, 12]) { const r = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.6, 46), M.iron); r.position.set(x, 94.4, 0); ironFrame.add(r); }
  tag(ironFrame, 'frame');

  const col = new THREE.Group(); c33.add(col);
  const P = {}; // part groups for picking
  const part = (name, ...objs) => { const g = new THREE.Group(); objs.forEach((o) => g.add(o)); tag(g, name); col.add(g); P[name] = g; return g; };
  // y layout (cm, from the floor): screen 100, projector 128, intermediate 140, objective 167, specimen 175.5, condenser 183, cathode 222
  part('camera', cyl(9.5, 13, 94.5, M.brass), ring(9.7, 0.6, 95, M.brassD), ring(9.7, 0.6, 107, M.brassD), knurl(10.2, 1.6, 107.2, M.brassD));
  const winM = M.window;
  part('screen', windowRound(9.5, 101, 0.4, 2.6, winM), windowRound(9.5, 101, 2.5, 2.6, winM), windowRound(9.5, 101, -1.6, 2.6, winM));
  part('plates', (() => { const g = new THREE.Group(); const t = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 22, 24), M.brass); t.rotation.z = Math.PI / 2; t.position.set(19, 98, 0); g.add(t);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.1, 1.5, 24), M.brassD); cap.position.set(29.5, 98, 0); cap.rotation.z = Math.PI / 2; g.add(cap);
    const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 7, 10), M.iron); lever.position.set(26, 103, 0); lever.rotation.z = -0.5; g.add(lever); return g; })());
  part('pump', (() => { const g = new THREE.Group(); const w = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.1, 30, 28), M.white); w.position.set(30, 80, 0); g.add(w);
    const c1 = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 1.6, 28), M.iron); c1.position.set(30, 95.5, 0); g.add(c1);
    const c2 = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 1.6, 28), M.iron); c2.position.set(30, 64.5, 0); g.add(c2);
    const v = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.2, 5, 20), M.red); v.position.set(30, 61, 0); g.add(v);
    const vh = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.5, 10, 24), M.red); vh.rotation.x = Math.PI / 2; vh.position.set(30, 57.5, 0); g.add(vh); return g; })());
  part('endtube', cyl(4.6, 19, 107.5, M.brass), ring(4.9, 0.45, 112, M.brassD), ring(4.9, 0.45, 120, M.brassD));
  part('projector', cyl(9, 8, 126.5, M.brass), knurl(9.4, 1.4, 126.5, M.brassD), knurl(9.4, 1.4, 133.1, M.brassD), sideKnob(9, 130.5, 2.2, 1.6, 1.3));
  part('intermediate', cyl(4.2, 32, 134.5, M.brass), cyl(6.2, 5, 137.5, M.brassD), windowRound(6.2, 140, 0.4, 1.6, M.window), sideKnob(6.2, 140, -2.0, 2, 1.5), ring(4.5, 0.4, 150, M.brassD), ring(4.5, 0.4, 158, M.brassD));
  part('objective', cyl(8.6, 7.5, 163.5, M.brass), knurl(9, 1.3, 163.5, M.brassD), knurl(9, 1.3, 169.7, M.brassD), sideKnob(8.6, 166.5, 1.0, 1.4, 1.2));
  part('chamber', cyl(6.6, 7, 171, M.brass), windowRound(6.6, 175, 0.45, 1.5, M.window), sideKnob(6.6, 174.5, -0.6, 3.5, 2.2), sideKnob(6.6, 174.5, -0.6 + Math.PI, 3.5, 2.2), sideKnob(6.6, 176.5, 1.8, 2.4, 1.4));
  part('condenser', cyl(8.2, 6.5, 178, M.brass), knurl(8.6, 1.2, 178, M.brassD), knurl(8.6, 1.2, 183.3, M.brassD), sideKnob(8.2, 181.5, 2.8, 1.4, 1.2));
  part('cooling', cyl(3.4, 10, 184.5, M.brass), ...[0, 1, 2, 3, 4, 5].map((i) => cyl(6.8, 0.7, 195 + i * 1.6, M.brassD)), cyl(3.6, 10, 194.5, M.brass));
  part('discharge', cyl(2.8, 22, 204.5, M.brass), ring(3.1, 0.5, 210, M.brassD), sideKnob(2.8, 214, 0.9, 2.5, 1.0), ring(3.1, 0.5, 222, M.brassD));
  part('hv', (() => { const g = new THREE.Group(); const prof = []; for (let i = 0; i <= 24; i++) { const a = (i / 24) * Math.PI / 2; prof.push(new THREE.Vector2(Math.max(0.01, 11 * Math.sin(a)), 3.2 * Math.cos(a))); }
    prof.push(new THREE.Vector2(0.01, 0)); const dome = new THREE.Mesh(new THREE.LatheGeometry(prof.reverse(), 64), M.chrome); dome.position.y = 229; g.add(dome);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 4, 24), M.chrome); stem.position.y = 227; g.add(stem); return g; })());
  // inside, seen in the cutaway
  const inner = new THREE.Group(); c33.add(inner);
  const coil = (y, r, h) => { const g = new THREE.Group(); const c = tube(r, h, y, M.copper); g.add(c); const c2 = tube(r * 0.55, h, y, M.copper); g.add(c2);
    const pp1 = new THREE.Mesh(new THREE.CylinderGeometry(1.2, r * 0.5, 1.2, 32, 1, true), M.pole); pp1.position.y = y + h / 2 + 0.5; g.add(pp1);
    const pp2 = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.5, 1.2, 1.2, 32, 1, true), M.pole); pp2.position.y = y + h / 2 - 0.5; g.add(pp2); return g; };
  inner.add(tag(coil(127.5, 7.6, 6), 'projector'), tag(coil(164.5, 7.2, 5.5), 'objective'), tag(coil(179, 6.8, 4.5), 'condenser'));
  const specDisc = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.25, 32), M.hot); specDisc.position.y = 175.5; inner.add(tag(specDisc, 'chamber'));
  const iscreen = new THREE.Mesh(new THREE.RingGeometry(0.35, 4.0, 48), M.phosI); iscreen.rotation.x = -Math.PI / 2; iscreen.position.y = 140; inner.add(tag(iscreen, 'intermediate'));
  const fscreen = new THREE.Mesh(new THREE.CircleGeometry(9.2, 48), M.phos); fscreen.rotation.x = -Math.PI / 2; fscreen.position.y = 100; inner.add(tag(fscreen, 'screen'));
  const cath = new THREE.Mesh(new THREE.SphereGeometry(1.0, 20, 12), M.glow); cath.position.y = 222; inner.add(tag(cath, 'discharge'));
  inner.visible = false;

  // ------------------------------------------------------------------ 1931 tube (schematic)
  const c31 = new THREE.Group(); world.add(c31);
  { const base = new THREE.Mesh(new THREE.BoxGeometry(30, 3, 30), M.iron); base.position.y = 75.5; c31.add(tag(base, 'frame'));
    for (const [x, z] of [[-12, -12], [12, 12]]) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 160, 12), M.iron); r.position.set(x, 155, z); c31.add(tag(r, 'frame')); }
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 104, 40, 1, true), M.glass); glass.position.y = 178; c31.add(tag(glass, 'tube31'));
    const bulb = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 9, 10, 40, 1, true), M.glass); bulb.position.y = 121; c31.add(tag(bulb, 'tube31'));
    const scr = new THREE.Mesh(new THREE.CircleGeometry(9, 48), M.phos); scr.rotation.x = -Math.PI / 2; scr.position.y = 116.2; c31.add(tag(scr, 'screen31'));
    const sb = cyl(9.6, 3, 113, M.brassD); c31.add(tag(sb, 'screen31'));
    const ccap = cyl(3.6, 8, 230, M.brass); c31.add(tag(ccap, 'cathode31'));
    const cg = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 10), M.glow); cg.position.y = 229; c31.add(tag(cg, 'cathode31'));
    const hv31 = new THREE.Mesh(new THREE.SphereGeometry(4.5, 32, 16), M.chrome); hv31.position.y = 241; c31.add(tag(hv31, 'cathode31'));
    const mkCoil = (y) => { const g = new THREE.Group(); for (let i = 0; i < 6; i++) g.add(ring(5.6 + (i % 3) * 0.9, 0.55, y + Math.floor(i / 3) * 1.2 - 0.6, M.copper)); return g; };
    c31.add(tag(mkCoil(193.6), 'coil1'), tag(mkCoil(163.4), 'coil2'));
    const grid = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.2, 24), M.hot); grid.position.y = 200; c31.add(tag(grid, 'grid31'));
    c31.userData.grid = grid; c31.userData.cath = cg; c31.userData.scr = scr; }

  // ------------------------------------------------------------------ beam
  const beamMesh = new THREE.Mesh(new THREE.BufferGeometry(), M.beam); world.add(beamMesh); beamMesh.renderOrder = 5;
  const NP = 260; const ppos = new Float32Array(NP * 3); const pu = new Float32Array(NP), pa = new Float32Array(NP), pr = new Float32Array(NP);
  for (let i = 0; i < NP; i++) { pu[i] = Math.random(); pa[i] = Math.random() * Math.PI * 2; pr[i] = Math.sqrt(Math.random()); }
  const pgeo = new THREE.BufferGeometry(); pgeo.setAttribute('position', new THREE.BufferAttribute(ppos, 3));
  const pmat = new THREE.PointsMaterial({ color: 0xbfeaff, size: 0.9, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const pts = new THREE.Points(pgeo, pmat); world.add(pts); pts.renderOrder = 6;
  let env = [[0, 0]]; // [y, r] from top to bottom
  const envR = (y) => { for (let i = 1; i < env.length; i++) { const [y0, r0] = env[i - 1], [y1, r1] = env[i]; if (y <= y0 && y >= y1) return r0 + ((y - y0) / (y1 - y0 || 1)) * (r1 - r0); } return 0; };
  // flashover bolt
  const boltGeo = new THREE.BufferGeometry(); const bolt = new THREE.Line(boltGeo, new THREE.LineBasicMaterial({ color: 0xdfeeff, transparent: true, opacity: 0, toneMapped: false })); world.add(bolt);

  // ------------------------------------------------------------------ state
  let inst = 1933, cut = false, flashT = 0;
  function setInstrument(y) { inst = y; c33.visible = y === 1933; c31.visible = y === 1931; inner.visible = cut && y === 1933; }
  function setCutaway(b) { cut = b; inner.visible = b && inst === 1933; clipped.forEach((m) => { m.clippingPlanes = b ? [clip] : []; m.needsUpdate = true; }); }
  function setSpin(b) { controls.autoRotate = b && !reduce; }
  function flash() {
    flashT = 1;
    const top = inst === 1933 ? new THREE.Vector3(8, 229, 0) : new THREE.Vector3(3, 241, 0), bot = new THREE.Vector3(24, 93, 22);
    const n = 14, arr = []; for (let i = 0; i <= n; i++) { const t = i / n, p = top.clone().lerp(bot, t); if (i && i < n) p.add(new THREE.Vector3((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 9)); arr.push(p); }
    boltGeo.setFromPoints(arr);
  }

  // v: { on, beam 0..1, kV, rs (µm), Mo, Mp, M, screenGlow 0..1, interGlow, hot 0..1, glowGas 0..1 }
  let V = { on: 0, beam: 0, screenGlow: 0, interGlow: 0, hot: 0, glowGas: 0, rs: 300, Mo: 85, Mp: 100 };
  function update(v) { V = v; }

  function rebuildBeam(t) {
    const on = V.on * V.beam;
    M.beam.opacity = on * (inst === 1931 ? 0.18 : cut ? 0.34 : 0);
    pmat.opacity = on * (inst === 1931 ? 0.7 : cut ? 0.9 : 0);
    if (on <= 0.001) { beamMesh.visible = pts.visible = false; return; }
    beamMesh.visible = pts.visible = true;
    const clampR = (x, a, b) => Math.min(b, Math.max(a, x));
    if (inst === 1933) {
      const rSpec = clampR(0.05 + 1.3 * Math.sqrt(V.rs / 300), 0.05, 1.4);
      const rInt = clampR((V.rs * V.Mo) / 1e4, 0.06, 3.6);
      const hole = Math.min(rInt, 0.035);
      const rScr = clampR((0.03 * V.Mp), 0.08, 8.8) * (hole / 0.035);
      env = [[222, 0.12], [205, 0.6], [181, 1.2], [175.5, rSpec], [167, Math.max(rSpec, 0.8)], [165, 0.08], [140, rInt], [139.9, hole], [128, Math.max(hole, 0.25)], [126.5, 0.05], [100, rScr]];
    } else {
      env = [[229, 0.1], [200, 2.6], [193.6, 2.7], [178, 0.2], [170.6, 0.9], [163.4, 1.0], [150, 0.15], [116.2, 8.4]];
    }
    const pts2 = env.map(([y, r]) => new THREE.Vector2(Math.max(0.02, r), y));
    beamMesh.geometry.dispose(); beamMesh.geometry = new THREE.LatheGeometry(pts2.reverse(), 32);
    const yTop = env[0][0], yBot = env[env.length - 1][0];
    for (let i = 0; i < NP; i++) { pu[i] = (pu[i] + 0.012 * (0.6 + 0.4 * Math.sin(i))) % 1; const y = yTop - pu[i] * (yTop - yBot), r = envR(y) * pr[i];
      ppos[i * 3] = r * Math.cos(pa[i] + t * 0.3); ppos[i * 3 + 1] = y; ppos[i * 3 + 2] = r * Math.sin(pa[i] + t * 0.3); }
    pgeo.attributes.position.needsUpdate = true;
  }

  // ------------------------------------------------------------------ picking
  const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(); let down = null, hoverPart = null;
  const pick = (e) => { const r = renderer.domElement.getBoundingClientRect(); mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(mouse, camera);
    const hits = ray.intersectObjects((inst === 1933 ? [c33, table] : [c31, table]), true).filter((h) => h.object.visible && h.object.userData.part && (!cut || inst !== 1933 || !clipped.includes(h.object.material) || clip.distanceToPoint(h.point) >= 0));
    return hits[0]?.object.userData.part || null; };
  renderer.domElement.addEventListener('pointermove', (e) => { if (e.pointerType === 'touch') return; const p = pick(e); hoverPart = p;
    const L = p && label(p);
    if (L) { const r = stage.getBoundingClientRect(); tip.hidden = false; tip.innerHTML = `<b>${L.title}</b><small>${L.sub || ''}</small>`; tip.style.left = Math.min(r.width - 250, e.clientX - r.left + 14) + 'px'; tip.style.top = e.clientY - r.top + 12 + 'px'; renderer.domElement.style.cursor = 'pointer'; }
    else { tip.hidden = true; renderer.domElement.style.cursor = ''; } });
  renderer.domElement.addEventListener('pointerleave', () => { tip.hidden = true; });
  renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => { if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 5) { const p = pick(e); if (p && label(p)) onPick(p); } down = null; });

  // ------------------------------------------------------------------ loop
  const resize = () => { const w = stage.clientWidth, h = stage.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  new ResizeObserver(resize).observe(stage); resize();
  const cv = new THREE.Vector3(), green = new THREE.Color();
  function frame(t) {
    // cut toward the viewer: keep the half of the column away from the camera
    cv.subVectors(camera.position, controls.target).setY(0).normalize();
    clip.setFromNormalAndCoplanarPoint(cv.clone().negate(), new THREE.Vector3(0, 0, 0));
    const g = Math.min(1, V.on * V.screenGlow);
    green.setRGB(0.04 + 0.5 * g, 0.07 + 1.1 * g, 0.03 + 0.4 * g); M.phos.color.copy(green);
    M.window.emissive.setRGB(0.2 * g, 0.6 * g, 0.16 * g);
    const gi = Math.min(1, V.on * V.interGlow); M.phosI.color.setRGB(0.04 + 0.5 * gi, 0.07 + 1.1 * gi, 0.03 + 0.4 * gi);
    M.hot.emissive.setRGB(1.4 * V.hot, 0.45 * V.hot ** 1.6, 0.08 * V.hot ** 3);
    M.glow.opacity = Math.min(1, V.glowGas) * (0.6 + 0.4 * Math.random());
    rebuildBeam(t / 1000);
    if (flashT > 0) { flashL.intensity = 60000 * flashT * (0.5 + Math.random()); bolt.material.opacity = flashT > 0.3 ? 1 : flashT * 3; flashT = Math.max(0, flashT - 0.06); } else { flashL.intensity = 0; bolt.material.opacity = 0; }
    controls.update(); renderer.render(scene, camera);
  }
  setInstrument(1933);
  return { frame, update, setInstrument, setCutaway, setSpin, flash };
}
