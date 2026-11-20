// End-to-end round with 4 simulated phones (headless Chromium + the local relay).
// Usage: CHROME=/path/to/chrome node test/sim.mjs   (needs playwright-core)
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8800 + Math.floor(Math.random() * 100);
const BASE = `http://localhost:${PORT}/`;
const SHOTS = process.env.SHOTS || '';
const C = [40.7812, -73.9665]; // an open park area
const off = (dx, dy) => [C[0] + dy / 111320, C[1] + dx / (111320 * Math.cos((C[0] * Math.PI) / 180))];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };

const srv = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: 'pipe' });
await new Promise((r) => srv.stdout.on('data', (d) => String(d).includes('Ghostline') && r()));

const browser = await chromium.launch({ executablePath: process.env.CHROME, args: (process.env.CHROME_ARGS || '').split(' ').filter(Boolean), headless: true });
const errors = [];
async function phone(pid, name, pos) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, geolocation: { latitude: pos[0], longitude: pos[1], accuracy: 8 }, permissions: ['geolocation'] });
  await ctx.route(/basemaps\.cartocdn\.com|fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED/.test(m.text())) errors.push(`${name}: ${m.text()}`); });
  await page.goto(`${BASE}?debug&net=relay&pid=${pid}`);
  await page.fill('#in-name', name);
  return { page, ctx, pid, name };
}
const G = (ph, fn, arg) => ph.page.evaluate(fn, arg);
function makePng(w, h) { // a small valid PNG for the photo-tag test
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * (w * 3 + 1) + 1 + x * 3; raw[i] = 40 + x * 3; raw[i + 1] = 200 - y * 2; raw[i + 2] = 180; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const state = (ph) => G(ph, () => window.__gl.S);
const setPos = (ph, p) => G(ph, ([a, b]) => window.__gl.setPos(a, b, 8), p);
async function until(fn, ms = 15000, label = '') {
  const t = Date.now();
  while (Date.now() - t < ms) { if (await fn()) return true; await sleep(250); }
  console.log('  timed out waiting for ' + label);
  return false;
}

// ---- lobby
const host = await phone('host', 'Mark', C);
await host.page.click('#btn-create');
await until(async () => (await state(host))?.code, 8000, 'room');
const code = (await state(host)).code;
ok(/^[A-Z]{4}$/.test(code), 'host created room ' + code);

const others = [];
for (const [pid, name] of [['p2', 'Ana'], ['p3', 'Ben'], ['p4', 'Cy']]) {
  const ph = await phone(pid, name, C);
  await ph.page.fill('#in-code', code);
  await ph.page.click('#btn-join');
  others.push(ph);
}
const all = [host, ...others];
ok(await until(async () => Object.keys((await state(host)).players).length === 4, 10000, 'joins'), 'all 4 players in the lobby');
ok(await until(async () => (await Promise.all(others.map(state))).every((s) => s && Object.keys(s.players).length === 4), 8000, 'sync'), 'every phone sees the same lobby');

// zone tools: draw a circle by tapping the map
await G(host, () => window.__gl.act('drawCircle'));
await G(host, ([a, b]) => window.__gl.tapMap(a, b), C);
await host.page.click('[data-act="zoneSave"]');
ok(await until(async () => (await state(others[0]))?.zone?.type === 'circle', 5000, 'zone'), 'zone drawn by host reaches players');
await G(host, ([c]) => window.__gl.setZone({ type: 'circle', c, r: 400 }), [C]);
await G(host, () => window.__gl.setSettings({ hideSec: 3, huntSec: 100, pingSec: 9, blurM: 25, tagRadiusM: 20, graceSec: 4, shrinkTo: 0.5, shrinkStyle: 'steps', strictZone: false, drops: false, starter: true, infection: true }));
await G(host, () => window.__gl.act('mapDone')); // back from the map to the lobby
if (SHOTS) await host.page.screenshot({ path: SHOTS + '/1-lobby.png' });
await host.page.click('[data-act="start"]');

// ---- roles
ok(await until(async () => (await state(host)).phase === 'hiding', 5000, 'hiding'), 'round starts in hide phase');
let st = await state(host);
const seekerPid = Object.entries(st.players).find(([, p]) => p.role === 'seeker')[0];
const seeker = all.find((p) => p.pid === seekerPid);
const hiders = all.filter((p) => p.pid !== seekerPid);
ok(Object.values(st.players).filter((p) => p.role === 'seeker').length === 1, `exactly one random seeker (${seeker.name})`);
if (SHOTS) await seeker.page.screenshot({ path: SHOTS + '/2-seeker-blindfold.png' });

// hiders scatter inside the zone (one via real browser geolocation to prove the GPS path works)
const spots = [off(150, 100), off(-200, 50), off(60, -250)];
await hiders[0].ctx.setGeolocation({ latitude: spots[0][0], longitude: spots[0][1], accuracy: 8 });
await setPos(hiders[1], spots[1]);
await setPos(hiders[2], spots[2]);
ok(await until(async () => { const m = await G(hiders[0], () => window.__gl.myPos); return m && Math.abs(m.p[0] - spots[0][0]) < 1e-6; }, 5000, 'gps'), 'browser GPS updates reach the game');

// ---- hunt + first pings
ok(await until(async () => (await state(seeker)).phase === 'hunting', 8000, 'hunting'), 'hunt starts after hide timer');
ok(await until(async () => (await G(seeker, () => window.__gl.local.pings.filter((x) => x.n === 0 && x.p).length)) === 3, 6000, 'pings'), 'seeker gets the opening ping from all 3 hiders');
const pings0 = await G(seeker, () => window.__gl.local.pings.filter((x) => x.n === 0));
const dists = pings0.map((pg) => { const i = hiders.findIndex((h) => h.pid === pg.id); const s = spots[i]; return Math.hypot((pg.p[0] - s[0]) * 111320, (pg.p[1] - s[1]) * 111320 * Math.cos((C[0] * Math.PI) / 180)); });
ok(dists.every((d) => d <= 25.5), 'pings are fuzzed but within the 25 m blur (' + dists.map((d) => d.toFixed(0)).join(', ') + ' m)');
ok(dists.some((d) => d > 0.5), 'pings are not exact');
// hiders never send live positions: seeker only knows pings
const seekerMsgsWithPos = await G(seeker, () => Object.keys(window.__gl.local.seekerLocs).length);
ok(seekerMsgsWithPos === 0, 'no live hider positions leak outside pings');

// ---- power-ups: jammer, decoy, radar
await G(hiders[0], () => window.__gl.act('item', { dataset: { item: 'jammer' } }));
const decoySpot = off(-300, -100);
await G(hiders[1], () => window.__gl.act('item', { dataset: { item: 'decoy' } }));
await G(hiders[1], ([a, b]) => window.__gl.tapMap(a, b), decoySpot);
ok(await until(async () => (await G(seeker, () => window.__gl.local.pings.filter((x) => x.n === 1).length)) >= 3, 12000, 'ping 1'), 'second ping round arrives');
const p1 = await G(seeker, () => window.__gl.local.pings.filter((x) => x.n === 1));
const jam = p1.find((x) => x.id === hiders[0].pid);
ok(jam && jam.kind === 'jam' && !jam.p, 'jammer blocks that hider\'s next ping');
const dec = p1.find((x) => x.id === hiders[1].pid);
const dd = dec && Math.hypot((dec.p[0] - decoySpot[0]) * 111320, (dec.p[1] - decoySpot[1]) * 84000);
ok(dec && dd < 30, 'decoy ping shows at the chosen fake spot (' + (dd || 0).toFixed(0) + ' m from it)');
st = await state(host);
ok(!st.players[hiders[0].pid].inv.jammer && !st.players[hiders[1].pid].inv.decoy && st.players[hiders[2].pid].inv.sonar === 1, 'host tracks power-up use');
await G(seeker, () => window.__gl.act('item', { dataset: { item: 'radar' } }));
ok(await until(async () => (await G(seeker, () => window.__gl.local.pings.filter((x) => x.kind === 'radar').length)) === 3, 6000, 'radar'), 'radar sweep forces every hider to ping now');
await G(seeker, () => window.__gl.act('item', { dataset: { item: 'radar' } }));
await sleep(800);
ok(!(await state(host)).players[seekerPid].inv.radar && (await G(seeker, () => window.__gl.local.pings.filter((x) => x.kind === 'radar').length)) === 3, 'radar cannot be used twice');

// sonar: hider sees seekers for a bit
await setPos(seeker, off(0, 0));
await G(hiders[2], () => window.__gl.act('item', { dataset: { item: 'sonar' } }));
ok(await until(async () => (await G(hiders[2], (sp) => !!window.__gl.local.seekerLocs[sp], seekerPid)), 5000, 'sonar'), 'sonar reveals the seeker to hiders');

// ---- seeker alarm (default 50 m): a hider 20 m from the seeker hears it, one 180 m away does not
await setPos(hiders[1], off(0, 20));
ok(await until(async () => (await G(hiders[1], () => window.__gl.local.alarmM)) <= 50, 8000, 'alarm range'), 'hider within the alarm range knows a seeker is close');
ok(await until(async () => G(hiders[1], () => window.__gl.alarmOn), 8000, 'alarm sound'), 'the sprite cranberry alarm plays on the close hider');
ok(!(await G(hiders[0], () => window.__gl.alarmOn)) && (await G(hiders[0], () => window.__gl.local.alarmM)) > 50, 'a far hider hears nothing');
ok((await Promise.all(all.map((ph) => G(ph, () => Object.keys(window.__gl.local.nearLocs))))).flat().every((id) => id === seekerPid), 'only seekers send their spot for the alarm, never hiders');
await setPos(hiders[1], off(0, 300));
ok(await until(async () => !(await G(hiders[1], () => window.__gl.alarmOn)), 8000, 'alarm off'), 'the alarm stops once the seeker is out of range');
await setPos(hiders[1], spots[1]);

// ---- keep-awake: every phone holds the screen on; a hider who turns the screen off gives away their spot
ok(await until(async () => (await Promise.all(all.map((ph) => G(ph, () => window.__gl.awake)))).every(Boolean), 8000, 'awake'), 'every phone keeps its screen on during the game');
const setVis = (ph, v) => G(ph, (v) => { Object.defineProperty(document, 'visibilityState', { value: v, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }, v);
await setVis(hiders[0], 'hidden');
ok(await until(async () => (await G(seeker, (id) => window.__gl.local.pings.some((x) => x.id === id && x.kind === 'away' && x.blur === 0 && x.p), hiders[0].pid)), 5000, 'away'), 'a hider who turns off their screen sends their exact spot to the seekers');
ok(await G(seeker, () => /turned off their screen/.test(document.querySelector('#toasts').textContent)), 'the seeker is told');
await setVis(hiders[0], 'visible');
ok(await until(async () => G(hiders[0], () => /Keep Ghostline open/.test(document.querySelector('#toasts').textContent)), 3000, 'away warn'), 'the hider is warned when they come back');

// ---- zone breach
await setPos(hiders[2], off(700, 0));
ok(await until(async () => (await G(seeker, (id) => window.__gl.local.pings.some((x) => x.id === id && x.kind === 'breach'), hiders[2].pid)), 9000, 'breach'), 'leaving the zone exposes the hider\'s exact spot after the grace period');
await setPos(hiders[2], spots[2]);

// ---- mini games
// treasure: grabbing it pays +30 and pings the hider's exact spot
await G(host, ([p]) => window.__gl.spawnTreasure(p), [spots[2]]);
ok(await until(async () => ((await state(host)).players[hiders[2].pid].bonus || 0) === 30, 6000, 'treasure'), 'grabbing a treasure chest pays +30');
ok(await until(async () => (await G(seeker, (id) => window.__gl.local.pings.some((x) => x.id === id && x.kind === 'treasure' && !x.blur), hiders[2].pid)), 5000, 'tping'), 'and pings the hider\'s exact spot to the seekers');
// showdown: two hiders play a quick game, the winner gets +25
const duelB = async (h) => (await state(host)).players[h.pid].bonus || 0;
const b1 = await duelB(hiders[1]), b2 = await duelB(hiders[2]);
await G(host, ([a, b]) => window.__gl.startDuel(a, b, 'rps', 30000), [hiders[1].pid, hiders[2].pid]);
ok(await until(async () => (await G(hiders[1], () => !!document.querySelector('#modal:not([hidden]) [data-dg="rock"]'))) && (await G(hiders[2], () => !!document.querySelector('#modal:not([hidden]) [data-dg="scissors"]'))), 8000, 'duelOpen'), 'a showdown pops up for both hiders');
await G(hiders[1], () => document.querySelector('#modal [data-dg="rock"]').click());
await G(hiders[2], () => document.querySelector('#modal [data-dg="scissors"]').click());
ok(await until(async () => (await duelB(hiders[1])) === b1 + 25 && !(await state(host)).duel, 6000, 'duelWin'), 'rock beats scissors: the winner gets +25');
ok((await duelB(hiders[2])) === b2, 'and the loser loses nothing');
await G(host, ([a, b]) => window.__gl.startDuel(a, b, 'tap', 3000), [hiders[2].pid, hiders[1].pid]);
await until(async () => !!(await state(host)).duel, 4000, 'duel2');
await G(hiders[2], () => window.__gl.duelSubmit(12));
ok(await until(async () => (await duelB(hiders[2])) === b2 + 25 && !(await state(host)).duel, 9000, 'noShow'), 'a no-show loses the showdown after the timeout');
ok(await until(async () => (await G(hiders[1], () => document.querySelector('#modal').hidden)), 4000, 'duelClose'), 'the showdown closes when it ends');
// live wire: the holder sees other hiders, passes it by walking close, and whoever holds it at zero goes live
await G(host, (id) => window.__gl.setWire(id, 60000), hiders[1].pid);
ok(await until(async () => (await G(hiders[1], (id) => !!window.__gl.local.wireLocs[id], hiders[0].pid)), 9000, 'wireLocs'), 'the Live Wire holder can see the other hiders');
ok(await until(async () => (await hiders[1].page.isVisible('#wirebar')), 3000, 'wirebar'), 'the Live Wire fuse shows on screen');
await setPos(hiders[1], off(155, 100)); // 5 m from hider 0
ok(await until(async () => (await state(host)).wire?.holder === hiders[0].pid, 6000, 'pass'), 'walking near another hider passes the Live Wire');
await setPos(hiders[1], spots[1]);
const fuseLeft = (await state(host)).wire.until - Date.now();
ok(fuseLeft > 40000 && fuseLeft < 60000, 'passing it does not reset the fuse');
await G(host, (id) => window.__gl.setWire(id, 1500), hiders[0].pid);
ok(await until(async () => !!(await state(host)).players[hiders[0].pid].live, 6000, 'live'), 'whoever holds it when the fuse runs out goes live');
ok(await until(async () => (await G(seeker, (id) => window.__gl.local.pings.filter((x) => x.id === id && x.kind === 'live').length >= 2, hiders[0].pid)), 12000, 'liveping'), 'seekers keep seeing a live hider\'s exact spot');

// ---- GPS accuracy: a wild fix is skipped, jitter is averaged out, and the HUD shows accuracy
const h1 = spots[1];
await G(hiders[1], ([a, b]) => window.__gl.feedFix(a, b, 6), h1);
await G(hiders[1], ([a, b]) => window.__gl.feedFix(a + 0.0006, b, 80), h1); // a bad fix ~65 m away
let gp = await G(hiders[1], () => window.__gl.myPos);
ok(gp.acc === 6 && Math.abs(gp.p[0] - h1[0]) < 1e-6, 'a poor GPS fix is ignored while a good one is fresh');
await G(hiders[1], ([a, b]) => window.__gl.feedFix(a + 0.00005, b, 8), h1); // ~5.5 m north
gp = await G(hiders[1], () => window.__gl.myPos);
const dN = (gp.p[0] - h1[0]) * 111320;
ok(dN > 0.5 && dN < 5, `jittery fixes are averaged (moved ${dN.toFixed(1)} m, not 5.5 m)`);
ok((await hiders[1].page.textContent('#gps-chip')).includes('±6 m'), 'each player sees their GPS accuracy');
await setPos(hiders[1], h1);

// ---- tagging: range is strict, and a weak fix can't decide a close call
await setPos(seeker, off(180, 100)); // 30 m from hider 0, range 20 m
await G(seeker, () => window.__gl.act('tag'));
await sleep(1500);
ok(!(await state(host)).players[hiders[0].pid].caughtAt, 'a tag from 30 m does not count with a 20 m range');
ok(await until(async () => (await state(host)).players[seekerPid].bonus === -10, 6000, 'miss'), 'a tag that reaches nobody costs the seeker 10 points');
ok((await seeker.page.textContent('#toasts')).includes('Missed tag'), 'the seeker is told about the missed tag');
await G(hiders[0], ([a, b]) => window.__gl.setPos(a, b, 45), spots[0]); // hider's GPS goes weak
await setPos(seeker, off(162, 100)); // 12 m away
await G(seeker, () => window.__gl.act('tag'));
ok(await until(async () => (await seeker.page.textContent('#toasts')).includes('Too close to call'), 5000, 'weak'), 'a close tag on weak GPS asks the seeker to get closer');
ok(!(await state(host)).players[hiders[0].pid].caughtAt, 'and does not count');
await sleep(4000);
ok((await state(host)).players[seekerPid].bonus === -10, 'a too-close-to-call tag on weak GPS costs nothing');
await G(hiders[0], ([a, b]) => window.__gl.setPos(a, b, 8), spots[0]);
await sleep(3200); // tag cooldown

// ---- tagging
await setPos(seeker, off(152, 104)); // ~5 m from hider 0
await sleep(300);
if (SHOTS) await seeker.page.screenshot({ path: SHOTS + '/3-seeker-hunt.png' });
if (SHOTS) await hiders[1].page.screenshot({ path: SHOTS + '/4-hider-hunt.png' });
await G(seeker, () => window.__gl.act('tag'));
ok(await until(async () => !!(await state(host)).players[hiders[0].pid].caughtAt, 5000, 'tag'), `${seeker.name} tags ${hiders[0].name} from 5 m`);
st = await state(host);
ok(st.players[hiders[0].pid].caughtBy === seekerPid && st.players[hiders[0].pid].role === 'seeker', 'caught hider is credited and joins the seekers (infection)');
ok(['xray', 'tracker'].some((k) => st.players[seekerPid].inv[k] === 1), 'catching a hider who still had power-ups gives the seeker a super power-up');
// a far hider is not caught by that tag
ok(!st.players[hiders[1].pid].caughtAt, 'hiders out of range are safe');
// self-report
await G(hiders[1], (sp) => window.__gl.send('caught', { who: window.__gl.me.id, by: sp, how: 'self', p: null }), seekerPid);
ok(await until(async () => !!(await state(host)).players[hiders[1].pid].caughtAt, 5000, 'self'), '"I got caught" button works');

// chat (team only)
await G(seeker, () => window.__gl.send('chat', { text: 'north side', team: 'seeker' }));
await sleep(600);
ok((await hiders[2].page.evaluate(() => document.body.innerText)).includes('north side') === false, 'seeker team chat is hidden from hiders');

// ---- end of round by timer
ok(await until(async () => (await state(host)).phase === 'ended', 100000, 'end'), 'round ends when the clock runs out');
st = await state(host);
const r = st.results;
ok(r[hiders[2].pid].survived && r[hiders[2].pid].pts >= 50, `${hiders[2].name} survived and scored ${r[hiders[2].pid].pts}`);
ok(r[seekerPid].catches === 2 && r[seekerPid].pts === 90, `${seeker.name} scored ${r[seekerPid].pts} for 2 catches and 1 miss`);
ok(await until(async () => (await G(host, () => Object.keys(window.__gl.local.tracks).length)) >= 3, 6000, 'tracks'), 'everyone\'s path arrives for the replay');
await G(host, () => window.__gl.act('replay'));
await sleep(1500);
if (SHOTS) await host.page.screenshot({ path: SHOTS + '/5-recap.png' });


// ================= round 2: mixed modes =================
await host.page.click('[data-act="replayClose"]');
await host.page.click('[data-act="again"]');
ok(await until(async () => (await state(others[0])).phase === 'lobby', 5000, 'again'), 'host starts a new lobby with scores kept');
await G(host, () => window.__gl.setSettings({ hideSec: 2, huntSec: 300, pingSec: 20, blurM: 25, tagMode: 'honor', jail: true, starter: true, drops: true, dropSec: 600,
  missions: true, capture: true, potato: true, sprint: true, shrink: true, shrinkStyle: 'smooth', shrinkTo: 0.4, strictZone: true, fugitive: false }));
st = await state(host);
ok(st.settings.jail && !st.settings.infection, 'jailbreak and infection switch each other off');
if (SHOTS) { await host.page.evaluate(() => { const el = document.querySelector('.modes'); if (el) el.scrollIntoView(); }); await host.page.screenshot({ path: SHOTS + '/6-modes.png' }); }
for (const ph of all) await setPos(ph, C);
await host.page.click('[data-act="start"]');
ok(await until(async () => (await state(host)).phase === 'hiding', 5000, 'hiding2'), 'round 2 starts');
st = await state(host);
const sk2 = all.find((p) => st.players[p.pid].role === 'seeker');
const [A, B, Cc] = all.filter((p) => p !== sk2);
// spread everyone 180 m out: further than any mode feature can land (they stay inside the final zone)
const ring = (deg) => off(180 * Math.cos((deg * Math.PI) / 180), 180 * Math.sin((deg * Math.PI) / 180));
const home = new Map([[sk2, ring(0)], [A, ring(90)], [B, ring(180)], [Cc, ring(270)]]);
for (const [ph, pt] of home) await setPos(ph, pt);
ok(await until(async () => (await state(host)).phase === 'hunting', 6000, 'hunting2'), 'round 2 hunt starts');
st = await state(host);
ok(!!st.jail && st.flags.length === 2 && !!st.potato && !!st.sprint && [A, B, Cc].every((h) => st.players[h.pid].mission), 'jail, 2 flags, hot potato, extraction timer and a secret mission per hider all set up');
ok([A, B, Cc].every((h) => st.players[h.pid].inv.decoy === 1) && st.players[sk2.pid].inv.radar === 1, 'starter power-ups handed out');

// mission
await setPos(A, st.players[A.pid].mission.p);
ok(await until(async () => ((await state(host)).players[A.pid].missionsDone || 0) === 1, 6000, 'mission'), `${A.name} reaches their secret mission spot`);
st = await state(host);
ok(st.players[A.pid].bonus === 25 && Object.values(st.players[A.pid].inv).reduce((a, b) => a + b, 0) === 4, 'mission pays +25 and a power-up, and a new target appears');
await setPos(A, home.get(A));

// supply drop: everyone sees it, first one there wins
await G(host, () => window.__gl.spawnDrop());
ok(await until(async () => (await Promise.all(all.map(state))).every((x) => x.drops.some((d) => !d.claimedBy)), 5000, 'drop'), 'supply drop shows up on every phone, seekers included');
if (SHOTS) { await sleep(400); await sk2.page.screenshot({ path: SHOTS + '/7-seeker-drop.png' }); }
const drop = (await state(host)).drops.find((d) => !d.claimedBy);
await setPos(B, drop.p); await setPos(Cc, drop.p);
ok(await until(async () => !!(await state(host)).drops.find((d) => d.id === drop.id).claimedBy, 6000, 'claim'), 'a hider claims the drop');
st = await state(host);
const winner = st.drops.find((d) => d.id === drop.id).claimedBy;
const loser = winner === B.pid ? Cc.pid : B.pid;
ok(['ghost', 'shield', 'swarm', 'blackout'].some((k) => st.players[winner].inv[k]) && !['ghost', 'shield', 'swarm', 'blackout'].some((k) => st.players[loser].inv[k]), 'only one player gets the super power-up');
await setPos(B, home.get(B)); await setPos(Cc, home.get(Cc));

// hot potato
await setPos(Cc, st.potato.p);
ok(await until(async () => (await state(host)).potato.holder === Cc.pid, 6000, 'potato'), `${Cc.name} grabs the hot potato`);
ok(await until(async () => (await G(sk2, (id) => window.__gl.local.pings.some((x) => x.id === id && x.kind === 'potato'), Cc.pid)), 5000, 'potato ping'), 'grabbing the hot potato pings you to the seekers');
await setPos(Cc, home.get(Cc));

// capture point
st = await state(host);
await setPos(A, st.flags[0].p);
ok(await until(async () => (await G(sk2, (id) => window.__gl.local.pings.some((x) => x.id === id && x.kind === 'capture' && x.blur === 0), A.pid)), 6000, 'capture ping'), 'capturing a flag pings your exact spot');
await G(A, (f) => window.__gl.send('flag', { id: f.id, held: 60000, p: f.p, acc: 5 }), st.flags[0]);
ok(await until(async () => (await state(host)).flags[0].by === A.pid, 5000, 'flag'), 'holding a flag for a minute captures it (+50)');
await setPos(A, home.get(A));

// shield blocks an honor tag
await G(host, (id) => window.__gl.give(id, 'shield'), B.pid);
await until(async () => (await state(B)).players[B.pid].inv.shield >= 1, 4000, 'give');
await G(B, () => window.__gl.act('item', { dataset: { item: 'shield' } }));
ok(await until(async () => (await state(host)).players[B.pid].fx.shield === 1, 4000, 'shield'), 'shield goes up');
async function honorTag(target) {
  await G(sk2, () => window.__gl.act('tag'));
  await sk2.page.waitForSelector(`#modal:not([hidden]) [data-act2="pick"][data-id="${target.pid}"]`, { timeout: 5000 });
  await sk2.page.click(`[data-act2="pick"][data-id="${target.pid}"]`);
  await target.page.waitForSelector('#modal:not([hidden]) [data-act2="confirmYes"]', { timeout: 6000 });
}
await honorTag(B);
if (SHOTS) await B.page.screenshot({ path: SHOTS + '/8-honor-confirm.png' });
await B.page.click('[data-act2="confirmYes"]');
ok(await until(async () => (await state(host)).events.some((e) => e.k === 'shieldHit' && e.who === B.pid), 5000, 'shieldHit'), 'honor tag confirmed by the hider');
st = await state(host);
ok(!st.players[B.pid].caughtAt && !st.players[B.pid].fx.shield, 'the shield ate the tag and is used up');

// honor tag that the hider denies goes to the host
await sleep(3200);
await honorTag(B);
await B.page.click('[data-act2="confirmNo"]');
ok(await until(async () => host.page.isVisible('#modal:not([hidden]) [data-act2="ruleNo"]'), 6000, 'ruling'), 'a denied tag goes to the host to decide');
if (SHOTS) await host.page.screenshot({ path: SHOTS + '/9-host-ruling.png' });
await host.page.click('[data-act2="ruleNo"]');
await sleep(600);
ok(!(await state(host)).players[B.pid].caughtAt, 'host rules no catch');

// a real catch: hider with power-ups left pays the seeker a super one, goes to jail, drops the potato
await sleep(3200);
const skBefore = (await state(host)).players[sk2.pid].inv;
await honorTag(Cc);
await Cc.page.click('[data-act2="confirmYes"]');
ok(await until(async () => !!(await state(host)).players[Cc.pid].caughtAt, 5000, 'catch C'), `${Cc.name} confirms the tag and is caught`);
st = await state(host);
ok(st.players[Cc.pid].role === 'hider' && st.potato.holder === null, 'with jailbreak on, caught hiders go to jail (not to the seekers) and drop the hot potato');
const gotSuper = ['xray', 'tracker'].find((k) => (st.players[sk2.pid].inv[k] || 0) > (skBefore[k] || 0));
ok(!!gotSuper, `seeker earns a super power-up (${gotSuper}) for catching someone who still had some`);
ok(await until(async () => (await Cc.page.innerText('#sheet')).includes("You're in jail"), 4000, 'jail ui'), 'the caught player is told to go to jail');

// seeker super power-up
await G(sk2, (k) => window.__gl.act('item', { dataset: { item: k } }), gotSuper);
ok(await until(async () => (await G(sk2, ([k, a, b]) => [a, b].every((id) => window.__gl.local.pings.some((x) => x.id === id && x.kind === k)), [gotSuper, A.pid, B.pid])), 6000, 'super'), `${gotSuper} makes every free hider ping`);
if (gotSuper === 'xray') ok((await G(sk2, () => window.__gl.local.pings.filter((x) => x.kind === 'xray').every((x) => x.blur === 0))), 'x-ray pings are exact');

// jailbreak
await setPos(A, (await state(host)).jail.p);
ok(await until(async () => !(await state(host)).players[Cc.pid].caughtAt, 6000, 'breakout'), `${A.name} breaks ${Cc.name} out of jail`);
await setPos(A, home.get(A));

// blackout and ghost
await G(host, (id) => window.__gl.give(id, 'blackout'), A.pid);
await until(async () => (await state(A)).players[A.pid].inv.blackout >= 1, 4000, 'give2');
await G(A, () => window.__gl.act('item', { dataset: { item: 'blackout' } }));
ok(await until(async () => sk2.page.evaluate(() => document.body.classList.contains('blackout')), 5000, 'blackout'), "blackout darkens the seeker's map");
if (SHOTS) await sk2.page.screenshot({ path: SHOTS + '/10-blackout.png' });
await G(host, (id) => window.__gl.give(id, 'ghost'), B.pid);
await G(host, (id) => window.__gl.give(id, 'radar'), sk2.pid);
await until(async () => (await state(B)).players[B.pid].inv.ghost >= 1 && (await state(sk2)).players[sk2.pid].inv.radar >= 1, 4000, 'give3');
await G(B, () => window.__gl.act('item', { dataset: { item: 'ghost' } }));
await until(async () => (await state(B)).players[B.pid].fx.ghostUntil > 0, 4000, 'ghost on');
await G(sk2, () => window.__gl.act('item', { dataset: { item: 'radar' } }));
ok(await until(async () => (await G(sk2, (id) => window.__gl.local.pings.some((x) => x.id === id && x.kind === 'ghost' && !x.p), B.pid)), 5000, 'ghost'), 'a ghosted hider sends no location, even to radar');

// swarm: next scheduled ping shows 4 spots
await G(host, (id) => window.__gl.give(id, 'swarm'), A.pid);
await until(async () => (await state(A)).players[A.pid].inv.swarm >= 1, 4000, 'give4');
await G(A, () => window.__gl.act('item', { dataset: { item: 'swarm' } }));
ok(await until(async () => (await G(sk2, (id) => window.__gl.local.pings.some((x) => x.id === id && x.kind === 'scheduled' && x.alts && x.alts.length === 3), A.pid)), 25000, 'swarm'), 'swarm ping shows 4 spots, only one real');

// final sprint
await G(host, () => window.__gl.openExtraction());
ok(await until(async () => !!(await state(B)).sprint.p, 5000, 'extract open'), 'extraction point opens for everyone');
await setPos(B, (await state(host)).sprint.p);
ok(await until(async () => !!(await state(host)).players[B.pid].extracted, 6000, 'extracted'), `${B.name} reaches extraction and is safe`);

// strict zone: big alert, 15 s, then out
await setPos(A, off(0, 700));
ok(await until(async () => A.page.isVisible('#outzone'), 4000, 'outzone'), 'stepping out of the zone throws a full-screen alert');
await sleep(1500);
const cd = await A.page.innerText('#oz-n');
if (SHOTS) await A.page.screenshot({ path: SHOTS + '/11-out-of-zone.png' });
ok(+cd >= 10 && +cd <= 15, 'the alert counts down from 15 (' + cd + ' s left after 1.5 s)');
ok(await until(async () => (await state(host)).events.some((e) => e.k === 'catch' && e.who === A.pid && e.how === 'zone'), 20000, 'dq'), 'out of the zone for 15 s gets you knocked out');

// end the round from the host
host.page.once('dialog', (d) => d.accept());
await host.page.click('[data-act="endNow"]');
ok(await until(async () => (await state(host)).phase === 'ended', 5000, 'end2'), 'host can end the round');
st = await state(host);
ok(st.results[B.pid].extracted && st.results[B.pid].pts >= 100, `${B.name} escaped and scored ${st.results[B.pid].pts}`);
ok(st.results[A.pid].pts >= 75, `${A.name}'s mission and flag bonuses count (${st.results[A.pid].pts})`);
if (SHOTS) { await sleep(500); await host.page.screenshot({ path: SHOTS + '/12-results.png' }); }

// ================= round 3: photo tag + fugitive =================
await host.page.click('[data-act="again"]');
ok(await until(async () => (await state(others[0])).phase === 'lobby', 5000, 'again3'), 'back to the lobby');
await G(host, () => window.__gl.setSettings({ hideSec: 2, huntSec: 120, tagMode: 'photo', fugitive: true, infection: true, jail: false, starter: false, drops: false,
  missions: false, capture: false, potato: false, sprint: false, strictZone: false }));
// ---- points shop, in the lobby
st = await state(host);
ok(all.every((ph) => (st.wallet || {})[ph.pid] === st.totals[ph.pid]), 'everyone can spend exactly what they earned (mid-round points not counted twice)');
const Wl = async (id) => (((await state(host)).wallet || {})[id] || 0);
const Bp = all.find((ph) => ph.pid === B.pid);
await G(host, (id) => window.__gl.setWallet(id, 500), B.pid);
await until(async () => (await Wl(B.pid)) === 500, 4000, 'fund');
await Bp.page.click('[data-act="toggleShop"]');
await Bp.page.click('[data-act="buy"][data-k="cloak"]');
await until(async () => (await Wl(B.pid)) === 440, 4000, 'buy1');
await Bp.page.click('[data-act="buy"][data-k="radar"]');
ok(await until(async () => { const x = (await state(host)).players[B.pid].bank || {}; return x.cloak === 1 && x.radar === 1; }, 4000, 'bank'), 'picks bought in the lobby are saved for later');
ok((await Wl(B.pid)) === 400, 'cloak (60) and radar (40) come off the balance');
if (SHOTS) await Bp.page.screenshot({ path: SHOTS + '/14-shop.png' });
await Bp.page.click('[data-act="buy"][data-k="icon"][data-opt="star"]');
ok(await until(async () => (await state(host)).players[B.pid].icon === 'star', 4000, 'icon'), 'a badge can be bought');
await G(host, (id) => window.__gl.setWallet(id, 30), A.pid);
await until(async () => (await Wl(A.pid)) === 30, 4000, 'fund2');
await G(A, () => window.__gl.send('buy', { k: 'spotlight' }));
await sleep(800);
ok((await Wl(A.pid)) === 30 && !((await state(host)).players[A.pid].bank || {}).spotlight, "you can't buy what you can't afford");
for (const ph of all) await setPos(ph, C);
await host.page.click('[data-act="start"]');
ok(await until(async () => (await state(host)).phase === 'hunting', 8000, 'hunting3'), 'fugitive round starts');
st = await state(host);
const runners = all.filter((p) => st.players[p.pid].role === 'hider');
ok(runners.length === 1, `fugitive: one runner (${runners[0]?.name}), everyone else hunts`);
const runner = runners[0], hunter = all.find((p) => st.players[p.pid].role === 'seeker');
// ---- points shop, mid-round
st = await state(host);
{
  const r0 = st.players[runners[0].pid], b0 = st.players[B.pid];
  ok(b0.role === 'hider' ? (b0.inv.cloak === 1 && b0.bank.radar === 1) : (b0.inv.radar === 1 && b0.bank.cloak === 1), 'saved picks arrive in a round where you have that role, the rest wait');
}
{
  const rn = runners[0], hn = all.find((p) => st.players[p.pid].role === 'seeker');
  await G(host, (ids) => ids.forEach((id) => window.__gl.setWallet(id, 1000)), [rn.pid, hn.pid]);
  await until(async () => (await Wl(rn.pid)) === 1000 && (await Wl(hn.pid)) === 1000, 4000, 'fund3');
  await G(hn, () => window.__gl.send('buy', { k: 'cloak' }));
  await sleep(800);
  ok((await Wl(hn.pid)) === 1000, "seekers can't buy hider picks mid-round");
  await G(rn, () => window.__gl.send('buy', { k: 'peek' }));
  await until(async () => (await state(rn)).players[rn.pid].inv.peek === 1, 4000, 'peek bought');
  await G(rn, () => window.__gl.act('item', { dataset: { item: 'peek' } }));
  ok(await until(async () => (await G(rn, (sp) => window.__gl.local.peekUntil > 0 && !!window.__gl.local.seekerLocs[sp], hn.pid)), 5000, 'peek'), 'peek shows the hider a seeker');
  await G(hn, () => window.__gl.send('buy', { k: 'trail' }));
  await until(async () => (await state(hn)).players[hn.pid].inv.trail === 1, 4000, 'trail bought');
  await G(hn, () => window.__gl.act('item', { dataset: { item: 'trail' } }));
  ok(await until(async () => (await G(hn, (id) => !!window.__gl.local.trailLocs[id], rn.pid)) && (await hn.page.isVisible('#trail')), 8000, 'trail'), 'hot trail shows the seeker an arrow to the nearest hider');
  if (SHOTS) await hn.page.screenshot({ path: SHOTS + '/15-hot-trail.png' });
  await G(hn, () => window.__gl.send('buy', { k: 'lockdown' }));
  await until(async () => (await state(hn)).players[hn.pid].inv.lockdown === 1, 4000, 'lock bought');
  await G(hn, () => window.__gl.act('item', { dataset: { item: 'lockdown' } }));
  ok(await until(async () => (await state(host)).lockdownUntil > Date.now(), 4000, 'lockdown'), 'lockdown starts');
  await G(rn, () => window.__gl.send('buy', { k: 'cloak' }));
  await until(async () => ((await state(rn)).players[rn.pid].inv.cloak || 0) >= 1, 4000, 'cloak bought');
  const nCloak = (await state(host)).players[rn.pid].inv.cloak;
  await G(rn, () => window.__gl.send('useItem', { item: 'cloak' }));
  await sleep(800);
  ok((await state(host)).players[rn.pid].inv.cloak === nCloak, "during lockdown hiders can't use power-ups");
  await G(hn, () => window.__gl.send('buy', { k: 'spotlight' }));
  await until(async () => (await state(hn)).players[hn.pid].inv.spotlight === 1, 4000, 'spot bought');
  await G(hn, (id) => window.__gl.send('useItem', { item: 'spotlight', target: id }), rn.pid);
  ok(await until(async () => (await G(hn, (id) => window.__gl.local.pings.some((x) => x.id === id && x.kind === 'xray' && x.blur === 0), rn.pid)), 6000, 'spotlight'), "spotlight shows the hider's exact spot");
  await G(rn, () => window.__gl.send('buy', { k: 'pass' }));
  await until(async () => (await state(rn)).players[rn.pid].inv.pass === 1, 4000, 'pass bought');
  await G(rn, (sp) => window.__gl.send('caught', { who: window.__gl.me.id, by: sp, how: 'self', p: null }), hn.pid);
  ok(await until(async () => { const s = await state(host); return s.events.some((e) => e.k === 'passHit' && e.who === rn.pid) && !s.players[rn.pid].caughtAt && !s.players[rn.pid].inv.pass; }, 5000, 'pass'), 'an escape pass gets you out of one catch');
  ok((await Wl(hn.pid)) === 1000 - 60 - 70 - 80 && (await Wl(rn.pid)) === 1000 - 50 - 60 - 120, 'every buy is charged once by the host');
}

ok(await hunter.page.isVisible('[data-act="snap"]'), 'seekers get a SNAP TAG button in photo mode');
const png = makePng(64, 48);
await hunter.page.setInputFiles('#snap-in', { name: 'tag.png', mimeType: 'image/png', buffer: png });
await hunter.page.waitForSelector(`#modal:not([hidden]) [data-act2="pick"][data-id="${runner.pid}"]`, { timeout: 15000 });
await hunter.page.click(`[data-act2="pick"][data-id="${runner.pid}"]`);
await runner.page.waitForSelector('#modal:not([hidden]) img[alt="Tag photo"]', { timeout: 15000 });
ok(true, 'the photo reaches the runner to confirm');
if (SHOTS) await runner.page.screenshot({ path: SHOTS + '/13-photo-confirm.png' });
await runner.page.click('[data-act2="confirmYes"]');
ok(await until(async () => (await state(host)).phase === 'ended' && (await state(host)).endWhy === 'allCaught', 6000, 'photo catch'), 'confirming the photo catches the runner and ends the round');
ok((await state(host)).events.some((e) => e.k === 'catch' && e.how === 'photo' && e.by === hunter.pid), 'the photo catch is credited to the seeker who took it');

// ---- next round and host hand-off
await host.page.click('[data-act="again"]');
ok(await until(async () => (await state(others[0])).phase === 'lobby', 5000, 'again'), 'host starts a new lobby with scores kept');
await host.page.goto('about:blank'); // the host's phone drops out (closing a context kills single-process test browsers)
ok(await until(async () => { const s = await state(others[0]); return s.hostId !== 'host'; }, 20000, 'handoff'), 'if the host drops, another player takes over');
const nh = (await state(others[0])).hostId;
ok(await until(async () => (await Promise.all(others.map(state))).every((s) => s.hostId === nh), 6000, 'agree'), 'all phones agree on the new host');

console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'No page errors');
if (errors.length) fails++;
await browser.close();
srv.kill();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
