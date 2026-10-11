import * as THREE from 'three';
import { NOISE, CAUSTIC } from './glsl.js';

// Koi varieties. Index is used as the `type` value inside shaders.
export const VARIETIES = [
  { id: 'kohaku', name: 'Kohaku', note: 'Crimson on snow white' },
  { id: 'showa', name: 'Showa', note: 'Ink black, red & white' },
  { id: 'ogon', name: 'Golden Ogon', note: 'Metallic solid gold' },
  { id: 'platinum', name: 'Platinum', note: 'Lustrous metallic white' },
];

// ---------------------------------------------------------------------------
// Geometry. Fish face +x, body from x = +0.5 (snout) to x = -0.5 (peduncle).
// ---------------------------------------------------------------------------

function bodyWidth(s) {
  if (s < 0.32) {
    const k = (0.32 - s) / 0.335;
    return 0.15 * Math.sqrt(Math.max(0, 1 - k * k));
  }
  const t = (s - 0.32) / 0.68;
  const e = t * t * (3 - 2 * t);
  return 0.15 + (0.03 - 0.15) * Math.pow(e, 0.85);
}

function bodyHeight(s, up) {
  // Koi have a gently arched back and a flatter belly.
  return bodyWidth(s) * (up ? 0.92 : 0.72);
}

export function buildBodyGeometry(segLen = 56, segRound = 28) {
  const pos = [];
  const nrm = [];
  const body = [];
  const idx = [];
  for (let i = 0; i <= segLen; i++) {
    // Denser sampling near the snout to keep the head round.
    const u = i / segLen;
    const s = 0.004 + Math.pow(u, 1.15) * 0.996;
    const x = 0.5 - s;
    const w = bodyWidth(s);
    const ds = 0.004;
    const dw = (bodyWidth(Math.min(1, s + ds)) - bodyWidth(Math.max(0, s - ds))) / (2 * ds);
    for (let j = 0; j <= segRound; j++) {
      const a = j / segRound;
      const th = -Math.PI / 2 + a * Math.PI * 2;
      const c = Math.cos(th);
      const sn = Math.sin(th);
      const h = bodyHeight(s, sn > 0);
      const y = h * sn;
      const z = w * c;
      pos.push(x, y, z);
      // Analytic normal of the swept ellipse (cross product of the partials).
      const k = sn > 0 ? 0.92 : 0.72;
      const n = new THREE.Vector3(h * dw * c * c + w * k * dw * sn * sn, w * sn, h * c);
      if (n.lengthSq() < 1e-10) n.set(1, 0, 0);
      n.normalize();
      nrm.push(n.x, n.y, n.z);
      body.push(s, th, 0);
    }
  }
  // Close snout with a cap.
  const ring = segRound + 1;
  for (let i = 0; i < segLen; i++) {
    for (let j = 0; j < segRound; j++) {
      const a = i * ring + j;
      const b = a + ring;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const tip = pos.length / 3;
  pos.push(0.5, 0, 0);
  nrm.push(1, 0, 0);
  body.push(0, 0, 0);
  for (let j = 0; j < segRound; j++) idx.push(tip, j + 1, j);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aBody', new THREE.Float32BufferAttribute(body, 3));
  g.setIndex(idx);
  return g;
}

// Fins share one geometry: aFin = (radial 0..1, across -1..1, part id).
// part: 1 = tail, 2 = pectoral, 3 = dorsal, 4 = pelvic, 5 = barbel
export function buildFinGeometry() {
  const pos = [];
  const fin = [];
  const idx = [];

  function grid(nr, na, part, fn) {
    const base = pos.length / 3;
    for (let i = 0; i <= nr; i++) {
      for (let j = 0; j <= na; j++) {
        const r = i / nr;
        const a = (j / na) * 2 - 1;
        const p = fn(r, a);
        pos.push(p[0], p[1], p[2]);
        fin.push(r, a, part);
      }
    }
    for (let i = 0; i < nr; i++) {
      for (let j = 0; j < na; j++) {
        const a = base + i * (na + 1) + j;
        const b = a + na + 1;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }

  // Tail: a broad flowing fan with a soft fork.
  grid(14, 18, 1, (r, a) => {
    const fork = 1 - 0.22 * Math.pow(1 - Math.abs(a), 1.6);
    const len = 0.4 * fork;
    const spread = 0.025 + r * 0.25 * (0.9 + 0.1 * r);
    const x = -0.47 - r * len;
    const z = a * spread;
    const y = -Math.abs(a) * r * 0.015;
    return [x, y, z];
  });

  // Pectoral fins: large rounded paddles sweeping backwards.
  for (const side of [-1, 1]) {
    grid(8, 8, 2, (r, a) => {
      const chord = 0.13 * Math.sin(Math.PI * (0.15 + 0.85 * (1 - r * 0.6))) * (1 - r * r * 0.35);
      const span = 0.24;
      const root = [0.22, -0.035, side * 0.115];
      const dir = [-0.62, 0, side * 0.78];
      const c = (a + 1) * 0.5 - 0.5;
      const x = root[0] + dir[0] * span * r + c * chord;
      const z = root[2] + dir[2] * span * r;
      const y = root[1] - r * 0.02;
      return [x, y, z];
    });
  }

  // Pelvic fins: smaller, further back.
  for (const side of [-1, 1]) {
    grid(5, 5, 4, (r, a) => {
      const chord = 0.07 * (1 - r * 0.5);
      const root = [-0.02, -0.06, side * 0.08];
      const dir = [-0.7, -0.15, side * 0.7];
      const c = (a + 1) * 0.5 - 0.5;
      return [root[0] + dir[0] * 0.12 * r + c * chord, root[1] + dir[1] * 0.12 * r, root[2] + dir[2] * 0.12 * r];
    });
  }

  // Dorsal fin: a low ridge along the back.
  grid(4, 14, 3, (r, a) => {
    const u = (a + 1) * 0.5;
    const s = 0.36 + u * 0.38;
    const x = 0.5 - s;
    const hgt = 0.075 * Math.sin(Math.PI * Math.pow(u, 0.7)) * (1 - u * 0.3);
    const top = bodyHeight(s, true) * 0.95;
    return [x, top + r * hgt, 0];
  });

  // Barbels: tiny whiskers at the mouth.
  for (const side of [-1, 1]) {
    grid(3, 1, 5, (r, a) => {
      const w = 0.004 * (1 - r);
      return [0.47 - r * 0.03, -0.02, side * (0.03 + r * 0.045) + a * w];
    });
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aFin', new THREE.Float32BufferAttribute(fin, 3));
  g.setIndex(idx);
  return g;
}

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

const COMMON_VERT = /* glsl */ `
attribute vec4 iPos;   // x, y, z, heading
attribute vec4 iAnim;  // phase, bend, amplitude, scale
attribute vec4 iLook;  // type, seed, finPhase, aboveWater (0/1)

uniform float uTime;
uniform float uPass;   // 0 = underwater, 1 = above water, 2 = shadow
uniform vec3 uSun;
uniform float uFloorY;

float lateral(float s) {
  float sc = min(s, 1.45);
  float env = 0.035 + 0.965 * sc * sc;
  float wave = iAnim.z * env * sin(iAnim.x - sc * 5.2);
  float bend = iAnim.y * sc * sc * 0.55;
  return wave + bend;
}

// Bends a local point along the spine, returns lateral slope dz/dx.
vec3 swimDeform(vec3 p, out float slope) {
  float s = 0.5 - p.x;
  float o = lateral(s);
  float o2 = lateral(s + 0.015);
  slope = -(o2 - o) / 0.015;
  p.z += o;
  // Keep the body length roughly constant while it bends.
  p.x += -abs(o) * 0.12 * smoothstep(0.2, 1.0, s);
  return p;
}

vec3 toWorld(vec3 p) {
  float h = iPos.w;
  float cs = cos(h), sn = sin(h);
  p *= iAnim.w;
  return vec3(cs * p.x + sn * p.z, p.y, -sn * p.x + cs * p.z) + iPos.xyz;
}

vec3 dirToWorld(vec3 d) {
  float h = iPos.w;
  float cs = cos(h), sn = sin(h);
  return vec3(cs * d.x + sn * d.z, d.y, -sn * d.x + cs * d.z);
}

bool culledForPass() {
  if (uPass > 1.5) return false;
  return abs(uPass - iLook.w) > 0.5;
}

vec4 projectToShadow(vec3 wp) {
  float hgt = max(wp.y - uFloorY, 0.0);
  wp.xz -= uSun.xz / uSun.y * hgt;
  wp.y = uFloorY + 0.01;
  return projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const BODY_VERT = /* glsl */ `
attribute vec3 aBody;
${COMMON_VERT}
varying vec3 vBody;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vType;
varying float vSeed;
varying float vHeight;

void main() {
  vBody = aBody;
  vType = iLook.x;
  vSeed = iLook.y;
  if (culledForPass()) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float slope;
  vec3 p = swimDeform(position, slope);
  vec3 n = normal;
  n = normalize(vec3(n.x - slope * n.z, n.y, n.z + slope * n.x));
  vNormal = dirToWorld(n);
  vec3 wp = toWorld(p);
  vWorld = wp;
  vHeight = wp.y - uFloorY;
  if (uPass > 1.5) {
    gl_Position = projectToShadow(wp);
  } else {
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }
}
`;

const BODY_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uPass;
uniform vec3 uSun;
uniform vec3 uCam;
uniform float uOvercast;
uniform float uThumb;
varying vec3 vBody;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vType;
varying float vSeed;
varying float vHeight;

${NOISE}
${CAUSTIC}

const vec3 WHITE = vec3(0.97, 0.95, 0.91);
const vec3 RED = vec3(0.88, 0.16, 0.06);
const vec3 BLACK = vec3(0.045, 0.045, 0.055);
const vec3 GOLD = vec3(1.0, 0.68, 0.16);
const vec3 PLAT = vec3(0.88, 0.9, 0.93);

void main() {
  float s = vBody.x;
  float th = vBody.y;
  float lat = cos(th);
  float vert = sin(th);

  if (uPass > 1.5) {
    if (vert < 0.0) discard;
    float soft = smoothstep(1.0, 0.25, abs(lat)) * smoothstep(0.0, 0.08, s) ;
    float a = 0.36 * soft * clamp(1.15 - vHeight * 0.22, 0.35, 1.0);
    gl_FragColor = vec4(0.0, 0.05, 0.06, a);
    return;
  }

  int type = int(vType + 0.5);
  vec2 q = vec2(s * 3.4, lat * 0.9 + vert * 0.25) + vSeed * 13.7;
  float n1 = fbm(q);
  float n2 = fbm(q * 1.3 + 5.1);
  float topBias = smoothstep(-0.55, 0.5, vert);
  float ends = smoothstep(0.02, 0.07, s) * (1.0 - smoothstep(0.86, 0.99, s));

  vec3 base;
  float metal = 0.0;
  if (type == 0) {
    // Kohaku: crisp red patches (hi) on a snow white body.
    float m = smoothstep(0.53, 0.56, n1 + topBias * 0.12) * ends;
    float tancho = smoothstep(0.075, 0.06, length(vec2((s - 0.11) * 1.4, lat * 0.08))) * step(0.5, fract(vSeed * 7.0));
    m = max(m, tancho * topBias);
    base = mix(WHITE, RED, m);
  } else if (type == 1) {
    // Showa: sumi black base with red and white blocks.
    float r = smoothstep(0.54, 0.57, n1 + topBias * 0.08) * ends;
    float w = smoothstep(0.55, 0.58, n2 - topBias * 0.05) * (1.0 - r);
    base = BLACK;
    base = mix(base, WHITE, w);
    base = mix(base, RED, r);
  } else if (type == 2) {
    float g = 0.82 + 0.18 * topBias;
    base = GOLD * g + vec3(0.12, 0.06, 0.0) * n1;
    metal = 1.0;
  } else {
    base = PLAT * (0.9 + 0.1 * topBias) + vec3(0.02, 0.03, 0.05) * n1;
    metal = 1.0;
  }

  // Lighter belly.
  base = mix(base, WHITE * 0.95, smoothstep(-0.2, -0.85, vert) * 0.55);

  // Scales: overlapping arcs pointing toward the tail.
  float scaleZone = smoothstep(0.17, 0.24, s) * (1.0 - smoothstep(0.95, 1.0, s));
  vec2 sg = vec2(s * 34.0, th * 9.5);
  float row = floor(sg.x);
  sg.y += mod(row, 2.0) * 0.5;
  vec2 cell = fract(sg) - vec2(0.0, 0.5);
  float sd = length(cell * vec2(1.0, 1.15));
  float edge = smoothstep(0.62, 0.9, sd) * scaleZone;
  float sid = hash12(vec2(row, floor(sg.y)));
  base *= 1.0 - edge * (metal > 0.5 ? 0.18 : 0.13);
  // Fukurin: lighter scale rims on metallic koi.
  base += edge * metal * 0.08;

  // Gill plate line.
  float gill = smoothstep(0.012, 0.0, abs(s - 0.2 + abs(lat) * 0.015)) * smoothstep(0.1, 0.5, abs(lat));
  base *= 1.0 - gill * 0.25;

  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCam - vWorld);
  vec3 L = uSun;
  float sunAmt = 1.0 - uOvercast * 0.6;
  float diff = clamp(dot(N, L) * 0.6 + 0.45, 0.0, 1.0);
  vec3 H = normalize(L + V);
  float specPow = metal > 0.5 ? 70.0 : 40.0;
  float spec = pow(max(dot(N, H), 0.0), specPow) * (metal > 0.5 ? 1.2 : 0.35);
  spec *= 0.7 + 0.6 * sid * scaleZone;
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);

  vec3 col = base * (0.42 + 0.7 * diff * sunAmt);
  vec3 specCol = metal > 0.5 ? mix(base, vec3(1.0), 0.35) : vec3(1.0);
  col += specCol * spec * sunAmt;
  col += base * rim * (metal > 0.5 ? 0.45 : 0.18);
  if (metal > 0.5) {
    // Fake environment sheen sliding across the metallic scales.
    float env = 0.5 + 0.5 * sin(dot(N, vec3(3.0, 2.0, 4.0)) * 2.0 + vSeed * 6.0);
    col += base * env * 0.18;
  }

  // Eyes, set high on the sides of the head.
  float eyeR = 0.024;
  float hw = 0.107;
  float dR = length(vec2(s - 0.085, (th - 0.55) * hw));
  float dL = length(vec2(s - 0.085, (th - (3.14159 - 0.55)) * hw));
  float de = min(dR, dL);
  float eye = smoothstep(eyeR, eyeR * 0.8, de);
  vec3 eyeCol = mix(vec3(0.0), vec3(0.55, 0.42, 0.15), smoothstep(eyeR * 0.45, eyeR * 0.75, de));
  eyeCol += vec3(1.0) * smoothstep(0.009, 0.004, length(vec2(s - 0.08, (th - (dR < dL ? 0.6 : 3.14159 - 0.5)) * hw)));
  col = mix(col, eyeCol, eye);

  // Mouth: slight pink at the snout.
  col = mix(col, col * vec3(1.0, 0.82, 0.78), smoothstep(0.04, 0.0, s) * 0.6);

  if (uThumb < 0.5) {
    // Caustic light dancing over the back.
    float c = caustic(vWorld.xz * 0.24, uTime * 0.55);
    col += col * c * 0.35 * max(N.y, 0.0) * sunAmt;
    // Depth haze: deeper fish fade into the teal water.
    float depth = max(-vWorld.y, 0.0);
    float fog = 1.0 - exp(-depth * 0.42);
    col = mix(col * vec3(0.92, 1.0, 1.0), vec3(0.04, 0.3, 0.34), fog * 0.72);
    col *= mix(vec3(1.0), vec3(0.8, 0.97, 1.0), clamp(depth * 0.5, 0.0, 1.0));
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

const FIN_VERT = /* glsl */ `
attribute vec3 aFin;
${COMMON_VERT}
varying vec3 vFin;
varying vec3 vWorld;
varying float vType;
varying float vSeed;
varying float vHeight;

void main() {
  vFin = aFin;
  vType = iLook.x;
  vSeed = iLook.y;
  if (culledForPass()) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 p = position;
  float part = aFin.z;
  float r = aFin.x;
  float fp = iLook.z;

  if (part < 1.5) {
    // Tail: lags behind the body wave and ripples along its edge.
    p.y += sin(uTime * 4.0 + r * 4.0 + aFin.y * 3.0 + iLook.y * 10.0) * 0.018 * r;
    p.z += sin(iAnim.x - 6.5 - r * 1.8) * iAnim.z * 0.6 * r;
  } else if (part < 2.5) {
    float side = sign(p.z);
    float flap = sin(fp + side * 0.6) * 0.5 + 0.5;
    p.y += (flap - 0.4) * 0.07 * r;
    // Fold the fins in when cruising fast.
    float fold = clamp(iAnim.z * 3.0, 0.0, 0.6);
    p.z -= side * fold * 0.07 * r;
    p.x -= fold * 0.03 * r;
  } else if (part < 3.5) {
    p.z += sin(iAnim.x - 3.0 + aFin.y) * 0.01 * r;
  } else if (part < 4.5) {
    p.y += sin(fp * 1.3 + 1.0) * 0.02 * r;
  } else {
    p.z += sin(uTime * 3.0 + iLook.y * 5.0) * 0.008 * r;
  }

  float slope;
  p = swimDeform(p, slope);
  vec3 wp = toWorld(p);
  vWorld = wp;
  vHeight = wp.y - uFloorY;
  if (uPass > 1.5) {
    gl_Position = projectToShadow(wp);
  } else {
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }
}
`;

const FIN_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uPass;
uniform float uOvercast;
uniform float uThumb;
varying vec3 vFin;
varying vec3 vWorld;
varying float vType;
varying float vSeed;
varying float vHeight;

${NOISE}
${CAUSTIC}

void main() {
  float r = vFin.x;
  float a = vFin.y;
  float part = vFin.z;
  float edgeA = 1.0 - smoothstep(0.75, 1.0, abs(a));
  float tipA = 1.0 - smoothstep(0.82, 1.0, r);

  if (uPass > 1.5) {
    if (part > 2.5 && part < 3.5) discard;
    float al = 0.2 * edgeA * tipA * clamp(1.1 - vHeight * 0.2, 0.3, 1.0);
    gl_FragColor = vec4(0.0, 0.05, 0.06, al);
    return;
  }

  int type = int(vType + 0.5);
  vec3 c;
  float rays = 0.5 + 0.5 * sin(a * (part < 1.5 ? 46.0 : 28.0) + r * 2.0);
  if (type == 0) {
    c = vec3(0.97, 0.95, 0.92);
    c = mix(c, vec3(0.9, 0.3, 0.2), step(0.7, fract(vSeed * 3.0)) * smoothstep(0.4, 0.0, r) * 0.6 * step(part, 1.5));
  } else if (type == 1) {
    // Showa fins: white with black bases and black streaks.
    c = vec3(0.92, 0.92, 0.9);
    float base = smoothstep(0.55, 0.15, r);
    c = mix(c, vec3(0.03), base * (part > 1.5 && part < 2.5 ? 1.0 : 0.6));
    c = mix(c, vec3(0.05), smoothstep(0.75, 0.95, rays) * 0.35);
  } else if (type == 2) {
    c = vec3(1.0, 0.72, 0.22) * (0.85 + 0.25 * rays);
  } else {
    c = vec3(0.9, 0.92, 0.95) * (0.88 + 0.18 * rays);
  }
  c *= 0.9 + 0.12 * rays;

  float alpha = (0.42 + 0.35 * (1.0 - r)) * edgeA * tipA;
  if (part > 4.5) alpha = 0.7;
  if (part > 2.5 && part < 3.5) alpha *= 0.7;
  alpha *= 0.85 + 0.15 * rays;
  // Delicate translucent membrane near the edge.
  alpha *= 1.0 - 0.35 * smoothstep(0.5, 1.0, r);

  vec3 col = c * (0.55 + 0.45 * (1.0 - uOvercast * 0.6));
  if (uThumb < 0.5) {
    float cs = caustic(vWorld.xz * 0.24, uTime * 0.55);
    col += col * cs * 0.3;
    float depth = max(-vWorld.y, 0.0);
    float fog = 1.0 - exp(-depth * 0.42);
    col = mix(col, vec3(0.04, 0.3, 0.34), fog * 0.72);
  }
  gl_FragColor = vec4(col, alpha);
}
`;

export function createBodyMaterial(pass, shared) {
  const m = new THREE.ShaderMaterial({
    vertexShader: BODY_VERT,
    fragmentShader: BODY_FRAG,
    uniforms: { ...shared, uPass: { value: pass } },
    transparent: pass === 2,
    depthWrite: pass !== 2,
  });
  if (pass === 2) m.depthTest = false;
  return m;
}

export function createFinMaterial(pass, shared) {
  return new THREE.ShaderMaterial({
    vertexShader: FIN_VERT,
    fragmentShader: FIN_FRAG,
    uniforms: { ...shared, uPass: { value: pass } },
    transparent: true,
    depthWrite: false,
    depthTest: pass !== 2,
    side: THREE.DoubleSide,
  });
}
