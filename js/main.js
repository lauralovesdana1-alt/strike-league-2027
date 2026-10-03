// G-Football 2027 — bootstrap, render loop, camera, screen wiring
import * as THREE from 'three';
import { PITCH, TITLE, TEAMS } from './config.js';
import { World } from './world.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { Match, Penalties, Tournament } from './match.js';
import { audio } from './audio.js';

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const isMobile = ('ontouchstart' in window) || navigator.maxTouchPoints > 0 || Math.min(screen.width, screen.height) < 700;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = !isMobile;
if (!isMobile) {
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.mapSize.set(1024, 1024);
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 500);

// lights
scene.add(new THREE.HemisphereLight(0xbdd7ff, 0x2a4a2a, 0.95));
const sun = new THREE.DirectionalLight(0xfff6e0, 1.7);
sun.position.set(40, 70, 25);
if (!isMobile) {
  sun.castShadow = true;
  sun.shadow.camera.left = -60; sun.shadow.camera.right = 60;
  sun.shadow.camera.top = 45; sun.shadow.camera.bottom = -45;
  sun.shadow.camera.far = 200;
}
scene.add(sun);

const world = new World(scene, isMobile);
const input = new Input();
const ui = new UI({
  clickSnd: () => { audio.unlock(); audio.click(); },
  startQuick: (teamId, diff, half) => startMatch(teamId, pickOpponent(teamId), diff, half, false),
  startTournament: (teamId, diff, half) => startTournament(teamId, diff, half),
  startPenalties: (teamId, diff) => startPenalties(teamId, pickOpponent(teamId), diff, null),
  onPause: () => pauseGame(),
  onPauseKey: () => pauseKey(),
  onResume: () => resumeGame(),
  onRestart: () => restartGame(),
  onQuit: () => quitToMenu(),
  onRematch: () => rematch(),
  onMenu: () => quitToMenu(),
  onPlayTie: () => playTournamentTie(),
});
ui.bindTouch(input);
ui.setLoading(0.7);

function pickOpponent(userTeamId) {
  const pool = TEAMS.filter(t => t.id !== userTeamId);
  return pool[Math.floor(Math.random() * pool.length)].id;
}

// ---- game state ----
let mode = null;            // 'match' | 'penalties' | 'tournament'
let match = null, pens = null, tourney = null;
let paused = false;
let lastCfg = null;         // for rematch/restart
let camTarget = new THREE.Vector3();
let shakeVec = new THREE.Vector3();

function clearActors() {
  if (match) { match.dispose(); match = null; }
  if (pens) { pens.dispose(); pens = null; }
}

function startMatch(userTeamId, aiTeamId, diffKey, halfMin, knockout, doneCb) {
  clearActors();
  paused = false;
  mode = 'match';
  lastCfg = { userTeamId, aiTeamId, diffKey, halfMin, knockout };
  match = new Match({
    scene, world, ui, input, userTeamId, aiTeamId,
    diffKey, halfLenMin: halfMin, knockout,
    onDone: res => {
      if (doneCb) { doneCb(res); return; }
      const t0 = match.teams[0].info, t1 = match.teams[1].info;
      const sub = res.a === res.b ? "It's a draw!" : (res.a > res.b ? `${t0.name} win!` : `${t1.name} win!`);
      ui.showFulltime(res.a, res.b, t0.short, t1.short, sub);
      mode = 'over';
    },
  });
  ui.show('hud');
}

function startPenalties(userTeamId, aiTeamId, diffKey, doneCb) {
  clearActors();
  paused = false;
  mode = 'penalties';
  lastCfg = { penUser: userTeamId, penAi: aiTeamId, diffKey };
  pens = new Penalties({
    scene, world, ui, input, userTeamId, aiTeamId, diffKey,
    onDone: winner => {
      if (doneCb) { doneCb(winner); return; }
      const winfo = winner === 'user' ? pens.user.info : pens.ai.info;
      ui.showFulltime(pens.user.score, pens.ai.score, pens.user.info.short, pens.ai.info.short,
        `${winfo.name} win the shootout!`);
      mode = 'over';
    },
  });
  ui.show('hud');
}

// ---- tournament ----
function startTournament(userTeamId, diffKey, halfMin) {
  tourney = new Tournament(userTeamId);
  lastCfg = { tourney: { userTeamId, diffKey, halfMin } };
  mode = 'tournament';
  // sim non-user QF ties immediately
  for (const f of tourney.fixtures) if (!f.userTie) f.winner = tourney.simTie(f);
  ui.showBracket(tourney);
}
function playTournamentTie() {
  const tie = tourney.userTie();
  if (!tie) return;
  const { userTeamId, diffKey, halfMin } = lastCfg.tourney;
  const userIsA = tie.a === userTeamId;
  const aiId = userIsA ? tie.b : tie.a;
  startMatch(userTeamId, aiId, diffKey, halfMin, true, res => {
    const us = res.a, them = res.b; // user is always team 0 in our matches
    if (us !== them) {
      const adv = tourney.reportUserTie(us, them);
      afterTie(adv);
    } else {
      // penalties to decide
      startPenalties(userTeamId, aiId, diffKey, winner => {
        const adv = tourney.reportUserTie(us, them, winner === 'user' ? userTeamId : aiId);
        afterTie(adv);
      });
    }
  });
}
function afterTie(advanced) {
  if (!advanced) {
    ui.showFulltime(0, 0, '', '', 'Knocked out. Better luck next time!');
    ui.show('fulltime');
    $('ft-title').textContent = 'KNOCKED OUT';
    mode = 'over';
    return;
  }
  const more = tourney.advance();
  if (!more) {
    // champion!
    world.confettiBurst();
    audio.cheer(true); audio.goalHorn();
    const champ = tourney.winner === tourney.userTeamId
      ? (match ? match.teams[0].info.name : 'YOU')
      : 'AI';
    ui.showTrophy(champ === 'YOU' ? 'YOU ARE' : champ);
    ui.commentary('CHAMPIONS!', 4000);
    mode = 'over';
    return;
  }
  for (const f of tourney.fixtures) if (!f.userTie) f.winner = tourney.simTie(f);
  ui.showBracket(tourney);
}

// ---- pause / nav ----
function pauseGame() {
  if (mode !== 'match' && mode !== 'penalties') return;
  if (paused) { resumeGame(); return; }
  paused = true;
  ui.show('hud-pause');
}
function pauseKey() {
  if ($('hud').classList.contains('hidden')) return;
  pauseGame();
}
function resumeGame() { paused = false; ui.show('hud'); }
function restartGame() {
  if (!lastCfg) return quitToMenu();
  if (lastCfg.penUser) startPenalties(lastCfg.penUser, lastCfg.penAi, lastCfg.diffKey, null);
  else if (lastCfg.tourney) startTournament(lastCfg.tourney.userTeamId, lastCfg.tourney.diffKey, lastCfg.tourney.halfMin);
  else startMatch(lastCfg.userTeamId, lastCfg.aiTeamId, lastCfg.diffKey, lastCfg.halfMin, lastCfg.knockout);
}
function rematch() {
  if (lastCfg && lastCfg.tourney) startTournament(lastCfg.tourney.userTeamId, lastCfg.tourney.diffKey, lastCfg.tourney.halfMin);
  else if (lastCfg && !lastCfg.penUser) startMatch(lastCfg.userTeamId, lastCfg.aiTeamId, lastCfg.diffKey, lastCfg.halfMin, false);
  else quitToMenu();
}
function quitToMenu() {
  clearActors();
  paused = false; mode = null; tourney = null;
  ui.setPower(null);
  ui.show('menu');
}
function $(id) { return document.getElementById(id); }

// ---- camera ----
const camPos = new THREE.Vector3(0, 36, 48);
const camLook = new THREE.Vector3();
function updateCamera(rdt, focus) {
  const fx = focus ? focus.x * 0.55 : 0;
  camPos.x += (fx - camPos.x) * (1 - Math.exp(-3 * rdt));
  camPos.y = 36; camPos.z = 48;
  let sx = 0, sy = 0;
  const sh = (match && match.shake) || 0;
  if (sh > 0) { sx = (Math.random() - 0.5) * sh * 2; sy = (Math.random() - 0.5) * sh; }
  camera.position.set(camPos.x + sx, camPos.y + sy, camPos.z);
  camLook.set(camPos.x, 0, -2);
  camera.lookAt(camLook);
}

// ---- main loop ----
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  let rdt = Math.min(0.1, (now - last) / 1000);
  last = now;
  input.poll();
  if (!paused) {
    if (mode === 'match' && match) {
      match.update(rdt);
      updateCamera(rdt, match.ball.pos);
      ui.drawMinimap([...match.teams[0].players, ...match.teams[1].players], match.ball, match.active);
    } else if (mode === 'penalties' && pens) {
      pens.update(rdt);
      updateCamera(rdt, pens.ball.pos);
      ui.drawMinimap([pens.shooter, pens.keeper], pens.ball, null);
    } else {
      // menu idle: slow orbit around stadium
      const t = now / 1000;
      camera.position.set(Math.sin(t * 0.08) * 70, 42, Math.cos(t * 0.08) * 70);
      camera.lookAt(0, 0, 0);
      world.update(rdt);
    }
  }
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// unlock audio on first interaction
window.addEventListener('pointerdown', () => audio.unlock(), { once: false });
window.addEventListener('keydown', () => audio.unlock(), { once: false });

ui.setLoading(1);
setTimeout(() => ui.show('menu'), 400);
requestAnimationFrame(frame);
