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
await G(host, () => window.__gl.setSettings({ hideSec: 3, huntSec: 45, pingSec: 9, blurM: 25, tagRadiusM: 15, graceSec: 4, shrinkTo: 0.5, shrinkStyle: 'steps', strictZone: false, drops: false, starter: true, infection: true }));
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

// ---- zone breach
await setPos(hiders[2], off(700, 0));
ok(await until(async () => (await G(seeker, (id) => window.__gl.local.pings.some((x) => x.id === id && x.kind === 'breach'), hiders[2].pid)), 9000, 'breach'), 'leaving the zone exposes the hider\'s exact spot after the grace period');
await setPos(hiders[2], spots[2]);

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
ok(await until(async () => (await state(host)).phase === 'ended', 40000, 'end'), 'round ends when the clock runs out');
st = await state(host);
const r = st.results;
ok(r[hiders[2].pid].survived && r[hiders[2].pid].pts >= 50, `${hiders[2].name} survived and scored ${r[hiders[2].pid].pts}`);
ok(r[seekerPid].catches === 2 && r[seekerPid].pts === 100, `${seeker.name} scored ${r[seekerPid].pts} for 2 catches`);
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
for (const ph of all) await setPos(ph, C);
await host.page.click('[data-act="start"]');
ok(await until(async () => (await state(host)).phase === 'hunting', 8000, 'hunting3'), 'fugitive round starts');
st = await state(host);
const runners = all.filter((p) => st.players[p.pid].role === 'hider');
ok(runners.length === 1, `fugitive: one runner (${runners[0]?.name}), everyone else hunts`);
const runner = runners[0], hunter = all.find((p) => st.players[p.pid].role === 'seeker');
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
