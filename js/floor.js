import * as THREE from 'three';
import { NOISE, CAUSTIC, DAPPLE } from './glsl.js';

export const MAX_PADS = 6;

const VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform sampler2D tHeight;
uniform vec2 uWorld;
uniform vec2 uSimTexel;
uniform vec3 uSun;
uniform float uOvercast;
uniform vec4 uPads[${MAX_PADS}];
uniform float uDepth;
uniform sampler2D tAlbedo;
uniform vec2 uFloorSize;
varying vec3 vWorld;

${NOISE}
${CAUSTIC}
${DAPPLE}

void main() {
  vec2 p = vWorld.xz;
  vec2 auv = vec2(p.x / uFloorSize.x + 0.5, p.y / uFloorSize.y + 0.5);
  vec3 col = texture2D(tAlbedo, auv).rgb;

  // Sunlight: dappled by leaves, focused by the moving surface.
  float sunAmt = 1.0 - uOvercast * 0.7;
  float light = 0.48 + 0.52 * dapple(p, uTime) * sunAmt;

  // Offset caustic lookup a little toward the sun for a sense of depth.
  vec2 cp = p + uSun.xz / uSun.y * uDepth * 0.25;
  float c = caustic(cp * 0.24, uTime * 0.55);
  float c2 = caustic(cp * 0.24 + 0.013, uTime * 0.55 + 0.25);
  vec3 caus = vec3(c, (c + c2) * 0.5, c2);

  // Ripples from the live height field focus light into bright moving lines.
  vec2 suv = vec2(cp.x / uWorld.x + 0.5, cp.y / uWorld.y + 0.5);
  float hC = texture2D(tHeight, suv).r;
  vec2 o = uSimTexel * 1.5;
  float lap = texture2D(tHeight, suv + vec2(o.x, 0.0)).r + texture2D(tHeight, suv - vec2(o.x, 0.0)).r
            + texture2D(tHeight, suv + vec2(0.0, o.y)).r + texture2D(tHeight, suv - vec2(0.0, o.y)).r - 4.0 * hC;
  float rippleLight = clamp(-lap * 9.0, -0.35, 1.0);

  // Lily pad shadows.
  float shade = 1.0;
  for (int i = 0; i < ${MAX_PADS}; i++) {
    vec4 pd = uPads[i];
    if (pd.z <= 0.0) continue;
    vec2 sp = pd.xy - uSun.xz / uSun.y * uDepth;
    float d = length(p - sp) / pd.z;
    shade *= mix(1.0, 0.45, smoothstep(1.25, 0.75, d));
  }

  float sunlight = (caus.g * 0.75 + rippleLight * 0.45) * sunAmt * shade;
  vec3 lit = col * (light * shade * 0.95 + 0.12) + col * vec3(0.85, 1.0, 0.95) * sunlight + vec3(0.9, 1.0, 0.95) * caus * 0.08 * sunAmt * shade;

  // Water column absorption: reds fade first.
  vec3 deep = vec3(0.02, 0.4, 0.45);
  vec3 absorb = vec3(0.55, 0.95, 0.95);
  lit = mix(lit * absorb, deep, 0.3);

  gl_FragColor = vec4(lit, 1.0);
}
`;

// The static look of the pond bed (sand, pebbles, moss) is baked once into a
// texture so the per-frame shader only has to light it.
const ALBEDO_FRAG = /* glsl */ `
precision highp float;
uniform vec2 uFloorSize;
varying vec2 vUv;

${NOISE}

// Cellular noise: returns F1 and F2 distances and the id of the nearest cell.
vec2 voronoi(vec2 p, out vec2 cellId) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  float f1 = 8.0, f2 = 8.0;
  cellId = vec2(0.0);
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = hash22(n + g);
    vec2 r = g + o * 0.85 - f;
    float d = dot(r, r);
    if (d < f1) { f2 = f1; f1 = d; cellId = n + g; }
    else if (d < f2) { f2 = d; }
  }
  return vec2(sqrt(f1), sqrt(f2));
}

void main() {
  vec2 p = (vUv - 0.5) * uFloorSize;
  // Sand base with gentle large-scale variation.
  float large = fbm(p * 0.18 + 3.0);
  float grain = vnoise(p * 40.0) * 0.5 + vnoise(p * 90.0) * 0.5;
  vec3 sand = mix(vec3(0.82, 0.74, 0.56), vec3(0.66, 0.62, 0.48), large);
  sand *= 0.9 + grain * 0.18;

  // Rounded river pebbles scattered over the sand.
  vec2 id;
  vec2 vo = voronoi(p * 1.9, id);
  float hId = hash12(id * 1.37);
  float density = smoothstep(0.4, 0.66, fbm(p * 0.22 + 9.0));
  float present = step(hash12(id + 2.3), 0.12 + density * 0.6);
  float radius = 0.2 + 0.24 * hash12(id + 7.7);
  float pebble = (1.0 - smoothstep(radius - 0.1, radius, vo.x)) * present;
  vec3 pc = mix(vec3(0.7, 0.67, 0.6), vec3(0.93, 0.87, 0.76), hId);
  pc = mix(pc, vec3(0.46, 0.44, 0.42), step(0.88, hash12(id + 4.1)));
  pc = mix(pc, vec3(0.78, 0.58, 0.42), step(0.84, hash12(id + 9.7)) * 0.8);
  pc = mix(pc, vec3(0.5, 0.56, 0.5), step(0.9, hash12(id + 1.9)) * 0.7);
  // Domed shading: bright on top, darker toward the rim.
  float dome = 1.0 - vo.x / radius;
  pc *= 0.8 + 0.32 * sqrt(max(dome, 0.0));
  pc *= 0.94 + grain * 0.1;
  // Soft contact shadow on the sand around each pebble.
  float contact = (1.0 - smoothstep(radius, radius + 0.12, vo.x)) * present * (1.0 - pebble);
  vec3 col = sand * (1.0 - contact * 0.15);
  col = mix(col, pc, pebble);

  // Patches of moss and algae.
  float moss = smoothstep(0.55, 0.75, fbm(p * 0.25 - 5.0));
  col = mix(col, vec3(0.3, 0.4, 0.2) * (0.8 + grain * 0.3), moss * 0.55);

  gl_FragColor = vec4(col, 1.0);
}
`;

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export function bakeFloorAlbedo(renderer, floor, sizeX, sizeZ, maxRes) {
  const aspect = sizeX / sizeZ;
  const w = Math.round(aspect >= 1 ? maxRes : maxRes * aspect);
  const h = Math.round(aspect >= 1 ? maxRes / aspect : maxRes);
  const u = floor.material.uniforms;
  if (floor.userData.albedoRT) floor.userData.albedoRT.dispose();
  const rt = new THREE.WebGLRenderTarget(w, h, {
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: true,
    depthBuffer: false,
  });
  const mat = new THREE.ShaderMaterial({
    vertexShader: QUAD_VERT,
    fragmentShader: ALBEDO_FRAG,
    uniforms: { uFloorSize: { value: new THREE.Vector2(sizeX, sizeZ) } },
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.render(scene, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1));
  renderer.setRenderTarget(prev);
  mat.dispose();
  quad.geometry.dispose();
  rt.texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  u.tAlbedo.value = rt.texture;
  u.uFloorSize.value.set(sizeX, sizeZ);
  floor.userData.albedoRT = rt;
}

export function createFloor(depth) {
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 },
      tHeight: { value: null },
      uWorld: { value: new THREE.Vector2(1, 1) },
      uSimTexel: { value: new THREE.Vector2() },
      uSun: { value: new THREE.Vector3() },
      uOvercast: { value: 0 },
      uPads: { value: Array.from({ length: MAX_PADS }, () => new THREE.Vector4()) },
      uDepth: { value: depth },
      tAlbedo: { value: null },
      uFloorSize: { value: new THREE.Vector2(1, 1) },
    },
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -depth;
  mesh.renderOrder = 0;
  mesh.frustumCulled = false;
  return mesh;
}
