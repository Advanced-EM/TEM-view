// The 3D cutaway microscope column, electron beam and flying electrons.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as P from './physics.js';
import { AP_MRAD } from './sim.js';

export const Y = {
  tank: 6.2, gun: 5.3, anode: 4.8, c1: 3.8, c2: 2.95, cap: 2.45, scan: 1.9, objTop: 1.28, spec: 0.78, objBot: 0.28,
  bfp: -0.08, sa: -0.72, int: -1.45, proj: -2.35, adf: -3.1, bfdet: -3.45, screen: -3.72, cam: -3.95, prism: -4.45,
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const LAM200 = P.wavelength(200);

// ------------------------------------------------------------------ materials
function makeMaterials() {
  const iron = new THREE.MeshStandardMaterial({ color: 0x272c33, metalness: 0.85, roughness: 0.4, side: THREE.DoubleSide, envMapIntensity: 0.45 });
  const cut = new THREE.MeshStandardMaterial({ color: 0x6f7883, metalness: 0.7, roughness: 0.48, side: THREE.DoubleSide, envMapIntensity: 0.4 });
  const copper = new THREE.MeshStandardMaterial({ color: 0xb36d3a, metalness: 0.9, roughness: 0.34, side: THREE.DoubleSide, envMapIntensity: 0.55 });
  const coilTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d');
    x.fillStyle = '#5a2e14'; x.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      const g = x.createRadialGradient(8 + i * 16 - 2, 8 + j * 16 - 2, 1, 8 + i * 16, 8 + j * 16, 7.5);
      g.addColorStop(0, '#f2b27a'); g.addColorStop(0.6, '#b8693a'); g.addColorStop(1, '#4a220c');
      x.fillStyle = g; x.beginPath(); x.arc(8 + i * 16, 8 + j * 16, 7.2, 0, 7); x.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(9, 9); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const coilCut = new THREE.MeshStandardMaterial({ map: coilTex, metalness: 0.5, roughness: 0.45, side: THREE.DoubleSide, envMapIntensity: 0.4 });
  const ceramic = new THREE.MeshStandardMaterial({ color: 0xbdb7ab, metalness: 0, roughness: 0.6, side: THREE.DoubleSide, envMapIntensity: 0.35 });
  const plat = new THREE.MeshStandardMaterial({ color: 0xa9aeb5, metalness: 1, roughness: 0.28, side: THREE.DoubleSide, envMapIntensity: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x14171c, metalness: 0.5, roughness: 0.6, side: THREE.DoubleSide });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x9fdcff, metalness: 0, roughness: 0.08, transparent: true, opacity: 0.035, depthWrite: false, side: THREE.DoubleSide });
  return { iron, cut, copper, coilCut, ceramic, plat, dark, glass };
}

// Half-lathe (back half, z ≤ 0) of a closed cross-section plus flat section caps on the cut plane.
function halfSolid(pts, mat, capMat, seg = 56) {
  const g = new THREE.Group();
  const v = pts.map((p) => new THREE.Vector2(p[0], p[1]));
  v.push(v[0].clone());
  const lathe = new THREE.Mesh(new THREE.LatheGeometry(v, seg, Math.PI / 2, Math.PI), mat);
  g.add(lathe);
  const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p[0], p[1])));
  const cg = new THREE.ShapeGeometry(shape);
  const c1 = new THREE.Mesh(cg, capMat);
  const c2 = new THREE.Mesh(cg, capMat);
  c2.scale.x = -1;
  g.add(c1, c2);
  return g;
}
function rectPts(r0, r1, y0, y1) { return [[r0, y0], [r1, y0], [r1, y1], [r0, y1]]; }

function lens(M, yc, rIn, rOut, h, gap) {
  const t = 0.1, g = new THREE.Group();
  const yoke = [
    [rIn, yc + gap / 2], [rIn + 0.06, yc + h / 2], [rOut, yc + h / 2], [rOut, yc - h / 2], [rIn + 0.06, yc - h / 2], [rIn, yc - gap / 2],
    [rIn + t, yc - gap / 2], [rIn + t + 0.09, yc - h / 2 + t], [rOut - t, yc - h / 2 + t], [rOut - t, yc + h / 2 - t], [rIn + t + 0.09, yc + h / 2 - t], [rIn + t, yc + gap / 2],
  ];
  g.add(halfSolid(yoke, M.iron, M.cut));
  g.add(halfSolid(rectPts(rIn + t + 0.14, rOut - t - 0.03, yc - h / 2 + t + 0.03, yc + h / 2 - t - 0.03), M.copper, M.coilCut));
  return g;
}

function platePieces(M, y, holeR) {
  const plate = halfSolid(rectPts(Math.max(0.01, holeR), 0.5, y - 0.012, y + 0.012), M.plat, M.plat, 40);
  const front = new THREE.Mesh(new THREE.RingGeometry(Math.max(0.01, holeR), 0.5, 40, 1, 0, Math.PI), M.plat);
  front.rotation.x = Math.PI / 2;
  front.position.y = y + 0.012;
  return { plate, front };
}
function aperturePlate(M, y, holeR, side = 1) {
  const g = new THREE.Group();
  const { plate, front } = platePieces(M, y, holeR);
  g.add(plate, front);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.2, 12), M.plat);
  rod.rotation.z = Math.PI / 2;
  rod.position.set(side * 1.55, y, -0.02);
  g.add(rod);
  g.userData.plate = plate; g.userData.front = front;
  return g;
}

// ------------------------------------------------------------------ beams
const BEAM_VS = `
attribute float aI; attribute float aS;
varying float vI; varying float vS; varying vec3 vN; varying vec3 vV;
void main(){
  vI = aI; vS = aS;
  vec4 wp = modelMatrix * vec4(position,1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const BEAM_FS = `
uniform vec3 uColor; uniform float uOpacity; uniform float uTime; uniform float uFlow;
varying float vI; varying float vS; varying vec3 vN; varying vec3 vV;
void main(){
  float f = abs(dot(normalize(vN), normalize(vV)));
  float a = uOpacity * vI * (0.06 + 0.94 * pow(f, 2.2));
  a *= 0.78 + 0.22 * sin(vS * 90.0 - uTime * uFlow);
  gl_FragColor = vec4(uColor, a);
}`;

const SEG = 26, RINGS = 150;
class Beam {
  constructor(group) {
    const nv = RINGS * (SEG + 1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
    geo.setAttribute('aI', new THREE.BufferAttribute(new Float32Array(nv), 1));
    geo.setAttribute('aS', new THREE.BufferAttribute(new Float32Array(nv), 1));
    const idx = [];
    for (let i = 0; i < RINGS - 1; i++)
      for (let j = 0; j < SEG; j++) {
        const a = i * (SEG + 1) + j, b = a + SEG + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    geo.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: BEAM_VS, fragmentShader: BEAM_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color() }, uOpacity: { value: 0 }, uTime: { value: 0 }, uFlow: { value: 6 } },
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    group.add(this.mesh);
    this.cx = new Float32Array(RINGS); this.cy = new Float32Array(RINGS); this.cz = new Float32Array(RINGS); this.r = new Float32Array(RINGS);
    this.nx = new Float32Array(RINGS * 3); this.bx = new Float32Array(RINGS * 3);
    this.len = 1;
  }
  // keys: [[x,y,z,r], ...] polyline, resampled uniformly by arc length.
  set(keys, color, intensity = 1) {
    const L = [0];
    for (let i = 1; i < keys.length; i++) L.push(L[i - 1] + Math.hypot(keys[i][0] - keys[i - 1][0], keys[i][1] - keys[i - 1][1], keys[i][2] - keys[i - 1][2]));
    const tot = L[L.length - 1] || 1;
    this.len = tot;
    let k = 0;
    for (let i = 0; i < RINGS; i++) {
      const s = (i / (RINGS - 1)) * tot;
      while (k < keys.length - 2 && L[k + 1] < s) k++;
      const f = clamp((s - L[k]) / (L[k + 1] - L[k] || 1), 0, 1);
      const a = keys[k], b = keys[k + 1];
      this.cx[i] = lerp(a[0], b[0], f); this.cy[i] = lerp(a[1], b[1], f); this.cz[i] = lerp(a[2], b[2], f); this.r[i] = lerp(a[3], b[3], f);
    }
    const pos = this.mesh.geometry.attributes.position.array, nor = this.mesh.geometry.attributes.normal.array;
    const aI = this.mesh.geometry.attributes.aI.array, aS = this.mesh.geometry.attributes.aS.array;
    for (let i = 0; i < RINGS; i++) {
      const i0 = Math.max(0, i - 1), i1 = Math.min(RINGS - 1, i + 1);
      let tx = this.cx[i1] - this.cx[i0], ty = this.cy[i1] - this.cy[i0], tz = this.cz[i1] - this.cz[i0];
      const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      // N = T × ẑ, B = T × N
      let nx = ty, ny = -tx, nz = 0;
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl;
      const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
      this.nx.set([nx, ny, nz], i * 3); this.bx.set([bx, by, bz], i * 3);
      const rr = Math.max(0.004, Math.abs(this.r[i]));
      const I = clamp(0.06 / (rr + 0.035), 0.22, 1.9) * intensity;
      for (let j = 0; j <= SEG; j++) {
        const ph = (j / SEG) * Math.PI * 2, c = Math.cos(ph), s = Math.sin(ph);
        const ox = nx * c + bx * s, oy = ny * c + by * s, oz = nz * c + bz * s;
        const v = i * (SEG + 1) + j;
        pos[v * 3] = this.cx[i] + ox * rr; pos[v * 3 + 1] = this.cy[i] + oy * rr; pos[v * 3 + 2] = this.cz[i] + oz * rr;
        nor[v * 3] = ox; nor[v * 3 + 1] = oy; nor[v * 3 + 2] = oz;
        aI[v] = I; aS[v] = i / (RINGS - 1) * tot;
      }
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = g.attributes.normal.needsUpdate = g.attributes.aI.needsUpdate = g.attributes.aS.needsUpdate = true;
    this.mat.uniforms.uColor.value.set(color);
  }
  // point on beam at fraction s, radial fraction u, angle phi
  sample(s, u, ph, out) {
    const f = clamp(s, 0, 1) * (RINGS - 1), i = Math.min(RINGS - 2, Math.floor(f)), t = f - i;
    const cx = lerp(this.cx[i], this.cx[i + 1], t), cy = lerp(this.cy[i], this.cy[i + 1], t), cz = lerp(this.cz[i], this.cz[i + 1], t);
    const r = lerp(this.r[i], this.r[i + 1], t) * u, c = Math.cos(ph), sn = Math.sin(ph);
    const n = this.nx, b = this.bx, k = i * 3;
    out[0] = cx + r * (n[k] * c + b[k] * sn); out[1] = cy + r * (n[k + 1] * c + b[k + 1] * sn); out[2] = cz + r * (n[k + 2] * c + b[k + 2] * sn);
  }
}

// ------------------------------------------------------------------ scene
export class Scene3D {
  constructor(canvas, labelLayer) {
    this.canvas = canvas;
    this.labelLayer = labelLayer;
    const R = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }));
    R.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    R.toneMapping = THREE.ACESFilmicToneMapping;
    R.toneMappingExposure = 0.95;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050608);
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 160);
    this.home = { pos: new THREE.Vector3(14.2, 5.2, 27.2), target: new THREE.Vector3(0, 1.35, 0) };
    this.camera.position.copy(this.home.pos);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.copy(this.home.target);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.minDistance = 2.2;
    this.controls.maxDistance = 45;
    this.controls.autoRotateSpeed = 0.6;
    const pm = new THREE.PMREMGenerator(R);
    this.scene.environment = pm.fromScene(new RoomEnvironment(R), 0.04).texture;

    this.scene.add(new THREE.AmbientLight(0x8899aa, 0.25));
    const key = new THREE.DirectionalLight(0xffffff, 1.0);
    key.position.set(6, 9, 8);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x6fd6ff, 0.7);
    rim.position.set(-6, 2, -5);
    this.scene.add(rim);
    this.beamLight = new THREE.PointLight(0x3dff7a, 3, 4, 2);
    this.scene.add(this.beamLight);

    this.composer = new EffectComposer(R);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.8, 0.5, 0.5);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.M = makeMaterials();
    this.anim = { screenLift: 0, adf: 0, bf: 0, cam: 0, prism: 0, objAp: 0.2, objApX: 0, sa: 0.3, fade: 0, eds: 0 };
    this.buildColumn();
    this.beamGroups = [new THREE.Group(), new THREE.Group()];
    this.beamGroups.forEach((g) => this.scene.add(g));
    this.beamSets = [[], []];
    this.active = 0;
    this.buildParticles();
    this.buildLabels();
    this.time = 0;
    this.tour = null;
    this.viewOffset = { left: 0, right: 0, bottom: 0, top: 0 };
    canvas.addEventListener('pointerdown', () => { if (this.tour) this.stopTour(); });
  }

  buildColumn() {
    const M = this.M, S = this.scene, col = (this.column = new THREE.Group());
    S.add(col);
    // HV tank with ceramic insulator stack
    col.add(halfSolid([[0.3, 5.75], [1.05, 5.75], [1.05, 6.9], [0.3, 6.9]], M.iron, M.cut));
    for (let i = 0; i < 7; i++) {
      const y = 5.85 + i * 0.14;
      col.add(halfSolid([[0.18, y], [0.36, y], [0.36, y + 0.09], [0.18, y + 0.09]], M.ceramic, M.ceramic, 40));
    }
    // Wehnelt + tip
    col.add(halfSolid([[0.08, 5.3], [0.36, 5.3], [0.36, 5.65], [0.3, 5.65], [0.3, 5.36], [0.08, 5.36]], M.plat, M.cut));
    this.tipMat = new THREE.MeshBasicMaterial({ color: 0xc8ffd6 });
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.22, 16), this.tipMat);
    tip.rotation.x = Math.PI; tip.position.y = 5.44;
    col.add(tip);
    this.tipGlow = this.sprite(0x8dffae, 0.9);
    this.tipGlow.position.set(0, 5.32, 0);
    col.add(this.tipGlow);
    // anode + accelerator
    col.add(halfSolid([[0.06, Y.anode - 0.03], [0.62, Y.anode - 0.03], [0.62, Y.anode + 0.05], [0.06, Y.anode + 0.05]], M.plat, M.cut));
    for (let i = 0; i < 3; i++) col.add(halfSolid(rectPts(0.3, 0.7, 4.3 - i * 0.18, 4.36 - i * 0.18), M.plat, M.cut, 40));
    // column wall
    col.add(halfSolid([[0.46, -3.0], [0.5, -3.0], [0.5, 5.75], [0.46, 5.75]], M.dark, M.cut));
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 10.6, 64, 1, true, -Math.PI / 2, Math.PI), M.glass);
    shell.position.y = 1.2;
    col.add(shell);
    this.shell = shell;
    // lenses
    col.add(lens(M, Y.c1, 0.42, 1.18, 0.62, 0.12));
    col.add(lens(M, Y.c2, 0.42, 1.18, 0.62, 0.12));
    col.add(lens(M, Y.objTop - 0.02 - 0.36, 0.26, 1.6, 1.58, 0.36));
    col.add(lens(M, Y.int, 0.42, 1.12, 0.6, 0.12));
    col.add(lens(M, Y.proj, 0.42, 1.12, 0.6, 0.12));
    // condenser aperture
    col.add(aperturePlate(M, Y.cap, 0.19, -1));
    // scan coils
    this.scanCoils = new THREE.Group();
    for (const dy of [0.12, -0.12]) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.035, 12, 48, Math.PI), M.copper);
      t.rotation.x = -Math.PI / 2; t.position.y = Y.scan + dy;
      this.scanCoils.add(t);
    }
    col.add(this.scanCoils);
    // specimen holder
    this.holder = new THREE.Group();
    this.holder.position.y = Y.spec;
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 3.4, 20), M.plat);
    rod.rotation.z = Math.PI / 2; rod.position.x = 1.95;
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.5, 24), M.iron);
    knob.rotation.z = Math.PI / 2; knob.position.x = 3.85;
    this.gridTex = this.makeGridTexture();
    const disk = new THREE.Mesh(new THREE.CircleGeometry(0.2, 48), new THREE.MeshStandardMaterial({ map: this.gridTex, metalness: 0.7, roughness: 0.35, side: THREE.DoubleSide, emissive: 0x331a0a, emissiveIntensity: 0.3 }));
    disk.rotation.x = -Math.PI / 2;
    const cup = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.03, 10, 40), M.plat);
    cup.rotation.x = -Math.PI / 2;
    this.holder.add(rod, knob, disk, cup);
    col.add(this.holder);
    this.specGlow = this.sprite(0x8dffae, 0.5);
    col.add(this.specGlow);
    // EDS detector
    this.eds = new THREE.Group();
    const edsBody = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 2.2, 28), M.iron);
    edsBody.position.y = 1.1;
    this.edsWinMat = new THREE.MeshBasicMaterial({ color: 0x3a2a14 });
    const win = new THREE.Mesh(new THREE.CircleGeometry(0.13, 28), this.edsWinMat);
    win.rotation.x = Math.PI / 2; win.position.y = -0.005;
    this.eds.add(edsBody, win);
    this.eds.position.set(-0.55, Y.spec + 0.22, -0.35);
    this.eds.lookAt(new THREE.Vector3(-3.2, Y.spec + 1.5, -1.9));
    this.eds.rotateX(Math.PI / 2);
    col.add(this.eds);
    // apertures
    this.objAp = aperturePlate(M, Y.bfp, 0.2, -1);
    this.saAp = aperturePlate(M, Y.sa, 0.3, 1);
    col.add(this.objAp, this.saAp);
    // viewing chamber
    col.add(halfSolid([[1.45, -4.1], [1.6, -4.1], [1.6, -2.85], [1.45, -2.85]], M.iron, M.cut));
    col.add(halfSolid([[0.5, -2.9], [1.6, -2.9], [1.6, -2.82], [0.5, -2.82]], M.iron, M.cut));
    col.add(halfSolid([[0.3, -4.12], [1.6, -4.12], [1.6, -4.04], [0.3, -4.04]], M.iron, M.cut));
    // fluorescent screen (hinged at the back so it can lift out of the way for STEM)
    this.screenCanvas = null;
    this.screenTex = new THREE.CanvasTexture(document.createElement('canvas'));
    this.screenTex.colorSpace = THREE.SRGBColorSpace;
    this.screenPivot = new THREE.Group();
    this.screenPivot.position.set(0, Y.screen, -1.25);
    this.screenMat = new THREE.MeshBasicMaterial({ map: this.screenTex, toneMapped: false, color: 0xffffff, side: THREE.DoubleSide });
    const scr = new THREE.Mesh(new THREE.CircleGeometry(1.2, 64), this.screenMat);
    scr.rotation.x = -Math.PI / 2; scr.position.z = 1.25;
    const rimRing = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.025, 8, 64), M.plat);
    rimRing.rotation.x = -Math.PI / 2; rimRing.position.z = 1.25;
    this.screenPivot.add(scr, rimRing);
    col.add(this.screenPivot);
    // ADF (annular) + BF detectors
    this.adfMat = new THREE.MeshStandardMaterial({ color: 0x3a4250, metalness: 0.6, roughness: 0.35, emissive: 0xffb45e, emissiveIntensity: 0, side: THREE.DoubleSide });
    this.adf = new THREE.Mesh(new THREE.RingGeometry(0.45, 1.0, 64), this.adfMat);
    this.adf.rotation.x = -Math.PI / 2;
    this.bfMat = new THREE.MeshStandardMaterial({ color: 0x3a4250, metalness: 0.6, roughness: 0.35, emissive: 0x6fd6ff, emissiveIntensity: 0, side: THREE.DoubleSide });
    this.bf = new THREE.Mesh(new THREE.CircleGeometry(0.32, 48), this.bfMat);
    this.bf.rotation.x = -Math.PI / 2;
    col.add(this.adf, this.bf);
    // pixelated camera for 4D-STEM
    this.camTex = new THREE.CanvasTexture(document.createElement('canvas'));
    this.camTex.colorSpace = THREE.SRGBColorSpace;
    this.camMat = new THREE.MeshBasicMaterial({ map: this.camTex, toneMapped: false, side: THREE.DoubleSide });
    this.pixCam = new THREE.Group();
    const pc = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), this.camMat);
    pc.rotation.x = -Math.PI / 2;
    const pcBody = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.12, 1.3), M.iron);
    pcBody.position.y = -0.07;
    this.pixCam.add(pc, pcBody);
    col.add(this.pixCam);
    // EELS spectrometer
    this.spectro = new THREE.Group();
    // magnet sector below/left of its bending centre (0.72, prism), behind the beam plane
    const sector = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.3, 40, 1, false, -Math.PI / 2, Math.PI / 2), M.iron);
    sector.rotation.x = Math.PI / 2;
    sector.position.set(0.72, Y.prism + 0.02, -0.22);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.06, 40, 1, false, -Math.PI / 2, Math.PI / 2), M.copper);
    pole.rotation.x = Math.PI / 2;
    pole.position.set(0.72, Y.prism + 0.02, -0.05);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.75, 0.4), new THREE.MeshBasicMaterial({ color: 0x3a2a14 }));
    slab.position.set(2.43, Y.prism - 0.62, 0);
    this.slabMat = slab.material;
    this.specTex = new THREE.CanvasTexture(document.createElement('canvas'));
    this.specTex.colorSpace = THREE.SRGBColorSpace;
    this.specScreen = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.62), new THREE.MeshBasicMaterial({ map: this.specTex, toneMapped: false, side: THREE.DoubleSide }));
    this.specScreen.position.set(3.55, Y.prism - 0.62, 0);
    this.spectro.add(sector, pole, slab, this.specScreen);
    col.add(this.spectro);
    // floor reflection disk
    const floor = new THREE.Mesh(new THREE.CircleGeometry(9, 64), new THREE.MeshStandardMaterial({ color: 0x07080a, metalness: 0.4, roughness: 0.75 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -5.4;
    S.add(floor);
    // X-ray photons
    this.xrays = this.makePoints(140, 0xffb45e);
    S.add(this.xrays.pts);
  }

  sprite(color, scale) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    s.scale.setScalar(scale);
    return s;
  }

  makeGridTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const x = c.getContext('2d');
    x.fillStyle = '#0c0907'; x.fillRect(0, 0, 256, 256);
    x.strokeStyle = '#c47a45'; x.lineWidth = 7;
    for (let i = 8; i < 256; i += 26) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 256); x.stroke(); x.beginPath(); x.moveTo(0, i); x.lineTo(256, i); x.stroke(); }
    x.lineWidth = 22; x.beginPath(); x.arc(128, 128, 118, 0, 7); x.stroke();
    x.fillStyle = 'rgba(160,200,230,0.18)'; x.fillRect(34, 34, 188, 188);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  makePoints(n, color) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('size', new THREE.BufferAttribute(new Float32Array(n), 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uPR: { value: this.renderer.getPixelRatio() } },
      vertexShader: `attribute vec3 color; attribute float size; varying vec3 vC; uniform float uPR;
        void main(){ vC=color; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=size*uPR*(300.0/-mv.z); gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `varying vec3 vC; void main(){ vec2 d=gl_PointCoord-0.5; float r=length(d); float a=smoothstep(0.5,0.0,r); a*=a; gl_FragColor=vec4(vC,a); }`,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    const col = new THREE.Color(color);
    const cArr = geo.attributes.color.array;
    for (let i = 0; i < n; i++) { cArr[i * 3] = col.r; cArr[i * 3 + 1] = col.g; cArr[i * 3 + 2] = col.b; }
    return { pts, n, state: Array.from({ length: n }, () => ({ life: -1 })) };
  }

  buildParticles() {
    this.pcount = 1400;
    this.parts = this.makePoints(this.pcount, 0x8dffae);
    this.scene.add(this.parts.pts);
    this.pstate = Array.from({ length: this.pcount }, () => ({ b: -1, s: Math.random(), u: Math.sqrt(Math.random()), ph: Math.random() * 6.283 }));
  }

  buildLabels() {
    const L = [
      ['Electron gun', [0.4, Y.gun + 0.1, 0], null],
      ['High-voltage accelerator', [1.05, 6.3, 0], null],
      ['Condenser lens 1', [1.18, Y.c1, 0], null],
      ['Condenser lens 2', [1.18, Y.c2, 0], null],
      ['Condenser aperture', [-0.5, Y.cap, 0], null, 'left'],
      ['Scan coils', [-0.4, Y.scan, 0], ['stem', '4d', 'eds', 'eels'], 'left'],
      ['Objective lens', [1.6, Y.objTop - 0.1, 0], null],
      ['Specimen', [0.9, Y.spec + 0.1, 0.1], null],
      ['EDS X-ray detector', [-1.3, Y.spec + 0.9, -0.8], ['eds'], 'left'],
      ['Objective aperture', [-0.5, Y.bfp, 0], ['tem'], 'left'],
      ['Back focal plane', [-0.5, Y.bfp, 0], ['diff', 'stem', '4d', 'eds', 'eels'], 'left'],
      ['Selected-area aperture', [0.5, Y.sa, 0], ['diff']],
      ['Intermediate lens', [1.12, Y.int, 0], null],
      ['Projector lens', [1.12, Y.proj, 0], null],
      ['Fluorescent screen', [1.2, Y.screen, 0], ['tem:screen', 'diff:screen']],
      ['Annular dark-field detector', [1.0, Y.adf, 0], ['stem', 'eds', 'eels']],
      ['Bright-field detector', [-0.35, Y.bfdet, 0], ['stem', 'eds'], 'left'],
      ['Direct electron detector', [0.7, Y.cam, 0], ['4d', 'tem:ded', 'diff:ded']],
      ['Magnetic prism', [1.2, Y.prism, 0.2], ['eels']],
      ['Energy-loss spectrum', [2.6, Y.prism - 1.0, 0], ['eels']],
    ];
    this.labels = L.map(([text, p, modes, side]) => {
      const el = document.createElement('div');
      el.className = 'lbl' + (side === 'left' ? ' left' : '');
      el.innerHTML = `<i></i><span role="button" tabindex="0">${text}</span>`;
      const open = (e) => { e.stopPropagation(); this.onLabel?.(text, el); };
      el.querySelector('span').addEventListener('click', open);
      el.querySelector('span').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') open(e); });
      this.labelLayer.appendChild(el);
      return { el, pos: new THREE.Vector3(...p), modes };
    });
  }

  resize(w, h, off) {
    this.W = w; this.H = h;
    this.viewOffset = off;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    // shift the projection so the column is centred in the free area between panels
    const dx = (off.left - off.right) / 2, dy = (off.top - off.bottom) / 2;
    this.camera.setViewOffset(w, h, -dx, -dy, w, h);
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- beam layout per mode
  gvecs(S) {
    const spec = P.SPECIMENS[S.spec], gr = spec.grains[0], out = [];
    const refl = spec.id === 'sto' ? [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]
      : spec.id === 'si' ? [[1, 1], [-1, -1], [1, -1], [-1, 1], [2, 0], [-2, 0]]
        : [[1, 1], [-1, -1], [1, -1], [-1, 1], [0, 2], [0, -2]];
    for (const [a, b] of refl) {
      const gx = a * gr.b[0][0] + b * gr.b[1][0], gy = a * gr.b[0][1] + b * gr.b[1][1];
      out.push({ x: gx, z: gy, k: Math.hypot(gx, gy) });
    }
    return out;
  }

  layout(S, sim) {
    const m = S.mode, lam = P.wavelength(S.kV), kScale = 0.36 * (lam / LAM200);
    const B = [];
    const cyan = 0x3dff7a, pale = 0xb4ffc8, warm = 0xffb45e, violet = 0x9dffb0;
    const V = (keys, off = () => [0, 0]) => keys.map(([y, r]) => { const [x, z] = off(y); return [x, y, z, r]; });
    const upperTEM = [[Y.gun, 0], [Y.anode, 0.09], [Y.c1, 0.26], [3.35, 0], [Y.c2, -0.2], [Y.cap, -0.18], [Y.objTop, -0.18], [Y.spec, -0.18]];
    if (m === 'tem' || m === 'diff') {
      B.push({ id: 'up', keys: V(upperTEM), color: cyan, I: 1, kids: [] });
      const gs = this.gvecs(S);
      const apMrad = AP_MRAD[S.objAp];
      const apR = m === 'tem' && isFinite(apMrad) ? (0.36 * apMrad * 1e-3) / LAM200 : 9;
      let apC = [0, 0];
      if (m === 'tem' && S.objAp === 'df') { const g = gs[0]; apC = [g.x * kScale, g.z * kScale]; }
      this.anim.objApT = m === 'tem' && S.objAp !== 'none' ? apR : null;
      this.anim.objApC = apC;
      const saR = m === 'diff' ? clamp(S.sa * 0.028, 0.06, 0.34) : 0.34;
      this.anim.saT = m === 'diff' ? saR : null;
      const mainBlocked = m === 'tem' && S.objAp === 'df';
      if (m === 'tem') {
        const lowA = V([[Y.spec, -0.18], [Y.bfp, 0], [Y.sa, 0.3]]);
        B.push({ id: 'lowA', keys: mainBlocked ? V([[Y.spec, -0.18], [Y.bfp, 0]]) : lowA, color: cyan, I: 1, kids: mainBlocked ? [] : ['tail'] });
        B.push({ id: 'tail', keys: V([[Y.sa, 0.3], [Y.int, 0.42], [-1.95, 0], [Y.proj, -0.22], S.camera === 'ded' ? [Y.cam, -0.55] : [Y.screen, -1.05]]), color: cyan, I: 0.9, kids: [] });
        gs.forEach((g, i) => {
          const d = [g.x * kScale, g.z * kScale];
          const pass = Math.hypot(d[0] - apC[0], d[1] - apC[1]) < apR;
          const off = (y) => {
            const t = y >= Y.bfp ? (Y.spec - y) / (Y.spec - Y.bfp) : 1 - (Y.bfp - y) / (Y.bfp - Y.sa);
            return [d[0] * t, d[1] * t];
          };
          const keys = pass ? [[Y.spec, -0.18], [Y.bfp, 0], [Y.sa, 0.3]] : [[Y.spec, -0.18], [Y.bfp, 0]];
          B.push({ id: 'g' + i, keys: V(keys, off), color: i < 4 ? pale : violet, I: 0.45, kids: pass ? ['tail'] : [] });
        });
        B[0].kids = [['lowA', mainBlocked ? 0.4 : 0.62], ...gs.map((_, i) => ['g' + i, 0.38 / gs.length])];
      } else {
        const camF = (S.camL / 400) * 5.2;
        const lowKeys = [[Y.spec, -0.18], [Y.bfp, 0], [Y.sa, Math.min(0.3, saR)], [Y.int, 0.34], [Y.proj, 0.18], [Y.screen, 0.025]];
        B.push({ id: 'lowA', keys: V(lowKeys), color: cyan, I: 1, kids: [] });
        gs.forEach((g, i) => {
          const d = [g.x * kScale, g.z * kScale];
          const k = [[Y.spec, 0], [Y.bfp, 1], [Y.sa, 1.35], [Y.int, 1.7], [Y.proj, 2.3], [Y.screen, camF]];
          const f = (y) => {
            for (let j = 0; j < k.length - 1; j++) if (y <= k[j][0] && y >= k[j + 1][0]) { const t = (k[j][0] - y) / (k[j][0] - k[j + 1][0]); return lerp(k[j][1], k[j + 1][1], t); }
            return camF;
          };
          const off = (y) => { let s = f(y); const D = Math.hypot(d[0], d[1]) * s; if (D > 1.12) s *= 1.12 / D; return [d[0] * s, d[1] * s]; };
          B.push({ id: 'g' + i, keys: V(lowKeys, off), color: i < 4 ? pale : violet, I: 0.5, kids: [] });
        });
        B[0].kids = [['lowA', 0.55], ...gs.map((_, i) => ['g' + i, 0.45 / gs.length])];
      }
    } else {
      const aS = clamp((m === '4d' ? S.alpha4d : S.alpha) / 22, 0.3, 1.6);
      const dfS = clamp(S.df * 0.004, -0.38, 0.38);
      const yc = Y.spec + dfS;
      const sp = this.scanPos(S, sim);
      const scanOff = (y) => {
        if (y >= Y.scan + 0.12) return [0, 0];
        if (y >= Y.spec) { const t = (Y.scan + 0.12 - y) / (Y.scan + 0.12 - Y.spec); return [sp[0] * t, sp[1] * t]; }
        const t = clamp((y - Y.adf) / (Y.spec - Y.adf), 0, 1);
        return [sp[0] * t, sp[1] * t];
      };
      const slope = (0.13 * aS) / (Y.objTop - yc);
      const up = [[Y.gun, 0], [Y.anode, 0.09], [Y.c1, 0.24], [3.38, 0], [Y.c2, -0.2], [Y.cap, -0.17], [Y.scan + 0.12, -0.15], [Y.objTop, -0.13 * aS]];
      if (yc > Y.spec) up.push([yc, 0]);
      const rSpec = -slope * (Y.spec - yc);
      up.push([Y.spec, rSpec]);
      B.push({ id: 'up', keys: V(up, scanOff), color: cyan, I: 1, kids: [], dyn: true });
      const r0 = Math.abs(rSpec);
      const bfKeys = [[Y.spec, r0], [Y.objBot, 0.07 * aS + r0], [Y.bfp, 0.1 * aS], [Y.int, 0.15 * aS], [Y.proj, 0.2 * aS]];
      if (m === '4d') bfKeys.push([Y.cam, 0.36 * aS]);
      else if (m === 'eels') bfKeys.push([-3.6, 0.12 * aS], [Y.prism + 0.02, 0.05]);
      else bfKeys.push([Y.adf, 0.28 * aS], [Y.bfdet, 0.3 * aS]);
      B.push({ id: 'bf', keys: V(bfKeys, scanOff), color: cyan, I: 0.9, kids: [], dyn: true });
      const adfKeys = [[Y.spec, 0.0], [Y.objBot, 0.2], [Y.bfp, 0.3], [Y.int, 0.52], [Y.proj, 0.6], [m === '4d' ? Y.cam : Y.adf, m === '4d' ? 0.62 : 0.72]];
      B.push({ id: 'adf', keys: V(adfKeys, scanOff), color: violet, I: 0.3, kids: [], dyn: true });
      B[0].kids = [['bf', 0.8], ['adf', 0.2]];
      if (m === 'eels') {
        const fan = [
          { id: 'zlp', d: 0, c: 0xe4ffea, I: 0.9, w: 0.6 },
          { id: 'pl', d: 0.09, c: cyan, I: 0.5, w: 0.3 },
          { id: 'win', d: 0.12 + 0.3 * clamp(S.eelsWin / 2400, 0, 1) + 0.04, c: warm, I: 0.45, w: 0.1 },
        ];
        const R0 = 0.72;
        // magnetic sector: faster (less energy lost) electrons bend less
        for (const f of fan) {
          const keys = [], ang = Math.PI / 2 - 0.2 + f.d;
          for (let i = 0; i <= 14; i++) {
            const a = (i / 14) * ang;
            keys.push([R0 - R0 * Math.cos(a), Y.prism + 0.02 - R0 * Math.sin(a), 0, 0.05 - 0.02 * (i / 14)]);
          }
          const last = keys[keys.length - 1], tx = Math.sin(ang), ty = -Math.cos(ang);
          const L = (2.4 - last[0]) / Math.max(0.2, tx);
          keys.push([last[0] + tx * L, last[1] + ty * L, 0, 0.018 + f.d * 0.03]);
          B.push({ id: f.id, keys, color: f.c, I: f.I, kids: [] });
        }
        B[1].kids = fan.map((f) => [f.id, f.w]);
      }
    }
    return B;
  }

  scanPos(S, sim) {
    if (S.mode === 'stem') { const r = sim.raster * 224; const row = Math.floor(r), col = r - row; return [(col - 0.5) * 0.22, ((row / 224) - 0.5) * 0.22]; }
    if (S.mode === '4d' && sim.fd) {
      const f = sim.fd, k = S.fdSel >= 0 ? S.fdSel : Math.max(0, f.done - 1);
      return [(((k % f.N) + 0.5) / f.N - 0.5) * 0.22, ((((k / f.N) | 0) + 0.5) / f.N - 0.5) * 0.22];
    }
    const t = this.time * 0.9;
    return [Math.sin(t * 3.1) * 0.08, Math.sin(t * 0.37) * 0.08];
  }

  applyLayout(S, sim, force) {
    const key = [S.mode, S.spec, S.kV, S.objAp, S.camL, S.sa, S.alpha, S.alpha4d, S.df, S.eelsWin, S.camera].join('|');
    if (key !== this.layoutKey) {
      const modeChanged = !this.layoutKey || this.layoutKey.split('|')[0] !== S.mode;
      this.layoutKey = key;
      if (modeChanged) { this.active ^= 1; this.anim.fade = 0; }
      this.setBeams(this.active, this.layout(S, sim));
      if (!modeChanged) this.anim.fade = 1;
      return;
    }
    // dynamic (scanning) beams get rebuilt each frame
    const defs = this.beamSets[this.active];
    if (defs.some((d) => d.dyn)) {
      const L = this.layout(S, sim);
      L.forEach((d, i) => { if (d.dyn && defs[i]) { defs[i].beam.set(d.keys, d.color, d.I); } });
    }
  }

  setBeams(slot, defs) {
    const grp = this.beamGroups[slot];
    const old = this.beamSets[slot];
    while (old.length > defs.length) { const o = old.pop(); grp.remove(o.beam.mesh); o.beam.mesh.geometry.dispose(); }
    defs.forEach((d, i) => {
      if (!old[i]) old[i] = { beam: new Beam(grp) };
      Object.assign(old[i], d, { beam: old[i].beam });
      old[i].beam.set(d.keys, d.color, d.I);
    });
    this.idIndex = Object.fromEntries(this.beamSets[this.active].map((d, i) => [d.id, i]));
  }

  // ---------------------------------------------------------------- per-frame
  update(dt, S, sim) {
    this.time += dt;
    // pan the view down to the spectrometer in EELS mode (and back up afterwards)
    const wantShift = S.mode === 'eels' ? -1.5 : 0;
    this.vShift ??= 0;
    if (Math.abs(wantShift - this.vShift) > 1e-3 && !this.tour) {
      const step = (wantShift - this.vShift) * Math.min(1, dt * 2.5);
      this.vShift += step;
      this.camera.position.y += step;
      this.controls.target.y += step;
    }
    const A = this.anim, k = Math.min(1, dt * 3.2), m = S.mode;
    this.applyLayout(S, sim);
    this.idIndex = Object.fromEntries(this.beamSets[this.active].map((d, i) => [d.id, i]));
    A.fade = Math.min(1, A.fade + dt * 1.6);
    const edu = S.clarity !== 'real';
    const bright = clamp(0.55 + 0.18 * Math.log10(S.dose / 50), 0.35, 1.2) * (edu ? 1 : 0.7);
    this.beamSets.forEach((set, slot) => {
      const w = slot === this.active ? A.fade : 1 - A.fade;
      for (const d of set) {
        d.beam.mat.uniforms.uOpacity.value = w * bright * (edu ? 0.55 : 0.4);
        d.beam.mat.uniforms.uTime.value = this.time * S.speed * (S.paused ? 0 : 1);
        d.beam.mat.uniforms.uFlow.value = 4 + 10 * P.betaOf(S.kV);
      }
      this.beamGroups[slot].visible = w > 0.01;
    });
    // mechanical parts
    const stemLike = m !== 'tem' && m !== 'diff';
    const ded = m === '4d' || (!stemLike && S.camera === 'ded');
    A.screenLift = lerp(A.screenLift, stemLike || ded ? 1 : 0, k);
    this.screenPivot.rotation.x = -A.screenLift * 1.35;
    A.adf = lerp(A.adf, m === 'stem' || m === 'eds' || m === 'eels' ? 1 : 0, k);
    this.adf.position.set((1 - A.adf) * -2.6, Y.adf, 0);
    this.adf.visible = A.adf > 0.02;
    A.bf = lerp(A.bf, m === 'stem' || m === 'eds' ? 1 : 0, k);
    this.bf.position.set((1 - A.bf) * 2.4, Y.bfdet, 0);
    this.bf.visible = A.bf > 0.02;
    A.cam = lerp(A.cam, ded ? 1 : 0, k);
    this.pixCam.position.set((1 - A.cam) * -3, Y.cam, 0);
    this.pixCam.visible = A.cam > 0.02;
    A.prism = lerp(A.prism, m === 'eels' ? 1 : 0, k);
    this.spectro.visible = A.prism > 0.02;
    this.spectro.scale.setScalar(Math.max(0.001, A.prism));
    this.spectro.position.set(0, Y.prism * (1 - A.prism), 0);
    this.scanCoils.children.forEach((c) => (c.material = stemLike ? this.M.copper : this.M.iron));
    // apertures
    const setAp = (grp, target, center, key, keyX, y, side) => {
      const on = target !== null && target !== undefined;
      A[key] = lerp(A[key] ?? 0.3, on ? target : 0.3, k);
      A[keyX] = lerp(A[keyX] ?? 0, on ? 0 : 2.3, k);
      const s = grp.userData;
      grp.remove(s.plate, s.front);
      s.plate.traverse((o) => o.geometry?.dispose());
      s.front.geometry.dispose();
      Object.assign(s, platePieces(this.M, y, clamp(A[key], 0.012, 0.49)));
      grp.add(s.plate, s.front);
      grp.position.set((center?.[0] ?? 0) + A[keyX] * side, 0, center?.[1] ?? 0);
    };
    const apKey = `${(this.anim.objApT ?? -1).toFixed(3)}|${this.anim.objApC?.join()}|${(this.anim.saT ?? -1).toFixed(3)}`;
    if (apKey !== this._apKey) { this._apKey = apKey; this._apFrames = 120; }
    if (this._apFrames > 0) {
      this._apFrames--;
      setAp(this.objAp, this.anim.objApT, this.anim.objApC, 'oa', 'oaX', Y.bfp, -1);
      setAp(this.saAp, this.anim.saT, null, 'sar', 'saX', Y.sa, 1);
    }
    // holder tilt (exaggerated ×6 so it reads)
    this.holder.rotation.x = (S.tiltY * Math.PI / 180) * 6;
    this.holder.rotation.z = (S.tiltX * Math.PI / 180) * 6;
    // glows
    const sp = this.scanPos(S, sim);
    const onSpec = stemLike ? sp : [0, 0];
    this.specGlow.position.set(onSpec[0], Y.spec + 0.01, onSpec[1]);
    this.specGlow.scale.setScalar(stemLike ? 0.35 : 0.75);
    this.specGlow.material.opacity = 0.6 * bright;
    this.beamLight.position.set(onSpec[0], Y.spec + 0.1, onSpec[1]);
    this.beamLight.intensity = 2.5 * bright;
    const hv = S.kV / 300;
    this.tipGlow.scale.setScalar(0.5 + 0.6 * hv);
    this.tipGlow.material.opacity = 0.6 + 0.4 * hv;
    this.adfMat.emissiveIntensity = m === 'stem' || m === 'eds' || m === 'eels' ? 0.25 + 0.2 * Math.sin(this.time * 9) ** 2 : 0;
    this.bfMat.emissiveIntensity = m === 'stem' || m === 'eds' ? 0.35 : 0;
    A.eds = lerp(A.eds, m === 'eds' ? 1 : 0, k);
    this.edsWinMat.color.setRGB(0.23 + A.eds * 0.9, 0.16 + A.eds * 0.55, 0.08 + A.eds * 0.2);
    this.shell.visible = S.showGlass;
    this.screenMat.color.setScalar(!stemLike && !ded ? 1.25 : 0.25);
    this.camMat.color.setScalar(ded ? 1.2 : 0.3);
    this.updateParticles(dt, S, sim);
    this.updateXrays(dt, S, onSpec);
    this.updateLabels(S);
    if (this.tour) this.stepTour(dt);
    this.controls.autoRotate = S.autoRotate && !this.tour;
    this.controls.update();
    this.bloom.strength = edu ? 0.85 : 0.65;
    this.composer.render();
  }

  updateParticles(dt, S, sim) {
    const set = this.beamSets[this.active], ids = this.idIndex;
    const pos = this.parts.pts.geometry.attributes.position.array, size = this.parts.pts.geometry.attributes.size.array, col = this.parts.pts.geometry.attributes.color.array;
    const edu = S.clarity !== 'real';
    const beta = P.betaOf(S.kV);
    const speed = (edu ? 0.7 : 2.6) * beta * (S.paused ? 0 : S.speed);
    const single = !!sim.single;
    const active = S.showElectrons ? (single ? 3 : Math.round(this.pcount * clamp(0.35 + 0.2 * Math.log10(S.dose / 50), 0.15, 1))) : 0;
    const out = [0, 0, 0], c = new THREE.Color();
    for (let i = 0; i < this.pcount; i++) {
      const p = this.pstate[i];
      if (i >= active || !set.length) { size[i] = 0; continue; }
      if (p.b < 0 || p.b >= set.length) { p.b = 0; p.s = Math.random() * (single ? 0 : 1); }
      const bm = set[p.b];
      p.s += (speed * dt * (single ? 0.35 : 1)) / Math.max(0.2, bm.beam.len);
      if (p.s >= 1) {
        const kids = bm.kids || [];
        let next = -1;
        if (kids.length) {
          let r = Math.random(), acc = 0;
          for (const kid of kids) {
            const [id, w] = Array.isArray(kid) ? kid : [kid, 1];
            acc += w;
            if (r <= acc) { next = ids[id] ?? -1; break; }
          }
          if (next < 0) { const last = kids[kids.length - 1]; next = ids[Array.isArray(last) ? last[0] : last] ?? -1; }
        }
        if (next >= 0) { p.b = next; p.s = 0; }
        else { p.b = 0; p.s = 0; p.u = Math.sqrt(Math.random()); p.ph = Math.random() * 6.283; }
      }
      const b2 = set[p.b];
      b2.beam.sample(p.s, p.u, p.ph, out);
      pos[i * 3] = out[0]; pos[i * 3 + 1] = out[1]; pos[i * 3 + 2] = out[2];
      size[i] = single ? 0.09 : edu ? 0.045 : 0.03;
      c.set(b2.color);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    const g = this.parts.pts.geometry;
    g.attributes.position.needsUpdate = g.attributes.size.needsUpdate = g.attributes.color.needsUpdate = true;
  }

  updateXrays(dt, S, onSpec) {
    const X = this.xrays, on = S.mode === 'eds' && !S.paused;
    const pos = X.pts.geometry.attributes.position.array, size = X.pts.geometry.attributes.size.array;
    const target = new THREE.Vector3();
    this.eds.getWorldPosition(target);
    const origin = new THREE.Vector3(onSpec[0], Y.spec, onSpec[1]);
    for (let i = 0; i < X.n; i++) {
      const s = X.state[i];
      if (s.life < 0) {
        if (!on || Math.random() > dt * 18 * S.speed * clamp(S.dose / 500, 0.2, 3)) { size[i] = 0; continue; }
        const toDet = Math.random() < 0.55;
        const dir = toDet ? target.clone().sub(origin).normalize().add(new THREE.Vector3((Math.random() - 0.5) * 0.25, (Math.random() - 0.5) * 0.25, (Math.random() - 0.5) * 0.25)).normalize()
          : new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
        s.p = origin.clone(); s.v = dir.multiplyScalar(3.2); s.life = toDet ? 0.9 : 0.35;
      }
      s.life -= dt * S.speed;
      s.p.addScaledVector(s.v, dt * S.speed * 0.6);
      pos[i * 3] = s.p.x; pos[i * 3 + 1] = s.p.y; pos[i * 3 + 2] = s.p.z;
      size[i] = s.life > 0 ? 0.07 : 0;
    }
    X.pts.geometry.attributes.position.needsUpdate = X.pts.geometry.attributes.size.needsUpdate = true;
  }

  updateLabels(S) {
    const show = S.showLabels, v = new THREE.Vector3();
    const w = this.W, h = this.H;
    for (const L of this.labels) {
      const on = show && (!L.modes || L.modes.includes(S.mode) || L.modes.includes(`${S.mode}:${S.camera}`));
      if (!on) { L.el.style.opacity = 0; L.el.classList.add('off'); continue; }
      v.copy(L.pos).project(this.camera);
      if (v.z > 1) { L.el.style.opacity = 0; L.el.classList.add('off'); continue; }
      L.el.classList.remove('off');
      const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
      L.el.style.opacity = 1;
      L.el.style.transform = `translate(${x}px, ${y}px)`;
    }
  }

  // ---------------------------------------------------------------- tour
  startTour(stops, onStop) {
    this.tour = { stops, i: -1, t: 0, onStop };
    this.nextStop();
  }
  nextStop() {
    const T = this.tour;
    T.i++;
    if (T.i >= T.stops.length) { this.stopTour(); return; }
    const s = T.stops[T.i];
    T.from = { pos: this.camera.position.clone(), target: this.controls.target.clone() };
    T.to = { pos: new THREE.Vector3(...s.pos), target: new THREE.Vector3(0, s.y, 0) };
    T.t = 0;
    T.onStop?.(s, T.i, T.stops.length);
  }
  stepTour(dt) {
    const T = this.tour, s = T.stops[T.i];
    T.t += dt;
    const f = Math.min(1, T.t / 1.6), e = f < 0.5 ? 4 * f * f * f : 1 - Math.pow(-2 * f + 2, 3) / 2;
    this.camera.position.lerpVectors(T.from.pos, T.to.pos, e);
    this.controls.target.lerpVectors(T.from.target, T.to.target, e);
    if (T.t > (s.dur ?? 5.2)) this.nextStop();
  }
  stopTour() {
    const cb = this.tour?.onStop;
    this.tour = null;
    cb?.(null);
  }
  resetView() {
    this.stopTour();
    this.camera.position.copy(this.home.pos);
    this.controls.target.copy(this.home.target);
    this.camera.position.y += this.vShift ?? 0;
    this.controls.target.y += this.vShift ?? 0;
  }
}
