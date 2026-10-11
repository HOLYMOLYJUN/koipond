import * as THREE from 'three';
import { buildBodyGeometry, buildFinGeometry, createBodyMaterial, createFinMaterial } from './koi.js';

export const MAX_FISH = 96;

const TAU = Math.PI * 2;
const wrapAngle = (a) => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};
const rand = (a, b) => a + Math.random() * (b - a);

let nextId = 1;

class Koi {
  constructor(type, x, z, opts = {}) {
    this.id = nextId++;
    this.type = type;
    this.x = x;
    this.z = z;
    this.y = opts.y ?? -rand(0.4, 1.2);
    this.vy = 0;
    this.heading = opts.heading ?? rand(-Math.PI, Math.PI);
    this.angVel = 0;
    this.speed = opts.speed ?? rand(0.4, 0.8);
    this.targetSpeed = this.speed;
    this.wanderTurn = 0;
    this.wanderTimer = rand(0.5, 3);
    this.depth = -this.y;
    this.targetDepth = rand(0.35, 1.3);
    this.phase = rand(0, TAU);
    this.finPhase = rand(0, TAU);
    this.amp = 0.06;
    this.bend = 0;
    this.scale = opts.scale ?? rand(1.15, 1.6);
    this.seed = Math.random();
    this.state = opts.state ?? 'swim';
    this.boost = 0;
    this.personality = rand(0.8, 1.2);
    this.leaveDir = null;
  }
}

export class School {
  constructor(sharedUniforms) {
    this.fish = [];
    this.shared = sharedUniforms;

    const body = buildBodyGeometry();
    const fins = buildFinGeometry();
    this.iPos = new Float32Array(MAX_FISH * 4);
    this.iAnim = new Float32Array(MAX_FISH * 4);
    this.iLook = new Float32Array(MAX_FISH * 4);
    const mk = (arr) => new THREE.InstancedBufferAttribute(arr, 4).setUsage(THREE.DynamicDrawUsage);
    this.attrs = { iPos: mk(this.iPos), iAnim: mk(this.iAnim), iLook: mk(this.iLook) };

    const inst = (base) => {
      const g = new THREE.InstancedBufferGeometry();
      g.index = base.index;
      for (const k in base.attributes) g.setAttribute(k, base.attributes[k]);
      for (const k in this.attrs) g.setAttribute(k, this.attrs[k]);
      g.instanceCount = 0;
      return g;
    };
    this.bodyGeo = inst(body);
    this.finGeo = inst(fins);
    this.baseBody = body;
    this.baseFins = fins;

    const mesh = (geo, mat, order) => {
      const m = new THREE.Mesh(geo, mat);
      m.frustumCulled = false;
      m.renderOrder = order;
      return m;
    };
    // Underwater pass.
    this.shadowBody = mesh(this.bodyGeo, createBodyMaterial(2, sharedUniforms), 1);
    this.shadowFins = mesh(this.finGeo, createFinMaterial(2, sharedUniforms), 1);
    this.bodies = mesh(this.bodyGeo, createBodyMaterial(0, sharedUniforms), 2);
    this.finsMesh = mesh(this.finGeo, createFinMaterial(0, sharedUniforms), 3);
    // Above-water pass (fish in mid-air while being dropped in).
    this.airBodies = mesh(this.bodyGeo, createBodyMaterial(1, sharedUniforms), 8);
    this.airFins = mesh(this.finGeo, createFinMaterial(1, sharedUniforms), 9);

    this.underGroup = new THREE.Group();
    this.underGroup.add(this.shadowFins, this.shadowBody, this.bodies, this.finsMesh);
    this.airGroup = new THREE.Group();
    this.airGroup.add(this.airBodies, this.airFins);
  }

  get count() {
    return this.fish.filter((f) => f.state !== 'leaving').length;
  }

  get size() {
    return this.fish.length;
  }

  add(type, x, z, opts) {
    if (this.fish.length >= MAX_FISH) return null;
    const f = new Koi(type, x, z, opts);
    this.fish.push(f);
    return f;
  }

  // Drop a fish in from above; returns the fish.
  drop(type, x, z) {
    const f = this.add(type, x, z, { y: 1.7, state: 'falling', speed: 0.2 });
    if (f) {
      f.vy = -0.6;
      f.heading = rand(-Math.PI, Math.PI);
    }
    return f;
  }

  clearAll() {
    for (const f of this.fish) {
      if (f.state === 'leaving') continue;
      f.state = 'leaving';
      f.boost = 0;
      f.targetSpeed = rand(1.3, 1.8);
      f.targetDepth = rand(0.6, 1.4);
    }
  }

  startle(x, z, radius = 2.0) {
    for (const f of this.fish) {
      if (f.state !== 'swim') continue;
      const dx = f.x - x;
      const dz = f.z - z;
      const d = Math.hypot(dx, dz);
      if (d < radius) {
        const k = 1 - d / radius;
        f.boost = Math.max(f.boost, 1.6 * k);
        f.fleeX = dx / (d + 1e-3);
        f.fleeZ = dz / (d + 1e-3);
        f.fleeT = 0.9 * k + 0.2;
      }
    }
  }

  update(dt, t, env) {
    const { W, H, vortex, calm, onSplash } = env;
    const fish = this.fish;
    const halfW = W / 2;
    const halfH = H / 2;
    const margin = Math.min(1.8, Math.min(W, H) * 0.2);
    let activity = 0;

    for (let i = fish.length - 1; i >= 0; i--) {
      const f = fish[i];

      if (f.state === 'falling') {
        f.vy -= 9.8 * dt;
        f.y += f.vy * dt;
        f.phase += dt * 16;
        f.amp = 0.14;
        f.heading += dt * 0.6;
        f.finPhase += dt * 12;
        if (f.y <= 0) {
          f.y = -0.02;
          f.state = 'dive';
          f.speed = 1.6;
          f.targetSpeed = 0.8;
          f.boost = 1.2;
          f.targetDepth = rand(0.6, 1.2);
          f.diveT = 0;
          onSplash(f);
        }
        continue;
      }

      // --- Steering --------------------------------------------------------
      const fx = Math.cos(f.heading);
      const fz = -Math.sin(f.heading);
      let sx = fx * 1.2;
      let sz = fz * 1.2;

      if (f.state !== 'leaving') {
        // Smooth, predictive avoidance of the pond edges.
        const lookX = f.x + fx * 1.4 * f.scale;
        const lookZ = f.z + fz * 1.4 * f.scale;
        const ex = Math.max(0, lookX - (halfW - margin)) - Math.max(0, -halfW + margin - lookX);
        const ez = Math.max(0, lookZ - (halfH - margin)) - Math.max(0, -halfH + margin - lookZ);
        sx -= ex * 2.6;
        sz -= ez * 2.6;
        // Hard keep-in if somehow outside.
        if (Math.abs(f.x) > halfW - 0.3) sx -= Math.sign(f.x) * 3;
        if (Math.abs(f.z) > halfH - 0.3) sz -= Math.sign(f.z) * 3;
      } else {
        if (!f.leaveDir) {
          // Exit toward the closest edge.
          const dl = f.x + halfW, dr = halfW - f.x, dt2 = f.z + halfH, db = halfH - f.z;
          const m = Math.min(dl, dr, dt2, db);
          f.leaveDir = m === dl ? [-1, 0] : m === dr ? [1, 0] : m === dt2 ? [0, -1] : [0, 1];
        }
        sx += f.leaveDir[0] * 3;
        sz += f.leaveDir[1] * 3;
      }

      // Separation from neighbours (also look ahead to avoid head-on bumps).
      for (let j = 0; j < fish.length; j++) {
        if (j === i) continue;
        const o = fish[j];
        if (o.state === 'falling') continue;
        const dx = f.x - o.x;
        const dz = f.z - o.z;
        const rad = 0.75 * (f.scale + o.scale);
        const d2 = dx * dx + dz * dz;
        if (d2 > rad * rad * 1.8) continue;
        const d = Math.sqrt(d2) + 1e-4;
        const depthGap = Math.abs(f.y - o.y);
        const k = (1 - Math.min(1, d / (rad * 1.34))) * (depthGap < 0.5 ? 1 : 0.4);
        sx += (dx / d) * k * 2.4;
        sz += (dz / d) * k * 2.4;
        // Avoid crossing directly in front of another fish.
        const ahead = -(dx * fx + dz * fz);
        if (ahead > 0 && ahead < rad * 1.2) {
          const side = -dx * fz + dz * fx;
          const s = side >= 0 ? 1 : -1;
          sx += -fz * s * k * 0.8;
          sz += fx * s * k * 0.8;
        }
      }

      // Startle: dart away from touches.
      if (f.fleeT > 0) {
        f.fleeT -= dt;
        sx += f.fleeX * 3;
        sz += f.fleeZ * 3;
      }

      // Vortex currents push the fish and bend its course.
      let cx = 0, cz = 0;
      if (vortex && vortex.strength > 0.01) {
        const dx = f.x - vortex.x;
        const dz = f.z - vortex.z;
        const r = Math.hypot(dx, dz) + 1e-4;
        const rr = r / vortex.radius;
        const fall = Math.exp(-rr * rr * 0.9);
        const tang = vortex.strength * 1.5 * fall * Math.min(1, rr * 2.5);
        cx = (dz / r) * tang - (dx / r) * 0.22 * fall * vortex.strength;
        cz = (-dx / r) * tang - (dz / r) * 0.22 * fall * vortex.strength;
        sx += cx * 0.6;
        sz += cz * 0.6;
        // Fish fight to stay out of the very centre.
        if (rr < 0.5) {
          sx += (dx / r) * (0.5 - rr) * 4;
          sz += (dz / r) * (0.5 - rr) * 4;
        }
      }

      // Wander: independent changes of course and pace.
      f.wanderTimer -= dt;
      if (f.wanderTimer <= 0) {
        f.wanderTimer = rand(1.2, 5);
        f.wanderTurn = rand(-0.7, 0.7) * f.personality;
        if (Math.random() < 0.2) f.wanderTurn *= 2;
        f.targetSpeed = rand(0.28, 0.95) * f.personality;
        if (Math.random() < 0.12) f.targetSpeed = rand(1.0, 1.35);
        if (Math.random() < 0.5) f.targetDepth = rand(0.35, 1.35);
      }

      const desired = Math.atan2(-sz, sx);
      let diff = wrapAngle(desired - f.heading);
      const maxTurn = 2.2;
      let targetAng = Math.max(-maxTurn, Math.min(maxTurn, diff * 2.2)) + f.wanderTurn * 0.6;
      f.angVel += (targetAng - f.angVel) * Math.min(1, dt * 2.8);
      f.heading = wrapAngle(f.heading + f.angVel * dt);

      // --- Speed, depth, motion -------------------------------------------
      let tSpeed = f.state === 'leaving' ? f.targetSpeed : f.targetSpeed * (calm ? 0.6 : 1);
      tSpeed += f.boost;
      f.boost = Math.max(0, f.boost - dt * 1.1);
      f.speed += (tSpeed - f.speed) * Math.min(1, dt * 1.6);

      if (f.state === 'dive') {
        f.diveT += dt;
        if (f.diveT > 1.6) f.state = 'swim';
      }
      const depthRate = f.state === 'dive' ? 1.6 : 0.25;
      f.depth += (f.targetDepth - f.depth) * Math.min(1, dt * depthRate);
      f.y = -f.depth;

      const nx = Math.cos(f.heading);
      const nz = -Math.sin(f.heading);
      f.x += (nx * f.speed + cx) * dt * f.scale;
      f.z += (nz * f.speed + cz) * dt * f.scale;

      // Tail beat frequency and amplitude follow effort.
      const effort = f.speed + Math.abs(f.angVel) * 0.35;
      f.phase += dt * (2.6 + effort * 7.5);
      f.finPhase += dt * (1.8 + f.speed * 1.5);
      const targetAmp = 0.035 + Math.min(0.11, effort * 0.07);
      f.amp += (targetAmp - f.amp) * Math.min(1, dt * 3);
      const targetBend = f.angVel * 0.16;
      f.bend += (Math.max(-0.35, Math.min(0.35, targetBend)) - f.bend) * Math.min(1, dt * 5);
      activity += f.speed;

      if (f.state === 'leaving') {
        if (Math.abs(f.x) > halfW + 1.6 || Math.abs(f.z) > halfH + 1.6) fish.splice(i, 1);
      }
    }
    return activity;
  }

  // Push simulation state to GPU instance buffers.
  sync() {
    const fish = this.fish;
    const n = fish.length;
    for (let i = 0; i < n; i++) {
      const f = fish[i];
      const b = i * 4;
      this.iPos[b] = f.x;
      this.iPos[b + 1] = f.y;
      this.iPos[b + 2] = f.z;
      this.iPos[b + 3] = f.heading;
      this.iAnim[b] = f.phase;
      this.iAnim[b + 1] = f.bend;
      this.iAnim[b + 2] = f.amp;
      this.iAnim[b + 3] = f.scale * (f.state === 'falling' ? 1 + Math.max(0, f.y) * 0.05 : 1);
      this.iLook[b] = f.type;
      this.iLook[b + 1] = f.seed;
      this.iLook[b + 2] = f.finPhase;
      this.iLook[b + 3] = f.y > 0 ? 1 : 0;
    }
    this.bodyGeo.instanceCount = n;
    this.finGeo.instanceCount = n;
    for (const k in this.attrs) {
      this.attrs[k].clearUpdateRanges?.();
      this.attrs[k].addUpdateRange?.(0, n * 4);
      this.attrs[k].needsUpdate = true;
    }
  }

  // Render a still portrait of a variety for the selection cards.
  renderThumbnail(renderer, type, w = 320, h = 180) {
    const pos = new Float32Array([0, 0, 0, 0.18]);
    const anim = new Float32Array([1.4, -0.12, 0.05, 1]);
    const look = new Float32Array([type, 0.37 + type * 0.21, 0.6, 0]);
    const mk = (arr) => new THREE.InstancedBufferAttribute(arr, 4);
    const inst = (base) => {
      const g = new THREE.InstancedBufferGeometry();
      g.index = base.index;
      for (const k in base.attributes) g.setAttribute(k, base.attributes[k]);
      g.setAttribute('iPos', mk(pos));
      g.setAttribute('iAnim', mk(anim));
      g.setAttribute('iLook', mk(look));
      g.instanceCount = 1;
      return g;
    };
    const shared = { ...this.shared, uThumb: { value: 1 }, uFloorY: { value: -10 } };
    const scene = new THREE.Scene();
    const bm = createBodyMaterial(0, shared);
    const fm = createFinMaterial(0, shared);
    const bg = inst(this.baseBody);
    const fg = inst(this.baseFins);
    const b = new THREE.Mesh(bg, bm);
    const fn = new THREE.Mesh(fg, fm);
    b.frustumCulled = fn.frustumCulled = false;
    fn.renderOrder = 1;
    scene.add(b, fn);
    const aspect = w / h;
    const vh = 0.9;
    const cam = new THREE.OrthographicCamera(-vh * aspect / 2, vh * aspect / 2, vh / 2, -vh / 2, 0.1, 10);
    cam.position.set(-0.16, 3, 0);
    cam.up.set(0, 0, -1);
    cam.lookAt(-0.16, 0, 0);
    const savedCam = this.shared.uCam.value.clone();
    this.shared.uCam.value.set(-0.16, 3, 0);

    const rt = new THREE.WebGLRenderTarget(w, h);
    const prevTarget = renderer.getRenderTarget();
    const cc = renderer.getClearColor(new THREE.Color());
    const ca = renderer.getClearAlpha();
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, cam);
    const px = new Uint8Array(w * h * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(cc, ca);
    this.shared.uCam.value.copy(savedCam);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const src = (h - 1 - y) * w * 4;
      img.data.set(px.subarray(src, src + w * 4), y * w * 4);
    }
    // Translucent fins were blended onto a transparent target: un-premultiply.
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3];
      if (a > 0 && a < 255) {
        const k = 255 / a;
        d[i] = Math.min(255, d[i] * k);
        d[i + 1] = Math.min(255, d[i + 1] * k);
        d[i + 2] = Math.min(255, d[i + 2] * k);
      }
    }
    ctx.putImageData(img, 0, 0);

    rt.dispose();
    bm.dispose();
    fm.dispose();
    return canvas.toDataURL('image/png');
  }
}
