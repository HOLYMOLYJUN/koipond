import * as THREE from 'three';
import { NOISE } from './glsl.js';

const MAX_DROPS = 24;
export const MAX_RINGS = 24;

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const SIM_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tPrev;
uniform vec2 uRes;
uniform float uDamp;
uniform vec4 uDrops[${MAX_DROPS}];
uniform int uDropCount;
uniform vec4 uVortex;   // uv.x, uv.y, radius (cells), strength 0..1
uniform float uSpin;
varying vec2 vUv;

void main() {
  vec2 texel = 1.0 / uRes;
  vec2 uv = vUv;

  // Rotational advection around the vortex: ripples get dragged into a spiral.
  float vr = 1.0;
  if (uVortex.w > 0.001) {
    vec2 d = (uv - uVortex.xy) * uRes;
    float r = length(d) / uVortex.z;
    float fall = exp(-r * r * 1.6);
    float ang = -uSpin * uVortex.w * fall;
    float cs = cos(ang), sn = sin(ang);
    d = mat2(cs, sn, -sn, cs) * d;
    uv = uVortex.xy + d * texel;
    vr = r;
  }

  vec4 info = texture2D(tPrev, uv);
  float avg = (
    texture2D(tPrev, uv - vec2(texel.x, 0.0)).r +
    texture2D(tPrev, uv + vec2(texel.x, 0.0)).r +
    texture2D(tPrev, uv - vec2(0.0, texel.y)).r +
    texture2D(tPrev, uv + vec2(0.0, texel.y)).r
  ) * 0.25;

  info.g += (avg - info.r) * 2.0;
  info.g *= uDamp;
  info.r += info.g;
  info.r *= 0.9985;

  // Soft absorbing border so screen edges do not act like hard walls.
  vec2 e = min(vUv, 1.0 - vUv) * uRes;
  float edge = smoothstep(0.0, 10.0, min(e.x, e.y));
  info.g *= mix(0.9, 1.0, edge);
  info.r *= mix(0.94, 1.0, edge);

  for (int i = 0; i < ${MAX_DROPS}; i++) {
    if (i >= uDropCount) break;
    vec4 dr = uDrops[i];
    float dist = length((vUv - dr.xy) * uRes) / dr.z;
    float drop = max(0.0, 1.0 - dist);
    drop = 0.5 - cos(drop * 3.14159265) * 0.5;
    info.r += drop * dr.w;
  }

  // The vortex keeps a funnel-shaped dip in the surface.
  if (uVortex.w > 0.001) {
    float dip = -0.55 * uVortex.w * exp(-vr * vr * 3.0);
    info.r = mix(info.r, dip, 0.035 * uVortex.w);
  }

  gl_FragColor = info;
}
`;

export class WaterSim {
  constructor(renderer) {
    this.renderer = renderer;
    this.drops = [];
    this.dropUniform = Array.from({ length: MAX_DROPS }, () => new THREE.Vector4());
    this.material = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: SIM_FRAG,
      uniforms: {
        tPrev: { value: null },
        uRes: { value: new THREE.Vector2(1, 1) },
        uDamp: { value: 0.993 },
        uDrops: { value: this.dropUniform },
        uDropCount: { value: 0 },
        uVortex: { value: new THREE.Vector4() },
        uSpin: { value: 0.012 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.targets = [];
    this.current = 0;
    this.width = 1;
    this.height = 1;
    this.accum = 0;
  }

  // worldW/worldH: size of the visible water surface in world units.
  resize(worldW, worldH) {
    const cells = 230 * 230;
    const aspect = worldW / worldH;
    const w = Math.max(64, Math.round(Math.sqrt(cells * aspect)));
    const h = Math.max(64, Math.round(Math.sqrt(cells / aspect)));
    this.worldW = worldW;
    this.worldH = worldH;
    this.cellsPerUnit = w / worldW;
    if (w === this.width && h === this.height && this.targets.length) return;
    this.targets.forEach((t) => t.dispose());
    const opts = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    };
    this.targets = [new THREE.WebGLRenderTarget(w, h, opts), new THREE.WebGLRenderTarget(w, h, opts)];
    this.width = w;
    this.height = h;
    this.material.uniforms.uRes.value.set(w, h);
    this.clear();
  }

  clear() {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const cc = r.getClearColor(new THREE.Color());
    const ca = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    for (const t of this.targets) {
      r.setRenderTarget(t);
      r.clear(true, false, false);
    }
    r.setRenderTarget(prev);
    r.setClearColor(cc, ca);
  }

  get texture() {
    return this.targets[this.current].texture;
  }

  // x, z in world units; radius in world units; strength: negative = dent.
  addDrop(x, z, radius, strength) {
    if (this.drops.length >= MAX_DROPS * 3) return;
    this.drops.push([x / this.worldW + 0.5, z / this.worldH + 0.5, Math.max(1.5, radius * this.cellsPerUnit), strength]);
  }

  setVortex(active, x, z, radius, strength) {
    const v = this.material.uniforms.uVortex.value;
    if (!active || strength <= 0.001) {
      v.w = 0;
      return;
    }
    v.set(x / this.worldW + 0.5, z / this.worldH + 0.5, radius * this.cellsPerUnit, strength);
  }

  step(dt, damp) {
    this.material.uniforms.uDamp.value = damp;
    this.accum += Math.min(dt, 0.05);
    const stepTime = 1 / 120;
    let steps = 0;
    const r = this.renderer;
    const prev = r.getRenderTarget();
    while (this.accum >= stepTime && steps < 4) {
      this.accum -= stepTime;
      steps++;
      const n = Math.min(MAX_DROPS, this.drops.length);
      for (let i = 0; i < n; i++) this.dropUniform[i].fromArray(this.drops[i]);
      this.drops.splice(0, n);
      this.material.uniforms.uDropCount.value = n;
      this.material.uniforms.tPrev.value = this.targets[this.current].texture;
      const next = 1 - this.current;
      r.setRenderTarget(this.targets[next]);
      r.render(this.scene, this.camera);
      this.current = next;
    }
    if (this.accum > stepTime * 4) this.accum = 0;
    r.setRenderTarget(prev);
  }
}

const SURFACE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tScene;
uniform sampler2D tHeight;
uniform vec2 uSimTexel;
uniform vec2 uWorld;
uniform vec3 uCam;
uniform vec3 uSun;
uniform float uTime;
uniform float uOvercast;
uniform float uCalm;
uniform vec4 uVortex;     // x, z, radius, strength
uniform vec4 uRings[${MAX_RINGS}];
uniform vec2 uResolution;
varying vec2 vUv;

${NOISE}

vec3 skyColor(vec3 r) {
  vec3 top = mix(vec3(0.78, 0.9, 0.98), vec3(0.62, 0.68, 0.74), uOvercast);
  vec3 hor = mix(vec3(0.95, 0.98, 1.0), vec3(0.78, 0.8, 0.84), uOvercast);
  vec3 c = mix(hor, top, clamp(r.y, 0.0, 1.0));
  // Drifting clouds and the silhouette of overhanging leaves.
  vec2 q = r.xz / max(r.y, 0.25) * 3.0;
  float cl = fbm(q * 0.6 + vec2(uTime * 0.01, 0.0));
  c = mix(c, vec3(1.0), smoothstep(0.45, 0.85, cl) * 0.6);
  float leaves = smoothstep(0.62, 0.7, fbm(q * 1.3 + 11.0)) * smoothstep(0.75, 0.4, r.y);
  c = mix(c, vec3(0.08, 0.16, 0.1), leaves * 0.85);
  return c;
}

void main() {
  vec2 world = vec2((vUv.x - 0.5) * uWorld.x, (0.5 - vUv.y) * uWorld.y);
  vec2 suv = vec2(vUv.x, 1.0 - vUv.y);

  float hL = texture2D(tHeight, suv - vec2(uSimTexel.x, 0.0)).r;
  float hR = texture2D(tHeight, suv + vec2(uSimTexel.x, 0.0)).r;
  float hD = texture2D(tHeight, suv - vec2(0.0, uSimTexel.y)).r;
  float hU = texture2D(tHeight, suv + vec2(0.0, uSimTexel.y)).r;
  float h = texture2D(tHeight, suv).r;
  vec2 grad = vec2(hR - hL, hU - hD);

  // Fine wind ripples so the surface is never perfectly glassy.
  float wind = (1.0 - uCalm * 0.75) * (0.6 + uOvercast * 0.8);
  vec2 wp = world * 2.2;
  float e = 0.05;
  float n0 = vnoise(wp + vec2(uTime * 0.35, uTime * 0.21)) + vnoise(wp * 1.9 - vec2(uTime * 0.27, -uTime * 0.31)) * 0.5;
  float nx = vnoise(wp + vec2(e, 0.0) + vec2(uTime * 0.35, uTime * 0.21)) + vnoise((wp + vec2(e, 0.0)) * 1.9 - vec2(uTime * 0.27, -uTime * 0.31)) * 0.5;
  float nz = vnoise(wp + vec2(0.0, e) + vec2(uTime * 0.35, uTime * 0.21)) + vnoise((wp + vec2(0.0, e)) * 1.9 - vec2(uTime * 0.27, -uTime * 0.31)) * 0.5;
  grad += vec2(nx - n0, nz - n0) * 0.012 * wind;

  // Vortex: swirl the view of the pond floor and draw spiral streaks.
  vec2 swirlOffset = vec2(0.0);
  float spiral = 0.0;
  float funnel = 0.0;
  if (uVortex.w > 0.001) {
    vec2 d = world - uVortex.xy;
    float r = length(d);
    float rr = r / uVortex.z;
    float fall = exp(-rr * rr * 1.4);
    float ang = uVortex.w * fall * (1.6 + 0.4 * sin(uTime * 0.7));
    float cs = cos(ang), sn = sin(ang);
    vec2 rd = mat2(cs, sn, -sn, cs) * d;
    vec2 delta = rd - d;
    swirlOffset = vec2(delta.x / uWorld.x, -delta.y / uWorld.y);
    float a = atan(d.y, d.x);
    float arms = sin(a * 3.0 + log(r + 0.05) * 5.5 + uTime * 3.2);
    spiral = smoothstep(0.55, 1.0, arms) * fall * smoothstep(0.05, 0.5, rr) * uVortex.w;
    funnel = exp(-rr * rr * 6.0) * uVortex.w;
    vec2 tang = vec2(-d.y, d.x) / max(r, 0.001);
    grad += tang * fall * 0.02 * uVortex.w * (0.6 + 0.4 * arms);
  }

  vec3 N = normalize(vec3(-grad.x * 9.0, 1.0, -grad.y * 9.0));

  vec2 refr = vec2(N.x, -N.z) * 0.085 + swirlOffset;
  // Gentle chromatic dispersion where the surface is disturbed.
  float disp = 0.0025 + length(grad) * 0.04;
  vec3 under;
  under.r = texture2D(tScene, vUv + refr * (1.0 + disp * 4.0)).r;
  under.g = texture2D(tScene, vUv + refr).g;
  under.b = texture2D(tScene, vUv + refr * (1.0 - disp * 4.0)).b;

  // Absorption & in-scattering of the water column.
  vec3 scatter = mix(vec3(0.02, 0.42, 0.46), vec3(0.06, 0.28, 0.31), uOvercast);
  under = mix(under, scatter, 0.12 + funnel * 0.35);
  under *= 1.0 - funnel * 0.35;

  vec3 P = vec3(world.x, 0.0, world.y);
  vec3 V = normalize(uCam - P);
  vec3 R = reflect(-V, N);
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  fres = clamp(fres * 1.6, 0.0, 1.0);
  vec3 sky = skyColor(R);
  vec3 col = mix(under, sky, fres);

  float sunAmt = 1.0 - uOvercast * 0.75;
  float sd = max(dot(R, uSun), 0.0);
  float spec = pow(sd, 2500.0) * 4.0 + pow(sd, 700.0) * 0.18 + pow(sd, 60.0) * 0.05 + pow(sd, 8.0) * 0.035;
  col += vec3(1.0, 0.96, 0.86) * spec * sunAmt;

  // Ripple highlights: crests catch a bit more light.
  col += vec3(0.85, 1.0, 1.0) * clamp(h * 0.25, 0.0, 0.12);

  // Expanding foam rings from splashes and drops.
  float foam = 0.0;
  for (int i = 0; i < ${MAX_RINGS}; i++) {
    vec4 rg = uRings[i];
    if (rg.w <= 0.001) continue;
    float d = length(world - rg.xy);
    float w = 0.025 + rg.z * 0.04;
    float ring = exp(-pow((d - rg.z) / w, 2.0));
    float inner = exp(-pow((d - rg.z * 0.62) / (w * 1.4), 2.0)) * 0.35;
    foam += (ring + inner) * rg.w;
  }
  float foamNoise = 0.65 + 0.35 * vnoise(world * 18.0);
  col += vec3(0.92, 0.98, 1.0) * clamp(foam, 0.0, 1.0) * 0.55 * foamNoise;
  col += vec3(0.85, 0.97, 1.0) * spiral * 0.28;

  // Vignette suggests the darker, deeper banks of the pond.
  vec2 vv = vUv - 0.5;
  vv.x *= uResolution.x / uResolution.y;
  float vig = smoothstep(1.25, 0.35, length(vv));
  col *= mix(0.7, 1.0, vig);
  col = mix(col, col * vec3(0.9, 1.0, 1.02), 0.3);

  gl_FragColor = vec4(col, 1.0);
}
`;

export function createSurfaceMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: QUAD_VERT,
    fragmentShader: SURFACE_FRAG,
    uniforms: {
      tScene: { value: null },
      tHeight: { value: null },
      uSimTexel: { value: new THREE.Vector2() },
      uWorld: { value: new THREE.Vector2(1, 1) },
      uCam: { value: new THREE.Vector3() },
      uSun: { value: new THREE.Vector3() },
      uTime: { value: 0 },
      uOvercast: { value: 0 },
      uCalm: { value: 0 },
      uVortex: { value: new THREE.Vector4() },
      uRings: { value: Array.from({ length: MAX_RINGS }, () => new THREE.Vector4()) },
      uResolution: { value: new THREE.Vector2(1, 1) },
    },
    depthTest: false,
    depthWrite: false,
  });
}
