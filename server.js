// Ghostline local server: serves ./public and relays game messages between phones in a room.
// Use it for play-testing on your Wi-Fi, or to self-host the game on any Node host.
//   npm install && npm start      ->  http://localhost:8080
// Phones need HTTPS for GPS, so for real play put this behind HTTPS (or use the Supabase setup).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const PORT = +(process.env.PORT || 8080);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let p = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  if (!p || p.endsWith('/')) p += 'index.html';
  const file = path.join(dir, p);
  if (!file.startsWith(dir)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
});

const rooms = new Map(); // code -> Map(id -> ws)
const wss = new WebSocketServer({ server, path: '/relay', maxPayload: 512 * 1024 });
function peers(code) {
  const r = rooms.get(code); if (!r) return;
  const msg = JSON.stringify({ t: '__peers', ids: [...r.keys()] });
  for (const ws of r.values()) if (ws.readyState === 1) ws.send(msg);
}
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://x');
  const code = (url.searchParams.get('room') || '').toUpperCase().slice(0, 8);
  const id = (url.searchParams.get('id') || '').slice(0, 40);
  if (!code || !id) return ws.close();
  if (!rooms.has(code)) rooms.set(code, new Map());
  const r = rooms.get(code);
  const old = r.get(id); if (old && old !== ws) try { old.close(); } catch {}
  r.set(id, ws);
  peers(code);
  ws.on('message', (data) => {
    const s = data.toString();
    for (const [pid, other] of r) if (pid !== id && other.readyState === 1) other.send(s);
  });
  ws.on('close', () => {
    if (r.get(id) === ws) r.delete(id);
    if (!r.size) rooms.delete(code); else peers(code);
  });
});

server.listen(PORT, () => console.log(`Ghostline on http://localhost:${PORT}`));
