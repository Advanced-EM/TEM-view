// The three instruments in 3D, schematic: von Ardenne's 1938 column with its film drum, Crewe's 1970 UHV
// column with its field-emission gun, and the 2002 VG HB501, built upside down: gun in the base, beam going UP
// through the corrector to the specimen and the detectors on top. Units: cm. The beam follows the live optics.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export function createScene(stage, { onPick, label }) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const tip = stage.querySelector('#tip');
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.localClippingEnabled = true;
  stage.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(renderer), 0.04).texture;
  scene.add(new THREE.HemisphereLight(0xe8f0ff, 0x1a1f26, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(150, 300, 180); scene.add(key);
  const rim = new THREE.DirectionalLight(0x8fd0ff, 0.8); rim.position.set(-200, 160, -220); scene.add(rim);

  const camera = new THREE.PerspectiveCamera(30, 1, 5, 3000);
  camera.position.set(190, 210, 280);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 140, 0);
  Object.assign(controls, { enableDamping: true, enablePan: false, minDistance: 120, maxDistance: 560, minPolarAngle: 0.15, maxPolarAngle: Math.PI * 0.85, autoRotate: !reduce, autoRotateSpeed: 0.5 });
  controls.addEventListener('start', () => renderer.domElement.classList.add('grab'));
  controls.addEventListener('end', () => renderer.domElement.classList.remove('grab'));

  const clip = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
  const std = (color, metalness = 0.6, roughness = 0.4) => new THREE.MeshStandardMaterial({ color, metalness, roughness, side: THREE.DoubleSide });
  const M = {
    enamel: std(0x2b2f2a, 0.3, 0.55), brass: std(0xc89a46, 0.92, 0.3), steel: std(0xc7ccd2, 0.95, 0.22), steelD: std(0x8d949c, 0.9, 0.35),
    grey: std(0xa7adb3, 0.15, 0.6), greyD: std(0x5d646c, 0.25, 0.55), copper: std(0xb4602e, 0.85, 0.35), black: std(0x16181b, 0.4, 0.6),
    blue: std(0x2c5a8c, 0.3, 0.5), glass: new THREE.MeshPhysicalMaterial({ color: 0xcfe3e8, roughness: 0.05, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide }),
    film: std(0x6b4a1e, 0.1, 0.7), tipM: new THREE.MeshBasicMaterial({ color: 0xffe8b0, transparent: true, opacity: 0, toneMapped: false }),
    beam: new THREE.MeshBasicMaterial({ color: 0x7fd2ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
  };
  const clipped = [M.enamel, M.steel, M.steelD, M.grey, M.greyD];
  const tag = (o, part) => { o.traverse((m) => { if (m.isMesh) m.userData.part = part; }); return o; };
  const cyl = (r, h, y, mat, seg = 40, r2 = r) => { const g = new THREE.Group(); const m = new THREE.Mesh(new THREE.CylinderGeometry(r2, r, h, seg, 1, true), mat); m.position.y = y + h / 2; g.add(m);
    for (const [yy, rr, s] of [[y + h, r2, -1], [y, r, 1]]) { const c = new THREE.Mesh(new THREE.RingGeometry(0, rr, seg), mat); c.rotation.x = (s * Math.PI) / 2; c.position.y = yy; g.add(c); } return g; };
  const box = (w, h, d, y, mat, x = 0, z = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y + h / 2, z); return m; };
  const ring = (r, t, y, mat) => { const m = new THREE.Mesh(new THREE.TorusGeometry(r, t, 12, 48), mat); m.rotation.x = Math.PI / 2; m.position.y = y; return m; };
  const world = new THREE.Group(); scene.add(world);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(160, 64), new THREE.MeshStandardMaterial({ color: 0x0c0e11, roughness: 0.95 })); floor.rotation.x = -Math.PI / 2; world.add(floor);

  // ------------------------------------------------------------------ 1938
  const a38 = new THREE.Group(); world.add(a38);
  { const P = (n, ...o) => { const g = new THREE.Group(); o.forEach((x) => g.add(x)); a38.add(tag(g, n)); };
    P('bench', box(80, 6, 60, 70, M.black), ...[[-34, -24], [34, -24], [-34, 24], [34, 24]].map(([x, z]) => box(5, 70, 5, 0, M.black, x, z)));
    // the film drum: a brass cylinder carrying the film, turned in step with the scan
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 34, 40), M.brass); drum.rotation.x = Math.PI / 2; drum.position.set(0, 89, 0);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.2, 34.2, 1.2), M.film); stripe.position.set(9, 0, 0); drum.add(stripe);
    P('drum', box(40, 26, 30, 76, M.enamel), drum);
    a38.userData.drum = drum;
    P('detector38', cyl(6, 8, 102, M.enamel), ring(6.3, 0.5, 106, M.brass));
    P('specimen38', cyl(9, 8, 110, M.enamel), ring(9.3, 0.6, 114, M.brass), box(10, 3, 3, 113, M.brass, 12, 0));
    P('lens38b', cyl(13, 12, 118, M.enamel), ring(13.3, 0.7, 118.5, M.brass), ring(13.3, 0.7, 129.5, M.brass));
    P('column38', cyl(5, 30, 130, M.enamel));
    P('lens38a', cyl(12, 11, 160, M.enamel), ring(12.3, 0.7, 160.5, M.brass), ring(12.3, 0.7, 170.5, M.brass));
    P('gun38', cyl(6, 22, 171, M.enamel), cyl(10, 4, 193, M.brass), (() => { const s = new THREE.Mesh(new THREE.SphereGeometry(7, 24, 16), M.steel); s.position.y = 202; return s; })());
    const fil = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8), M.tipM); fil.position.y = 186; a38.add(tag(fil, 'gun38')); a38.userData.tip = fil;
    a38.userData.beam = { top: 186, bot: 104, spec: 113, dir: -1 };
  }

  // ------------------------------------------------------------------ 1970
  const c70 = new THREE.Group(); world.add(c70);
  { const P = (n, ...o) => { const g = new THREE.Group(); o.forEach((x) => g.add(x)); c70.add(tag(g, n)); };
    P('stand70', box(70, 70, 60, 0, M.greyD), box(74, 3, 64, 70, M.steelD));
    P('spectrometer70', box(26, 18, 18, 73, M.steelD, 0, 0), (() => { const t = new THREE.Mesh(new THREE.TorusGeometry(10, 2.4, 12, 32, Math.PI / 2), M.copper); t.position.set(0, 86, 9); return t; })());
    P('detector70', cyl(10, 7, 95, M.steel), ring(10.3, 0.5, 98, M.steelD));
    P('specimen70', cyl(12, 10, 102, M.steel), box(18, 4, 4, 106, M.steelD, 16, 0), (() => { const w = new THREE.Mesh(new THREE.CircleGeometry(3, 24), M.glass); w.position.set(0, 107, 12.1); return w; })());
    P('lens70', cyl(15, 12, 112, M.steel), ring(15.3, 0.6, 118, M.steelD));
    P('column70', cyl(6, 26, 124, M.steel), ...[0, 1].map((i) => box(18, 22, 18, 128, M.blue, i ? 26 : -26, 0)));
    P('gun70', cyl(9, 26, 150, M.steel), ring(9.4, 0.8, 162, M.steelD), (() => { const s = new THREE.Mesh(new THREE.SphereGeometry(10, 28, 18), M.steel); s.position.y = 182; return s; })(), box(16, 18, 16, 170, M.blue, 0, -20));
    const t = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 8), M.tipM); t.position.y = 172; c70.add(tag(t, 'gun70')); c70.userData.tip = t;
    c70.userData.beam = { top: 172, bot: 96, spec: 107, dir: -1 };
  }

  // ------------------------------------------------------------------ 2002: the VG HB501, upside down
  const h02 = new THREE.Group(); world.add(h02);
  { const P = (n, ...o) => { const g = new THREE.Group(); o.forEach((x) => g.add(x)); h02.add(tag(g, n)); };
    P('cabinet02', box(80, 64, 64, 0, M.grey), box(84, 3, 68, 64, M.greyD));
    P('gun02', cyl(12, 22, 67, M.grey), ring(12.4, 0.8, 78, M.greyD), box(16, 18, 16, 70, M.blue, 0, -24));
    P('condenser02', cyl(16, 14, 89, M.grey), ring(16.3, 0.7, 96, M.greyD));
    P('corrector02', ...[0, 1, 2, 3, 4].map((i) => cyl(14 - (i % 2) * 1.5, 5, 103 + i * 5.5, i % 2 ? M.greyD : M.steel)), ring(14.4, 0.8, 130, M.greyD));
    P('objective02', cyl(18, 13, 131, M.grey), box(22, 5, 5, 138, M.steelD, 22, 0));
    P('specimen02', cyl(10, 6, 144, M.steel));
    P('detector02', cyl(13, 8, 150, M.grey), ring(13.3, 0.6, 154, M.greyD));
    P('eels02', cyl(9, 16, 158, M.steelD), box(30, 18, 22, 174, M.grey, 6, 0), (() => { const t = new THREE.Mesh(new THREE.TorusGeometry(12, 3, 12, 32, Math.PI / 2), M.copper); t.rotation.z = Math.PI / 2; t.position.set(0, 186, 0); return t; })());
    const t = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 8), M.tipM); t.position.y = 76; h02.add(tag(t, 'gun02')); h02.userData.tip = t;
    h02.userData.beam = { top: 76, bot: 156, spec: 147, dir: 1 };
  }
  const GROUPS = { 1938: a38, 1970: c70, 2002: h02 };

  // ------------------------------------------------------------------ the beam: a cone to the probe and on to the detector
  const beamMesh = new THREE.Mesh(new THREE.BufferGeometry(), M.beam); world.add(beamMesh);
  let era = 1938, cut = false;
  let V = { on: 0, alpha: 10, scan: 0, tip: 0, drum: 0 };
  function setEra(y) { era = y; for (const k in GROUPS) GROUPS[k].visible = +k === y; }
  function setCutaway(b) { cut = b; clipped.forEach((m) => { m.clippingPlanes = b ? [clip] : []; m.needsUpdate = true; }); }
  function setSpin(b) { controls.autoRotate = b && !reduce; }
  function update(v) { V = v; }
  function rebuildBeam() {
    const g = GROUPS[era], b = g.userData.beam;
    M.beam.opacity = V.on * (cut ? 0.32 : 0.1);
    if (!V.on) { beamMesh.visible = false; return; }
    beamMesh.visible = true;
    const r0 = 0.8, rSpec = 0.08, cone = Math.min(4, 0.25 + V.alpha * 0.12), sx = (V.scan - 0.5) * 1.6;
    const ys = b.dir < 0 ? [b.top, b.spec + 12, b.spec, b.bot] : [b.top, b.spec - 12, b.spec, b.bot];
    const prof = [[ys[0], r0], [ys[1], cone], [ys[2], rSpec], [ys[3], cone * 1.6]];
    const pts = prof.map(([y, r]) => new THREE.Vector2(Math.max(0.03, r), y));
    if (b.dir < 0) pts.reverse();
    beamMesh.geometry.dispose(); beamMesh.geometry = new THREE.LatheGeometry(pts, 24); beamMesh.position.x = sx * 0.3;
  }

  // ------------------------------------------------------------------ picking
  const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(); let down = null;
  const pick = (e) => { const r = renderer.domElement.getBoundingClientRect(); mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(mouse, camera);
    const hits = ray.intersectObject(GROUPS[era], true).filter((h) => h.object.visible && h.object.userData.part && (!cut || !clipped.includes(h.object.material) || clip.distanceToPoint(h.point) >= 0));
    return hits[0]?.object.userData.part || null; };
  renderer.domElement.addEventListener('pointermove', (e) => { if (e.pointerType === 'touch') return; const p = pick(e), L = p && label(p);
    if (L) { const r = stage.getBoundingClientRect(); tip.hidden = false; tip.innerHTML = `<b>${L.title}</b><small>${L.sub || ''}</small>`; tip.style.left = Math.min(r.width - 250, e.clientX - r.left + 14) + 'px'; tip.style.top = e.clientY - r.top + 12 + 'px'; renderer.domElement.style.cursor = 'pointer'; }
    else { tip.hidden = true; renderer.domElement.style.cursor = ''; } });
  renderer.domElement.addEventListener('pointerleave', () => { tip.hidden = true; });
  renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => { if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 5) { const p = pick(e); if (p && label(p)) onPick(p); } down = null; });

  const resize = () => { const w = stage.clientWidth, h = stage.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  new ResizeObserver(resize).observe(stage); resize();
  const cv = new THREE.Vector3();
  function frame() {
    cv.subVectors(camera.position, controls.target).setY(0).normalize();
    clip.setFromNormalAndCoplanarPoint(cv.clone().negate(), new THREE.Vector3(0, 0, 0));
    const g = GROUPS[era];
    M.tipM.opacity = Math.min(1, V.tip) * (0.75 + 0.25 * Math.random());
    if (era === 1938 && g.userData.drum) g.userData.drum.rotation.set(Math.PI / 2, V.drum * Math.PI * 2, 0);
    rebuildBeam();
    controls.update(); renderer.render(scene, camera);
  }
  setEra(1938);
  return { frame, update, setEra, setCutaway, setSpin };
}
