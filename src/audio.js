import { clamp } from './utils.js';

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noise = null;
    this.enabled = true;
    this.speechEnabled = true;
    this.lastSpeakAt = 0;
  }

  ensure() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);

    const len = Math.floor(this.ctx.sampleRate * 0.6);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buf;
    return this.ctx;
  }

  resume() {
    const ctx = this.ensure();
    if (ctx?.state === 'suspended') ctx.resume();
  }

  tone(freq, dur, { type = 'sine', gain = 0.3, slide = 0, delay = 0 } = {}) {
    if (!this.enabled) return;
    const ctx = this.ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  noiseBurst(dur, { gain = 0.3, freq = 1200, q = 0.7, delay = 0 } = {}) {
    if (!this.enabled) return;
    const ctx = this.ensure();
    if (!ctx || !this.noise) return;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  kick(power = 0.5) {
    this.tone(120 + power * 40, 0.16, { type: 'sine', gain: 0.5, slide: -60 });
    this.noiseBurst(0.09, { gain: 0.28, freq: 900 + power * 900 });
    if (power > 0.8) this.tone(880, 0.18, { type: 'triangle', gain: 0.12, delay: 0.03 });
  }

  goal() {
    this.noiseBurst(0.7, { gain: 0.16, freq: 2400, q: 0.4 });
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => this.tone(f, 0.36, { type: 'triangle', gain: 0.22, delay: i * 0.09 }));
    this.tone(130.81, 0.4, { type: 'sine', gain: 0.2 });
    this.whistle(0.16);
  }

  save() {
    this.noiseBurst(0.14, { gain: 0.35, freq: 420 });
    this.tone(220, 0.22, { type: 'sawtooth', gain: 0.12, slide: -80 });
  }

  post() {
    this.tone(1180, 0.5, { type: 'square', gain: 0.16, slide: -220 });
    this.noiseBurst(0.08, { gain: 0.2, freq: 3000, q: 3 });
  }

  miss() {
    this.tone(360, 0.24, { type: 'triangle', gain: 0.16, slide: -120 });
  }

  ready() {
    this.tone(660, 0.09, { type: 'sine', gain: 0.14 });
    this.tone(990, 0.12, { type: 'sine', gain: 0.14, delay: 0.08 });
  }

  tick() {
    this.tone(760, 0.07, { type: 'sine', gain: 0.12 });
  }

  whistle(dur = 0.5) {
    this.tone(2100, dur, { type: 'sine', gain: 0.1, slide: 260 });
    this.tone(2350, dur, { type: 'sine', gain: 0.06, slide: 120 });
  }

  timeup() {
    this.whistle(0.22);
    this.tone(523.25, 0.5, { type: 'triangle', gain: 0.2, delay: 0.25 });
    this.tone(392, 0.5, { type: 'triangle', gain: 0.18, delay: 0.25 });
    this.tone(261.63, 0.8, { type: 'sine', gain: 0.2, delay: 0.5 });
  }

  speak(text) {
    if (!this.speechEnabled || !this.enabled) return;
    if (!('speechSynthesis' in window)) return;
    const now = performance.now();
    if (now - this.lastSpeakAt < 1200) return;
    this.lastSpeakAt = now;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-CN';
      u.rate = 1.05;
      u.pitch = 1.3;
      u.volume = 0.9;
      window.speechSynthesis.speak(u);
    } catch {
      /* speech is optional */
    }
  }

  setVolume(v) {
    if (this.master) this.master.gain.value = clamp(v, 0, 1);
  }
}
