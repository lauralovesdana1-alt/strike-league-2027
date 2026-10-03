// G-Football 2027 — team AI, keeper AI, difficulty brains
import * as THREE from 'three';
import { PITCH } from './config.js';

function dist2(ax, az, bx, bz) { const dx = ax-bx, dz = az-bz; return Math.sqrt(dx*dx+dz*dz); }
function rand(a, b) { return a + Math.random() * (b - a); }

// Pick best pass target for p among mates
export function choosePassTarget(p, mates, attackDir, passErr) {
  let best = null, bestScore = -1e9;
  for (const m of mates) {
    if (m === p || m.role === 'GK') continue;
    const fwd = (m.pos.x - p.pos.x) * attackDir;
    let open = 1e9;
    // openness computed by caller via opps; approximate with distance from p
    const score = fwd * 0.7 + open * 0 + rand(-4, 4);
    void open;
    if (fwd > -12 && score > bestScore) { bestScore = score; best = m; }
  }
  return best;
}
export function choosePassTargetSmart(p, mates, opps, attackDir, passErr) {
  let best = null, bestScore = -1e9;
  for (const m of mates) {
    if (m === p || m.role === 'GK') continue;
    const fwd = (m.pos.x - p.pos.x) * attackDir;
    let nearestOpp = 1e9;
    for (const o of opps) nearestOpp = Math.min(nearestOpp, dist2(m.pos.x, m.pos.z, o.pos.x, o.pos.z));
    const score = fwd * 0.8 + Math.min(nearestOpp, 14) * 1.2 + rand(-3, 3);
    if (fwd > -14 && score > bestScore) { bestScore = score; best = m; }
  }
  return best;
}

// High-level plan for one outfield AI player. Writes p.intent = {mx,mz,sprint,pass,shoot,shootPower,tackle}
export function planPlayer(p, mates, opps, ball, ctx) {
  const { diff, attackDir, oppGoalX, ownGoalX } = ctx;
  const T = { mx: p.pos.x, mz: p.pos.z, sprint: false, pass: false, shoot: 0, tackle: false };
  const owner = ball.owner;
  const myBall = owner && owner.team === p.team;
  const oppBall = owner && owner.team !== p.team;

  // shape anchor shifted toward ball
  const ax = p.home.x * 0.7 + ball.pos.x * 0.3;
  const az = p.home.z * 0.7 + ball.pos.z * 0.3;

  const nearestOppD = nearestDist(p, opps);

  if (owner === p) {
    // I have the ball
    const distGoal = Math.abs(oppGoalX - p.pos.x);
    const goalZok = Math.abs(p.pos.z) < 26;
    if (distGoal < diff.aiShootRange && goalZok && Math.abs(p.pos.z) < 24) {
      T.shoot = Math.min(1, 0.45 + distGoal / 34);
    } else if (nearestOppD < 3.4) {
      T.pass = true;
    } else {
      // dribble toward goal, veer from nearest opponent
      const no = nearestOpp(p, opps);
      let tx = p.pos.x + attackDir * 14, tz = p.pos.z;
      if (no && nearestOppD < 7) {
        tz += (p.pos.z >= no.pos.z ? 1 : -1) * 7;
        T.sprint = p.stamina > 0.25;
      }
      T.mx = tx; T.mz = THREE.MathUtils.clamp(tz, -26, 26);
      return T;
    }
    // slight forward drift while deciding
    T.mx = p.pos.x + attackDir * 4; T.mz = p.pos.z;
    return T;
  }

  if (myBall) {
    // support run: push up-field, find space
    let tx = ax + attackDir * 11;
    let tz = az;
    const no = nearestOpp(p, opps);
    if (no && nearestOppD < 6) tz += (p.pos.z >= no.pos.z ? 1 : -1) * 8;
    T.mx = THREE.MathUtils.clamp(tx, -46, 46);
    T.mz = THREE.MathUtils.clamp(tz, -27, 27);
    T.sprint = dist2(p.pos.x, p.pos.z, T.mx, T.mz) > 16 && p.stamina > 0.3;
    return T;
  }

  if (oppBall) {
    // pressing: am I one of the pressN closest?
    const rank = pressRank(p, mates, ball);
    if (rank < diff.pressN) {
      T.mx = owner.pos.x; T.mz = owner.pos.z;
      T.sprint = true;
      if (dist2(p.pos.x, p.pos.z, owner.pos.x, owner.pos.z) < 2.1 && p.tackleCd <= 0) T.tackle = true;
    } else {
      // mark nearest unmarked opponent, goal-side
      const mark = markTarget(p, mates, opps);
      if (mark) {
        T.mx = (mark.pos.x + ownGoalXAt(p, ctx)) / 2 + attackDir * -1 * 1.5;
        T.mz = (mark.pos.z) * 0.85;
      } else { T.mx = ax; T.mz = az; }
    }
    return T;
  }

  // loose ball: closest two chase
  const rank = pressRank(p, mates, ball);
  if (rank < 2) {
    // intercept point: lead the ball slightly
    T.mx = ball.pos.x + ball.vel.x * 0.25;
    T.mz = ball.pos.z + ball.vel.z * 0.25;
    T.sprint = true;
  } else {
    T.mx = ax; T.mz = az;
  }
  return T;
}

function ownGoalXAt(p, ctx) { return -ctx.attackDir * (PITCH.L / 2); }
function nearestDist(p, opps) {
  let d = 1e9;
  for (const o of opps) d = Math.min(d, dist2(p.pos.x, p.pos.z, o.pos.x, o.pos.z));
  return d;
}
function nearestOpp(p, opps) {
  let b = null, d = 1e9;
  for (const o of opps) { const dd = dist2(p.pos.x, p.pos.z, o.pos.x, o.pos.z); if (dd < d) { d = dd; b = o; } }
  return b;
}
// rank of p among mates by distance to ball (0 = closest)
function pressRank(p, mates, ball) {
  const d = dist2(p.pos.x, p.pos.z, ball.pos.x, ball.pos.z);
  let r = 0;
  for (const m of mates) {
    if (m === p || m.role === 'GK') continue;
    if (dist2(m.pos.x, m.pos.z, ball.pos.x, ball.pos.z) < d) r++;
  }
  return r;
}
// pick an opponent to mark (nearest unmarked by a teammate already marking)
function markTarget(p, mates, opps) {
  let best = null, bd = 1e9;
  for (const o of opps) {
    if (o.role === 'GK') continue;
    let marked = false;
    for (const m of mates) {
      if (m === p || !m.marking) continue;
      if (m.marking === o) { marked = true; break; }
    }
    if (marked) continue;
    const d = dist2(p.pos.x, p.pos.z, o.pos.x, o.pos.z);
    if (d < bd) { bd = d; best = o; }
  }
  p.marking = best;
  return best;
}

// Keeper brain — runs every tick (needs to be responsive)
export function keeperIntent(k, ball, ctx) {
  const { diff, attackDir } = ctx;
  const ownGoalX = -attackDir * (PITCH.L / 2);
  const T = { mx: ownGoalX + attackDir * 2.2, mz: THREE.MathUtils.clamp(ball.pos.z * 0.42, -3.6, 3.6), sprint: false, pass: false, shoot: 0, tackle: false };

  if (ball.owner === k) {
    // distribution: hold briefly then pass out
    k.holdT = (k.holdT || 0) + ctx.dt;
    T.mx = k.pos.x; T.mz = k.pos.z;
    if (k.holdT > 1.1) { T.pass = true; k.holdT = 0; }
    return T;
  }
  k.holdT = 0;

  if (k.diveT > 0) { T.mx = k.pos.x; T.mz = k.pos.z; return T; } // mid-dive

  // shot incoming? ball free, moving toward my goal, close-ish
  const toward = -attackDir; // direction toward own goal
  const vxToward = ball.vel.x * toward;
  const distGoal = Math.abs(ball.pos.x - ownGoalX);
  if (!ball.owner && vxToward > 7 && distGoal < 20) {
    const lateral = ball.pos.z - k.pos.z;
    const react = Math.random() < diff.keeper; // reads it or not
    if (Math.abs(lateral) < 5 && react) {
      k.diveT = 0.55;
      k.diveDir = lateral === 0 ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(lateral);
      k.vel.z = k.diveDir * 13;
      k.vel.x = toward * 2;
      return { mx: k.pos.x, mz: k.pos.z, sprint: false, pass: false, shoot: 0, tackle: false };
    }
  }
  // rush out at slow rollers nearby
  if (!ball.owner && distGoal < 12 && Math.hypot(ball.vel.x, ball.vel.z) < 9) {
    const rank = pressRank(k, [k], ball);
    if (rank === 0) { T.mx = ball.pos.x; T.mz = ball.pos.z; }
  }
  return T;
}
