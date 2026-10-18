import http from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import { createRoom, joinRoom, hostAction, potsFor, seatsFor, snapshot, rememberAction, playerAction, bettingOptions, nextButton } from './game.mjs';

const port = Number(process.env.PORT || 3000);
const dataDir = path.resolve(process.env.DATA_DIR || '.data');
const rooms = new Map();
const streams = new Map();
const presence = new Map();
await mkdir(dataDir, { recursive: true });
try {
  const saved = JSON.parse(await readFile(path.join(dataDir, 'tables.json'), 'utf8'));
  for (const room of saved) {
    room.smallBlind ??= 5; room.bigBlind ??= 10;
    room.betting ??= {phase:room.players.some(p => p.contribution > 0) ? 'showdown' : 'waiting',street:'preflop',actorId:null};
    room.players.forEach(p => { p.roundContribution ??= 0; });
    // Old undo snapshots predate turn handling and cannot restore a valid turn.
    room.undoHistory = (room.undoHistory || []).filter(entry => entry.betting);
    rooms.set(room.code, room);
  }
} catch (e) { if (e.code !== 'ENOENT') console.error('Could not restore tables:', e.message); }
let persistQueue = Promise.resolve();
function persist() {
  persistQueue = persistQueue.then(async () => {
    await writeFile(path.join(dataDir, 'tables.tmp'), JSON.stringify([...rooms.values()]));
    await rename(path.join(dataDir, 'tables.tmp'), path.join(dataDir, 'tables.json'));
  }).catch(e => console.error('Could not save tables:', e.message));
}
function publicState(room) {
  const { hostToken, processed, undoHistory, ...state } = room;
  return { ...state, seatIds: seatsFor(room), playerCount: seatsFor(room).length, undoCount: undoHistory?.length || 0, nextButtonId: nextButton(room)?.id, players: room.players.map(({ token, ...p }) => ({ ...p, actions: bettingOptions(room,p), connected: (presence.get(`${room.code}:${p.id}`) || 0) > 0 })), pots: potsFor(room) };
}
function broadcast(room) {
  const message = `data: ${JSON.stringify(publicState(room))}\n\n`;
  for (const stream of streams.get(room.code) || []) stream.write(message);
}
function json(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
async function body(req) {
  let data = '';
  for await (const chunk of req) { data += chunk; if (data.length > 16000) throw new Error('Request too large.'); }
  return data ? JSON.parse(data) : {};
}
function authenticate(req, room, url) {
  const token = req.headers.authorization?.replace(/^Bearer /, '') || url.searchParams.get('token');
  if (token === room.hostToken) return { host: true };
  const player = room.players.find(p => p.token === token);
  if (player) return { player };
  return null;
}
function addresses(req) {
  const host = req.headers.host || `localhost:${port}`;
  const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  return { origin: `http://${host}`, localUrls: [...new Set(ips)].map(ip => `http://${ip}:${port}`) };
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/api/network') return json(res, 200, addresses(req));
    if (req.method === 'POST' && url.pathname === '/api/rooms') {
      if (rooms.size >= 100) return json(res, 429, { error: 'The server has reached its table limit. Restart with a fresh data directory.' });
      let code;
      do { code = randomBytes(3).toString('hex').slice(0, 4).toUpperCase(); } while (rooms.has(code));
      const hostToken = randomUUID(); const room = createRoom(code, hostToken);
      rooms.set(code, room); persist();
      return json(res, 201, { token: hostToken, code, state: publicState(room) });
    }
    const match = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]{4})(?:\/(join|events|action|qr|preview))?$/);
    if (match) {
      const room = rooms.get(match[1]);
      if (!room) return json(res, 404, { error: 'Table not found. Check the table code with your host.' });
      const route = match[2];
      if (req.method === 'GET' && route === 'preview') return json(res, 200, { name: room.name, code: room.code, seatIds: seatsFor(room), ready: room.setupComplete !== false, seats: room.players.map(p => ({ name:p.name, seat:p.seat })), handInProgress: room.betting?.phase !== 'waiting' || room.players.some(p => p.contribution > 0) });
      if (req.method === 'POST' && route === 'join') {
        if (room.setupComplete === false) throw new Error('The host is still setting up this table.');
        const data = await body(req);
        const before = snapshot(room);
        const player = joinRoom(room, data); rememberAction(room, before); persist(); broadcast(room);
        return json(res, 201, { token: player.token, playerId: player.id, code: room.code, state: publicState(room) });
      }
      const auth = authenticate(req, room, url);
      if (!auth) return json(res, 401, { error: 'Your seat is no longer available. Rejoin the table.' });
      if (req.method === 'GET' && route === 'qr') {
        const { localUrls, origin } = addresses(req);
        const host = new URL(origin).hostname;
        const base = host === 'localhost' || host === '127.0.0.1' ? localUrls[0] || origin : origin;
        const svg = await QRCode.toString(`${base}/join?table=${room.code}`, { type: 'svg', margin: 1, color: { dark: '#19372f', light: '#ffffff' } });
        res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' }); return res.end(svg);
      }
      if (req.method === 'GET' && route === 'events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write(': connected\n\n');
        if (!streams.has(room.code)) streams.set(room.code, new Set());
        streams.get(room.code).add(res);
        const key = auth.player ? `${room.code}:${auth.player.id}` : null;
        if (key) presence.set(key, (presence.get(key) || 0) + 1);
        broadcast(room);
        const timer = setInterval(() => res.write(': heartbeat\n\n'), 15000);
        req.on('close', () => { clearInterval(timer); streams.get(room.code)?.delete(res); if(key) presence.set(key, Math.max(0,(presence.get(key)||1)-1)); broadcast(room); });
        return;
      }
      if (req.method === 'GET' && !route) return json(res, 200, { state: publicState(room), playerId: auth.player?.id, host: !!auth.host });
      if (req.method === 'POST' && route === 'action') {
        const data = await body(req);
        if (typeof data.requestId !== 'string' || data.requestId.length > 64) return json(res, 400, {error:'This action needs a request ID.'});
        if (room.processed.includes(data.requestId)) return json(res, 200, { state: publicState(room) });
        const before = snapshot(room);
        if (['bet','call','all-in','check','fold'].includes(data.action)) {
          const player = (auth.player && room.players.find(p => p.id === auth.player.id)) || (auth.host && room.demo ? room.players.find(p => p.id === data.playerId) : null);
          if (!player) return json(res, 403, { error: 'Only the seated player can throw their chips.' });
          playerAction(room, player, data.action, data);
        } else {
          if (!auth.host) return json(res, 403, { error: 'Only the laptop host can manage the table.' });
          hostAction(room, data.action, data);
        }
        if (data.action !== 'undo') rememberAction(room, before);
        room.processed.push(data.requestId); room.processed = room.processed.slice(-500);
        persist(); broadcast(room); return json(res, 200, { state: publicState(room) });
      }
      return json(res, 405, {error:'Method not allowed.'});
    }
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found.' });
    if (req.method === 'GET' && url.pathname==='/vendor/cannon-es.js') {
      const contents=await readFile(path.resolve('node_modules/cannon-es/dist/cannon-es.js'));
      res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'public, max-age=86400'});return res.end(contents);
    }
    if (req.method === 'GET' && ['/vendor/three/three.module.js','/vendor/three/three.core.js'].includes(url.pathname)) {
      const contents=await readFile(path.resolve('node_modules/three/build',path.basename(url.pathname)));
      res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'public, max-age=86400'});return res.end(contents);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, {error:'Method not allowed.'});
    const pathname = url.pathname === '/' || url.pathname === '/join' ? '/index.html' : url.pathname;
    const file = path.resolve('public', `.${decodeURIComponent(pathname)}`);
    if (!file.startsWith(path.resolve('public') + path.sep)) return json(res, 403, { error: 'Forbidden.' });
    const contents = await readFile(file);
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.wav': 'audio/wav' };
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : contents);
  } catch (e) { json(res, e.code === 'ENOENT' ? 404 : 400, { error: e.code === 'ENOENT' ? 'Not found.' : e.message }); }
});
server.listen(port, '0.0.0.0', () => {
  console.log(`\n  CLUBHOUSE · Poker without the plastic\n  Laptop: http://localhost:${port}\n`);
  for (const ip of Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal)) console.log(`  Wi-Fi:  http://${ip.address}:${port}`);
  console.log('\n  Keep this process running while you play.\n');
});
function shutdown() {
  for (const set of streams.values()) for (const stream of set) stream.end();
  server.close(async () => { await persistQueue; process.exit(0); });
}
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
