// G-Football 2027 — match engine: states, clock, goals, penalties, tournament
import * as THREE from 'three';
import { PITCH, SIM_DT, FORMATION, DIFFS, TEAMS, TITLE } from './config.js';
import { Player, Ball } from './entities.js';
import { planPlayer, keeperIntent, choosePassTargetSmart } from './ai.js';
import { audio } from './audio.js';

const clamp = THREE.MathUtils.clamp;
function rand(a, b) { return a + Math.random() * (b - a); }
function dist2(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }

// ---------------------------------------------------------------- Match
export class Match {
  constructor(opts) {
    this.scene = opts.scene; this.world = opts.world; this.ui = opts.ui;
    this.input = opts.input;
    this.diff = DIFFS[opts.diffKey] || DIFFS.pro;
    this.diffKey = opts.diffKey || 'pro';
    this.halfLen = opts.halfLenMin || 4;
    this.knockout = !!opts.knockout;
    this.onDone = opts.onDone || (() => {});
    this.userIdx = 0;

    const mkTeam = (teamId, attackDir, idx) => {
      const info = TEAMS.find(t => t.id === teamId) || TEAMS[0];
      const players = FORMATION.map(f => {
        const p = new Player(idx, f.role, info, attackDir);
        p.decideT = Math.random() * 0.3;
        p.tackleCd = 0;
        this.scene.add(p.mesh);
        return p;
      });
      return { id: teamId, info, attackDir, players, idx };
    };
    this.teams = [mkTeam(opts.userTeamId, 1, 0), mkTeam(opts.aiTeamId, -1, 1)];

    this.ball = new Ball(this.scene);
    this.posts = this.world.postPositions();
    this.score = [0, 0];
    this.half = 1; this.clock = 0;
    this.state = 'kickoff'; this.stateT = 1.4;
    this.et = false; this.etClock = 0;
    this.active = null;
    this.switchT = 0;
    this.chargeT = 0; this.charging = false;
    this.acc = 0; this.slowmo = 0; this.shakeT = 0;
    this.stuckT = 0;
    this._prevX = 0;
    this._edges = null;
    this.finished = false;
    this.placeKickoff(0);
    this.ui.setScore(0, 0, this.teams[0].info.short, this.teams[1].info.short);
    this.ui.commentary('KICK OFF!', 1600);
    audio.unlock();
    audio.whistle(1);
  }
  dispose() {
    for (const t of this.teams) for (const p of t.players) { this.scene.remove(p.mesh); }
    this.scene.remove(this.ball.mesh);
  }
  ownGoalX(team) { return -team.attackDir * (PITCH.L / 2); }
  oppGoalX(team) { return team.attackDir * (PITCH.L / 2); }

  placeKickoff(possIdx) {
    const { L } = PITCH;
    for (const t of this.teams) {
      for (let i = 0; i < t.players.length; i++) {
        const p = t.players[i], f = FORMATION[i];
        let x = f.x * t.attackDir, z = f.z;
        if (t.idx === possIdx && f.role === 'FW') { x = -t.attackDir * 1.8; z = 0.9; }
        if (t.idx !== possIdx && f.role === 'FW') { x = -t.attackDir * 6; z = -4; }
        p.reset(x, z);
      }
    }
    this.ball.reset(0, 0);
    const fw = this.teams[possIdx].players.find(p => p.role === 'FW');
    this.ball.owner = fw;
    fw.kickCd = 0.5;
    this.active = possIdx === 0 ? fw : this.nearestToBall(0);
    this.chargeT = 0; this.charging = false;
  }
  nearestToBall(teamIdx, excludeGK = true) {
    let best = null, bd = 1e9;
    for (const p of this.teams[teamIdx].players) {
      if (excludeGK && p.role === 'GK') continue;
      const d = dist2(p.pos.x, p.pos.z, this.ball.pos.x, this.ball.pos.z);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  update(rdt) {
    if (this.finished) return;
    // state timers
    if (this.state === 'kickoff' || this.state === 'goal' || this.state === 'halftime') {
      this.stateT -= rdt;
      this.world.update(rdt);
      if (this.stateT <= 0) {
        if (this.state === 'kickoff') this.state = 'play';
        else if (this.state === 'goal') { this.placeKickoff(this._conceded); this.state = 'kickoff'; this.stateT = 1.0; this.ui.commentary('KICK OFF', 1200); }
        else if (this.state === 'halftime') {
          for (const t of this.teams) t.attackDir *= -1;
          this.half = 2; this.clock = 0;
          this.placeKickoff(1); this.state = 'kickoff'; this.stateT = 1.0;
          this.ui.commentary('SECOND HALF', 1600); audio.whistle(1);
        }
      }
      return;
    }
    if (this.state !== 'play') return;

    // snapshot + clear input edges for this frame
    const inp = this.input;
    this._edges = { pass: inp.wantPass, tackle: inp.wantTackle, switch: inp.wantSwitch, shootRel: inp.shootReleased };
    inp.wantPass = inp.wantTackle = inp.wantSwitch = inp.shootReleased = false;

    let sdt = rdt * (this.slowmo > 0 ? 0.3 : 1);
    if (this.slowmo > 0) this.slowmo -= rdt;
    if (this.shakeT > 0) this.shakeT -= rdt;
    this.acc = Math.min(this.acc + sdt, SIM_DT * 4);
    let n = 0;
    while (this.acc >= SIM_DT && n < 4) { this.step(SIM_DT); this.acc -= SIM_DT; n++; }
    this.world.update(rdt);
  }

  step(dt) {
    const inp = this.input, ball = this.ball, E = this._edges;
    this.clock += dt;
    if (this.et) this.etClock += dt;
    const halfSecs = (this.et ? 1 : this.halfLen) * 60;
    if (this.clock >= halfSecs) { this.endHalf(); return; }

    // active player tracking
    this.switchT -= dt;
    const owner = ball.owner;
    if (owner && owner.team === 0) { if (this.active !== owner) this.active = owner; }
    else if (this.switchT <= 0 || (this.active && this.active.role === 'GK')) {
      const nb = this.nearestToBall(0);
      if (nb && nb !== this.active) { this.active = nb; }
      this.switchT = 0.5;
    }
    if (E.switch) {
      // cycle to next-nearest
      const mates = this.teams[0].players.filter(p => p.role !== 'GK' && p !== this.active)
        .sort((a, b) => dist2(a.pos.x, a.pos.z, ball.pos.x, ball.pos.z) - dist2(b.pos.x, b.pos.z, ball.pos.x, ball.pos.z));
      if (mates[0]) this.active = mates[0];
      audio.click();
    }
    for (const t of this.teams) for (const p of t.players) p.controlled = (p === this.active);

    // intents
    for (const t of this.teams) {
      const opps = this.teams[1 - t.idx].players;
      for (const p of t.players) {
        if (p.controlled && t.idx === 0) continue; // user player handled below
        p.decideT -= dt;
        if (p.decideT <= 0) {
          const ctx = {
            diff: this.diff, attackDir: t.attackDir, dt, time: this.clock,
            oppGoalX: t.attackDir * (PITCH.L / 2), ownGoalX: -t.attackDir * (PITCH.L / 2),
          };
          p.intent = p.role === 'GK' ? keeperIntent(p, ball, ctx) : planPlayer(p, t.players, opps, ball, ctx);
          p.decideT = this.diff.react * (p.role === 'GK' ? 0.5 : 1) + Math.random() * 0.07;
        }
      }
    }

    // user intent
    const me = this.active;
    if (me) {
      const hasBall = ball.owner === me;
      const uIntent = {
        mx: me.pos.x + inp.moveX * 12, mz: me.pos.z + inp.moveZ * 12,
        sprint: inp.sprint, pass: false, shoot: 0, tackle: false,
      };
      if (E.pass && hasBall) uIntent.pass = true;
      if (E.tackle && !hasBall && me.tackleCd <= 0) uIntent.tackle = true;
      if (inp.shootHeld && hasBall) {
        this.charging = true;
        this.chargeT = Math.min(1, this.chargeT + dt / 0.85);
        this.ui.setPower(this.chargeT);
      } else if (this.charging && E.shootRel && hasBall) {
        uIntent.shoot = 0.35 + 0.65 * this.chargeT;
        uIntent.aimZ = clamp(inp.moveZ * 6, -3.6, 3.6);
        uIntent.curve = -inp.moveX * 0.7;
        this.charging = false; this.chargeT = 0;
        this.ui.setPower(null);
      } else if (!inp.shootHeld) {
        if (this.charging) { this.charging = false; this.chargeT = 0; this.ui.setPower(null); }
        if (E.shootRel && hasBall) { uIntent.shoot = 0.55; uIntent.aimZ = 0; uIntent.curve = 0; } // quick tap
      }
      me.intent = uIntent;
    }

    // integrate players + consume actions
    for (const t of this.teams) {
      const opps = this.teams[1 - t.idx].players;
      for (const p of t.players) {
        const it = p.intent || { mx: p.pos.x, mz: p.pos.z, sprint: false };
        if (p.tackleCd > 0) p.tackleCd -= dt;
        p.moveToward(it.mx, it.mz, it.sprint, dt, t.idx === 1 ? this.diff.speed : 1);
        if (it.pass && ball.owner === p) this.doPass(p, t, opps);
        if (it.shoot && ball.owner === p) this.doShoot(p, it.shoot, it.aimZ, it.curve, t);
        if (it.tackle && p.tackleCd <= 0) this.doTackle(p);
        p.intent = null;
      }
    }

    // ball physics
    this._prevX = ball.pos.x;
    ball.update(dt, this.posts);
    if (ball.postHit) { ball.postHit = false; audio.post(); this.ui.commentary('OFF THE WOODWORK!', 1400); }

    this.resolvePickups(dt);
    this.resolveTackles();
    this.checkGoalOrOut();
    this.checkStuck(dt);

    // HUD
    this.ui.setStamina(me ? me.stamina : 1);
    const mm = Math.floor(this.clock / 60), ss = Math.floor(this.clock % 60);
    const label = this.et ? 'ET' : (this.half === 1 ? '1ST' : '2ND');
    this.ui.setClock(`${mm}:${ss.toString().padStart(2, '0')}`, label);
  }

  doPass(p, team, opps) {
    const target = choosePassTargetSmart(p, team.players, opps, team.attackDir, this.diff.passErr);
    const ball = this.ball;
    if (!target) { // clear it forward
      const dir = new THREE.Vector3(team.attackDir, 0, rand(-0.4, 0.4)).normalize();
      ball.owner = null; ball.kick(dir, 0.45, 0.15, 0); p.kickCd = 0.3; audio.kick(0.3);
      return;
    }
    const lead = 0.35;
    const tx = target.pos.x + target.vel.x * lead, tz = target.pos.z + target.vel.z * lead;
    const dx = tx - p.pos.x, dz = tz - p.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const dir = new THREE.Vector3(dx / d, 0, dz / d);
    // error
    dir.x += rand(-1, 1) * this.diff.passErr * 0.35;
    dir.z += rand(-1, 1) * this.diff.passErr * 0.35;
    dir.normalize();
    const power = clamp(d / 30, 0.3, 0.72);
    ball.owner = null; ball.lastTouch = p;
    ball.kick(dir, power, 0.12, 0);
    p.kickCd = 0.3;
    audio.kick(power * 0.6);
  }

  doShoot(p, power, aimZ, curve, team) {
    const ball = this.ball;
    const gx = this.oppGoalX(team);
    let tz;
    if (aimZ !== undefined && p.controlled) tz = aimZ;
    else tz = (Math.random() < 0.5 ? -1 : 1) * PITCH.GOAL_W * 0.3 + rand(-1, 1) * this.diff.shotErr * 5;
    tz = clamp(tz, -PITCH.GOAL_W / 2 + 0.4, PITCH.GOAL_W / 2 - 0.4);
    const ty = rand(0.5, Math.min(PITCH.GOAL_H - 0.4, 0.6 + power * 1.6));
    const dx = gx - ball.pos.x, dz = tz - ball.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const dir = new THREE.Vector3(dx / d, 0, dz / d);
    ball.owner = null; ball.lastTouch = p;
    ball.kick(dir, clamp(power, 0.3, 1), 0.22 + power * 0.12, curve || rand(-0.5, 0.5) * power);
    // aim height via upward component tweak
    ball.vel.y = ty * (6 + power * 8);
    p.kickCd = 0.35;
    audio.kick(power);
    if (power > 0.8) this.shakeT = Math.max(this.shakeT, 0.18);
  }

  doTackle(p) {
    p.slideT = 0.38; p.tackleCd = 1.1;
    p.vel.x += p.facing.x * 9; p.vel.z += p.facing.z * 9;
    audio.tackle();
  }

  resolvePickups(dt) {
    const ball = this.ball;
    if (ball.owner) return;
    if (ball.pos.y > 1.7) return;
    let best = null, bd = 1e9;
    for (const t of this.teams) for (const p of t.players) {
      if (p.kickCd > 0) continue;
      let r = 1.15;
      if (p.slideT > 0.1) r = 2.0; // sliding reach
      const d = dist2(p.pos.x, p.pos.z, ball.pos.x, ball.pos.z);
      if (d < r && d < bd) { bd = d; best = p; }
    }
    if (best) {
      ball.owner = best;
      best.kickCd = 0.15;
    }
  }

  resolveTackles() {
    const ball = this.ball;
    for (const t of this.teams) for (const p of t.players) {
      if (p.slideT > 0.12 && ball.owner && ball.owner.team !== p.team) {
        const o = ball.owner;
        const d = dist2(p.pos.x, p.pos.z, o.pos.x, o.pos.z);
        const facingDot = (o.pos.x - p.pos.x) * p.facing.x + (o.pos.z - p.pos.z) * p.facing.z;
        if (d < 2.1 && facingDot > 0) {
          const prob = p.controlled ? 0.72 : this.diff.tackleP;
          if (Math.random() < prob) {
            ball.owner = p; p.kickCd = 0.2; p.slideT = 0;
            this.ui.commentary('WON IT BACK!', 1100);
          } else {
            ball.owner = null;
            ball.vel.set(rand(-4, 4), rand(2, 5), rand(-4, 4));
            this.ui.commentary('TACKLE!', 900);
          }
          this.shakeT = Math.max(this.shakeT, 0.22);
          audio.tackle();
          p.slideT = 0; // single resolution
        }
      }
    }
    // keeper saves / catches
    for (const t of this.teams) {
      const k = t.players[0];
      if (ball.owner || k.diveT <= 0 && dist2(k.pos.x, k.pos.z, ball.pos.x, ball.pos.z) > 2.0) {
        if (!(ball.owner === k)) {
          // still allow catch check below only when close
        }
      }
      const d = dist2(k.pos.x, k.pos.z, ball.pos.x, ball.pos.z);
      if (!ball.owner && d < 2.0 && ball.pos.y < 2.3) {
        const sp = ball.vel.length();
        if (sp < 11 || k.diveT > 0.15) {
          ball.owner = k; ball.vel.set(0, 0, 0); k.holdT = 0;
          audio.save(); this.ui.commentary('SAVED!', 1300);
        } else {
          // parry
          ball.vel.x *= -0.3; ball.vel.z += rand(-7, 7); ball.vel.y = rand(3, 7);
          audio.save(); this.ui.commentary('PARRIED!', 1200);
          this.shakeT = Math.max(this.shakeT, 0.15);
        }
      }
    }
  }

  checkGoalOrOut() {
    const ball = this.ball, { L, GOAL_W, GOAL_H } = PITCH;
    for (const t of this.teams) {
      const s = t.attackDir; // team attacks toward x = s*L/2
      const gx = s * L / 2;
      const crossed = (ball.pos.x - gx) * s > 0 && (this._prevX - gx) * s <= 0;
      if (crossed && Math.abs(ball.pos.z) < GOAL_W / 2 && ball.pos.y < GOAL_H) {
        this.onGoal(t.idx, s);
        return;
      }
    }
    // out behind goal -> goal kick (arcade)
    if (Math.abs(ball.pos.x) > L / 2 + 4) {
      const s = Math.sign(ball.pos.x);
      const defending = this.teams.find(t => t.attackDir === -s);
      ball.reset(s * (L / 2 - 9), rand(-6, 6));
      ball.owner = null;
      this.ui.commentary('GOAL KICK', 1100);
      audio.whistle(1);
      void defending;
    }
  }

  checkStuck(dt) {
    const ball = this.ball;
    if (!ball.owner && ball.vel.lengthSq() < 0.16) {
      this.stuckT += dt;
      if (this.stuckT > 3.5) {
        let best = null, bd = 1e9;
        for (const t of this.teams) for (const p of t.players) {
          const d = dist2(p.pos.x, p.pos.z, ball.pos.x, ball.pos.z);
          if (d < bd) { bd = d; best = p; }
        }
        if (best) ball.owner = best;
        this.stuckT = 0;
      }
    } else this.stuckT = 0;
  }

  onGoal(teamIdx, side) {
    const ball = this.ball;
    ball.pos.x = side * (PITCH.L / 2 + 1.1);
    ball.vel.multiplyScalar(0.15);
    this.score[teamIdx]++;
    this.ui.setScore(this.score[0], this.score[1], this.teams[0].info.short, this.teams[1].info.short);
    const name = this.teams[teamIdx].info.name.toUpperCase();
    this.ui.commentary(`GOAL! ${name}`, 2600);
    audio.cheer(true); audio.goalHorn();
    this.world.goalNetRipple(side);
    this.slowmo = 1.3; this.shakeT = 0.3;
    this._conceded = 1 - teamIdx;
    if (this.et) { // golden goal
      this.state = 'fulltimex';
      setTimeout(() => this.finish(), 2600);
      return;
    }
    this.state = 'goal'; this.stateT = 3.0;
  }

  endHalf() {
    if (this.et) { this.finish(); return; }
    if (this.half === 1) {
      this.state = 'halftime'; this.stateT = 4.0;
      this.ui.commentary('HALF TIME', 2600);
      audio.whistle(2);
    } else this.finish();
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    audio.whistle(3);
    this.onDone({ a: this.score[0], b: this.score[1] });
  }

  get shake() { return this.shakeT > 0 ? Math.min(0.6, this.shakeT * 2) : 0; }
}

// ---------------------------------------------------------------- Penalties
export class Penalties {
  constructor(opts) {
    this.scene = opts.scene; this.world = opts.world; this.ui = opts.ui;
    this.input = opts.input; this.diff = DIFFS[opts.diffKey] || DIFFS.pro;
    this.onDone = opts.onDone;
    const uInfo = TEAMS.find(t => t.id === opts.userTeamId) || TEAMS[0];
    const aInfo = TEAMS.find(t => t.id === opts.aiTeamId) || TEAMS[1];
    this.user = { info: uInfo, kicks: [], score: 0 };
    this.ai = { info: aInfo, kicks: [], score: 0 };
    this.round = 0; this.turn = 'userShoot'; // userShoot | userKeep
    this.state = 'intro'; this.stateT = 1.6;
    this.aim = { z: 0, y: 1.2 };
    this.power = 0; this.charging = false;
    this.diveDir = 0; this.diveLocked = false;
    this.kickT = 0; this.result = null;
    this.shooter = new Player(0, 'FW', uInfo, 1);
    this.keeper = new Player(1, 'GK', aInfo, -1);
    this.ball = new Ball(this.scene);
    this.scene.add(this.shooter.mesh, this.keeper.mesh);
    this.posts = this.world.postPositions();
    // aim marker
    const mg = new THREE.RingGeometry(0.28, 0.42, 20);
    this.aimMark = new THREE.Mesh(mg, new THREE.MeshBasicMaterial({ color: 0xffe14a, side: THREE.DoubleSide }));
    this.aimMark.visible = false;
    this.scene.add(this.aimMark);
    this.ui.commentary('PENALTY SHOOTOUT', 2000);
    this.ui.setScore(0, 0, uInfo.short, aInfo.short);
    audio.unlock();
  }
  dispose() {
    this.scene.remove(this.shooter.mesh, this.keeper.mesh, this.ball.mesh, this.aimMark);
  }
  goalX() { return PITCH.L / 2; }
  setupKick() {
    const gx = this.goalX();
    const shootingUser = this.turn === 'userShoot';
    const sk = shootingUser ? this.shooter : this.keeper; // reuse meshes; roles cosmetic here
    void sk;
    // keeper at goal
    this.keeper.reset(gx - 1.6, 0);
    this.keeper.facing.set(-1, 0, 0);
    // ball on spot
    this.ball.reset(gx - 11, 0);
    this.ball.owner = null;
    // shooter run-up start
    this.shooter.reset(gx - 15, shootingUser ? 2.5 : -2.5);
    this.shooter.facing.set(1, 0, 0);
    this.aim = { z: 0, y: 1.2 };
    this.power = 0; this.charging = false;
    this.diveDir = 0; this.diveLocked = false;
    this.kickT = 0; this.result = null;
    this.aimMark.visible = shootingUser;
    this.state = shootingUser ? 'aim' : 'wait';
    this.ui.commentary(shootingUser ? 'YOUR KICK — aim, hold SHOOT, release!' : 'KEEPER! Pick a side: ◀ ▶', 2200);
    this.ui.setPower(null);
  }
  aiChooseTarget() {
    const side = Math.random() < 0.5 ? -1 : 1;
    return { z: side * rand(1.8, 3.6), y: rand(0.4, 2.2) };
  }
  update(rdt) {
    const inp = this.input;
    if (this.state === 'intro') {
      this.stateT -= rdt;
      if (this.stateT <= 0) this.setupKick();
      this.world.update(rdt);
      return;
    }
    if (this.state === 'aim') {
      // move aim with input
      this.aim.z = clamp(this.aim.z + inp.moveX * 22 * rdt, -3.9, 3.9);
      this.aim.y = clamp(this.aim.y - inp.moveZ * 8 * rdt, 0.25, 2.5);
      const gx = this.goalX();
      this.aimMark.position.set(gx - 0.15, this.aim.y, this.aim.z);
      this.aimMark.lookAt(gx - 5, this.aim.y, this.aim.z);
      if (inp.shootHeld) { this.charging = true; this.power = Math.min(1, this.power + rdt / 0.8); this.ui.setPower(this.power); }
      if (this.charging && inp.shootReleased) {
        this.ui.setPower(null);
        this.takeUserKick();
      }
      this.idleAnim(rdt);
      return;
    }
    if (this.state === 'wait') {
      // user is keeper: read dive direction
      if (!this.diveLocked) {
        if (inp.keys['a'] || inp.keys['arrowleft'] || inp.joy.dx < -0.5) { this.diveDir = -1; this.diveLocked = true; }
        else if (inp.keys['d'] || inp.keys['arrowright'] || inp.joy.dx > 0.5) { this.diveDir = 1; this.diveLocked = true; }
      }
      this.kickT += rdt;
      // keeper shuffle anim
      this.keeper.pos.z = Math.sin(this.kickT * 9) * 0.8;
      this.keeper.syncMesh(rdt);
      if (this.kickT > 1.5) this.takeAiKick();
      this.idleAnim(rdt);
      return;
    }
    if (this.state === 'flight' || this.state === 'done-kick') {
      this.kickT -= rdt;
      this.ball.update(rdt, this.posts);
      this.keeper.syncMesh(rdt);
      this.shooter.syncMesh(rdt);
      this.world.update(rdt);
      if (this.kickT <= 0) this.afterKick();
      return;
    }
    this.world.update(rdt);
  }
  idleAnim(rdt) {
    this.shooter.syncMesh(rdt); this.keeper.syncMesh(rdt); this.world.update(rdt);
  }
  takeUserKick() {
    const gx = this.goalX();
    const p = Math.max(0.25, this.power);
    const dir = new THREE.Vector3(gx - this.ball.pos.x, 0, this.aim.z - this.ball.pos.z).normalize();
    this.ball.kick(dir, p, 0.1, 0);
    this.ball.vel.y = this.aim.y * 7;
    audio.kick(p);
    // AI keeper dive
    const reads = Math.random() < this.diff.keeper;
    const side = reads ? Math.sign(this.aim.z) || 1 : (Math.random() < 0.5 ? -1 : 1);
    this.keeperDive(side);
    this.state = 'flight'; this.kickT = 1.1;
    this.aimMark.visible = false;
    this._scored = Math.abs(this.aim.z) < PITCH.GOAL_W / 2 - 0.15 && this.aim.y < PITCH.GOAL_H - 0.1;
    this._saveSide = side;
  }
  takeAiKick() {
    const gx = this.goalX();
    const tgt = this.aiChooseTarget();
    // user keeper dive
    const dir = this.diveDir;
    this.keeper.diveT = 0.55; this.keeper.diveDir = dir;
    this.keeper.vel.z = dir * 13;
    const p = rand(0.55, 0.9);
    const d = new THREE.Vector3(gx - this.ball.pos.x, 0, tgt.z - this.ball.pos.z).normalize();
    this.ball.kick(d, p, 0.1, 0);
    this.ball.vel.y = tgt.y * 7;
    audio.kick(p);
    this.state = 'flight'; this.kickT = 1.1;
    const saved = dir !== 0 && Math.sign(dir) === Math.sign(tgt.z) && Math.abs(tgt.z) < 3.4;
    const missed = Math.abs(tgt.z) > PITCH.GOAL_W / 2 - 0.1 || tgt.y > PITCH.GOAL_H - 0.05;
    this._scored = !saved && !missed;
    this._saved = saved;
    this.ui.setPower(null);
  }
  keeperDive(side) {
    const k = this.keeper;
    k.diveT = 0.55; k.diveDir = side;
    k.vel.z = side * 13;
  }
  afterKick() {
    const userKicking = this.turn === 'userShoot';
    let scored, saved = false;
    if (userKicking) {
      // resolve: did keeper get there?
      const kz = this.keeper.pos.z;
      const distK = Math.abs(kz - this.aim.z);
      saved = this._scored && distK < 1.5 && this.keeper.diveT > 0;
      scored = this._scored && !saved;
      if (scored) { this.user.score++; this.user.kicks.push(1); }
      else { this.user.kicks.push(0); }
    } else {
      scored = this._scored; saved = !!this._saved;
      if (scored) { this.ai.score++; this.ai.kicks.push(1); } else this.ai.kicks.push(0);
    }
    this.ui.setScore(this.user.score, this.ai.score, this.user.info.short, this.ai.info.short);
    if (scored) { this.ui.commentary('GOAL!', 1800); audio.cheer(true); audio.goalHorn(); this.world.goalNetRipple(1); }
    else if (saved) { this.ui.commentary('SAVED!', 1800); audio.save(); }
    else { this.ui.commentary('MISSED!', 1800); }
    // next
    if (this.turn === 'userShoot') this.turn = 'userKeep';
    else { this.turn = 'userShoot'; this.round++; }
    const done = this.checkDone();
    this.state = 'done-kick'; this.kickT = 1.4;
    this._next = done;
  }
  checkDone() {
    const ur = this.user.kicks.length, ar = this.ai.kicks.length;
    const remU = 5 - ur, remA = 5 - ar;
    if (ur >= 5 && ar >= 5) {
      if (this.user.score !== this.ai.score) return this.user.score > this.ai.score ? 'user' : 'ai';
      return null; // sudden death continues
    }
    if (this.user.score > this.ai.score + remA) return 'user';
    if (this.ai.score > this.user.score + remU) return 'ai';
    return null;
  }
  // called from update when done-kick expires
  nextAfter() {
    if (this._next) { this.onDone(this._next); return; }
    this.setupKick();
  }
}

// patch: route done-kick expiry
const _penUpdate = Penalties.prototype.update;
Penalties.prototype.update = function (rdt) {
  if (this.state === 'done-kick') {
    this.kickT -= rdt;
    this.ball.update(rdt, this.posts);
    this.keeper.syncMesh(rdt);
    this.world.update(rdt);
    if (this.kickT <= 0) this.nextAfter();
    return;
  }
  _penUpdate.call(this, rdt);
};

// ---------------------------------------------------------------- Tournament
export class Tournament {
  constructor(userTeamId) {
    const ids = TEAMS.map(t => t.id).filter(id => id !== userTeamId);
    // shuffle
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    const others = [userTeamId, ...ids];
    this.rounds = ['Quarterfinal', 'Semifinal', 'Final'];
    this.roundIdx = 0;
    this.fixtures = [];
    for (let i = 0; i < 8; i += 2) this.fixtures.push({ a: others[i], b: others[i + 1], sa: null, sb: null, userTie: others[i] === userTeamId || others[i+1] === userTeamId });
    this.userTeamId = userTeamId;
    this.winner = null;
  }
  roundName() { return this.rounds[this.roundIdx]; }
  userTie() { return this.fixtures.find(f => f.userTie && f.sa === null); }
  simTie(f) {
    // AI vs AI instant result
    const ga = Math.max(0, Math.round(1.1 + Math.random() * 2.4));
    const gb = Math.max(0, Math.round(1.1 + Math.random() * 2.4));
    f.sa = ga; f.sb = gb;
    if (ga === gb) return Math.random() < 0.5 ? f.a : f.b;
    return ga > gb ? f.a : f.b;
  }
  reportUserTie(sa, sb, penWinnerId) {
    const f = this.fixtures.find(x => x.userTie && x.sa === null);
    f.sa = sa; f.sb = sb;
    if (sa !== sb) f.winner = sa > sb ? f.a : f.b;
    else f.winner = penWinnerId;
    return f.winner === this.userTeamId;
  }
  advance() {
    const winners = this.fixtures.map(f => f.winner || (f.sa > f.sb ? f.a : f.b));
    this.roundIdx++;
    if (winners.length === 1) { this.winner = winners[0]; return false; }
    this.fixtures = [];
    for (let i = 0; i < winners.length; i += 2) {
      const a = winners[i], b = winners[i + 1];
      this.fixtures.push({ a, b, sa: null, sb: null, userTie: a === this.userTeamId || b === this.userTeamId });
    }
    return true;
  }
  isUserChampion() { return this.winner === this.userTeamId; }
}
