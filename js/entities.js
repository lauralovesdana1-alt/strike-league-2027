// G-Football 2027 — player & ball entities
import * as THREE from 'three';
import { PITCH } from './config.js';

export function makePlayerMesh(primary, secondary, isGK) {
  const g = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: 0x8a5a3b });
  const shirt = new THREE.MeshLambertMaterial({ color: isGK ? 0xffd24a : primary });
  const shorts = new THREE.MeshLambertMaterial({ color: isGK ? 0x222222 : secondary });
  // legs
  const legGeo = new THREE.CylinderGeometry(0.11, 0.13, 0.75, 6);
  const legL = new THREE.Mesh(legGeo, shorts); legL.position.set(-0.16, 0.38, 0);
  const legR = new THREE.Mesh(legGeo, shorts); legR.position.set(0.16, 0.38, 0);
  // torso
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.32, 0.75, 8), shirt);
  torso.position.y = 1.1;
  // arms
  const armGeo = new THREE.CylinderGeometry(0.08, 0.09, 0.6, 6);
  const armL = new THREE.Mesh(armGeo, shirt); armL.position.set(-0.36, 1.12, 0); armL.rotation.z = 0.25;
  const armR = new THREE.Mesh(armGeo, shirt); armR.position.set(0.36, 1.12, 0); armR.rotation.z = -0.25;
  // head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 10, 8), skin);
  head.position.y = 1.72;
  g.add(legL, legR, torso, armL, armR, head);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return { group: g, legL, legR, armL, armR, torso, head };
}

let PID = 0;
export class Player {
  constructor(teamIdx, role, kit, side) {
    this.id = PID++;
    this.team = teamIdx;      // 0 = user/first, 1 = opponent
    this.role = role;         // GK, DF, MF, FW
    this.side = side;         // +1 attacks +x, -1 attacks -x
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.facing = new THREE.Vector3(side, 0, 0);
    this.home = new THREE.Vector3();
    this.stamina = 1;
    this.controlled = false;  // user-controlled
    this.kickCd = 0;
    this.slideT = 0;          // slide tackle timer
    this.diveT = 0;           // keeper dive timer
    this.diveDir = 0;
    this.anim = Math.random() * 10;
    this.target = new THREE.Vector3(); // AI steering target
    const m = makePlayerMesh(kit.primary, kit.secondary, role === 'GK');
    this.mesh = m.group;
    this.parts = m;
    this.maxSpeed = role === 'GK' ? 7.5 : role === 'DF' ? 8.6 : role === 'MF' ? 9.2 : 9.8;
  }
  reset(x, z) {
    this.pos.set(x, 0, z); this.vel.set(0, 0, 0);
    this.home.set(x, 0, z);
    this.facing.set(this.side, 0, 0);
    this.stamina = 1; this.kickCd = 0; this.slideT = 0; this.diveT = 0;
    this.syncMesh(0);
  }
  moveToward(tx, tz, sprint, dt, speedMul = 1) {
    const dx = tx - this.pos.x, dz = tz - this.pos.z;
    const d = Math.hypot(dx, dz);
    let sp = this.maxSpeed * speedMul;
    if (sprint && this.stamina > 0.05 && d > 0.5) {
      sp *= 1.38;
      this.stamina = Math.max(0, this.stamina - 0.22 * dt);
    } else {
      this.stamina = Math.min(1, this.stamina + 0.1 * dt);
    }
    if (this.slideT > 0) { this.slideT -= dt; sp *= 1.9; } // slide momentum
    if (d > 0.05) {
      const want = new THREE.Vector3(dx / d * Math.min(sp, d * 6), 0, dz / d * Math.min(sp, d * 6));
      const k = 1 - Math.exp(-8 * dt);
      this.vel.lerp(want, k);
      if (this.vel.lengthSq() > 0.5) {
        const f = new THREE.Vector3(this.vel.x, 0, this.vel.z).normalize();
        this.facing.lerp(f, 1 - Math.exp(-10 * dt)).normalize();
      }
    } else {
      this.vel.multiplyScalar(Math.exp(-8 * dt));
    }
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    // clamp to pitch (+margin behind goals)
    const { L, W } = PITCH;
    this.pos.x = Math.max(-L/2 - 4, Math.min(L/2 + 4, this.pos.x));
    this.pos.z = Math.max(-W/2 - 3, Math.min(W/2 + 3, this.pos.z));
    if (this.kickCd > 0) this.kickCd -= dt;
    this.syncMesh(dt);
  }
  syncMesh(dt) {
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = Math.atan2(this.facing.x, this.facing.z);
    this.anim += dt * (2 + this.vel.length() * 1.6);
    const sw = Math.sin(this.anim) * Math.min(0.7, this.vel.length() * 0.09);
    this.parts.legL.rotation.x = sw;
    this.parts.legR.rotation.x = -sw;
    this.parts.armL.rotation.x = -sw * 0.8;
    this.parts.armR.rotation.x = sw * 0.8;
    // slide pose
    if (this.slideT > 0) {
      this.mesh.rotation.x = -0.9;
      this.mesh.position.y = -0.25;
    } else {
      this.mesh.rotation.x = 0;
      this.mesh.position.y = Math.abs(Math.sin(this.anim)) * 0.05 * Math.min(1, this.vel.length() / 6);
    }
    // dive pose (keeper)
    if (this.diveT > 0) {
      this.diveT -= dt;
      this.mesh.rotation.z = -this.diveDir * 1.2;
      this.mesh.position.y = 0.4;
    } else {
      this.mesh.rotation.z *= 0.8;
    }
  }
}

export class Ball {
  constructor(scene) {
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.spin = 0;          // lateral curve
    this.owner = null;
    this.lastTouch = null;
    const g = new THREE.Group();
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(PITCH.BALL_R, 14, 10),
      new THREE.MeshLambertMaterial({ color: 0xffffff })
    );
    // simple pentagon patches via small dark circles
    const patchMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
    for (let i = 0; i < 6; i++) {
      const p = new THREE.Mesh(new THREE.CircleGeometry(0.11, 6), patchMat);
      const th = (i / 6) * Math.PI * 2;
      p.position.set(Math.cos(th) * 0.34, Math.sin(th * 2) * 0.12, Math.sin(th) * 0.34);
      p.lookAt(p.position.clone().multiplyScalar(2));
      ball.add(p);
    }
    ball.castShadow = true;
    g.add(ball);
    // shadow blob (cheap grounding cue on mobile)
    const blob = new THREE.Mesh(
      new THREE.CircleGeometry(0.4, 12),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28 })
    );
    blob.rotation.x = -Math.PI / 2; blob.position.y = 0.02;
    g.add(blob);
    this.blob = blob;
    this.mesh = g;
    this.ballMesh = ball;
    scene.add(g);
  }
  reset(x, z) {
    this.pos.set(x, PITCH.BALL_R, z);
    this.vel.set(0, 0, 0);
    this.spin = 0; this.owner = null; this.lastTouch = null;
    this.sync();
  }
  kick(dir, power, up = 0.25, curve = 0) {
    // dir: normalized Vector3 (xz), power 0..1
    const speed = 14 + power * 22;
    this.vel.set(dir.x * speed, up * (8 + power * 10), dir.z * speed);
    this.spin = curve;
    this.owner = null;
    this.sync();
  }
  update(dt, posts) {
    if (this.owner) {
      const o = this.owner;
      this.pos.set(
        o.pos.x + o.facing.x * 0.95,
        PITCH.BALL_R,
        o.pos.z + o.facing.z * 0.95
      );
      this.vel.set(o.vel.x, 0, o.vel.z);
      this.spin *= 0.9;
      this.sync();
      return;
    }
    const r = PITCH.BALL_R;
    // gravity
    this.vel.y -= 24 * dt;
    // magnus-ish curve
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (this.pos.y > r + 0.05 && Math.abs(this.spin) > 0.01) {
      this.vel.z += this.spin * 9 * dt * Math.sign(this.vel.x || 1);
      this.spin *= Math.exp(-1.2 * dt);
    }
    // drag
    const drag = this.pos.y > r + 0.05 ? 0.12 : 1.4;
    const dk = Math.exp(-drag * dt);
    this.vel.x *= dk; this.vel.z *= dk;
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;
    // ground bounce
    if (this.pos.y < r) {
      this.pos.y = r;
      if (this.vel.y < -1.5) { this.vel.y *= -0.55; }
      else this.vel.y = 0;
      // rolling friction
      const f = Math.exp(-2.2 * dt);
      this.vel.x *= f; this.vel.z *= f;
      if (Math.hypot(this.vel.x, this.vel.z) < 0.25) { this.vel.x = 0; this.vel.z = 0; }
    }
    const { L, W, GOAL_W, GOAL_H } = PITCH;
    // side walls (arcade)
    if (Math.abs(this.pos.z) > W/2 - r) {
      this.pos.z = Math.sign(this.pos.z) * (W/2 - r);
      this.vel.z *= -0.55;
      this.spin *= 0.5;
    }
    // posts / crossbar collision
    for (const p of posts) {
      const dx = this.pos.x - p.x, dy = this.pos.y - p.y, dz = this.pos.z - p.z;
      const d = Math.sqrt(dx*dx + dy*dy + dz*dz);
      if (d < r + 0.28 && d > 0.001) {
        const nx = dx/d, ny = dy/d, nz = dz/d;
        const dot = this.vel.x*nx + this.vel.y*ny + this.vel.z*nz;
        if (dot < 0) {
          this.vel.x -= 2*dot*nx; this.vel.y -= 2*dot*ny; this.vel.z -= 2*dot*nz;
          this.vel.multiplyScalar(0.75);
          this.pos.x = p.x + nx*(r+0.3); this.pos.y = p.y + ny*(r+0.3); this.pos.z = p.z + nz*(r+0.3);
          this.postHit = true;
        }
      }
    }
    this.sync();
  }
  sync() {
    this.mesh.position.copy(this.pos);
    this.ballMesh.rotation.x += this.vel.z * 0.06;
    this.ballMesh.rotation.z -= this.vel.x * 0.06;
    // blob follows ground projection
    this.blob.position.set(0, 0.02 - this.pos.y + PITCH.BALL_R, 0);
    const h = Math.min(1, this.pos.y / 6);
    this.blob.material.opacity = 0.28 * (1 - h * 0.7);
    const s = 1 + h * 0.8;
    this.blob.scale.set(s, s, 1);
  }
}
