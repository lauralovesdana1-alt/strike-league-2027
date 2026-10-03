// G-Football 2027 — all audio synthesized with WebAudio (no files)
export class AudioSys {
  constructor() {
    this.ctx = null;
    this.crowdGain = null;
    this.crowdFilter = null;
    this.master = null;
  }
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(this.ctx.destination);
    this.startCrowd();
  }
  // looping crowd ambience: filtered noise
  startCrowd() {
    const ctx = this.ctx;
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    this.crowdFilter = ctx.createBiquadFilter();
    this.crowdFilter.type = 'bandpass';
    this.crowdFilter.frequency.value = 900;
    this.crowdFilter.Q.value = 0.6;
    this.crowdGain = ctx.createGain();
    this.crowdGain.gain.value = 0.05;
    src.connect(this.crowdFilter).connect(this.crowdGain).connect(this.master);
    src.start();
  }
  crowdExcite(level) { // 0..1
    if (this.crowdGain) {
      const t = this.ctx.currentTime;
      this.crowdGain.gain.cancelScheduledValues(t);
      this.crowdGain.gain.setTargetAtTime(0.05 + level * 0.22, t, 0.4);
    }
  }
  noiseBurst(dur, freq, gain, type = 'lowpass') {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const len = Math.ceil(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
  }
  tone(freq, dur, gain, type = 'sine', slideTo = null) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  kick(power = 0.5) {
    this.tone(120, 0.12, 0.25 + power * 0.4, 'sine', 45);
    this.noiseBurst(0.08, 900, 0.12 + power * 0.2);
  }
  tackle() {
    this.noiseBurst(0.15, 500, 0.3);
    this.tone(90, 0.15, 0.2, 'triangle', 50);
  }
  post() { this.tone(620, 0.35, 0.25, 'triangle', 590); } // "ping" off the woodwork
  whistle(times = 1) {
    for (let i = 0; i < times; i++) {
      setTimeout(() => this.tone(2350, 0.28, 0.22, 'square'), i * 380);
    }
  }
  cheer(big = false) {
    this.crowdExcite(big ? 1 : 0.55);
    this.noiseBurst(big ? 2.2 : 1.1, 1400, big ? 0.5 : 0.28, 'bandpass');
    setTimeout(() => this.crowdExcite(0.08), big ? 2600 : 1400);
  }
  goalHorn() {
    this.tone(196, 0.9, 0.3, 'sawtooth', 185);
    this.tone(147, 0.9, 0.25, 'sawtooth', 140);
  }
  click() { this.tone(660, 0.06, 0.12, 'square'); }
  save() {
    this.noiseBurst(0.5, 1100, 0.2, 'bandpass');
    this.crowdExcite(0.4);
    setTimeout(() => this.crowdExcite(0.08), 900);
  }
}
export const audio = new AudioSys();
