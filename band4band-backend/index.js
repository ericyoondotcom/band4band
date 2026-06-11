import 'dotenv/config';
import { WebSocketServer } from 'ws';
import http from 'http';
import plaidService from './helpers/PlaidService.js';
import gameManager from './helpers/GameManager.js';

const server = http.createServer((req, res) => {
  // Add a simple route to generate Plaid link tokens based on client_user_id
  if (req.method === 'POST' && req.url === '/create_link_token') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const { clientUserId } = JSON.parse(body);
        const linkToken = await plaidService.createLinkToken(clientUserId);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ link_token: linkToken }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  } else if (req.method === 'OPTIONS') {
    // Handle preflight for CORS
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'OPTIONS, POST',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
  } else {
    res.writeHead(404);
    res.end();
  }
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  // A simple hack to parse query string from URL for initial connection
  const url = new URL(req.url, `http://${req.headers.host}`);
  const action = url.searchParams.get('action'); // 'host' or 'join'
  const code = url.searchParams.get('code'); // required for 'join'

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
