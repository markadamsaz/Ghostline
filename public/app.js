// Ghostline: real-world hide and seek with timed location pings.
// One player's device (the host) keeps the shared game state and broadcasts it.
// Hiders never stream their live location: their phone only sends a (blurred) spot at each ping.
import { createNet } from './net.js';
import * as G from './geo.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
// Line icons (24x24, stroked with currentColor). No emoji anywhere in the UI.
const ICONS = {
  decoy: '<path d="M6 20V10a6 6 0 0 1 12 0v10l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5z"/><path d="M10 10h.01M14 10h.01"/>',
  jammer: '<path d="M3 3l18 18"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M5 12.6a10 10 0 0 1 5-2.5"/><path d="M19 12.6a10 10 0 0 0-2.2-1.6"/><path d="M2 8.8a15 15 0 0 1 4.2-2.6"/><path d="M22 8.8A15 15 0 0 0 11 5"/><path d="M12 20h.01"/>',
  sonar: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>',
  radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12l6.5-6.5"/>',
  ghost: '<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c5 0 9 4.5 10 7a13 13 0 0 1-3 4"/><path d="M6.6 6.6C4 8.2 2.5 10.6 2 12c1 2.5 5 7 10 7a10 10 0 0 0 4.3-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  swarm: '<circle cx="6" cy="7" r="2.5"/><circle cx="17" cy="5.5" r="2.5"/><circle cx="7" cy="17.5" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  blackout: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  xray: '<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/><circle cx="12" cy="12" r="1.5"/>',
  tracker: '<path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1.5"/>',
  infection: '<circle cx="12" cy="12" r="4"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8"/>',
  jail: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M9 3v18M15 3v18M4 10h16"/>',
  fugitive: '<path d="M4 12h12"/><path d="M12 6l6 6-6 6"/><path d="M4 7h4M4 17h4"/>',
  starter: '<path d="M6 9a6 6 0 0 1 12 0v11H6z"/><path d="M9 9V6a3 3 0 0 1 6 0v3"/><path d="M9 14h6"/>',
  drops: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5l9 4.5 9-4.5"/><path d="M12 12v9"/>',
  missions: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  capture: '<path d="M5 21V4"/><path d="M5 4h13l-2.5 4.5L18 13H5"/>',
  treasure: '<path d="M4 10h16v9H4z"/><path d="M4 10a8 5 0 0 1 16 0"/><path d="M11 12h2v3h-2z"/>',
  duel: '<path d="M4 4l9 9M4 4h4M4 4v4"/><path d="M20 4l-9 9M20 4h-4M20 4v4"/><path d="M7 15l-3 3 2 2 3-3M17 15l3 3-2 2-3-3"/>',
  wire: '<path d="M13 2 5 13h6l-1 9 8-11h-6z"/>',
  potato: '<path d="M12 3c1 4 6 5.5 6 11a6 6 0 0 1-12 0c0-3 2-4.5 2.5-6.5 1 1.2 2 2 3 2 .3-2.3-.5-4.5.5-6.5z"/>',
  sprint: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v6H4V6h6"/>',
  shrink: '<path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="M14 10l7-7"/><path d="M3 21l7-7"/>',
  strictZone: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  chevR: '<path d="M9 5l7 7-7 7"/>',
  chevD: '<path d="M5 9l7 7 7-7"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14a6.5 6.5 0 0 1 3.5 6"/>',
  gamepad: '<path d="M6 7h12a4 4 0 0 1 4 4l-1 6a2.5 2.5 0 0 1-4.4 1.3L15 16H9l-1.6 2.3A2.5 2.5 0 0 1 3 17l-1-6a4 4 0 0 1 4-4z"/><path d="M7 11v3M5.5 12.5h3M15.5 12h.01M18 13.5h.01"/>',
  box: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>',
  crown: '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/>',
  caught: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
  pin: '<path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  play: '<path d="M7 4.5v15L19 12z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v12H4z"/><circle cx="12" cy="13.5" r="3.5"/>',
  tag: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  locate: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  circle: '<circle cx="12" cy="12" r="8" stroke-dasharray="3 3"/><circle cx="12" cy="12" r="1.5"/>',
  shape: '<path d="M12 3l8 6-3 11H7L4 9z"/><circle cx="12" cy="3" r="1"/><circle cx="20" cy="9" r="1"/><circle cx="4" cy="9" r="1"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  share: '<path d="M12 3v12"/><path d="M7 8l5-5 5 5"/><path d="M5 13v7h14v-7"/>',
  qr: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>',
  eye: '<path d="M2 12c1.5-3.5 5.5-7 10-7s8.5 3.5 10 7c-1.5 3.5-5.5 7-10 7s-8.5-3.5-10-7z"/><circle cx="12" cy="12" r="3"/>',
  zone: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4l2.5 2.5"/>',
  hide: '<path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z"/><path d="M9 9h6"/>',
  cloak: '<path d="M12 3c-4 0-6 3-6 7v10l3-2 3 2 3-2 3 2V10c0-4-2-7-6-7z"/><path d="M4 4l16 16"/>',
  pass: '<path d="M3 8a2 2 0 0 0 0 4v0a2 2 0 0 1 0 4v2h18v-2a2 2 0 0 1 0-4 2 2 0 0 0 0-4V6H3z"/><path d="M14 6v12" stroke-dasharray="2 2"/>',
  peek: '<path d="M2 12c1.5-3.5 5.5-7 10-7s8.5 3.5 10 7"/><circle cx="12" cy="12" r="3"/><path d="M12 19v2"/>',
  trail: '<circle cx="12" cy="12" r="9"/><path d="M12 6l3 7-3-1.5L9 13z"/>',
  spotlight: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
  lockdown: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  shop: '<path d="M4 7h16l-1.5 12h-13z"/><path d="M9 7a3 3 0 0 1 6 0"/>',
  star: '<path d="M12 3l2.8 5.8 6.2.9-4.5 4.4 1 6.2L12 17.4 6.5 20.3l1-6.2L3 9.7l6.2-.9z"/>',
  heart: '<path d="M12 20s-8-4.6-8-10.2A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.8C20 15.4 12 20 12 20z"/>',
  diamond: '<path d="M12 3l8 9-8 9-8-9z"/>',
  flame: '<path d="M12 21a6 6 0 0 0 6-6c0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-3-2 2-3 4-3 7a6 6 0 0 0 6 6z"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
};
const ic = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
const ROLE_INK = { hider: '#1c1c1e', seeker: '#ff3b30' };
const COLORS = ['#35c8ff', '#ffd23d', '#b98cff', '#3dffb5', '#ff8a3d', '#ff6bd6', '#7dff5a', '#5a8cff', '#ff5a5a', '#5affea', '#d9ff3d', '#ffffff'];
const ITEM_INFO = {
  decoy: { ic: 'decoy', name: 'Decoy', desc: 'Your next ping shows a spot you pick', role: 'hider' },
  jammer: { ic: 'jammer', name: 'Jammer', desc: 'Skip your next ping', role: 'hider' },
  sonar: { ic: 'sonar', name: 'Sonar', desc: 'See every seeker for 30 s', role: 'hider' },
  radar: { ic: 'radar', name: 'Radar', desc: 'Force every hider to ping now', role: 'seeker' },
  // super power-ups: only from supply drops and seeker rewards
  ghost: { ic: 'ghost', name: 'Ghost', desc: 'No pings at all for the next 2 rounds', role: 'hider', sup: true },
  shield: { ic: 'shield', name: 'Shield', desc: 'Blocks the next tag on you', role: 'hider', sup: true },
  swarm: { ic: 'swarm', name: 'Swarm', desc: 'Next ping shows 4 spots, only 1 is real', role: 'hider', sup: true },
  blackout: { ic: 'blackout', name: 'Blackout', desc: "Every hider's next ping is hidden and seekers' maps go dark until then", role: 'hider', sup: true },
  xray: { ic: 'xray', name: 'X-ray', desc: 'Every hider pings their exact spot now', role: 'seeker', sup: true },
  tracker: { ic: 'tracker', name: 'Tracker', desc: 'Hiders ping every 15 s for a minute', role: 'seeker', sup: true },
  // bought in the points shop
  cloak: { ic: 'cloak', name: 'Cloak', desc: 'Your next ping is hidden, plus any surprise pings before it', role: 'hider' },
  pass: { ic: 'pass', name: 'Escape pass', desc: 'Ready: the next time you get caught, you get away', role: 'hider' },
  peek: { ic: 'peek', name: 'Peek', desc: 'See the nearest seeker for 10 s', role: 'hider' },
  trail: { ic: 'trail', name: 'Hot trail', desc: 'An arrow points to the nearest hider for 20 s', role: 'seeker' },
  spotlight: { ic: 'spotlight', name: 'Spotlight', desc: "Pick a hider and see their exact spot for 10 s", role: 'seeker' },
  lockdown: { ic: 'lockdown', name: 'Lockdown', desc: "Hiders can't use power-ups for 30 s", role: 'seeker' },
};
// points shop: spend the points you earn. Bought in the lobby, an item waits until a round where you have that role
const SHOP = {
  powerup: { ic: 'starter', name: 'Power-up', desc: 'A random decoy, jammer or sonar', cost: 50, role: 'hider' },
  peek: { cost: 65, role: 'hider' },
  cloak: { cost: 75, role: 'hider' },
  pass: { cost: 150, role: 'hider' },
  radar: { cost: 50, role: 'seeker' },
  trail: { cost: 75, role: 'seeker' },
  lockdown: { cost: 90, role: 'seeker' },
  spotlight: { cost: 100, role: 'seeker' },
  icon: { ic: 'star', name: 'Shape', desc: 'Your shape shows instead of your initial. Lasts all game', cost: 10 },
  color: { ic: 'star', name: 'Color', desc: 'Your color behind your initial, shape or character', cost: 5 },
};
const BADGES = ['star', 'heart', 'diamond', 'flame', 'bolt', 'moon'];
// characters (art from the Mafia game, in public/chars/). The cooler they are, the more they cost. Once bought, free to switch back to all game
const CHAR_TIERS = { 600: 'Legendary', 350: 'Epic', 200: 'Rare', 100: 'Common' };
const CHARS = Object.fromEntries([
  ['mewtwo', 'Mewtwo', 600], ['godzilla', 'Godzilla', 600], ['mega_clawd', 'Mega Clawd', 600], ['rolling_hero', 'Rolling Hero', 600],
  ['pikachu', 'Pikachu', 350], ['shrek', 'Shrek', 350], ['gru', 'Gru', 350], ['kirby', 'Kirby', 350], ['ghost_gold', 'Specter', 350],
  ['yoshi', 'Yoshi', 200], ['luigi', 'Luigi', 200], ['peach', 'Peach', 200], ['mike', 'Mike', 200], ['rumi', 'Rumi', 200], ['sparky', 'Sparky', 200],
  ['clawd', 'Clawd', 200], ['gooigi', 'Gooigi', 200], ['ghost_blue', 'Phantom', 200], ['ghost_purple', 'Wraith', 200], ['ghost_orange', 'Ember', 200], ['ghost_red', 'Crimson', 200],
  ['toad', 'Toad', 100], ['toadette', 'Toadette', 100], ['crewmate', 'Crewmate', 100],
].map(([id, name, cost]) => [id, { name, cost }]));
const charOf = (icon) => typeof icon === 'string' && icon.startsWith('c:') && CHARS[icon.slice(2)] ? icon.slice(2) : null;
const isLook = (icon) => BADGES.includes(icon) || !!charOf(icon);
// what goes inside an avatar circle: a character, a shape, or nothing (caller shows the initial)
const lookHtml = (icon) => { const c = charOf(icon); return c ? `<img class="ch" src="chars/${c}.png" alt="">` : icon && ICONS[icon] ? ic(icon) : ''; };
const shopInfo = (k) => ({ ...(ITEM_INFO[k] || {}), ...SHOP[k] });
function giveShop(w, k) { const item = k === 'powerup' ? pick(BASICS.hider) : k; w.inv = w.inv || {}; w.inv[item] = (w.inv[item] || 0) + 1; return item; }
function credit(s, id, pts) { s.wallet = s.wallet || {}; s.wallet[id] = (s.wallet[id] || 0) + pts; const w = s.players[id]; if (w) w.banked = (w.banked || 0) + pts; }
const SUPERS = { hider: ['ghost', 'shield', 'swarm', 'blackout'], seeker: ['xray', 'tracker'] };
const BASICS = { hider: ['decoy', 'jammer', 'sonar'], seeker: ['radar'] };
const STARTER = { hider: { decoy: 1, jammer: 1, sonar: 1 }, seeker: { radar: 1 } };
const GPS_OK = 20, GPS_POOR = 30; // meters: phone accuracy we trust fully / at all
const TREASURE_PTS = 30, WIRE_PASS_M = 15, DUEL_PTS = 25;
const DUEL_GAMES = ['rps', 'tap', 'react', 'memory'];
const DUEL_NAMES = { rps: 'Rock paper scissors', tap: 'Tap race', react: 'Reaction test', memory: 'Memory' };
const MISS_PTS = 10; // a GPS tag that reaches nobody costs the seeker this much
const REACH_M = 20; // how close you have to get to a flag, jail, mission or extraction point
const dropR = () => (S && S.settings.dropM) || 10; // supply drops and treasure: the host picks how small
// game modes the host can mix and match
const MODES = [
  ['infection', 'Infection', 'Caught hiders join the seekers'],
  ['jail', 'Jailbreak', 'Caught hiders go to jail. A free hider reaching it frees them all'],
  ['fugitive', 'Fugitive', 'One runner, everyone else hunts'],
  ['starter', 'Starter power-ups', 'Everyone starts with a few tricks'],
  ['drops', 'Supply drops', 'Super power-ups land on the map. Everyone can see them'],
  ['missions', 'Missions', 'Each hider gets secret spots to reach for points and power-ups'],
  ['capture', 'Capture points', 'Hold a flag for 1 min for +50. You ping while you hold it'],
  ['treasure', 'Treasure drops', 'Chests pop up out in the open. Grab one for +30, but it pings your exact spot to the seekers'],
  ['duel', 'Showdown', 'Two hiders get paired for a quick head-to-head game: rock paper scissors, tap race, reaction or memory. Winner gets +25'],
  ['wire', 'Live Wire', 'One hider holds a live wire and can see the other hiders. Walk near one to pass it. Holding it when the fuse runs out means you go live: seekers see you for the rest of the round'],
  ['potato', 'Hot potato', 'Whoever carries it pings twice as often but scores double'],
  ['sprint', 'Final sprint', 'An extraction point opens near the end. Reach it for +100'],
  ['shrink', 'Shrinking zone', 'The zone closes in over the round'],
  ['strictZone', 'Strict zone', 'Out of the zone for 15 s and you are out'],
];
const puOn = (st) => !!(st && (st.starter || st.drops || st.missions));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const evId = () => 'e' + Math.random().toString(36).slice(2, 9);
const OPTS = {
  hideSec: [[30, '30 s'], [60, '1 min'], [120, '2 min'], [180, '3 min'], [300, '5 min'], [600, '10 min']],
  huntSec: [[300, '5 min'], [600, '10 min'], [900, '15 min'], [1200, '20 min'], [1800, '30 min'], [2700, '45 min'], [3600, '60 min']],
  pingSec: [[30, '30 s'], [60, '1 min'], [120, '2 min'], [180, '3 min'], [300, '5 min'], [600, '10 min']],
  blurM: [[0, 'Exact'], [10, '10 m'], [25, '25 m'], [50, '50 m'], [100, '100 m']],
  tagRadiusM: [[10, '10 m'], [20, '20 m'], [30, '30 m'], [40, '40 m'], [50, '50 m']],
  duelSec: [[60, 'Every 1 min'], [120, 'Every 2 min'], [180, 'Every 3 min'], [300, 'Every 5 min'], [600, 'Every 10 min']],
  wireSec: [[60, '1 min'], [120, '2 min'], [180, '3 min'], [300, '5 min'], [600, '10 min']],
  alarmM: [[0, 'Off'], [20, 'Within 20 m'], [30, 'Within 30 m'], [50, 'Within 50 m'], [75, 'Within 75 m'], [100, 'Within 100 m'], [150, 'Within 150 m'], [200, 'Within 200 m']],
  seekers: [[1, '1'], [2, '2'], [3, '3']],
  dropM: [[5, '5 m'], [10, '10 m'], [15, '15 m'], [20, '20 m'], [30, '30 m']],
  dropSec: [[60, 'Every 1 min'], [120, 'Every 2 min'], [180, 'Every 3 min'], [300, 'Every 5 min'], [600, 'Every 10 min']],
  shrinkStyle: [['smooth', 'Closes in smoothly'], ['steps', 'Jumps in at each ping']],
  shrinkTo: [[0.6, 'Down to 60%'], [0.4, 'Down to 40%'], [0.2, 'Down to 20%']],
  tagMode: [['gps', 'GPS range: hit TAG when close'], ['honor', 'Honor: tag them, they confirm'], ['photo', 'Photo: snap them, they confirm']],
};
const TAG_HINT = {
  gps: (s) => `Get within ${s.tagRadiusM} m of a hider and hit TAG. A tag that reaches nobody costs ${MISS_PTS} points.`,
  honor: () => 'Touch them for real, then hit TAG and pick who. They confirm on their phone.',
  photo: () => 'Snap a clear photo of them. They confirm it is them, or the host decides.',
};
const DEFAULT_SETTINGS = {
  hideSec: 120, huntSec: 1200, pingSec: 300, blurM: 25, tagRadiusM: 20, seekers: 1,
  tagMode: 'gps', infection: true, fugitive: false, jail: false, starter: true, drops: true, dropSec: 180, dropM: 10,
  missions: false, capture: false, potato: false, sprint: false, treasure: false, duel: false, duelSec: 180, wire: false, wireSec: 180,
  shrink: true, shrinkStyle: 'smooth', shrinkTo: 0.4, strictZone: true, graceSec: 15,
  alarmM: 50, // seeker alarm: hiders hear "wanna sprite cranberry?" on repeat when a seeker is this close (0 = off)
};
const ALARM_SEND_MS = 3000, ALARM_STALE_MS = 10000, ALARM_HYST_M = 5;

// ---------------- identity ----------------
function loadMe() {
  let m = null;
  try { m = JSON.parse(localStorage.getItem('gl:me') || 'null'); } catch {}
  if (!m || !m.id) m = { id: 'p' + Math.random().toString(36).slice(2, 10), name: '' };
  if (params.get('pid')) m.id = params.get('pid'); // lets one browser test several players
  return m;
}
function saveMe() { try { localStorage.setItem('gl:me', JSON.stringify({ id: me.id, name: me.name })); } catch {} }
const me = loadMe();
// characters you bought are yours forever: kept on this phone, and on your account when signed in
const cleanOwned = (a) => [...new Set((Array.isArray(a) ? a : []).filter((c) => typeof c === 'string' && CHARS[c]))].slice(0, 64);
const loadLocal = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch { return d; } };
let myOwned = cleanOwned(loadLocal('gl:owned', []));
let myLook = isLook(loadLocal('gl:look', null)) ? loadLocal('gl:look', null) : null;
function keepOwned(list) {
  const n = cleanOwned([...myOwned, ...(list || [])]);
  if (n.length !== myOwned.length) { myOwned = n; try { localStorage.setItem('gl:owned', JSON.stringify(n)); } catch {} }
}
function keepLook(icon) { if (isLook(icon) && icon !== myLook) { myLook = icon; try { localStorage.setItem('gl:look', JSON.stringify(icon)); } catch {} } }

// ---------------- runtime state ----------------
let S = null;            // shared game state (host is the authority)
let acct = null;         // signed-in account: { user, profile } or null for guests
let acctGame = null;     // the game code we joined while signed in (only then do we save points back)
let net = null;
let code = null;
let peers = new Set();
let clockOffset = 0, clockSet = false;
const hostNow = () => Date.now() + clockOffset;
let myPos = null;        // {p:[lat,lng], acc, t}
let geoWatch = null, geoError = null, geoBlocked = false;
let wakeLock = null;
let L_ = {};             // local per-round state
let prevPhase = null, prevRound = 0;
const processed = new Set();
const chat = [];
let chatTab = 'all', chatOpen = false, unread = false;
let sheetCollapsed = false;
let zoneDraft = null;    // host editing
let mapView = false;     // lobby: sheet shrinks to just the zone tools so the map is usable
let replay = null;
let lastStateSent = 0;
let hostMissingSince = 0;

let shopOpen = false, endMore = false, playersOpen = false, rulesOpen = false, moreOpen = false;
function resetLocal() {
  L_ = {
    pings: [],             // {id, p, blur, kind, n, t}
    lastPingN: -1, warnedN: -1,
    decoyArmed: null, jamArmed: false, placingDecoy: false,
    outSince: null, lastBreach: 0,
    sonarUntil: 0, seekerLocs: {}, nearLocs: {}, lastNearSend: 0, peekUntil: 0, trailUntil: 0, trailLocs: {}, wireLocs: {}, duelShown: {}, duelSent: {}, trailSendUntil: 0, spotUntil: 0,
    tracks: {}, myTrack: [],
    tagCooldown: 0, lastShrinkK: 0,
    swarmArmed: false, lastTrack: 0, lastPotN: -1, sentAt: {}, capStart: {}, capPing: {}, dqSent: false, ozSec: -1,
  };
}
resetLocal();

// ---------------- helpers ----------------
const P = (id) => S && S.players[id];
const mine = () => P(me.id);
const isHost = () => !!S && S.hostId === me.id;
const alive = (p) => p && !p.caughtAt && !p.extracted;
const nm = (id) => esc(P(id)?.name || 'Someone');
const colorOf = (id) => P(id)?.color || '#fff';
function fmt(ms) {
  ms = Math.max(0, ms);
  const s = Math.ceil(ms / 1000), m = Math.floor(s / 60), r = s % 60;
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}
function ago(ms) { const s = Math.round(ms / 1000); return s < 60 ? s + 's ago' : Math.round(s / 60) + 'm ago'; }
function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  return Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join('');
}
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// ---------------- feedback: toasts, sound, vibration ----------------
const inGame = () => !!S && (S.phase === 'hiding' || S.phase === 'hunting');
let unreadN = 0, chatSeq = 0;
function pushChat(c) { c.cid = ++chatSeq; chat.push(c); if (chat.length > 300) chat.shift(); }
// during a round every update goes into the chat feed (one line each) instead of popping up
function feed(html, cls = '', icon = null, who = null) {
  pushChat(who ? { ...who, t: Date.now() } : { sys: true, html, cls, icon, t: Date.now() });
  if (!chatOpen) { unreadN++; const n = $('#chat-n'); if (n) { n.textContent = unreadN; n.hidden = false; } }
  const line = who ? `<b>${esc(who.name)}</b>: ${esc(who.text)}` : html;
  L_.lastUp = { html: line, icon: who ? 'chat' : icon, t: Date.now() };
  showLastUp();
  if (chatOpen) renderChat();
}
// quick animations for big moments: a ring burst with the icon (never blocks taps)
function fx(icon, text = '', cls = '') {
  const el = document.createElement('div');
  el.className = 'fx ' + cls;
  el.innerHTML = `<div class="fx-ring"></div><div class="fx-ic">${icon && ICONS[icon] ? ic(icon) : ''}</div>${text ? `<b>${text}</b>` : ''}`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1300);
}
function endHeadline() {
  const r = S.results || {}, survivors = Object.keys(S.players).filter((id) => r[id]?.survived);
  return S.endWhy === 'allCaught' ? 'Seekers win! Everyone got caught.' : survivors.length ? `Hiders win! ${survivors.map(nm).join(', ')} made it.` : S.settings.sprint ? 'Seekers win! Nobody escaped.' : 'Round over';
}
function endSplash() {
  document.querySelector('.endsplash')?.remove();
  const el = document.createElement('div');
  const r = S.results || {}, hidersWon = Object.keys(S.players).some((id) => r[id]?.survived);
  el.className = 'endsplash ' + (hidersWon ? 'hiders' : '');
  el.innerHTML = `<div><small>Round ${S.round}</small><h1>GAME OVER</h1><p>${endHeadline()}</p></div>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}
function showLastUp() {
  const el = $('#last-up'); if (!el) return;
  const u = L_.lastUp, on = !!u && !chatOpen && Date.now() - u.t < 9000;
  el.hidden = !on;
  if (on) el.innerHTML = (u.icon && ICONS[u.icon] ? ic(u.icon) : '') + `<span>${u.html}</span>`;
}
function toast(text, cls = '', icon = null) {
  if (inGame()) { feed(text, cls, icon); return; }
  const el = document.createElement('div');
  el.className = 'toast ' + cls;
  el.innerHTML = (icon ? ic(icon) : '') + `<div>${text}</div>`;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 4200);
  while ($('#toasts').children.length > 2) $('#toasts').firstChild.remove();
}
let actx = null;
// Sound is always on: no mute. Phones only start web audio after a tap, so every tap (and coming
// back to the app) makes sure it's running, and on iPhone it plays even with the silent switch on.
function unlockAudio() {
  try { if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback'; } catch {}
  try {
    if (!actx) { actx = new (window.AudioContext || window.webkitAudioContext)(); actx.onstatechange = () => { if (actx.state !== 'running' && document.visibilityState === 'visible') actx.resume().catch(() => {}); }; }
    if (actx.state !== 'running') actx.resume().catch(() => {});
    if (!L_unlocked) { L_unlocked = true; const b = actx.createBuffer(1, 1, 22050), src = actx.createBufferSource(); src.buffer = b; src.connect(actx.destination); src.start(0); } // iOS needs a sound played inside a tap
  } catch {}
  if (typeof loadAlarm === 'function' && S) loadAlarm();
}
let L_unlocked = false;
function beep(kind) {
  try {
    if (!actx) unlockAudio();
    if (actx.state !== 'running') actx.resume().catch(() => {});
    const seq = { ping: [[880, .08], [1320, .12]], warn: [[660, .1], [660, .1]], caught: [[300, .2], [200, .35]], tag: [[1000, .05], [1500, .08]], alarm: [[900, .15], [600, .15], [900, .15]], start: [[523, .1], [659, .1], [784, .2]] }[kind] || [[700, .1]];
    let t = actx.currentTime;
    for (const [f, d] of seq) {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'square'; o.frequency.value = f;
      g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.001, t + d);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + d + .02); t += d + .04;
    }
  } catch {}
}
const buzz = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch {} };

// Seeker alarm: "wanna sprite cranberry?" loops on a hider's phone while a seeker is in range.
// The closer the seeker, the louder it plays and the shorter the gap between plays.
const alarm = { buf: null, loading: false, src: null, gain: null, nextAt: 0, on: false };
function loadAlarm() {
  if (alarm.buf || alarm.loading || !actx) return;
  alarm.loading = true;
  fetch('audio/sprite-cranberry.m4a').then((r) => r.arrayBuffer())
    .then((b) => new Promise((ok, no) => actx.decodeAudioData(b, ok, no)))
    .then((buf) => { alarm.buf = buf; })
    .catch(() => {})
    .finally(() => { alarm.loading = false; });
}
function stopAlarm() {
  alarm.on = false; alarm.nextAt = 0;
  if (alarm.src) { try { alarm.gain.gain.setTargetAtTime(0, actx.currentTime, 0.05); alarm.src.stop(actx.currentTime + 0.3); } catch {} }
  alarm.src = null; alarm.gain = null;
}
// d: meters to the nearest seeker (Infinity if none), range: the lobby setting
function alarmUpdate(d, range) {
  const inRange = range > 0 && d <= range + (alarm.on ? ALARM_HYST_M : 0);
  if (!inRange) { if (alarm.on) stopAlarm(); return; }
  if (!actx) return;
  if (actx.state === 'suspended') actx.resume().catch(() => {});
  if (!alarm.buf) { loadAlarm(); return; }
  const k = Math.max(0, Math.min(1, 1 - d / range)); // 0 at the edge of the range, 1 right on top of you
  const vol = 0.3 + 0.7 * k;
  if (!alarm.on) { alarm.on = true; buzz([120, 80, 120]); }
  if (alarm.gain) alarm.gain.gain.setTargetAtTime(vol, actx.currentTime, 0.1); // gets louder mid-clip as they close in
  const t = actx.currentTime;
  if (t < alarm.nextAt) return;
  const src = actx.createBufferSource(), g = actx.createGain();
  src.buffer = alarm.buf; g.gain.value = vol;
  src.connect(g).connect(actx.destination);
  src.onended = () => { if (alarm.src === src) { alarm.src = null; alarm.gain = null; } };
  src.start(t);
  alarm.src = src; alarm.gain = g;
  alarm.nextAt = t + alarm.buf.duration + 2.5 * (1 - k); // back to back when they're right there
}

// ---------------- map ----------------
const map = L.map('map', { zoomControl: false, attributionControl: true, worldCopyJump: true, maxZoom: 20 }).setView([39.5, -98.35], 4);
// satellite photo with street names and place labels on top, so players can see buildings, roads and trees
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 20, maxNativeZoom: 19, className: 'map-tiles',
  attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
}).addTo(map);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 20, maxNativeZoom: 19, opacity: .8,
}).addTo(map);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 20, maxNativeZoom: 19,
}).addTo(map);
const layers = {
  zone: L.layerGroup().addTo(map),
  draft: L.layerGroup().addTo(map),
  marks: L.layerGroup().addTo(map),
  replay: L.layerGroup().addTo(map),
};
let meMarker = null, meAcc = null, fittedZone = false;

// ---------------- map rotation ----------------
// The map element is turned with CSS (twist with two fingers, or the compass button). While it's turned
// it is made big enough to cover the screen at any angle, and taps and drags are turned back so
// Leaflet still gets map coordinates.
let mapBear = 0, mapBig = false;
const mapEl = document.getElementById('map');
const unturn = (dx, dy) => { const a = -mapBear * Math.PI / 180, c = Math.cos(a), s_ = Math.sin(a); return [dx * c - dy * s_, dx * s_ + dy * c]; };
const _m2c = L.Map.prototype.mouseEventToContainerPoint;
L.Map.prototype.mouseEventToContainerPoint = function (e) {
  if (!mapBear || this !== map) return _m2c.call(this, e);
  const r = mapEl.getBoundingClientRect(), [x, y] = unturn(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
  return L.point(x + mapEl.offsetWidth / 2, y + mapEl.offsetHeight / 2);
};
function sizeMap(big) {
  if (big === mapBig) return;
  mapBig = big;
  if (big) { const W = innerWidth, H = innerHeight, D = Math.ceil(Math.hypot(W, H)); Object.assign(mapEl.style, { inset: 'auto', width: D + 'px', height: D + 'px', left: (W - D) / 2 + 'px', top: (H - D) / 2 + 'px' }); }
  else Object.assign(mapEl.style, { inset: '', width: '', height: '', left: '', top: '' });
  map.invalidateSize({ pan: true });
}
function setBearing(b, live = false) {
  mapBear = ((Math.round(b) % 360) + 360) % 360; if (mapBear > 180) mapBear -= 360;
  if (Math.abs(mapBear) < 3 && !live) mapBear = 0;
  if (!live) sizeMap(mapBear !== 0);
  mapEl.style.transform = mapBear ? `rotate(${mapBear}deg)` : '';
  document.documentElement.style.setProperty('--bear', mapBear + 'deg');
  document.body.classList.toggle('turned', !!mapBear);
  const n = document.getElementById('north-n'); if (n) n.style.transform = `rotate(${mapBear}deg)`;
}


function zoneLayer(z, style) {
  if (!z) return null;
  return z.type === 'circle' ? L.circle(z.c, { radius: z.r, ...style }) : L.polygon(z.pts, style);
}
function sheetPad() { return window.innerWidth < 720 && !sheet.hidden ? sheet.offsetHeight : 0; }
{ // drags: turn the finger movement back into map directions
  const dr = map.dragging && map.dragging._draggable;
  if (dr) {
    const mv = dr._onMove;
    dr._onMove = function (e) {
      const f = e.touches && e.touches.length === 1 ? e.touches[0] : e, s0 = this._startPoint, sc = this._parentScale;
      if (!mapBear || !s0 || !f || f.clientX == null) return mv.call(this, e);
      const [rx, ry] = unturn(f.clientX - s0.x, f.clientY - s0.y);
      this._startPoint = L.point(f.clientX - rx, f.clientY - ry); this._parentScale = L.point(1, 1);
      try { mv.call(this, e); } finally { this._startPoint = s0; this._parentScale = sc; }
    };
  }
  let tw = null; // two-finger twist turns the map
  const ang = (t) => Math.atan2(t[1].clientY - t[0].clientY, t[1].clientX - t[0].clientX) * 180 / Math.PI;
  mapEl.addEventListener('touchstart', (e) => { if (e.touches.length === 2) tw = { a0: ang(e.touches), b0: mapBear, on: false }; }, { passive: true });
  mapEl.addEventListener('touchmove', (e) => {
    if (!tw || e.touches.length !== 2) return;
    let d = ang(e.touches) - tw.a0; d = ((d + 540) % 360) - 180;
    if (!tw.on && Math.abs(d) < 12) return;
    tw.on = true; setBearing(tw.b0 + d - Math.sign(d) * 12, true);
  }, { passive: true });
  mapEl.addEventListener('touchend', (e) => { if (tw && e.touches.length < 2) { if (tw.on) setBearing(mapBear); tw = null; } }, { passive: true });
  addEventListener('resize', () => { if (mapBig) { mapBig = false; sizeMap(true); } });
}
function fitTo(bounds) {
  if (mapBear && mapBig) { // fit inside a square that stays on screen at any angle
    const W = innerWidth, D = mapEl.offsetWidth, top = 110, bot = sheetPad() + 30;
    const sz = Math.max(80, Math.min(W - 60, innerHeight - top - bot) / Math.SQRT2);
    const [vx, vy] = unturn(0, (top + innerHeight - bot) / 2 - innerHeight / 2), bx = D / 2 + vx, by = D / 2 + vy;
    map.fitBounds(bounds, { paddingTopLeft: [bx - sz / 2, by - sz / 2], paddingBottomRight: [D - bx - sz / 2, D - by - sz / 2], maxZoom: 18 });
    return;
  }
  map.fitBounds(bounds, { paddingTopLeft: [30, 110], paddingBottomRight: [30, sheetPad() + 30], maxZoom: 18 });
}
function fitZone(z) {
  const l = zoneLayer(z, {});
  if (!l) return;
  const tmp = l.addTo(map); const b = tmp.getBounds(); map.removeLayer(tmp);
  requestAnimationFrame(() => fitTo(b));
}
function blipIcon(color, label, sub, cls = '') {
  return L.divIcon({ className: '', iconSize: [16, 16], iconAnchor: [8, 8],
    html: `<div class="blip ${cls}" style="color:${color}"><div class="ring"></div><div class="core"></div><div class="lbl">${label}${sub ? `<small>${sub}</small>` : ''}</div></div>` });
}
function updateMeMarker() {
  if (!myPos) return;
  const role = mine()?.role;
  const col = role === 'hider' ? 'var(--hider)' : 'var(--seeker)';
  const ch = charOf(mine()?.icon);
  // the beam sits inside the map, so it turns along with the map when the map is rotated
  const cone = (sz) => heading === null ? '' : `<div class="me-cone" style="left:${sz / 2 - 40}px;top:${sz / 2 - 40}px;transform:rotate(${Math.round(heading)}deg)"></div>`;
  const icon = ch ? L.divIcon({ className: '', iconSize: [40, 40], iconAnchor: [20, 20], html: `<div class="me-wrap">${cone(40)}<div class="me-ch ${role === 'seeker' ? 'seeker' : ''}" style="border-color:${col}"><img src="chars/${ch}.png" alt=""></div></div>` })
    : L.divIcon({ className: '', iconSize: [22, 22], iconAnchor: [11, 11], html: `<div class="me-wrap">${cone(22)}<div class="me-dot ${role === 'seeker' ? 'seeker' : ''}" style="background:${col}"></div></div>` });
  if (meMarker && replay) { map.removeLayer(meMarker); map.removeLayer(meAcc); meMarker = null; meAcc = null; }
  if (replay) return;
  if (!meMarker) {
    meMarker = L.marker(myPos.p, { icon, zIndexOffset: 1000, interactive: false }).addTo(map);
    meAcc = L.circle(myPos.p, { radius: myPos.acc, color: '#111', weight: 1, opacity: .25, fillOpacity: .04, interactive: false }).addTo(map);
  } else { meMarker.setLatLng(myPos.p); meMarker.setIcon(icon); meAcc.setLatLng(myPos.p); meAcc.setRadius(myPos.acc); }
}

// ---------------- compass: which way my phone is facing ----------------
let heading = null, headingOn = false, headingAsked = false, headingDrawn = null;
function onOrient(e) {
  let h = null;
  if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading; // iPhone: degrees from north
  else if (e.absolute && typeof e.alpha === 'number') h = 360 - e.alpha; // Android: alpha counts the other way
  if (h === null || Number.isNaN(h)) return;
  const ang = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
  heading = (h + ang + 360) % 360;
  // only redraw when it turns a few degrees, to save battery
  if (headingDrawn === null || Math.abs(((heading - headingDrawn + 540) % 360) - 180) > 4) { headingDrawn = heading; updateMeMarker(); }
}
function startHeading() {
  if (headingOn) return;
  const go = () => {
    headingOn = true;
    if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', onOrient);
    else window.addEventListener('deviceorientation', onOrient);
  };
  const D = window.DeviceOrientationEvent;
  if (!D) return;
  if (typeof D.requestPermission === 'function') { // iPhone asks once, and only from a tap
    if (headingAsked) return;
    headingAsked = true;
    D.requestPermission().then((r) => { if (r === 'granted') go(); }).catch(() => { headingAsked = false; });
  } else go();
}
document.addEventListener('click', () => { if (S) startHeading(); }, { passive: true });

// ---------------- zone over time ----------------
function huntMs() { return S.settings.huntSec * 1000; }
function pingMs() { return S.settings.pingSec * 1000; }
function nextPingAt(s, now) { const ms = s.settings.pingSec * 1000; return s.huntStart + (Math.floor((now - s.huntStart) / ms) + 1) * ms; } // when the next regular ping goes out
function shrinkStep(t) {
  if (!S || S.phase !== 'hunting' || !S.settings.shrink) return 0;
  const K = Math.max(1, Math.floor(huntMs() / pingMs()));
  return Math.max(0, Math.min(K, Math.floor((t - S.huntStart) / pingMs())));
}
function zoneScale(k) {
  const K = Math.max(1, Math.floor(huntMs() / pingMs()));
  return 1 - (1 - S.settings.shrinkTo) * Math.min(1, k / K);
}
function smoothShrink() { return S.settings.shrinkStyle !== 'steps'; }
function scaleAt(t) {
  if (!S || !S.settings.shrink || S.phase !== 'hunting') return 1;
  if (!smoothShrink()) return zoneScale(shrinkStep(t));
  const f = Math.max(0, Math.min(1, (t - S.huntStart) / huntMs()));
  return 1 - (1 - S.settings.shrinkTo) * f;
}
function currentZone(t = hostNow()) {
  if (!S || !S.zone) return null;
  return S.settings.shrink && S.phase === 'hunting' ? G.scaleZone(S.zone, scaleAt(t)) : S.zone;
}
function finalZone() { return S.settings.shrink ? G.scaleZone(S.zone, S.settings.shrinkTo) : S.zone; }
function nextZone(t = hostNow()) {
  if (!S || !S.zone || !S.settings.shrink || S.phase !== 'hunting') return null;
  if (smoothShrink()) return finalZone();
  const K = Math.max(1, Math.floor(huntMs() / pingMs()));
  const k = shrinkStep(t);
  if (k >= K) return null;
  return G.scaleZone(S.zone, zoneScale(k + 1));
}

// ---------------- networking ----------------
function send(t, d = {}) {
  const m = { t, from: me.id, d, ts: Date.now() };
  if (net) net.send(m);
  queueMicrotask(() => handle(m, true)); // everyone also handles their own message
}
function broadcastState() {
  if (!isHost()) return;
  lastStateSent = Date.now();
  net && net.send({ t: 'state', from: me.id, d: { S, now: Date.now() }, ts: Date.now() });
}
function hostApply(fn) {
  if (!isHost()) return;
  fn(S);
  S.v++;
  broadcastState();
  onState(true);
}
function newer(a, b) { // is a newer than b
  if (!b) return true;
  if (a.code !== b.code) return true;
  return a.epoch > b.epoch || (a.epoch === b.epoch && a.v > b.v);
}

async function connect(roomCode, asHost) {
  code = roomCode;
  acctGame = acct ? roomCode : null;
  if (net) { try { net.close(); } catch {} }
  setHomeBusy(true);
  try {
    net = await createNet(code, me);
  } catch (e) {
    setHomeBusy(false);
    showHomeErr(e.message || 'Could not connect. Check your signal and try again.');
    return false;
  }
  net.onMessage((m) => handle(m, false));
  net.onPeers((s) => { peers = s; onPeers(); });
  peers.add(me.id);
  history.replaceState(null, '', location.pathname + '?room=' + code + (DEBUG ? '&debug' : '') + (params.get('pid') ? '&pid=' + params.get('pid') : '') + (params.get('net') ? '&net=' + params.get('net') : ''));
  if (asHost) {
    S = {
      code, v: 1, epoch: 1, hostId: me.id, phase: 'lobby', round: 0,
      settings: { ...DEFAULT_SETTINGS }, zone: null,
      players: {}, events: [], kicked: [], results: null, totals: {}, wallet: {},
      roundStart: 0, huntStart: 0, huntEnd: 0, endedAt: 0,
    };
    addPlayer(S, me.id, me.name, acctHello());
    clockOffset = 0; clockSet = true;
    broadcastState();
    onState(true);
  } else {
    S = null;
  }
  setHomeBusy(false);
  enterGameUI();
  startGeo();
  // keep saying hello until the host lists us
  const helloLoop = () => {
    if (!net || code !== roomCode) return;
    if (!S || !S.players[me.id]) { send('hello', { name: me.name, ...acctHello() }); setTimeout(helloLoop, 2500); }
  };
  helloLoop();
  if (!asHost) setTimeout(() => { if (!S && code === roomCode) banner(`Waiting for game ${esc(code)}… Is the host's app open?`, 'warn'); }, 7000);
  return true;
}

function addPlayer(st, id, name, acc) {
  // signed-in players bring their saved points and badge into a new game
  if (acc && Number.isFinite(+acc.pts) && (st.wallet || {})[id] === undefined) { st.wallet = st.wallet || {}; st.wallet[id] = Math.max(0, Math.min(1e6, Math.floor(+acc.pts))); }
  const owned = cleanOwned(acc && acc.owned);
  let savedIcon = acc && isLook(acc.icon) ? acc.icon : null;
  if (charOf(savedIcon) && !owned.includes(charOf(savedIcon))) { if (acc.pts !== undefined) owned.push(charOf(savedIcon)); else savedIcon = null; } // accounts saved before owned lists existed
  const used = new Set(Object.values(st.players).map((p) => p.color));
  const color = COLORS.find((c) => !used.has(c)) || COLORS[Object.keys(st.players).length % COLORS.length];
  const late = st.phase === 'hiding' || st.phase === 'hunting';
  st.players[id] = {
    name: (name || 'Player').slice(0, 16), color, joinedAt: Date.now(),
    role: late ? 'seeker' : 'hider', startRole: late ? 'seeker' : null,
    caughtAt: null, caughtBy: null, used: {}, seekerCount: 0,
  };
  if (owned.length) st.players[id].owned = owned;
  if (savedIcon && !st.players[id].icon) st.players[id].icon = savedIcon;
  st.totals[id] = st.totals[id] || 0;
}

function handle(m, self) {
  if (!m || !m.t) return;
  const d = m.d || {};
  switch (m.t) {
    case 'state': {
      if (self) return;
      const ns = d.S;
      if (!ns || ns.code !== code) return;
      if (!newer(ns, S)) return;
      // clock sync from the host
      const off = d.now - Date.now();
      if (!clockSet || Math.abs(off - clockOffset) > 1500) clockOffset = off; else clockOffset = clockOffset * 0.8 + off * 0.2;
      clockSet = true;
      const first = !S;
      S = ns;
      if (first) S.events.forEach((e) => processed.add(e.id)); // don't replay old news on join
      onState(false);
      break;
    }
    case 'loc': { // who has shared their location (shown in the lobby)
      const was = locOk[m.from]?.ok;
      locOk[m.from] = { ok: !!d.ok, t: Date.now() };
      if (was !== !!d.ok && S && S.phase === 'lobby' && !chatOpen && !mapView) renderSheet();
      break;
    }
    case 'hello': {
      if (!isHost()) return;
      if (S.kicked.includes(m.from)) return;
      if (S.players[m.from]) {
        if (d.name && S.players[m.from].name !== d.name) hostApply((s) => { s.players[m.from].name = d.name.slice(0, 16); });
        else broadcastState();
      } else hostApply((s) => addPlayer(s, m.from, d.name, d));
      break;
    }
    case 'ping': {
      if (!S || S.phase === 'lobby') return;
      if (L_.pings.some((x) => x.id === m.from && x.n === d.n && x.kind === d.kind && d.kind !== 'breach')) return;
      const okPt = (q) => Array.isArray(q) && q.length === 2 && q.every(Number.isFinite);
      const alts = Array.isArray(d.alts) ? d.alts.filter(okPt).slice(0, 3) : null;
      L_.pings.push({ id: m.from, p: okPt(d.p) ? d.p : null, alts, blur: Math.min(+d.blur || 0, 200), kind: d.kind, n: d.n, t: hostNow() });
      if (!self && d.kind === 'away') { // everyone hears about it, seekers get the spot
        toast(`<b>${nm(m.from)}</b> turned off their screen.${mine()?.role === 'seeker' && okPt(d.p) ? ' Exact spot showing.' : ''}`, 'seeker', 'alert');
        if (mine()?.role === 'seeker') { beep('alarm'); buzz([80, 60, 80]); }
      } else if (!self && mine()?.role === 'seeker') {
        if (d.kind === 'breach') { toast(`<b>${nm(m.from)}</b> left the zone. Exact spot shown.`, 'seeker', 'alert'); beep('alarm'); buzz([80, 60, 80]); }
        else if (d.kind === 'jam') { toast(`<b>${nm(m.from)}</b> jammed their signal`, 'seeker', 'jammer'); }
        else if (d.kind === 'blackout') { /* nothing to show */ }
        else if (d.kind === 'ghost') { toast(`<b>${nm(m.from)}</b> is a ghost. No signal.`, 'seeker', 'ghost'); }
        else if (d.kind === 'capture') { beep('ping'); toast(`<b>${nm(m.from)}</b> is capturing a flag`, 'seeker', 'capture'); }
        else if (d.kind === 'nosignal') { toast(`<b>${nm(m.from)}</b> has no GPS fix`, '', 'pin'); }
        else { beep('ping'); buzz(60); }
      }
      renderMarks();
      break;
    }
    case 'tag': {
      // host: remember the tag; if no hider answers that it landed (or nearly did), it was a miss
      if (isHost() && S && S.phase === 'hunting' && S.players[m.from] && S.players[m.from].role === 'seeker') hostTags.push({ by: m.from, t: Date.now(), hit: false });
      // a seeker hit TAG: my own phone decides if I was in range
      if (self || !S || S.phase !== 'hunting') return;
      const p = mine();
      if (!p || p.role !== 'hider' || !alive(p) || !myPos) return;
      // both phones' GPS error counts: a good pair gets a few meters of slack, a weak fix only counts when clearly in range
      const a = myPos.acc || 0, b = +d.acc || 0, u = Math.hypot(a, b), R = S.settings.tagRadiusM;
      const weak = Math.max(a, b) > GPS_POOR;
      const dd = G.dist(myPos.p, d.p);
      if ((!weak && dd <= R + Math.min(5, u / 4)) || dd <= R / 2) {
        send('caught', { who: me.id, by: m.from, how: 'tag', p: myPos.p });
      } else if (weak && dd <= R + u) {
        send('tagWeak', { to: m.from, acc: Math.round(Math.max(a, b)) });
        toast(`<b>${nm(m.from)}</b> almost tagged you (weak GPS).`, 'seeker', 'alert');
        buzz([40, 40, 40]);
      } else if (dd <= 60) {
        toast(`<b>${nm(m.from)}</b> tried a tag ${G.fmtDist(dd)} from you.`, 'seeker', 'alert');
        buzz([40, 40, 40]);
      }
      break;
    }
    case 'tagWeak': {
      if (isHost()) markTagHit(d.to);
      if (d.to !== me.id || !S || S.phase !== 'hunting') return;
      toast(`Too close to call (weak GPS). Get closer and tag again.`, 'seeker', 'alert');
      break;
    }
    case 'caught': {
      if (!isHost() || S.phase !== 'hunting') return;
      if (d.how === 'tag' && m.from === d.who) markTagHit(d.by);
      if (m.from === d.who) for (const q of Object.values(hostPending)) if (q.target === d.who) q.status = 'done'; // the hider answered: nothing left to rule on
      const who = S.players[d.who];
      if (!who || who.role !== 'hider' || who.caughtAt || who.extracted) return;
      if (m.from !== d.who && m.from !== S.hostId) return; // only the hider (or the host) can confirm a catch
      const by = d.how !== 'zone' && d.by && S.players[d.by] && S.players[d.by].role === 'seeker' ? d.by : null;
      hostApply((s) => {
        const w = s.players[d.who], now = Date.now();
        if (d.how !== 'zone' && w.fx && w.fx.shield) { // a shield eats one tag
          w.fx.shield = 0;
          s.events.push({ id: evId(), k: 'shieldHit', who: d.who, by, t: now });
          return;
        }
        if (d.how !== 'zone' && w.inv && w.inv.pass) { // escape pass: shake them off once
          w.inv.pass--; if (!w.inv.pass) delete w.inv.pass;
          s.events.push({ id: evId(), k: 'passHit', who: d.who, by, t: now });
          return;
        }
        w.caughtAt = now; w.caughtBy = by;
        const hadItems = Object.values(w.inv || {}).some((n) => n > 0);
        w.inv = {}; w.fx = {};
        if (s.potato && s.potato.holder === d.who) { potatoHand(s, now); s.potato.holder = null; s.potato.p = Array.isArray(d.p) ? d.p : randomSpotIn(currentZone(now) || s.zone); }
        if (s.settings.infection) w.role = 'seeker';
        let reward = null;
        if (by && puOn(s.settings)) { // every catch pays the seeker; catching someone still holding power-ups pays a super one
          reward = hadItems ? pick(SUPERS.seeker) : 'radar';
          const b = s.players[by]; b.inv = b.inv || {}; b.inv[reward] = (b.inv[reward] || 0) + 1;
        }
        if (by && s.players[by]) credit(s, by, 50); // catch points can be spent right away
        s.events.push({ id: evId(), k: 'catch', who: d.who, by, how: d.how, p: d.p || null, reward, t: now });
        checkEnd(s);
      });
      break;
    }
    case 'useItem': {
      if (!isHost() || S.phase !== 'hunting') return;
      const p = S.players[m.from], item = d.item;
      if (!p || !ITEM_INFO[item] || item === 'pass') return;
      const needs = ITEM_INFO[item].role;
      if (p.role !== needs || (needs === 'hider' && !alive(p))) return;
      if (!p.inv || (p.inv[item] || 0) < 1) return;
      if (needs === 'hider' && Date.now() < (S.lockdownUntil || 0)) return;
      const tgt = S.players[d.target];
      if (item === 'spotlight' && !(tgt && tgt.role === 'hider' && alive(tgt))) return;
      hostApply((s) => {
        const q = s.players[m.from], now = Date.now();
        q.inv[item]--; if (!q.inv[item]) delete q.inv[item];
        q.fx = q.fx || {};
        if (item === 'ghost') { const ms = s.settings.pingSec * 1000, n = Math.floor((now - s.huntStart) / ms) + 1; q.fx.ghostUntil = s.huntStart + (n + 1) * ms + 1500; }
        if (item === 'shield') q.fx.shield = 1;
        if (item === 'blackout') s.blackoutUntil = nextPingAt(s, now) + 1500;
        if (item === 'tracker') s.trackerUntil = now + 60000;
        if (item === 'cloak') q.fx.ghostUntil = Math.max(q.fx.ghostUntil || 0, nextPingAt(s, now) + 1500);
        if (item === 'lockdown') s.lockdownUntil = now + 30000;
        if (['radar', 'sonar', 'blackout', 'xray', 'tracker', 'ghost', 'shield', 'cloak', 'peek', 'trail', 'lockdown'].includes(item)) s.events.push({ id: evId(), k: item, by: m.from, t: now });
        if (item === 'spotlight') s.events.push({ id: evId(), k: 'spotlight', by: m.from, target: d.target, t: now });
      });
      break;
    }
    case 'claim': case 'mission': case 'flag': case 'treasure': case 'potato': case 'potatoDrop': case 'breakout': case 'extract': {
      if (!isHost() || S.phase !== 'hunting') return;
      const q = S.players[m.from];
      if (!q || !Array.isArray(d.p) || !d.p.every(Number.isFinite)) return;
      const ok = (pt, r = REACH_M) => pt && G.dist(d.p, pt) <= r + Math.min(10, (+d.acc || 0) / 2);
      const now = Date.now();
      if (m.t === 'claim') {
        const dr = (S.drops || []).find((x) => x.id === d.id && !x.claimedBy);
        if (!dr || !ok(dr.p, dropR()) || !(q.role === 'seeker' || alive(q))) return;
        hostApply((s) => {
          const x = s.drops.find((y) => y.id === d.id);
          if (!x || x.claimedBy) return;
          const w = s.players[m.from], item = pick(SUPERS[w.role]);
          x.claimedBy = m.from; x.item = item;
          w.inv = w.inv || {}; w.inv[item] = (w.inv[item] || 0) + 1;
          s.events.push({ id: evId(), k: 'claim', who: m.from, item, t: now });
        });
        return;
      }
      if (q.role !== 'hider') return;
      if (m.t === 'breakout') {
        if (!S.jail || !alive(q) || !ok(S.jail.p) || now < (S.jailCooldownUntil || 0)) return;
        const jailed = Object.entries(S.players).filter(([, x]) => x.role === 'hider' && x.caughtAt && !x.extracted).map(([id]) => id);
        if (!jailed.length) return;
        hostApply((s) => {
          for (const id of jailed) { s.players[id].caughtAt = null; s.players[id].caughtBy = null; }
          s.jailCooldownUntil = now + 60000;
          s.events.push({ id: evId(), k: 'breakout', by: m.from, freed: jailed, t: now });
        });
        return;
      }
      if (!alive(q)) return;
      if (m.t === 'mission') {
        // once per mission: the id must match, the player must have moved since the last one, and not too soon after it
        if (!q.mission || q.mission.id !== d.id || !ok(q.mission.p)) return;
        if (q.mission.from && G.dist(d.p, q.mission.from) < 40) return;
        if (now - (q.missionAt || 0) < 20000) return;
        hostApply((s) => {
          const w = s.players[m.from];
          if (!w.mission || w.mission.id !== d.id) return;
          w.missionAt = now;
          w.bonus = (w.bonus || 0) + 25; w.missionsDone = (w.missionsDone || 0) + 1; credit(s, m.from, 25);
          const item = puOn(s.settings) ? pick(BASICS.hider) : null;
          if (item) { w.inv = w.inv || {}; w.inv[item] = (w.inv[item] || 0) + 1; }
          w.mission = { id: 'm' + Math.random().toString(36).slice(2, 7), p: randomSpotIn(finalZone(), d.p, 80), from: d.p };
          s.events.push({ id: evId(), k: 'mission', who: m.from, item, t: now });
        });
      }
      if (m.t === 'flag') {
        const f = (S.flags || []).find((x) => x.id === d.id && !x.by);
        if (!f || !ok(f.p) || !(d.held >= 55000)) return;
        hostApply((s) => {
          const x = s.flags.find((y) => y.id === d.id); if (!x || x.by) return;
          x.by = m.from; const w = s.players[m.from]; w.bonus = (w.bonus || 0) + 50; w.flags = (w.flags || 0) + 1; credit(s, m.from, 50);
          s.events.push({ id: evId(), k: 'flag', who: m.from, t: now });
        });
      }
      if (m.t === 'treasure') {
        if (!S.treasure || S.treasure.id !== d.id || q.role !== 'hider' || !alive(q) || !ok(S.treasure.p, dropR())) return;
        hostApply((s) => { const w = s.players[m.from]; w.bonus = (w.bonus || 0) + TREASURE_PTS; credit(s, m.from, TREASURE_PTS); s.events.push({ id: evId(), k: 'treasureGot', who: m.from, p: s.treasure.p, t: now }); s.treasure = null; s.nextTreasureAt = now + 90000; });
      }
      if (m.t === 'potato') {
        if (!S.potato || S.potato.holder || !ok(S.potato.p)) return;
        hostApply((s) => { s.potato.holder = m.from; s.potato.since = now; s.events.push({ id: evId(), k: 'potato', who: m.from, t: now }); });
      }
      if (m.t === 'potatoDrop') {
        if (!S.potato || S.potato.holder !== m.from) return;
        hostApply((s) => { potatoHand(s, now); s.potato.holder = null; s.potato.p = G.randomInDisk(d.p, 15); s.events.push({ id: evId(), k: 'potatoDrop', who: m.from, t: now }); });
      }
      if (m.t === 'extract') {
        if (!S.sprint || !S.sprint.p || !ok(S.sprint.p)) return;
        hostApply((s) => {
          const w = s.players[m.from]; w.extracted = now;
          if (s.potato && s.potato.holder === m.from) { potatoHand(s, now); s.potato.holder = null; s.potato.p = s.sprint.p; }
          s.events.push({ id: evId(), k: 'extracted', who: m.from, t: now });
          checkEnd(s);
        });
      }
      return;
    }
    case 'tagReq':
    case 'photoTag': {
      if (!S || S.phase !== 'hunting') return;
      const by = m.from, sk = P(by), tg = P(d.target);
      if (!sk || sk.role !== 'seeker' || !tg || tg.role !== 'hider' || tg.caughtAt) return;
      const img = m.t === 'photoTag' ? (validImg(d.img) ? d.img : null) : null;
      if (m.t === 'photoTag' && !img) return;
      if (isHost()) hostPending[d.reqId] = { by, target: d.target, img, t: Date.now(), status: 'open' };
      if (d.target === me.id) {
        incoming[d.reqId] = { by, kind: m.t === 'photoTag' ? 'photo' : 'honor', img };
        beep('alarm'); buzz([200, 100, 200]);
        if ($('#modal').hidden) nextIncoming();
      }
      break;
    }
    case 'tagDenied': {
      if (!S) return;
      if (d.by === me.id) toast(`<b>${nm(m.from)}</b> says your tag missed.${isHost() ? '' : ' The host can overrule.'}`, 'seeker', 'close');
      if (isHost() && hostPending[d.reqId] && m.from === hostPending[d.reqId].target) {
        hostPending[d.reqId].status = 'disputed'; hostPending[d.reqId].why = 'denied';
        if ($('#modal').hidden) nextHostRuling();
      }
      break;
    }
    case 'ruling': {
      if (!S || m.from !== S.hostId) return;
      if (d.by === me.id && !d.counted) toast(`Host ruled: no catch on <b>${nm(d.target)}</b>.`, 'seeker', 'close');
      break;
    }
    case 'buy': {
      if (!isHost() || !S) return;
      const q = S.players[m.from], now = Date.now();
      if (!q) return;
      const inRound = S.phase === 'hiding' || S.phase === 'hunting';
      let cost;
      if (d.k === 'char') { const c = CHARS[d.opt]; if (!c || q.icon === 'c:' + d.opt) return; cost = (q.owned || []).includes(d.opt) ? 0 : c.cost; }
      else if (d.k === 'color') { if (!COLORS.includes(d.opt) || Object.values(S.players).some((x) => x.color === d.opt)) return; cost = SHOP.color.cost; }
      else if (d.k === 'icon') { if (!BADGES.includes(d.opt) || q.icon === d.opt) return; cost = SHOP.icon.cost; }
      else { const it = SHOP[d.k]; if (!it) return; cost = it.cost; if (inRound && (it.role !== q.role || (q.role === 'hider' && !alive(q)))) return; }
      if (((S.wallet || {})[m.from] || 0) < cost) return;
      hostApply((s) => {
        s.wallet = s.wallet || {}; s.wallet[m.from] -= cost;
        const w = s.players[m.from];
        let got = d.k, saved = false;
        if (d.k === 'icon') w.icon = d.opt;
        else if (d.k === 'char') { w.icon = 'c:' + d.opt; w.owned = [...new Set([...(w.owned || []), d.opt])]; got = 'char'; }
        else if (d.k === 'color') { w.color = d.opt; w.tinted = true; }
        else if (inRound) got = giveShop(w, d.k);
        else { w.bank = w.bank || {}; w.bank[d.k] = (w.bank[d.k] || 0) + 1; saved = true; }
        s.events.push({ id: evId(), k: 'buy', who: m.from, item: got, opt: d.opt, saved, t: now });
      });
      break;
    }
    case 'wirePass': {
      if (!isHost() || !S || S.phase !== 'hunting' || !S.wire || S.wire.holder !== m.from) return;
      const t = S.players[d.to];
      if (!t || t.role !== 'hider' || t.caughtAt || t.extracted || d.to === m.from) return;
      hostApply((s) => { s.wire.from = m.from; s.wire.holder = d.to; s.wire.at = Date.now(); s.events.push({ id: evId(), k: 'wirePass', from: m.from, to: d.to, t: Date.now() }); });
      break;
    }
    case 'duelRes': {
      if (!isHost() || !S || !S.duel || d.id !== S.duel.id || d.tie !== S.duel.tie || (m.from !== S.duel.a && m.from !== S.duel.b) || S.duel.res[m.from] != null) return;
      const g = S.duel.game;
      const v = g === 'rps' ? (['rock', 'paper', 'scissors'].includes(d.v) ? d.v : null) : Number.isFinite(+d.v) ? Math.max(0, Math.min(g === 'tap' ? 150 : 9999999, Math.round(+d.v))) : null;
      if (v === null) return;
      hostApply((s) => { s.duel.res[m.from] = v; });
      break;
    }
    case 'hiderLoc': {
      if (d.wire) { if (S && S.wire && S.wire.holder === me.id && Array.isArray(d.p) && d.p.every(Number.isFinite)) L_.wireLocs[m.from] = { p: d.p, t: hostNow() }; break; }
      if (hostNow() < (L_.trailUntil || 0) && Array.isArray(d.p)) { L_.trailLocs[m.from] = { p: d.p, t: hostNow() }; updateTrail(); }
      break;
    }
    case 'seekerLoc': {
      L_.seekerLocs[m.from] = { p: d.p, t: hostNow() };
      renderMarks();
      break;
    }
    case 'away': { // a seeker turned off their screen mid-hunt
      if (!self && S && S.phase === 'hunting') toast(`<b>${nm(m.from)}</b> turned off their screen.`, '', 'alert');
      break;
    }
    case 'seekerNear': { // for the seeker alarm only: never drawn on the map
      if (Array.isArray(d.p) && d.p.length === 2 && d.p.every(Number.isFinite)) L_.nearLocs[m.from] = { p: d.p, t: hostNow() };
      break;
    }
    case 'chat': {
      if (!S) return;
      const text = String(d.text || '').slice(0, 200);
      if (!text) return;
      const sender = P(m.from);
      if (d.team !== 'all' && mine() && d.team !== mine().role && !self) return;
      const entry = { from: m.from, name: sender?.name || 'Someone', role: S.phase === 'lobby' ? '' : sender?.role || '', text, team: d.team };
      if (inGame()) { if (self) { pushChat({ ...entry, t: Date.now() }); if (chatOpen) renderChat(); } else feed('', '', null, entry); break; }
      pushChat({ ...entry, t: Date.now() });
      if (!chatOpen && !self) { unread = true; $('#chat-dot').hidden = false; toast(`<b>${esc(sender?.name)}</b>: ${esc(text)}`, sender?.role === 'seeker' ? 'seeker' : 'hider'); }
      if (chatOpen) renderChat();
      break;
    }
    case 'track': {
      if (!Array.isArray(d.pts)) return;
      L_.tracks[m.from] = d.pts.slice(0, 1500);
      if (replay) renderReplay();
      break;
    }
    case 'endRound': {
      if (!isHost() || m.from !== me.id) return;
      break;
    }
  }
}

function onPeers() {
  if (S) {
    const hostHere = peers.has(S.hostId);
    if (!hostHere) {
      if (!hostMissingSince) hostMissingSince = Date.now();
    } else hostMissingSince = 0;
  }
  renderSheet();
}

function maybeTakeOverHost() {
  if (!S || !hostMissingSince || Date.now() - hostMissingSince < 8000) return;
  // the longest-standing player who is still here becomes host
  const cands = Object.entries(S.players).filter(([id]) => peers.has(id)).sort((a, b) => a[1].joinedAt - b[1].joinedAt);
  if (cands[0] && cands[0][0] === me.id) {
    const oldHost = S.hostId;
    S.hostId = me.id; S.epoch++; S.v = 1;
    // translate times so they stay meaningful on this device's clock
    const shift = -clockOffset;
    for (const k of ['roundStart', 'huntStart', 'huntEnd', 'endedAt']) if (S[k]) S[k] += shift;
    Object.values(S.players).forEach((p) => { if (p.caughtAt) p.caughtAt += shift; });
    S.events.forEach((e) => { e.t += shift; });
    clockOffset = 0;
    hostMissingSince = 0;
    toast(`You're the host now (${esc(S.players[oldHost]?.name || 'host')} dropped).`, 'good', 'crown');
    broadcastState();
    onState(true);
  }
}

// ---------------- host game flow ----------------
function startRound() {
  hostApply((s) => {
    const ids = Object.keys(s.players).filter((id) => peers.has(id));
    const n = s.settings.fugitive ? Math.max(1, ids.length - 1) : Math.max(1, Math.min(s.settings.seekers, ids.length - 1));
    // favour people who have sought the least
    const order = s.settings.fugitive
      ? shuffle(ids.slice()).sort((a, b) => (s.players[b].runnerCount || 0) - (s.players[a].runnerCount || 0)) // the runner is last: whoever ran least
      : shuffle(ids.slice()).sort((a, b) => (s.players[a].seekerCount || 0) - (s.players[b].seekerCount || 0));
    const seekers = new Set(order.slice(0, n));
    for (const [id, p] of Object.entries(s.players)) {
      p.role = seekers.has(id) ? 'seeker' : 'hider';
      p.startRole = p.role;
      if (seekers.has(id)) p.seekerCount = (p.seekerCount || 0) + 1; else if (s.settings.fugitive) p.runnerCount = (p.runnerCount || 0) + 1;
      p.caughtAt = null; p.caughtBy = null; p.fx = {}; p.bonus = 0; p.potatoMs = 0; p.live = false; p.extracted = null; p.mission = null; p.flags = 0; p.missionsDone = 0;
      p.inv = s.settings.starter ? { ...STARTER[p.role] } : {};
      p.banked = 0;
      for (const [k, n] of Object.entries(p.bank || {})) { // shop items saved for a round with this role
        if (!SHOP[k] || SHOP[k].role !== p.role) continue;
        for (let i = 0; i < n; i++) giveShop(p, k);
        delete p.bank[k];
      }
    }
    s.wallet = s.wallet || {}; s.lockdownUntil = 0;
    s.drops = []; s.flags = []; s.jail = null; s.potato = null; s.sprint = null; s.treasure = null; s.wire = null; s.duel = null; s.nextDuelAt = Infinity; s.nextTreasureAt = Infinity; s.nextWireAt = Infinity; s.blackoutUntil = 0; s.trackerUntil = 0; s.jailCooldownUntil = 0;
    const now = Date.now();
    s.round++; s.phase = 'hiding';
    s.roundStart = now; s.huntStart = now + s.settings.hideSec * 1000; s.huntEnd = s.huntStart + s.settings.huntSec * 1000;
    s.nextDropAt = s.huntStart + Math.min(s.settings.dropSec * 1000, s.settings.huntSec * 400);
    s.events = [{ id: 'e' + Math.random().toString(36).slice(2, 9), k: 'start', t: now }];
    s.results = null; s.endedAt = 0;
  });
}
function randomSpotIn(z, avoid = null, minD = 0) {
  const inner = G.scaleZone(z, 0.85);
  const c = G.zoneCenter(inner);
  const R = inner.type === 'circle' ? inner.r : Math.max(...inner.pts.map((q) => G.dist(c, q)));
  let best = c, bestD = avoid ? G.dist(c, avoid) : 0;
  for (let i = 0; i < 300; i++) {
    const pt = G.randomInDisk(c, R);
    if (!G.inZone(pt, inner)) continue;
    if (!avoid || G.dist(pt, avoid) >= minD) return pt;
    const dd = G.dist(pt, avoid); if (dd > bestD) { best = pt; bestD = dd; } // small zone: as far away as it can be
  }
  return best;
}
function setupModes(s) {
  const fz = finalZone();
  const hiders = Object.entries(s.players).filter(([, p]) => p.role === 'hider');
  if (s.settings.jail && !s.settings.infection) s.jail = { p: randomSpotIn(fz) };
  if (s.settings.missions) for (const [, p] of hiders) p.mission = { id: 'm' + Math.random().toString(36).slice(2, 7), p: randomSpotIn(fz) };
  if (s.settings.capture) s.flags = [0, 1].map((i) => ({ id: 'f' + i, p: randomSpotIn(fz, i ? s.flags?.[0]?.p : null, 60), by: null }));
  if (s.settings.capture && s.flags[1] && s.flags[0] && G.dist(s.flags[0].p, s.flags[1].p) < 60) s.flags[1].p = randomSpotIn(fz, s.flags[0].p, 60);
  if (s.settings.potato) s.potato = { p: randomSpotIn(fz), holder: null, since: 0 };
  const t0 = Date.now();
  if (s.settings.treasure) s.nextTreasureAt = t0 + 60000;
  if (s.settings.wire) armWire(s, t0);
  if (s.settings.duel) s.nextDuelAt = t0 + Math.min(60, s.settings.duelSec || 180) * 1000;
  if (s.settings.sprint) s.sprint = { at: s.huntEnd - Math.max(60, Math.min(300, s.settings.huntSec * 0.2)) * 1000, p: null };
}
function spawnDrop(s) {
  const now = Date.now();
  s.drops = (s.drops || []).filter((x) => x.claimedBy || now - x.t < 2 * s.settings.dropSec * 1000); // unreachable drops expire
  if (s.drops.some((x) => !x.claimedBy)) { s.nextDropAt = now + 5000; return; } // only one drop on the map at a time
  if (now > s.huntEnd - 30000) { s.nextDropAt = Infinity; return; }
  const x = { id: 'd' + Math.random().toString(36).slice(2, 8), p: randomSpotIn(nextZone(now) || currentZone(now) || s.zone), t: now };
  s.drops.push(x);
  s.nextDropAt = now + s.settings.dropSec * 1000;
  s.events.push({ id: evId(), k: 'drop', drop: x.id, t: now });
}
function potatoHand(s, now) { // stop the clock on whoever holds the potato
  const pt = s.potato;
  if (pt && pt.holder && s.players[pt.holder]) { s.players[pt.holder].potatoMs = (s.players[pt.holder].potatoMs || 0) + Math.max(0, Math.min(now, s.huntEnd) - pt.since); }
}
function checkEnd(s) {
  if (s.phase !== 'hunting') return;
  const hiders = Object.values(s.players).filter((p) => p.startRole === 'hider');
  const left = hiders.filter((p) => !p.caughtAt && !p.extracted);
  const out = hiders.filter((p) => p.extracted);
  if (Date.now() >= s.huntEnd || (hiders.length && !left.length)) endRound(s, left.length || out.length ? 'time' : 'allCaught');
}
function endRound(s, why) {
  s.phase = 'ended'; s.endedAt = Date.now(); s.endWhy = why;
  potatoHand(s, s.endedAt); if (s.potato) s.potato.holder = null;
  const res = {};
  for (const [id, p] of Object.entries(s.players)) {
    res[id] = { pts: 0, survivedMs: 0, catches: 0, startRole: p.startRole || p.role, survived: false };
    if (p.startRole === 'hider') {
      const until = Math.min(p.caughtAt || p.extracted || s.endedAt, s.huntEnd);
      res[id].survivedMs = Math.max(0, until - s.huntStart);
      res[id].pts += Math.floor(res[id].survivedMs / 60000) * 10;
      if (p.extracted) { res[id].survived = true; res[id].extracted = true; res[id].pts += 100; }
      else if (!p.caughtAt && !s.settings.sprint) { res[id].survived = true; res[id].pts += 50; }
      // with a final sprint on, hiding until the end without escaping earns the minutes but doesn't win
      res[id].pts += Math.floor((p.potatoMs || 0) / 60000) * 10; // hot potato: double points while you held it
    }
    res[id].pts += p.bonus || 0;
  }
  for (const e of s.events) if (e.k === 'catch' && e.by && res[e.by]) { res[e.by].catches++; res[e.by].pts += 50; }
  for (const r of Object.values(res)) r.pts = Math.max(0, r.pts);
  s.results = res;
  s.wallet = s.wallet || {};
  for (const [id, r] of Object.entries(res)) {
    s.totals[id] = (s.totals[id] || 0) + r.pts;
    s.wallet[id] = Math.max(0, (s.wallet[id] || 0) + r.pts - (s.players[id].banked || 0)); // what was not already paid out mid-round (missed tags can take some back)
    s.players[id].banked = 0;
  }
}
function liveHiders(s, except) { return Object.keys(s.players).filter((id) => { const q = s.players[id]; return id !== except && q.role === 'hider' && !q.caughtAt && !q.extracted && peers.has(id); }); }
function armWire(s, now) { // hand the live wire to a random hider who isn't live yet
  const ids = liveHiders(s).filter((id) => !s.players[id].live);
  if (ids.length < 2) { s.wire = null; s.nextWireAt = now + 30000; return; }
  s.wire = { holder: pick(ids), until: now + (s.settings.wireSec || 180) * 1000, from: null, at: now };
  s.nextWireAt = Infinity;
  s.events.push({ id: evId(), k: 'wire', who: s.wire.holder, t: now });
}
function startDuelIn(s, a, b, game, now, ms) {
  s.duel = { id: 'du' + Math.random().toString(36).slice(2, 7), a, b, game, seed: Math.floor(Math.random() * 1e9), until: now + ms, res: {}, tie: 0 };
  s.nextDuelAt = Infinity;
  s.events.push({ id: evId(), k: 'duel', a, b, game, t: now });
}
function resolveDuel(s, now) {
  const d = s.duel; if (!d) return;
  const ok = (id) => { const q = s.players[id]; return q && q.role === 'hider' && !q.caughtAt && !q.extracted && d.res[id] != null; };
  const va = ok(d.a) ? d.res[d.a] : null, vb = ok(d.b) ? d.res[d.b] : null;
  let win = null;
  if (va != null && vb == null) win = d.a; // a no-show (or a caught hider) loses
  else if (vb != null && va == null) win = d.b;
  else if (va != null && vb != null) {
    if (d.game === 'rps') {
      const beats = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
      win = va === vb ? null : beats[va] === vb ? d.a : d.b;
      if (!win && d.tie < 2 && now < s.huntEnd - 20000) { d.tie++; d.res = {}; d.until = now + 30000; s.events.push({ id: evId(), k: 'duelTie', a: d.a, b: d.b, t: now }); return; }
    } else if (d.game === 'react') win = va === vb ? null : va < vb ? d.a : d.b; // fastest reaction
    else win = va === vb ? null : va > vb ? d.a : d.b; // most taps / longest memory
  }
  if (win) { const w = s.players[win]; w.bonus = (w.bonus || 0) + DUEL_PTS; credit(s, win, DUEL_PTS); }
  s.events.push({ id: evId(), k: 'duelEnd', a: d.a, b: d.b, win, game: d.game, t: now });
  s.duel = null; s.nextDuelAt = now + (s.settings.duelSec || 180) * 1000;
}
function hostDuelTick(now) {
  if (!S.duel) {
    if (S.settings.duel && now >= (S.nextDuelAt || Infinity) && now < S.huntEnd - 30000) hostApply((s) => {
      const ids = shuffle(liveHiders(s)); // odd one out sits this one out
      if (ids.length < 2) { s.nextDuelAt = now + 30000; return; }
      startDuelIn(s, ids[0], ids[1], pick(DUEL_GAMES), now, 45000);
    });
    return;
  }
  const d = S.duel, out = (id) => { const q = S.players[id]; return !q || q.role !== 'hider' || q.caughtAt || q.extracted; };
  const has = (id) => d.res[id] != null;
  if ((has(d.a) && has(d.b)) || now > d.until || (out(d.a) && (has(d.b) || out(d.b))) || (out(d.b) && has(d.a))) hostApply((s) => resolveDuel(s, now));
}
function hostModesTick(now) {
  const st = S.settings;
  if (st.treasure && !S.treasure && now >= (S.nextTreasureAt || Infinity) && now < S.huntEnd - 30000) hostApply((s) => {
    s.treasure = { id: 't' + Math.random().toString(36).slice(2, 7), p: randomSpotIn(currentZone(now) || s.zone) };
    s.nextTreasureAt = Infinity; s.events.push({ id: evId(), k: 'treasure', t: now });
  });
  hostDuelTick(now);
  if (!S.wire) { if (st.wire && now >= (S.nextWireAt || Infinity) && now < S.huntEnd - 60000) hostApply((s) => armWire(s, now)); return; }
  const h = S.players[S.wire.holder];
  if (!h || h.role !== 'hider' || h.caughtAt || h.extracted) { // holder is out: the wire jumps to someone else, same fuse
    hostApply((s) => { const ids = liveHiders(s, s.wire.holder); if (!ids.length) { s.wire = null; return; } s.wire.from = null; s.wire.holder = pick(ids); s.wire.at = now; s.events.push({ id: evId(), k: 'wirePass', to: s.wire.holder, t: now }); });
  } else if (now >= S.wire.until) {
    hostApply((s) => { const w = s.players[s.wire.holder]; w.live = true; s.events.push({ id: evId(), k: 'wireLive', who: s.wire.holder, t: now }); s.wire = null; s.nextWireAt = now + 60000; });
  }
}
const hostTags = []; // host: recent GPS tags waiting to hear if they hit anyone
function markTagHit(by) { const t = hostTags.find((x) => x.by === by && !x.hit); if (t) t.hit = true; }
function hostMissTick(now) {
  while (hostTags.length && now - hostTags[0].t > 3500) {
    const t = hostTags.shift();
    if (t.hit || !S || S.phase !== 'hunting') continue;
    hostApply((s) => {
      const q = s.players[t.by];
      if (!q || q.role !== 'seeker') return;
      s.wallet = s.wallet || {};
      const take = Math.min(MISS_PTS, s.wallet[t.by] || 0); // never below 0
      s.wallet[t.by] = (s.wallet[t.by] || 0) - take;
      q.banked = (q.banked || 0) - take;
      q.bonus = (q.bonus || 0) - MISS_PTS;
      s.events.push({ id: evId(), k: 'tagMiss', by: t.by, t: now });
    });
  }
}
function hostTick() {
  if (!isHost()) return;
  hostRulingsTick();
  const now = Date.now();
  hostMissTick(now);
  if (S.phase === 'hunting') hostModesTick(now);
  if (S.phase === 'hiding' && now >= S.huntStart) hostApply((s) => { s.phase = 'hunting'; setupModes(s); s.events.push({ id: evId(), k: 'hunt', t: now }); });
  else if (S.phase === 'hunting' && now >= S.huntEnd) hostApply((s) => checkEnd(s));
  else if (S.phase === 'hunting' && S.settings.drops && now >= (S.nextDropAt || Infinity)) hostApply(spawnDrop);
  else if (S.phase === 'hunting' && S.sprint && !S.sprint.p && now >= S.sprint.at) hostApply((s) => { s.sprint.p = randomSpotIn(finalZone()); s.events.push({ id: evId(), k: 'extract', t: now }); });
  else if (now - lastStateSent > 4000) broadcastState(); // heartbeat for clock sync and late joiners
}

// ---------------- reacting to state ----------------
function onState(local) {
  if (!S) return;
  banner(null);
  if (S.kicked.includes(me.id)) { leave('The host removed you from the game.'); return; }
  if (S.phase !== prevPhase || S.round !== prevRound) phaseChanged(prevPhase, S.phase);
  if (S.phase === 'lobby' && prevPhase && prevPhase !== 'lobby' && mapBear) setBearing(0); // back to north for the next round
  prevPhase = S.phase; prevRound = S.round;
  for (const e of S.events) {
    if (processed.has(e.id)) continue;
    processed.add(e.id);
    onEvent(e);
  }
  if (S.zone && !fittedZone) { fitZone(S.zone); fittedZone = true; }
  renderAll();
}

function phaseChanged(from, to) {
  if (to === 'hiding') {
    mapView = false; zoneDraft = null; drawDraft();
    resetLocal();
    replay = null; layers.replay.clearLayers();
    sheetCollapsed = false;
    const r = mine()?.role;
    beep('start'); buzz([200, 100, 200]);
    toast(r === 'seeker' ? 'You\'re a <b>SEEKER</b>. Wait for the hunt.' : 'You\'re a <b>HIDER</b>. Go hide in the zone.', r === 'seeker' ? 'seeker' : 'hider', r === 'seeker' ? 'eye' : 'hide');
    requestWake();
    if (S.zone) fitZone(S.zone);
  }
  if (to === 'hunting' && from) {
    beep('alarm'); buzz([300, 100, 300]);
    toast(mine()?.role === 'seeker' ? 'The hunt is on. Go!' : 'Seekers are moving. Stay hidden.', mine()?.role === 'seeker' ? 'seeker' : 'hider', 'clock');
  }
  if (to === 'ended') {
    endMore = false; endSplash();
    const pts = compactTrack(L_.myTrack);
    L_.tracks[me.id] = pts;
    if (pts.length) send('track', { pts });
    beep('start'); buzz([100, 50, 100, 50, 300]);
    sheetCollapsed = false;
  }
  if (to === 'lobby') { replay = null; layers.replay.clearLayers(); }
}

function onEvent(e) {
  const p = mine();
  const IN = (k) => `<b>${ITEM_INFO[k].name}</b>`;
  if (e.k === 'catch') {
    if (e.who === me.id) { beep('caught'); buzz([500]); fx('caught', 'Caught!', 'red'); toast(S.settings.infection ? 'You got caught. You\'re a seeker now.' : 'You got caught.', 'seeker', 'caught'); }
    else if (e.by === me.id) { beep('tag'); buzz([60, 40, 160]); fx('check', 'Got them! +50', 'red'); toast(`You caught <b>${nm(e.who)}</b>. +50${e.reward ? ` and ${IN(e.reward)}` : ''}`, 'good', 'check'); }
    else toast(e.how === 'zone' ? `<b>${nm(e.who)}</b> left the zone and is out` : `<b>${nm(e.who)}</b> was caught${e.by ? ' by ' + nm(e.by) : ''}`, '', e.how === 'zone' ? 'strictZone' : 'caught');
    if (e.who === me.id && S.jail) setTimeout(() => toast('Go to the jail. A free hider can break you out.', 'hider', 'jail'), 2500);
  }
  if (e.k === 'radar') {
    if (p && p.role === 'hider' && alive(p)) { toast(`<b>${nm(e.by)}</b> used radar. You pinged.`, 'seeker', 'radar'); buzz([100, 50, 100]); sendPing('radar'); }
    else toast(`Radar sweep by <b>${nm(e.by)}</b>`, 'seeker', 'radar');
  }
  const self_ = (id) => id === me.id;
  const tone = (id) => (P(id)?.role === 'seeker' ? 'seeker' : 'hider');
  if (e.k === 'hunt' && S.settings.shrink && smoothShrink()) setTimeout(() => toast('Zone is shrinking. Stay inside the red line.', '', 'shrink'), 1500);
  if (e.k === 'drop') { beep('alarm'); buzz([100, 60, 100, 60, 300]); toast('Supply drop landed. First one there gets a super power-up.', 'good', 'drops'); }
  if (e.k === 'claim') {
    if (self_(e.who)) { beep('tag'); buzz([60, 40, 160]); fx(e.item, ITEM_INFO[e.item].name); toast(`You got ${IN(e.item)}. It's in Power-ups.`, 'good', e.item); }
    else toast(`<b>${nm(e.who)}</b> grabbed the supply drop`, tone(e.who), 'drops');
  }
  if (e.k === 'shieldHit') { beep('alarm'); toast(self_(e.who) ? `Your shield blocked ${e.by ? nm(e.by) + "'s" : 'a'} tag. Run!` : `<b>${nm(e.who)}</b>'s shield blocked a tag`, self_(e.who) ? 'good' : '', 'shield'); }
  if (e.k === 'shield' && self_(e.by)) toast('Shield up. The next tag on you won’t count.', 'hider', 'shield');
  if (e.k === 'ghost') toast(self_(e.by) ? 'Ghost mode: your next 2 pings are blocked.' : `<b>${nm(e.by)}</b> went ghost`, self_(e.by) ? 'hider' : '', 'ghost');
  if (e.k === 'blackout') { beep('alarm'); toast(p && p.role === 'seeker' ? `<b>${nm(e.by)}</b> blacked out your map until the next ping.` : `Blackout by <b>${nm(e.by)}</b>: seekers miss the next ping`, p && p.role === 'seeker' ? 'seeker' : 'hider', 'blackout'); }
  if (e.k === 'xray') {
    if (p && p.role === 'hider' && alive(p)) { beep('alarm'); buzz([200, 80, 200]); toast(`<b>${nm(e.by)}</b> used X-ray. Your exact spot pinged.`, 'seeker', 'xray'); sendPing('xray'); }
    else toast(`X-ray by <b>${nm(e.by)}</b>: exact spots incoming`, 'seeker', 'xray');
  }
  if (e.k === 'tracker') {
    if (p && p.role === 'hider' && alive(p)) { beep('alarm'); toast(`<b>${nm(e.by)}</b> tracked you: you ping every 15 s for 1 min.`, 'seeker', 'tracker'); L_.lastTrack = hostNow(); sendPing('tracker'); }
    else toast(`Tracker by <b>${nm(e.by)}</b>: hiders ping every 15 s for 1 min`, 'seeker', 'tracker');
  }
  if (e.k === 'mission' && self_(e.who)) { beep('tag'); buzz([60, 40, 160]); fx('missions', 'Mission +25'); toast(`Mission done. +25${e.item ? ` and ${IN(e.item)}` : ''}. New target on the map.`, 'good', 'missions'); }
  if (e.k === 'flag') toast(self_(e.who) ? 'Flag captured. +50' : `<b>${nm(e.who)}</b> captured a flag`, self_(e.who) ? 'good' : tone(e.who), 'capture');
  if (e.k === 'potato') { if (self_(e.who)) { toast('You have the hot potato: 2x points, 2x pings.', 'good', 'potato'); sendPing('potato'); } else toast(`<b>${nm(e.who)}</b> has the hot potato`, tone(e.who), 'potato'); }
  if (e.k === 'potatoDrop' && !self_(e.who)) toast(`<b>${nm(e.who)}</b> dropped the hot potato`, '', 'potato');
  if (e.k === 'duel' && (self_(e.a) || self_(e.b))) toast(`Showdown! You vs <b>${nm(self_(e.a) ? e.b : e.a)}</b>: ${DUEL_NAMES[e.game]}`, 'good', 'duel');
  if (e.k === 'duelTie' && (self_(e.a) || self_(e.b))) toast('Tie! Go again.', '', 'duel');
  if (e.k === 'duelEnd') {
    if ($('#modal .duel-wait') || $('#modal [data-dg]')) closeModal();
    if (self_(e.win)) { beep('ping'); fx('duel', `You won! +${DUEL_PTS}`); toast(`You won the showdown! +${DUEL_PTS} points`, 'good', 'duel'); }
    else if (self_(e.a) || self_(e.b)) toast(e.win ? `<b>${nm(e.win)}</b> won the showdown` : 'The showdown was a draw', '', 'duel');
    else if (e.win) toast(`<b>${nm(e.win)}</b> won a showdown vs <b>${nm(e.win === e.a ? e.b : e.a)}</b>`, '', 'duel');
  }
  if (e.k === 'treasure') { beep('warn'); toast(`Treasure dropped. +${TREASURE_PTS} to the first hider there.`, 'good', 'treasure'); }
  if (e.k === 'treasureGot') { if (self_(e.who)) { beep('alarm'); toast(`+${TREASURE_PTS} treasure! Your spot pinged. Move!`, 'good', 'treasure'); sendPing('treasure'); } else toast(`<b>${nm(e.who)}</b> grabbed the treasure`, tone(e.who), 'treasure'); }
  if (e.k === 'wire') { L_.wireLocs = {}; if (self_(e.who)) { beep('alarm'); buzz([200, 80, 200]); toast(`You have the Live Wire (${fmt(S.wire ? S.wire.until - hostNow() : 0)} fuse). Get near a hider to pass it.`, 'seeker', 'wire'); } else toast(`<b>${nm(e.who)}</b> has the Live Wire`, '', 'wire'); }
  if (e.k === 'wirePass') { L_.wireLocs = {}; if (self_(e.to)) { beep('alarm'); buzz([200, 80, 200]); toast(`${e.from ? `<b>${nm(e.from)}</b> passed you` : 'You got'} the Live Wire! Pass it before the fuse runs out.`, 'seeker', 'wire'); } else if (self_(e.from)) toast('Passed the Live Wire.', 'good', 'wire'); else toast(`<b>${nm(e.to)}</b> has the Live Wire`, '', 'wire'); }
  if (e.k === 'wireLive') { if (self_(e.who)) { beep('alarm'); buzz([400, 100, 400]); toast('Fuse ran out. You\'re LIVE: seekers see you all round.', 'seeker', 'wire'); } else toast(`<b>${nm(e.who)}</b> is LIVE. Seekers can see them now.`, 'seeker', 'wire'); }
  if (e.k === 'tagMiss' && self_(e.by)) { buzz([120]); toast(`Missed tag. -${MISS_PTS} points.`, 'seeker', 'alert'); }
  if (e.k === 'extract') { beep('alarm'); buzz([200, 100, 200, 100, 400]); toast(p && p.role === 'seeker' ? 'Extraction is open. Guard it.' : 'Extraction is open. Reach it for +100.', 'good', 'sprint'); }
  if (e.k === 'extracted') toast(self_(e.who) ? 'You made it out. +100. You are safe.' : `<b>${nm(e.who)}</b> escaped`, self_(e.who) ? 'good' : tone(e.who), 'sprint');
  if (e.k === 'breakout') { beep('alarm'); toast((e.freed || []).includes(me.id) ? `<b>${nm(e.by)}</b> broke you out. Run!` : `<b>${nm(e.by)}</b> broke ${e.freed.length} out of jail`, (e.freed || []).includes(me.id) ? 'good' : tone(e.by), 'jail'); }
  if (e.k === 'buy' && self_(e.who)) {
    const look = e.item === 'icon' || e.item === 'char' || e.item === 'color';
    fx(look ? 'star' : shopInfo(e.item).ic || 'shop', e.item === 'char' ? (CHARS[e.opt]?.name || 'New look') : 'Bought!');
    toast(e.item === 'char' ? `You're <b>${CHARS[e.opt]?.name || 'someone new'}</b> now` : e.item === 'icon' ? 'New shape' : e.item === 'color' ? 'New color' : `<b>${shopInfo(e.item).name || e.item}</b> ${e.saved ? 'saved for your next round as ' + (SHOP[e.item]?.role || 'player') : 'is yours'}`, 'good', look ? 'star' : shopInfo(e.item).ic || 'shop');
  }
  if (e.k === 'passHit') { beep('alarm'); toast(self_(e.who) ? 'Escape pass used. You got away. Run!' : `<b>${nm(e.who)}</b> used an escape pass and got away`, self_(e.who) ? 'good' : '', 'pass'); }
  if (e.k === 'cloak' && self_(e.by)) toast('Cloaked: your next ping is hidden.', 'hider', 'cloak');
  if (e.k === 'lockdown') { beep('alarm'); toast(p && p.role === 'hider' ? `<b>${nm(e.by)}</b> locked down your power-ups for 30 s` : `Lockdown by <b>${nm(e.by)}</b>: hiders can't use power-ups for 30 s`, p && p.role === 'hider' ? 'hider' : 'seeker', 'lockdown'); }
  if (e.k === 'peek') {
    if (p && p.role === 'seeker') { if (myPos) send('seekerLoc', { p: myPos.p }); }
    else if (self_(e.by)) { L_.peekUntil = hostNow() + 10000; toast('Peek: the nearest seeker shows for 10 s', 'hider', 'peek'); }
  }
  if (e.k === 'trail') {
    if (p && p.role === 'hider' && alive(p)) { L_.trailSendUntil = hostNow() + 20000; L_.lastTrailSend = 0; }
    if (self_(e.by)) { L_.trailUntil = hostNow() + 20000; L_.trailLocs = {}; toast('Hot trail: follow the arrow for 20 s', 'seeker', 'trail'); }
  }
  if (e.k === 'spotlight') {
    if (self_(e.target) && p && alive(p)) { beep('alarm'); buzz([200, 80, 200]); toast(`<b>${nm(e.by)}</b> spotlighted you: exact spot for 10 s`, 'hider', 'spotlight'); L_.spotUntil = hostNow() + 10000; L_.lastSpot = 0; }
    else if (self_(e.by)) toast(`Spotlight on <b>${nm(e.target)}</b>`, 'seeker', 'spotlight');
  }
  if (e.k === 'sonar') {
    if (p && p.role === 'seeker') { if (myPos) send('seekerLoc', { p: myPos.p }); toast('A hider used sonar: they see you for 30 s.', 'seeker', 'sonar'); }
    else { L_.sonarUntil = hostNow() + 30000; toast(`Sonar by <b>${nm(e.by)}</b>: seekers visible for 30 s`, 'hider', 'sonar'); }
  }
}

// ---------------- hider pings ----------------
function sendPing(kind = 'scheduled', n = null) {
  const s = S.settings;
  if (n === null) n = kind === 'scheduled' ? L_.lastPingN : 'r' + Date.now();
  if (kind !== 'breach' && kind !== 'away' && hostNow() < ((mine()?.fx || {}).ghostUntil || 0)) { send('ping', { kind: 'ghost', n, p: null }); return; }
  if (kind !== 'breach' && kind !== 'away' && hostNow() < (S.blackoutUntil || 0)) { send('ping', { kind: 'blackout', n, p: null }); return; }
  if (kind === 'away') { send('ping', { kind, n: 'a' + Date.now(), p: myPos ? myPos.p : null, blur: 0 }); return; } // power-ups can't hide it
  if (!myPos) { send('ping', { kind: 'nosignal', n, p: null }); return; }
  if (kind === 'breach') { send('ping', { kind, n: 'b' + Date.now(), p: myPos.p, blur: 0 }); return; }
  if (kind === 'xray' || kind === 'capture' || kind === 'treasure' || kind === 'live') { send('ping', { kind, n, p: myPos.p, blur: 0 }); return; }
  if (kind === 'scheduled' && L_.swarmArmed) {
    L_.swarmArmed = false;
    const z = currentZone() || S.zone;
    const spots = shuffle([G.randomInDisk(myPos.p, s.blurM), randomSpotIn(z, myPos.p, 80), randomSpotIn(z, myPos.p, 80), randomSpotIn(z, myPos.p, 80)]);
    send('ping', { kind, n, p: spots[0], alts: spots.slice(1), blur: s.blurM });
    toast('Swarm ping sent: 4 spots, 1 real.', 'hider', 'swarm'); renderSheet(); return;
  }
  if (kind === 'scheduled' && L_.jamArmed) { L_.jamArmed = false; send('ping', { kind: 'jam', n, p: null }); toast('Jammer used. That ping was blocked.', 'hider', 'jammer'); renderSheet(); return; }
  if (kind === 'scheduled' && L_.decoyArmed) { const p = L_.decoyArmed; L_.decoyArmed = null; send('ping', { kind, n, p: G.randomInDisk(p, s.blurM), blur: s.blurM, decoy: true }); toast('Decoy ping sent.', 'hider', 'decoy'); renderSheet(); return; }
  send('ping', { kind, n, p: G.randomInDisk(myPos.p, s.blurM), blur: s.blurM });
}

function bearing(a, b) {
  const r = Math.PI / 180, y = Math.sin((b[1] - a[1]) * r) * Math.cos(b[0] * r);
  const x = Math.cos(a[0] * r) * Math.sin(b[0] * r) - Math.sin(a[0] * r) * Math.cos(b[0] * r) * Math.cos((b[1] - a[1]) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}
const duelKey = (d) => d.id + ':' + d.tie;
function seeded(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function duelSubmit(v) { const d = S && S.duel; if (!d || L_.duelSent[duelKey(d)] || (d.a !== me.id && d.b !== me.id)) return; L_.duelSent[duelKey(d)] = true; send('duelRes', { id: d.id, tie: d.tie, v }); }
function openDuel() {
  const d = S && S.duel; if (!d || (d.a !== me.id && d.b !== me.id)) return;
  const opp = d.a === me.id ? d.b : d.a, key = duelKey(d);
  L_.duelShown[key] = true;
  const head = `<h3>${ic('duel')} Showdown vs ${nm(opp)}</h3><p class="hint">${DUEL_NAMES[d.game]} · winner gets +${DUEL_PTS}</p>`;
  const wait = (msg) => head + `<div class="duel-wait"><p>${msg}</p><p>Waiting for ${nm(opp)}…</p></div><button class="btn ghost" data-act="closeModal">Close</button>`;
  if (L_.duelSent[key]) { modal(wait('You played.')); return; }
  const card = () => $('#modal .modal-card');
  const done = (v, msg) => { if (L_.duelSent[key] || !S.duel || duelKey(S.duel) !== key) return; duelSubmit(v); if (card().querySelector('[data-dg]')) card().innerHTML = wait(msg); };
  const r = seeded(d.seed + d.tie * 7919);
  if (d.game === 'rps') {
    modal(head + `<p>Pick one:</p><div class="duel-rps">${['rock', 'paper', 'scissors'].map((v) => `<button class="btn big" data-dg="${v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div>`);
    card().onclick = (e) => { const b = e.target.closest('[data-dg]'); if (b) done(b.dataset.dg, `You picked ${b.dataset.dg}.`); };
  } else if (d.game === 'tap') {
    modal(head + `<p class="duel-big mono" id="dg-t">3</p><button class="btn primary big duel-pad" data-dg="tap" disabled>Get ready</button><p class="hint">Tap as fast as you can for 5 seconds</p>`);
    const pad = $('#modal [data-dg="tap"]'); let n = 0, live = false, left = 3;
    card().onclick = null;
    pad.onpointerdown = (e) => { e.preventDefault(); if (live) { n++; pad.textContent = n; } };
    const iv = setInterval(() => {
      if (!pad.isConnected) { clearInterval(iv); return; }
      left--; const t = $('#dg-t'); if (t) t.textContent = live ? left : left || 'GO';
      if (!live && left <= 0) { live = true; left = 5; pad.disabled = false; pad.textContent = 'TAP!'; }
      else if (live && left <= 0) { clearInterval(iv); live = false; done(Math.min(n, 150), `${n} taps!`); }
    }, 1000);
  } else if (d.game === 'react') {
    modal(head + `<button class="duel-react" data-dg="react">Wait for green…</button><p class="hint">Tap the moment it turns green. Too soon and you lose.</p>`);
    const pad = $('#modal [data-dg="react"]'); let goAt = 0;
    card().onclick = null;
    const tm = setTimeout(() => { if (!pad.isConnected) return; goAt = performance.now(); pad.classList.add('go'); pad.textContent = 'TAP!'; }, 2500 + r() * 3000);
    pad.onpointerdown = (e) => { e.preventDefault(); if (!goAt) { clearTimeout(tm); done(9999, 'Too soon!'); } else { const ms = Math.round(performance.now() - goAt); done(ms, `${ms} ms`); } };
  } else {
    const seq = Array.from({ length: 6 }, () => Math.floor(r() * 4));
    modal(head + `<p class="hint" id="dg-t">Watch the pattern…</p><div class="duel-mem">${[0, 1, 2, 3].map((i) => `<button class="mp c${i}" data-dg="${i}" disabled aria-label="pad ${i + 1}"></button>`).join('')}</div>`);
    const pads = [...document.querySelectorAll('#modal .mp')]; let i = 0, pos = 0, t0 = 0;
    const finish = () => done(pos * 100000 - Math.min(99999, Math.round(performance.now() - t0)), `${pos} of ${seq.length} right`);
    const show = () => {
      if (!pads[0].isConnected) return;
      if (i >= seq.length) { pads.forEach((x) => { x.disabled = false; }); const t = $('#dg-t'); if (t) t.textContent = 'Your turn: repeat it'; t0 = performance.now(); return; }
      const x = pads[seq[i]]; x.classList.add('lit'); setTimeout(() => { x.classList.remove('lit'); i++; setTimeout(show, 200); }, 600);
    };
    setTimeout(show, 800);
    card().onclick = (e) => {
      const b = e.target.closest('.mp'); if (!b || b.disabled || L_.duelSent[key]) return;
      b.classList.add('lit'); setTimeout(() => b.classList.remove('lit'), 150);
      if (+b.dataset.dg === seq[pos]) { pos++; if (pos === seq.length) finish(); } else finish();
    };
  }
}
function updateWireBar(now) {
  let el = $('#wirebar');
  if (!el) { el = document.createElement('div'); el.id = 'wirebar'; el.hidden = true; document.body.appendChild(el); }
  const p = mine();
  if (!S || S.phase !== 'hunting' || !S.wire || !p) { el.hidden = true; return; }
  const mineW = S.wire.holder === me.id;
  el.hidden = false; el.classList.toggle('hot', mineW);
  el.innerHTML = `${ic('wire')}<span class="tr-t">${mineW ? 'You have the Live Wire' : `<b>${nm(S.wire.holder)}</b> has the Live Wire`} · <b class="mono">${fmt(Math.max(0, S.wire.until - now))}</b>${mineW ? ' · get near a hider' : ''}</span>`;
}
function updateTrail() {
  let el = $('#trail');
  if (!el) { el = document.createElement('div'); el.id = 'trail'; el.hidden = true; document.body.appendChild(el); }
  const now = hostNow();
  let best = null;
  if (now < (L_.trailUntil || 0) && myPos && S) {
    for (const [id, x] of Object.entries(L_.trailLocs || {})) {
      const q = P(id);
      if (!q || q.role !== 'hider' || !alive(q) || now - x.t > 15000) continue;
      const dd = G.dist(myPos.p, x.p);
      if (!best || dd < best.d) best = { d: dd, p: x.p };
    }
  }
  if (!best) { el.hidden = !(now < (L_.trailUntil || 0)); el.innerHTML = `${ic('trail')}<span class="tr-t">Picking up the trail…</span>`; return; }
  const band = best.d < 100 ? 'very close' : best.d < 300 ? 'close' : best.d < 800 ? 'getting warm' : 'far';
  el.hidden = false;
  el.innerHTML = `<span class="tr-a" style="transform:rotate(${Math.round(bearing(myPos.p, best.p) + mapBear)}deg)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 17-7-4-7 4z"/></svg></span><span class="tr-t">Nearest hider · ${band} · ${Math.ceil((L_.trailUntil - now) / 1000)} s</span>`;
}
function shopHtml(card) {
  const p = mine();
  if (!p || !S) return '';
  const bal = (S.wallet || {})[me.id] || 0;
  const inRound = S.phase === 'hiding' || S.phase === 'hunting';
  if (inRound && p.role === 'hider' && !alive(p)) return '';
  const roles = inRound ? [p.role] : ['hider', 'seeker'];
  const btn = (k) => { const it = shopInfo(k); return `<button class="item shop" data-act="buy" data-k="${k}" ${bal < it.cost ? 'disabled' : ''}>${ic(it.ic)}${it.name}<span class="cost">${it.cost}</span><small>${k === 'pass' ? 'The next time you get caught, you get away' : it.desc}</small></button>`; };
  const saved = Object.entries(p.bank || {}).filter(([, n]) => n > 0).map(([k, n]) => `${shopInfo(k).name}${n > 1 ? ' ×' + n : ''}`);
  const body = shopOpen ? `
    ${roles.map((r) => `${inRound ? '' : `<div class="section-t" style="margin-top:12px">${r === 'hider' ? 'If you hide' : 'If you seek'}</div>`}<div class="items">${Object.keys(SHOP).filter((k) => SHOP[k].role === r).map(btn).join('')}</div>`).join('')}
    <div class="section-t" style="margin-top:12px">Characters · yours forever once bought</div>
    <div class="chars">${Object.entries(CHARS).map(([id, c]) => { const own = (p.owned || []).includes(id), on = p.icon === 'c:' + id; return `<button class="char ${on ? 'on' : ''}" data-act="buy" data-k="char" data-opt="${id}" aria-label="${c.name}" ${on || (!own && bal < c.cost) ? 'disabled' : ''}><img src="chars/${id}.png" alt=""><span class="cn">${c.name}</span><span class="cost ${own ? 'own' : ''}">${on ? 'You' : own ? 'Owned' : c.cost}</span><small>${CHAR_TIERS[c.cost]}</small></button>`; }).join('')}</div>
    <div class="section-t" style="margin-top:12px">Shape · ${SHOP.icon.cost} pts</div>
    <div class="row badges">${BADGES.map((b) => `<button class="btn small badge ${p.icon === b ? 'on' : ''}" data-act="buy" data-k="icon" data-opt="${b}" aria-label="${b} shape" ${bal < SHOP.icon.cost || p.icon === b ? 'disabled' : ''}>${ic(b)}</button>`).join('')}</div>
    <div class="section-t" style="margin-top:12px">Color · ${SHOP.color.cost} pts</div>
    <div class="row badges">${COLORS.map((c) => { const taken = Object.values(S.players).some((x) => x.color === c); return `<button class="btn small badge swatch ${p.color === c ? 'on' : ''}" data-act="buy" data-k="color" data-opt="${c}" aria-label="Color ${c}" style="--sw:${c}" ${bal < SHOP.color.cost || taken ? 'disabled' : ''}></button>`; }).join('')}</div>
    ${!inRound ? `<p class="hint" style="text-align:left">Picks you buy now wait for a round where you have that role.${saved.length ? ' Saved: ' + saved.join(', ') + '.' : ''}</p>` : ''}` : '';
  if (card) return `<div class="card shop-box ${shopOpen ? 'open' : ''}"><button class="shop-h card-tap" data-act="toggleShop">${ic('shop')}<span class="ct">Points shop</span><span class="bal mono">${bal} pts</span>${ic(shopOpen ? 'chevD' : 'chevR', 'chev')}</button>${body}</div>`;
  return `<div class="section shop-box"><button class="btn shop-h" data-act="toggleShop">${ic('shop')}Points shop<span class="bal mono">${bal} pts</span><span class="chev">${shopOpen ? '▴' : '▾'}</span></button>${body}</div>`;
}

const locOk = {};
let locSent = null, locSentAt = 0;
function locReport() {
  if (!S || !net) return;
  const ok = !!myPos && !geoBlocked;
  if (ok !== locSent || Date.now() - locSentAt > 15000) { locSent = ok; locSentAt = Date.now(); send('loc', { ok }); }
}
function noLoc(id) { const x = locOk[id]; return x ? !x.ok : Date.now() - (S.players[id]?.joinedAt || 0) > 15000 && peers.has(id); }
function settingsModal() {
  const ok = !!myPos && !geoBlocked;
  modal(`<h3>Settings</h3>
    <div class="set-row ${ok ? '' : 'bad'}">${ic('pin')}<div><b>Location</b><span>${ok ? `On (±${myPos.acc} m)` : esc(geoError || 'Not shared yet. You need it to play.')}</span></div></div>
    <button class="btn primary big" data-act="allowGeo" style="width:100%;margin:12px 0 8px">${ok ? 'Check location again' : 'Allow location'}</button>
    <button class="btn dark" data-act="closeModal" style="width:100%">Done</button>`);
}
function clientTick() {
  locReport();
  if (!S) return;
  if (!wakeLock && Date.now() - (L_.lastWakeTry || 0) > 5000) { L_.lastWakeTry = Date.now(); requestWake(); } // joiners get it as soon as they're in
  maybeTakeOverHost();
  hostTick();
  const now = hostNow();
  if (now < (L_.trailUntil || 0) + 1500) updateTrail();
  updateWireBar(now);
  const p = mine();
  if (S.phase === 'hunting' && p && p.role === 'hider' && alive(p)) {
    const n = Math.floor((now - S.huntStart) / pingMs());
    if (n > L_.lastPingN) { L_.lastPingN = n; sendPing('scheduled', n); if (n > 0) { beep('ping'); buzz(80); toast('You pinged. Seekers see your area.', 'seeker', 'pin'); } }
    if (now < (S.trackerUntil || 0) && now - (L_.lastTrack || 0) >= 15000) { L_.lastTrack = now; sendPing('tracker'); }
    if (now < (L_.trailSendUntil || 0) && now - (L_.lastTrailSend || 0) >= 5000 && myPos) { L_.lastTrailSend = now; send('hiderLoc', { p: G.randomInDisk(myPos.p, 20) }); }
    if (now < (L_.spotUntil || 0) && now - (L_.lastSpot || 0) >= 5000) { L_.lastSpot = now; sendPing('xray'); }
    if (p.live && now - (L_.lastLive || 0) >= 5000) { L_.lastLive = now; sendPing('live'); }
    if (S.wire && S.wire.holder !== me.id && myPos && now - (L_.lastWireSend || 0) >= 5000) { L_.lastWireSend = now; send('hiderLoc', { p: myPos.p, wire: true }); }
    if (S.wire && S.wire.holder === me.id && myPos) for (const [id, x] of Object.entries(L_.wireLocs)) {
      const q = P(id);
      if (!q || q.role !== 'hider' || !alive(q) || now - x.t > 12000 || (id === S.wire.from && now - S.wire.at < 15000)) continue;
      if (G.dist(myPos.p, x.p) <= WIRE_PASS_M + Math.min(10, (myPos.acc || 0) / 2)) { sendOnce('wire', 'wirePass', { to: id }, now, 3000); break; }
    }
    if (S.duel && (S.duel.a === me.id || S.duel.b === me.id) && !L_.duelShown[duelKey(S.duel)] && $('#modal').hidden) { beep('alarm'); buzz([100, 60, 100]); openDuel(); }
    if (S.potato && S.potato.holder === me.id) { // hot potato: an extra ping halfway between the normal ones
      const h = Math.floor((now - S.huntStart) / (pingMs() / 2));
      if (h % 2 === 1 && h > L_.lastPotN) { L_.lastPotN = h; sendPing('potato'); toast('Hot potato ping', 'hider', 'potato'); }
    }
    const toNext = pingMs() - ((now - S.huntStart) % pingMs());
    if (toNext <= 10000 && L_.warnedN !== n + 1) { L_.warnedN = n + 1; beep('warn'); buzz([60, 80, 60]); toast('<b>Ping in 10 s.</b> Get under cover.', 'hider', 'clock'); }
  }
  if (S.phase === 'hunting' && p) reachThings(p, now);
  // seeker alarm: seekers quietly share their spot, hiders' phones play the alarm when one is close
  const range = +S.settings.alarmM || 0;
  if (range && S.phase === 'hunting' && p && p.role === 'seeker' && alive(p) && myPos && now - L_.lastNearSend >= ALARM_SEND_MS) {
    L_.lastNearSend = now; send('seekerNear', { p: myPos.p });
  }
  let nearM = Infinity;
  if (range && S.phase === 'hunting' && p && p.role === 'hider' && alive(p) && myPos) {
    for (const [id, x] of Object.entries(L_.nearLocs)) {
      const q = P(id);
      if (id === me.id || !q || q.role !== 'seeker' || !alive(q) || now - x.t > ALARM_STALE_MS) continue;
      nearM = Math.min(nearM, G.dist(myPos.p, x.p));
    }
  }
  L_.alarmM = nearM;
  alarmUpdate(nearM, range);
  // shrink notices
  if (S.phase === 'hunting' && S.settings.shrink && !smoothShrink()) {
    const k = shrinkStep(now);
    if (k > L_.lastShrinkK) { L_.lastShrinkK = k; if (k > 0) toast('The zone just shrank.', '', 'shrink'); }
  }
  checkZone(now);
  renderHud();
  if (Math.floor(now / 1000) !== clientTick.lastSec) { clientTick.lastSec = Math.floor(now / 1000); renderMarks(); if (S.phase === 'hunting' || S.phase === 'hiding') renderDynamicSheet(); }
}

function near(pt, r = REACH_M) { return myPos && pt && G.dist(myPos.p, pt) <= r + Math.min(10, (myPos.acc || 0) / 2); }
function sendOnce(key, t, d, now, gap = 4000) { if ((L_.sentAt[key] || 0) > now - gap) return; L_.sentAt[key] = now; send(t, { ...d, p: myPos.p, acc: myPos.acc }); }
function reachThings(p, now) {
  if (!myPos) return;
  const free = p.role === 'hider' && alive(p);
  for (const x of S.drops || []) if (!x.claimedBy && (free || p.role === 'seeker') && near(x.p, dropR())) sendOnce('drop' + x.id, 'claim', { id: x.id }, now);
  if (!free) {
    if (p.role === 'hider' && p.caughtAt && S.jail) L_.capStart = {};
    return;
  }
  if (p.mission && near(p.mission.p)) sendOnce('m' + p.mission.id, 'mission', { id: p.mission.id }, now);
  if (S.treasure && near(S.treasure.p, dropR())) sendOnce('tr' + S.treasure.id, 'treasure', { id: S.treasure.id }, now);
  if (S.potato && !S.potato.holder && near(S.potato.p)) sendOnce('potato' + S.potato.p.join(), 'potato', {}, now);
  if (S.sprint && S.sprint.p && near(S.sprint.p)) sendOnce('extract', 'extract', {}, now);
  if (S.jail && near(S.jail.p) && now >= (S.jailCooldownUntil || 0) && Object.values(S.players).some((x) => x.role === 'hider' && x.caughtAt)) sendOnce('breakout', 'breakout', {}, now, 6000);
  for (const f of S.flags || []) {
    if (f.by) { delete L_.capStart[f.id]; continue; }
    if (!near(f.p)) { if (L_.capStart[f.id]) toast('You left the flag. Capture reset.', 'hider', 'capture'); delete L_.capStart[f.id]; continue; }
    if (!L_.capStart[f.id]) { L_.capStart[f.id] = now; L_.capPing[f.id] = 0; toast('Capturing. Stay 1 min. Seekers see you.', 'seeker', 'capture'); }
    if (now - (L_.capPing[f.id] || 0) >= 15000) { L_.capPing[f.id] = now; sendPing('capture'); }
    const held = now - L_.capStart[f.id];
    if (held >= 60000) sendOnce('flag' + f.id, 'flag', { id: f.id, held }, now);
  }
}
function checkZone(now) {
  const p = mine();
  const z = currentZone(now);
  if (!p || !z || !myPos || !(S.phase === 'hiding' || S.phase === 'hunting')) { setZoneBanner(null); outAlert(null); return; }
  const ed = G.edgeDistance(myPos.p, z);
  if (ed >= 0) {
    if (L_.outSince) outAlert(null);
    L_.outSince = null; L_.dqSent = false;
    if (ed < 25 && p.role === 'hider' && alive(p)) setZoneBanner(`Near the edge: ${G.fmtDist(ed)} left`, 'warn');
    else setZoneBanner(null);
    return;
  }
  if (!L_.outSince) { L_.outSince = now; beep('alarm'); buzz([200, 100, 200, 100, 200]); }
  const isHiderAlive = p.role === 'hider' && alive(p);
  if (isHiderAlive && S.phase === 'hunting') {
    const strict = S.settings.strictZone;
    const grace = (strict ? 15 : S.settings.graceSec) * 1000;
    const left = grace - (now - L_.outSince);
    setZoneBanner(null);
    if (left > 0) {
      outAlert(Math.ceil(left / 1000), `${G.fmtDist(-ed)} outside. ${strict ? 'Get back in or you are OUT' : 'Get back in or the seekers see you'}`);
    } else if (strict) {
      outAlert(0, 'You stayed out too long. You are out of this round.');
      if (!L_.dqSent) { L_.dqSent = true; send('caught', { who: me.id, by: null, how: 'zone', p: myPos.p }); }
    } else {
      outAlert(null);
      setZoneBanner(`OUT OF ZONE. Seekers can see you!`, 'danger');
      if (now - L_.lastBreach > 15000) { L_.lastBreach = now; sendPing('breach'); }
    }
  } else { outAlert(null); setZoneBanner(`Out of the zone by ${G.fmtDist(-ed)}`, isHiderAlive ? 'danger' : 'warn'); }
}
function outAlert(sec, msg) {
  const el = $('#outzone');
  if (!el) return;
  if (sec === null) { el.hidden = true; L_.ozSec = -1; return; }
  el.hidden = false;
  $('#oz-n', el).textContent = sec > 0 ? sec : 'OUT';
  $('#oz-s', el).textContent = msg;
  if (sec !== L_.ozSec) { L_.ozSec = sec; if (sec > 0) { beep(sec <= 5 ? 'alarm' : 'warn'); buzz(sec <= 5 ? [300] : [120]); } else { beep('caught'); buzz([600]); } }
}
let zoneBannerOn = false;
function setZoneBanner(text, cls) {
  if (!text) { if (zoneBannerOn) { banner(null); zoneBannerOn = false; } return; }
  zoneBannerOn = true; banner(text, cls === 'danger' ? 'pulse' : cls);
}
function banner(text, cls = '') {
  const b = $('#banner');
  if (!text) { b.hidden = true; return; }
  b.className = cls; b.innerHTML = text; b.hidden = false;
}

// ---------------- geolocation ----------------
function startGeo() {
  if (geoWatch !== null || !navigator.geolocation) { if (!navigator.geolocation) geoError = 'This browser has no location support.'; return; }
  geoWatch = navigator.geolocation.watchPosition(onPos, (err) => {
    geoBlocked = err.code === 1;
    geoError = geoBlocked ? 'Location is off for Ghostline. You need it to play.' : 'Still looking for GPS…';
    if (geoBlocked) { navigator.geolocation.clearWatch(geoWatch); geoWatch = null; }
    if (S) renderSheet();
  }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
}
// "Allow location" button: ask again. If the phone already blocked it, browsers won't ask again,
// so show how to turn it back on, and re-check when they come back to the game.
async function geoState() { try { return (await navigator.permissions.query({ name: 'geolocation' })).state; } catch { return null; } }
function retryGeo(fromTap) {
  if (!navigator.geolocation) return;
  if (geoWatch !== null) { navigator.geolocation.clearWatch(geoWatch); geoWatch = null; }
  const t0 = Date.now();
  navigator.geolocation.getCurrentPosition((pos) => { geoBlocked = false; geoError = null; if (!$('#modal').hidden && $('#modal .geo-help')) closeModal(); else if (!$('#modal').hidden && $('#modal .set-row')) setTimeout(settingsModal, 0); onPos(pos); startGeo(); if (S) renderSheet(); }, async (err) => {
    if (err.code !== 1) { geoBlocked = false; startGeo(); return; }
    geoBlocked = true; geoError = 'Location is off for Ghostline. You need it to play.';
    if (S) renderSheet();
    if (fromTap && ((await geoState()) === 'denied' || Date.now() - t0 < 1500)) showGeoHelp(); // no prompt came up, so it's blocked in settings
  }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
}
function showGeoHelp() {
  const ua = navigator.userAgent, ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1), chromeIos = /CriOS/.test(ua);
  const steps = ios ? (chromeIos ? [
    'Open the <b>Settings</b> app, then <b>Privacy &amp; Security</b> › <b>Location Services</b>. Make sure it\'s on.',
    'In that list tap <b>Chrome</b> and pick <b>While Using the App</b>.',
    'Come back here and tap <b>Try again</b>. Tap <b>Allow</b> if Chrome asks.',
  ] : [
    'Open the <b>Settings</b> app, then <b>Privacy &amp; Security</b> › <b>Location Services</b>. Make sure it\'s on.',
    'In that list tap <b>Safari Websites</b> and pick <b>While Using the App</b>.',
    'Back in Safari, tap <b>aA</b> (or the page icon) in the address bar › <b>Website Settings</b> › <b>Location</b> › <b>Allow</b>.',
    'Tap <b>Try again</b> below.',
  ]) : [
    'Tap the icon just left of the web address (a lock or sliders) › <b>Permissions</b> › <b>Location</b> › <b>Allow</b>.',
    'Make sure your phone\'s <b>Location</b> is on (swipe down from the top and tap it).',
    'Tap <b>Try again</b> below.',
  ];
  modal(`<div class="geo-help"><h3>${ic('pin')} Turn on location</h3><p>Your phone blocked location for Ghostline, so it won't ask again by itself.</p><ol class="steps">${steps.map((x) => `<li>${x}</li>`).join('')}</ol><button class="btn primary" data-act="allowGeo" style="width:100%">Try again</button><button class="btn ghost" data-act="closeModal" style="width:100%">Close</button></div>`);
}
(async () => { try { const ps = await navigator.permissions.query({ name: 'geolocation' }); ps.onchange = () => { if (ps.state === 'granted' && geoBlocked) retryGeo(false); }; } catch {} })();
window.addEventListener('focus', () => { if (geoBlocked) retryGeo(false); });
// Fresh fixes only. A poor fix is skipped while a recent good one exists, and the last few
// fixes that agree are averaged (weighted by accuracy) to take out jitter.
const fixes = [];
let rawAcc = null;
function onPos(pos) {
  const c = pos.coords, now = Date.now();
  if (!Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) return;
  const f = { p: [c.latitude, c.longitude], acc: Math.max(3, +c.accuracy || 50), t: now };
  rawAcc = Math.round(f.acc);
  if (f.acc > GPS_POOR && myPos && myPos.acc <= GPS_OK && now - myPos.t < 15000) { updateGpsChip(); return; }
  for (let i = fixes.length - 1; i >= 0; i--) if (now - fixes[i].t > 5000 || G.dist(fixes[i].p, f.p) > fixes[i].acc + f.acc) fixes.splice(i, 1);
  fixes.push(f); if (fixes.length > 4) fixes.shift();
  let w = 0, lat = 0, lng = 0;
  for (const x of fixes) { const k = 1 / (x.acc * x.acc); w += k; lat += x.p[0] * k; lng += x.p[1] * k; }
  setPos(lat / w, lng / w, Math.min(...fixes.map((x) => x.acc)));
}
function gpsInfo() {
  if (!myPos) return null;
  const acc = Math.max(myPos.acc, Date.now() - myPos.t > 15000 ? rawAcc || 0 : 0);
  return { cls: acc > GPS_POOR ? 'bad' : acc > GPS_OK ? 'fair' : 'good', text: `GPS ±${acc} m`, title: acc > GPS_POOR ? 'Weak GPS. Step outside, away from buildings.' : 'Location accuracy' };
}
function updateGpsChip() {
  const g = gpsInfo();
  for (const el of [$('#gps-chip'), ...document.querySelectorAll('.gps-chip.lob')]) {
    if (!el) continue;
    const lob = el.classList.contains('lob');
    if (!g) { if (lob) { el.className = 'gps-chip lob'; el.textContent = 'No GPS yet'; } else el.hidden = true; continue; }
    el.hidden = false;
    el.className = 'gps-chip ' + g.cls + (lob ? ' lob' : '');
    el.textContent = g.text; el.title = g.title;
  }
}
function setPos(lat, lng, acc = 10) {
  const first = !myPos;
  geoError = null;
  myPos = { p: [lat, lng], acc: Math.round(acc), t: Date.now() };
  updateMeMarker();
  updateGpsChip();
  if (first && !(S && S.zone)) map.setView(myPos.p, 16);
  if (S && (S.phase === 'hiding' || S.phase === 'hunting')) {
    const last = L_.myTrack[L_.myTrack.length - 1];
    if (!last || G.dist(last, myPos.p) > 8 || Date.now() - last[2] > 20000) L_.myTrack.push([+lat.toFixed(6), +lng.toFixed(6), hostNow()]);
  }
  if (first) renderSheet();
}
function compactTrack(t) {
  if (t.length <= 600) return t;
  const step = Math.ceil(t.length / 600);
  return t.filter((_, i) => i % step === 0 || i === t.length - 1);
}
// Keep the screen on for as long as you're in a game (lobby included).
// First choice is the Wake Lock API. Where that's missing or refused (older iPhones, some
// home-screen apps, battery saver), a tiny silent video loops off-screen, which also keeps phones awake.
let wakeVideo = null;
function wakeVideoOn() {
  try {
    if (!wakeVideo) {
      wakeVideo = document.createElement('video');
      wakeVideo.src = 'media/keep-awake.mp4';
      wakeVideo.muted = true; wakeVideo.loop = true; wakeVideo.playsInline = true;
      wakeVideo.setAttribute('playsinline', ''); wakeVideo.setAttribute('muted', ''); wakeVideo.setAttribute('aria-hidden', 'true');
      wakeVideo.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.01;pointer-events:none;z-index:-1';
      document.body.appendChild(wakeVideo);
    }
    if (wakeVideo.paused) wakeVideo.play().catch(() => {});
  } catch {}
}
function wakeVideoOff() { try { if (wakeVideo && !wakeVideo.paused) wakeVideo.pause(); } catch {} }
let wakePending = false;
async function requestWake() {
  if (!S || document.visibilityState !== 'visible') return;
  if (wakeLock || wakePending) return;
  wakePending = true;
  try {
    if (!('wakeLock' in navigator)) throw 0;
    const lock = await navigator.wakeLock.request('screen');
    if (!S) { lock.release().catch(() => {}); return; }
    wakeLock = lock; wakeVideoOff();
    lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; if (S && document.visibilityState === 'visible') requestWake(); });
  } catch { wakeVideoOn(); } finally { wakePending = false; }
}
function releaseWake() {
  const l = wakeLock; wakeLock = null;
  try { l && l.release(); } catch {}
  wakeVideoOff();
}
// re-arm on every tap (a tap lets the video start on phones that need one) and when the app comes back
document.addEventListener('pointerdown', () => { if (S) requestWake(); unlockAudio(); }, { passive: true });
document.addEventListener('touchend', unlockAudio, { passive: true });
document.addEventListener('keydown', unlockAudio);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { requestWake(); unlockAudio(); if (L_.wentAway) { L_.wentAway = false; showAwayWarning(); } }
  else screenWentAway();
});
window.addEventListener('pagehide', screenWentAway);
// The power button can't be blocked from a web page, so turning the screen off (or leaving the app)
// during the hunt gives a hider away: their exact spot goes to the seekers, and everyone is told.
function screenWentAway() {
  if (!S || S.phase !== 'hunting') return;
  const p = mine();
  if (!p || !alive(p)) return;
  const now = Date.now();
  if (now - (L_.lastAway || 0) < 5000) return; // visibilitychange and pagehide can both fire
  L_.lastAway = now; L_.wentAway = true;
  if (p.role === 'hider') sendPing('away');
  else send('away', {});
}
function showAwayWarning() {
  const hider = mine()?.role === 'hider';
  toast(hider ? '<b>Keep Ghostline open.</b> Seekers saw your exact spot.' : '<b>Keep Ghostline open.</b> Everyone was told.', 'seeker', 'alert');
  beep('warn'); buzz([200, 100, 200]);
}

// ---------------- rendering ----------------
function renderAll() { renderHud(); renderSheet(); renderZone(); renderMarks(); updateMeMarker(); }

function renderHud() {
  if (!S) return;
  const p = mine();
  const now = hostNow();
  const phaseEl = $('#hud-phase'), roleEl = $('#hud-role'), t = $('#hud-time'), sub = $('#hud-sub');
  setMapBtn();
  phaseEl.textContent = { lobby: 'Lobby', hiding: 'Hide phase', hunting: 'Hunt is on', ended: 'Round over' }[S.phase];
  if (p && S.phase !== 'lobby') {
    roleEl.hidden = false;
    const out = (p.caughtAt && !S.settings.infection) || p.extracted;
    roleEl.className = 'pill ' + (out ? 'caught' : p.role);
    roleEl.textContent = p.extracted ? 'Escaped' : p.caughtAt ? (S.settings.infection ? 'Caught · Seeker' : 'Caught') : p.role === 'seeker' ? 'Seeker' : 'Hider';
  } else roleEl.hidden = true;
  if (S.phase === 'hiding') { t.textContent = fmt(S.huntStart - now); sub.innerHTML = 'until seekers are released'; }
  else if (S.phase === 'hunting') {
    t.textContent = fmt(S.huntEnd - now);
    const toNext = pingMs() - ((now - S.huntStart) % pingMs());
    const left = Object.values(S.players).filter((x) => x.startRole === 'hider' && !x.caughtAt && !x.extracted).length;
    sub.innerHTML = `next ping <b>${fmt(toNext)}</b> · ${left} hiding`;
  } else if (S.phase === 'ended') { t.textContent = 'Done'; sub.textContent = `round ${S.round}`; }
  else { t.textContent = S.code; sub.textContent = `${Object.keys(S.players).length} in lobby`; }
  // seeker blindfold during hide phase
  const blind = S.phase === 'hiding' && p && p.role === 'seeker';
  let bf = $('#blindfold');
  if (blind) {
    if (!bf) { bf = document.createElement('div'); bf.id = 'blindfold'; bf.className = 'blindfold'; document.body.appendChild(bf); }
    bf.innerHTML = `<div><small>Hide phase</small><h2>You're seeking</h2><p>Stay where you are. Hiders are on the move.</p><div class="mono">${fmt(S.huntStart - now)}</div><p>The map unlocks when the hunt starts.</p></div>`;
  } else if (bf) bf.remove();
}

function renderZone() {
  layers.zone.clearLayers();
  if (!S || !S.zone) return;
  const z = currentZone();
  const nz = nextZone();
  const full = S.phase === 'hunting' && S.settings.shrink ? S.zone : null;
  if (full) zoneLayer(full, { color: '#111111', weight: 1.5, opacity: .35, fill: false, dashArray: '2 6', interactive: false }).addTo(layers.zone);
  zoneLayer(z, { color: '#ff3b30', weight: 4, opacity: .95, fillColor: '#ff3b30', fillOpacity: .05, interactive: false }).addTo(layers.zone);
  if (nz) zoneLayer(nz, { color: '#111111', weight: 2, opacity: .7, fill: false, dashArray: '8 8', interactive: false }).addTo(layers.zone);
}
let lastZoneKey = '';

function nearestSeeker() {
  let best = null, bd = Infinity;
  for (const [id, x] of Object.entries(L_.seekerLocs)) { if (!myPos || id === me.id) continue; const dd = G.dist(myPos.p, x.p); if (dd < bd) { bd = dd; best = id; } }
  return best;
}
function renderMarks() {
  if (!S) return;
  const zk = S.phase + ':' + scaleAt(hostNow()).toFixed(3) + ':' + JSON.stringify(S.zone);
  if (zk !== lastZoneKey) { lastZoneKey = zk; renderZone(); }
  layers.marks.clearLayers();
  if (S.phase === 'lobby' || replay) return; // the replay draws its own dots; old last-known spots would just clutter it
  const now = hostNow();
  const p = mine();
  const iSeek = p && p.role === 'seeker';
  const blind = iSeek && S.phase === 'hunting' && now < (S.blackoutUntil || 0);
  document.body.classList.toggle('blackout', !!blind);
  const pin = (pt, html, z = 700, size = 34) => L.marker(pt, { icon: L.divIcon({ className: '', html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] }), zIndexOffset: z, interactive: false }).addTo(layers.marks);
  const ring = (pt, color, r = REACH_M) => L.circle(pt, { radius: r, color, weight: 2, dashArray: '4 4', fillOpacity: .1, interactive: false }).addTo(layers.marks);
  const RED = ROLE_INK.seeker, INK = ROLE_INK.hider;
  if (S.phase === 'hunting') {
    for (const x of S.drops || []) if (!x.claimedBy) { ring(x.p, RED, dropR()); pin(x.p, `<div class="map-pin solid bob">${ic('drops')}</div>`, 700, 28); }
    for (const f of S.flags || []) { ring(f.p, f.by ? INK : RED); pin(f.p, `<div class="map-pin ${f.by ? 'dark' : 'red'}">${ic('capture')}</div>`); }
    if (S.jail) { ring(S.jail.p, INK); pin(S.jail.p, `<div class="map-pin dark">${ic('jail')}</div>`); }
    if (S.treasure) { ring(S.treasure.p, RED, dropR()); pin(S.treasure.p, `<div class="map-pin solid bob">${ic('treasure')}</div>`, 700, 28); }
    if (S.potato && !S.potato.holder) { ring(S.potato.p, RED); pin(S.potato.p, `<div class="map-pin red bob">${ic('potato')}</div>`); }
    if (S.sprint && S.sprint.p) { ring(S.sprint.p, RED); pin(S.sprint.p, `<div class="map-pin solid bob">${ic('sprint')}</div>`, 800); }
    if (p && p.mission && alive(p)) { ring(p.mission.p, INK); pin(p.mission.p, `<div class="map-pin">${ic('missions')}</div>`); }
  }
  if (blind) return;
  // latest ping per hider + a short faded trail
  const byId = {};
  for (const x of L_.pings) (byId[x.id] = byId[x.id] || []).push(x);
  for (const [id, list] of Object.entries(byId)) {
    const pl = P(id);
    if (!pl) continue;
    const real = list.filter((x) => x.p);
    const last = real[real.length - 1];
    real.slice(-4, -1).forEach((x) => L.circleMarker(x.p, { radius: 4, color: INK, weight: 1, opacity: .35, fillOpacity: .2, interactive: false }).addTo(layers.marks));
    if (!last || (pl.caughtAt && S.phase !== 'ended')) continue;
    const loud = last.kind === 'breach' || last.kind === 'xray' || last.kind === 'live' || last.kind === 'away';
    const sub = last.kind === 'live' ? 'LIVE · ' + ago(now - last.t) : last.kind === 'breach' ? 'OUT OF ZONE' : last.kind === 'away' ? 'SCREEN OFF · ' + ago(now - last.t) : last.kind === 'xray' ? 'X-RAY · ' + ago(now - last.t) : (id === me.id ? 'your last ping · ' : '') + ago(now - last.t);
    for (const spot of [last.p, ...(last.alts || [])]) {
      if (last.blur) L.circle(spot, { radius: last.blur, color: loud ? RED : INK, weight: 1.5, opacity: .6, fillOpacity: .08, interactive: false }).addTo(layers.marks);
      L.marker(spot, { icon: blipIcon(loud ? RED : INK, esc(pl.name), sub, loud ? 'loud' : ''), zIndexOffset: 500 }).addTo(layers.marks);
    }
  }
  // catches
  for (const e of S.events) if (e.k === 'catch' && e.p) pin(e.p, `<div class="map-pin small dark">${ic('caught')}</div>`, 400, 26);
  // seekers visible to hiders via sonar, or to seeker teammates always
  for (const [id, s] of Object.entries(L_.seekerLocs)) {
    if (id === me.id || !P(id)) continue;
    if (now < L_.sonarUntil || iSeek || (now < L_.peekUntil && id === nearestSeeker())) {
      if (now - s.t > 45000) continue;
      L.marker(s.p, { icon: blipIcon(RED, esc(P(id).name), ago(now - s.t), 'seeker'), zIndexOffset: 600 }).addTo(layers.marks);
    }
  }
  if (S.phase === 'hunting' && S.wire && S.wire.holder === me.id) for (const [id, x] of Object.entries(L_.wireLocs)) {
    const q = P(id); if (!q || q.role !== 'hider' || !alive(q) || now - x.t > 15000) continue;
    L.marker(x.p, { icon: blipIcon(INK, esc(q.name), 'pass it here', 'loud'), zIndexOffset: 550 }).addTo(layers.marks);
  }
  if (L_.decoyArmed) pin(L_.decoyArmed, `<div class="map-pin small">${ic('decoy')}</div>`, 650, 26);
}


// ---------------- the bottom sheet ----------------
const sheet = $('#sheet');
let sheetView = '';
// animations play only when a screen or panel opens, not on every refresh
let enterT = 0;
function sheetEnter() { sheet.classList.add('enter'); clearTimeout(enterT); enterT = setTimeout(() => sheet.classList.remove('enter'), 800); }
function setSheet(html, view = '') {
  if (view !== sheetView) { sheetView = view; sheet.scrollTop = 0; sheetEnter(); } // a new screen starts at the top
  sheet.dataset.view = view;
  sheet.innerHTML = `<button class="grab" data-act="toggleSheet" aria-label="${sheetCollapsed ? 'Show panel' : 'Shrink panel to see the map'}"><span class="grab-t">${sheetCollapsed ? 'Show panel ▴' : 'See more map ▾'}</span></button>` + html;
  sheet.hidden = false;
  sheet.classList.toggle('collapsed', sheetCollapsed);
  sheet.classList.toggle('play', view === 'play');
  if (view !== 'chatmode') sheet.classList.remove('chatmode');
  requestAnimationFrame(() => document.documentElement.style.setProperty('--sheet-h', (window.innerWidth < 720 ? sheet.offsetHeight : 0) + 'px'));
}
function selectHtml(key, val, disabled) {
  return `<select data-set="${key}" ${disabled ? 'disabled' : ''}>${OPTS[key].map(([v, l]) => `<option value="${v}" ${String(v) === String(val) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
}
function optLabel(key, val) {
  const o = OPTS[key].find(([v]) => String(v) === String(val));
  if (o) return o[1];
  if (/Sec$/.test(key)) return +val % 60 ? `${val} s` : `${val / 60} min`;
  return /M$/.test(key) ? `${val} m` : String(val);
}
function avatar(p, cls = '') { return `<span class="av ${cls} ${p && charOf(p.icon) ? 'has-ch' : ''}"${p && p.tinted && !/\bout\b/.test(cls) ? ` style="background:${p.color};color:#111"` : ''}>${(p && lookHtml(p.icon)) || esc(Array.from((p && p.name) || '?')[0] || '?')}</span>`; }
const roleCls = (r) => (r === 'seeker' ? 'seeker' : r === 'hider' ? 'hider' : '');
function playerRow(id, extra = '', cls = '', pre = '') {
  const p = P(id); const on = peers.has(id);
  return `<div class="player ${on ? '' : 'off'}">${pre}${avatar(p, cls)}<span class="nm"><span style="overflow:hidden;text-overflow:ellipsis">${esc(p.name)}</span>${id === me.id ? '<span class="you">(you)</span>' : ''}${id === S.hostId ? `<span class="host" title="Host">${ic('crown')}</span>` : ''}</span>${extra}</div>`;
}

function renderSheet() {
  if (chatOpen) { renderChat(); return; }
  if (!S) {
    setSheet(`<div class="sheet-h"><h2>Joining ${esc(code || '')}…</h2></div><p class="note">Connecting to the game. Keep this screen open.</p><div class="big-actions"><button class="btn" data-act="leave">Back</button></div>`);
    return;
  }
  if (S.phase === 'lobby') return mapView ? renderMapView() : renderLobby();
  if (S.phase === 'ended') return renderEnded();
  renderPlaying();
}

function geoNote() {
  if (geoBlocked) return `<p class="note warn">${ic('pin')}<span>${esc(geoError)}</span><button class="btn small primary" data-act="allowGeo">Allow location</button></p>`;
  if (geoError) return `<p class="note warn">${ic('pin')}<span>${esc(geoError)}</span></p>`;
  if (!myPos) return `<p class="note">${ic('pin')}<span>Finding your location…</span></p>`;
  if (myPos.acc > GPS_POOR) return `<p class="note warn">${ic('pin')}<span>Weak GPS (±${myPos.acc} m). Step outside, away from tall buildings, for fair tags.</span></p>`;
  return '';
}

function zonePanel(host, inMap) {
  const z = S.zone;
  const zoneInfo = z ? `${z.type === 'circle' ? 'Circle, ' + G.fmtDist(z.r) + ' radius' : 'Custom shape, ' + z.pts.length + ' corners'} · ${(G.zoneArea(z) / 1e6).toFixed(2)} km²` : host ? 'No zone yet. Pick one below.' : 'The host is choosing the play zone.';
  const drafting = host && zoneDraft;
  let zoneTools = '';
  if (host) {
    if (drafting && !inMap) zoneTools = `<p class="note">You're drawing a zone.</p><div class="big-actions"><button class="btn small" data-act="zoneCancel">Cancel</button><button class="btn primary small" data-act="openMap">${ic('shape')}Keep drawing on the map</button></div>`;
    else if (!drafting) zoneTools = `<div class="tools"><button class="btn small" data-act="zoneHere" ${myPos ? '' : 'disabled'}>${ic('locate')}Around me</button><button class="btn small" data-act="drawCircle">${ic('circle')}Pick a circle</button><button class="btn small" data-act="drawPoly">${ic('shape')}Draw a shape</button></div>`;
    else if (zoneDraft.type === 'circle') zoneTools = `<p class="note">${zoneDraft.c ? 'Drag the slider to size it, or tap the map to move it.' : 'Tap the map to drop the center.'}</p>
      <input type="range" class="range" min="50" max="3000" step="25" value="${zoneDraft.r}" data-act="radius" aria-label="Zone radius"><div class="row"><span class="note" style="margin:0">Radius ${G.fmtDist(zoneDraft.r)}</span></div>
      <div class="big-actions"><button class="btn" data-act="zoneCancel">Cancel</button><button class="btn primary" data-act="zoneSave" ${zoneDraft.c ? '' : 'disabled'}>Use this zone</button></div>`;
    else zoneTools = `<p class="note">Tap the map to add corners (${zoneDraft.pts.length} so far, need 3+).</p>
      <div class="big-actions"><button class="btn small" data-act="zoneUndo">Undo</button><button class="btn small" data-act="zoneCancel">Cancel</button><button class="btn primary small" data-act="zoneSave" ${zoneDraft.pts.length >= 3 ? '' : 'disabled'}>Use this zone</button></div>`;
  }
  return { zoneInfo, zoneTools };
}
// map view: the sheet only holds the zone tools, so the map is free to pan, zoom and tap
function renderMapView() {
  const { zoneInfo, zoneTools } = zonePanel(isHost(), true);
  setSheet(`<div class="sheet-h"><h2>Play zone</h2><button class="btn small" data-act="mapDone">Back to lobby</button></div>
    <p class="note" style="margin:0 0 10px">${zoneInfo}</p>${zoneTools}`, 'map');
}
function setMapBtn() {
  document.body.classList.toggle('lobby', !!S && S.phase === 'lobby');
  document.body.classList.toggle('lobby-full', !!S && S.phase === 'lobby' && !mapView && !chatOpen);
  const b = $('#btn-map'); if (!b) return;
  const on = mapView && !chatOpen;
  b.hidden = !S || S.phase !== 'lobby';
  const c = $('#btn-chat'); if (c) c.hidden = inGame();
  const nb = $('#btn-north'); if (nb) nb.hidden = !S || S.phase === 'lobby';
  const fb = $('#btn-fit'); if (fb) fb.hidden = !S || S.phase === 'lobby'; // the lobby's Map button shows the zone
  b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
}
function setMapView(on) {
  mapView = on;
  if (on) { chatOpen = false; sheetCollapsed = false; }
  renderSheet(); setMapBtn();
  if (on && S && S.zone && !zoneDraft) requestAnimationFrame(() => fitZone(S.zone));
}

const CORE = [
  ['classic', 'hide', 'Classic', 'Caught hiders are out'],
  ['infection', 'infection', 'Infection', 'Caught hiders join the seekers'],
  ['jail', 'jail', 'Jailbreak', 'Caught hiders go to jail and can be freed'],
  ['fugitive', 'fugitive', 'Fugitive', 'One runner, everyone else hunts'],
];
const OTHER_MODES = ['missions', 'capture', 'treasure', 'duel', 'wire', 'potato', 'sprint'];
const SHORT = { capture: 'Capture points', treasure: 'Treasure drops', duel: 'Showdown', wire: 'Live wire', potato: 'Hot potato', sprint: 'Final sprint', starter: 'Starter power-ups', drops: 'Supply drops', shrink: 'Shrinking zone', strictZone: 'Strict zone', missions: 'Missions' };
const coreOf = (s) => (s.fugitive ? 'fugitive' : s.jail ? 'jail' : s.infection ? 'infection' : 'classic');
function modeInfoModal() {
  const row = (icn, t, d) => `<div class="mi-row">${ic(icn)}<div><b>${t}</b><span>${d}</span></div></div>`;
  const desc = Object.fromEntries(MODES.map(([k, , d]) => [k, d]));
  modal(`<h3>Game modes</h3><div class="mi-list">
    <div class="mi-t">Core mode · pick one</div>${CORE.map(([k, icn, t, d]) => row(icn, t, k === 'classic' ? d : desc[k])).join('')}
    <div class="mi-t">Other modes · mix and match</div>${OTHER_MODES.map((k) => row(k, SHORT[k], desc[k])).join('')}
    <div class="mi-t">Power-ups &amp; events</div>${['starter', 'drops'].map((k) => row(k, SHORT[k], desc[k])).join('')}
    <div class="mi-t">Zone rules</div>${['shrink', 'strictZone'].map((k) => row(k, SHORT[k], desc[k])).join('')}
  </div><button class="btn dark" data-act="closeModal" style="width:100%;margin-top:14px">Got it</button>`);
}

function renderLobby() {
  const host = isHost();
  const s = S.settings;
  const ids = Object.keys(S.players).sort((a, b) => S.players[a].joinedAt - S.players[b].joinedAt);
  const online = ids.filter((id) => peers.has(id));
  const canStart = host && S.zone && online.length >= 2;
  const { zoneInfo, zoneTools } = zonePanel(host, false);
  const g = gpsInfo();
  const n = ids.length;

  // 1. summary
  const summary = `<div class="card sum">
    <div class="sum-c sum-st"><span class="sum-l">Lobby</span><span class="gps-chip lob ${g ? g.cls : ''}">${g ? g.text : 'No GPS yet'}</span></div>
    <div class="sum-c sum-code"><span class="sum-l">Game code</span><span class="code-big mono">${esc(S.code)}</span></div>
    <div class="sum-c sum-n">${ic('users')}<span><b>${n}</b> player${n === 1 ? '' : 's'}<br>in lobby</span></div>
    <div class="sum-btns"><button class="sq" data-act="share">${ic('share')}<span>Invite</span></button><button class="sq" data-act="qr">${ic('qr')}<span>QR</span></button></div>
  </div>`;

  // 2. players + shop
  const pRow = (id, full) => playerRow(id, full ? `${noLoc(id) ? `<span class="noloc">${ic('pin')}No location</span>` : ''}<span class="meta">${S.totals[id] ? S.totals[id] + ' pts' : ''}</span>${host && id !== me.id ? `<button class="x" data-act="kick" data-id="${id}" aria-label="Remove ${esc(S.players[id].name)}">${ic('close')}</button>` : ''}` : noLoc(id) ? `<span class="noloc sm" title="No location">${ic('pin')}</span>` : '');
  // collapsed: show players missing location first so the warning is visible
  const shownIds = playersOpen ? ids : [...ids].sort((x, y) => noLoc(y) - noLoc(x)).slice(0, 2);
  const players = `<div class="card pl-card ${playersOpen ? 'open' : ''}">
    <button class="card-tap" data-act="togglePlayers">${ic('users')}<span class="ct">Players</span><span class="cnt">${online.length}</span>${ic(playersOpen ? 'chevD' : 'chevR', 'chev')}</button>
    <div class="players">${shownIds.map((id) => pRow(id, playersOpen)).join('')}${!playersOpen && n > 2 ? `<button class="more" data-act="togglePlayers">+${n - 2} more</button>` : ''}</div>
  </div>`;
  const duo = `<div class="duo ${playersOpen || shopOpen ? 'open' : ''}">${players}${shopHtml(true)}</div>`;

  // 3. zone
  const zone = `<div class="card"><div class="card-h">${ic('locate')}<span class="ct">Play zone</span></div>${S.zone || !host ? `<p class="card-note">${zoneInfo}</p>` : ''}${zoneTools}</div>`;

  // 4. modes
  const tog = (k, cls) => `<label class="tg ${cls} ${s[k] ? 'on' : ''}"><span class="mi">${ic(k)}</span><span class="tn">${SHORT[k]}</span><span class="sw"><input type="checkbox" data-set="${k}" ${s[k] ? 'checked' : ''} aria-label="${SHORT[k]}"><span></span></span></label>`;
  const chip = (k) => `<span class="mchip">${ic(k)}${SHORT[k]}</span>`;
  const chips = (keys) => { const on = keys.filter((k) => s[k]); return on.length ? `<div class="mchips">${on.map(chip).join('')}</div>` : '<p class="card-note" style="margin:0">None</p>'; };
  const core = coreOf(s);
  const coreHtml = (host ? CORE : CORE.filter(([k]) => k === core)).map(([k, icn, t, d]) => `<button class="core ${k === core ? 'on' : ''}" ${host ? `data-act="core" data-k="${k}"` : 'disabled'} aria-pressed="${k === core}"><span class="mi">${ic(icn)}</span><span class="mt"><b>${t}</b><small>${d}</small></span>${k === core ? `<span class="ck">${ic('check')}</span>` : ''}</button>`).join('');
  const modes = `<div class="card"><div class="card-h">${ic('gamepad')}<span class="ct">Game mode</span><button class="ib" data-act="modeInfo" aria-label="What the modes do">${ic('info')}</button></div>
    <div class="cores ${host ? '' : 'one'}">${coreHtml}</div>
  </div>`;
  // everything optional lives in one card, closed by default, with a one-line summary of what's on
  const EXTRA = [...OTHER_MODES, 'starter', 'drops', 'shrink', 'strictZone'];
  const extrasOn = EXTRA.filter((k) => s[k]);
  const moreSum = extrasOn.length ? extrasOn.map((k) => SHORT[k]).join(', ') : 'None. Tap to add twists like Missions or a Shrinking zone.';
  const moreBody = host ? `<div class="more-body">
      <div><div class="sub-t">Twists</div><div class="tg3">${OTHER_MODES.map((k) => tog(k, 'sm')).join('')}</div></div>
      <div><div class="sub-t">Power-ups &amp; events</div><div class="tg2">${tog('starter', 'lg')}${tog('drops', 'lg')}</div></div>
      <div><div class="sub-t">Zone rules</div><div class="tg2">${tog('shrink', 'lg')}${tog('strictZone', 'lg')}</div></div>
    </div>` : chips(EXTRA);
  const more = `<div class="card"><button class="card-tap" data-act="toggleExtras" aria-expanded="${moreOpen}">${ic('layers')}<span class="ct">More modes${extrasOn.length ? ` <small>· ${extrasOn.length} on</small>` : ''}</span>${ic('chevD', 'chev' + (moreOpen ? ' up' : ''))}</button>${moreOpen ? moreBody : `<p class="more-sum">${esc(moreSum)}</p>`}</div>`;

  // 5. rules
  const set = (lbl, key, val, cls = '') => `<label class="st ${cls}"><span>${lbl}</span>${selectHtml(key, val, false)}</label>`;
  const rulesBody = host ? `<div class="st-grid">
    ${set('How tags work', 'tagMode', s.tagMode, 's4')}
    ${set('Hide time', 'hideSec', s.hideSec)}${set('Round length', 'huntSec', s.huntSec)}${set('Ping every', 'pingSec', s.pingSec)}${set('Ping fuzz', 'blurM', s.blurM)}
    ${s.fugitive ? '' : set('Seekers', 'seekers', s.seekers)}
    ${s.tagMode === 'gps' ? set('Tag range', 'tagRadiusM', s.tagRadiusM) : ''}
    ${set("Seeker alarm (hiders' phones)", 'alarmM', s.alarmM ?? 0, 's2')}
    ${s.shrink ? set('Zone', 'shrinkStyle', s.shrinkStyle || 'steps', 's2') + set('Final zone', 'shrinkTo', s.shrinkTo, 's2') : ''}
    ${s.drops ? set('Supply drops', 'dropSec', s.dropSec, 's2') : ''}
    ${s.drops || s.treasure ? set('Drop size', 'dropM', s.dropM || 10) : ''}
    ${s.duel ? set('Showdowns', 'duelSec', s.duelSec, 's2') : ''}
    ${s.wire ? set('Live wire fuse', 'wireSec', s.wireSec) : ''}
  </div>` : `<div class="mode-lines" style="margin:0">
    <div>${ic('clock')}<span class="txt"><b>${optLabel('hideSec', s.hideSec)}</b> to hide, then a <b>${optLabel('huntSec', s.huntSec)}</b> hunt</span></div>
    <div>${ic('pin')}<span class="txt">Hiders ping every <b>${optLabel('pingSec', s.pingSec)}</b>${+s.blurM ? `, fuzzed by ${optLabel('blurM', s.blurM)}` : ', exact spot'}</span></div>
    <div>${ic('tag')}<span class="txt">${s.tagMode === 'gps' ? `Tag by getting within <b>${optLabel('tagRadiusM', s.tagRadiusM)}</b>` : s.tagMode === 'honor' ? 'Honor tags: tag them for real, they confirm' : 'Photo tags: snap them, they confirm'}</span></div>
    <div>${ic('eye')}<span class="txt">${s.fugitive ? 'One runner, everyone else seeks' : `<b>${s.seekers}</b> seeker${s.seekers > 1 ? 's' : ''} to start`}</span></div>
    ${+s.alarmM ? `<div>${ic('sonar')}<span class="txt">Hiders' phones play an alarm when a seeker is within <b>${s.alarmM} m</b>. It gets louder the closer they get</span></div>` : ''}
  </div>`;
  const rulesSum = `${optLabel('hideSec', s.hideSec)} to hide · ${optLabel('huntSec', s.huntSec)} hunt · ping every ${optLabel('pingSec', s.pingSec)}`;
  const rules = `<div class="card"><button class="card-tap" data-act="toggleRules" aria-expanded="${rulesOpen || !host}">${ic('sliders')}<span class="ct">Rules &amp; settings${host ? '' : ' <small>· set by the host</small>'}</span>${host ? ic('chevD', 'chev' + (rulesOpen ? ' up' : '')) : ''}</button>${rulesOpen || !host ? rulesBody : `<p class="more-sum">${esc(rulesSum)}</p>`}</div>`;

  const noLocIds = online.filter(noLoc);
  setSheet(`<div class="lob">
    ${geoNote()}
    ${summary}${duo}${zone}${modes}${more}${rules}
    ${noLocIds.length ? `<p class="note warn">${ic('pin')}<span>${noLocIds.map((id) => esc(S.players[id].name)).join(', ')} ${noLocIds.length > 1 ? "haven't" : "hasn't"} shared location. They can tap the settings button at the top.</span></p>` : ''}
    <div class="lob-foot">
      ${host && !canStart ? `<p class="hint">${!S.zone ? 'Set a play zone to start.' : 'Need at least 2 players.'}</p>` : ''}
      <div class="lob-btns"><button class="btn big lv" data-act="leave">Leave</button>
      ${host ? `<button class="btn primary big" data-act="start" ${canStart ? '' : 'disabled'}>Start round</button>` : `<button class="btn big" disabled>Waiting for host</button>`}</div>
    </div>
  </div>`, 'lobby');
}

function itemsHtml(role) {
  const p = mine();
  if (!p) return '';
  const inv = p.inv || {}, fx = p.fx || {}, now = hostNow();
  const locked = role === 'hider' && now < (S.lockdownUntil || 0);
  const armedOf = (k) => (k === 'decoy' && (L_.decoyArmed || L_.placingDecoy)) || (k === 'jammer' && L_.jamArmed) || (k === 'swarm' && L_.swarmArmed)
    || (k === 'shield' && fx.shield) || (k === 'ghost' && now < (fx.ghostUntil || 0)) || (k === 'cloak' && now < (fx.ghostUntil || 0)) || (k === 'pass' && (inv.pass || 0) > 0);
  const keys = Object.keys(ITEM_INFO).filter((k) => ITEM_INFO[k].role === role && ((inv[k] || 0) > 0 || armedOf(k)));
  const how = [S.settings.drops && 'grab a supply drop', role === 'seeker' && 'catch someone', role === 'hider' && S.settings.missions && 'finish a mission'].filter(Boolean).join(' or ');
  const head = '<div class="section-t" style="margin-top:18px">Power-ups</div>';
  if (!keys.length) return puOn(S.settings) ? `${head}<p class="hint" style="text-align:left;margin:0">None right now.${how ? ' To get one, ' + how + '.' : ''}</p>` : '';
  const picker = L_.spotPick ? `<div class="section-t" style="margin-top:10px">Spotlight who?</div><div class="row">${Object.entries(S.players).filter(([, x]) => x.role === 'hider' && alive(x)).map(([id, x]) => `<button class="btn small" data-act="spotTarget" data-id="${id}">${esc(x.name)}</button>`).join('')}<button class="btn small ghost" data-act="spotCancel">Cancel</button></div>` : '';
  return `${head}${locked ? `<p class="hint" style="text-align:left;margin:0;color:var(--red);font-weight:700">Locked down: power-ups unusable for ${fmt(S.lockdownUntil - now)}</p>` : ''}${picker}<div class="items">${keys.map((k) => {
    const n = inv[k] || 0, armed = armedOf(k);
    return `<button class="item ${armed ? 'armed' : ''} ${ITEM_INFO[k].sup ? 'super' : ''}" data-act="item" data-item="${k}" ${(n <= 0 && !(k === 'decoy' && L_.placingDecoy)) || k === 'pass' || locked ? 'disabled' : ''}>${ic(k)}${ITEM_INFO[k].name}${n > 1 ? `<span class="n">×${n}</span>` : ''}<small>${armed && n <= 0 ? 'Active' : ITEM_INFO[k].desc}</small></button>`;
  }).join('')}</div>`;
}
function modeLines(p, now) {
  const L2 = [];
  const far = (pt) => (myPos ? G.fmtDist(G.dist(myPos.p, pt)) + ' away' : 'see map');
  const row = (i, t, x = '') => `<div>${ic(i)}<span class="txt">${t}</span>${x}</div>`;
  const wrap = (rows) => (rows.length ? `<div class="mode-lines">${rows.join('')}</div>` : '');
  if (p.role === 'hider' && p.extracted) return wrap([row('sprint', 'You escaped. Sit back and watch.')]);
  if (p.role === 'hider' && p.caughtAt && S.jail) return wrap([row('jail', `You're in jail (${far(S.jail.p)}). Walk there and wait. A free hider who reaches it breaks everyone out.`)]);
  if (p.role === 'hider' && alive(p)) {
    if (p.mission) L2.push(row('missions', `Secret mission: reach your target, ${far(p.mission.p)}`));
    for (const f of S.flags || []) if (L_.capStart[f.id]) L2.push(row('capture', `Capturing: <b>${Math.min(100, Math.floor((now - L_.capStart[f.id]) / 600))}%</b> · stay put`));
    if (S.jail && Object.values(S.players).some((x) => x.role === 'hider' && x.caughtAt)) L2.push(row('jail', `Friends in jail, ${far(S.jail.p)}${now < (S.jailCooldownUntil || 0) ? ' · locked for ' + fmt(S.jailCooldownUntil - now) : ''}`));
    if (S.potato && S.potato.holder === me.id) L2.push(row('potato', 'You have the hot potato: double points, extra pings', '<button class="btn small" data-act="dropPotato">Drop it</button>'));
  }
  if (S.treasure) L2.push(row('treasure', p.role === 'hider' && alive(p) ? `Treasure chest, ${far(S.treasure.p)}: +${TREASURE_PTS}, but grabbing it pings your exact spot` : 'Treasure chest on the map. Hiders who grab it ping their exact spot'));
  if (S.duel && (S.duel.a === me.id || S.duel.b === me.id) && !L_.duelSent[duelKey(S.duel)]) L2.push(row('duel', `Showdown vs ${nm(S.duel.a === me.id ? S.duel.b : S.duel.a)}: ${DUEL_NAMES[S.duel.game]}`, '<button class="btn small" data-act="duelOpen">Play</button>'));
  if (p.live && alive(p)) L2.push(row('wire', 'You are LIVE: seekers see where you are'));
  if (S.potato && !S.potato.holder && (p.role === 'seeker' || alive(p))) L2.push(row('potato', 'The hot potato is up for grabs'));
  if (S.sprint && S.sprint.p) L2.push(row('sprint', `Extraction open, ${far(S.sprint.p)}`));
  else if (S.sprint && p.role === 'hider' && alive(p)) L2.push(row('sprint', `Extraction opens in ${fmt(S.sprint.at - now)}`));
  return wrap(L2);
}
function goalCard(p) {
  const hunting = S.phase === 'hunting';
  const card = (cls, i, t, d) => `<div class="goal ${cls}">${ic(i)}<div><b>${t}</b><span>${d}</span></div></div>`;
  if (p.role === 'hider' && p.extracted) return card('out', 'sprint', 'Escaped', 'You made it out. Watch the rest of the round.');
  if (p.role === 'hider' && p.caughtAt) return card('out', 'caught', 'Caught', S.jail ? 'Get to the jail and wait for a rescue.' : 'You are out this round. Watch how it plays out.');
  if (p.role === 'seeker') return card('seeker', 'eye', p.startRole === 'hider' ? 'Seeker · infected' : 'Seeker', hunting ? 'Follow the pings on the map and tag the hiders.' : 'Stay put. The hunt starts when the timer hits zero.');
  return card('', 'hide', 'Hider', hunting ? `Stay hidden inside the red line. Your phone shows seekers your rough spot every ${optLabel('pingSec', S.settings.pingSec)}.` : 'Get inside the red line and find a hiding spot before the seekers are released.');
}

function modeSeg() {
  return `<div class="seg mode-seg"><button class="${chatOpen ? '' : 'on'}" data-act="modeMap">${ic('pin')}Map</button><button class="${chatOpen ? 'on' : ''}" data-act="modeChat">${ic('chat')}Chat<b id="chat-n" class="pu-n" ${unreadN && !chatOpen ? '' : 'hidden'}>${unreadN}</b></button></div>`;
}
function renderPlaying() {
  const p = mine();
  if (!p) { setSheet(`<div class="sheet-h"><h2>Round in progress</h2></div><p class="note">You'll join as a seeker in a moment.</p>`); return; }
  const host = isHost();
  const hiders = Object.entries(S.players).filter(([, x]) => x.startRole === 'hider');
  const left = hiders.filter(([, x]) => !x.caughtAt && !x.extracted).length;
  const status = hiders.map(([, x]) => `<span class="chip ${x.caughtAt ? 'out' : ''}">${avatar(x, x.caughtAt ? 'out' : 'hider')}${esc(x.name)}</span>`).join('');
  // play screen stays small so the map shows: stats, TAG, and buttons that open power-ups and the rest
  const role = p.role === 'seeker' ? 'seeker' : 'hider';
  const inv = p.inv || {}, nPU = Object.keys(ITEM_INFO).filter((k) => ITEM_INFO[k].role === role && (inv[k] || 0) > 0).reduce((a, k) => a + inv[k], 0);
  const canPU = p.role === 'seeker' || alive(p);
  const tm = S.settings.tagMode || 'gps';
  const shop = shopHtml(), bal = (S.wallet || {})[me.id] || 0;
  const row = `<div class="play-row">
    ${shop ? `<button class="btn small shop-btn ${L_.showShop ? 'on' : ''}" data-act="toggleShop" aria-expanded="${!!L_.showShop}">${ic('shop')}Shop <span class="mono">${bal}</span></button>` : ''}
    <button class="btn small ghost" data-act="toggleMore" aria-expanded="${!!L_.showMore}">${L_.showMore ? 'Less' : 'More'}</button>
    ${canPU ? `<button class="btn small pu-btn ${L_.showPU ? 'on' : ''}" data-act="togglePU" aria-expanded="${!!L_.showPU}">${ic('bolt')}Power-ups${nPU ? ` <b class="pu-n">${nPU}</b>` : ''}</button>` : ''}
    </div>`;
  const tagBtn = p.role === 'seeker' ? `<button class="tag-btn" data-act="${tm === 'photo' ? 'snap' : 'tag'}" ${S.phase === 'hunting' && (myPos || tm !== 'gps') ? '' : 'disabled'}>${ic(tm === 'photo' ? 'camera' : 'tag')}${tm === 'photo' ? 'SNAP TAG' : 'TAG'}</button>
      <input type="file" id="snap-in" accept="image/*" capture="environment" hidden>` : '';
  setSheet(`<div class="play-compact">
    ${modeSeg()}
    <button class="last-up" id="last-up" data-act="modeChat" hidden></button>
    ${geoNote()}
    <div id="dyn"></div>
    ${tagBtn}
    ${L_.placingDecoy ? `<p class="hint" style="color:var(--red);font-weight:700">Tap the map inside the zone to place your decoy.</p>` : ''}
    ${row}
    ${L_.showPU && canPU ? `<div class="pu-panel">${itemsHtml(role) || '<p class="hint" style="text-align:left;margin:0">No power-ups in this game.</p>'}</div>` : ''}
    ${L_.showShop && shop ? `<div class="pu-panel">${shop}</div>` : ''}
    ${L_.showMore ? `${p.role === 'hider' && alive(p) ? '<div class="big-actions"><button class="btn small" data-act="selfCaught">I got caught</button></div>' : ''}${goalCard(p)}${p.role === 'seeker' ? `<p class="hint">${TAG_HINT[tm](S.settings)}</p>` : ''}
    ${hiders.length ? `<div class="section"><div class="section-t">Hiders · ${left} left</div><div class="hiders-row">${status}</div></div>` : ''}
    ${host ? `<div class="big-actions"><button class="btn small ghost" data-act="ruleCatch">Rule a catch</button><button class="btn small ghost" data-act="endNow">End round</button></div>` : ''}` : ''}
  </div>  `, 'play');
  showLastUp();
  renderDynamicSheet();
}

function renderDynamicSheet() {
  const el = $('#dyn');
  if (!el || !S) return;
  const p = mine(); if (!p) return;
  const now = hostNow();
  if (p.role === 'seeker') {
    // closest known hider blip
    const latest = {};
    for (const x of L_.pings) if (x.p) latest[x.id] = x;
    let best = null;
    for (const [id, x] of Object.entries(latest)) {
      const pl = P(id); if (!pl || pl.caughtAt) continue;
      const d = myPos ? G.dist(myPos.p, x.p) : null;
      if (!best || (d !== null && d < best.d)) best = { id, d, t: x.t };
    }
    el.innerHTML = `<div class="stat-row" style="margin-bottom:12px">
      <div class="stat"><b>${best && best.d !== null ? G.fmtDist(best.d) : '—'}</b><span>${best ? 'to ' + nm(best.id) + "'s last ping" : 'no pings yet'}</span></div>
      <div class="stat"><b class="mono">${S.phase === 'hunting' ? fmt(pingMs() - ((now - S.huntStart) % pingMs())) : fmt(S.huntStart - now)}</b><span>${S.phase === 'hunting' ? 'until next ping' : 'until the hunt'}</span></div></div>${modeLines(p, now)}`;
  } else if (p.caughtAt) {
    el.innerHTML = p.extracted || S.jail ? modeLines(p, now) : '';
  } else {
    const z = currentZone(now);
    const ed = myPos && z ? G.edgeDistance(myPos.p, z) : null;
    el.innerHTML = `<div class="stat-row" style="margin-bottom:4px">
      <div class="stat"><b class="mono">${S.phase === 'hunting' ? fmt(pingMs() - ((now - S.huntStart) % pingMs())) : fmt(S.huntStart - now)}</b><span>${S.phase === 'hunting' ? 'until you ping' : 'to hide'}</span></div>
      <div class="stat ${ed !== null && ed < 0 ? 'alert' : ''}"><b>${ed === null ? '—' : ed >= 0 ? G.fmtDist(ed) : 'OUT'}</b><span>${ed === null || ed >= 0 ? 'to the zone edge' : 'of the zone!'}</span></div></div>${modeLines(p, now)}`;
  }
}

function renderEnded() {
  if (replay) {
    setSheet(`<div class="sheet-h"><h2>Replay · round ${S.round}</h2><button class="btn small" data-act="replayClose">Scores</button></div>
      <div class="replay"><button class="btn small" data-act="replayPlay" aria-label="${replay.playing ? 'Pause' : 'Play'}">${ic(replay.playing ? 'pause' : 'play')}</button><input type="range" min="0" max="1000" value="${Math.round(replay.pos * 1000)}" data-act="replaySeek" aria-label="Replay position"><span class="mono note" style="margin:0" id="rp-t"></span></div>
      <p class="note">Black paths are hiders, red paths are seekers. X markers show where people got caught. Paths show up as each phone sends them in.</p>`, 'replay');
    return;
  }
  const r = S.results || {};
  const ids = Object.keys(S.players);
  const roundRank = ids.slice().sort((a, b) => (r[b]?.pts || 0) - (r[a]?.pts || 0));
  const totRank = ids.slice().sort((a, b) => (S.totals[b] || 0) - (S.totals[a] || 0));
  const survivors = ids.filter((id) => r[id]?.survived);
  const medal = ['🥇', '🥈', '🥉'];
  const line = (id, i, pts, meta, cls) => playerRow(id, `<span class="meta">${meta}</span><span class="pts">${pts}</span>`, cls, `<span class="rk">${medal[i] || i + 1}</span>`);
  setSheet(`
    <div class="result-hero ${survivors.length ? 'hiders' : ''}"><small>${S.endWhy === 'host' ? 'Ended by the host · ' : ''}Game over · Round ${S.round}</small><h2>${endHeadline()}</h2></div>
    <div class="section"><div class="section-t">Scoreboard</div><div class="lb">
      ${roundRank.map((id, i) => { const x = r[id] || {}; const meta = x.startRole === 'hider' ? (x.extracted ? 'escaped' : x.survived ? 'survived' : 'hid ' + fmt(x.survivedMs)) : (x.catches ? x.catches + ' catch' + (x.catches > 1 ? 'es' : '') : 'seeker'); return line(id, i, '+' + (x.pts || 0), meta, roleCls(x.startRole)); }).join('')}
    </div></div>
    <div class="end-actions">
      <button class="btn big dark" data-act="replay">${ic('play')}Watch the replay</button>
      ${isHost() ? `<button class="btn primary big" data-act="again">Next round</button>` : `<button class="btn big" disabled>Host starts next round</button>`}
    </div>
    <button class="btn small ghost end-more" data-act="endMore" aria-expanded="${endMore}">${endMore ? 'Less' : 'Overall scores, shop and more'}</button>
    ${endMore ? `<div class="pu-panel"><div class="section"><div class="section-t">Overall</div><div class="lb">
      ${totRank.map((id, i) => line(id, i, S.totals[id] || 0, '', '')).join('')}
    </div></div>
    ${shopHtml()}
    <div class="big-actions"><button class="btn ghost" data-act="leave">Leave game</button></div></div>` : ''}
  `, 'ended');
}

// ---------------- replay ----------------
function startReplay() {
  replay = { pos: 0, playing: true, t0: S.roundStart, t1: S.endedAt || hostNow() };
  sheetCollapsed = false;
  renderEnded();
  renderReplay();
  const step = () => {
    if (!replay || !replay.playing) return;
    replay.pos = Math.min(1, replay.pos + 1 / (20 * 30)); // ~20 s for the whole round
    if (replay.pos >= 1) replay.playing = false;
    renderReplay();
    const sl = $('[data-act="replaySeek"]'); if (sl) sl.value = Math.round(replay.pos * 1000);
    if (replay.playing) setTimeout(step, 33); else renderEnded();
  };
  step();
}
function renderReplay() {
  if (!replay) return;
  layers.replay.clearLayers();
  const t = replay.t0 + (replay.t1 - replay.t0) * replay.pos;
  const bounds = [];
  for (const [id, pts] of Object.entries(L_.tracks)) {
    const pl = P(id); if (!pl || !pts.length) continue;
    const rr = (S.results && S.results[id] && S.results[id].startRole) || pl.startRole || pl.role;
    const col = ROLE_INK[rr] || ROLE_INK.hider;
    pts.forEach((x) => bounds.push([x[0], x[1]]));
    const past = pts.filter((x) => x[2] <= t);
    if (!past.length) continue; // not on the map yet at this point in the replay
    // only the last ~2 minutes of path, so the map shows where people are now, not every place they've been
    const recent = past.filter((x) => x[2] >= t - 120000);
    if (recent.length > 1) {
      const ll = recent.map((x) => [x[0], x[1]]);
      L.polyline(ll, { color: '#fff', weight: 7, opacity: .85, interactive: false }).addTo(layers.replay);
      L.polyline(ll, { color: col, weight: 4, opacity: .95, interactive: false }).addTo(layers.replay);
    }
    const cur = past[past.length - 1];
    // a caught player's dot goes away once they're caught (unless they keep moving, e.g. infected into a seeker)
    if (pl.caughtAt && cur[2] < t - 30000 && S.events.some((e) => e.k === 'catch' && e.who === id && e.t <= t)) continue;
    L.marker([cur[0], cur[1]], { icon: blipIcon(col, esc(pl.name), '', rr === 'seeker' ? 'seeker' : ''), interactive: false }).addTo(layers.replay);
  }
  for (const e of S.events) if (e.k === 'catch' && e.p && e.t <= t) L.marker(e.p, { icon: L.divIcon({ className: '', html: `<div class="map-pin small dark">${ic('caught')}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }), interactive: false }).addTo(layers.replay);
  if (!replay.fitted && bounds.length) { fitTo(bounds); replay.fitted = true; }
  const lbl = $('#rp-t'); if (lbl) lbl.textContent = fmt(t - replay.t0);
}

// ---------------- chat ----------------
function renderChat() {
  const role = mine()?.role, game = inGame();
  unreadN = 0;
  const tm = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const line = (c) => c.sys ? `<div class="sys ${c.cls || ''}">${c.icon && ICONS[c.icon] ? ic(c.icon) : ''}<span>${c.html}</span><span class="tm">${tm(c.t)}</span></div>`
    : `<div class="msg ${c.team !== 'all' ? 'team' : ''} ${c.from === me.id ? 'mine' : ''}"><b class="${c.role === 'seeker' ? 'seeker' : ''}">${esc(c.name)}${c.team !== 'all' ? ' · team' : ''}</b><span class="tm">${tm(c.t)}</span><div>${esc(c.text)}</div></div>`;
  // already showing: just add the new lines, so typing isn't interrupted
  const key = `${game}|${chatTab}|${role}`, view = game ? 'chatmode' : 'chat', log0 = $('#chat-log');
  if (log0 && sheetView === view && sheet.dataset.ck === key) {
    const add = chat.filter((c) => c.cid > (+log0.dataset.last || 0));
    if (add.length) {
      const near = log0.scrollHeight - log0.scrollTop - log0.clientHeight < 80;
      log0.querySelector(':scope > .note')?.remove();
      log0.insertAdjacentHTML('beforeend', add.map(line).join(''));
      [...log0.children].slice(-add.length).forEach((x) => x.classList.add('new'));
      log0.dataset.last = add[add.length - 1].cid;
      if (near) log0.scrollTop = log0.scrollHeight;
    }
    return;
  }
  sheet.dataset.ck = key;
  const draft = $('#chat-in')?.value || '';
  setSheet(`
    ${game ? modeSeg() : `<div class="sheet-h"><h2>Chat</h2><button class="btn small" data-act="closeChat">Close</button></div>`}
    <div class="chat-log ${game ? 'full' : ''}" id="chat-log">${chat.length ? chat.map(line).join('') : `<p class="note">${game ? 'Game updates and messages show up here.' : 'No messages yet.'}</p>`}</div>
    <form class="chat-form" data-act="chatSend"><input id="chat-in" maxlength="200" placeholder="${chatTab === 'team' && role && S.phase !== 'lobby' ? `Message ${role === 'seeker' ? 'seekers' : 'hiders'} only` : 'Message everyone'}" autocomplete="off" aria-label="Message">
    ${S && S.phase !== 'lobby' && role ? `<button type="button" class="btn small ghost to-btn" data-act="chatTab" data-tab="${chatTab === 'team' ? 'all' : 'team'}">To ${chatTab === 'team' ? 'team' : 'all'}</button>` : ''}<button class="btn primary">Send</button></form>
  `, game ? 'chatmode' : 'chat');
  sheet.classList.toggle('chatmode', game);
  const inp = $('#chat-in'); if (inp && draft) inp.value = draft;
  const log = $('#chat-log'); if (log) { log.dataset.last = chat.length ? chat[chat.length - 1].cid : 0; log.scrollTop = log.scrollHeight; }
}

// ---------------- modal ----------------
function modal(html) {
  const m = $('#modal');
  $('.modal-card', m).innerHTML = html;
  m.hidden = false;
}
function closeModal() { $('#modal').hidden = true; }
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal' || e.target.closest('[data-act="closeModal"]')) closeModal(); else if (e.target.closest('[data-act="allowGeo"]')) retryGeo(true); });

function inviteUrl() { return location.origin + location.pathname + '?room=' + S.code; }

// ---------------- input handling ----------------
sheet.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'INPUT' || el.tagName === 'FORM') return;
  act(el.dataset.act, el);
});
sheet.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.act === 'radius' && zoneDraft) { zoneDraft.r = +el.value; drawDraft(); const n = el.parentElement.querySelector('.note'); const lbl = sheet.querySelector('.row .note'); if (lbl) lbl.textContent = 'Radius ' + G.fmtDist(zoneDraft.r); }
  if (el.dataset.act === 'replaySeek' && replay) { replay.pos = +el.value / 1000; replay.playing = false; renderReplay(); }
});
sheet.addEventListener('change', (e) => {
  const el = e.target;
  const key = el.dataset.set;
  if (!key || !isHost()) return;
  const val = el.type === 'checkbox' ? el.checked : isNaN(+el.value) ? el.value : +el.value;
  hostApply((s) => {
    s.settings[key] = val;
    if (key === 'infection' && val) s.settings.jail = false; // caught players can't both join the seekers and sit in jail
    if (key === 'jail' && val) s.settings.infection = false;
  });
});
sheet.addEventListener('submit', (e) => {
  e.preventDefault();
  const inp = $('#chat-in');
  const text = inp.value.trim();
  if (!text) return;
  const team = chatTab === 'team' && mine() ? mine().role : 'all';
  send('chat', { text, team });
  inp.value = '';
});

function act(a, el) {
  const p = mine();
  if (/^(togglePU|toggleMore|toggleShop|endMore)$/.test(a)) sheetEnter();
  switch (a) {
    case 'toggleSheet': sheetCollapsed = !sheetCollapsed; sheet.classList.toggle('collapsed', sheetCollapsed); { const g = $('.grab-t', sheet); if (g) g.textContent = sheetCollapsed ? 'Show panel ▴' : 'See more map ▾'; } document.documentElement.style.setProperty('--sheet-h', (window.innerWidth < 720 ? sheet.offsetHeight : 0) + 'px'); break;
    case 'allowGeo': retryGeo(true); break;
    case 'togglePlayers': playersOpen = !playersOpen; renderSheet(); break;
    case 'toggleRules': if (isHost()) { rulesOpen = !rulesOpen; renderSheet(); } break;
    case 'toggleExtras': moreOpen = !moreOpen; sheetEnter(); renderSheet(); break;
    case 'modeInfo': modeInfoModal(); break;
    case 'core': { const k = el.dataset.k; if (isHost()) hostApply((st) => { st.settings.infection = k === 'infection'; st.settings.jail = k === 'jail'; st.settings.fugitive = k === 'fugitive'; }); break; }
    case 'togglePU': L_.showPU = !L_.showPU; if (L_.showPU) L_.showMore = L_.showShop = false; renderSheet(); break;
    case 'toggleMore': L_.showMore = !L_.showMore; if (L_.showMore) L_.showPU = L_.showShop = false; renderSheet(); break;
    case 'endMore': endMore = !endMore; renderSheet(); break;
    case 'modeMap': chatOpen = false; renderSheet(); break;
    case 'modeChat': chatOpen = true; unreadN = 0; renderSheet(); break;
    case 'leave': if (!S || S.phase === 'lobby' || S.phase === 'ended' || confirm('Leave this game?')) leave(); break;
    case 'share': {
      const url = inviteUrl();
      if (navigator.share) navigator.share({ title: 'Ghostline', text: `Join my Ghostline game. Code ${S.code}`, url }).catch(() => {});
      else navigator.clipboard?.writeText(url).then(() => toast('Invite link copied', 'good', 'check'), () => toast(url));
      break;
    }
    case 'qr': {
      modal(`<h3>Scan to join ${esc(S.code)}</h3><div class="qr" id="qr"></div><button class="btn dark" data-act="closeModal" style="width:100%">Done</button>`);
      try { const q = qrcode(0, 'M'); q.addData(inviteUrl()); q.make(); $('#qr').innerHTML = q.createSvgTag({ cellSize: 6, margin: 0, scalable: true }); } catch { $('#qr').textContent = inviteUrl(); }
      break;
    }
    case 'kick': if (isHost() && confirm('Remove ' + P(el.dataset.id)?.name + '?')) hostApply((s) => { delete s.players[el.dataset.id]; s.kicked.push(el.dataset.id); }); break;
    case 'zoneHere': if (myPos) { mapView = true; hostApply((s) => { s.zone = { type: 'circle', c: myPos.p, r: 300 }; }); setMapBtn(); requestAnimationFrame(() => fitZone(S.zone)); } break;
    case 'drawCircle': zoneDraft = { type: 'circle', c: null, r: 300 }; toast('Tap the map to set the center'); setMapView(true); break;
    case 'drawPoly': zoneDraft = { type: 'poly', pts: [] }; toast('Tap the map to add corners'); setMapView(true); break;
    case 'openMap': setMapView(true); break;
    case 'mapDone': setMapView(false); break;
    case 'zoneUndo': zoneDraft.pts.pop(); drawDraft(); renderSheet(); break;
    case 'zoneCancel': zoneDraft = null; drawDraft(); renderSheet(); break;
    case 'zoneSave': {
      const z = zoneDraft.type === 'circle' ? { type: 'circle', c: zoneDraft.c, r: zoneDraft.r } : { type: 'poly', pts: zoneDraft.pts.slice() };
      zoneDraft = null; drawDraft();
      hostApply((s) => { s.zone = z; });
      fitZone(z);
      break;
    }
    case 'start': startRound(); break;
    case 'again': hostApply((s) => { s.phase = 'lobby'; s.events = []; s.results = null; for (const x of Object.values(s.players)) { x.role = 'hider'; x.caughtAt = null; x.inv = {}; x.fx = {}; x.extracted = null; x.mission = null; } s.drops = []; s.flags = []; s.jail = null; s.potato = null; s.sprint = null; s.treasure = null; s.wire = null; s.duel = null; for (const x of Object.values(s.players)) x.live = false; }); break;
    case 'endNow': if (confirm('End this round now?')) hostApply((s) => endRound(s, 'host')); break;
    case 'duelOpen': openDuel(); break;
    case 'dropPotato': if (myPos && S.potato && S.potato.holder === me.id) { send('potatoDrop', { p: myPos.p, acc: myPos.acc }); toast('You dropped the hot potato.', 'hider', 'potato'); } break;
    case 'snap': { const fi = $('#snap-in'); if (fi) { fi.value = ''; fi.click(); } break; }
    case 'ruleCatch': {
      const hs = Object.entries(S.players).filter(([, x]) => x.role === 'hider' && !x.caughtAt);
      modal(`<h3>Rule a catch</h3><p>Who got caught?</p><div class="stack">${hs.map(([id, x]) => `<button class="btn" data-act2="ruleWho" data-id="${id}">${avatar(x, roleCls(x.role))}${esc(x.name)}</button>`).join('') || '<p>No hiders left.</p>'}<button class="btn ghost" data-act="closeModal">Cancel</button></div>`);
      break;
    }
    case 'tag': {
      if (S.phase !== 'hunting') return;
      if ((S.settings.tagMode || 'gps') !== 'gps') { pickTarget((target) => sendTagReq(target, null)); return; }
      if (!myPos) return;
      if (Date.now() < L_.tagCooldown) { toast('Tag recharging…'); return; }
      L_.tagCooldown = Date.now() + 3000;
      send('tag', { p: myPos.p, acc: myPos.acc });
      buzz(40);
      if (myPos.acc > GPS_POOR) toast(`Weak GPS (±${myPos.acc} m): close tags may not count.`, 'seeker', 'alert');
      toast(`TAG sent (${S.settings.tagRadiusM} m).`, 'seeker', 'tag');
      break;
    }
    case 'item': {
      const item = el.dataset.item;
      if (!ITEM_INFO[item] || (((p.inv && p.inv[item]) || 0) < 1 && !(item === 'decoy' && L_.placingDecoy))) return;
      if (item === 'decoy') { L_.placingDecoy = !L_.placingDecoy; renderSheet(); if (L_.placingDecoy) toast('Tap the map inside the zone to place your decoy', 'hider', 'decoy'); return; }
      if (item === 'jammer') { if (L_.jamArmed) return; L_.jamArmed = true; send('useItem', { item }); toast('Jammer armed. Your next ping is blocked.', 'hider', 'jammer'); }
      if (item === 'swarm') { if (L_.swarmArmed) return; L_.swarmArmed = true; send('useItem', { item }); toast('Swarm armed. Your next ping shows 4 spots.', 'hider', 'swarm'); }
      if (['sonar', 'ghost', 'shield', 'blackout', 'xray', 'tracker', 'cloak', 'peek', 'trail', 'lockdown'].includes(item)) send('useItem', { item });
      if (item === 'spotlight') { L_.spotPick = !L_.spotPick; renderSheet(); return; }
      if (item === 'radar') { send('useItem', { item }); toast('Radar sweep. Every hider pings now.', 'seeker', 'radar'); }
      fx(item, ITEM_INFO[item].name, ITEM_INFO[item].role === 'seeker' ? 'red' : '');
      setTimeout(renderSheet, 50);
      break;
    }
    case 'buy': send('buy', { k: el.dataset.k, opt: el.dataset.opt }); break;
    case 'toggleShop':
      if (inGame()) { L_.showShop = !L_.showShop; shopOpen = L_.showShop; if (L_.showShop) L_.showPU = L_.showMore = false; }
      else shopOpen = !shopOpen;
      renderSheet(); break;
    case 'spotTarget': L_.spotPick = false; send('useItem', { item: 'spotlight', target: el.dataset.id }); setTimeout(renderSheet, 50); break;
    case 'spotCancel': L_.spotPick = false; renderSheet(); break;
    case 'selfCaught': {
      const seekers = Object.entries(S.players).filter(([, x]) => x.role === 'seeker');
      modal(`<h3>Who caught you?</h3><p>Be honest. It gives them the points.</p><div class="stack">${seekers.map(([id, x]) => `<button class="btn" data-act2="caughtBy" data-id="${id}">${avatar(x, roleCls(x.role))}${esc(x.name)}</button>`).join('')}<button class="btn ghost" data-act="closeModal">Never mind</button></div>`);
      break;
    }
    case 'replay': startReplay(); break;
    case 'replayClose': if (replay) { replay.playing = false; replay = null; layers.replay.clearLayers(); renderEnded(); } break;
    case 'replayPlay': if (replay) { if (replay.playing) { replay.playing = false; renderEnded(); } else { if (replay.pos >= 1) replay.pos = 0; startReplayLoop(); } } break;
    case 'closeChat': chatOpen = false; renderSheet(); setMapBtn(); break;
    case 'chatTab': chatTab = el.dataset.tab; renderChat(); break;
  }
}
function startReplayLoop() {
  replay.playing = true; renderEnded();
  const step = () => {
    if (!replay || !replay.playing) return;
    replay.pos = Math.min(1, replay.pos + 1 / 600);
    if (replay.pos >= 1) replay.playing = false;
    renderReplay();
    const sl = $('[data-act="replaySeek"]'); if (sl) sl.value = Math.round(replay.pos * 1000);
    if (replay.playing) setTimeout(step, 33); else renderEnded();
  };
  step();
}
$('#modal').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act2]');
  if (!b) return;
  const a = b.dataset.act2, d = b.dataset;
  closeModal();
  if (a === 'caughtBy') send('caught', { who: me.id, by: d.id, how: 'self', p: myPos?.p || null });
  if (a === 'pick' && pickCb) { const f = pickCb; pickCb = null; f(d.id); }
  if (a === 'ruleWho') {
    const ss = Object.entries(S.players).filter(([, x]) => x.role === 'seeker');
    modal(`<h3>Who caught ${nm(d.id)}?</h3><div class="stack">${ss.map(([id, x]) => `<button class="btn" data-act2="ruleBy" data-who="${d.id}" data-id="${id}">${avatar(x, roleCls(x.role))}${esc(x.name)}</button>`).join('')}<button class="btn ghost" data-act2="ruleBy" data-who="${d.id}" data-id="">Nobody / not sure</button></div>`);
  }
  if (a === 'ruleBy' || a === 'ruleYes') { send('caught', { who: d.who, by: d.id || null, how: 'host', p: null }); if (d.req) delete hostPending[d.req]; nextHostRuling(); }
  if (a === 'ruleNo') { if (d.req) { hostPending[d.req] && (hostPending[d.req].status = 'done'); send('ruling', { reqId: d.req, by: d.by, target: d.who, counted: false }); } nextHostRuling(); }
  if (a === 'confirmYes') { const r = incoming[d.req]; if (r) { send('caught', { who: me.id, by: r.by, how: r.kind, p: myPos?.p || null }); delete incoming[d.req]; } nextIncoming(); }
  if (a === 'confirmNo') { const r = incoming[d.req]; if (r) { send('tagDenied', { reqId: d.req, by: r.by, target: me.id }); delete incoming[d.req]; } nextIncoming(); }
});

// ---------- honor and photo tags ----------
let pickCb = null;
const incoming = {};      // tag requests aimed at me, waiting for my answer
const hostPending = {};   // host: open tag requests that may need a ruling
const validImg = (u) => typeof u === 'string' && u.length < 400000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(u);
function pickTarget(cb, title = 'Who did you tag?') {
  const latest = {};
  for (const x of L_.pings) if (x.p) latest[x.id] = x;
  const hs = Object.entries(S.players).filter(([, x]) => x.role === 'hider' && !x.caughtAt)
    .map(([id, x]) => ({ id, x, d: myPos && latest[id] ? G.dist(myPos.p, latest[id].p) : Infinity })).sort((a, b) => a.d - b.d);
  if (!hs.length) { toast('No hiders left to tag'); return; }
  pickCb = cb;
  modal(`<h3>${title}</h3><div class="stack">${hs.map(({ id, x, d }) => `<button class="btn" data-act2="pick" data-id="${id}">${avatar(x, 'hider')}${esc(x.name)}${isFinite(d) ? `<span class="sub">last ping ${G.fmtDist(d)}</span>` : ''}</button>`).join('')}<button class="btn ghost" data-act="closeModal">Cancel</button></div>`);
}
function sendTagReq(target, img) {
  if (Date.now() < L_.tagCooldown) { toast('Tag recharging…'); return; }
  L_.tagCooldown = Date.now() + 3000;
  const reqId = 'r' + Math.random().toString(36).slice(2, 9);
  send(img ? 'photoTag' : 'tagReq', { reqId, target, img: img || undefined });
  buzz(40);
  toast(`${img ? 'Photo' : 'Tag'} sent to <b>${nm(target)}</b>. Waiting…`, 'seeker', img ? 'camera' : 'tag');
}
async function shrinkImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const sc = Math.min(1, 560 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * sc)); c.height = Math.max(1, Math.round(img.height * sc));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.6);
  } finally { URL.revokeObjectURL(url); }
}
sheet.addEventListener('change', async (e) => {
  if (e.target.id !== 'snap-in' || !e.target.files || !e.target.files[0]) return;
  let img;
  try { img = await shrinkImage(e.target.files[0]); } catch { toast('Could not read that photo'); return; }
  pickTarget((target) => sendTagReq(target, img), 'Who is in the photo?');
});
function nextIncoming() {
  const r = Object.entries(incoming)[0];
  if (!r) return;
  const [reqId, q] = r;
  modal(`<h3>${q.kind === 'photo' ? `${nm(q.by)} snapped you?` : `${nm(q.by)} says they tagged you`}</h3>
    ${q.img ? `<img src="${q.img}" alt="Tag photo" style="width:100%;border-radius:12px;margin-bottom:10px">` : ''}
    <p>${q.kind === 'photo' ? 'Is this you? Be honest.' : 'Did they really get you? Be honest.'}</p>
    <div class="stack"><button class="btn danger" data-act2="confirmYes" data-req="${reqId}">${q.kind === 'photo' ? "Yes, that's me" : 'Yes, they got me'}</button><button class="btn" data-act2="confirmNo" data-req="${reqId}">${q.kind === 'photo' ? 'Not me' : 'No, they missed'}</button></div>`);
}
function nextHostRuling() {
  if (!isHost()) return;
  const r = Object.entries(hostPending).find(([, q]) => q.status === 'disputed' || q.status === 'timeout');
  if (!r) return;
  const [reqId, q] = r;
  q.status = 'shown';
  modal(`<h3>Your call, host</h3>
    ${q.img ? `<img src="${q.img}" alt="Tag photo" style="width:100%;border-radius:12px;margin-bottom:10px">` : ''}
    <p>${q.why === 'timeout' ? `${nm(q.target)} hasn't answered ${nm(q.by)}'s ${q.img ? 'photo' : 'tag'}.` : `${nm(q.target)} says ${nm(q.by)}'s ${q.img ? 'photo' : 'tag'} doesn't count.`} Does it count?</p>
    <div class="stack"><button class="btn danger" data-act2="ruleYes" data-req="${reqId}" data-who="${q.target}" data-id="${q.by}">Count it: ${nm(q.target)} is caught</button><button class="btn" data-act2="ruleNo" data-req="${reqId}" data-who="${q.target}" data-by="${q.by}">No catch</button></div>`);
}
function hostRulingsTick() {
  if (!isHost()) return;
  const now = Date.now();
  for (const q of Object.values(hostPending)) {
    if (q.status === 'open' && now - q.t > 45000) { q.status = 'timeout'; q.why = 'timeout'; }
    if (q.status !== 'done' && S.players[q.target]?.caughtAt) q.status = 'done';
  }
  if ($('#modal').hidden) nextHostRuling();
}

map.on('click', (e) => {
  const ll = [e.latlng.lat, e.latlng.lng];
  if (chatOpen) return; // chat covers the controls, so a stray tap shouldn't drop a point
  if (zoneDraft && isHost() && S.phase === 'lobby') {
    if (!mapView) return;
    if (zoneDraft.type === 'circle') zoneDraft.c = ll; else zoneDraft.pts.push(ll);
    drawDraft(); renderSheet();
    return;
  }
  if (L_.placingDecoy) {
    const z = currentZone();
    if (z && !G.inZone(ll, z)) { toast('Decoy has to be inside the zone'); return; }
    L_.placingDecoy = false;
    L_.decoyArmed = ll;
    send('useItem', { item: 'decoy' });
    toast('Decoy set. Your next ping shows there.', 'hider', 'decoy');
    renderSheet(); renderMarks();
  }
});
function drawDraft() {
  layers.draft.clearLayers();
  if (!zoneDraft) return;
  if (zoneDraft.type === 'circle' && zoneDraft.c) L.circle(zoneDraft.c, { radius: zoneDraft.r, color: '#111111', weight: 2, dashArray: '6 6', fillOpacity: .06 }).addTo(layers.draft);
  if (zoneDraft.type === 'poly') {
    zoneDraft.pts.forEach((p) => L.circleMarker(p, { radius: 5, color: '#111111', fillColor: '#ff3b30', fillOpacity: 1 }).addTo(layers.draft));
    if (zoneDraft.pts.length > 1) L.polygon(zoneDraft.pts, { color: '#111111', weight: 2, dashArray: '6 6', fillOpacity: .06 }).addTo(layers.draft);
  }
}

$('#btn-fit').addEventListener('click', () => {
  if (!S || !S.zone) { toast('No play area yet'); return; }
  if (S.phase !== 'lobby' && (L_.showPU || L_.showMore || sheetCollapsed === false)) { L_.showPU = false; L_.showMore = false; renderSheet(); }
  map.invalidateSize(); fitZone(S.zone);
});
$('#btn-back').addEventListener('click', () => act('leave'));
$('#btn-gear').addEventListener('click', () => { unlockAudio(); settingsModal(); });
$('#btn-north').addEventListener('click', () => setBearing(mapBear % 90 === 0 ? mapBear + 90 : 0));
$('#btn-key').addEventListener('click', showMapKey);
function showMapKey() {
  const row = (sym, t, d) => `<div class="key-row"><span class="key-sym">${sym}</span><span><b>${t}</b>${d ? `<small>${d}</small>` : ''}</span></div>`;
  const dot = (c, sq) => `<span class="key-dot ${sq ? 'sq' : ''}" style="background:${c}"></span>`;
  modal(`<div class="sheet-h"><h2>Map key</h2><button class="icon-btn" data-act="closeModal" aria-label="Close">${ic('close')}</button></div>
    <div class="key">
      ${row(`<span class="key-me"><span class="me-cone"></span>${dot('#111')}</span>`, 'You', 'The blue beam shows which way your phone is facing. Round dot = hider, diamond = seeker.')}
      ${row(dot(ROLE_INK.hider), 'Hider ping', "A hider's rough spot. The time says how old it is. The circle is how far off it could be.")}
      ${row(dot(ROLE_INK.seeker, true), 'Seeker', 'Where a seeker is (only shown to teammates, or with Sonar/Peek).')}
      ${row(`<span class="key-tag">LIVE</span>`, 'Red label', 'Exact spot: out of zone, screen off, X-ray or Live Wire.')}
      ${row(`<span class="key-line"></span>`, 'Red line', 'The play zone. Stay inside it.')}
      ${row(`<span class="key-pin">${ic('caught')}</span>`, 'Caught', 'Where someone got tagged.')}
      ${row(`<span class="key-pin">${ic('treasure')}</span>`, 'Pins with a dashed ring', 'Treasure, supply drops, flags, jail and missions. Walk into the ring to use them.')}
    </div>
    <p class="note" style="margin-top:12px">Buttons on the right: see the whole zone, turn the map (or twist with two fingers), and jump to you.</p>
    <button class="btn primary" data-act="closeModal" style="width:100%;margin-top:10px">Got it</button>`);
}
$('#btn-locate').addEventListener('click', () => { if (myPos) map.setView(myPos.p, Math.max(map.getZoom(), 17)); else toast('No location yet'); });
$('#btn-chat').addEventListener('click', () => { chatOpen = !chatOpen; unread = false; $('#chat-dot').hidden = true; if (chatOpen) renderChat(); else renderSheet(); setMapBtn(); });
$('#btn-map').addEventListener('click', () => setMapView(!(mapView && !chatOpen)));

// ---------------- home screen ----------------
const inName = $('#in-name'), inCode = $('#in-code');
inName.value = me.name || '';
if (params.get('room')) inCode.value = params.get('room').toUpperCase().slice(0, 4);
inCode.addEventListener('input', () => { inCode.value = inCode.value.toUpperCase().replace(/[^A-Z]/g, ''); });
// how-to-play film (made with HyperFrames, see motion/)
const film = $('#film'), filmVid = $('#film-video'), heroVid = $('#hero-video');
function closeFilm() { film.hidden = true; try { filmVid.pause(); } catch {} }
$('#btn-film').addEventListener('click', () => { film.hidden = false; try { filmVid.currentTime = 0; filmVid.play().catch(() => {}); } catch {} });
$('#film-x').addEventListener('click', closeFilm);
film.addEventListener('click', (e) => { if (e.target === film) closeFilm(); });
filmVid.addEventListener('ended', closeFilm);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !film.hidden) closeFilm(); });
// the hero loop only plays while the home screen is showing
new MutationObserver(() => { try { if ($('#home').hidden) heroVid.pause(); else heroVid.play().catch(() => {}); } catch {} }).observe($('#home'), { attributes: true, attributeFilter: ['hidden'] });
if (matchMedia('(prefers-reduced-motion: reduce)').matches) { heroVid.removeAttribute('autoplay'); heroVid.pause(); }
function showHomeErr(t) { const e = $('#home-err'); e.textContent = t; e.hidden = !t; }
function setHomeBusy(b) { $('#btn-create').disabled = b; $('#btn-join').disabled = b; }
function takeName() {
  const n = inName.value.trim();
  if (!n) { showHomeErr('Pick a name first.'); inName.focus(); return null; }
  me.name = n.slice(0, 16); saveMe(); showHomeErr('');
  if (acct && acct.profile.name !== me.name) acctSave({ name: me.name });
  unlockAudio();
  loadAlarm();
  return n;
}
$('#btn-create').addEventListener('click', () => { if (takeName()) connect(newCode(), true); });
$('#btn-join').addEventListener('click', () => {
  if (!takeName()) return;
  const c = inCode.value.trim().toUpperCase();
  if (c.length !== 4) { showHomeErr('Enter the 4-letter code.'); return; }
  connect(c, false);
});
inCode.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-join').click(); });

// Invite links (?room=CODE): a dedicated landing (not the home screen) asks for a name and location, then joins.
{
  const invited = (params.get('room') || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (invited.length === 4) {
    inCode.value = invited;
    const inv = $('#invite'), nm = $('#inv-name'), geoBtn = $('#inv-geo'), err = $('#inv-err');
    $('#inv-code').textContent = invited;
    nm.value = me.name || '';
    $('#home').hidden = true; inv.hidden = false;
    const setErr = (t) => { err.textContent = t; err.hidden = !t; };
    geoBtn.addEventListener('click', () => {
      unlockAudio();
      if (!navigator.geolocation) { setErr('This browser has no location support.'); return; }
      navigator.geolocation.getCurrentPosition(() => { geoBtn.textContent = 'Location on \u2713'; geoBtn.classList.add('ok'); setErr(''); },
        (e) => { if (e.code === 1) setErr('Location is blocked. You can still join, then turn it on in your phone settings.'); else { geoBtn.textContent = 'Location on \u2713'; geoBtn.classList.add('ok'); } },
        { enableHighAccuracy: true, timeout: 15000 });
    });
    const go = async () => {
      const n = nm.value.trim();
      if (!n) { setErr('Enter your name first.'); nm.focus(); return; }
      me.name = n.slice(0, 16); saveMe(); setErr('');
      if (acct && acct.profile.name !== me.name) acctSave({ name: me.name });
      unlockAudio(); loadAlarm();
      $('#inv-join').disabled = true;
      const ok = await connect(invited, false);
      $('#inv-join').disabled = false;
      if (ok) inv.hidden = true; else { const h = $('#home-err'); setErr(h.textContent || 'Could not connect.'); }
    };
    $('#inv-join').addEventListener('click', go);
    nm.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  }
}

// ---------------- accounts (optional) ----------------
// Guests play exactly as before. Signed-in players keep their points and badge between games.
const authClient = (() => {
  const c = window.GHOSTLINE_CONFIG || {};
  if (!window.supabase || !c.supabaseUrl || params.get('net') === 'relay') return null;
  try { return window.supabase.createClient(c.supabaseUrl, c.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'gl-auth' } }); } catch { return null; }
})();
function acctHello() {
  const owned = cleanOwned([...myOwned, ...((acct && acct.profile.owned) || [])]);
  return acct ? { pts: acct.profile.points || 0, icon: acct.profile.icon || myLook, owned } : { icon: myLook, owned };
}
async function loadProfile(user) {
  let { data, error } = await authClient.from('ghostline_profiles').select('name,icon,points,owned').eq('user_id', user.id).maybeSingle();
  if (error) { console.warn(error); return; }
  if (!data) {
    data = { name: (me.name || (user.user_metadata && user.user_metadata.username) || '').slice(0, 16), icon: null, points: 0, owned: [] };
    const r = await authClient.from('ghostline_profiles').insert({ user_id: user.id, name: data.name });
    if (r.error) console.warn(r.error);
  }
  acct = { user, profile: data };
  // characters bought on this phone before signing in join the account, and the account's show up here
  const all = cleanOwned([...(data.owned || []), ...myOwned]);
  keepOwned(all);
  if (all.length !== cleanOwned(data.owned).length) acctSave({ owned: all });
  if (data.name) { me.name = data.name; saveMe(); inName.value = data.name; const iv = $('#inv-name'); if (iv) iv.value = data.name; }
  renderAcct();
}
let saveT = 0, savePatch = {};
function acctSave(patch) {
  if (!acct || !authClient) return;
  Object.assign(acct.profile, patch); Object.assign(savePatch, patch);
  clearTimeout(saveT);
  saveT = setTimeout(async () => {
    const body = { ...savePatch, updated_at: new Date().toISOString() }; savePatch = {};
    const { error } = await authClient.from('ghostline_profiles').update(body).eq('user_id', acct.user.id);
    if (error) console.warn('profile save failed', error);
  }, 800);
}
// keep the saved points, look and characters in step with the game
setInterval(() => {
  const mp = S && S.players[me.id];
  if (mp) { keepOwned(mp.owned); keepLook(mp.icon); }
  if (!acct || !S || acctGame !== S.code) return;
  const pts = (S.wallet || {})[me.id], p = S.players[me.id];
  const patch = {};
  if (Number.isFinite(pts) && pts !== acct.profile.points) patch.points = Math.max(0, Math.floor(pts));
  if (p && p.icon && p.icon !== acct.profile.icon) patch.icon = p.icon;
  const owned = cleanOwned([...(acct.profile.owned || []), ...((p && p.owned) || [])]);
  if (owned.length !== cleanOwned(acct.profile.owned).length) patch.owned = owned;
  if (Object.keys(patch).length) acctSave(patch);
}, 2000);

// accounts are a username + password: the username maps to an address that never gets mail
const ACCT_DOMAIN = 'players.ghostline.invalid';
const acctUser = () => { const u = acct && acct.user; return (u && u.user_metadata && u.user_metadata.username) || ((u && u.email) || '').replace('@' + ACCT_DOMAIN, ''); };
const acctEmail = (u) => u.includes('@') ? u : `${u.toLowerCase()}@${ACCT_DOMAIN}`;
function acctBadge() {
  const pr = acct.profile;
  return `<span class="av acct-av ${charOf(pr.icon) ? 'has-ch' : ''}">${lookHtml(pr.icon) || esc(Array.from(pr.name || acctUser() || '?')[0] || '?')}</span>`;
}
function renderAcct() {
  for (const box of [$('#acct-box'), $('#inv-acct')]) {
    if (!box) continue;
    if (!authClient) { box.hidden = true; continue; }
    box.hidden = false;
    box.innerHTML = acct
      ? `<div class="acct-in">${acctBadge()}<div class="acct-tx"><b>${esc(acct.profile.name || acctUser())}</b><span>${acct.profile.points || 0} pts saved</span></div><button class="acct-link" data-acct="out">Sign out</button></div>`
      : `<div class="acct-out"><div class="acct-tx"><b>Playing as a guest</b><span>Make an account to keep your points and badge.</span></div><button class="btn small" data-acct="open">Sign in</button></div>`;
  }
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-acct]'); if (!b || !authClient) return;
  if (b.dataset.acct === 'out') { authClient.auth.signOut().then(() => { acct = null; renderAcct(); toast('Signed out. You are playing as a guest.'); }); }
  if (b.dataset.acct === 'open') acctModal('in');
});
function acctModal(mode) {
  const up = mode === 'up';
  modal(`<h3>${up ? 'Create an account' : 'Sign in'}</h3>
    <p>${up ? 'Your points and badge get saved, so you keep them next game.' : 'Welcome back. Your saved points come with you.'}</p>
    <form id="acct-form" class="acct-form">
      <input id="acct-email" type="text" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="Username${up ? ' (letters, numbers, _)' : ''}" maxlength="${up ? 16 : 80}" required>
      <input id="acct-pass" type="password" autocomplete="${up ? 'new-password' : 'current-password'}" placeholder="Password${up ? ' (6+ characters)' : ''}" minlength="6" required>
      <p id="acct-err" class="err" hidden></p>
      <button class="btn primary big" type="submit" style="width:100%">${up ? 'Create account' : 'Sign in'}</button>
    </form>
    <button class="btn ghost" id="acct-swap" style="width:100%">${up ? 'Have an account? Sign in' : 'New here? Create an account'}</button>
    <button class="btn ghost" data-act="closeModal" style="width:100%">Keep playing as a guest</button>`);
  $('#acct-swap').onclick = () => acctModal(up ? 'in' : 'up');
  $('#acct-email').focus();
  $('#acct-form').onsubmit = async (e) => {
    e.preventDefault();
    const err = $('#acct-err'), btn = $('#acct-form button[type=submit]');
    const user = $('#acct-email').value.trim(), password = $('#acct-pass').value;
    const show = (t) => { err.textContent = t; err.hidden = !t; };
    if (up && !/^[A-Za-z0-9_]{3,16}$/.test(user)) { show('Usernames are 3 to 16 letters, numbers or _'); return; }
    btn.disabled = true; show('');
    if (up) {
      // made on the server already confirmed, so no email is ever sent
      let res = null;
      try {
        const c = window.GHOSTLINE_CONFIG || {};
        const resp = await fetch(c.supabaseUrl + '/functions/v1/ghostline-signup', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: c.supabaseKey, Authorization: 'Bearer ' + c.supabaseKey }, body: JSON.stringify({ username: user, password }) });
        res = await resp.json().catch(() => ({}));
        if (!resp.ok) { btn.disabled = false; show(res.error || 'Could not create the account. Try again.'); return; }
      } catch { btn.disabled = false; show('No connection. Try again.'); return; }
    }
    const r = await authClient.auth.signInWithPassword({ email: acctEmail(user), password });
    btn.disabled = false;
    if (r.error) { show(/invalid login/i.test(r.error.message) ? 'Wrong username or password.' : r.error.message); return; }
    closeModal(); toast(up ? 'Account created. Your points will be saved.' : 'Signed in', 'good', 'check');
  };
}
if (authClient) {
  authClient.auth.onAuthStateChange((ev, session) => {
    // run outside the callback so supabase-js isn't re-entered
    setTimeout(() => {
      if (session && session.user) { if (!acct || acct.user.id !== session.user.id) loadProfile(session.user); }
      else if (acct) { acct = null; renderAcct(); }
    }, 0);
  });
}
renderAcct();

function enterGameUI() {
  $('#home').hidden = true;
  $('#hud').hidden = false;
  renderSheet();
  setTimeout(() => map.invalidateSize(), 50);
}
function leave(msg) {
  try { net && net.close(); } catch {}
  releaseWake();
  net = null; S = null; code = null; prevPhase = null; prevRound = 0; zoneDraft = null; replay = null; fittedZone = false;
  processed.clear(); chat.length = 0; resetLocal();
  layers.zone.clearLayers(); layers.marks.clearLayers(); layers.replay.clearLayers(); layers.draft.clearLayers();
  mapView = false; $('#home').hidden = false; $('#hud').hidden = true; sheet.hidden = true; banner(null);
  $('#blindfold')?.remove();
  history.replaceState(null, '', location.pathname);
  if (msg) showHomeErr(msg);
}

setInterval(() => { clientTick(); const u = $('#last-up'); if (u && !u.hidden) showLastUp(); }, 500);

// test and debug hooks
window.__gl = {
  get S() { return S; }, get map() { return map; }, get bear() { return mapBear; }, feed: () => chat.map((c) => (c.sys ? c.html : c.text)).join('\n'), setBearing, get me() { return me; }, get peers() { return [...peers]; }, get local() { return L_; },
  get myPos() { return myPos; }, get alarmOn() { return alarm.on; }, get awake() { return !!wakeLock || !!(wakeVideo && !wakeVideo.paused); }, hostNow, currentZone,
  ...(DEBUG ? {
    setPos, act, send, feedFix: (lat, lng, acc) => onPos({ coords: { latitude: lat, longitude: lng, accuracy: acc } }),
    setSettings: (o) => hostApply((s) => { Object.assign(s.settings, o); if (o.jail) s.settings.infection = false; if (o.infection) s.settings.jail = false; }),
    setZone: (z) => hostApply((s) => { s.zone = z; }),
    tapMap: (lat, lng) => map.fire('click', { latlng: L.latLng(lat, lng) }),
    give: (id, item) => hostApply((s) => { const q = s.players[id]; q.inv = q.inv || {}; q.inv[item] = (q.inv[item] || 0) + 1; }),
    spawnDrop: () => hostApply((s) => spawnDrop(s)),
    audio: () => actx && actx.state, startDuel: (a, b, game, ms) => hostApply((s) => startDuelIn(s, a, b, game, Date.now(), ms || 45000)), duelSubmit,
    spawnTreasure: (pt) => hostApply((s) => { s.treasure = { id: 'tx' + Date.now(), p: pt }; }),
    setWire: (id, ms) => hostApply((s) => { s.wire = id ? { holder: id, until: Date.now() + ms, from: null, at: Date.now() } : null; s.nextWireAt = Infinity; if (id) s.events.push({ id: evId(), k: 'wire', who: id, t: Date.now() }); }),
    setWallet: (id, n) => hostApply((s) => { s.wallet = s.wallet || {}; s.wallet[id] = n; }),
    openExtraction: () => hostApply((s) => { if (s.sprint) s.sprint.at = Date.now(); }),
  } : {}),
};
