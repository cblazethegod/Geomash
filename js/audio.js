'use strict';

// Procedural audio engine (Web Audio API). No external assets — every sound is
// synthesized on the fly, so the game works fully offline.
const clamp01 = (v) => Math.max(0, Math.min(1, v));

const Audio = (function(){
  let ctx = null;
  let master = null;
  let sfxVol = 1;
  let musicVol = 1;

  function ensure(){
    if(!ctx){
      const AC = window.AudioContext || window.webkitAudioContext;
      if(!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(ctx.destination);
    }
    return ctx;
  }
  function resume(){ return ctx ? ctx.resume() : Promise.resolve(); }

  function tone({type='sine', freq=440, freq2, start=0, dur=0.1, vol=0.4}){
    const c = ensure(); if(!c) return;
    const t = Math.max(c.currentTime, start);
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if(freq2) o.frequency.exponentialRampToValueAtTime(freq2, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol * sfxVol, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g); g.connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  let noiseBuf = null;
  function noise(dur, vol){
    const c = ensure(); if(!c) return;
    if(!noiseBuf){
      const len = c.sampleRate * 2;
      noiseBuf = c.createBuffer(1, len, c.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for(let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    const n = c.createBufferSource(); n.buffer = noiseBuf;
    const g = c.createGain();
    g.gain.setValueAtTime((vol || 0.5) * sfxVol, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0005, c.currentTime + dur);
    n.connect(g); g.connect(master);
    n.start();
    n.stop(c.currentTime + dur);
  }

  const SFX = {
    jump(){
      tone({type:'sine', freq:240, dur:0.10, vol:0.35});
      tone({type:'sine', freq:370, dur:0.09, vol:0.25, start:0.05});
    },
    orb(){
      [520, 693, 924].forEach((f, i) =>
        tone({type:'square', freq: f, dur:0.08, vol:0.25, start: i * 0.045}));
    },
    pad(){
      tone({type:'sawtooth', freq:100, dur:0.12, vol:0.30});
      tone({type:'square', freq:700, dur:0.05, vol:0.18, start:0.02});
    },
    death(){
      noise(0.35, 0.5);
      tone({type:'sawtooth', freq:150, freq2:50, dur:0.7, vol:0.3});
    },
    portal(){
      [349, 440, 523, 698].forEach((f, i) =>
        tone({type:'sine', freq: f, dur:0.18, vol:0.22, start: i * 0.05}));
    },
    coin(){
      tone({type:'sine', freq:880, dur:0.08, vol:0.30});
      tone({type:'sine', freq:1047, dur:0.08, vol:0.30, start:0.04});
    },
    finish(){
      [523, 659, 784, 1047, 1319].forEach((f, i) =>
        tone({type:'square', freq: f, dur:0.25, vol:0.25, start: i * 0.10}));
    },
    click(){
      tone({type:'square', freq:900, dur:0.035, vol:0.12});
    },
    checkpoint(){
      tone({type:'sine', freq:600, dur:0.08, vol:0.25});
      tone({type:'sine', freq:900, dur:0.12, vol:0.25, start:0.07});
    }
  };

  // ---------- Music (procedural beat-synced synth track) ----------
  const Music = {
    active: false,
    bpm: 140,
    stepSec: 0,
    nextTime: 0,
    step: 0,
    timer: null,
    muted: false,
    pattern: null,

    start(bpm){
      if(this.active) return;
      const c = ensure(); if(!c) return;
      this.active = true;
      this.bpm = bpm || 140;
      this.stepSec = 60 / this.bpm / 4; // one 16th note
      this.nextTime = c.currentTime + 0.05;
      this.step = 0;
      this.pattern = buildPattern(this.bpm);
      this.timer = setInterval(() => this.tick(), 20);
    },
    stop(){
      this.active = false;
      if(this.timer){ clearInterval(this.timer); this.timer = null; }
    },
    tick(){
      if(!this.active) return;
      const c = ensure(); if(!c) return;
      const now = c.currentTime;
      const end = now + 0.18;
      while(this.nextTime < end){
        const ev = this.pattern[this.step % this.pattern.length];
        if(ev && !this.muted) this.play(ev, this.nextTime);
        this.step++;
        this.nextTime += this.stepSec;
      }
    },
    play(ev, when){
      switch(ev.i){
        case 'kick':
          tone({type:'sine', freq: ev.f, freq2: ev.f * 0.55, dur: 0.12, vol: 0.5 * musicVol, start: when});
          break;
        case 'snare':
          noise(0.09, 0.35 * musicVol);
          tone({type:'square', freq: 180, dur: 0.06, vol: 0.2 * musicVol, start: when});
          break;
        case 'hh':
          tone({type:'square', freq: 4500, dur: 0.025, vol: 0.10 * musicVol, start: when});
          break;
        case 'ohh':
          noise(0.14, 0.16 * musicVol);
          break;
        case 'bass':
          tone({type:'sawtooth', freq: ev.f, dur: 0.16, vol: 0.28 * musicVol, start: when});
          break;
        case 'arp':
          tone({type:'sine', freq: ev.f, dur: 0.07, vol: 0.14 * musicVol, start: when});
          break;
      }
    }
  };

  function buildPattern(bpm){
    const ev = [];
    const scale = [220, 247, 262, 294, 330, 349, 392]; // A minor pentatonic-ish
    const kickSteps = [0, 4, 8, 12];
    const snareSteps = [4, 12];
    const bassNotes = [scale[0], scale[0], scale[3], scale[2], scale[0], scale[3], scale[5], scale[4]];
    const arpMelody = [scale[2], scale[4], scale[6], scale[0], scale[4], scale[2], scale[0], scale[3]];

    for(let bar = 0; bar < 4; bar++){
      const base = bar * 16;
      kickSteps.forEach(s => ev.push({i:'kick', f: 110 + (bar % 2) * 22, t: base + s}));
      snareSteps.forEach(s => ev.push({i:'snare', f: 200, t: base + s}));
      for(let s = 0; s < 16; s++) ev.push({i:'hh', f: 4500, t: base + s});
      if(bar % 2 === 1) ev.push({i:'ohh', f: 0, t: base + 14});
      bassNotes.forEach((f, s) => { if(f) ev.push({i:'bass', f, t: base + s * 2}); });
      arpMelody.forEach((f, s) => { ev.push({i:'arp', f, t: base + s}); });
    }
    ev.sort((a, b) => a.t - b.t);
    return ev.map(e => ({i: e.i, f: e.f}));
  }

  return {
    ensure, resume,
    setSFXVol(v){ sfxVol = clamp01(v); },
    setMusicVol(v){ musicVol = clamp01(v); },
    tone, noise,
    SFX,
    Music
  };
})();
