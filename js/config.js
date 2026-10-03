// G-Football 2027 — global configuration
export const TITLE = 'G-Football 2027';

export const PITCH = {
  L: 100,          // length (x axis)
  W: 60,           // width  (z axis)
  GOAL_W: 9,       // goal mouth width
  GOAL_H: 2.8,     // crossbar height
  BALL_R: 0.35,
};

export const SIM_DT = 1 / 60;

// 8 fictional clubs
export const TEAMS = [
  { id: 'lag', name: 'Lagos Lightning', short: 'LAG', primary: 0x0a7d3c, secondary: 0xffffff },
  { id: 'neo', name: 'Neon United',     short: 'NEO', primary: 0x00e5ff, secondary: 0x111111 },
  { id: 'sol', name: 'Solar Strikers',  short: 'SOL', primary: 0xff8c00, secondary: 0x111111 },
  { id: 'arc', name: 'Arctic Wolves',   short: 'ARC', primary: 0xeef2ff, secondary: 0x1e5aff },
  { id: 'cri', name: 'Crimson Kings',   short: 'CRI', primary: 0xd21f2b, secondary: 0xffd24a },
  { id: 'jad', name: 'Jade Dragons',    short: 'JAD', primary: 0x00a86b, secondary: 0x111111 },
  { id: 'thu', name: 'Thunder Hawks',   short: 'THU', primary: 0x7b2ff7, secondary: 0xffe14a },
  { id: 'cor', name: 'Coral Pirates',   short: 'COR', primary: 0x14b8a6, secondary: 0xff6f61 },
];

// 7v7 formation: 1 GK, 2 DF, 3 MF, 1 FW. x = own half negative (attacks +x).
export const FORMATION = [
  { role: 'GK', x: -45, z: 0 },
  { role: 'DF', x: -28, z: -13 },
  { role: 'DF', x: -28, z: 13 },
  { role: 'MF', x: -13, z: -15 },
  { role: 'MF', x: -11, z: 0 },
  { role: 'MF', x: -13, z: 15 },
  { role: 'FW', x: 2,  z: 0 },
];

export const DIFFS = {
  amateur: { label: 'Amateur', react: 0.38, speed: 0.86, shotErr: 0.38, passErr: 0.22, tackleP: 0.45, keeper: 0.45, pressN: 1, aiShootRange: 20 },
  pro:     { label: 'Pro',     react: 0.22, speed: 1.0,  shotErr: 0.22, passErr: 0.12, tackleP: 0.65, keeper: 0.72, pressN: 2, aiShootRange: 26 },
  legend:  { label: 'Legend',  react: 0.13, speed: 1.12, shotErr: 0.11, passErr: 0.06, tackleP: 0.82, keeper: 0.9,  pressN: 2, aiShootRange: 32 },
};

export const HALF_OPTIONS = [2, 4, 6]; // minutes per half

export const SPONSORS = [
  'G-FOOTBALL 2027', 'STRIKE COLA', 'VOLT+', 'APEX BOOTS',
  'NOVAPHONE', 'TURBO', 'GOALZONE', 'G-FOOTBALL 2027',
];

export function teamById(id) {
  return TEAMS.find(t => t.id === id) || TEAMS[0];
}

export function css(hex) {
  return '#' + hex.toString(16).padStart(6, '0');
}
