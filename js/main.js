import * as THREE from 'three';
import { WaterSim, createSurfaceMaterial, MAX_RINGS } from './water.js';
import { createFloor, bakeFloorAlbedo } from './floor.js';
import { School, MAX_FISH } from './fish.js';
import { VARIETIES } from './koi.js';
import { Droplets, LilyPads } from './effects.js';
import { PondAudio } from './audio.js';

THREE.ColorManagement.enabled = false;

const FLOOR_DEPTH = 2.4;
const FOV = 50;
const SUN = new THREE.Vector3(0.38, 1.0, -0.3).normalize();

const $ = (sel) => document.querySelector(sel);
const canvas = $('#pond');
const isSmall = () => Math.min(innerWidth, innerHeight) < 700;

// ---------------------------------------------------------------------------
// Renderer & scenes
// ---------------------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.autoClear = false;

let maxDpr = Math.min(window.devicePixelRatio || 1, isSmall() ? 1.75 : 2);
let dpr = maxDpr;

const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
const underScene = new THREE.Scene();
const overScene = new THREE.Scene();
const surfaceScene = new THREE.Scene();
const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const sceneRT = new THREE.WebGLRenderTarget(2, 2, {
  type: THREE.UnsignedByteType,
  samples: isSmall() ? 2 : 4,
  depthBuffer: true,
});

const sim = new WaterSim(renderer);

// Uniforms shared by every fish material (and partially by other materials).
const shared = {
  uTime: { value: 0 },
  uSun: { value: SUN.clone() },
  uCam: { value: new THREE.Vector3() },
  uOvercast: { value: 0 },
  uFloorY: { value: -FLOOR_DEPTH },
  uThumb: { value: 0 },
  tHeight: { value: null },
  uWorld: { value: new THREE.Vector2(1, 1) },
};

const floor = createFloor(FLOOR_DEPTH);
underScene.add(floor);

const school = new School(shared);
underScene.add(school.underGroup);
overScene.add(school.airGroup);

const pads = new LilyPads(shared);
overScene.add(pads.group);

const droplets = new Droplets();
overScene.add(droplets.points);

const surface = createSurfaceMaterial();
const surfaceQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), surface);
surfaceQuad.frustumCulled = false;
surfaceScene.add(surfaceQuad);

const audio = new PondAudio();

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = {
  W: 10,
  H: 10,
  camH: 10,
  rain: false,
  calm: false,
  overcast: 0,
  rainLevel: 0,
  uiHidden: false,
  vortex: { active: false, x: 0, z: 0, radius: 2.4, strength: 0 },
};

const rings = [];
function addRing(x, z, speed, alpha, decay = 0.9, r0 = 0.02) {
  rings.push({ x, z, r: r0, speed, alpha, decay });
  if (rings.length > 80) rings.shift();
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

function layout() {
  const w = innerWidth;
  const h = innerHeight;
  const aspect = w / h;
  const minSpan = isSmall() ? 8 : 10;
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  let H;
  if (aspect >= 1) H = minSpan;
  else H = minSpan / aspect;
  const W = H * aspect;
  const camH = H / 2 / tanHalf;
  state.W = W;
  state.H = H;
  state.camH = camH;

  camera.aspect = aspect;
  camera.position.set(0, camH, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();

  const grow = ((camH + FLOOR_DEPTH) / camH) * 1.2;
  floor.scale.set(W * grow, H * grow, 1);
  const floorKey = `${W.toFixed(3)}x${H.toFixed(3)}`;
  if (floor.userData.key !== floorKey) {
    floor.userData.key = floorKey;
    const maxRes = Math.min(renderer.capabilities.maxTextureSize, isSmall() ? 1536 : 2048);
    bakeFloorAlbedo(renderer, floor, W * grow, H * grow, maxRes);
  }

  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  // The refracted underwater view tolerates a slightly softer resolution on phones.
  const rtScale = isSmall() ? 0.85 : 1;
  sceneRT.setSize(Math.round(w * dpr * rtScale), Math.round(h * dpr * rtScale));

  sim.resize(W, H);
  shared.uWorld.value.set(W, H);
  shared.uCam.value.copy(camera.position);
  surface.uniforms.uWorld.value.set(W, H);
  surface.uniforms.uCam.value.copy(camera.position);
  surface.uniforms.uSun.value.copy(SUN);
  surface.uniforms.uResolution.value.set(w, h);
  surface.uniforms.uSimTexel.value.set(1 / sim.width, 1 / sim.height);
  floor.material.uniforms.uWorld.value.set(W, H);
  floor.material.uniforms.uSimTexel.value.set(1 / sim.width, 1 / sim.height);
  floor.material.uniforms.uSun.value.copy(SUN);
  droplets.material.uniforms.uScale.value = h * dpr * 0.5 / tanHalf;

  pads.layout(W, H);

  // Keep things inside the new bounds.
  for (const f of school.fish) {
    f.x = THREE.MathUtils.clamp(f.x, -W / 2 + 0.5, W / 2 - 0.5);
    f.z = THREE.MathUtils.clamp(f.z, -H / 2 + 0.5, H / 2 - 0.5);
  }
  clampVortex();
}

function screenToWorld(cx, cy) {
  return {
    x: (cx / innerWidth - 0.5) * state.W,
    z: (cy / innerHeight - 0.5) * state.H,
  };
}

function worldToScreen(x, z) {
  return {
    x: (x / state.W + 0.5) * innerWidth,
    y: (z / state.H + 0.5) * innerHeight,
  };
}

function clampVortex() {
  const v = state.vortex;
  v.x = THREE.MathUtils.clamp(v.x, -state.W / 2 + 0.8, state.W / 2 - 0.8);
  v.z = THREE.MathUtils.clamp(v.z, -state.H / 2 + 0.8, state.H / 2 - 0.8);
}

// ---------------------------------------------------------------------------
// Water interactions
// ---------------------------------------------------------------------------

function ripple(x, z, power = 1, sound = true, force = false) {
  sim.addDrop(x, z, 0.16 + power * 0.1, 0.55 * power);
  addRing(x, z, 1.1 + power * 0.4, 0.35 * power, 1.1);
  if (sound) audio.drop(x / state.W + 0.5, 0.5 + power * 0.5, force);
}

function splash(f) {
  const s = f.scale;
  // A sharp dent that rebounds into outward rings.
  sim.addDrop(f.x, f.z, 0.55 * s, -2.4);
  setTimeout(() => sim.addDrop(f.x, f.z, 0.32 * s, 1.1), 90);
  addRing(f.x, f.z, 2.2, 0.9, 0.75, 0.25 * s);
  addRing(f.x, f.z, 1.4, 0.6, 0.65, 0.1);
  setTimeout(() => addRing(f.x, f.z, 1.0, 0.45, 0.7, 0.05), 220);
  droplets.burst(f.x, f.z, 0.85 + s * 0.25);
  audio.splash(f.x / state.W + 0.5, Math.min(1.2, 0.75 + s * 0.25));
  school.startle(f.x, f.z, 2.6);
  updateCount();
}

function randomDropPoint() {
  const dock = $('.dock');
  const top = $('.toolbar');
  const dockTop = dock && !state.uiHidden ? dock.getBoundingClientRect().top : innerHeight;
  const toolBottom = top && !state.uiHidden ? top.getBoundingClientRect().bottom : 0;
  const pad = 70;
  const cx = pad + Math.random() * (innerWidth - pad * 2);
  const minY = Math.max(pad, toolBottom + 30);
  const maxY = Math.max(minY + 10, dockTop - 50);
  const cy = minY + Math.random() * (maxY - minY);
  return screenToWorld(cx, cy);
}

function spawn(type, x, z) {
  if (school.size >= MAX_FISH) {
    toast('The pond is full — try Clear pond');
    return false;
  }
  if (x === undefined) ({ x, z } = randomDropPoint());
  x = THREE.MathUtils.clamp(x, -state.W / 2 + 0.4, state.W / 2 - 0.4);
  z = THREE.MathUtils.clamp(z, -state.H / 2 + 0.4, state.H / 2 - 0.4);
  const f = school.drop(type, x, z);
  if (!f) return false;
  // Shadow & anticipation ring where it will land.
  addRing(x, z, 0.6, 0.2, 1.6, 0.4);
  if (state.calm) setCalm(false);
  return true;
}

// Pointer on the water: touch & drag ripples.
let waterPointer = null;
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== undefined && e.button > 0) return;
  canvas.setPointerCapture(e.pointerId);
  const p = screenToWorld(e.clientX, e.clientY);
  waterPointer = { id: e.pointerId, x: p.x, z: p.z, acc: 0, lastSound: 0 };
  ripple(p.x, p.z, 1, true, true);
  school.startle(p.x, p.z, 2.2);
});
canvas.addEventListener('pointermove', (e) => {
  if (!waterPointer || waterPointer.id !== e.pointerId) return;
  const p = screenToWorld(e.clientX, e.clientY);
  const dx = p.x - waterPointer.x;
  const dz = p.z - waterPointer.z;
  const d = Math.hypot(dx, dz);
  const step = 0.16;
  if (d < step) return;
  // Interpolate drops along the stroke so fast drags stay continuous.
  const n = Math.min(8, Math.floor(d / step));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const x = waterPointer.x + dx * t;
    const z = waterPointer.z + dz * t;
    sim.addDrop(x, z, 0.17, 0.32);
  }
  waterPointer.acc += d;
  if (waterPointer.acc > 0.9) {
    waterPointer.acc = 0;
    addRing(p.x, p.z, 0.9, 0.18, 1.3);
    audio.drop(p.x / state.W + 0.5, 0.55);
  }
  school.startle(p.x, p.z, 1.4);
  waterPointer.x = p.x;
  waterPointer.z = p.z;
});
const endWater = (e) => {
  if (waterPointer && waterPointer.id === e.pointerId) waterPointer = null;
};
canvas.addEventListener('pointerup', endWater);
canvas.addEventListener('pointercancel', endWater);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

const countEl = $('#count');
function updateCount() {
  const n = school.count;
  countEl.textContent = n === 1 ? '1 koi' : `${n} koi`;
}

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

function setPressed(btn, on) {
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
}

const btnSound = $('#btn-sound');
const btnRain = $('#btn-rain');
const btnVortex = $('#btn-vortex');
const btnCalm = $('#btn-calm');
const btnClear = $('#btn-clear');
const btnHide = $('#btn-hide');
const btnShow = $('#show-ui');
const handle = $('#vortex-handle');

function setSound(on) {
  audio.setEnabled(on);
  setPressed(btnSound, on);
  btnSound.querySelector('.label').textContent = on ? 'Sound on' : 'Sound';
  btnSound.classList.toggle('muted', !on);
}

function setRain(on) {
  state.rain = on;
  setPressed(btnRain, on);
  if (on && state.calm) setCalm(false);
}

function placeHandle() {
  const s = worldToScreen(state.vortex.x, state.vortex.z);
  handle.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -50%)`;
}

function setVortex(on) {
  const v = state.vortex;
  if (on && !v.active) {
    v.x = state.W * 0.12;
    v.z = -state.H * 0.08;
    clampVortex();
    if (state.calm) setCalm(false);
  }
  v.active = on;
  placeHandle();
  setPressed(btnVortex, on);
  handle.classList.toggle('on', on);
  if (on) toast('Drag the vortex to move it');
}

function setCalm(on) {
  state.calm = on;
  setPressed(btnCalm, on);
  if (on) {
    setRain(false);
    setVortex(false);
  }
}

function setUiHidden(on) {
  state.uiHidden = on;
  document.body.classList.toggle('ui-hidden', on);
  setPressed(btnHide, on);
  if (on) flashShowButton();
}

let showTimer = null;
function flashShowButton() {
  if (!state.uiHidden) return;
  btnShow.classList.add('visible');
  clearTimeout(showTimer);
  showTimer = setTimeout(() => btnShow.classList.remove('visible'), 2200);
}

btnSound.addEventListener('click', () => setSound(!audio.enabled));
btnRain.addEventListener('click', () => setRain(!state.rain));
btnVortex.addEventListener('click', () => setVortex(!state.vortex.active));
btnCalm.addEventListener('click', () => setCalm(!state.calm));
btnClear.addEventListener('click', () => {
  if (school.count === 0) {
    toast('The pond is already clear');
    return;
  }
  school.clearAll();
  updateCount();
  toast('The koi drift away…');
});
btnHide.addEventListener('click', () => setUiHidden(true));
btnShow.addEventListener('click', () => setUiHidden(false));
window.addEventListener('pointermove', (e) => {
  if (state.uiHidden && e.pointerType === 'mouse') flashShowButton();
});
window.addEventListener('pointerdown', () => {
  if (state.uiHidden) flashShowButton();
});

window.addEventListener('keydown', (e) => {
  if (e.target.closest && e.target.closest('input, textarea')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'h') setUiHidden(!state.uiHidden);
  else if (k === 'escape' && state.uiHidden) setUiHidden(false);
  else if (k === 'r') setRain(!state.rain);
  else if (k === 'v') setVortex(!state.vortex.active);
  else if (k === 'c') setCalm(!state.calm);
  else if (k === 'm') setSound(!audio.enabled);
  else if (k >= '1' && k <= '4') spawn(Number(k) - 1);
});

// Vortex handle dragging.
let vortexDrag = null;
handle.addEventListener('pointerdown', (e) => {
  if (!state.vortex.active) return;
  e.stopPropagation();
  handle.setPointerCapture(e.pointerId);
  vortexDrag = e.pointerId;
  handle.classList.add('dragging');
});
handle.addEventListener('pointermove', (e) => {
  if (vortexDrag !== e.pointerId) return;
  const p = screenToWorld(e.clientX, e.clientY);
  const v = state.vortex;
  // Moving the vortex stirs the water along its path.
  if (Math.hypot(p.x - v.x, p.z - v.z) > 0.25) sim.addDrop(v.x, v.z, 0.3, -0.25);
  v.x = p.x;
  v.z = p.z;
  clampVortex();
});
const endVortex = (e) => {
  if (vortexDrag !== e.pointerId) return;
  vortexDrag = null;
  handle.classList.remove('dragging');
};
handle.addEventListener('pointerup', endVortex);
handle.addEventListener('pointercancel', endVortex);

// Selection cards: click to release, drag to place precisely.
const ghost = $('#drag-ghost');
const ghostImg = ghost.querySelector('img');
const marker = $('#drop-marker');
const cardsEl = $('#cards');

function buildCards(thumbs) {
  VARIETIES.forEach((v, i) => {
    const card = document.createElement('button');
    card.className = 'card';
    card.type = 'button';
    card.dataset.type = String(i);
    card.setAttribute('aria-label', `Add ${v.name} koi`);
    card.innerHTML = `
      <span class="thumb"><img src="${thumbs[i]}" alt="" draggable="false"></span>
      <span class="meta"><span class="name">${v.name}</span><span class="note">${v.note}</span></span>`;
    cardsEl.appendChild(card);
    attachCardDrag(card, i, thumbs[i]);
  });
}

function overDock(x, y) {
  const el = document.elementFromPoint(x, y);
  return !!(el && el.closest && el.closest('.dock, .toolbar, .brand'));
}

function attachCardDrag(card, type, thumb) {
  let start = null;
  let dragging = false;
  let lastX = 0;
  let tilt = 0;

  card.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button > 0) return;
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
    dragging = false;
    lastX = e.clientX;
    card.setPointerCapture(e.pointerId);
  });

  card.addEventListener('pointermove', (e) => {
    if (!start || start.id !== e.pointerId) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (!dragging && Math.hypot(dx, dy) > 8) {
      dragging = true;
      ghostImg.src = thumb;
      ghost.classList.add('show');
      card.classList.add('lifted');
      document.body.classList.add('dragging-koi');
    }
    if (dragging) {
      tilt += ((e.clientX - lastX) * 1.2 - tilt) * 0.3;
      tilt = Math.max(-30, Math.min(30, tilt));
      lastX = e.clientX;
      ghost.style.transform = `translate(${e.clientX}px, ${e.clientY}px) translate(-50%, -50%) rotate(${-90 + tilt}deg)`;
      const valid = !overDock(e.clientX, e.clientY);
      marker.classList.toggle('show', valid);
      ghost.classList.toggle('invalid', !valid);
      marker.style.transform = `translate(${e.clientX}px, ${e.clientY}px) translate(-50%, -50%)`;
    }
  });

  const finish = (e, cancelled) => {
    if (!start || start.id !== e.pointerId) return;
    start = null;
    card.classList.remove('lifted');
    document.body.classList.remove('dragging-koi');
    if (dragging) {
      ghost.classList.remove('show');
      marker.classList.remove('show');
      if (!cancelled && !overDock(e.clientX, e.clientY)) {
        const p = screenToWorld(e.clientX, e.clientY);
        spawn(type, p.x, p.z);
      }
    } else if (!cancelled) {
      spawn(type);
      card.classList.add('pulse');
      setTimeout(() => card.classList.remove('pulse'), 400);
    }
    dragging = false;
  };
  card.addEventListener('pointerup', (e) => finish(e, false));
  card.addEventListener('pointercancel', (e) => finish(e, true));
  // Keyboard activation.
  card.addEventListener('click', (e) => {
    if (e.detail === 0) spawn(type);
  });
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

const clock = new THREE.Clock();
let time = 0;
let ambientTimer = 3;
let perf = { acc: 0, frames: 0, slow: 0 };

function updateRings(dt) {
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i];
    r.r += r.speed * dt;
    r.speed *= 1 - dt * 0.35;
    r.alpha -= r.decay * dt * (0.4 + r.alpha);
    if (r.alpha <= 0.005) rings.splice(i, 1);
  }
  const arr = surface.uniforms.uRings.value;
  const start = Math.max(0, rings.length - MAX_RINGS);
  for (let i = 0; i < MAX_RINGS; i++) {
    const r = rings[start + i];
    if (r) arr[i].set(r.x, r.z, r.r, r.alpha);
    else arr[i].set(0, 0, 0, 0);
  }
}

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 1 / 20);
  time += dt;

  // Adaptive resolution: back off if frames are consistently slow.
  perf.acc += dt;
  perf.frames++;
  if (perf.acc > 2) {
    const avg = perf.acc / perf.frames;
    if (avg > 1 / 40 && dpr > 1) {
      perf.slow++;
      if (perf.slow >= 2) {
        dpr = Math.max(1, dpr - 0.25);
        perf.slow = 0;
        layout();
      }
    } else perf.slow = 0;
    perf.acc = 0;
    perf.frames = 0;
  }

  // Weather & vortex easing.
  const v = state.vortex;
  v.strength += ((v.active ? 1 : 0) - v.strength) * Math.min(1, dt * (v.active ? 0.9 : 1.6));
  if (v.strength < 0.002) v.strength = 0;
  state.rainLevel += ((state.rain ? 1 : 0) - state.rainLevel) * Math.min(1, dt * 0.8);
  state.overcast += ((state.rain ? 1 : 0) - state.overcast) * Math.min(1, dt * 0.5);

  // Rain drops.
  if (state.rainLevel > 0.02) {
    const rate = 46 * state.rainLevel;
    let n = Math.floor(rate * dt + Math.random());
    while (n-- > 0) {
      const x = (Math.random() - 0.5) * state.W;
      const z = (Math.random() - 0.5) * state.H;
      sim.addDrop(x, z, 0.06 + Math.random() * 0.05, (Math.random() < 0.5 ? -1 : 1) * (0.07 + Math.random() * 0.08));
      if (Math.random() < 0.35) addRing(x, z, 0.55 + Math.random() * 0.3, 0.12 + Math.random() * 0.08, 1.4, 0.01);
      if (Math.random() < 0.18) droplets.sprinkle(x, z, 0.6);
      if (Math.random() < 0.3) audio.tick(x / state.W + 0.5);
    }
  }

  // Occasional ambient drip — a leaf letting go of a bead of water.
  ambientTimer -= dt;
  if (ambientTimer <= 0) {
    ambientTimer = 5 + Math.random() * 9;
    if (!state.rain) {
      const x = (Math.random() - 0.5) * state.W * 0.8;
      const z = (Math.random() - 0.5) * state.H * 0.7;
      ripple(x, z, 0.45, true, true);
    }
  }

  // Fish.
  const activity = school.update(dt, time, {
    W: state.W,
    H: state.H,
    vortex: v.strength > 0.01 ? v : null,
    calm: state.calm,
    onSplash: splash,
  });
  // Shallow fish leave faint wakes on the surface.
  for (const f of school.fish) {
    if (f.state !== 'falling' && f.depth < 0.6 && Math.random() < dt * 2.2 * f.speed) {
      const bx = f.x - Math.cos(f.heading) * 0.3 * f.scale;
      const bz = f.z + Math.sin(f.heading) * 0.3 * f.scale;
      sim.addDrop(bx, bz, 0.12 * f.scale, 0.05 * (0.6 - f.depth) * 3);
    }
  }
  if (school.size === 0 && countEl.textContent !== '0 koi') updateCount();
  else if (Math.random() < 0.05) updateCount();
  school.sync();

  // Splash droplets falling back.
  const landed = droplets.update(dt);
  for (let i = 0; i < landed.length && i < 30; i += 3) {
    sim.addDrop(landed[i], landed[i + 1], 0.1, -0.14);
  }

  pads.update(time, dt, v);
  pads.writeShadows(floor.material.uniforms.uPads.value);
  updateRings(dt);

  // Water simulation.
  sim.setVortex(v.strength > 0.01, v.x, v.z, v.radius, v.strength);
  sim.step(dt, state.calm ? 0.982 : 0.993);
  const ht = sim.texture;
  shared.tHeight.value = ht;
  floor.material.uniforms.tHeight.value = ht;
  surface.uniforms.tHeight.value = ht;

  // Uniforms.
  shared.uTime.value = time;
  shared.uOvercast.value = state.overcast;
  floor.material.uniforms.uTime.value = time;
  floor.material.uniforms.uOvercast.value = state.overcast;
  surface.uniforms.uTime.value = time;
  surface.uniforms.uOvercast.value = state.overcast;
  surface.uniforms.uCalm.value += ((state.calm ? 1 : 0) - surface.uniforms.uCalm.value) * Math.min(1, dt * 1.5);
  surface.uniforms.uVortex.value.set(v.x, v.z, v.radius, v.strength);

  // Vortex handle follows the vortex on screen.
  if (v.active || v.strength > 0.01) placeHandle();

  audio.setLevels(state.rainLevel, v.strength, activity, state.calm);

  // Render: underwater world → refracting water surface → above-water layer.
  renderer.setRenderTarget(sceneRT);
  renderer.setClearColor(0x0a3b40, 1);
  renderer.clear(true, true, false);
  renderer.render(underScene, camera);

  renderer.setRenderTarget(null);
  surface.uniforms.tScene.value = sceneRT.texture;
  renderer.render(surfaceScene, quadCam);
  renderer.clearDepth();
  renderer.render(overScene, camera);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function boot() {
  layout();

  let thumbs;
  try {
    thumbs = VARIETIES.map((_, i) => school.renderThumbnail(renderer, i));
  } catch (err) {
    console.warn('Thumbnail render failed', err);
    thumbs = VARIETIES.map(() => '');
  }
  buildCards(thumbs);

  // The compact (phone) toolbar sits just above the dock.
  const dock = $('.dock');
  const syncDock = () => document.documentElement.style.setProperty('--dock-h', `${Math.round(dock.offsetHeight)}px`);
  syncDock();
  if (window.ResizeObserver) new ResizeObserver(syncDock).observe(dock);

  // A few koi already live here.
  const start = [0, 1, 2, 3, 0, 1, 3];
  start.forEach((type, i) => {
    const a = (i / start.length) * Math.PI * 2;
    school.add(type, Math.cos(a) * state.W * 0.25, Math.sin(a) * state.H * 0.22, {
      heading: a + Math.PI / 2 + (Math.random() - 0.5),
    });
  });
  updateCount();

  window.addEventListener('resize', () => {
    maxDpr = Math.min(window.devicePixelRatio || 1, isSmall() ? 1.75 : 2);
    dpr = Math.min(dpr, maxDpr);
    layout();
  });

  document.body.classList.add('ready');
  frame();

  // Expose a tiny hook for debugging in the console.
  window.koiPond = { spawn, setRain, setVortex, setCalm, setUiHidden, school, state };
}

try {
  boot();
} catch (err) {
  console.error(err);
  document.body.classList.add('no-webgl');
}
