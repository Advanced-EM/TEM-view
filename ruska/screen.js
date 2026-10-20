// The fluorescent screen: a fragment shader draws the specimen at the current magnification, rotation and blur.
// Blur is applied analytically: edges widen with σ, and every periodic or noise detail is damped by the
// Gaussian transfer function exp(−2π²σ²/P²), so the image is band-limited exactly as the optics would do.

const VS = `#version 300 es
in vec2 aP; out vec2 vP;
void main(){ vP = aP; gl_Position = vec4(aP, 0., 1.); }`;

const FS = `#version 300 es
precision highp float;
in vec2 vP; out vec4 oC;
uniform vec2 uCenter; uniform float uFov, uRot, uSigma, uPx;
uniform int uSpec, uN; uniform vec4 uGeo[8];
uniform vec3 uIll; uniform float uIllShape;
uniform float uGain, uContrast, uKappa, uNe, uTime, uFlick, uOn;
uniform float uHole, uIsHole, uPersist;
uniform sampler2D uDmg; uniform float uDmgW;

float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash2(vec2 p){ return vec2(hash(p), hash(p + 17.31)); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3. - 2.*f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), f.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y); }
float mtf(float s, float P){ return exp(-19.739 * s * s / (P * P)); }
// band-limited fractal noise, zero mean: wavelengths L0, L0/2, …
float fbm(vec2 p, float L0, int oct, float s){
  float a = 0.5, t = 0., L = L0;
  for (int i = 0; i < 10; i++) { if (i >= oct) break;
    t += a * mtf(s, L) * (vn(p / L + float(i) * 7.13) - 0.5); a *= 0.58; L *= 0.5; }
  return t;
}
float edge(float x, float s){ return smoothstep(-1.6 * s, 1.6 * s, x); }
vec2 dmgAt(vec2 p){ vec2 uv = p / uDmgW + 0.5; if (any(lessThan(uv, vec2(0.))) || any(greaterThan(uv, vec2(1.)))) return vec2(0.); return texture(uDmg, uv).rg; }

float meshT(vec2 p, float pitch, float wire, float s, vec2 dm){
  vec2 q = abs(fract(p / pitch + 0.5) - 0.5) * pitch;
  float bead = 1. + dm.y * 1.6 * (vn(p / (wire * 1.3)) - 0.55);
  float hw = 0.5 * wire * max(0., 1. - 0.55 * dm.y) * bead;
  float w = max(1. - edge(q.x - hw, s), 1. - edge(q.y - hw, s));
  float brk = smoothstep(0.5, 0.72, dm.y + 0.55 * (vn(p / (wire * 2.5) + 3.) - 0.5));
  w *= 1. - brk;
  float cov = (2. * wire / pitch - wire * wire / (pitch * pitch)) * (1. - 0.6 * dm.y);
  w = mix(w, cov, smoothstep(0.25 * pitch, 0.9 * pitch, s));      // finer than the blur: only the average is left
  return w * (7. + 1.5 * fbm(p, wire, 3, s)) ;
}

float cottonT(vec2 p, float s, vec2 dm){
  float t = 0.;
  for (int i = 0; i < 8; i++) { if (i >= uN) break;
    vec4 g = uGeo[i]; vec2 d = vec2(cos(g.z), sin(g.z)); vec2 r = p - g.xy;
    float a = dot(r, d), n = dot(r, vec2(-d.y, d.x)) - 6. * sin(a / 45. + float(i) * 1.7);
    float tw = 0.55 + 0.45 * abs(cos(a / 12. + float(i)));           // the twisted ribbon breathes in width
    float w = 0.5 * g.w * tw * (1. - 0.5 * dm.x);                      // charred fibres shrink
    if (abs(n) > w + 4. * s + 1.) continue;
    float inside = 1. - edge(abs(n) - w, s);
    float prof = sqrt(max(0., 1. - n * n / (w * w + 1e-4)));
    float fib = 0., fa = 0.5, L = 0.6;                                  // fibrils run along the fibre
    for (int k = 0; k < 5; k++) { fib += fa * mtf(s, L) * (vn(vec2(a / (L * 7.), n / L) + float(k * 3 + i)) - 0.5); fa *= 0.62; L *= 0.5; }
    float th = 3.2 * (1. - 0.78 * dm.x) * (0.3 + 0.7 * prof) * (1. + (0.7 + 1.3 * dm.x) * fib);
    float gap = smoothstep(0.45, 0.62, dm.y + 0.5 * (vn(vec2(a / 2.5, float(i))) - 0.5));
    t += inside * th * (1. - gap);
  }
  return t;
}

vec2 voro(vec2 p){ vec2 c0 = floor(p); float best = 9., id = 0.;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) { vec2 c = c0 + vec2(i, j); vec2 q = c + hash2(c);
    float d = dot(p - q, p - q); if (d < best) { best = d; id = hash(c + 5.1); } }
  return vec2(id, sqrt(best)); }

float burnt(vec2 p, float s, float dy, out float rim){
  float h = dy + 0.28 * (vn(p / 0.7) - 0.5) + 0.12 * (vn(p / 0.18) - 0.5);
  float w = 0.015 + 0.9 * s;
  rim = exp(-pow((h - 0.47) / 0.06, 2.)) * step(0.05, dy);
  return smoothstep(0.55 - w, 0.55 + w, h);
}

float foilT(vec2 p, float s, vec2 dm){
  vec2 v = voro(p / 3.);
  float t = 1.5 * (1. + 0.22 * (v.x - 0.5) * mtf(s, 2.));
  t *= 1. + 0.07 * (vn(vec2(p.x / 40., p.y / 0.7)) - 0.5) * mtf(s, 0.7);
  t += 0.25 * fbm(p, 1.6, 6, s);
  float hole = 0.;
  for (int i = 0; i < 8; i++) { if (i >= uN) break; vec4 g = uGeo[i];
    vec2 r = p - g.xy; float rr = length(r) + 0.35 * g.z * (vn(r / (0.4 * g.z) + float(i)) - 0.5);
    hole = max(hole, 1. - edge(rr - g.z, s)); }
  float rim; float hb = burnt(p, s, dm.y, rim);
  t += 0.9 * rim;
  return t * (1. - max(hole, hb));
}

float wingT(vec2 p, float s, vec2 dm){
  float ed = 250. + 8. * sin(p.x / 37.);
  float memb = 1. - edge(abs(p.y) - ed, s);
  float t = memb * (0.5 + 0.14 * fbm(p, 30., 5, s) + 0.08 * fbm(p, 1.2, 4, s));
  for (int i = 0; i < 8; i++) { if (i >= uN) break; vec4 g = uGeo[i];
    float n = (p.y - g.x - g.y * p.x); n *= inversesqrt(1. + g.y * g.y);
    float hw = 0.5 * g.z; float inside = 1. - edge(abs(n) - hw, s);
    t += memb * inside * (2.2 + 0.6 * fbm(p, 4., 3, s)) * sqrt(max(0.05, 1. - n * n / (hw * hw))); }
  float hair = 0.; vec2 c0 = floor(p / 7.);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) { vec2 c = c0 + vec2(i, j); vec2 h = hash2(c);
    vec2 base = (c + 0.15 + 0.7 * h) * 7.; float ang = 0.25 + 0.6 * (h.x - 0.5); vec2 d = vec2(cos(ang), sin(ang));
    float L = 4.5 + 3.5 * h.y; vec2 r = p - base; float a = clamp(dot(r, d), 0., L); float n = length(r - a * d);
    float w = mix(0.42, 0.07, a / L); hair = max(hair, (1. - edge(n - w, s)) * mix(1., 0.5, a / L));
    float so = length(r); hair = max(hair, 0.45 * exp(-pow((so - 0.75) / 0.18, 2.)) * mtf(s, 0.5)); }
  t += memb * 1.5 * hair;
  t *= 1. + 1.1 * dm.x;
  float rim; float hb = burnt(p, s, dm.y, rim);
  return (t + 0.8 * rim * memb) * (1. - hb);
}

float diatomT(vec2 p, float s, vec2 dm){
  float t = 0.;
  for (int i = 0; i < 8; i++) { if (i >= uN) break; vec4 g = uGeo[i];
    vec2 d = vec2(cos(g.z), sin(g.z)); vec2 r = p - g.xy; float a = dot(r, d), n = dot(r, vec2(-d.y, d.x));
    float A = 0.5 * g.w; float u = a / A; if (abs(u) > 1.03) continue;
    float w = g.w * 0.0375 * pow(max(0., 1. - u * u), 0.75);
    if (abs(n) > w + 4. * s + 1.) continue;
    float inside = 1. - edge(abs(n) - w, s);
    float rim = smoothstep(w - 0.7, w - 0.15, abs(n));
    float raphe = exp(-pow(n / 0.22, 2.)) + 0.6 * exp(-pow(n / 0.6, 2.)) * smoothstep(0.85, 0.95, abs(u));
    float st = cos(6.2832 * a / 0.26), po = cos(6.2832 * n / 0.21);
    float tt = 1.05 + 1.0 * rim + 1.3 * raphe;
    tt += (1. - min(1., raphe)) * (1. - rim) * (0.42 * mtf(s, 0.26) * st + 0.22 * mtf(s, 0.163) * st * po);
    tt += 0.12 * fbm(p, 2., 4, s);
    t += inside * tt;
  }
  vec2 c = floor(p / 18.); vec2 h = hash2(c);                         // debris
  if (h.x > 0.72) { vec2 q = (c + 0.5 + 0.4 * (hash2(c + 3.) - 0.5)) * 18.; float rr = 0.2 + 0.9 * h.y;
    t += 2.2 * (1. - edge(length(p - q) - rr, s)); }
  t *= 1. + 0.6 * dm.x;
  float rim2; float hb = burnt(p, s, dm.y, rim2);
  return t * (1. - hb);
}

void main(){
  vec2 sp = vP * 0.5 * uFov;                                            // µm in the specimen, screen-aligned
  float cs = cos(-uRot), sn = sin(-uRot);
  vec2 p = uCenter + vec2(cs * sp.x - sn * sp.y, sn * sp.x + cs * sp.y);
  float s = max(uSigma, 0.6 * uPx);
  vec2 dm = dmgAt(p);
  float t = 0.;
  if (uSpec == 0) t = meshT(p, uGeo[0].x, uGeo[0].y, s, dm);
  else if (uSpec == 1) t = meshT(p, uGeo[0].x, uGeo[0].y, s, vec2(0.));
  else if (uSpec == 2) t = cottonT(p, s, dm);
  else if (uSpec == 3) t = foilT(p, s, dm);
  else if (uSpec == 4) t = wingT(p, s, dm);
  else t = diatomT(p, s, dm);
  float T = exp(-t * uKappa);
  float obj = 1. - uContrast * (1. - T);
  // the beam: the image of the cathode crater, mottled, flickering with the discharge
  vec2 rb = (p - uCenter - uIll.xy) / uIll.z; float r = length(rb);
  float ill = uIllShape > 0.5 ? exp(-1.3 * r * r) : (1. - smoothstep(0.82, 1.18, r)) * (0.86 + 0.14 * smoothstep(0.4, 0.95, r));
  ill *= 0.88 + 0.24 * vn(rb * 2.5 + uFlick);
  float I = uOn * ill * obj * uGain;
  float R = length(vP);
  if (uHole > 0.) I *= 1. - smoothstep(uHole * 0.96, uHole * 1.04, R);  // the opening in the intermediate screen bounds the field
  if (uIsHole > 0.) I *= smoothstep(uIsHole * 0.8, uIsHole * 1.2, R); // the opening itself, seen from above
  float L = 1. - exp(-0.9 * I);
  float N = uNe * L + 0.5;
  L += (hash(gl_FragCoord.xy + fract(uTime * 13.7) * 311.) - 0.5) * 3.46 * L / sqrt(N);
  L *= 0.93 + 0.14 * hash(floor(gl_FragCoord.xy / 1.5) + 0.37);       // phosphor grain
  L = max(L, 0.);
  vec3 col = vec3(0.47, 1.0, 0.38) * L + vec3(0.9, 1.0, 0.82) * pow(L, 3.) * 0.35 + vec3(0.004, 0.008, 0.003);
  col *= 1. - smoothstep(0.9, 1.0, R) * 0.7;
  oC = vec4(col, uPersist);
}`;

export function createScreen(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true });
  if (!gl) return null;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aP = gl.getAttribLocation(prog, 'aP'); gl.enableVertexAttribArray(aP); gl.vertexAttribPointer(aP, 2, gl.FLOAT, false, 0, 0);
  const U = {}; const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(prog, i).name.replace('[0]', ''); U[name] = gl.getUniformLocation(prog, name); }
  const DN = 256;
  const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  const blank = new Uint8Array(DN * DN * 2);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, DN, DN, 0, gl.RG, gl.UNSIGNED_BYTE, blank);
  gl.uniform1i(U.uDmg, 0);
  const px = new Uint8Array(canvas.width * canvas.height * 4);

  return {
    DN,
    setDamage(bytes) { gl.bindTexture(gl.TEXTURE_2D, tex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, DN, DN, gl.RG, gl.UNSIGNED_BYTE, bytes); },
    draw(u) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(U.uCenter, u.center[0], u.center[1]);
      gl.uniform1f(U.uFov, u.fov); gl.uniform1f(U.uRot, u.rot); gl.uniform1f(U.uSigma, u.sigma); gl.uniform1f(U.uPx, u.fov / canvas.width);
      gl.uniform1i(U.uSpec, u.spec); gl.uniform1i(U.uN, u.geo.length);
      const g = new Float32Array(32); u.geo.forEach((v, i) => g.set(v, i * 4)); gl.uniform4fv(U.uGeo, g);
      gl.uniform3f(U.uIll, u.ill[0], u.ill[1], u.ill[2]); gl.uniform1f(U.uIllShape, u.illShape);
      gl.uniform1f(U.uGain, u.gain); gl.uniform1f(U.uContrast, u.contrast); gl.uniform1f(U.uKappa, u.kappa);
      gl.uniform1f(U.uNe, u.ne); gl.uniform1f(U.uTime, u.time); gl.uniform1f(U.uFlick, u.flick); gl.uniform1f(U.uOn, u.on);
      gl.uniform1f(U.uHole, u.hole); gl.uniform1f(U.uIsHole, u.isHole); gl.uniform1f(U.uDmgW, u.dmgW);
      // afterglow: the phosphor (and the eye) average a few frames
      gl.uniform1f(U.uPersist, u.persist ?? 0.3); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    // luminance of the frame just drawn (the green channel), for the photographic plate
    read() { gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; },
  };
}
