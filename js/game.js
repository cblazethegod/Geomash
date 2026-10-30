'use strict';

/* ============================ Constants ============================ */
const W = 1280, H = 720;
const GROUND_Y = H - 86;
const CEIL_Y = 86;
const PS = 30;
const GRAV = 0.70;
const JUMP = -11.0;
const SPEED = 7.6;
const SPAWN_BUFFER = 320;

/* ============================ Util ============================ */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

function rectRect(r1, r2){
  return r1.x < r2.x + r2.w && r1.x + r1.w > r2.x &&
         r1.y < r2.y + r2.h && r1.y + r1.h > r2.y;
}
function rectCircle(r, cx, cy, rad){
  const cx2 = clamp(cx, r.x, r.x + r.w);
  const cy2 = clamp(cy, r.y, r.y + r.h);
  const dx = cx - cx2, dy = cy - cy2;
  return dx * dx + dy * dy < rad * rad;
}
function orient(a, b, c){
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}
function segIntersect(ax, ay, bx, by, cx, cy, dx, dy){
  const o1 = orient({x:ax,y:ay}, {x:bx,y:by}, {x:cx,y:cy});
  const o2 = orient({x:ax,y:ay}, {x:bx,y:by}, {x:dx,y:dy});
  const o3 = orient({x:cx,y:cy}, {x:dx,y:dy}, {x:ax,y:ay});
  const o4 = orient({x:cx,y:cy}, {x:dx,y:dy}, {x:bx,y:by});
  return o1 * o2 < 0 && o3 * o4 < 0;
}
function rectContains(px, py, r){
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}
function pointInTriangle(px, py, ax, ay, bx, by, cx2, cy2){
  const v0x = cx2 - ax, v0y = cy2 - ay;
  const v1x = bx - ax, v1y = by - ay;
  const v2x = px - ax, v2y = py - ay;
  const d00 = v0x * v0x + v0y * v0y;
  const d01 = v0x * v1x + v0y * v1y;
  const d02 = v0x * v2x + v0y * v2y;
  const d11 = v1x * v1x + v1y * v1y;
  const d12 = v1x * v2x + v1y * v2y;
  const denom = d00 * d11 - d01 * d01;
  if(denom === 0) return false;
  const inv = 1 / denom;
  const u = (d11 * d02 - d01 * d12) * inv;
  const v = (d00 * d12 - d01 * d02) * inv;
  return u >= 0 && v >= 0 && u + v <= 1;
}
function bitCount(n){ n = n - ((n >> 1) & 0x55555555); n = (n & 0x33333333) + ((n >> 2) & 0x33333333); return ((n + (n >> 4) & 0xF0F0F0F) * 0x1010101) >> 24; }
function escapeHtml(t){ return String(t).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[c])); }

/* ============================ Input ============================ */
const Input = (function(){
  const down = new Set(), just = new Set();
  function keydown(e){ down.add(e.code); just.add(e.code); }
  function keyup(e){ down.delete(e.code); }
  function pointerdown(e){
    if(e.target && (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT')) return;
    down.add('pointer'); just.add('pointer');
  }
  function pointerup(e){ down.delete('pointer'); }
  return {
    init(el){
      window.addEventListener('keydown', keydown);
      window.addEventListener('keyup', keyup);
      el.addEventListener('pointerdown', pointerdown, {passive: false});
      el.addEventListener('pointerup', pointerup);
      el.addEventListener('pointercancel', pointerup);
      window.addEventListener('blur', () => { down.clear(); just.clear(); });
    },
    begin(){ just.clear(); },
    isDown(c){ return down.has(c); },
    pressed(c){ if(just.has(c)){ just.delete(c); return true; } return false; }
  };
})();

/* ============================ Particles ============================ */
class Particle {
  constructor(x, y, c, type){
    this.x = x; this.y = y; this.c = c; this.t = type || 'dot';
    const a = Math.random() * Math.PI * 2, s = Math.random() * 4 + 1;
    this.vx = Math.cos(a) * s; this.vy = Math.sin(a) * s;
    this.life = 1; this.size = Math.random() * 3 + 2;
    if(type === 'death'){ this.vx *= 1.6; this.vy *= 1.6; this.size *= 1.7; }
  }
  update(){
    this.x += this.vx; this.y += this.vy; this.vy += 0.2;
    this.life -= 0.045; this.size *= 0.92;
  }
  draw(ctx){
    ctx.globalAlpha = this.life; ctx.fillStyle = this.c;
    ctx.beginPath(); ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
}

let gameRef = null;
function spawnParticles(x, y, color, type, n){
  for(let i = 0; i < n; i++) gameRef.particles.push(new Particle(x, y, color, type));
}

/* ============================ Player ============================ */
class Player {
  constructor(){ this.reset(); }
  reset(){
    this.x = 180; this.y = GROUND_Y - PS / 2;
    this.vx = SPEED; this.vy = 0;
    this.scale = 1; this.size = PS;
    this.gdir = 1; // 1 = floor, -1 = ceiling
    this.angle = 0;
    this.onGround = false;
    this.dead = false;
    this.deadTimer = 0;
    this.invuln = 0;
    this.color = '#22d3ee';
  }
  jump(mult = 1){
    if(this.dead) return;
    this.vy = JUMP * mult * this.gdir;
    this.onGround = false;
    Audio.SFX.jump();
    spawnParticles(this.x, this.y + this.gdir * this.size / 2, this.color, 'jump', 10);
  }
  update(cameraX, endX){
    if(this.dead){
      this.deadTimer += 1 / 60;
      return false;
    }
    this.x += this.vx;
    this.vy += GRAV * this.gdir;
    const s = PS * this.scale;
    const targetY = this.gdir > 0 ? GROUND_Y - s / 2 : CEIL_Y + s / 2;
    if(this.gdir > 0 ? this.y >= targetY : this.y <= targetY){
      this.y = targetY; this.vy = 0; this.onGround = true;
    } else { this.onGround = false; }
    const spin = this.onGround ? this.vx * 0.16 * this.gdir : this.vy * 0.05 * this.gdir;
    this.angle += spin;
    if(this.y > H + 60 || this.y < -60) this.die();
    if(this.invuln > 0) this.invuln -= 1 / 60;
    return this.x >= endX;
  }
  die(){
    if(this.dead) return;
    this.dead = true; this.deadTimer = 0;
    Audio.SFX.death();
    spawnParticles(this.x, this.y, '#ef4444', 'death', 26);
    spawnParticles(this.x, this.y, '#f59e0b', 'death', 14);
    spawnParticles(this.x, this.y, '#fbbf24', 'death', 10);
  }
  rect(){
    const s = PS * this.scale;
    return { x: this.x - s / 2, y: this.y - s / 2, w: s, h: s };
  }
  draw(ctx, cx){
    const sx = this.x - cx;
    if(sx < -80 || sx > W + 80) return;
    const s = PS * this.scale;
    ctx.save();
    ctx.translate(sx, this.y);
    ctx.rotate(this.angle);
    ctx.shadowColor = this.color;
    ctx.shadowBlur = this.dead ? 0 : 14;
    ctx.fillStyle = this.color;
    ctx.fillRect(-s / 2, -s / 2, s, s);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(-s / 2 + 6, -s / 2 + 6, s - 12, s - 12);
    const ed = s * 0.22;
    const ex = Math.cos(this.angle) * ed;
    const ey = Math.sin(this.angle) * ed;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(ex - 5, ey - 4, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(ex + 5, ey - 4, 3, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
  }
}

/* ============================ Entities ============================ */
class Spike {
  constructor(spec){
    this.x = spec.x; this.type = 'spike'; this.deadly = true; this.remove = false;
    this.side = spec.side || 'floor';
    this.y = spec.y !== undefined ? spec.y : (this.side === 'floor' ? GROUND_Y : CEIL_Y);
  }
  tri(){
    const baseY = this.y;
    const tipY = this.side === 'floor' ? baseY - 64 : baseY + 64;
    return [this.x - 24, baseY, this.x + 24, baseY, this.x, tipY];
  }
  rect(){
    return { x: this.x - 24, y: this.side === 'floor' ? this.y - 64 : this.y, w: 48, h: 64 };
  }
  collide(pr){
    const [ax, ay, bx, by, tx, ty] = this.tri();
    const corners = [[pr.x, pr.y], [pr.x + pr.w, pr.y], [pr.x, pr.y + pr.h], [pr.x + pr.w, pr.y + pr.h]];
    for(const c of corners) if(pointInTriangle(c[0], c[1], ax, ay, bx, by, tx, ty)) return true;
    const triPts = [[ax, ay], [bx, by], [tx, ty]];
    for(const c of triPts) if(rectContains(c[0], c[1], pr)) return true;
    const rectEdges = [[pr.x, pr.y, pr.x + pr.w, pr.y], [pr.x + pr.w, pr.y, pr.x + pr.w, pr.y + pr.h], [pr.x + pr.w, pr.y + pr.h, pr.x, pr.y + pr.h], [pr.x, pr.y + pr.h, pr.x, pr.y]];
    const triEdges = [[ax, ay, bx, by], [bx, by, tx, ty], [tx, ty, ax, ay]];
    for(const te of triEdges){
      for(const re of rectEdges){
        if(segIntersect(te[0], te[1], te[2], te[3], re[0], re[1], re[2], re[3])) return true;
      }
    }
    return false;
  }
  draw(ctx, cx){
    const sx = this.x - cx;
    if(sx < -60 || sx > W + 60) return;
    const baseY = this.y;
    const tipY = this.side === 'floor' ? baseY - 64 : baseY + 64;
    ctx.save(); ctx.translate(sx, 0);
    ctx.fillStyle = '#ef4444';
    ctx.shadowColor = '#ef4444'; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.moveTo(-24, baseY); ctx.lineTo(24, baseY); ctx.lineTo(0, tipY); ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-24, baseY); ctx.lineTo(24, baseY); ctx.lineTo(0, tipY); ctx.closePath(); ctx.stroke();
    ctx.restore();
  }
}
class Block {
  constructor(spec){
    this.x = spec.x; this.type = 'block'; this.deadly = true; this.remove = false;
    this.side = spec.side || 'floor';
    this.y = spec.y !== undefined ? spec.y : (this.side === 'floor' ? GROUND_Y : CEIL_Y);
    this.w = 40; this.h = 40;
  }
  rect(){
    return { x: this.x - 20, y: this.side === 'floor' ? this.y - 40 : this.y, w: 40, h: 40 };
  }
  draw(ctx, cx){
    const sx = this.x - cx;
    if(sx < -60 || sx > W + 60) return;
    const top = this.side === 'floor' ? this.y - 40 : this.y;
    ctx.save(); ctx.translate(sx, top);
    ctx.fillStyle = '#22d3ee';
    ctx.shadowColor = '#22d3ee'; ctx.shadowBlur = 12;
    ctx.fillRect(-20, 0, 40, 40);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(-16, 4, 32, 32);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2;
    ctx.strokeRect(-20, 0, 40, 40);
    ctx.restore();
  }
}
class Saw {
  constructor(spec){
    this.x = spec.x; this.type = 'saw'; this.deadly = true; this.remove = false;
    this.side = spec.side || 'floor';
    this.y = spec.y !== undefined ? spec.y : (this.side === 'floor' ? GROUND_Y : CEIL_Y);
    this.r = 22; this.angle = 0;
  }
  update(){ this.angle += 0.30; }
  rect(){ return { x: this.x - this.r, y: this.y - this.r, w: this.r * 2, h: this.r * 2 }; }
  draw(ctx, cx){
    const sx = this.x - cx;
    if(sx < -60 || sx > W + 60) return;
    ctx.save(); ctx.translate(sx, this.y); ctx.rotate(this.angle);
    ctx.fillStyle = '#dc2626';
    ctx.shadowColor = '#dc2626'; ctx.shadowBlur = 14;
    ctx.beginPath(); ctx.arc(0, 0, this.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#050609';
    ctx.beginPath(); ctx.arc(0, 0, this.r * 0.42, 0, Math.PI * 2); ctx.fill();
    for(let i = 0; i < 8; i++){
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * (this.r - 4), Math.sin(a) * (this.r - 4));
      ctx.lineTo(Math.cos(a + 0.35) * (this.r + 6), Math.sin(a + 0.35) * (this.r + 6));
      ctx.lineTo(Math.cos(a - 0.35) * (this.r + 6), Math.sin(a - 0.35) * (this.r + 6));
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.restore();
  }
}
class Portal {
  constructor(spec){
    this.x = spec.x; this.type = 'portal'; this.deadly = false; this.remove = false;
    this.side = spec.side || 'floor';
    this.kind = spec.kind || 'gravity';
    this.y = spec.y !== undefined ? spec.y : (this.side === 'floor' ? GROUND_Y : CEIL_Y);
    this.r = this.kind === 'gravity' ? 30 : 24;
    this.canTrigger = true;
  }
  rect(){ return { x: this.x - this.r, y: this.y - this.r, w: this.r * 2, h: this.r * 2 }; }
  color(){ return this.kind === 'gravity' ? '#22d3ee' : (this.kind === 'mini' ? '#f59e0b' : '#fbbf24'); }
  draw(ctx, cx){
    const sx = this.x - cx;
    if(sx < -60 || sx > W + 60) return;
    const col = this.color();
    const t = Date.now() / 280;
    ctx.save(); ctx.translate(sx, this.y);
    ctx.rotate(t * 0.5);
    ctx.lineWidth = 3; ctx.strokeStyle = col;
    ctx.shadowColor = col; ctx.shadowBlur = 16;
    ctx.beginPath(); ctx.arc(0, 0, this.r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, this.r - 8, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.rect(-this.r * 0.35, -this.r * 0.35, this.r * 0.7, this.r * 0.7); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.restore();
  }
}
class Orb {
  constructor(spec){
    this.x = spec.x; this.type = 'orb'; this.deadly = false; this.remove = false;
    this.y = spec.y !== undefined ? spec.y : GROUND_Y - 14;
    this.power = spec.power || 1.4;
    this.r = 10;
    this.color = this.power > 1.2 ? '#f472b6' : '#60a5fa';
  }
  rect(){ return { x: this.x - this.r, y: this.y - this.r, w: this.r * 2, h: this.r * 2 }; }
  draw(ctx, cx){
    const sx = this.x - cx;
    if(sx < -40 || sx > W + 40) return;
    ctx.save(); ctx.translate(sx, this.y);
    const t = Date.now() / 400;
    ctx.fillStyle = this.color;
    ctx.shadowColor = this.color; ctx.shadowBlur = 14;
    ctx.beginPath(); ctx.arc(0, 0, this.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath(); ctx.arc(Math.sin(t) * 2 - 3, Math.cos(t) * 2 - 3, 4, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
  }
}
class Pad {
  constructor(spec){
    this.x = spec.x; this.type = 'pad'; this.deadly = false; this.remove = false;
    this.y = spec.y !== undefined ? spec.y : GROUND_Y - 6;
  }
  rect(){ return { x: this.x - 17, y: this.y - 4, w: 34, h: 8 }; }
  draw(ctx, cx){
    const sx = this.x - cx;
    if(sx < -60 || sx > W + 60) return;
    ctx.save(); ctx.translate(sx, this.y);
    ctx.fillStyle = '#f59e0b';
    ctx.shadowColor = '#f59e0b'; ctx.shadowBlur = 12;
    ctx.fillRect(-17, -4, 34, 8);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    for(let i = -13; i <= 13; i += 7){ ctx.fillRect(i, -2, 4, 4); }
    ctx.restore();
  }
}
class Coin {
  constructor(spec){
    this.x = spec.x; this.type = 'coin'; this.deadly = false; this.remove = false;
    this.y = spec.y !== undefined ? spec.y : GROUND_Y - 150;
    this.r = 7;
  }
  rect(){ return { x: this.x - this.r, y: this.y - this.r, w: this.r * 2, h: this.r * 2 }; }
  draw(ctx, cx){
    const sx = this.x - cx;
    if(sx < -40 || sx > W + 40) return;
    ctx.save(); ctx.translate(sx, this.y);
    const t = Date.now() / 200;
    ctx.rotate(t);
    ctx.fillStyle = '#fbbf24';
    ctx.shadowColor = '#fbbf24'; ctx.shadowBlur = 14;
    ctx.beginPath(); ctx.arc(0, 0, this.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath(); ctx.arc(-3, -3, 4, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
  }
}
class Checkpoint {
  constructor(spec){
    this.x = spec.x; this.type = 'cp'; this.deadly = false; this.remove = false;
    this.y = spec.y !== undefined ? spec.y : GROUND_Y;
    this.activated = false;
  }
  rect(){ return { x: this.x - 12, y: this.y - 26, w: 24, h: 26 }; }
  draw(ctx, cx){
    const sx = this.x - cx;
    if(sx < -40 || sx > W + 40) return;
    const col = this.activated ? '#22c55e' : '#ef4444';
    ctx.save(); ctx.translate(sx, 0);
    ctx.strokeStyle = col; ctx.lineWidth = 4;
    ctx.shadowColor = col; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.moveTo(0, GROUND_Y); ctx.lineTo(0, GROUND_Y - 20); ctx.stroke();
    ctx.fillStyle = col;
    ctx.fillRect(0, GROUND_Y - 20, 14, 10);
    ctx.shadowBlur = 0;
    ctx.restore();
  }
}
class Finish {
  constructor(spec){
    this.x = spec.x; this.type = 'finish'; this.deadly = false; this.remove = false;
    this.y = spec.y !== undefined ? spec.y : GROUND_Y;
    this.r = 40;
  }
  rect(){ return { x: this.x - this.r, y: this.y - this.r, w: this.r * 2, h: this.r * 2 }; }
  draw(ctx, cx){
    const sx = this.x - cx;
    if(sx < -80 || sx > W + 80) return;
    const t = Date.now() / 350;
    ctx.save(); ctx.translate(sx, this.y); ctx.rotate(Math.sin(t) * 0.12);
    ctx.lineWidth = 4; ctx.strokeStyle = '#22c55e';
    ctx.shadowColor = '#22c55e'; ctx.shadowBlur = 20;
    ctx.beginPath(); ctx.arc(0, 0, this.r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, this.r - 10, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#22c55e';
    ctx.beginPath(); ctx.moveTo(0, -this.r + 7); ctx.lineTo(7, 0); ctx.lineTo(0, this.r - 7); ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, -this.r + 7); ctx.lineTo(-7, 0); ctx.lineTo(0, this.r - 7); ctx.fill();
    ctx.restore();
  }
}

function makeEntity(spec){
  switch(spec.type){
    case 'spike': return new Spike(spec);
    case 'block': return new Block(spec);
    case 'saw': return new Saw(spec);
    case 'portal': return new Portal(spec);
    case 'orb': return new Orb(spec);
    case 'pad': return new Pad(spec);
    case 'coin': return new Coin(spec);
    case 'cp': return new Checkpoint(spec);
    case 'finish': return new Finish(spec);
  }
  return null;
}

/* ============================ Level ============================ */
class Level {
  constructor(spec){
    this.id = spec.id;
    this.name = spec.name;
    this.bpm = spec.bpm || 140;
    this.lengthSec = spec.lengthSec || 60;
    this.endX = spec.endX != null ? spec.endX : 180 + SPEED * 60 * this.lengthSec;
    this.endless = !!spec.endless;
    this.music = spec.music !== false;
    this.objects = [];
    if(spec.build) this.objects = spec.build.call(this);
    else this.objects = (spec.objects || []).map(o => ({...o}));
    this.objects.sort((a, b) => a.x - b.x);
    let coinOrdinal = 0;
    this.objects.forEach(o => { if(o.type === 'coin') o.coinOrdinal = coinOrdinal++; });
  }
}

/* ============================ Built-in level: Neon Overdrive ============================ */
const LEVELS = [{
  id: 'neon-overdrive',
  name: 'Neon Overdrive',
  bpm: 150,
  lengthSec: 91,
  endX: 43400,
  build(){
    const B = (bar, off) => 180 + 48 * (bar * 16 + off);
    const ev = [];
    // coins (skill placements)
    ev.push({x: B(14, 10), type: 'orb', power: 1.4});      // orb to reach coin 1
    ev.push({x: B(14, 14), type: 'coin', y: GROUND_Y - 140});
    ev.push({x: B(26, 0), type: 'orb', power: 1.4});      // inverted dive to coin 2
    ev.push({x: B(26, 4), type: 'coin', y: CEIL_Y + 140});
    ev.push({x: B(50, 3), type: 'orb', power: 1.4});      // orb to reach coin 3
    ev.push({x: B(50, 7), type: 'coin', y: GROUND_Y - 140});
    // practice checkpoints
    [10, 20, 34, 46].forEach(b => ev.push({x: B(b, 0), type: 'cp'}));
    // A: intro
    for(let b = 0; b < 8; b++){
      if(b % 2 === 0) ev.push({x: B(b, 0), type: 'block'});
      ev.push({x: B(b, 6), type: 'spike'});
    }
    // B: triple spikes
    for(let b = 8; b < 16; b++){
      ev.push({x: B(b, 0), type: 'spike'});
      ev.push({x: B(b, 2), type: 'spike'});
      ev.push({x: B(b, 4), type: 'spike'});
      if(b % 2 === 0) ev.push({x: B(b, 10), type: 'block'});
    }
    // C: alternating saws
    for(let b = 16; b < 24; b++){
      const side = b % 2 === 0 ? 'floor' : 'ceil';
      ev.push({x: B(b, 0), type: 'saw', side});
      ev.push({x: B(b, 8), type: 'saw', side});
    }
    // D: gravity flip zone
    ev.push({x: B(24, 0), type: 'portal', kind: 'gravity'});
    for(let b = 24; b < 28; b++){
      ev.push({x: B(b, 2), type: 'spike', side: 'ceil'});
      ev.push({x: B(b, 6), type: 'spike', side: 'ceil'});
    }
    ev.push({x: B(27, 14), type: 'portal', kind: 'gravity'});
    // E: orb jump run
    for(let b = 29; b < 37; b++){
      ev.push({x: B(b, 0), type: 'orb', power: 1.4});
      ev.push({x: B(b, 5), type: 'spike'});
    }
    ev.push({x: B(33, 0), type: 'pad'});
    // F: dense drop
    for(let b = 37; b < 49; b++){
      ev.push({x: B(b, 0), type: 'spike'});
      if(b % 2 === 0) ev.push({x: B(b, 4), type: 'saw'});
      ev.push({x: B(b, 8), type: 'spike'});
      if(b % 3 === 0) ev.push({x: B(b, 12), type: 'block'});
    }
    // G: finale
    for(let b = 49; b < 55; b++){
      ev.push({x: B(b, 0), type: 'spike'});
      ev.push({x: B(b, 3), type: 'orb', power: 1.0});
      ev.push({x: B(b, 6), type: 'spike'});
      if(b % 2 === 0) ev.push({x: B(b, 10), type: 'saw'});
    }
    ev.push({x: B(55, 10), type: 'finish'});
    return ev;
  }
}];

/* ============================ Game ============================ */
class Game {
  constructor(){
    this.canvas = document.getElementById('game');
    this.ctx = this.canvas.getContext('2d', {alpha: false});
    this.ctx.imageSmoothingEnabled = false;
    gameRef = this;

    Input.init(this.canvas);

    this.state = 'MENU';
    this.level = null;
    this.player = new Player();
    this.cameraX = 0;
    this.particles = [];
    this.entities = [];
    this.spawnIdx = 0;
    this.attempt = 0;
    this.coins = 0;
    this.coinsCollectedMask = 0;
    this.practice = localStorage.getItem('gm_practice') === '1';
    this.checkpoints = [];
    this.lastCPX = null;
    this.deadTimer = 0;
    this.wonTimer = 0;
    this.progress = 0;
    this.editor = { tool: 'block', objects: [], selected: null, cam: 0, grid: 40, mouse: null, name: 'Custom Level' };
    this.endlessTimer = 0;
    this.endlessDiff = 0;
    this.lastTime = performance.now();

    // editor UI wiring
    document.getElementById('svol').value = localStorage.getItem('gm_music_vol') || '1';
    document.getElementById('sfxvol').value = localStorage.getItem('gm_sfx_vol') || '1';
    document.getElementById('spractice').checked = this.practice;
    Audio.setMusicVol(parseFloat(document.getElementById('svol').value));
    Audio.setSFXVol(parseFloat(document.getElementById('sfxvol').value));
    document.getElementById('svol').addEventListener('input', e => { Audio.setMusicVol(e.target.value); localStorage.setItem('gm_music_vol', e.target.value); });
    document.getElementById('sfxvol').addEventListener('input', e => { Audio.setSFXVol(e.target.value); localStorage.setItem('gm_sfx_vol', e.target.value); });
    document.getElementById('spractice').addEventListener('change', e => { this.practice = e.target.checked; localStorage.setItem('gm_practice', this.practice ? '1' : '0'); });

    requestAnimationFrame((t) => this.loop(t));
  }

  /* ---- state flow ---- */
  setState(s){
    this.state = s;
    document.querySelectorAll('.panel').forEach(el => el.classList.add('hidden'));
    const hud = document.getElementById('hud');
    hud.style.display = s === 'PLAYING' ? 'flex' : 'none';
  }
  showMenu(){
    Audio.Music.stop();
    this.setState('MENU');
    document.getElementById('panel-menu').classList.remove('hidden');
  }
  startGame(){
    this.startLevelById('neon-overdrive', false);
  }
  openLevels(){
    this.renderLevels();
    this.setState('LEVELS');
    document.getElementById('panel-levels').classList.remove('hidden');
  }
  openSettings(){
    this.setState('SETTINGS');
    document.getElementById('panel-settings').classList.remove('hidden');
  }
  openEditor(){
    Audio.Music.stop();
    this.setState('EDITOR');
    document.getElementById('panel-editor').classList.remove('hidden');
    document.getElementById('ed-name').textContent = this.editor.name;
    this.buildEditorToolbar();
  }
  exitEditor(){
    this.showMenu();
  }

  togglePractice(){
    this.practice = !this.practice;
    localStorage.setItem('gm_practice', this.practice ? '1' : '0');
    document.getElementById('spractice').checked = this.practice;
    document.getElementById('btnTogglePractice').textContent = 'Practice: ' + (this.practice ? 'On' : 'Off');
  }

  pause(){
    if(this.state !== 'PLAYING') return;
    this.setState('PAUSED');
    document.getElementById('panel-pause').classList.remove('hidden');
  }
  resume(){
    if(this.state === 'PAUSED') this.setState('PLAYING');
  }

  restart(){
    if(!this.level) return;
    this.startLevel({
      id: this.level.id,
      name: this.level.name,
      bpm: this.level.bpm,
      lengthSec: this.level.lengthSec,
      endX: this.level.endX,
      endless: this.level.endless,
      music: this.level.music,
      objects: this.level.objects.map(o => ({...o})),
      practice: this.practice
    });
  }

  /* ---- level spec resolution & start ---- */
  levelSpec(id){
    if(id === 'endless'){
      return { id: 'endless', name: 'Endless Mode', endless: true, bpm: 160, lengthSec: 999, endX: Infinity, music: true, objects: [] };
    }
    const builtin = LEVELS.find(l => l.id === id);
    if(builtin) return builtin;
    const raw = localStorage.getItem(id);
    if(raw){
      const d = JSON.parse(raw);
      let endX = 2000;
      if(d.objects && d.objects.length) endX = Math.max(...d.objects.map(o => o.x)) + 600;
      return { id, name: d.name, bpm: d.bpm || 140, lengthSec: 60, endX, music: true, objects: d.objects || [] };
    }
    return null;
  }
  startLevelById(id, practice){
    const spec = this.levelSpec(id);
    if(!spec) return;
    this.startLevel({
      id: spec.id,
      name: spec.name,
      bpm: spec.bpm,
      lengthSec: spec.lengthSec,
      endX: spec.endX,
      endless: !!spec.endless,
      music: spec.music,
      build: spec.build,
      objects: spec.objects || [],
      practice
    });
  }
  startLevel(spec){
    Audio.ensure();
    Audio.resume();
    Audio.Music.stop();

    this.level = new Level(spec);
    this.practice = spec.practice === true;
    this.attempt++;
    this.coins = 0;
    this.coinsCollectedMask = 0;
    this.entities = [];
    this.particles = [];
    this.spawnIdx = 0;
    this.deadTimer = 0;
    this.wonTimer = 0;
    this.progress = 0;
    this.lastCPX = null;
    this.checkpoints = (spec.objects || []).filter(o => o.type === 'cp').map(o => ({ x: o.x, activated: false }));
    this.endlessTimer = 0;
    this.endlessDiff = 0;

    this.player.reset();
    this.player.x = 180;
    this.player.y = GROUND_Y - PS / 2;
    this.player.scale = 1;
    this.player.gdir = 1;
    this.cameraX = clamp(180 - 240, 0, this.level.endX !== Infinity ? this.level.endX - W : 0);

    this.updateHUD();
    Audio.SFX.click();
    if(this.level.music && !Audio.Music.muted) Audio.Music.start(this.level.bpm);

    this.setState('PLAYING');
    document.getElementById('btnTogglePractice').textContent = 'Practice: ' + (this.practice ? 'On' : 'Off');
  }

  /* ---- gameplay update ---- */
  updatePlaying(dt){
    const p = this.player;
    const level = this.level;

    if(p.dead){
      this.deadTimer += dt;
      if(this.deadTimer > 0.6){
        this.deadTimer = 0;
        this.showDeath();
      }
      return;
    }

    // camera follows player
    let target = p.x - 240;
    if(level.endX !== Infinity) target = clamp(target, 0, level.endX - W);
    this.cameraX = lerp(this.cameraX, target, 1 - Math.exp(-8 * dt));

    const finished = p.update(this.cameraX, level.endX);
    if(finished){ this.win(); return; }

    if(Input.pressed('Space') || Input.pressed('ArrowUp') || Input.pressed('KeyW') || Input.pressed('pointer')){
      p.jump();
    }

    // spawn entities ahead of camera
    while(this.spawnIdx < level.objects.length){
      const spec = level.objects[this.spawnIdx];
      if(spec.x < this.cameraX + W + SPAWN_BUFFER){
        this.addEntity(spec);
        this.spawnIdx++;
      } else {
        break;
      }
    }

    // update & collide entities
    for(let i = this.entities.length - 1; i >= 0; i--){
      const e = this.entities[i];
      if(e.update) e.update();
      if(e.remove){ this.entities.splice(i, 1); continue; }
      if(e.x < this.cameraX - SPAWN_BUFFER){ e.remove = true; continue; }
      if(this.collidePlayer(e)){
        if(e.deadly && p.invuln <= 0){ p.die(); }
        else { this.triggerEntity(e, p); }
      }
      if(e.type === 'portal' && !this.collidePlayer(e)) e.canTrigger = true;
    }

    if(level.endless) this.genEndless(dt);

    this.progress = level.endless ? null : clamp((p.x - 180) / (level.endX - 180), 0, 1);
    this.updateHUD();
  }

  genEndless(dt){
    this.endlessTimer += dt;
    const interval = clamp(1.5 - this.endlessDiff * 0.12, 0.45, 1.5);
    while(this.endlessTimer >= interval){
      this.endlessTimer -= interval;
      this.endlessDiff += 0.003;
      let ex = this.cameraX + W + 260;
      const side = Math.random() < 0.5 ? 'floor' : 'ceil';
      const n = Math.random() < 0.4 ? 1 : Math.random() < 0.75 ? 2 : 3;
      for(let i = 0; i < n; i++){
        const t = Math.random();
        const eType = t < 0.45 ? 'spike' : t < 0.70 ? 'block' : t < 0.83 ? 'saw' : 'orb';
        this.addEntity({ x: ex, type: eType, side, power: eType === 'orb' ? 1.4 : undefined });
        ex += 42;
      }
      if(Math.random() < 0.25){
        this.addEntity({ x: ex + 55, type: 'coin', y: side === 'floor' ? GROUND_Y - 150 : CEIL_Y + 150 });
      }
    }
  }

  addEntity(spec){ this.entities.push(makeEntity(spec)); }

  collidePlayer(e){
    const pr = this.player.rect();
    if(e.type === 'spike') return e.collide(pr);
    if(e.rect) return rectRect(pr, e.rect());
    return false;
  }

  triggerEntity(e, p){
    if(e.type === 'portal'){
      if(!e.canTrigger) return;
      if(e.kind === 'gravity'){
        p.gdir *= -1; p.vy = 0;
        p.y = p.gdir > 0 ? GROUND_Y - PS * p.scale / 2 : CEIL_Y + PS * p.scale / 2;
      } else if(e.kind === 'mini'){
        p.scale = 0.5;
        p.y = p.gdir > 0 ? GROUND_Y - PS * p.scale / 2 : CEIL_Y + PS * p.scale / 2;
      } else if(e.kind === 'big'){
        p.scale = 1.6;
        p.y = p.gdir > 0 ? GROUND_Y - PS * p.scale / 2 : CEIL_Y + PS * p.scale / 2;
      }
      e.canTrigger = false;
      Audio.SFX.portal();
      spawnParticles(p.x, p.y, '#22d3ee', 'dot', 14);
      p.invuln = 0.25;
    } else if(e.type === 'orb'){
      if(p.vy * p.gdir > 0){
        p.jump(e.power);
        e.remove = true;
        spawnParticles(e.x, e.y, e.color, 'dot', 10);
      }
    } else if(e.type === 'pad'){
      if(p.vy * p.gdir > 0){
        p.vy = -15 * p.gdir;
        Audio.SFX.pad();
        spawnParticles(e.x, e.y, '#f59e0b', 'dot', 10);
      }
    } else if(e.type === 'coin'){
      this.collectCoin(e);
      e.remove = true;
    } else if(e.type === 'cp'){
      this.activateCP(e);
    } else if(e.type === 'finish'){
      this.win();
    }
  }

  collectCoin(e){
    this.coins++;
    Audio.SFX.coin();
    spawnParticles(e.x, e.y, '#fbbf24', 'dot', 12);
    const bit = e.coinOrdinal != null ? e.coinOrdinal : 0;
    this.coinsCollectedMask |= (1 << bit);
    this.updateHUD();
  }

  activateCP(e){
    if(!this.practice || e.activated) return;
    e.activated = true;
    this.lastCPX = e.x;
    Audio.SFX.checkpoint();
    spawnParticles(e.x, e.y, '#22c55e', 'dot', 12);
  }

  /* ---- death / win flow ---- */
  showDeath(){
    document.getElementById('death-attempt').textContent = this.attempt;
    document.getElementById('btnTogglePractice').textContent = 'Practice: ' + (this.practice ? 'On' : 'Off');
    this.setState('DEAD');
    document.getElementById('panel-death').classList.remove('hidden');
  }
  win(){
    if(this.state !== 'PLAYING') return;
    Audio.Music.stop();
    Audio.SFX.finish();
    this.wonTimer = 0;
    this.state = 'WINNING';
    setTimeout(() => this.showComplete(), 450);
  }
  showComplete(){
    document.getElementById('complete-coins').textContent = this.coins;
    document.getElementById('complete-attempts').textContent = this.attempt;
    if(this.level.id !== 'endless'){
      let mask = parseInt(localStorage.getItem('gm_coins_' + this.level.id) || '0', 10);
      mask |= this.coinsCollectedMask;
      localStorage.setItem('gm_coins_' + this.level.id, mask);
    }
    this.setState('WIN');
    document.getElementById('panel-complete').classList.remove('hidden');
  }

  respawn(){
    const p = this.player;
    p.dead = false; p.deadTimer = 0; p.invuln = 0;
    p.scale = 1; p.gdir = 1;
    if(this.lastCPX !== null && this.practice){
      p.x = this.lastCPX;
    } else {
      p.x = 180;
    }
    p.y = GROUND_Y - PS / 2;
    p.vx = SPEED; p.vy = 0;
    this.cameraX = clamp(p.x - 240, 0, this.level.endX !== Infinity ? this.level.endX - W : 0);
    this.updateHUD();
  }

  /* ---- HUD ---- */
  updateHUD(){
    const pctEl = document.getElementById('pct');
    if(this.progress === null){
      pctEl.textContent = Math.max(0, ((this.player.x - 180) / 100) | 0) + 'm';
      document.getElementById('progress').style.width = '0%';
    } else {
      pctEl.textContent = (this.progress * 100 | 0) + '%';
      document.getElementById('progress').style.width = (this.progress * 100) + '%';
    }
    document.getElementById('attempts').textContent = 'Attempt: ' + this.attempt;
    document.getElementById('coins').textContent = 'Coins: ' + this.coins;
    document.getElementById('mode').textContent = this.practice ? 'PRACTICE' : (this.level.endless ? 'ENDLESS' : 'NORMAL');
  }

  /* ---- level select ---- */
  coinsFor(id){
    const mask = parseInt(localStorage.getItem('gm_coins_' + id) || '0', 10);
    return bitCount(mask & 0b111);
  }
  renderLevels(){
    const list = document.getElementById('levels-list');
    list.innerHTML = '';
    const rows = [
      { id: 'neon-overdrive', name: 'Neon Overdrive' },
      { id: 'endless', name: 'Endless Mode' }
    ];
    for(const key of Object.keys(localStorage)){
      if(key.startsWith('gm_custom_') && key !== 'gm_custom_editing'){
        rows.push({ id: key, name: key.slice(10) });
      }
    }
    rows.forEach(r => {
      const row = document.createElement('div');
      row.className = 'level-row';
      row.innerHTML =
        '<div class="info">' +
        '<div class="name">' + escapeHtml(r.name) + '</div>' +
        '<div class="coins">Coins: ' + this.coinsFor(r.id) + ' / 3</div>' +
        '</div>' +
        '<div>' +
        '<button class="btn" onclick="appStartLevel(\'' + r.id.replace(/'/g, "\\'") + '\', false)">Play</button>' +
        '<button class="btn" onclick="appStartLevel(\'' + r.id.replace(/'/g, "\\'") + '\', true)">Practice</button>' +
        '</div>';
      list.appendChild(row);
    });
  }

  /* ---- editor ---- */
  buildEditorToolbar(){
    const tb = document.getElementById('ed-toolbar');
    tb.innerHTML = '';
    const tools = [
      ['block', 'Block'], ['spike', 'Spike'], ['saw', 'Saw'],
      ['portal', 'Portal'], ['orb', 'Orb'], ['pad', 'Pad'],
      ['coin', 'Coin'], ['cp', 'Checkpoint'], ['finish', 'Finish'],
      ['select', 'Select'], ['delete', 'Delete']
    ];
    const add = (label, onClick, cls) => {
      const b = document.createElement('button');
      b.className = 'btn' + (cls ? ' ' + cls : '');
      b.textContent = label;
      b.onclick = onClick;
      tb.appendChild(b);
    };
    tools.forEach(([k, label]) => {
      add(label, () => this.setEditorTool(k), k === this.editor.tool ? 'active-tool' : '');
    });
    add('Save', () => this.saveEditor());
    add('Load', () => this.loadEditor());
    add('Test', () => this.testEditor());
  }
  setEditorTool(k){
    this.editor.tool = k;
    this.editor.selected = null;
    this.buildEditorToolbar();
  }
  autosave(){
    localStorage.setItem('gm_custom_editing', JSON.stringify({
      name: this.editor.name,
      objects: this.serializeEditor()
    }));
  }
  serializeEditor(){
    return this.editor.objects.map(e => {
      const o = { type: e.type, x: e.x };
      if(e.y !== undefined) o.y = e.y;
      if(e.side) o.side = e.side;
      if(e.power !== undefined) o.power = e.power;
      if(e.kind) o.kind = e.kind;
      return o;
    });
  }
  saveEditor(){
    const name = prompt('Level name', this.editor.name || 'Custom Level');
    if(!name) return;
    this.editor.name = name;
    localStorage.setItem('gm_custom_' + name, JSON.stringify({
      name,
      objects: this.serializeEditor()
    }));
    localStorage.setItem('gm_custom_editing', JSON.stringify({
      name,
      objects: this.serializeEditor()
    }));
    document.getElementById('ed-name').textContent = name;
    if(this.state === 'LEVELS') this.renderLevels();
  }
  loadEditor(){
    const name = prompt('Load level (blank = current editing)', '');
    const key = name ? 'gm_custom_' + name : 'gm_custom_editing';
    const raw = localStorage.getItem(key);
    if(!raw){ alert('No saved level found'); return; }
    const d = JSON.parse(raw);
    this.editor.name = d.name || 'Custom Level';
    this.editor.objects = (d.objects || []).map(spec => makeEntity(spec));
    this.editor.selected = null;
    document.getElementById('ed-name').textContent = this.editor.name;
    this.buildEditorToolbar();
  }
  testEditor(){
    const specs = this.serializeEditor();
    if(specs.length === 0){ alert('Place some objects first'); return; }
    const endX = Math.max(...specs.map(s => s.x)) + 600;
    this.startLevel({
      id: 'custom',
      name: this.editor.name || 'Custom Level',
      bpm: 145,
      lengthSec: 60,
      endX,
      endless: false,
      music: true,
      objects: specs,
      practice: false
    });
  }
  getMouse(e){
    const r = this.canvas.getBoundingClientRect();
    const sx = W / r.width, sy = H / r.height;
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
  }
  edPointerDown(e){
    const m = this.getMouse(e);
    const worldX = m.x + this.editor.cam;
    if(Input.isDown('Space') || e.button === 1){
      this.editor.panStart = { x: m.x, cam: this.editor.cam };
      return;
    }
    if(this.editor.tool === 'delete'){
      this.edRemoveNearest(worldX, m.y);
      return;
    }
    if(this.editor.tool === 'select'){
      this.editor.selected = this.edNearest(worldX, m.y, 60);
      this.editor.dragSel = this.editor.selected;
      return;
    }
    this.edPlace(worldX, m.y);
  }
  edPointerMove(e){
    const m = this.getMouse(e);
    this.editor.mouse = { x: m.x + this.editor.cam, y: m.y };
    if(this.editor.panStart){
      this.editor.cam = this.editor.panStart.cam + (m.x - this.editor.panStart.x);
      if(this.editor.cam < 0) this.editor.cam = 0;
      return;
    }
    if(this.editor.dragSel){
      const g = this.editor.grid;
      this.editor.dragSel.x = Math.round((m.x + this.editor.cam) / g) * g;
      const movable = ['block', 'spike', 'saw', 'portal'];
      if(movable.includes(this.editor.dragSel.type)){
        if(m.y < H / 2){ this.editor.dragSel.side = 'ceil'; this.editor.dragSel.y = CEIL_Y; }
        else { this.editor.dragSel.side = 'floor'; this.editor.dragSel.y = GROUND_Y; }
      }
      this.autosave();
    }
  }
  edPointerUp(){
    this.editor.panStart = null;
    this.editor.dragSel = null;
  }
  edPlace(worldX, my){
    const g = this.editor.grid;
    const x = Math.round(worldX / g) * g;
    const side = my < H / 2 ? 'ceil' : 'floor';
    let spec;
    switch(this.editor.tool){
      case 'block': spec = { type: 'block', x, side }; break;
      case 'spike': spec = { type: 'spike', x, side }; break;
      case 'saw': spec = { type: 'saw', x, side }; break;
      case 'portal': spec = { type: 'portal', x, side, kind: 'gravity' }; break;
      case 'orb': spec = { type: 'orb', x, y: GROUND_Y - 14, power: 1.4 }; break;
      case 'pad': spec = { type: 'pad', x, y: GROUND_Y - 6 }; break;
      case 'coin': spec = { type: 'coin', x, y: GROUND_Y - 150 }; break;
      case 'cp': spec = { type: 'cp', x, y: GROUND_Y }; break;
      case 'finish': spec = { type: 'finish', x, side: 'floor', y: GROUND_Y }; break;
      default: return;
    }
    this.editor.objects.push(makeEntity(spec));
    this.autosave();
  }
  edNearest(wx, wy, radius){
    let best = null, bestD = radius * radius;
    for(const e of this.editor.objects){
      const dx = e.x - wx, dy = e.y - wy;
      const d = dx * dx + dy * dy;
      if(d < bestD){ bestD = d; best = e; }
    }
    return best;
  }
  edRemoveNearest(wx, wy){
    const g = this.editor.grid;
    let best = null, bestD = 60 * 60, bestI = -1;
    for(let i = 0; i < this.editor.objects.length; i++){
      const e = this.editor.objects[i];
      const dx = e.x - wx, dy = e.y - wy;
      const d = dx * dx + dy * dy;
      if(d < bestD){ bestD = d; best = e; bestI = i; }
    }
    if(bestI >= 0){
      this.editor.objects.splice(bestI, 1);
      if(this.editor.selected === best) this.editor.selected = null;
      this.autosave();
    }
  }
  drawEditorCanvas(){
    const ctx = this.ctx;
    const cam = this.editor.cam;
    const g = this.editor.grid;
    ctx.save();
    ctx.translate(-cam, 0);
    ctx.strokeStyle = 'rgba(139, 92, 246, 0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const x0 = Math.floor(cam / g) * g;
    for(let x = x0; x <= W + cam; x += g){ ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y); ctx.lineTo(W, GROUND_Y);
    ctx.moveTo(0, CEIL_Y); ctx.lineTo(W, CEIL_Y);
    ctx.stroke();
    for(const e of this.editor.objects){
      e.draw(ctx, cam);
      if(e === this.editor.selected){
        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth = 2;
        const r = e.rect ? e.rect() : { x: e.x - 16, y: e.y - 16, w: 32, h: 32 };
        ctx.strokeRect(r.x, r.y, r.w, r.h);
      }
    }
    if(this.editor.mouse){
      const mx = this.editor.mouse.x - cam;
      const my = this.editor.mouse.y;
      ctx.strokeStyle = '#22d3ee';
      ctx.beginPath();
      ctx.moveTo(mx - 10, my); ctx.lineTo(mx + 10, my);
      ctx.moveTo(mx, my - 10); ctx.lineTo(mx, my + 10);
      ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = '#22d3ee';
    ctx.font = '14px system-ui';
    ctx.fillText('Tool: ' + this.editor.tool.toUpperCase() + '   |   Grid: ' + g + 'px   |   Cam: ' + Math.round(cam) + '   |   Objects: ' + this.editor.objects.length, 14, 26);
  }

  /* ---- main loop & draw ---- */
  loop(now){
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;
    Input.begin();
    if(this.state === 'PLAYING') this.updatePlaying(dt);
    else if(this.state === 'WINNING'){
      this.wonTimer += dt;
      if(this.wonTimer > 0.45) this.showComplete();
    }
    for(let i = this.particles.length - 1; i >= 0; i--){
      const p = this.particles[i];
      p.update();
      if(p.life <= 0) this.particles.splice(i, 1);
    }
    this.draw();
    requestAnimationFrame((t) => this.loop(t));
  }

  draw(){
    const ctx = this.ctx;
    ctx.fillStyle = '#050609';
    ctx.fillRect(0, 0, W, H);

    this.drawGrid();

    for(const e of this.entities) e.draw(ctx, this.cameraX);
    this.player.draw(ctx, this.cameraX);
    for(const pt of this.particles) pt.draw(ctx);

    this.drawSurfaces();

    if(this.state === 'EDITOR') this.drawEditorCanvas();
  }
  drawGrid(){
    const ctx = this.ctx;
    const cam = this.cameraX;
    ctx.strokeStyle = 'rgba(255,255,255,0.025)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const offset = (cam * 0.5) % 40;
    for(let x = -offset; x <= W; x += 40){ ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(139, 92, 246, 0.06)';
    ctx.beginPath();
    const offset2 = (cam * 0.5) % 200;
    for(let x = -offset2; x <= W; x += 200){ ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    ctx.stroke();
  }
  drawSurfaces(){
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y); ctx.lineTo(W, GROUND_Y);
    ctx.moveTo(0, CEIL_Y); ctx.lineTo(W, CEIL_Y);
    ctx.stroke();
  }
}

// Global helpers used from HTML onclick attributes
window.appStartLevel = (id, practice) => { window.game.startLevelById(id, practice); };
