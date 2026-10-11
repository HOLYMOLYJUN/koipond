import * as THREE from 'three';
import { NOISE } from './glsl.js';

// ---------------------------------------------------------------------------
// Splash droplets: CPU-simulated point sprites drawn above the surface.
// ---------------------------------------------------------------------------

const DROP_VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
uniform float uScale;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const DROP_FRAG = /* glsl */ `
precision highp float;
varying float vAlpha;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d = dot(p, p);
  if (d > 1.0) discard;
  float edge = smoothstep(1.0, 0.55, d);
  float hl = smoothstep(0.25, 0.0, length(p - vec2(-0.35, -0.35)));
  vec3 col = mix(vec3(0.75, 0.93, 0.97), vec3(1.0), hl);
  float ring = smoothstep(0.35, 0.95, d) * 0.6;
  gl_FragColor = vec4(col, clamp(edge * (0.55 + ring) + hl, 0.0, 1.0) * vAlpha);
}
`;

export class Droplets {
  constructor(max = 1400) {
    this.max = max;
    this.count = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.geometry = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('aSize', this.sizeAttr);
    this.geometry.setAttribute('aAlpha', this.alphaAttr);
    this.material = new THREE.ShaderMaterial({
      vertexShader: DROP_VERT,
      fragmentShader: DROP_FRAG,
      uniforms: { uScale: { value: 300 } },
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    this.landed = [];
  }

  emit(x, y, z, vx, vy, vz, size, life) {
    if (this.count >= this.max) return;
    const i = this.count++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.size[i] = size;
    this.life[i] = life;
    this.alpha[i] = 1;
  }

  burst(x, z, power) {
    const n = Math.round(46 * power);
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (0.6 + Math.random() * 2.4) * power;
      const up = (2.2 + Math.random() * 4.0) * power;
      const r = Math.random() * 0.25 * power;
      this.emit(x + Math.cos(a) * r, 0.02, z + Math.sin(a) * r, Math.cos(a) * sp, up, Math.sin(a) * sp,
        0.07 + Math.random() * 0.12 * power, 0.5 + Math.random() * 0.9);
    }
    // A crown of finer spray.
    const m = Math.round(28 * power);
    for (let k = 0; k < m; k++) {
      const a = (k / m) * Math.PI * 2 + Math.random() * 0.2;
      const sp = 1.6 * power + Math.random() * 0.6;
      this.emit(x + Math.cos(a) * 0.3 * power, 0.02, z + Math.sin(a) * 0.3 * power,
        Math.cos(a) * sp, 1.8 + Math.random() * 1.6, Math.sin(a) * sp, 0.05 + Math.random() * 0.05, 0.5 + Math.random() * 0.4);
    }
  }

  sprinkle(x, z, power) {
    const n = 3 + Math.round(Math.random() * 3);
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.3 + Math.random() * 0.6;
      this.emit(x, 0.01, z, Math.cos(a) * sp, 0.8 + Math.random() * 1.2 * power, Math.sin(a) * sp, 0.035 + Math.random() * 0.03, 0.4);
    }
  }

  update(dt) {
    this.landed.length = 0;
    let i = 0;
    while (i < this.count) {
      const b = i * 3;
      this.vel[b + 1] -= 9.8 * dt;
      this.pos[b] += this.vel[b] * dt;
      this.pos[b + 1] += this.vel[b + 1] * dt;
      this.pos[b + 2] += this.vel[b + 2] * dt;
      this.life[i] -= dt;
      this.alpha[i] = Math.min(1, this.life[i] * 3);
      if (this.pos[b + 1] < 0 || this.life[i] <= 0) {
        if (this.pos[b + 1] < 0 && this.size[i] > 0.1) this.landed.push(this.pos[b], this.pos[b + 2], this.size[i]);
        // Swap-remove with the last live particle.
        const last = --this.count;
        if (i !== last) {
          const lb = last * 3;
          this.pos[b] = this.pos[lb]; this.pos[b + 1] = this.pos[lb + 1]; this.pos[b + 2] = this.pos[lb + 2];
          this.vel[b] = this.vel[lb]; this.vel[b + 1] = this.vel[lb + 1]; this.vel[b + 2] = this.vel[lb + 2];
          this.life[i] = this.life[last]; this.size[i] = this.size[last]; this.alpha[i] = this.alpha[last];
        }
        continue;
      }
      i++;
    }
    this.geometry.setDrawRange(0, this.count);
    this.posAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    return this.landed;
  }

  clear() {
    this.count = 0;
    this.geometry.setDrawRange(0, 0);
  }
}

// ---------------------------------------------------------------------------
// Lily pads floating on the surface, bobbing on the live height field.
// ---------------------------------------------------------------------------

const PAD_VERT = /* glsl */ `
uniform sampler2D tHeight;
uniform vec2 uWorld;
varying vec2 vLocal;
varying vec3 vWorld;
void main() {
  vLocal = position.xy;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec2 suv = wp.xz / uWorld + 0.5;
  float h = texture2D(tHeight, suv).r;
  wp.y += 0.03 + h * 0.05;
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const PAD_FRAG = /* glsl */ `
precision highp float;
uniform float uSeed;
uniform float uOvercast;
varying vec2 vLocal;
varying vec3 vWorld;
${NOISE}
void main() {
  float r = length(vLocal);
  float a = atan(vLocal.y, vLocal.x);
  // Notch cut toward the centre.
  float notch = abs(a - 0.3);
  if (notch < 0.13 * smoothstep(0.0, 0.85, r) + 0.002 && r > 0.04) discard;
  float edgeWob = 0.97 + 0.03 * vnoise(vec2(a * 6.0, uSeed));
  if (r > edgeWob) discard;

  vec3 green = mix(vec3(0.16, 0.42, 0.14), vec3(0.32, 0.56, 0.2), fbm(vLocal * 3.0 + uSeed));
  float veins = smoothstep(0.92, 1.0, 0.5 + 0.5 * cos(a * 22.0 + sin(r * 6.0) * 0.4)) * smoothstep(0.08, 0.3, r);
  green = mix(green, vec3(0.45, 0.66, 0.3), veins * 0.45);
  float rim = smoothstep(edgeWob - 0.07, edgeWob, r);
  green = mix(green, vec3(0.52, 0.42, 0.16), rim * 0.55);
  // Weathered spots.
  float spots = smoothstep(0.72, 0.8, vnoise(vLocal * 8.0 + uSeed * 3.0));
  green = mix(green, vec3(0.45, 0.35, 0.12), spots * 0.4);
  // Raised centre catches light; a wet sheen on one side.
  float sheen = smoothstep(0.5, 0.0, length(vLocal - vec2(0.25, 0.2))) * 0.22;
  vec3 col = green * (0.85 + 0.25 * (1.0 - r)) + vec3(0.9, 1.0, 0.85) * sheen;
  col *= 1.0 - uOvercast * 0.3;
  // Shadow the water just beneath the rim.
  float alpha = smoothstep(edgeWob, edgeWob - 0.02, r);
  gl_FragColor = vec4(col, alpha);
}
`;

const FLOWER_VERT = /* glsl */ `
attribute vec3 aPetal; // ring, angle, petal-uv-y
varying vec3 vPetal;
varying vec2 vUv;
void main() {
  vPetal = aPetal;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FLOWER_FRAG = /* glsl */ `
precision highp float;
uniform float uOvercast;
varying vec3 vPetal;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  if (vPetal.x > 2.5) {
    float d = length(p);
    if (d > 1.0) discard;
    vec3 c = mix(vec3(1.0, 0.85, 0.2), vec3(0.95, 0.65, 0.1), d);
    gl_FragColor = vec4(c, 1.0);
    return;
  }
  if (abs(p.x) > sin(vUv.y * 3.14159) * (0.95 - vUv.y * 0.25)) discard;
  vec3 tip = vec3(0.96, 0.45, 0.62);
  vec3 base = vec3(1.0, 0.95, 0.96);
  vec3 c = mix(base, tip, smoothstep(0.3, 1.0, vUv.y));
  c *= 0.85 + 0.15 * (1.0 - abs(p.x));
  c *= 0.82 + vPetal.x * 0.09;
  c *= 1.0 - uOvercast * 0.25;
  gl_FragColor = vec4(c, 1.0);
}
`;

function buildFlower() {
  const pos = [];
  const uv = [];
  const petal = [];
  const idx = [];
  const rings = [
    { n: 8, len: 0.36, w: 0.15, tilt: 0.35, rot: 0 },
    { n: 7, len: 0.3, w: 0.13, tilt: 0.75, rot: 0.3 },
    { n: 6, len: 0.22, w: 0.1, tilt: 1.1, rot: 0.1 },
  ];
  const seg = 4;
  rings.forEach((ring, ri) => {
    for (let k = 0; k < ring.n; k++) {
      const ang = (k / ring.n) * Math.PI * 2 + ring.rot;
      const dir = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      const base = pos.length / 3;
      for (let i = 0; i <= seg; i++) {
        const t = i / seg;
        // Cupped petal: rises as it goes out.
        const out = Math.cos(ring.tilt * t * 1.2) * ring.len * t;
        const up = Math.sin(ring.tilt * t * 1.2 + ring.tilt * 0.4) * ring.len * t * 0.9 + 0.02 * ri;
        for (let j = 0; j <= 1; j++) {
          const sx = (j * 2 - 1) * ring.w;
          const p = dir.clone().multiplyScalar(out).addScaledVector(side, sx);
          pos.push(p.x, up, p.z);
          uv.push(j, t);
          petal.push(ri, ang, t);
        }
      }
      for (let i = 0; i < seg; i++) {
        const a = base + i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  });
  // Golden centre.
  const c = pos.length / 3;
  const cr = 0.07;
  pos.push(-cr, 0.12, -cr, cr, 0.12, -cr, -cr, 0.12, cr, cr, 0.12, cr);
  uv.push(0, 0, 1, 0, 0, 1, 1, 1);
  for (let i = 0; i < 4; i++) petal.push(3, 0, 0);
  idx.push(c, c + 2, c + 1, c + 1, c + 2, c + 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aPetal', new THREE.Float32BufferAttribute(petal, 3));
  g.setIndex(idx);
  return g;
}

export class LilyPads {
  constructor(shared) {
    this.group = new THREE.Group();
    this.group.renderOrder = 5;
    this.pads = [];
    this.shared = shared;
    const geo = new THREE.CircleGeometry(1, 64);
    const flowerGeo = buildFlower();
    const layout = [
      { u: 0.1, v: 0.16, r: 0.95, flower: true },
      { u: 0.2, v: 0.08, r: 0.6 },
      { u: 0.9, v: 0.82, r: 1.05 },
      { u: 0.8, v: 0.92, r: 0.62, flower: true },
      { u: 0.93, v: 0.12, r: 0.7 },
    ];
    layout.forEach((l, i) => {
      const mat = new THREE.ShaderMaterial({
        vertexShader: PAD_VERT,
        fragmentShader: PAD_FRAG,
        uniforms: {
          tHeight: shared.tHeight,
          uWorld: shared.uWorld,
          uOvercast: shared.uOvercast,
          uSeed: { value: i * 3.7 + 1.0 },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.renderOrder = 5;
      const pivot = new THREE.Group();
      pivot.add(mesh);
      let flower = null;
      if (l.flower) {
        flower = new THREE.Mesh(flowerGeo, new THREE.ShaderMaterial({
          vertexShader: FLOWER_VERT,
          fragmentShader: FLOWER_FRAG,
          uniforms: { uOvercast: shared.uOvercast },
          side: THREE.DoubleSide,
        }));
        flower.position.set(-0.15 * l.r, 0.03, 0.1 * l.r);
        flower.scale.setScalar(Math.min(1.2, 0.9 + l.r * 0.3));
        flower.renderOrder = 6;
        pivot.add(flower);
      }
      this.group.add(pivot);
      this.pads.push({ ...l, pivot, mesh, flower, phase: Math.random() * 6, drift: (Math.random() - 0.5) * 0.04, x: 0, z: 0, rot: Math.random() * 6 });
    });
  }

  layout(W, H) {
    for (const p of this.pads) {
      p.x = (p.u - 0.5) * W;
      p.z = (p.v - 0.5) * H;
      p.pivot.scale.setScalar(p.r);
    }
  }

  update(t, dt, vortex) {
    for (const p of this.pads) {
      p.rot += p.drift * dt;
      let ox = Math.sin(t * 0.3 + p.phase) * 0.05;
      let oz = Math.cos(t * 0.23 + p.phase) * 0.05;
      if (vortex && vortex.strength > 0.01) {
        // Pads feel the vortex too, but are tethered by their stems.
        const dx = p.x - vortex.x, dz = p.z - vortex.z;
        const d = Math.hypot(dx, dz);
        const f = Math.exp(-(d * d) / (vortex.radius * vortex.radius * 2)) * vortex.strength;
        p.rot += f * 0.6 * dt;
        ox += (dz / (d + 0.01)) * f * 0.25;
        oz += (-dx / (d + 0.01)) * f * 0.25;
      }
      p.pivot.position.set(p.x + ox, 0, p.z + oz);
      p.pivot.rotation.y = p.rot;
    }
  }

  writeShadows(arr) {
    for (let i = 0; i < arr.length; i++) {
      const p = this.pads[i];
      if (p) arr[i].set(p.pivot.position.x, p.pivot.position.z, p.r * 0.97, 1);
      else arr[i].set(0, 0, 0, 0);
    }
  }
}
