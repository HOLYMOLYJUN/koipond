// Procedural pond soundscape built entirely with the Web Audio API.

const PENTA = [0, 2, 4, 7, 9]; // major pentatonic

function noteFreq(base, step) {
  const oct = Math.floor(step / PENTA.length);
  const deg = PENTA[((step % PENTA.length) + PENTA.length) % PENTA.length];
  return base * Math.pow(2, oct + deg / 12);
}

export class PondAudio {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.lastDrop = 0;
    this.suspendTimer = null;
    this.rainLevel = 0;
    this.vortexLevel = 0;
    this.activity = 0;
    document.addEventListener('visibilitychange', () => this.onVisibility());
  }

  get ready() {
    return !!this.ctx && this.enabled && this.ctx.state === 'running';
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);

    // Shared reverb gives the drops a sense of space.
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(2.8, 2.6);
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    this.reverb.connect(wet).connect(this.master);

    this.noise = this.makeNoise(4);
    this.brown = this.makeBrown(6);

    // Ambient water bed: a soft, slowly breathing murmur.
    this.ambient = ctx.createGain();
    this.ambient.gain.value = 0.0;
    this.ambient.connect(this.master);
    const bed = this.loop(this.brown);
    const bedLp = ctx.createBiquadFilter();
    bedLp.type = 'lowpass';
    bedLp.frequency.value = 420;
    bed.connect(bedLp).connect(this.ambient);
    const lap = this.loop(this.noise, 1.3);
    const lapBp = ctx.createBiquadFilter();
    lapBp.type = 'bandpass';
    lapBp.frequency.value = 900;
    lapBp.Q.value = 0.8;
    const lapGain = ctx.createGain();
    lapGain.gain.value = 0.05;
    lap.connect(lapBp).connect(lapGain).connect(this.ambient);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 0.035;
    lfo.connect(lfoAmt).connect(lapGain.gain);
    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.07;
    const lfo2Amt = ctx.createGain();
    lfo2Amt.gain.value = 350;
    lfo2.connect(lfo2Amt).connect(lapBp.frequency);
    lfo.start();
    lfo2.start();

    // Swimming: gentle swishes whose level follows fish activity.
    this.swim = ctx.createGain();
    this.swim.gain.value = 0;
    const swimSrc = this.loop(this.noise, 0.6);
    const swimBp = ctx.createBiquadFilter();
    swimBp.type = 'bandpass';
    swimBp.frequency.value = 520;
    swimBp.Q.value = 1.4;
    const swimLfo = ctx.createOscillator();
    swimLfo.frequency.value = 0.45;
    const swimLfoAmt = ctx.createGain();
    swimLfoAmt.gain.value = 260;
    swimLfo.connect(swimLfoAmt).connect(swimBp.frequency);
    swimLfo.start();
    swimSrc.connect(swimBp).connect(this.swim).connect(this.master);

    // Rain: bright hiss plus a dense patter body.
    this.rain = ctx.createGain();
    this.rain.gain.value = 0;
    this.rain.connect(this.master);
    const rainSrc = this.loop(this.noise, 0.9);
    const rainHp = ctx.createBiquadFilter();
    rainHp.type = 'highpass';
    rainHp.frequency.value = 1400;
    const rainPeak = ctx.createBiquadFilter();
    rainPeak.type = 'peaking';
    rainPeak.frequency.value = 4200;
    rainPeak.gain.value = 5;
    const rainLp = ctx.createBiquadFilter();
    rainLp.type = 'lowpass';
    rainLp.frequency.value = 9000;
    rainSrc.connect(rainHp).connect(rainPeak).connect(rainLp).connect(this.rain);
    const rumble = this.loop(this.brown, 0.4);
    const rumbleLp = ctx.createBiquadFilter();
    rumbleLp.type = 'lowpass';
    rumbleLp.frequency.value = 300;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0.6;
    rumble.connect(rumbleLp).connect(rumbleGain).connect(this.rain);

    // Vortex: a resonant swirling whoosh with a deep undertone.
    this.vortex = ctx.createGain();
    this.vortex.gain.value = 0;
    const vSrc = this.loop(this.noise, 1.7);
    const vBp = ctx.createBiquadFilter();
    vBp.type = 'bandpass';
    vBp.frequency.value = 380;
    vBp.Q.value = 5;
    const vLfo = ctx.createOscillator();
    vLfo.frequency.value = 0.35;
    const vLfoAmt = ctx.createGain();
    vLfoAmt.gain.value = 200;
    vLfo.connect(vLfoAmt).connect(vBp.frequency);
    vLfo.start();
    const vSrc2 = this.loop(this.noise, 0.8);
    const vBp2 = ctx.createBiquadFilter();
    vBp2.type = 'bandpass';
    vBp2.frequency.value = 900;
    vBp2.Q.value = 3;
    const vLfo2 = ctx.createOscillator();
    vLfo2.frequency.value = 0.55;
    const vLfo2Amt = ctx.createGain();
    vLfo2Amt.gain.value = 420;
    vLfo2.connect(vLfo2Amt).connect(vBp2.frequency);
    vLfo2.start();
    const vG2 = ctx.createGain();
    vG2.gain.value = 0.4;
    vSrc.connect(vBp).connect(this.vortex);
    vSrc2.connect(vBp2).connect(vG2).connect(this.vortex);
    const sub = this.loop(this.brown, 1.1);
    const subLp = ctx.createBiquadFilter();
    subLp.type = 'lowpass';
    subLp.frequency.value = 140;
    const subG = ctx.createGain();
    subG.gain.value = 1.4;
    sub.connect(subLp).connect(subG).connect(this.vortex);
    const vPan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (vPan) {
      this.vortex.connect(vPan).connect(this.master);
      const panLfo = ctx.createOscillator();
      panLfo.frequency.value = 0.35;
      const panAmt = ctx.createGain();
      panAmt.gain.value = 0.5;
      panLfo.connect(panAmt).connect(vPan.pan);
      panLfo.start();
    } else {
      this.vortex.connect(this.master);
    }

    this.applyLevels(0);
  }

  makeNoise(seconds) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(2, ctx.sampleRate * seconds, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return buf;
  }

  makeBrown(seconds) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(2, ctx.sampleRate * seconds, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let last = 0;
      for (let i = 0; i < d.length; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        d[i] = last * 3.5;
      }
    }
    return buf;
  }

  makeImpulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  loop(buffer, rate = 1) {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.playbackRate.value = rate;
    src.loopStart = 0;
    src.start(0, Math.random() * buffer.duration * 0.9);
    return src;
  }

  async setEnabled(on) {
    this.enabled = on;
    if (on) {
      this.init();
      if (!this.ctx) return;
      clearTimeout(this.suspendTimer);
      if (this.ctx.state !== 'running') {
        try { await this.ctx.resume(); } catch (e) { /* ignore */ }
      }
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setValueAtTime(this.master.gain.value, t);
      this.master.gain.linearRampToValueAtTime(0.9, t + 1.2);
    } else if (this.ctx) {
      // Fade out gracefully, then suspend to save power.
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setValueAtTime(this.master.gain.value, t);
      this.master.gain.linearRampToValueAtTime(0, t + 1.1);
      clearTimeout(this.suspendTimer);
      this.suspendTimer = setTimeout(() => {
        if (!this.enabled && this.ctx) this.ctx.suspend();
      }, 1300);
    }
  }

  onVisibility() {
    if (!this.ctx) return;
    if (document.hidden) {
      this.ctx.suspend();
    } else if (this.enabled) {
      this.ctx.resume();
    }
  }

  // Continuous layers: called every frame with smoothed targets.
  setLevels(rain, vortex, activity, calm) {
    this.rainLevel = rain;
    this.vortexLevel = vortex;
    this.activity = activity;
    this.calm = calm;
    if (this.ready) this.applyLevels(0.4);
  }

  applyLevels(tc) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const set = (param, v) => (tc ? param.setTargetAtTime(v, t, tc) : (param.value = v));
    set(this.ambient.gain, (this.calm ? 0.42 : 0.55));
    set(this.swim.gain, Math.min(0.22, 0.025 + this.activity * 0.012) * (this.calm ? 0.6 : 1));
    set(this.rain.gain, this.rainLevel * 0.32);
    set(this.vortex.gain, this.vortexLevel * 0.45);
  }

  // x01 in [0,1] maps across the pond to a pitch so drags play melodies.
  drop(x01 = Math.random(), intensity = 1, force = false) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    if (!force && now - this.lastDrop < 0.07) return;
    this.lastDrop = now;
    const step = Math.round(x01 * 9) + (Math.random() < 0.25 ? 5 : 0);
    const f = noteFreq(392, step);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f * 0.55, now);
    osc.frequency.exponentialRampToValueAtTime(f, now + 0.045);
    osc.frequency.exponentialRampToValueAtTime(f * 1.12, now + 0.25);
    const g = ctx.createGain();
    const peak = 0.22 * intensity;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(peak, now + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
    const over = ctx.createOscillator();
    over.type = 'triangle';
    over.frequency.setValueAtTime(f * 2, now);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, now);
    og.gain.exponentialRampToValueAtTime(peak * 0.12, now + 0.01);
    og.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    if (pan.pan) pan.pan.value = (x01 - 0.5) * 1.2;
    osc.connect(g);
    over.connect(og).connect(g);
    g.connect(pan);
    pan.connect(this.master);
    const send = ctx.createGain();
    send.gain.value = 0.7;
    pan.connect(send).connect(this.reverb);
    osc.start(now);
    over.start(now);
    osc.stop(now + 0.5);
    over.stop(now + 0.25);
  }

  // Tiny raindrop tick.
  tick(x01) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const f = 1800 + Math.random() * 2600;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(f * 0.7, now);
    osc.frequency.exponentialRampToValueAtTime(f, now + 0.02);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.025 + Math.random() * 0.03, now + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    if (pan.pan) pan.pan.value = (x01 - 0.5) * 1.6;
    osc.connect(g).connect(pan).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.08);
  }

  splash(x01 = 0.5, size = 1) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    if (pan.pan) pan.pan.value = (x01 - 0.5) * 1.2;
    pan.connect(this.master);
    const send = ctx.createGain();
    send.gain.value = 0.35;
    pan.connect(send).connect(this.reverb);

    // Body of water breaking: filtered noise sweeping down.
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(3200, now);
    bp.frequency.exponentialRampToValueAtTime(500, now + 0.35);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.75 * size, now + 0.012);
    g.gain.exponentialRampToValueAtTime(0.2 * size, now + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
    src.connect(bp).connect(g).connect(pan);
    src.start(now, Math.random() * 3);
    src.stop(now + 0.8);

    // The deep "plop" of the cavity collapsing.
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(210, now + 0.02);
    osc.frequency.exponentialRampToValueAtTime(70, now + 0.22);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, now);
    og.gain.exponentialRampToValueAtTime(0.6 * size, now + 0.03);
    og.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    osc.connect(og).connect(pan);
    osc.start(now);
    osc.stop(now + 0.4);

    // Droplets falling back.
    for (let i = 0; i < 7; i++) {
      const t0 = now + 0.12 + Math.random() * 0.6;
      const f = 900 + Math.random() * 1800;
      const d = ctx.createOscillator();
      d.frequency.setValueAtTime(f * 0.6, t0);
      d.frequency.exponentialRampToValueAtTime(f, t0 + 0.03);
      const dg = ctx.createGain();
      dg.gain.setValueAtTime(0.0001, t0);
      dg.gain.exponentialRampToValueAtTime(0.06 + Math.random() * 0.05, t0 + 0.004);
      dg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
      d.connect(dg).connect(pan);
      d.start(t0);
      d.stop(t0 + 0.15);
    }
  }
}
