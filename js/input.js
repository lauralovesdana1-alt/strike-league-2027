// G-Football 2027 — keyboard + touch input
export class Input {
  constructor() {
    this.keys = {};
    this.joy = { active: false, dx: 0, dy: 0, id: null };
    this.btn = { pass: false, shoot: false, tackle: false, sprint: false, switch: false };
    this.btnEdge = { pass: false, shoot: false, tackle: false, switch: false };
    this.shootHeld = false;      // charging state
    this.shootReleased = false;  // edge: released this frame
    this._shootWasDown = false;
    this.moveX = 0; this.moveZ = 0;
    this.isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    this._bindKeys();
  }
  _bindKeys() {
    window.addEventListener('keydown', e => {
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) e.preventDefault();
      this.keys[e.key.toLowerCase()] = true;
      if (e.key === 'Tab') { e.preventDefault(); this.btnEdge.switch = true; }
    });
    window.addEventListener('keyup', e => { this.keys[e.key.toLowerCase()] = false; });
  }
  // touch joystick hooks (called from UI)
  setJoystick(dx, dy, active) {
    this.joy.dx = dx; this.joy.dy = dy; this.joy.active = active;
  }
  press(name, down) {
    if (!(name in this.btn)) return;
    const was = this.btn[name];
    this.btn[name] = down;
    if (down && !was && name in this.btnEdge) this.btnEdge[name] = true;
  }
  // called once per sim tick by main loop
  poll() {
    const k = this.keys;
    let x = 0, z = 0;
    if (k['a'] || k['arrowleft']) x -= 1;
    if (k['d'] || k['arrowright']) x += 1;
    if (k['w'] || k['arrowup']) z -= 1;
    if (k['s'] || k['arrowdown']) z += 1;
    if (this.joy.active) { x = this.joy.dx; z = this.joy.dy; }
    const len = Math.hypot(x, z);
    if (len > 1) { x /= len; z /= len; }
    this.moveX = x; this.moveZ = z;

    const shootDown = !!(k[' '] || k['c'] || this.btn.shoot);
    this.shootHeld = shootDown;
    this.shootReleased = this._shootWasDown && !shootDown;
    this._shootWasDown = shootDown;

    this.wantPass = !!(k['x'] || this.btnEdge.pass);
    this.wantTackle = !!(k['v'] || this.btnEdge.tackle);
    this.wantSwitch = !!this.btnEdge.switch;
    this.sprint = !!(k['shift'] || this.btn.sprint);
    // clear edges
    this.btnEdge.pass = this.btnEdge.shoot = this.btnEdge.tackle = this.btnEdge.switch = false;
  }
}
