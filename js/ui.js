// G-Football 2027 — menus, HUD, minimap, commentary, touch controls
import { TEAMS, DIFFS, css, TITLE } from './config.js';

const $ = id => document.getElementById(id);

export class UI {
  constructor(handlers) {
    this.h = handlers; // {startQuick, startTournament, startPenalties, onResume, onRestart, onQuit, onRematch, onMenu}
    this.mode = null;
    this.selTeam = TEAMS[0].id;
    this.selDiff = 'pro';
    this.selHalf = 4;
    this._commT = null;
    this.buildTeamGrid();
    this.bind();
    this.mm = $('minimap').getContext('2d');
  }
  show(name) {
    for (const id of ['loading','menu','teamselect','diffselect','howto','hud','pause','bracket','fulltime','trophy'])
      $(id).classList.toggle('hidden', id !== name && !(name === 'hud-pause' && (id === 'hud' || id === 'pause')));
    if (name === 'hud-pause') { $('hud').classList.remove('hidden'); $('pause').classList.remove('hidden'); }
    if (name === 'hud') $('touch').classList.toggle('hidden', !this.isTouch);
  }
  get isTouch() { return ('ontouchstart' in window) || navigator.maxTouchPoints > 0; }

  buildTeamGrid() {
    const g = $('teamgrid'); g.innerHTML = '';
    for (const t of TEAMS) {
      const d = document.createElement('div');
      d.className = 'team-card';
      d.innerHTML = `<div class="kit" style="background:${css(t.primary)};border-color:${css(t.secondary)}"></div><div class="nm">${t.name}</div>`;
      d.onclick = () => { this.selTeam = t.id; this.h.clickSnd(); this.show('diffselect'); };
      g.appendChild(d);
    }
  }
  bind() {
    $('btn-quick').onclick = () => { this.mode = 'quick'; this.h.clickSnd(); this.show('teamselect'); };
    $('btn-tourney').onclick = () => { this.mode = 'tournament'; this.h.clickSnd(); this.show('teamselect'); };
    $('btn-pens').onclick = () => { this.mode = 'penalties'; this.h.clickSnd(); this.show('teamselect'); };
    $('btn-howto').onclick = () => { this.h.clickSnd(); this.show('howto'); };
    document.querySelectorAll('[data-back]').forEach(b => b.onclick = () => { this.h.clickSnd(); this.show('menu'); });
    document.querySelectorAll('#diffrow .diff').forEach(b => b.onclick = () => {
      document.querySelectorAll('#diffrow .diff').forEach(x => x.classList.remove('sel'));
      b.classList.add('sel'); this.selDiff = b.dataset.d; this.h.clickSnd();
    });
    document.querySelectorAll('#halfrow .half').forEach(b => b.onclick = () => {
      document.querySelectorAll('#halfrow .half').forEach(x => x.classList.remove('sel'));
      b.classList.add('sel'); this.selHalf = parseInt(b.dataset.h, 10); this.h.clickSnd();
    });
    $('btn-kickoff').onclick = () => {
      this.h.clickSnd();
      if (this.mode === 'quick') this.h.startQuick(this.selTeam, this.selDiff, this.selHalf);
      else if (this.mode === 'tournament') this.h.startTournament(this.selTeam, this.selDiff, this.selHalf);
      else this.h.startPenalties(this.selTeam, this.selDiff);
    };
    $('btn-pause').onclick = () => this.h.onPause();
    $('btn-resume').onclick = () => this.h.onResume();
    $('btn-restart').onclick = () => this.h.onRestart();
    $('btn-quit').onclick = () => this.h.onQuit();
    $('btn-rematch').onclick = () => this.h.onRematch();
    $('btn-ft-menu').onclick = () => this.h.onMenu();
    $('btn-trophy-menu').onclick = () => this.h.onMenu();
    $('btn-play-tie').onclick = () => this.h.onPlayTie();
    window.addEventListener('keydown', e => {
      if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') this.h.onPauseKey();
    });
  }
  bindTouch(input) {
    if (!this.isTouch) return;
    const joy = $('joy'), knob = $('knob');
    let joyId = null;
    const setKnob = (dx, dy) => { knob.style.transform = `translate(calc(-50% + ${dx * 36}px), calc(-50% + ${dy * 36}px))`; };
    joy.addEventListener('pointerdown', e => {
      joyId = e.pointerId; joy.setPointerCapture(e.pointerId); this.moveJoy(e, joy, input, setKnob);
    });
    joy.addEventListener('pointermove', e => { if (e.pointerId === joyId) this.moveJoy(e, joy, input, setKnob); });
    const end = e => { if (e.pointerId === joyId) { joyId = null; input.setJoystick(0, 0, false); setKnob(0, 0); } };
    joy.addEventListener('pointerup', end); joy.addEventListener('pointercancel', end);
    const btn = (id, name) => {
      const el = $(id);
      el.addEventListener('pointerdown', e => { e.preventDefault(); input.press(name, true); });
      el.addEventListener('pointerup', () => input.press(name, false));
      el.addEventListener('pointercancel', () => input.press(name, false));
      el.addEventListener('pointerleave', () => input.press(name, false));
    };
    btn('tb-pass', 'pass'); btn('tb-shoot', 'shoot'); btn('tb-tackle', 'tackle');
    btn('tb-sprint', 'sprint'); btn('tb-switch', 'switch');
  }
  moveJoy(e, joy, input, setKnob) {
    const r = joy.getBoundingClientRect();
    let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    let dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const l = Math.hypot(dx, dy);
    if (l > 1) { dx /= l; dy /= l; }
    input.setJoystick(dx, dy, true);
    setKnob(dx, dy);
  }

  // ---- HUD ----
  setScore(a, b, sa, sb) {
    $('sc-a').textContent = `${sa} ${a}`;
    $('sc-b').textContent = `${b} ${sb}`;
  }
  setClock(text, label) {
    $('clock').textContent = text;
    $('half-label').textContent = label;
  }
  setPower(v) {
    const m = $('powermeter');
    if (v === null || v === undefined) { m.classList.add('hidden'); return; }
    m.classList.remove('hidden');
    $('power-fill').style.width = `${Math.round(v * 100)}%`;
  }
  setStamina(v) { $('stamina-fill').style.width = `${Math.round(v * 100)}%`; }
  commentary(text, dur = 1800) {
    const c = $('commentary');
    c.textContent = text;
    c.classList.remove('hidden');
    c.style.opacity = '1'; c.style.transform = 'translateX(-50%) scale(1)';
    clearTimeout(this._commT);
    this._commT = setTimeout(() => { c.style.opacity = '0'; c.style.transform = 'translateX(-50%) scale(1.15)'; }, dur);
  }
  drawMinimap(players, ball, active) {
    const ctx = this.mm, W = 170, H = 104;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(20,90,40,0.9)'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.strokeRect(4, 4, W - 8, H - 8);
    ctx.beginPath(); ctx.moveTo(W/2, 4); ctx.lineTo(W/2, H - 4); ctx.stroke();
    ctx.beginPath(); ctx.arc(W/2, H/2, 12, 0, Math.PI * 2); ctx.stroke();
    const X = x => (x + 50) / 100 * (W - 8) + 4;
    const Z = z => (z + 30) / 60 * (H - 8) + 4;
    for (const p of players) {
      ctx.fillStyle = p.team === 0 ? '#00e5ff' : '#ff5b5b';
      if (p.role === 'GK') ctx.fillStyle = p.team === 0 ? '#ffe14a' : '#ff9f1c';
      ctx.beginPath(); ctx.arc(X(p.pos.x), Z(p.pos.z), p === active ? 4.5 : 3, 0, Math.PI * 2); ctx.fill();
      if (p === active) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(X(p.pos.x), Z(p.pos.z), 6, 0, Math.PI * 2); ctx.stroke(); }
    }
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(X(ball.pos.x), Z(ball.pos.z), 2.5, 0, Math.PI * 2); ctx.fill();
  }
  // ---- screens ----
  showBracket(tourney) {
    const f = $('fixtures'); f.innerHTML = '';
    $('bracket-title').textContent = `${TITLE.toUpperCase()} — ${tourney.roundName().toUpperCase()}`;
    for (const fx of tourney.fixtures) {
      const a = TEAMS.find(t => t.id === fx.a), b = TEAMS.find(t => t.id === fx.b);
      const d = document.createElement('div');
      d.className = 'fixture';
      const score = fx.sa !== null ? ` <b>${fx.sa} - ${fx.sb}</b>` : '';
      d.innerHTML = `<span class="${fx.a === tourney.userTeamId ? 'me' : ''}">${a.name}</span> vs <span class="${fx.b === tourney.userTeamId ? 'me' : ''}">${b.name}</span>${score}`;
      f.appendChild(d);
    }
    $('btn-play-tie').classList.toggle('hidden', !tourney.userTie());
    this.show('bracket');
  }
  showFulltime(a, b, sa, sb, sub) {
    $('ft-title').textContent = 'FULL TIME';
    $('ft-score').textContent = `${sa} ${a} — ${b} ${sb}`;
    $('ft-sub').textContent = sub || '';
    this.show('fulltime');
  }
  showTrophy(champName) {
    $('trophy-text').textContent = `${champName.toUpperCase()} — CHAMPIONS!`;
    this.show('trophy');
  }
  setLoading(pct) { $('loadfill').style.width = `${Math.round(pct * 100)}%`; }
}
