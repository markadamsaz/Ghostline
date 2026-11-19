// Ghostline: real-world hide and seek with timed location pings.
// One player's device (the host) keeps the shared game state and broadcasts it.
// Hiders never stream their live location: their phone only sends a (blurred) spot at each ping.
import { createNet } from './net.js';
import * as G from './geo.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const COLORS = ['#35c8ff', '#ffd23d', '#b98cff', '#3dffb5', '#ff8a3d', '#ff6bd6', '#7dff5a', '#5a8cff', '#ff5a5a', '#5affea', '#d9ff3d', '#ffffff'];
const ITEM_INFO = {
  decoy: { ic: '👻', name: 'Decoy', desc: 'Your next ping shows a spot you pick', role: 'hider' },
  jammer: { ic: '📵', name: 'Jammer', desc: 'Skip your next ping', role: 'hider' },
  sonar: { ic: '🔊', name: 'Sonar', desc: 'See every seeker for 30 s', role: 'hider' },
  radar: { ic: '📡', name: 'Radar', desc: 'Force every hider to ping now', role: 'seeker' },
  // super power-ups: only from supply drops and seeker rewards
  ghost: { ic: '🌫️', name: 'Ghost', desc: 'No pings at all for the next 2 rounds', role: 'hider', sup: true },
  shield: { ic: '🛡️', name: 'Shield', desc: 'Blocks the next tag on you', role: 'hider', sup: true },
  swarm: { ic: '🐝', name: 'Swarm', desc: 'Next ping shows 4 spots, only 1 is real', role: 'hider', sup: true },
  blackout: { ic: '🌑', name: 'Blackout', desc: "Seekers' maps go dark for 45 s", role: 'hider', sup: true },
  xray: { ic: '🔦', name: 'X-ray', desc: 'Every hider pings their exact spot now', role: 'seeker', sup: true },
  tracker: { ic: '🛰️', name: 'Tracker', desc: 'Hiders ping every 15 s for a minute', role: 'seeker', sup: true },
};
const SUPERS = { hider: ['ghost', 'shield', 'swarm', 'blackout'], seeker: ['xray', 'tracker'] };
const BASICS = { hider: ['decoy', 'jammer', 'sonar'], seeker: ['radar'] };
const STARTER = { hider: { decoy: 1, jammer: 1, sonar: 1 }, seeker: { radar: 1 } };
const REACH_M = 20; // how close you have to get to a drop, flag, jail, mission or extraction point
// game modes the host can mix and match
const MODES = [
  ['infection', '🧟 Infection', 'Caught hiders join the seekers'],
  ['jail', '⛓️ Jailbreak', 'Caught hiders go to jail. A free hider reaching it frees them all'],
  ['fugitive', '🏃 Fugitive', 'One runner, everyone else hunts'],
  ['starter', '🎒 Starter power-ups', 'Everyone starts with a few tricks'],
  ['drops', '📦 Supply drops', 'Super power-ups land on the map. Everyone can see them'],
  ['missions', '🎯 Missions', 'Each hider gets secret spots to reach for points and power-ups'],
  ['capture', '🚩 Capture points', 'Hold a flag for 1 min for +50. You ping while you hold it'],
  ['potato', '🥔 Hot potato', 'Whoever carries it pings twice as often but scores double'],
  ['sprint', '🚁 Final sprint', 'An extraction point opens near the end. Reach it for +100'],
  ['shrink', '🌀 Shrinking zone', 'The zone closes in over the round'],
  ['strictZone', '⛔ Strict zone', 'Out of the zone for 15 s and you are out'],
];
const puOn = (st) => !!(st && (st.starter || st.drops || st.missions));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const evId = () => 'e' + Math.random().toString(36).slice(2, 9);
const OPTS = {
  hideSec: [[30, '30 s'], [60, '1 min'], [120, '2 min'], [180, '3 min'], [300, '5 min'], [600, '10 min']],
  huntSec: [[300, '5 min'], [600, '10 min'], [900, '15 min'], [1200, '20 min'], [1800, '30 min'], [2700, '45 min'], [3600, '60 min']],
  pingSec: [[30, '30 s'], [60, '1 min'], [120, '2 min'], [180, '3 min'], [300, '5 min'], [600, '10 min']],
  blurM: [[0, 'Exact'], [25, '25 m'], [50, '50 m'], [100, '100 m']],
  tagRadiusM: [[10, '10 m'], [15, '15 m'], [25, '25 m'], [40, '40 m']],
  seekers: [[1, '1'], [2, '2'], [3, '3']],
  dropSec: [[60, 'Every 1 min'], [120, 'Every 2 min'], [180, 'Every 3 min'], [300, 'Every 5 min'], [600, 'Every 10 min']],
  shrinkStyle: [['smooth', 'Closes in smoothly'], ['steps', 'Jumps in at each ping']],
  shrinkTo: [[0.6, 'Down to 60%'], [0.4, 'Down to 40%'], [0.2, 'Down to 20%']],
  tagMode: [['gps', 'GPS range: hit TAG when close'], ['honor', 'Honor: tag them, they confirm'], ['photo', 'Photo: snap them, they confirm']],
};
const TAG_HINT = {
  gps: (s) => `Get within ${s.tagRadiusM} m of a hider and hit TAG.`,
  honor: () => 'Touch them for real, then hit TAG and pick who. They confirm on their phone.',
  photo: () => 'Snap a clear photo of them. They confirm it is them, or the host decides.',
};
const DEFAULT_SETTINGS = {
  hideSec: 120, huntSec: 1200, pingSec: 300, blurM: 25, tagRadiusM: 15, seekers: 1,
  tagMode: 'gps', infection: true, fugitive: false, jail: false, starter: true, drops: true, dropSec: 180,
  missions: false, capture: false, potato: false, sprint: false,
  shrink: true, shrinkStyle: 'smooth', shrinkTo: 0.4, strictZone: true, graceSec: 15,
};

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

// ---------------- runtime state ----------------
let S = null;            // shared game state (host is the authority)
let net = null;
let code = null;
let peers = new Set();
let clockOffset = 0, clockSet = false;
const hostNow = () => Date.now() + clockOffset;
let myPos = null;        // {p:[lat,lng], acc, t}
let geoWatch = null, geoError = null;
let wakeLock = null;
let L_ = {};             // local per-round state
let prevPhase = null, prevRound = 0;
const processed = new Set();
const chat = [];
let chatTab = 'all', chatOpen = false, unread = false;
let sheetCollapsed = false;
let zoneDraft = null;    // host editing
let replay = null;
let lastStateSent = 0;
let hostMissingSince = 0;

function resetLocal() {
  L_ = {
    pings: [],             // {id, p, blur, kind, n, t}
    lastPingN: -1, warnedN: -1,
    decoyArmed: null, jamArmed: false, placingDecoy: false,
    outSince: null, lastBreach: 0,
    sonarUntil: 0, seekerLocs: {},
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
function toast(text, cls = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + cls;
  el.innerHTML = text;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 4200);
  while ($('#toasts').children.length > 3) $('#toasts').firstChild.remove();
}
let actx = null;
function beep(kind) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
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

// ---------------- map ----------------
const map = L.map('map', { zoomControl: false, attributionControl: true, worldCopyJump: true }).setView([39.5, -98.35], 4);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  subdomains: 'abcd', maxZoom: 20,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
}).addTo(map);
const layers = {
  zone: L.layerGroup().addTo(map),
  draft: L.layerGroup().addTo(map),
  marks: L.layerGroup().addTo(map),
  replay: L.layerGroup().addTo(map),
};
let meMarker = null, meAcc = null, fittedZone = false;

function zoneLayer(z, style) {
  if (!z) return null;
  return z.type === 'circle' ? L.circle(z.c, { radius: z.r, ...style }) : L.polygon(z.pts, style);
}
function sheetPad() { return window.innerWidth < 720 && !sheet.hidden ? sheet.offsetHeight : 0; }
function fitTo(bounds) {
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
  const col = mine()?.role === 'seeker' ? 'var(--seeker)' : mine()?.role === 'hider' ? 'var(--hider)' : 'var(--accent)';
  const icon = L.divIcon({ className: '', iconSize: [18, 18], iconAnchor: [9, 9], html: `<div class="me-dot" style="background:${col}"></div>` });
  if (!meMarker) {
    meMarker = L.marker(myPos.p, { icon, zIndexOffset: 1000, interactive: false }).addTo(map);
    meAcc = L.circle(myPos.p, { radius: myPos.acc, color: '#fff', weight: 1, opacity: .3, fillOpacity: .05, interactive: false }).addTo(map);
  } else { meMarker.setLatLng(myPos.p); meMarker.setIcon(icon); meAcc.setLatLng(myPos.p); meAcc.setRadius(myPos.acc); }
}

// ---------------- zone over time ----------------
function huntMs() { return S.settings.huntSec * 1000; }
function pingMs() { return S.settings.pingSec * 1000; }
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
      players: {}, events: [], kicked: [], results: null, totals: {},
      roundStart: 0, huntStart: 0, huntEnd: 0, endedAt: 0,
    };
    addPlayer(S, me.id, me.name);
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
    if (!S || !S.players[me.id]) { send('hello', { name: me.name }); setTimeout(helloLoop, 2500); }
  };
  helloLoop();
  if (!asHost) setTimeout(() => { if (!S && code === roomCode) banner(`Waiting for game ${esc(code)}… Is the host's app open?`, 'warn'); }, 7000);
  return true;
}

function addPlayer(st, id, name) {
  const used = new Set(Object.values(st.players).map((p) => p.color));
  const color = COLORS.find((c) => !used.has(c)) || COLORS[Object.keys(st.players).length % COLORS.length];
  const late = st.phase === 'hiding' || st.phase === 'hunting';
  st.players[id] = {
    name: (name || 'Player').slice(0, 16), color, joinedAt: Date.now(),
    role: late ? 'seeker' : 'hider', startRole: late ? 'seeker' : null,
    caughtAt: null, caughtBy: null, used: {}, seekerCount: 0,
  };
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
    case 'hello': {
      if (!isHost()) return;
      if (S.kicked.includes(m.from)) return;
      if (S.players[m.from]) {
        if (d.name && S.players[m.from].name !== d.name) hostApply((s) => { s.players[m.from].name = d.name.slice(0, 16); });
        else broadcastState();
      } else hostApply((s) => addPlayer(s, m.from, d.name));
      break;
    }
    case 'ping': {
      if (!S || S.phase === 'lobby') return;
      if (L_.pings.some((x) => x.id === m.from && x.n === d.n && x.kind === d.kind && d.kind !== 'breach')) return;
      const okPt = (q) => Array.isArray(q) && q.length === 2 && q.every(Number.isFinite);
      const alts = Array.isArray(d.alts) ? d.alts.filter(okPt).slice(0, 3) : null;
      L_.pings.push({ id: m.from, p: okPt(d.p) ? d.p : null, alts, blur: Math.min(+d.blur || 0, 200), kind: d.kind, n: d.n, t: hostNow() });
      if (!self && mine()?.role === 'seeker') {
        if (d.kind === 'breach') { toast(`🚨 ${nm(m.from)} left the zone. Exact spot showing.`, 'seeker'); beep('alarm'); buzz([80, 60, 80]); }
        else if (d.kind === 'jam') { toast(`📵 ${nm(m.from)} jammed their signal`, 'seeker'); }
        else if (d.kind === 'ghost') { toast(`🌫️ ${nm(m.from)} is a ghost. No signal.`, 'seeker'); }
        else if (d.kind === 'capture') { beep('ping'); toast(`🚩 ${nm(m.from)} is capturing a flag`, 'seeker'); }
        else if (d.kind === 'nosignal') { toast(`${nm(m.from)} has no GPS fix`, ''); }
        else { beep('ping'); buzz(60); }
      }
      renderMarks();
      break;
    }
    case 'tag': {
      // a seeker hit TAG: my own phone decides if I was in range
      if (self || !S || S.phase !== 'hunting') return;
      const p = mine();
      if (!p || p.role !== 'hider' || !alive(p) || !myPos) return;
      const tol = Math.min(15, Math.max(myPos.acc || 0, d.acc || 0) / 2);
      const dd = G.dist(myPos.p, d.p);
      if (dd <= S.settings.tagRadiusM + tol) {
        send('caught', { who: me.id, by: m.from, how: 'tag', p: myPos.p });
      } else if (dd <= 60) {
        toast(`⚠️ ${nm(m.from)} is close. They just tried a tag ${G.fmtDist(dd)} away.`, 'hider');
        buzz([40, 40, 40]);
      }
      break;
    }
    case 'caught': {
      if (!isHost() || S.phase !== 'hunting') return;
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
        s.events.push({ id: evId(), k: 'catch', who: d.who, by, how: d.how, p: d.p || null, reward, t: now });
        checkEnd(s);
      });
      break;
    }
    case 'useItem': {
      if (!isHost() || S.phase !== 'hunting') return;
      const p = S.players[m.from], item = d.item;
      if (!p || !puOn(S.settings) || !ITEM_INFO[item]) return;
      const needs = ITEM_INFO[item].role;
      if (p.role !== needs || (needs === 'hider' && !alive(p))) return;
      if (!p.inv || (p.inv[item] || 0) < 1) return;
      hostApply((s) => {
        const q = s.players[m.from], now = Date.now();
        q.inv[item]--; if (!q.inv[item]) delete q.inv[item];
        q.fx = q.fx || {};
        if (item === 'ghost') { const ms = s.settings.pingSec * 1000, n = Math.floor((now - s.huntStart) / ms) + 1; q.fx.ghostUntil = s.huntStart + (n + 1) * ms + 1500; }
        if (item === 'shield') q.fx.shield = 1;
        if (item === 'blackout') s.blackoutUntil = now + 45000;
        if (item === 'tracker') s.trackerUntil = now + 60000;
        if (['radar', 'sonar', 'blackout', 'xray', 'tracker', 'ghost', 'shield'].includes(item)) s.events.push({ id: evId(), k: item, by: m.from, t: now });
      });
      break;
    }
    case 'claim': case 'mission': case 'flag': case 'potato': case 'potatoDrop': case 'breakout': case 'extract': {
      if (!isHost() || S.phase !== 'hunting') return;
      const q = S.players[m.from];
      if (!q || !Array.isArray(d.p) || !d.p.every(Number.isFinite)) return;
      const ok = (pt) => pt && G.dist(d.p, pt) <= REACH_M + Math.min(15, (+d.acc || 0) / 2);
      const now = Date.now();
      if (m.t === 'claim') {
        const dr = (S.drops || []).find((x) => x.id === d.id && !x.claimedBy);
        if (!dr || !ok(dr.p) || !(q.role === 'seeker' || alive(q))) return;
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
        if (!q.mission || q.mission.id !== d.id || !ok(q.mission.p)) return;
        hostApply((s) => {
          const w = s.players[m.from];
          w.bonus = (w.bonus || 0) + 25; w.missionsDone = (w.missionsDone || 0) + 1;
          const item = puOn(s.settings) ? pick(BASICS.hider) : null;
          if (item) { w.inv = w.inv || {}; w.inv[item] = (w.inv[item] || 0) + 1; }
          w.mission = { id: 'm' + Math.random().toString(36).slice(2, 7), p: randomSpotIn(finalZone(), d.p, 80) };
          s.events.push({ id: evId(), k: 'mission', who: m.from, item, t: now });
        });
      }
      if (m.t === 'flag') {
        const f = (S.flags || []).find((x) => x.id === d.id && !x.by);
        if (!f || !ok(f.p) || !(d.held >= 55000)) return;
        hostApply((s) => {
          const x = s.flags.find((y) => y.id === d.id); if (!x || x.by) return;
          x.by = m.from; const w = s.players[m.from]; w.bonus = (w.bonus || 0) + 50; w.flags = (w.flags || 0) + 1;
          s.events.push({ id: evId(), k: 'flag', who: m.from, t: now });
        });
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
      if (d.by === me.id) toast(`${nm(m.from)} says your tag missed.${isHost() ? '' : ' The host can overrule.'}`, 'seeker');
      if (isHost() && hostPending[d.reqId] && m.from === hostPending[d.reqId].target) {
        hostPending[d.reqId].status = 'disputed'; hostPending[d.reqId].why = 'denied';
        if ($('#modal').hidden) nextHostRuling();
      }
      break;
    }
    case 'ruling': {
      if (!S || m.from !== S.hostId) return;
      if (d.by === me.id && !d.counted) toast(`Host ruled: no catch on ${nm(d.target)}.`, 'seeker');
      break;
    }
    case 'seekerLoc': {
      L_.seekerLocs[m.from] = { p: d.p, t: hostNow() };
      renderMarks();
      break;
    }
    case 'chat': {
      if (!S) return;
      const text = String(d.text || '').slice(0, 200);
      if (!text) return;
      const sender = P(m.from);
      if (d.team !== 'all' && mine() && d.team !== mine().role && !self) return;
      chat.push({ from: m.from, name: sender?.name || 'Someone', color: sender?.color || '#fff', text, team: d.team, t: Date.now() });
      if (!chatOpen && !self) { unread = true; $('#chat-dot').hidden = false; toast(`<b style="color:${sender?.color}">${esc(sender?.name)}</b>: ${esc(text)}`); }
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
    toast(`You're the host now (${esc(S.players[oldHost]?.name || 'host')} dropped).`, 'good');
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
      p.caughtAt = null; p.caughtBy = null; p.fx = {}; p.bonus = 0; p.potatoMs = 0; p.extracted = null; p.mission = null; p.flags = 0; p.missionsDone = 0;
      p.inv = s.settings.starter ? { ...STARTER[p.role] } : {};
    }
    s.drops = []; s.flags = []; s.jail = null; s.potato = null; s.sprint = null; s.blackoutUntil = 0; s.trackerUntil = 0; s.jailCooldownUntil = 0;
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
  for (let i = 0; i < 300; i++) {
    const pt = G.randomInDisk(c, R);
    if (G.inZone(pt, inner) && (!avoid || G.dist(pt, avoid) >= minD)) return pt;
  }
  return c;
}
function setupModes(s) {
  const fz = finalZone();
  const hiders = Object.entries(s.players).filter(([, p]) => p.role === 'hider');
  if (s.settings.jail && !s.settings.infection) s.jail = { p: randomSpotIn(fz) };
  if (s.settings.missions) for (const [, p] of hiders) p.mission = { id: 'm' + Math.random().toString(36).slice(2, 7), p: randomSpotIn(fz) };
  if (s.settings.capture) s.flags = [0, 1].map((i) => ({ id: 'f' + i, p: randomSpotIn(fz, i ? s.flags?.[0]?.p : null, 60), by: null }));
  if (s.settings.capture && s.flags[1] && s.flags[0] && G.dist(s.flags[0].p, s.flags[1].p) < 60) s.flags[1].p = randomSpotIn(fz, s.flags[0].p, 60);
  if (s.settings.potato) s.potato = { p: randomSpotIn(fz), holder: null, since: 0 };
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
  s.results = res;
  for (const [id, r] of Object.entries(res)) s.totals[id] = (s.totals[id] || 0) + r.pts;
}
function hostTick() {
  if (!isHost()) return;
  hostRulingsTick();
  const now = Date.now();
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
    resetLocal();
    replay = null; layers.replay.clearLayers();
    sheetCollapsed = false;
    const r = mine()?.role;
    beep('start'); buzz([200, 100, 200]);
    toast(r === 'seeker' ? '🔴 You are the SEEKER. Stay put until the hunt starts.' : '🔵 You are a HIDER. Go hide inside the zone!', r === 'seeker' ? 'seeker' : 'hider');
    requestWake();
    if (S.zone) fitZone(S.zone);
  }
  if (to === 'hunting' && from) {
    beep('alarm'); buzz([300, 100, 300]);
    toast(mine()?.role === 'seeker' ? 'The hunt is on. Go!' : 'Seekers are moving. Stay hidden.', mine()?.role === 'seeker' ? 'seeker' : 'hider');
  }
  if (to === 'ended') {
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
  if (e.k === 'catch') {
    if (e.who === me.id) { beep('caught'); buzz([500]); toast(S.settings.infection ? '☠️ You got caught. You are a seeker now. Go get them!' : '☠️ You got caught.', 'seeker'); }
    else if (e.by === me.id) { beep('tag'); buzz([60, 40, 160]); toast(`🎯 You caught ${nm(e.who)}! +50${e.reward ? ` · you got ${ITEM_INFO[e.reward].ic} ${ITEM_INFO[e.reward].name}` : ''}`, 'good'); }
    else toast(e.how === 'zone' ? `⛔ ${nm(e.who)} left the zone and is out` : `☠️ ${nm(e.who)} was caught${e.by ? ' by ' + nm(e.by) : ''}`, '');
    if (e.who === me.id && S.jail) setTimeout(() => toast('⛓️ Head to the jail on the map. A free hider can break you out.', 'hider'), 2500);
  }
  if (e.k === 'radar') {
    if (p && p.role === 'hider' && alive(p)) { toast(`📡 ${nm(e.by)} ran a radar sweep. You just pinged.`, 'hider'); buzz([100, 50, 100]); sendPing('radar'); }
    else toast(`📡 Radar sweep by ${nm(e.by)}`, 'seeker');
  }
  const self_ = (id) => id === me.id;
  const tone = (id) => (P(id)?.role === 'seeker' ? 'seeker' : 'hider');
  if (e.k === 'hunt' && S.settings.shrink && smoothShrink()) setTimeout(() => toast('🌀 The zone is closing in. Stay inside the green line.', ''), 1500);
  if (e.k === 'drop') { beep('alarm'); buzz([100, 60, 100, 60, 300]); toast('📦 Supply drop landed! Everyone can see it. First one there gets a super power-up.', 'good'); }
  if (e.k === 'claim') {
    if (self_(e.who)) { beep('tag'); buzz([60, 40, 160]); toast(`📦 You got ${ITEM_INFO[e.item].ic} ${ITEM_INFO[e.item].name}! ${ITEM_INFO[e.item].desc}.`, 'good'); }
    else toast(`📦 ${nm(e.who)} grabbed the supply drop`, tone(e.who));
  }
  if (e.k === 'shieldHit') { beep('alarm'); toast(self_(e.who) ? `🛡️ Your shield blocked ${e.by ? nm(e.by) + "'s" : 'a'} tag. Run!` : `🛡️ ${nm(e.who)}'s shield blocked a tag`, self_(e.who) ? 'good' : ''); }
  if (e.k === 'shield' && self_(e.by)) toast('🛡️ Shield up. The next tag on you won’t count.', 'hider');
  if (e.k === 'ghost') toast(self_(e.by) ? '🌫️ Ghost mode: your next 2 pings are blocked.' : `🌫️ ${nm(e.by)} went ghost`, self_(e.by) ? 'hider' : '');
  if (e.k === 'blackout') { beep('alarm'); toast(p && p.role === 'seeker' ? `🌑 ${nm(e.by)} blacked out your map for 45 s!` : `🌑 Blackout by ${nm(e.by)}: seekers are blind for 45 s`, p && p.role === 'seeker' ? 'seeker' : 'hider'); }
  if (e.k === 'xray') {
    if (p && p.role === 'hider' && alive(p)) { beep('alarm'); buzz([200, 80, 200]); toast(`🔦 ${nm(e.by)} used X-ray. Your exact spot just pinged.`, 'hider'); sendPing('xray'); }
    else toast(`🔦 X-ray by ${nm(e.by)}: exact spots incoming`, 'seeker');
  }
  if (e.k === 'tracker') {
    if (p && p.role === 'hider' && alive(p)) { beep('alarm'); toast(`🛰️ ${nm(e.by)} launched a tracker: you ping every 15 s for a minute.`, 'hider'); L_.lastTrack = hostNow(); sendPing('tracker'); }
    else toast(`🛰️ Tracker by ${nm(e.by)}: hiders ping every 15 s for a minute`, 'seeker');
  }
  if (e.k === 'mission' && self_(e.who)) { beep('tag'); buzz([60, 40, 160]); toast(`🎯 Mission done! +25${e.item ? ` and ${ITEM_INFO[e.item].ic} ${ITEM_INFO[e.item].name}` : ''}. New target on your map.`, 'good'); }
  if (e.k === 'flag') toast(self_(e.who) ? '🚩 Flag captured! +50' : `🚩 ${nm(e.who)} captured a flag`, self_(e.who) ? 'good' : tone(e.who));
  if (e.k === 'potato') { if (self_(e.who)) { toast('🥔 You grabbed the hot potato: double points, but you ping twice as often.', 'good'); sendPing('potato'); } else toast(`🥔 ${nm(e.who)} has the hot potato`, tone(e.who)); }
  if (e.k === 'potatoDrop' && !self_(e.who)) toast(`🥔 ${nm(e.who)} dropped the hot potato`, '');
  if (e.k === 'extract') { beep('alarm'); buzz([200, 100, 200, 100, 400]); toast('🚁 Extraction point is open! Hiders: reach it for +100. Seekers: guard it.', 'good'); }
  if (e.k === 'extracted') toast(self_(e.who) ? '🚁 You made it out! +100. You are safe.' : `🚁 ${nm(e.who)} escaped`, self_(e.who) ? 'good' : tone(e.who));
  if (e.k === 'breakout') { beep('alarm'); toast((e.freed || []).includes(me.id) ? `⛓️ ${nm(e.by)} broke you out! Run!` : `⛓️ ${nm(e.by)} broke ${e.freed.length} out of jail`, (e.freed || []).includes(me.id) ? 'good' : tone(e.by)); }
  if (e.k === 'sonar') {
    if (p && p.role === 'seeker') { if (myPos) send('seekerLoc', { p: myPos.p }); toast('🔊 A hider used sonar. They can see you for 30 s.', 'seeker'); }
    else { L_.sonarUntil = hostNow() + 30000; toast(`🔊 Sonar by ${nm(e.by)}: seekers visible for 30 s`, 'hider'); }
  }
}

// ---------------- hider pings ----------------
function sendPing(kind = 'scheduled', n = null) {
  const s = S.settings;
  if (n === null) n = kind === 'scheduled' ? L_.lastPingN : 'r' + Date.now();
  if (kind !== 'breach' && hostNow() < ((mine()?.fx || {}).ghostUntil || 0)) { send('ping', { kind: 'ghost', n, p: null }); return; }
  if (!myPos) { send('ping', { kind: 'nosignal', n, p: null }); return; }
  if (kind === 'breach') { send('ping', { kind, n: 'b' + Date.now(), p: myPos.p, blur: 0 }); return; }
  if (kind === 'xray' || kind === 'capture') { send('ping', { kind, n, p: myPos.p, blur: 0 }); return; }
  if (kind === 'scheduled' && L_.swarmArmed) {
    L_.swarmArmed = false;
    const z = currentZone() || S.zone;
    const spots = shuffle([G.randomInDisk(myPos.p, s.blurM), randomSpotIn(z, myPos.p, 80), randomSpotIn(z, myPos.p, 80), randomSpotIn(z, myPos.p, 80)]);
    send('ping', { kind, n, p: spots[0], alts: spots.slice(1), blur: s.blurM });
    toast('🐝 Swarm ping sent: 4 spots, 1 real.', 'hider'); renderSheet(); return;
  }
  if (kind === 'scheduled' && L_.jamArmed) { L_.jamArmed = false; send('ping', { kind: 'jam', n, p: null }); toast('📵 Jammer used. That ping was blocked.', 'hider'); renderSheet(); return; }
  if (kind === 'scheduled' && L_.decoyArmed) { const p = L_.decoyArmed; L_.decoyArmed = null; send('ping', { kind, n, p: G.randomInDisk(p, s.blurM), blur: s.blurM, decoy: true }); toast('👻 Decoy ping sent.', 'hider'); renderSheet(); return; }
  send('ping', { kind, n, p: G.randomInDisk(myPos.p, s.blurM), blur: s.blurM });
}

function clientTick() {
  if (!S) return;
  maybeTakeOverHost();
  hostTick();
  const now = hostNow();
  const p = mine();
  if (S.phase === 'hunting' && p && p.role === 'hider' && alive(p)) {
    const n = Math.floor((now - S.huntStart) / pingMs());
    if (n > L_.lastPingN) { L_.lastPingN = n; sendPing('scheduled', n); if (n > 0) { beep('ping'); buzz(80); toast('📍 You just pinged your location to the seekers.', 'hider'); } }
    if (now < (S.trackerUntil || 0) && now - (L_.lastTrack || 0) >= 15000) { L_.lastTrack = now; sendPing('tracker'); }
    if (S.potato && S.potato.holder === me.id) { // hot potato: an extra ping halfway between the normal ones
      const h = Math.floor((now - S.huntStart) / (pingMs() / 2));
      if (h % 2 === 1 && h > L_.lastPotN) { L_.lastPotN = h; sendPing('potato'); toast('🥔 Hot potato ping', 'hider'); }
    }
    const toNext = pingMs() - ((now - S.huntStart) % pingMs());
    if (toNext <= 10000 && L_.warnedN !== n + 1) { L_.warnedN = n + 1; beep('warn'); buzz([60, 80, 60]); toast('⏱️ Ping in 10 s', 'hider'); }
  }
  if (S.phase === 'hunting' && p) reachThings(p, now);
  // shrink notices
  if (S.phase === 'hunting' && S.settings.shrink && !smoothShrink()) {
    const k = shrinkStep(now);
    if (k > L_.lastShrinkK) { L_.lastShrinkK = k; if (k > 0) toast('🟢 The zone just shrank.', ''); }
  }
  checkZone(now);
  renderHud();
  if (Math.floor(now / 1000) !== clientTick.lastSec) { clientTick.lastSec = Math.floor(now / 1000); renderMarks(); if (S.phase === 'hunting' || S.phase === 'hiding') renderDynamicSheet(); }
}

function near(pt) { return myPos && pt && G.dist(myPos.p, pt) <= REACH_M + Math.min(15, (myPos.acc || 0) / 2); }
function sendOnce(key, t, d, now, gap = 4000) { if ((L_.sentAt[key] || 0) > now - gap) return; L_.sentAt[key] = now; send(t, { ...d, p: myPos.p, acc: myPos.acc }); }
function reachThings(p, now) {
  if (!myPos) return;
  const free = p.role === 'hider' && alive(p);
  for (const x of S.drops || []) if (!x.claimedBy && (free || p.role === 'seeker') && near(x.p)) sendOnce('drop' + x.id, 'claim', { id: x.id }, now);
  if (!free) {
    if (p.role === 'hider' && p.caughtAt && S.jail) L_.capStart = {};
    return;
  }
  if (p.mission && near(p.mission.p)) sendOnce('m' + p.mission.id, 'mission', { id: p.mission.id }, now);
  if (S.potato && !S.potato.holder && near(S.potato.p)) sendOnce('potato' + S.potato.p.join(), 'potato', {}, now);
  if (S.sprint && S.sprint.p && near(S.sprint.p)) sendOnce('extract', 'extract', {}, now);
  if (S.jail && near(S.jail.p) && now >= (S.jailCooldownUntil || 0) && Object.values(S.players).some((x) => x.role === 'hider' && x.caughtAt)) sendOnce('breakout', 'breakout', {}, now, 6000);
  for (const f of S.flags || []) {
    if (f.by) { delete L_.capStart[f.id]; continue; }
    if (!near(f.p)) { if (L_.capStart[f.id]) toast('🚩 You left the flag. Capture reset.', 'hider'); delete L_.capStart[f.id]; continue; }
    if (!L_.capStart[f.id]) { L_.capStart[f.id] = now; L_.capPing[f.id] = 0; toast('🚩 Capturing… stay here for 1 minute. Seekers can see you.', 'hider'); }
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
    geoError = err.code === 1 ? 'Location is blocked. Turn it on for this site to play.' : 'Still looking for GPS…';
    renderSheet();
  }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
}
function onPos(pos) {
  setPos(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
}
function setPos(lat, lng, acc = 10) {
  const first = !myPos;
  geoError = null;
  myPos = { p: [lat, lng], acc: Math.round(acc), t: Date.now() };
  updateMeMarker();
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
async function requestWake() {
  try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S && S.phase !== 'lobby') requestWake(); });

// ---------------- rendering ----------------
function renderAll() { renderHud(); renderSheet(); renderZone(); renderMarks(); updateMeMarker(); }

function renderHud() {
  if (!S) return;
  const p = mine();
  const now = hostNow();
  const phaseEl = $('#hud-phase'), roleEl = $('#hud-role'), t = $('#hud-time'), sub = $('#hud-sub');
  phaseEl.textContent = { lobby: 'Lobby ' + S.code, hiding: 'Hide phase', hunting: 'Hunt', ended: 'Round over' }[S.phase];
  if (p && S.phase !== 'lobby') {
    roleEl.hidden = false;
    roleEl.className = 'pill ' + (p.caughtAt && !S.settings.infection ? 'caught' : p.role);
    roleEl.textContent = p.caughtAt ? (S.settings.infection ? 'Caught · seeking' : 'Caught') : p.role;
  } else roleEl.hidden = true;
  if (S.phase === 'hiding') { t.textContent = fmt(S.huntStart - now); sub.innerHTML = 'until seekers are released'; }
  else if (S.phase === 'hunting') {
    t.textContent = fmt(S.huntEnd - now);
    const toNext = pingMs() - ((now - S.huntStart) % pingMs());
    const left = Object.values(S.players).filter((x) => x.startRole === 'hider' && !x.caughtAt).length;
    sub.innerHTML = `next ping <b>${fmt(toNext)}</b> · ${left} hiding`;
  } else if (S.phase === 'ended') { t.textContent = 'Done'; sub.textContent = `round ${S.round}`; }
  else { t.textContent = S.code; sub.textContent = `${Object.keys(S.players).length} in lobby`; }
  // seeker blindfold during hide phase
  const blind = S.phase === 'hiding' && p && p.role === 'seeker';
  let bf = $('#blindfold');
  if (blind) {
    if (!bf) { bf = document.createElement('div'); bf.id = 'blindfold'; bf.className = 'blindfold'; document.body.appendChild(bf); }
    bf.innerHTML = `<div><h2>You're seeking</h2><p>Stay where you are. Hiders are on the move.</p><div class="mono">${fmt(S.huntStart - now)}</div><p>The map unlocks when the hunt starts.</p></div>`;
  } else if (bf) bf.remove();
}

function renderZone() {
  layers.zone.clearLayers();
  if (!S || !S.zone) return;
  const z = currentZone();
  const nz = nextZone();
  const full = S.phase === 'hunting' && S.settings.shrink ? S.zone : null;
  if (full) zoneLayer(full, { color: '#3dffb5', weight: 1, opacity: .25, fill: false, dashArray: '2 6', interactive: false }).addTo(layers.zone);
  zoneLayer(z, { color: '#3dffb5', weight: 3, opacity: .9, fillColor: '#3dffb5', fillOpacity: .06, interactive: false }).addTo(layers.zone);
  if (nz) zoneLayer(nz, { color: '#ffb547', weight: 2, opacity: .8, fill: false, dashArray: '8 8', interactive: false }).addTo(layers.zone);
}
let lastZoneKey = '';

function renderMarks() {
  if (!S) return;
  const zk = S.phase + ':' + scaleAt(hostNow()).toFixed(3) + ':' + JSON.stringify(S.zone);
  if (zk !== lastZoneKey) { lastZoneKey = zk; renderZone(); }
  layers.marks.clearLayers();
  if (S.phase === 'lobby') return;
  const now = hostNow();
  const p = mine();
  const iSeek = p && p.role === 'seeker';
  const blind = iSeek && S.phase === 'hunting' && now < (S.blackoutUntil || 0);
  document.body.classList.toggle('blackout', !!blind);
  const pin = (pt, html, z = 700, size = 30) => L.marker(pt, { icon: L.divIcon({ className: '', html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] }), zIndexOffset: z, interactive: false }).addTo(layers.marks);
  const ring = (pt, color) => L.circle(pt, { radius: REACH_M, color, weight: 2, dashArray: '4 4', fillOpacity: .15, interactive: false }).addTo(layers.marks);
  if (S.phase === 'hunting') {
    for (const x of S.drops || []) if (!x.claimedBy) { ring(x.p, '#ffd23d'); pin(x.p, '<div class="feat-pin bob">📦</div>'); }
    for (const f of S.flags || []) { ring(f.p, f.by ? P(f.by)?.color || '#888' : '#ff8a3d'); pin(f.p, `<div class="feat-pin">${f.by ? '🏳️' : '🚩'}</div>`); }
    if (S.jail) { ring(S.jail.p, '#ff4d6d'); pin(S.jail.p, '<div class="feat-pin">⛓️</div>'); }
    if (S.potato && !S.potato.holder) { ring(S.potato.p, '#ffb547'); pin(S.potato.p, '<div class="feat-pin bob">🥔</div>'); }
    if (S.sprint && S.sprint.p) { ring(S.sprint.p, '#3dffb5'); pin(S.sprint.p, '<div class="feat-pin bob">🚁</div>', 800, 34); }
    if (p && p.mission && alive(p)) { ring(p.mission.p, '#b98cff'); pin(p.mission.p, '<div class="feat-pin">🎯</div>'); }
  }
  if (blind) return;
  // latest ping per hider + a short faded trail
  const byId = {};
  for (const x of L_.pings) (byId[x.id] = byId[x.id] || []).push(x);
  for (const [id, list] of Object.entries(byId)) {
    const pl = P(id);
    if (!pl) continue;
    if (!iSeek && id !== me.id && S.phase !== 'ended' && pl.role === 'hider') {
      // hiders see teammates' pings too, it's the same info the seekers have
    }
    const real = list.filter((x) => x.p);
    const last = real[real.length - 1];
    real.slice(-4, -1).forEach((x) => L.circleMarker(x.p, { radius: 4, color: pl.color, weight: 1, opacity: .4, fillOpacity: .25, interactive: false }).addTo(layers.marks));
    if (!last || (pl.caughtAt && S.phase !== 'ended')) continue;
    const loud = last.kind === 'breach' || last.kind === 'xray';
    const sub = last.kind === 'breach' ? 'OUT OF ZONE' : last.kind === 'xray' ? 'X-RAY · ' + ago(now - last.t) : (id === me.id ? 'your last ping · ' : '') + ago(now - last.t);
    for (const spot of [last.p, ...(last.alts || [])]) {
      if (last.blur) L.circle(spot, { radius: last.blur, color: pl.color, weight: 1, opacity: .7, fillOpacity: .12, interactive: false }).addTo(layers.marks);
      L.marker(spot, { icon: blipIcon(loud ? '#ff3b52' : pl.color, esc(pl.name), sub), zIndexOffset: 500 }).addTo(layers.marks);
    }
  }
  // catches
  for (const e of S.events) if (e.k === 'catch' && e.p) L.marker(e.p, { icon: L.divIcon({ className: '', html: '<div class="skull">☠️</div>', iconSize: [20, 20], iconAnchor: [10, 10] }), interactive: false }).addTo(layers.marks);
  // seekers visible to hiders via sonar, or to seeker teammates always
  for (const [id, s] of Object.entries(L_.seekerLocs)) {
    if (id === me.id || !P(id)) continue;
    if (now < L_.sonarUntil || iSeek) {
      if (now - s.t > 45000) continue;
      L.marker(s.p, { icon: blipIcon('#ff4d6d', esc(P(id).name), ago(now - s.t)), zIndexOffset: 600 }).addTo(layers.marks);
    }
  }
  if (L_.decoyArmed) L.marker(L_.decoyArmed, { icon: L.divIcon({ className: '', html: '<div class="decoy-pin">👻</div>', iconSize: [22, 22], iconAnchor: [11, 11] }), interactive: false }).addTo(layers.marks);
}


// ---------------- the bottom sheet ----------------
const sheet = $('#sheet');
function setSheet(html) {
  sheet.innerHTML = `<div class="grab" data-act="toggleSheet"></div>` + html;
  sheet.hidden = false;
  sheet.classList.toggle('collapsed', sheetCollapsed);
  requestAnimationFrame(() => document.documentElement.style.setProperty('--sheet-h', (window.innerWidth < 720 ? sheet.offsetHeight : 0) + 'px'));
}
function selectHtml(key, val, disabled) {
  return `<select data-set="${key}" ${disabled ? 'disabled' : ''}>${OPTS[key].map(([v, l]) => `<option value="${v}" ${String(v) === String(val) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
}
function playerRow(id, extra = '') {
  const p = P(id); const on = peers.has(id);
  return `<div class="player ${on ? '' : 'off'}"><span class="dot" style="background:${p.color}"></span><span class="nm">${esc(p.name)}${id === me.id ? ' (you)' : ''}${id === S.hostId ? ' 👑' : ''}</span>${extra}</div>`;
}

function renderSheet() {
  if (chatOpen) { renderChat(); return; }
  if (!S) {
    setSheet(`<div class="sheet-h"><h2>Joining ${esc(code || '')}…</h2></div><p class="note">Connecting to the game. Keep this screen open.</p><div class="big-actions"><button class="btn" data-act="leave">Back</button></div>`);
    return;
  }
  if (S.phase === 'lobby') return renderLobby();
  if (S.phase === 'ended') return renderEnded();
  renderPlaying();
}

function geoNote() {
  if (geoError) return `<p class="note" style="color:var(--warn)">📍 ${esc(geoError)}</p>`;
  if (!myPos) return `<p class="note">📍 Finding your location…</p>`;
  return '';
}

function renderLobby() {
  const host = isHost();
  const s = S.settings;
  const ids = Object.keys(S.players).sort((a, b) => S.players[a].joinedAt - S.players[b].joinedAt);
  const online = ids.filter((id) => peers.has(id));
  const canStart = host && S.zone && online.length >= 2;
  const z = S.zone;
  const zoneInfo = z ? `${z.type === 'circle' ? 'Circle, ' + G.fmtDist(z.r) + ' radius' : 'Custom shape, ' + z.pts.length + ' corners'} · ${(G.zoneArea(z) / 1e6).toFixed(2)} km²` : 'No zone yet';
  const drafting = host && zoneDraft;
  let zoneTools = '';
  if (host) {
    if (!drafting) zoneTools = `<div class="tools"><button class="btn small" data-act="zoneHere" ${myPos ? '' : 'disabled'}>◎ Circle around me</button><button class="btn small" data-act="drawCircle">◯ Pick a circle</button><button class="btn small" data-act="drawPoly">⬠ Draw a shape</button></div>`;
    else if (zoneDraft.type === 'circle') zoneTools = `<p class="note">${zoneDraft.c ? 'Drag the slider to size it, or tap the map to move it.' : 'Tap the map to drop the center.'}</p>
      <input type="range" class="range" min="50" max="3000" step="25" value="${zoneDraft.r}" data-act="radius"><div class="row"><span class="note" style="margin:0">Radius ${G.fmtDist(zoneDraft.r)}</span></div>
      <div class="big-actions"><button class="btn" data-act="zoneCancel">Cancel</button><button class="btn primary" data-act="zoneSave" ${zoneDraft.c ? '' : 'disabled'}>Use this zone</button></div>`;
    else zoneTools = `<p class="note">Tap the map to add corners (${zoneDraft.pts.length} so far, need 3+).</p>
      <div class="big-actions"><button class="btn small" data-act="zoneUndo">Undo</button><button class="btn small" data-act="zoneCancel">Cancel</button><button class="btn primary small" data-act="zoneSave" ${zoneDraft.pts.length >= 3 ? '' : 'disabled'}>Use this zone</button></div>`;
  }
  const settings = `<div class="settings">
    <label class="set" style="grid-column:1/-1">How tags work${selectHtml('tagMode', s.tagMode, !host)}</label>
    <label class="set">Hide time${selectHtml('hideSec', s.hideSec, !host)}</label>
    <label class="set">Round length${selectHtml('huntSec', s.huntSec, !host)}</label>
    <label class="set">Ping every${selectHtml('pingSec', s.pingSec, !host)}</label>
    <label class="set">Ping fuzz${selectHtml('blurM', s.blurM, !host)}</label>
    ${s.fugitive ? '' : `<label class="set">Seekers${selectHtml('seekers', s.seekers, !host)}</label>`}
    ${s.tagMode === 'gps' ? `<label class="set">Tag range${selectHtml('tagRadiusM', s.tagRadiusM, !host)}</label>` : ''}
    ${s.shrink ? `<label class="set">Zone${selectHtml('shrinkStyle', s.shrinkStyle || 'steps', !host)}</label><label class="set">Final zone${selectHtml('shrinkTo', s.shrinkTo, !host)}</label>` : ''}
    ${s.drops ? `<label class="set" style="grid-column:1/-1">Supply drops${selectHtml('dropSec', s.dropSec, !host)}</label>` : ''}
  </div>`;
  const modes = `<div class="modes">${MODES.map(([k, t, d]) => `<label class="set toggle mode ${s[k] ? 'on' : ''}"><span><b>${t}</b><small>${d}</small></span><input type="checkbox" data-set="${k}" ${s[k] ? 'checked' : ''} ${host ? '' : 'disabled'}></label>`).join('')}</div>`;
  setSheet(`
    <div class="sheet-h"><div><div class="section-t" style="margin:0">Game code</div><div class="code-big mono">${esc(S.code)}</div></div>
      <div class="row"><button class="btn small" data-act="share">Invite</button><button class="btn small" data-act="qr">QR</button></div></div>
    ${geoNote()}
    <div class="section"><div class="section-t">Players (${online.length} here)</div><div class="players">
      ${ids.map((id) => playerRow(id, `<span class="meta">${S.totals[id] ? S.totals[id] + ' pts' : ''}</span>${host && id !== me.id ? `<button class="x" data-act="kick" data-id="${id}" aria-label="Remove">×</button>` : ''}`)).join('')}
    </div></div>
    <div class="section"><div class="section-t">Play zone</div><p class="note" style="margin:0 0 8px">${zoneInfo}</p>${zoneTools}</div>
    <div class="section"><div class="section-t">Game modes: mix and match${host ? '' : ' (host sets these)'}</div>${modes}</div>
    <div class="section"><div class="section-t">Rules${host ? '' : ' (host sets these)'}</div>${settings}</div>
    <div class="big-actions">
      <button class="btn ghost" data-act="leave">Leave</button>
      ${host ? `<button class="btn primary big" data-act="start" ${canStart ? '' : 'disabled'}>Start round</button>` : `<button class="btn big" disabled>Waiting for host</button>`}
    </div>
    ${host && !canStart ? `<p class="hint">${!S.zone ? 'Set a play zone to start.' : 'Need at least 2 players.'}</p>` : ''}
  `);
}

function itemsHtml(role) {
  const p = mine();
  if (!puOn(S.settings) || !p) return '';
  const inv = p.inv || {}, fx = p.fx || {}, now = hostNow();
  const armedOf = (k) => (k === 'decoy' && (L_.decoyArmed || L_.placingDecoy)) || (k === 'jammer' && L_.jamArmed) || (k === 'swarm' && L_.swarmArmed)
    || (k === 'shield' && fx.shield) || (k === 'ghost' && now < (fx.ghostUntil || 0));
  const keys = Object.keys(ITEM_INFO).filter((k) => ITEM_INFO[k].role === role && ((inv[k] || 0) > 0 || armedOf(k)));
  const how = [S.settings.drops && 'grab a 📦 supply drop', role === 'seeker' && 'catch someone', role === 'hider' && S.settings.missions && 'finish a 🎯 mission'].filter(Boolean).join(' or ');
  if (!keys.length) return `<p class="hint">No power-ups right now.${how ? ' To get one, ' + how + '.' : ''}</p>`;
  return `<div class="items">${keys.map((k) => {
    const n = inv[k] || 0, armed = armedOf(k);
    return `<button class="item ${armed ? 'armed' : ''} ${ITEM_INFO[k].sup ? 'super' : ''}" data-act="item" data-item="${k}" ${n <= 0 && !(k === 'decoy' && L_.placingDecoy) ? 'disabled' : ''}><span class="ic">${ITEM_INFO[k].ic}</span>${ITEM_INFO[k].name}${n > 1 ? ' ×' + n : ''}<small>${armed && n <= 0 ? 'active' : ITEM_INFO[k].desc}</small></button>`;
  }).join('')}</div>`;
}
function modeLines(p, now) {
  const L2 = [];
  const far = (pt) => (myPos ? G.fmtDist(G.dist(myPos.p, pt)) + ' away' : 'see map');
  if (p.role === 'hider' && p.extracted) return '<p class="note">🚁 You escaped. Sit back and watch.</p>';
  if (p.role === 'hider' && p.caughtAt && S.jail) return `<p class="note">⛓️ You're in jail (${far(S.jail.p)}). Walk there and wait. A free hider who reaches it breaks everyone out.</p>`;
  if (p.role === 'hider' && alive(p)) {
    if (p.mission) L2.push(`🎯 Secret mission: reach your target, ${far(p.mission.p)}`);
    for (const f of S.flags || []) if (L_.capStart[f.id]) L2.push(`🚩 Capturing: ${Math.min(100, Math.floor((now - L_.capStart[f.id]) / 600))}% · stay put`);
    if (S.jail && Object.values(S.players).some((x) => x.role === 'hider' && x.caughtAt)) L2.push(`⛓️ Friends in jail, ${far(S.jail.p)}${now < (S.jailCooldownUntil || 0) ? ' · locked for ' + fmt(S.jailCooldownUntil - now) : ''}`);
    if (S.potato && S.potato.holder === me.id) L2.push(`🥔 You have the hot potato: double points, extra pings <button class="btn small" data-act="dropPotato">Drop it</button>`);
  }
  if (S.potato && !S.potato.holder && (p.role === 'seeker' || alive(p))) L2.push('🥔 The hot potato is up for grabs');
  if (S.sprint && S.sprint.p) L2.push(`🚁 Extraction open, ${far(S.sprint.p)}`);
  else if (S.sprint && p.role === 'hider' && alive(p)) L2.push(`🚁 Extraction opens in ${fmt(S.sprint.at - now)}`);
  return L2.length ? `<div class="mode-lines">${L2.map((x) => `<div>${x}</div>`).join('')}</div>` : '';
}

function renderPlaying() {
  const p = mine();
  if (!p) { setSheet(`<div class="sheet-h"><h2>Round in progress</h2></div><p class="note">You'll join as a seeker in a moment.</p>`); return; }
  const host = isHost();
  const hiders = Object.entries(S.players).filter(([, x]) => x.startRole === 'hider');
  const status = hiders.map(([id, x]) => `<span class="pill" style="border-color:${x.color};color:${x.caughtAt ? 'var(--muted)' : x.color}">${x.caughtAt ? '☠️ ' : ''}${esc(x.name)}</span>`).join(' ');
  let body = '';
  if (p.role === 'seeker') {
    const tm = S.settings.tagMode || 'gps';
    body = `<div id="dyn"></div>
      <button class="tag-btn" data-act="${tm === 'photo' ? 'snap' : 'tag'}" ${S.phase === 'hunting' && (myPos || tm !== 'gps') ? '' : 'disabled'}>${tm === 'photo' ? '📸 SNAP TAG' : 'TAG'}</button>
      <input type="file" id="snap-in" accept="image/*" capture="environment" hidden>
      <p class="hint">${TAG_HINT[tm](S.settings)}</p>
      ${itemsHtml('seeker')}`;
  } else {
    body = `<div id="dyn"></div>${alive(p) ? itemsHtml('hider') : ''}
      ${L_.placingDecoy ? `<p class="hint" style="color:var(--accent)">Tap the map inside the zone to place your decoy.</p>` : ''}
      ${alive(p) ? '<div class="big-actions"><button class="btn small" data-act="selfCaught">I got caught</button></div>' : ''}`;
  }
  setSheet(`
    <div class="row" style="justify-content:space-between;margin-bottom:8px"><div class="row">${status}</div></div>
    ${geoNote()}
    ${body}
    ${host ? `<div class="big-actions"><button class="btn small ghost" data-act="ruleCatch">Rule a catch</button><button class="btn small ghost" data-act="endNow">End round</button></div>` : ''}
  `);
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
    el.innerHTML = `<div class="stat-row" style="margin-bottom:10px">
      <div class="stat"><b>${best && best.d !== null ? G.fmtDist(best.d) : '—'}</b><span>${best ? 'to ' + nm(best.id) + "'s last ping" : 'no pings yet'}</span></div>
      <div class="stat"><b class="mono">${S.phase === 'hunting' ? fmt(pingMs() - ((now - S.huntStart) % pingMs())) : fmt(S.huntStart - now)}</b><span>${S.phase === 'hunting' ? 'until next ping' : 'until the hunt'}</span></div></div>${modeLines(p, now)}`;
  } else if (p.caughtAt) {
    el.innerHTML = p.extracted || S.jail ? modeLines(p, now) : `<p class="note">You were caught. ${S.settings.infection ? '' : 'Watch the rest of the round.'}</p>`;
  } else {
    const z = currentZone(now);
    const ed = myPos && z ? G.edgeDistance(myPos.p, z) : null;
    el.innerHTML = `<div class="stat-row" style="margin-bottom:4px">
      <div class="stat"><b class="mono">${S.phase === 'hunting' ? fmt(pingMs() - ((now - S.huntStart) % pingMs())) : fmt(S.huntStart - now)}</b><span>${S.phase === 'hunting' ? 'until you ping' : 'to hide'}</span></div>
      <div class="stat"><b>${ed === null ? '—' : ed >= 0 ? G.fmtDist(ed) : 'OUT'}</b><span>${ed === null || ed >= 0 ? 'to the zone edge' : 'of the zone!'}</span></div></div>${modeLines(p, now)}`;
  }
}

function renderEnded() {
  if (replay) {
    setSheet(`<div class="sheet-h"><h2>Replay · round ${S.round}</h2><button class="btn small" data-act="replayClose">Scores</button></div>
      <div class="replay"><button class="btn small" data-act="replayPlay">${replay.playing ? '❚❚' : '▶'}</button><input type="range" min="0" max="1000" value="${Math.round(replay.pos * 1000)}" data-act="replaySeek"><span class="mono note" style="margin:0" id="rp-t"></span></div>
      <p class="note">☠️ marks where people got caught. Paths show up as each phone sends them in.</p>`);
    return;
  }
  const r = S.results || {};
  const ids = Object.keys(S.players);
  const roundRank = ids.slice().sort((a, b) => (r[b]?.pts || 0) - (r[a]?.pts || 0));
  const totRank = ids.slice().sort((a, b) => (S.totals[b] || 0) - (S.totals[a] || 0));
  const survivors = ids.filter((id) => r[id]?.survived);
  const headline = S.endWhy === 'allCaught' ? 'Seekers win. Everyone got caught.' : survivors.length ? `Hiders win: ${survivors.map(nm).join(', ')} made it` : S.settings.sprint ? 'Seekers win. Nobody reached extraction.' : 'Round over';
  const line = (id, i, pts, meta) => playerRow(id, `<span class="meta">${meta}</span><span class="pts">${pts}</span>`).replace('<span class="dot"', `<span class="rk">${i + 1}</span><span class="dot"`);
  setSheet(`
    <div class="sheet-h"><h2>${headline}</h2></div>
    <div class="section"><div class="section-t">Round ${S.round}</div><div class="lb">
      ${roundRank.map((id, i) => { const x = r[id] || {}; const meta = x.startRole === 'hider' ? (x.extracted ? 'escaped' : x.survived ? 'survived' : 'hid ' + fmt(x.survivedMs)) : (x.catches ? x.catches + ' catch' + (x.catches > 1 ? 'es' : '') : 'seeker'); return line(id, i, '+' + (x.pts || 0), meta); }).join('')}
    </div></div>
    <div class="section"><div class="section-t">Overall</div><div class="lb">
      ${totRank.map((id, i) => line(id, i, S.totals[id] || 0, '')).join('')}
    </div></div>
    <div class="section"><div class="section-t">Replay</div>
      <button class="btn" data-act="replay" style="width:100%">▶ Watch everyone's paths</button></div>
    <div class="big-actions"><button class="btn ghost" data-act="leave">Leave</button>
      ${isHost() ? `<button class="btn primary big" data-act="again">Next round</button>` : `<button class="btn big" disabled>Host starts the next round</button>`}</div>
  `);
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
    L.polyline(pts.map((x) => [x[0], x[1]]), { color: pl.color, weight: 2, opacity: .35, interactive: false }).addTo(layers.replay);
    const past = pts.filter((x) => x[2] <= t);
    if (past.length > 1) L.polyline(past.map((x) => [x[0], x[1]]), { color: pl.color, weight: 4, opacity: .95, interactive: false }).addTo(layers.replay);
    const cur = past[past.length - 1] || pts[0];
    L.marker([cur[0], cur[1]], { icon: blipIcon(pl.color, esc(pl.name), ''), interactive: false }).addTo(layers.replay);
    pts.forEach((x) => bounds.push([x[0], x[1]]));
  }
  for (const e of S.events) if (e.k === 'catch' && e.p && e.t <= t) L.marker(e.p, { icon: L.divIcon({ className: '', html: '<div class="skull">☠️</div>', iconSize: [20, 20], iconAnchor: [10, 10] }) }).addTo(layers.replay);
  if (!replay.fitted && bounds.length) { fitTo(bounds); replay.fitted = true; }
  const lbl = $('#rp-t'); if (lbl) lbl.textContent = fmt(t - replay.t0);
}

// ---------------- chat ----------------
function renderChat() {
  const role = mine()?.role;
  const list = chat.filter((c) => (chatTab === 'all' ? c.team === 'all' : c.team !== 'all'));
  setSheet(`
    <div class="sheet-h"><h2>Chat</h2><button class="btn small" data-act="closeChat">Close</button></div>
    ${S && S.phase !== 'lobby' && role ? `<div class="seg"><button class="${chatTab === 'all' ? 'on' : ''}" data-act="chatTab" data-tab="all">Everyone</button><button class="${chatTab === 'team' ? 'on' : ''}" data-act="chatTab" data-tab="team">${role === 'seeker' ? 'Seekers' : 'Hiders'} only</button></div>` : ''}
    <div class="chat-log" id="chat-log">${list.length ? list.map((c) => `<div class="msg ${c.team !== 'all' ? 'team' : ''}"><b style="color:${c.color}">${esc(c.name)}</b><span class="tm">${new Date(c.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span><div>${esc(c.text)}</div></div>`).join('') : '<p class="note">No messages yet.</p>'}</div>
    <form class="chat-form" data-act="chatSend"><input id="chat-in" maxlength="200" placeholder="Say something" autocomplete="off"><button class="btn primary">Send</button></form>
  `);
  const log = $('#chat-log'); if (log) log.scrollTop = log.scrollHeight;
}

// ---------------- modal ----------------
function modal(html) {
  const m = $('#modal');
  $('.modal-card', m).innerHTML = html;
  m.hidden = false;
}
function closeModal() { $('#modal').hidden = true; }
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal' || e.target.closest('[data-act="closeModal"]')) closeModal(); });

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
  switch (a) {
    case 'toggleSheet': sheetCollapsed = !sheetCollapsed; sheet.classList.toggle('collapsed', sheetCollapsed); document.documentElement.style.setProperty('--sheet-h', (window.innerWidth < 720 ? sheet.offsetHeight : 0) + 'px'); break;
    case 'leave': if (!S || S.phase === 'lobby' || S.phase === 'ended' || confirm('Leave this game?')) leave(); break;
    case 'share': {
      const url = inviteUrl();
      if (navigator.share) navigator.share({ title: 'Ghostline', text: `Join my Ghostline game. Code ${S.code}`, url }).catch(() => {});
      else navigator.clipboard?.writeText(url).then(() => toast('Invite link copied', 'good'), () => toast(url));
      break;
    }
    case 'qr': {
      modal(`<h3>Scan to join ${esc(S.code)}</h3><div class="qr" id="qr"></div><button class="btn" data-act="closeModal" style="width:100%">Done</button>`);
      try { const q = qrcode(0, 'M'); q.addData(inviteUrl()); q.make(); $('#qr').innerHTML = q.createSvgTag({ cellSize: 6, margin: 0, scalable: true }); } catch { $('#qr').textContent = inviteUrl(); }
      break;
    }
    case 'kick': if (isHost() && confirm('Remove ' + P(el.dataset.id)?.name + '?')) hostApply((s) => { delete s.players[el.dataset.id]; s.kicked.push(el.dataset.id); }); break;
    case 'zoneHere': if (myPos) { hostApply((s) => { s.zone = { type: 'circle', c: myPos.p, r: 300 }; }); fitZone(S.zone); } break;
    case 'drawCircle': zoneDraft = { type: 'circle', c: null, r: 300 }; toast('Tap the map to set the center'); renderSheet(); break;
    case 'drawPoly': zoneDraft = { type: 'poly', pts: [] }; toast('Tap the map to add corners'); renderSheet(); break;
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
    case 'again': hostApply((s) => { s.phase = 'lobby'; s.events = []; s.results = null; for (const x of Object.values(s.players)) { x.role = 'hider'; x.caughtAt = null; x.inv = {}; x.fx = {}; x.extracted = null; x.mission = null; } s.drops = []; s.flags = []; s.jail = null; s.potato = null; s.sprint = null; }); break;
    case 'endNow': if (confirm('End this round now?')) hostApply((s) => endRound(s, 'host')); break;
    case 'dropPotato': if (myPos && S.potato && S.potato.holder === me.id) { send('potatoDrop', { p: myPos.p, acc: myPos.acc }); toast('🥔 You dropped the hot potato.', 'hider'); } break;
    case 'snap': { const fi = $('#snap-in'); if (fi) { fi.value = ''; fi.click(); } break; }
    case 'ruleCatch': {
      const hs = Object.entries(S.players).filter(([, x]) => x.role === 'hider' && !x.caughtAt);
      modal(`<h3>Rule a catch</h3><p>Who got caught?</p><div class="stack">${hs.map(([id, x]) => `<button class="btn" data-act2="ruleWho" data-id="${id}" style="border-color:${x.color}">${esc(x.name)}</button>`).join('') || '<p>No hiders left.</p>'}<button class="btn ghost" data-act="closeModal">Cancel</button></div>`);
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
      toast('TAG sent. Anyone within ' + S.settings.tagRadiusM + ' m is out.', 'seeker');
      break;
    }
    case 'item': {
      const item = el.dataset.item;
      if (!ITEM_INFO[item] || (((p.inv && p.inv[item]) || 0) < 1 && !(item === 'decoy' && L_.placingDecoy))) return;
      if (item === 'decoy') { L_.placingDecoy = !L_.placingDecoy; renderSheet(); if (L_.placingDecoy) toast('Tap the map inside the zone to place your decoy', 'hider'); return; }
      if (item === 'jammer') { if (L_.jamArmed) return; L_.jamArmed = true; send('useItem', { item }); toast('📵 Jammer armed. Your next ping is blocked.', 'hider'); }
      if (item === 'swarm') { if (L_.swarmArmed) return; L_.swarmArmed = true; send('useItem', { item }); toast('🐝 Swarm armed. Your next ping shows 4 spots.', 'hider'); }
      if (['sonar', 'ghost', 'shield', 'blackout', 'xray', 'tracker'].includes(item)) send('useItem', { item });
      if (item === 'radar') { send('useItem', { item }); toast('📡 Radar sweep! Every hider pings now.', 'seeker'); }
      setTimeout(renderSheet, 50);
      break;
    }
    case 'selfCaught': {
      const seekers = Object.entries(S.players).filter(([, x]) => x.role === 'seeker');
      modal(`<h3>Who caught you?</h3><p>Be honest. It gives them the points.</p><div class="stack">${seekers.map(([id, x]) => `<button class="btn" data-act2="caughtBy" data-id="${id}" style="border-color:${x.color}">${esc(x.name)}</button>`).join('')}<button class="btn ghost" data-act="closeModal">Never mind</button></div>`);
      break;
    }
    case 'replay': startReplay(); break;
    case 'replayClose': if (replay) { replay.playing = false; replay = null; layers.replay.clearLayers(); renderEnded(); } break;
    case 'replayPlay': if (replay) { if (replay.playing) { replay.playing = false; renderEnded(); } else { if (replay.pos >= 1) replay.pos = 0; startReplayLoop(); } } break;
    case 'closeChat': chatOpen = false; renderSheet(); break;
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
    modal(`<h3>Who caught ${nm(d.id)}?</h3><div class="stack">${ss.map(([id, x]) => `<button class="btn" data-act2="ruleBy" data-who="${d.id}" data-id="${id}" style="border-color:${x.color}">${esc(x.name)}</button>`).join('')}<button class="btn ghost" data-act2="ruleBy" data-who="${d.id}" data-id="">Nobody / not sure</button></div>`);
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
  modal(`<h3>${title}</h3><div class="stack">${hs.map(({ id, x, d }) => `<button class="btn" data-act2="pick" data-id="${id}" style="border-color:${x.color}">${esc(x.name)}${isFinite(d) ? ` <span style="color:var(--muted)">· last ping ${G.fmtDist(d)}</span>` : ''}</button>`).join('')}<button class="btn ghost" data-act="closeModal">Cancel</button></div>`);
}
function sendTagReq(target, img) {
  if (Date.now() < L_.tagCooldown) { toast('Tag recharging…'); return; }
  L_.tagCooldown = Date.now() + 3000;
  const reqId = 'r' + Math.random().toString(36).slice(2, 9);
  send(img ? 'photoTag' : 'tagReq', { reqId, target, img: img || undefined });
  buzz(40);
  toast(`${img ? '📸 Photo' : 'Tag'} sent to ${nm(target)}. Waiting for them to confirm…`, 'seeker');
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
  modal(`<h3>${q.kind === 'photo' ? `📸 ${nm(q.by)} snapped you?` : `${nm(q.by)} says they tagged you`}</h3>
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
  if (zoneDraft && isHost() && S.phase === 'lobby') {
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
    toast('👻 Decoy set. Your next ping shows there.', 'hider');
    renderSheet(); renderMarks();
  }
});
function drawDraft() {
  layers.draft.clearLayers();
  if (!zoneDraft) return;
  if (zoneDraft.type === 'circle' && zoneDraft.c) L.circle(zoneDraft.c, { radius: zoneDraft.r, color: '#ffb547', weight: 2, dashArray: '6 6', fillOpacity: .08 }).addTo(layers.draft);
  if (zoneDraft.type === 'poly') {
    zoneDraft.pts.forEach((p) => L.circleMarker(p, { radius: 5, color: '#ffb547', fillOpacity: 1 }).addTo(layers.draft));
    if (zoneDraft.pts.length > 1) L.polygon(zoneDraft.pts, { color: '#ffb547', weight: 2, dashArray: '6 6', fillOpacity: .08 }).addTo(layers.draft);
  }
}

$('#btn-locate').addEventListener('click', () => { if (myPos) map.setView(myPos.p, Math.max(map.getZoom(), 17)); else toast('No location yet'); });
$('#btn-chat').addEventListener('click', () => { chatOpen = !chatOpen; unread = false; $('#chat-dot').hidden = true; if (chatOpen) renderChat(); else renderSheet(); });

// ---------------- home screen ----------------
const inName = $('#in-name'), inCode = $('#in-code');
inName.value = me.name || '';
if (params.get('room')) inCode.value = params.get('room').toUpperCase().slice(0, 4);
inCode.addEventListener('input', () => { inCode.value = inCode.value.toUpperCase().replace(/[^A-Z]/g, ''); });
function showHomeErr(t) { const e = $('#home-err'); e.textContent = t; e.hidden = !t; }
function setHomeBusy(b) { $('#btn-create').disabled = b; $('#btn-join').disabled = b; }
function takeName() {
  const n = inName.value.trim();
  if (!n) { showHomeErr('Pick a name first.'); inName.focus(); return null; }
  me.name = n.slice(0, 16); saveMe(); showHomeErr('');
  try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); actx.resume(); } catch {}
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

function enterGameUI() {
  $('#home').hidden = true;
  $('#hud').hidden = false;
  renderSheet();
  setTimeout(() => map.invalidateSize(), 50);
}
function leave(msg) {
  try { net && net.close(); } catch {}
  net = null; S = null; code = null; prevPhase = null; prevRound = 0; zoneDraft = null; replay = null; fittedZone = false;
  processed.clear(); chat.length = 0; resetLocal();
  layers.zone.clearLayers(); layers.marks.clearLayers(); layers.replay.clearLayers(); layers.draft.clearLayers();
  $('#home').hidden = false; $('#hud').hidden = true; sheet.hidden = true; banner(null);
  $('#blindfold')?.remove();
  history.replaceState(null, '', location.pathname);
  if (msg) showHomeErr(msg);
}

setInterval(clientTick, 500);

// test and debug hooks
window.__gl = {
  get S() { return S; }, get me() { return me; }, get peers() { return [...peers]; }, get local() { return L_; },
  get myPos() { return myPos; }, hostNow, currentZone,
  ...(DEBUG ? {
    setPos, act, send,
    setSettings: (o) => hostApply((s) => { Object.assign(s.settings, o); if (o.jail) s.settings.infection = false; if (o.infection) s.settings.jail = false; }),
    setZone: (z) => hostApply((s) => { s.zone = z; }),
    tapMap: (lat, lng) => map.fire('click', { latlng: L.latLng(lat, lng) }),
    give: (id, item) => hostApply((s) => { const q = s.players[id]; q.inv = q.inv || {}; q.inv[item] = (q.inv[item] || 0) + 1; }),
    spawnDrop: () => hostApply((s) => spawnDrop(s)),
    openExtraction: () => hostApply((s) => { if (s.sprint) s.sprint.at = Date.now(); }),
  } : {}),
};
