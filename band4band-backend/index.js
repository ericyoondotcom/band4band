import 'dotenv/config';
import { WebSocketServer } from 'ws';
import http from 'http';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import plaidService from './helpers/PlaidService.js';
import gameManager from './helpers/GameManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(express.json());

// Basic CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'OPTIONS, POST, GET');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

// Create link token route
app.post('/create_link_token', async (req, res) => {
  try {
    const { clientUserId } = req.body;
    const linkToken = await plaidService.createLinkToken(clientUserId);
    res.json({ link_token: linkToken });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Secure static hosting - Express static naturally prevents directory traversal
app.use(express.static(path.join(__dirname, 'public')));

// Fallback for React Router (SPA)
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const server = http.createServer(app);

const wss = new WebSocketServer({ server });

// ─── Server-side heartbeat ────────────────────────────────────────────────────
// Every 25 seconds we ping all clients. If a client hasn't responded by the
// next ping cycle we terminate it, preventing zombie sockets from blocking
// reconnections or occupying player slots indefinitely.
const PING_INTERVAL_MS = 25_000;

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
});

const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      console.log('[Heartbeat] Terminating unresponsive socket');
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, PING_INTERVAL_MS);

wss.on('close', () => clearInterval(heartbeat));
// ─────────────────────────────────────────────────────────────────────────────

wss.on('connection', (ws, req) => {
  // A simple hack to parse query string from URL for initial connection
  const url = new URL(req.url, `http://${req.headers.host}`);
  const action = url.searchParams.get('action'); // 'host', 'join', or 'reconnect'
  const code = url.searchParams.get('code');       // required for 'join' and 'reconnect'
  const reconnectId = url.searchParams.get('reconnectId'); // required for 'reconnect'

  // Generate a random ID for the socket
  ws.id = Math.random().toString(36).substring(2, 15);

  try {
    if (action === 'host') {
      const room = gameManager.createRoom();
      room.addPlayer(ws, true);
      ws.send(JSON.stringify({ type: 'ROOM_CREATED', code: room.roomId }));
    } else if (action === 'join') {
      const room = gameManager.getRoom(code);
      if (room) {
        room.addPlayer(ws, false);
      } else {
        ws.send(JSON.stringify({ type: 'ERROR', message: 'Room not found' }));
        ws.close();
      }
    } else if (action === 'reconnect') {
      const room = gameManager.getRoom(code);
      if (room && reconnectId) {
        room.reconnectPlayer(ws, reconnectId);
      } else {
        ws.send(JSON.stringify({ type: 'ERROR', message: 'Room not found or invalid reconnect token' }));
        ws.close();
      }
    } else {
      ws.close();
    }
  } catch (err) {
    ws.send(JSON.stringify({ type: 'ERROR', message: err.message }));
    ws.close();
  }
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Band4Band backend running on port ${PORT}`);
});
