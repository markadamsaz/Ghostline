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
  await ctx.addInitScript(() => { if (window.DeviceOrientationEvent) DeviceOrientationEvent.requestPermission = () => Promise.resolve('granted'); }); // phones allow the compass
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

// ---- map pins: drop an exact spot and send it to chosen players
{
  const [ana, ben, cy] = others;
  const pinsOf = (ph) => G(ph, () => window.__gl.pins);
  const spot = off(60, 40);
  await host.page.click('#btn-map'); // the lobby map
  await host.page.click('#btn-pin');
  ok(await G(host, () => document.body.classList.contains('placing-pin')), 'pin button starts placing a pin');
  await G(host, ([a, b]) => window.__gl.tapMap(a, b), spot);
  ok(await until(async () => G(host, () => !!document.querySelector('#pin-send')), 3000, 'pin modal'), 'tapping the map opens the send-a-pin sheet');
  ok((await G(host, () => document.querySelectorAll('.pin-to input').length)) === 3, 'every other player is listed as a recipient');
  await host.page.click('#pin-send');
  ok(await G(host, () => !document.querySelector('#pin-err').hidden), 'sending with nobody picked asks for a player');
  await host.page.fill('#pin-note', 'meet here');
  await host.page.click('.pin-to-row:has(input[value="p2"])');
  await host.page.click('#pin-send');
  ok(await until(async () => (await pinsOf(ana)).length === 1, 5000, 'ana pin'), 'the picked player gets the pin');
  const ap = (await pinsOf(ana))[0];
  ok(ap && ap.note === 'meet here' && Math.abs(ap.p[0] - spot[0]) < 1e-6 && Math.abs(ap.p[1] - spot[1]) < 1e-6, 'pin keeps the exact spot and the note');
  await sleep(600);
  ok((await pinsOf(ben)).length === 0 && (await pinsOf(cy)).length === 0, 'players who were not picked never see it');
  ok(await G(ana, () => window.__gl.feed().includes('meet here')), 'the pin shows up in chat for the receiver');
  ok(await G(ana, () => document.querySelectorAll('.upin').length === 1), 'the pin is drawn on the receiver\'s map');
  ok((await pinsOf(host)).length === 1, 'the sender sees their own pin');
  // the receiver opens it from chat
  await G(ana, () => window.__gl.act('modeChat', { dataset: { conv: 'dm:host' } }));
  await until(async () => G(ana, () => !!document.querySelector('.im-pin')), 3000, 'pin bubble');
  await ana.page.click('.im-pin');
  ok(await G(ana, () => !document.body.classList.contains('chat-full') && !!document.querySelector('.upin')), '"Show on map" leaves chat and shows the pin');
  // a pin to everyone, with the quick button
  await ana.page.click('#btn-pin');
  await G(ana, ([a, b]) => window.__gl.tapMap(a, b), off(-30, 10));
  await until(async () => G(ana, () => !!document.querySelector('#pin-send')), 3000, 'pin modal 2');
  await ana.page.click('.pin-quick [data-pq="all"]');
  await ana.page.click('#pin-send');
  ok(await until(async () => (await Promise.all([host, ben, cy].map(pinsOf))).every((l) => l.some((x) => x.from === 'p2' && x.all)), 5000, 'pin all'), 'Everyone sends the pin to every player');
  // the sender removes their pin for everyone
  const hid = (await pinsOf(host)).find((x) => x.from === 'host').id;
  await G(host, (id) => document.querySelector(`.upin[data-pin="${id}"]`).click(), hid);
  await until(async () => G(host, () => !!document.querySelector('#pin-del')), 3000, 'pin info');
  await host.page.click('#pin-del');
  ok(await until(async () => !(await pinsOf(ana)).some((x) => x.id === hid), 5000, 'pin removed'), 'removing a pin takes it off the receiver\'s map');
  // a receiver can hide a pin just for themselves
  const aid = (await pinsOf(ben)).find((x) => x.from === 'p2').id;
  await G(ben, () => window.__gl.act('openMap'));
  await G(ben, (id) => document.querySelector(`.upin[data-pin="${id}"]`).click(), aid);
  await until(async () => G(ben, () => !!document.querySelector('#pin-hide')), 3000, 'pin hide');
  await ben.page.click('#pin-hide');
  await sleep(300);
  ok(!(await pinsOf(ben)).some((x) => x.id === aid) && (await pinsOf(cy)).some((x) => x.id === aid), 'hiding a pin only hides it on your own map');
  await G(ana, () => { const a = window.__gl.act; a('modeChat', { dataset: {} }); a('chatBack'); a('modeMap'); }); // back to the inbox for the chat tests
  for (const ph of [host, ana, ben]) await G(ph, () => window.__gl.act('mapDone'));
}

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
ok(await until(async () => G(hiders[1], () => window.__gl.alarmOn), 8000, 'alarm sound'), 'the seeker alarm plays on the close hider');
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
ok(await G(seeker, () => /turned off their screen/.test(window.__gl.feed())), 'the seeker is told');
await setVis(hiders[0], 'visible');
ok(await until(async () => G(hiders[0], () => /Keep Ghostline open/.test(window.__gl.feed())), 3000, 'away warn'), 'the hider is warned when they come back');

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
ok((await G(seeker, () => window.__gl.feed())).includes('Missed tag'), 'the seeker is told about the missed tag');
await G(hiders[0], ([a, b]) => window.__gl.setPos(a, b, 45), spots[0]); // hider's GPS goes weak
await setPos(seeker, off(162, 100)); // 12 m away
await G(seeker, () => window.__gl.act('tag'));
ok(await until(async () => (await G(seeker, () => window.__gl.feed())).includes('Too close to call'), 5000, 'weak'), 'a close tag on weak GPS asks the seeker to get closer');
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
// map marks: solid labels, and tapping one says what it is
{
  ok(await until(() => G(seeker, () => !!document.querySelector('.blip[data-mk^="ping:"] .lbl b')), 6000, 'ping label'), 'hider pings carry a name label the seeker can tap');
  const tap = await G(seeker, () => { const el = document.querySelector('.blip[data-mk^="ping:"]'); const r = el.getBoundingClientRect(); const o = { bubbles: true, clientX: r.x + 8, clientY: r.y + 8, pointerId: 1 };
    el.dispatchEvent(new PointerEvent('pointerdown', o)); el.dispatchEvent(new PointerEvent('pointerup', o));
    return { modal: document.querySelector('#modal h3')?.textContent || '', bg: getComputedStyle(el.querySelector('.lbl')).backgroundColor }; });
  ok(/ping/i.test(tap.modal), 'tapping a ping opens what it is: ' + tap.modal.trim());
  ok(/rgba?\(20, 20, 22|rgb\(255, 59, 48/.test(tap.bg), 'labels are a solid dark (or red) pill, not white');
  if (SHOTS) await seeker.page.screenshot({ path: SHOTS + '/4d-mark-info.png' });
  await G(seeker, () => document.querySelector('#modal [data-act="closeModal"]').click());
  ok(await G(seeker, () => document.querySelector('#modal').hidden), 'Close shuts the mark info');
}
ok(await hiders[1].page.evaluate(() => document.querySelector('#sheet').offsetHeight <= innerHeight * 0.5), 'during the hunt the map gets most of the screen');
await hiders[1].page.click('[data-act="togglePU"]');
ok(await until(() => hiders[1].page.evaluate(() => !!document.querySelector('#sheet .pu-panel .items [data-act="item"]')), 4000, 'pu'), 'the Power-ups button opens your power-ups');
if (SHOTS) await hiders[1].page.screenshot({ path: SHOTS + '/4b-hider-powerups.png' });
await hiders[1].page.click('[data-act="togglePU"]');
ok(await until(() => hiders[1].page.evaluate(() => !document.querySelector('#sheet .pu-panel')), 4000, 'pu2'), 'and tapping it again closes them');
ok(await hiders[1].page.evaluate(() => document.querySelectorAll('#toasts .toast').length === 0), 'no pop-ups during the round');
await hiders[1].page.click('[data-act="toggleShop"]');
ok(await until(() => hiders[1].page.evaluate(() => !!document.querySelector('#sheet .pu-panel [data-act="buy"]')), 4000, 'shop'), 'the Shop button on the map opens the points shop');
await hiders[1].page.click('[data-act="toggleShop"]');
await hiders[1].page.click('[data-act="modeChat"]');
ok(await until(() => hiders[1].page.evaluate(() => ['Everyone', 'Hiders', 'Game updates'].every((t) => [...document.querySelectorAll('.im-conv b')].some((b) => b.textContent === t))), 4000, 'inbox'), 'Chat opens an inbox with Everyone, your team and Game updates');
ok(await hiders[1].page.evaluate(() => !document.querySelector('.im-conv[data-conv="seeker"]')), 'hiders don\'t see the seekers\' group');
await hiders[1].page.click('.im-conv[data-conv="game"]');
ok(await until(() => hiders[1].page.evaluate(() => document.querySelectorAll('#chat-log .im-sys').length >= 2 && !document.querySelector('#im-bar')), 4000, 'feed'), 'Game updates shows the round as one-line updates, read only');
await hiders[1].page.click('[data-act="chatBack"]');
await hiders[1].page.click('.im-conv[data-conv="hider"]');
await hiders[1].page.fill('#chat-in', 'by the slide');
await hiders[1].page.click('.im-send');
ok(await until(() => hiders[2].page.evaluate(() => window.__gl.feed().includes('by the slide')), 4000, 'msg'), 'hiders can message their team');
ok(await G(hiders[1], () => !!document.querySelector('.im-row.me .im-b') && !!document.querySelector('.im-dlv')), 'your message shows as a blue bubble marked Delivered');
await G(hiders[1], (to) => window.__gl.send('chat', { text: 'meet at the gate', to }), hiders[2].pid);
await sleep(600);
ok(await G(hiders[2], () => window.__gl.feed().includes('meet at the gate')) && !(await G(hiders[0], () => window.__gl.feed().includes('meet at the gate'))), 'a private message reaches only that player');
if (SHOTS) await hiders[1].page.screenshot({ path: SHOTS + '/4c-hider-chat.png' });
await hiders[1].page.click('[data-act="modeMap"]');
ok(await until(() => hiders[1].page.evaluate(() => !!document.querySelector('#sheet .play-compact')), 4000, 'mapmode'), 'and Map mode brings the map back');
await G(seeker, () => window.__gl.act('tag'));
ok(await until(async () => !!(await state(host)).players[hiders[0].pid].caughtAt, 5000, 'tag'), `${seeker.name} tags ${hiders[0].name} from 5 m`);
st = await state(host);
ok(st.players[hiders[0].pid].caughtBy === seekerPid && st.players[hiders[0].pid].role === 'seeker', 'caught hider is credited and joins the seekers (infection)');
ok(await until(async () => (await Promise.all(all.map((ph) => G(ph, () => { const el = document.querySelector('#bigalert'); return !!el && !el.hidden; })))).every(Boolean), 4000, 'catch alert'), 'a catch turns every phone\'s screen blue');
ok((await G(hiders[1], () => document.querySelector('#bigalert').innerText)).includes(hiders[0].name), 'the catch alert names who was caught');
if (SHOTS) await hiders[1].page.screenshot({ path: SHOTS + '/5-catch-alert.png' });
await Promise.all(all.map((ph) => G(ph, () => document.querySelector('#bigalert').click())));
ok(['xray', 'tracker'].some((k) => st.players[seekerPid].inv[k] === 1), 'catching a hider who still had power-ups gives the seeker a super power-up');
// a far hider is not caught by that tag
ok(!st.players[hiders[1].pid].caughtAt, 'hiders out of range are safe');
// self-report
await G(hiders[1], (sp) => window.__gl.send('caught', { who: window.__gl.me.id, by: sp, how: 'self', p: null }), seekerPid);
ok(await until(async () => !!(await state(host)).players[hiders[1].pid].caughtAt, 5000, 'self'), '"I got caught" button works');

// seeker alarm from an infected seeker: hiders[0] was caught and joined the seekers, the original seeker is far away
await setPos(seeker, off(0, -600));
await setPos(hiders[0], off(60, -230)); // 20 m from hiders[2]
ok(await until(async () => (await G(hiders[2], (id) => !!window.__gl.local.nearLocs[id], hiders[0].pid)), 8000, 'infected near'), 'a hider who joined the seekers shares their spot for the alarm');
ok(await until(async () => G(hiders[2], () => window.__gl.alarmOn), 8000, 'infected alarm'), 'the alarm plays when a seeker who started as a hider gets close');
// an infected seeker who turns off their screen is called out like any seeker (so they can't quietly drop off the alarm)
await G(hiders[0], () => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
ok(await until(async () => (await G(hiders[2], () => document.body.innerText)).includes('turned off their screen'), 5000, 'infected away'), 'an infected seeker turning off their screen is called out to everyone');
await G(hiders[0], () => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
await setPos(hiders[0], off(60, 100));
ok(await until(async () => !(await G(hiders[2], () => window.__gl.alarmOn)), 8000, 'infected alarm off'), 'and stops when they walk away');
await setPos(seeker, off(0, 0));

// chat (team only)
await G(seeker, () => window.__gl.send('chat', { text: 'north side', to: 'seeker' }));
await sleep(600);
ok((await hiders[2].page.evaluate(() => document.body.innerText)).includes('north side') === false, 'seeker team chat is hidden from hiders');

// ---- end of round by timer
ok(await until(async () => (await state(host)).phase === 'ended', 100000, 'end'), 'round ends when the clock runs out');
st = await state(host);
const r = st.results;
ok(r[hiders[2].pid].survived && r[hiders[2].pid].pts >= 50, `${hiders[2].name} survived and scored ${r[hiders[2].pid].pts}`);
ok(r[seekerPid].catches === 2 && r[seekerPid].pts === 90, `${seeker.name} scored ${r[seekerPid].pts} for 2 catches and 1 miss`);
ok(await hiders[0].page.evaluate(() => !!document.querySelector('.endsplash h1')), 'a big GAME OVER splash shows when the round ends');
if (SHOTS) await hiders[0].page.screenshot({ path: SHOTS + '/11-splash.png' });
await sleep(3400);
ok(await hiders[0].page.evaluate(() => { const b = document.querySelector('#sheet [data-act="replay"]'), lb = document.querySelector('#sheet .lb'); if (!b || !lb) return false; const r = b.getBoundingClientRect(); return r.bottom <= innerHeight && !document.querySelector('.endsplash') && !document.querySelector('#sheet [data-act="leave"]'); }), 'the end screen shows the scoreboard and replay button with no scrolling, and the extras stay tucked away');
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

// a pin mid-hunt: the seeker sends one to hider A only
{
  await sk2.page.click('#btn-pin');
  await G(sk2, ([a, b]) => window.__gl.tapMap(a, b), ring(45));
  await until(async () => G(sk2, () => !!document.querySelector('#pin-send')), 3000, 'pin modal hunt');
  ok((await G(sk2, () => [...document.querySelectorAll('.pin-quick [data-pq]')].map((b) => b.dataset.pq).join())) === 'all,hider,seeker,none', 'during a round the pin sheet has Hiders and Seekers buttons');
  await sk2.page.fill('#pin-note', 'trade?');
  await sk2.page.click(`.pin-to-row:has(input[value="${A.pid}"])`);
  await sk2.page.click('#pin-send');
  ok(await until(async () => (await G(A, () => window.__gl.pins)).some((x) => x.from === sk2.pid && x.note === 'trade?'), 5000, 'hunt pin'), 'a seeker can pin one hider mid-round');
  ok(await G(A, () => { const u = document.querySelector('#last-up'); return !!u && !u.hidden && u.textContent.includes('sent you a pin'); }), 'mid-round the receiver gets the in-game alert');
  await sleep(400);
  ok(!(await G(B, () => window.__gl.pins)).some((x) => x.from === sk2.pid), 'other hiders never see it');
}

// mission
const mOld = st.players[A.pid].mission;
await setPos(A, st.players[A.pid].mission.p);
ok(await until(async () => ((await state(host)).players[A.pid].missionsDone || 0) === 1, 6000, 'mission'), `${A.name} reaches their secret mission spot`);
st = await state(host);
ok(st.players[A.pid].bonus === 25 && Object.values(st.players[A.pid].inv).reduce((a, b) => a + b, 0) === 4, 'mission pays +25 and a power-up, and a new target appears');
for (let i = 0; i < 3; i++) await G(A, ([id, p]) => window.__gl.send('mission', { id, p, acc: 5 }), [mOld.id, mOld.p]);
await G(A, ([id, p]) => window.__gl.send('mission', { id, p, acc: 5 }), [st.players[A.pid].mission.id, mOld.p]);
await sleep(1500);
st = await state(host);
ok(st.players[A.pid].missionsDone === 1 && st.players[A.pid].bonus === 25, 'a mission pays only once, even when the message repeats');
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
ok(await until(async () => (await G(sk2, (id) => window.__gl.local.pings.some((x) => x.id === id && x.kind === 'blackout' && !x.p), A.pid)), 5000, 'blackoutPing'), 'during a blackout, pings stay hidden until the next regular ping');
ok((await state(host)).blackoutUntil > Date.now() + 1000, 'the blackout lasts until the next regular ping, not a set number of seconds');

// swarm: next scheduled ping shows 4 spots
await G(host, (id) => window.__gl.give(id, 'swarm'), A.pid);
await until(async () => (await state(A)).players[A.pid].inv.swarm >= 1, 4000, 'give4');
await G(A, () => window.__gl.act('item', { dataset: { item: 'swarm' } }));
ok(await until(async () => (await G(sk2, (id) => window.__gl.local.pings.some((x) => x.id === id && x.kind === 'scheduled' && x.alts && x.alts.length === 3), A.pid)), 45000, 'swarm'), 'swarm ping shows 4 spots, only one real');
ok(await G(sk2, (id) => window.__gl.local.pings.some((x) => x.id === id && x.alts && Number.isInteger(x.ri)), A.pid), 'a swarm ping says which spot is real (for the Truth lens)');

// ---- sabotage powers
{
  const give = async (ph, item) => { await G(host, ([id, k]) => window.__gl.give(id, k), [ph.pid, item]); await until(async () => ((await state(ph)).players[ph.pid].inv[item] || 0) >= 1, 4000, 'give ' + item); };
  const use = (ph, item) => G(ph, (k) => window.__gl.act('item', { dataset: { item: k } }), item);
  const aim = async (ph, item, target) => { await use(ph, item); await G(ph, (id) => window.__gl.act('spotTarget', { dataset: { id } }), target.pid); };
  const Wl = async (id) => (((await state(host)).wallet || {})[id] || 0);
  const evOf = async (k, f = () => true) => (await state(host)).events.find((e) => e.k === k && f(e));
  // mirror bounces a snitch back onto the snitcher
  await give(Cc, 'mirror'); await use(Cc, 'mirror');
  ok(await until(async () => (await state(host)).players[Cc.pid].fx.mirror === 1, 4000, 'mirror'), 'mirror goes up');
  await give(A, 'snitch');
  ok(await G(A, () => { window.__gl.act('item', { dataset: { item: 'snitch' } }); return window.__gl.local.aimPick; }) === 'snitch', 'an aimed power asks who to hit first');
  await G(A, (id) => window.__gl.act('spotTarget', { dataset: { id } }), Cc.pid);
  ok(await until(async () => !!(await evOf('mirrorHit', (e) => e.who === Cc.pid && e.by === A.pid)), 4000, 'mirrorHit') && !(await state(host)).players[Cc.pid].fx.mirror, 'a mirror bounces the snitch and is used up');
  ok(await until(async () => G(sk2, (id) => window.__gl.local.pings.some((x) => x.id === id && x.kind === 'snitch' && x.blur === 0), A.pid), 6000, 'snitch bounce'), "the bounced snitch pings the snitcher's own exact spot");
  // snitch gets through a ghost
  await give(A, 'snitch'); await aim(A, 'snitch', B);
  ok(await until(async () => G(sk2, (id) => window.__gl.local.pings.some((x) => x.id === id && x.kind === 'snitch' && x.p && x.blur === 0), B.pid), 6000, 'snitch'), "a snitch shows another hider's exact spot, even a ghosted one");
  // frame: the target pings, the framer's next ping is hidden
  await give(Cc, 'frame'); await aim(Cc, 'frame', A);
  ok(await until(async () => G(sk2, (id) => window.__gl.local.pings.some((x) => x.id === id && x.kind === 'framed' && x.p), A.pid), 6000, 'frame') && (await state(host)).players[Cc.pid].fx.ghostUntil > Date.now(), "frame makes the target ping and hides the framer's next ping");
  // pickpocket: an item moves from the target to the thief
  await give(A, 'sonar');
  const cnt = (s, id) => Object.values(s.players[id].inv || {}).reduce((a, b) => a + b, 0);
  await give(Cc, 'pickpocket');
  let s0 = await state(host); const a0 = cnt(s0, A.pid), c0 = cnt(s0, Cc.pid);
  await aim(Cc, 'pickpocket', A);
  ok(await until(async () => { const s = await state(host); return cnt(s, A.pid) === a0 - 1 && cnt(s, Cc.pid) === c0; }, 4000, 'pickpocket'), 'pickpocket moves a power-up from the target to the thief');
  // scramble blurs the seeker's map
  await give(A, 'scramble'); await use(A, 'scramble');
  ok(await until(async () => sk2.page.evaluate(() => document.body.classList.contains('scramble')), 5000, 'scramble'), "scramble blurs the seeker's map");
  // firewall blocks butterfingers once, then the next one lands and stops tagging
  await give(sk2, 'firewall'); await use(sk2, 'firewall');
  await until(async () => (await state(host)).players[sk2.pid].fx.firewall === 1, 4000, 'firewall');
  await give(A, 'butter'); await use(A, 'butter');
  ok(await until(async () => !!(await evOf('firewallHit', (e) => e.who === sk2.pid && e.item === 'butter')), 4000, 'fwHit') && !((await state(host)).players[sk2.pid].fx.butterUntil), 'a firewall blocks the next hider sabotage');
  await give(A, 'butter'); await use(A, 'butter');
  ok(await until(async () => (await state(host)).players[sk2.pid].fx.butterUntil > Date.now(), 4000, 'butter'), 'butterfingers lands once the firewall is gone');
  await setPos(sk2, home.get(B)); await sleep(600);
  await G(sk2, () => window.__gl.act('tag', {})); await sleep(1500);
  ok(!(await state(host)).players[B.pid].caughtAt, "a seeker with butterfingers can't tag");
  await setPos(sk2, home.get(sk2));
  // phantoms: 3 fake pings on the seeker's map, and a truth lens hides them
  await give(A, 'phantoms'); await use(A, 'phantoms');
  ok(await until(async () => (await G(sk2, () => window.__gl.local.pings.filter((x) => x.fake).length)) === 3, 4000, 'phantoms'), 'phantoms put 3 fake pings on the seeker map');
  await give(sk2, 'truth'); await use(sk2, 'truth');
  ok(await until(async () => (await G(sk2, () => window.__gl.local.truthUntil)) > 0, 4000, 'truth'), 'truth lens turns on');
  // fog, silencer, siren, tax, flashbang, overtime, fast forward
  await give(sk2, 'fog'); await use(sk2, 'fog');
  ok(await until(async () => A.page.evaluate(() => document.body.classList.contains('fog')), 5000, 'fog') && !(await sk2.page.evaluate(() => document.body.classList.contains('fog'))), "fog darkens hiders' maps only");
  await give(sk2, 'silencer'); await use(sk2, 'silencer');
  ok(await until(async () => (await state(host)).silenceUntil > Date.now(), 4000, 'silencer'), "silencer mutes hiders' alarms");
  await give(sk2, 'siren'); await use(sk2, 'siren');
  ok(await until(async () => !!(await evOf('siren')), 4000, 'siren'), 'siren goes off');
  const wallets0 = { ...((await state(host)).wallet || {}) };
  await G(host, (ids) => ids.forEach((id) => window.__gl.setWallet(id, 100)), [A.pid, B.pid, Cc.pid, sk2.pid]);
  await until(async () => (await Wl(sk2.pid)) === 100, 4000, 'fundTax');
  const inNow = Object.entries((await state(host)).players).filter(([, x]) => x.role === 'hider' && !x.caughtAt && !x.extracted).length;
  await give(sk2, 'tax'); await use(sk2, 'tax');
  ok(await until(async () => (await Wl(sk2.pid)) === 100 + 15 * inNow && (await Wl(A.pid)) === 85, 4000, 'tax'), `tax takes 15 from each of the ${inNow} hiders still in`);
  await G(host, (w) => Object.entries(w).forEach(([id, n]) => window.__gl.setWallet(id, n)), wallets0); // put back so later wallet checks hold
  await until(async () => (await Wl(sk2.pid)) === (wallets0[sk2.pid] || 0), 4000, 'unfund');
  await give(sk2, 'flashbang'); await aim(sk2, 'flashbang', A);
  ok(await until(async () => A.page.evaluate(() => document.body.classList.contains('flashed')), 4000, 'flash'), "flashbang whites out the hider's screen");
  const end0 = (await state(host)).huntEnd;
  await give(sk2, 'overtime'); await use(sk2, 'overtime');
  ok(await until(async () => (await state(host)).huntEnd === end0 + 60000, 4000, 'overtime'), 'overtime adds a minute');
  await give(A, 'fastfwd'); await use(A, 'fastfwd');
  ok(await until(async () => (await state(host)).huntEnd === end0, 4000, 'fastfwd'), 'fast forward takes a minute off');
  // a seeker's aimed power just fizzles on a mirror
  await give(B, 'mirror'); await use(B, 'mirror');
  await until(async () => (await state(host)).players[B.pid].fx.mirror === 1, 4000, 'mirror2');
  await give(sk2, 'spotlight'); await aim(sk2, 'spotlight', B);
  ok(await until(async () => !!(await evOf('mirrorHit', (e) => e.who === B.pid && e.item === 'spotlight')), 4000, 'fizzle') && !(await evOf('spotlight', (e) => e.target === B.pid)), "a seeker's spotlight is wasted on a mirror");
}

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
ok(+cd >= 15 && +cd <= 20, 'the alert counts down from 20 (' + cd + ' s left after 1.5 s)');
{ // the arrow turns as the phone turns (compass)
  const turn = await G(A, async () => { document.body.click(); await new Promise((r) => setTimeout(r, 100));
    const ev = (alpha) => { const t = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
      const e = typeof DeviceOrientationEvent === 'function' ? new DeviceOrientationEvent(t, { alpha, beta: 0, gamma: 0, absolute: true }) : Object.assign(new Event(t), { absolute: true, alpha });
      window.dispatchEvent(e); return document.querySelector('#oz-arrow').style.transform; };
    return [ev(0), ev(90)]; });
  ok(turn[0] !== turn[1], 'the out-of-zone arrow turns as the phone turns: ' + turn.join(' -> '));
  if (SHOTS) await A.page.screenshot({ path: SHOTS + '/11b-out-of-zone-arrow.png' });
}
ok(await A.page.isVisible('#oz-arrow') && /Head (north|south|east|west)/.test(await A.page.innerText('#oz-dir')), 'a big arrow and direction point the way back into the zone: ' + (await A.page.innerText('#oz-dir')));
ok(await until(async () => (await state(host)).events.some((e) => e.k === 'catch' && e.who === A.pid && e.how === 'zone'), 26000, 'dq'), 'out of the zone for 20 s gets you knocked out');

// end the round from the host
await host.page.click('[data-act="toggleMore"]');
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
await until(async () => (await Wl(B.pid)) === 425, 4000, 'buy1');
await Bp.page.click('[data-act="buy"][data-k="radar"]');
ok(await until(async () => { const x = (await state(host)).players[B.pid].bank || {}; return x.cloak === 1 && x.radar === 1; }, 4000, 'bank'), 'picks bought in the lobby are saved for later');
ok((await Wl(B.pid)) === 375, 'cloak (75) and radar (50) come off the balance');
if (SHOTS) await Bp.page.screenshot({ path: SHOTS + '/14-shop.png' });
await Bp.page.click('[data-act="buy"][data-k="icon"][data-opt="star"]');
ok(await until(async () => (await state(host)).players[B.pid].icon === 'star', 4000, 'icon'), 'a shape can be bought');
ok((await Wl(B.pid)) === 365, 'shapes are cheap (10)');
await Bp.page.click('[data-act="buy"][data-k="char"][data-opt="toad"]');
ok(await until(async () => (await state(host)).players[B.pid].icon === 'c:toad', 4000, 'char'), 'a character can be bought');
await Bp.page.click('.card-tap[data-act="togglePlayers"]');
ok((await Wl(B.pid)) === 265 && await until(async () => (await Bp.page.$$('.av img.ch[src="chars/toad.png"]')).length > 0, 3000, 'toad av'), 'Toad costs 100 and shows as your avatar');
await G(Bp, () => window.__gl.send('buy', { k: 'char', opt: 'mewtwo' }));
await sleep(800);
ok((await state(host)).players[B.pid].icon === 'c:toad' && (await Wl(B.pid)) === 265, "a legendary character is out of reach at 265 points");
await Bp.page.click('[data-act="buy"][data-k="icon"][data-opt="moon"]');
await until(async () => (await state(host)).players[B.pid].icon === 'moon', 4000, 'icon2');
await Bp.page.click('[data-act="buy"][data-k="char"][data-opt="toad"]');
ok(await until(async () => (await state(host)).players[B.pid].icon === 'c:toad', 4000, 'char2') && (await Wl(B.pid)) === 255, 'switching back to a character you own is free');
ok(await until(async () => (await G(Bp, () => localStorage.getItem('gl:owned') || '')).includes('toad'), 4000, 'owned saved'), 'a bought character is saved on the phone for future games');
{ const taken = (await state(host)).players[A.pid].color;
  await G(Bp, (c) => window.__gl.send('buy', { k: 'color', opt: c }), taken); await sleep(800);
  ok((await state(host)).players[B.pid].color !== taken, "you can't take someone else's color");
  const st2 = await state(host); const used = Object.values(st2.players).map((p) => p.color);
  const sw = await Bp.page.$$eval('[data-act="buy"][data-k="color"]', (els) => els.map((e) => e.dataset.opt));
  const pickC = sw.find((c) => !used.includes(c));
  await Bp.page.click(`[data-act="buy"][data-k="color"][data-opt="${pickC}"]`);
  ok(await until(async () => (await state(host)).players[B.pid].color === pickC, 4000, 'color') && (await Wl(B.pid)) === 250, 'a color can be bought for 5');
  if (SHOTS) { await Bp.page.$eval('.chars', (e) => e.scrollIntoView()); await sleep(1500); await Bp.page.screenshot({ path: SHOTS + '/14b-characters.png' }); } }
await G(host, (id) => window.__gl.setWallet(id, 30), A.pid);
await until(async () => (await Wl(A.pid)) === 30, 4000, 'fund2');
await G(A, () => window.__gl.send('buy', { k: 'spotlight' }));
await sleep(800);
ok((await Wl(A.pid)) === 30 && !((await state(host)).players[A.pid].bank || {}).spotlight, "you can't buy what you can't afford");
for (const ph of all) await setPos(ph, C);
// ---- host picks the runner
await G(host, () => window.__gl.setSettings({ seekPick: 'choose' }));
ok(await until(async () => await host.page.isDisabled('[data-act="start"]'), 4000, 'pick gate'), "with 'Host picks' on, the round can't start until the runner is picked");
await host.page.click(`[data-act="pick"][data-id="${A.pid}"]`);
ok(await until(async () => (await host.page.isEnabled('[data-act="start"]')) && (await others[0].page.isVisible('.pick-card .mchip')), 4000, 'picked'), 'picking the runner unlocks Start, and other phones see the pick');
await host.page.click('[data-act="start"]');
ok(await until(async () => (await state(host)).phase === 'hunting', 8000, 'hunting3'), 'fugitive round starts');
{ const s3 = await state(host); ok(s3.players[A.pid].role === 'hider' && Object.values(s3.players).filter((p) => p.role === 'hider').length === 1 && !s3.picks, 'the picked player is the runner, and the pick resets for the next round'); }
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
  ok(await until(async () => (await G(hn, (id) => !!window.__gl.local.trailLocs[id], rn.pid)) && (await hn.page.isVisible('#trail')), 8000, 'trail'), 'hot trail shows the seeker the nearest hider');
  ok(await until(() => G(hn, () => document.querySelectorAll('path.trail-line').length === 2 && !!document.querySelector('[data-mk^="trail:"]')), 6000, 'trail line'), 'hot trail puts the hider on the map with a line from the seeker to them');
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
  ok((await Wl(hn.pid)) === 1000 - 75 - 90 - 100 && (await Wl(rn.pid)) === 1000 - 65 - 75 - 150, 'every buy is charged once by the host');
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

// ---- location blocked: the Allow location button
const lp = others[0];
await lp.page.evaluate(() => { navigator.geolocation.getCurrentPosition = (ok, no) => setTimeout(() => no({ code: 1 }), 50); });
await G(lp, () => window.__gl.act('allowGeo', { dataset: {} }));
ok(await until(() => lp.page.evaluate(() => !!document.querySelector('#modal:not([hidden]) .geo-help')), 4000, 'geohelp'), 'if location is blocked, Allow location shows how to turn it back on');
ok(await until(() => lp.page.evaluate(() => !!document.querySelector('#sheet [data-act="allowGeo"]')), 4000, 'geobtn'), 'and an Allow location button stays on screen');
ok(await until(() => others[1].page.evaluate(() => !!document.querySelector('#sheet .noloc')), 5000, 'noloc'), 'the lobby shows who has not shared their location');
if (SHOTS) await others[1].page.screenshot({ path: SHOTS + '/16-lobby-noloc.png' });
await lp.page.evaluate(() => { navigator.geolocation.getCurrentPosition = (ok) => setTimeout(() => ok({ coords: { latitude: 33.42, longitude: -111.83, accuracy: 8 } }), 50); }); // they turned it on in settings
await lp.page.click('#modal [data-act="allowGeo"]');
ok(await until(() => lp.page.evaluate(() => document.querySelector('#modal').hidden && !document.querySelector('#sheet [data-act="allowGeo"]')), 8000, 'geook'), 'once location is allowed, Try again picks it back up');
ok(await until(() => others[1].page.evaluate(() => !document.querySelector('#sheet .noloc')), 5000, 'noloc2'), 'and the tag goes away once they share it');
await lp.page.click('#btn-gear');
ok(await until(() => lp.page.evaluate(() => !!document.querySelector('#modal:not([hidden]) .set-row') && !!document.querySelector('#modal [data-act="allowGeo"]')), 3000, 'gear'), 'the gear button opens settings with an Allow location button');
await lp.page.click('#modal [data-act="closeModal"]');
await lp.page.click('#sheet');
await lp.page.evaluate(() => window.__gl.map.setView([0, 0], 3));
ok(await lp.page.evaluate(() => document.querySelector('#btn-north').hidden), 'no turn button in the lobby');
await lp.page.evaluate(() => document.querySelector('#btn-north').click());
ok(await until(() => lp.page.evaluate(() => window.__gl.bear === 90 && /rotate\(90deg\)/.test(document.querySelector('#map').style.transform) && document.querySelector('#map').offsetWidth > innerWidth), 3000, 'turn'), 'the compass button turns the map');
ok(await lp.page.evaluate(() => { const m = window.__gl.map, r = document.querySelector('#map').getBoundingClientRect(), q = m.mouseEventToContainerPoint({ clientX: r.left + r.width / 2 + 100, clientY: r.top + r.height / 2 }), z = m.getSize(); return Math.abs(q.x - z.x / 2) < 2 && Math.abs(q.y - (z.y / 2 - 100)) < 2; }), 'taps on a turned map land on the right spot');
if (SHOTS) await lp.page.screenshot({ path: SHOTS + '/13-turned.png' });
for (let i = 0; i < 3; i++) await lp.page.evaluate(() => document.querySelector('#btn-north').click());
ok(await until(() => lp.page.evaluate(() => window.__gl.bear === 0 && !document.querySelector('#map').style.transform), 3000, 'north'), 'and turns it back to north');
await lp.page.evaluate(() => document.querySelector('#btn-fit').click());
ok(await until(() => lp.page.evaluate(() => { const m = window.__gl.map, z = window.__gl.S.zone; const c = z.type === 'circle' ? z.c : z.pts[0]; return m.getZoom() > 8 && m.getBounds().contains(c); }), 4000, 'fit'), 'the whole-map button zooms to fit the play area');
ok(await until(() => lp.page.evaluate(() => window.__gl.audio() === 'running'), 4000, 'audio'), 'game sound is on and running after a tap');

console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'No page errors');
if (errors.length) fails++;
await browser.close();
srv.kill();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
