// Ghostline transport. Two interchangeable backends with the same shape:
//   send(msg)            broadcast to everyone else in the room
//   onMessage(fn)        fn(msg) for every message from someone else
//   onPeers(fn)          fn(Set of player ids currently connected, including you)
//   close()
// 1) Supabase Realtime broadcast + presence (static hosting anywhere, no database tables)
// 2) The bundled Node relay (server.js) for local play-testing or self-hosting

export async function createNet(code, me) {
  const cfg = window.GHOSTLINE_CONFIG || {};
  const q = new URLSearchParams(location.search);
  let mode = q.get('net') || cfg.transport || 'auto';
  if (mode === 'auto') {
    const localHost = /^(localhost|127\.|10\.|192\.168\.)/.test(location.hostname);
    mode = localHost || !cfg.supabaseUrl ? 'relay' : 'supabase';
  }
  return mode === 'supabase' ? supabaseNet(code, me, cfg) : relayNet(code, me);
}

function hub() {
  const msgFns = [], peerFns = [];
  return {
    msgFns, peerFns,
    onMessage: (f) => msgFns.push(f),
    onPeers: (f) => peerFns.push(f),
    emitMsg: (m) => msgFns.forEach((f) => { try { f(m); } catch (e) { console.error(e); } }),
    emitPeers: (s) => peerFns.forEach((f) => { try { f(s); } catch (e) { console.error(e); } }),
  };
}

async function supabaseNet(code, me, cfg) {
  if (!window.supabase) throw new Error('Realtime library did not load');
  const h = hub();
  const client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 20 } },
  });
  const ch = client.channel('ghostline-' + code, {
    config: { broadcast: { self: false, ack: false }, presence: { key: me.id } },
  });
  ch.on('broadcast', { event: 'm' }, ({ payload }) => h.emitMsg(payload));
  const syncPeers = () => {
    const s = new Set(Object.keys(ch.presenceState()));
    s.add(me.id);
    h.emitPeers(s);
  };
  ch.on('presence', { event: 'sync' }, syncPeers);
  ch.on('presence', { event: 'join' }, syncPeers);
  ch.on('presence', { event: 'leave' }, syncPeers);
  let ready = false;
  await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('Could not reach the game server')), 15000);
    ch.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        ready = true;
        await ch.track({ at: Date.now() });
        clearTimeout(to);
        resolve();
      } else if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && !ready) {
        clearTimeout(to);
        reject(new Error('Realtime ' + status));
      }
    });
  });
  return {
    kind: 'supabase',
    send: (m) => ch.send({ type: 'broadcast', event: 'm', payload: m }),
    onMessage: h.onMessage,
    onPeers: h.onPeers,
    close: () => { try { client.removeChannel(ch); } catch {} },
  };
}

async function relayNet(code, me) {
  const h = hub();
  let ws, closed = false, queue = [], backoff = 500;
  const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host +
    '/relay?room=' + encodeURIComponent(code) + '&id=' + encodeURIComponent(me.id);
  const open = () => new Promise((resolve) => {
    ws = new WebSocket(url);
    ws.onopen = () => {
      backoff = 500;
      const q = queue; queue = [];
      q.forEach((m) => ws.send(m));
      resolve();
    };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m && m.t === '__peers') { const s = new Set(m.ids); s.add(me.id); h.emitPeers(s); }
      else h.emitMsg(m);
    };
    ws.onclose = () => {
      if (closed) return;
      setTimeout(() => open(), backoff);
      backoff = Math.min(backoff * 2, 8000);
    };
    ws.onerror = () => {};
  });
  await Promise.race([open(), new Promise((_, rej) => setTimeout(() => rej(new Error('Could not reach the game server')), 10000))]);
  return {
    kind: 'relay',
    send: (m) => {
      const s = JSON.stringify(m);
      if (ws && ws.readyState === 1) ws.send(s); else queue.push(s);
    },
    onMessage: h.onMessage,
    onPeers: h.onPeers,
    close: () => { closed = true; try { ws.close(); } catch {} },
  };
}
