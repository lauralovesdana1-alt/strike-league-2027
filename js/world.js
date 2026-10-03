// G-Football 2027 — stadium, pitch, crowd, ad boards, nets, confetti
import * as THREE from 'three';
import { PITCH, SPONSORS, TITLE } from './config.js';

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function drawPitch(ctx, w, h) {
  // grass stripes
  const stripes = 12;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 ? '#2f9e44' : '#2b9340';
    ctx.fillRect((w / stripes) * i, 0, w / stripes + 1, h);
  }
  const sx = w / PITCH.L, sz = h / PITCH.W; // world->px
  const X = x => (x + PITCH.L / 2) * sx;
  const Z = z => (z + PITCH.W / 2) * sz;
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.lineWidth = 3;
  // boundary
  ctx.strokeRect(X(-PITCH.L/2), Z(-PITCH.W/2), PITCH.L*sx, PITCH.W*sz);
  // halfway line
  ctx.beginPath(); ctx.moveTo(X(0), Z(-PITCH.W/2)); ctx.lineTo(X(0), Z(PITCH.W/2)); ctx.stroke();
  // center circle
  ctx.beginPath(); ctx.arc(X(0), Z(0), 9.15*sx, 0, Math.PI*2); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.beginPath(); ctx.arc(X(0), Z(0), 4, 0, Math.PI*2); ctx.fill();
  // boxes both ends
  for (const s of [1, -1]) {
    const gx = s * PITCH.L / 2;
    // penalty box 16.5 deep, 40.32 wide
    ctx.strokeRect(Math.min(X(gx), X(gx - s*16.5)), Z(-20.16), 16.5*sx, 40.32*sz);
    // 6-yard box 5.5 deep, 18.32 wide
    ctx.strokeRect(Math.min(X(gx), X(gx - s*5.5)), Z(-9.16), 5.5*sx, 18.32*sz);
    // penalty spot
    ctx.beginPath(); ctx.arc(X(gx - s*11), Z(0), 4, 0, Math.PI*2); ctx.fill();
  }
}

export class World {
  constructor(scene, isMobile) {
    this.scene = scene;
    this.isMobile = isMobile;
    this.confetti = [];
    this.netPulse = { t: 0, side: 0 };
    this.build();
  }
  build() {
    const { L, W } = PITCH;
    // pitch
    const pitchTex = canvasTex(1024, 620, drawPitch);
    const pitch = new THREE.Mesh(
      new THREE.PlaneGeometry(L + 8, W + 8),
      new THREE.MeshLambertMaterial({ map: pitchTex })
    );
    pitch.rotation.x = -Math.PI / 2;
    pitch.receiveShadow = !this.isMobile;
    this.scene.add(pitch);

    // surrounding ground
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.MeshLambertMaterial({ color: 0x1d2b1f })
    );
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05;
    this.scene.add(ground);

    this.buildGoals();
    this.buildAdBoards();
    this.buildStands();
    this.buildFloodlights();
    this.buildConfettiSystem();

    // sky
    this.scene.background = new THREE.Color(0x0b1026);
    this.scene.fog = new THREE.Fog(0x0b1026, 140, 320);
  }
  buildGoals() {
    this.nets = {};
    const { L, GOAL_W, GOAL_H } = PITCH;
    const postMat = new THREE.MeshLambertMaterial({ color: 0xf5f5f5 });
    for (const s of [1, -1]) {
      const gx = s * L / 2;
      const g = new THREE.Group();
      const postGeo = new THREE.CylinderGeometry(0.09, 0.09, GOAL_H, 8);
      for (const zs of [-GOAL_W/2, GOAL_W/2]) {
        const p = new THREE.Mesh(postGeo, postMat);
        p.position.set(gx, GOAL_H/2, zs); g.add(p);
      }
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, GOAL_W + 0.18, 8), postMat);
      bar.rotation.x = Math.PI/2; bar.position.set(gx, GOAL_H, 0); g.add(bar);
      // net: back + sides + top, semi-transparent
      const netMat = new THREE.MeshBasicMaterial({ color: 0xdddddd, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
      const depth = 2.2;
      const back = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_W, GOAL_H), netMat);
      back.position.set(gx + s*depth, GOAL_H/2, 0); back.rotation.y = Math.PI/2; g.add(back);
      const top = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_W, depth), netMat);
      top.rotation.x = -Math.PI/2; top.rotation.z = Math.PI/2;
      top.position.set(gx + s*depth/2, GOAL_H, 0); g.add(top);
      for (const zs of [-GOAL_W/2, GOAL_W/2]) {
        const side = new THREE.Mesh(new THREE.PlaneGeometry(depth, GOAL_H), netMat);
        side.position.set(gx + s*depth/2, GOAL_H/2, zs); side.rotation.y = Math.PI/2; g.add(side);
      }
      this.scene.add(g);
      this.nets[s] = g;
      // post positions for collision (world coords)
      this['posts' + s] = [
        { x: gx, y: GOAL_H/2, z: -GOAL_W/2 }, { x: gx, y: GOAL_H/2, z: GOAL_W/2 },
        { x: gx, y: GOAL_H, z: 0, bar: true },
      ];
    }
  }
  buildAdBoards() {
    const { L, W } = PITCH;
    const mk = (text, bg, fg) => canvasTex(512, 64, (ctx, w, h) => {
      ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = fg; ctx.font = 'bold 40px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, w/2, h/2 + 2);
    });
    const bgs = ['#0d1b6e', '#b3122e', '#0a6e3c', '#111111', '#5b2a86', '#0d5b6e'];
    let i = 0;
    const addRun = (len, x, z, rotY) => {
      const n = Math.max(2, Math.round(len / 14));
      for (let k = 0; k < n; k++) {
        const text = SPONSORS[i++ % SPONSORS.length];
        const tex = mk(text, bgs[(i) % bgs.length], '#ffffff');
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(len / n - 0.4, 1.1, 0.3),
          new THREE.MeshLambertMaterial({ map: tex })
        );
        const off = -len/2 + (k + 0.5) * (len / n);
        if (rotY === 0) m.position.set(x + off, 0.55, z);
        else m.position.set(x, 0.55, z + off);
        m.rotation.y = rotY;
        this.scene.add(m);
      }
    };
    addRun(L + 10, 0, -W/2 - 4.5, 0);
    addRun(L + 10, 0,  W/2 + 4.5, 0);
    addRun(W + 10, -L/2 - 4.5, 0, Math.PI/2);
    addRun(W + 10,  L/2 + 4.5, 0, Math.PI/2);
  }
  buildStands() {
    const { L, W } = PITCH;
    const standMat = new THREE.MeshLambertMaterial({ color: 0x232a3d });
    const mkStand = (w, d, x, z, rotY) => {
      const s = new THREE.Mesh(new THREE.BoxGeometry(w, 14, d), standMat);
      s.position.set(x, 5.5, z); s.rotation.y = rotY;
      this.scene.add(s);
      return s;
    };
    mkStand(L + 44, 22, 0, -W/2 - 17, 0);
    mkStand(L + 44, 22, 0,  W/2 + 17, 0);
    mkStand(22, W + 44, -L/2 - 17, 0, 0);
    mkStand(22, W + 44,  L/2 + 17, 0, 0);
    // crowd: instanced dots on the stands
    const count = this.isMobile ? 900 : 2200;
    const geo = new THREE.BoxGeometry(0.55, 0.8, 0.4);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const inst = new THREE.InstancedMesh(geo, mat, count);
    const dummy = new THREE.Object3D();
    const palette = [0xd21f2b, 0xffffff, 0x1e5aff, 0xffd24a, 0x0a7d3c, 0xff8c00, 0x00e5ff, 0x7b2ff7];
    let n = 0;
    const rows = 6;
    const place = (x0, z0, dx, dz) => {
      for (let r = 0; r < rows && n < count; r++) {
        const steps = Math.floor(count / (rows * 4));
        for (let k = 0; k < steps && n < count; k++) {
          const t = k / steps;
          dummy.position.set(x0 + dx * t, 9.5 + r * 1.15, z0 + dz * t);
          dummy.rotation.y = Math.atan2(-dummy.position.x, -dummy.position.z);
          dummy.updateMatrix();
          inst.setMatrixAt(n, dummy.matrix);
          inst.setColorAt(n, new THREE.Color(palette[(n * 7 + r * 3) % palette.length]));
          n++;
        }
      }
    };
    place(-L/2 - 20, -W/2 - 8, L + 40, 0);
    place(-L/2 - 20,  W/2 + 8, L + 40, 0);
    place(-L/2 - 8, -W/2 - 20, 0, W + 40);
    place( L/2 + 8, -W/2 - 20, 0, W + 40);
    inst.count = n;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    this.scene.add(inst);
  }
  buildFloodlights() {
    const { L, W } = PITCH;
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x555f70 });
    const headMat = new THREE.MeshBasicMaterial({ color: 0xfffbe8 });
    for (const [x, z] of [[-L/2-26, -W/2-26], [L/2+26, -W/2-26], [-L/2-26, W/2+26], [L/2+26, W/2+26]]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 34, 8), poleMat);
      pole.position.set(x, 17, z); this.scene.add(pole);
      const head = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 1), headMat);
      head.position.set(x, 34.5, z); head.lookAt(0, 0, 0); this.scene.add(head);
    }
  }
  buildConfettiSystem() {
    const N = 600;
    const geo = new THREE.BufferGeometry();
    this.confPos = new Float32Array(N * 3);
    this.confVel = new Float32Array(N * 3);
    this.confCol = new Float32Array(N * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.confPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.confCol, 3));
    this.confettiPts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.5, vertexColors: true }));
    this.confettiPts.visible = false;
    this.confettiN = N;
    this.scene.add(this.confettiPts);
  }
  confettiBurst() {
    const palette = [[1,0.2,0.2],[1,1,1],[0.2,0.5,1],[1,0.85,0.2],[0.2,1,0.5]];
    for (let i = 0; i < this.confettiN; i++) {
      this.confPos[i*3] = (Math.random()-0.5) * 40;
      this.confPos[i*3+1] = 18 + Math.random() * 10;
      this.confPos[i*3+2] = (Math.random()-0.5) * 30;
      this.confVel[i*3] = (Math.random()-0.5) * 6;
      this.confVel[i*3+1] = -2 - Math.random() * 3;
      this.confVel[i*3+2] = (Math.random()-0.5) * 6;
      const c = palette[i % palette.length];
      this.confCol[i*3] = c[0]; this.confCol[i*3+1] = c[1]; this.confCol[i*3+2] = c[2];
    }
    this.confettiPts.geometry.attributes.position.needsUpdate = true;
    this.confettiPts.geometry.attributes.color.needsUpdate = true;
    this.confettiPts.visible = true;
    this.confettiT = 0;
  }
  goalNetRipple(side) { this.netPulse = { t: 0.6, side }; }
  update(dt) {
    // net ripple
    if (this.netPulse.t > 0) {
      this.netPulse.t -= dt;
      const g = this.nets[this.netPulse.side];
      if (g) {
        const s = 1 + Math.sin(this.netPulse.t * 30) * 0.03 * this.netPulse.t;
        g.scale.set(s, s, s);
        if (this.netPulse.t <= 0) g.scale.set(1, 1, 1);
      }
    }
    // confetti fall
    if (this.confettiPts.visible) {
      this.confettiT += dt;
      const p = this.confPos, v = this.confVel;
      for (let i = 0; i < this.confettiN; i++) {
        p[i*3] += v[i*3] * dt; p[i*3+1] += v[i*3+1] * dt; p[i*3+2] += v[i*3+2] * dt;
        if (p[i*3+1] < 0) p[i*3+1] = 20 + Math.random() * 8;
      }
      this.confettiPts.geometry.attributes.position.needsUpdate = true;
      if (this.confettiT > 9) this.confettiPts.visible = false;
    }
  }
  postPositions() {
    return [...this['posts1'], ...this['posts-1']];
  }
}
