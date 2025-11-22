#!/usr/bin/env node

/**
 * Standalone Order Execution Backend Server
 * HTTP + WebSocket support without npm dependencies
 * Processes market orders with DEX routing
 */

const http = require('http');
const url = require('url');
const crypto = require('crypto');

// ============ UTILITIES ============
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uuidv4() {
  return `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

// ============ MOCK DEX ROUTER ============
class MockDexRouter {
  constructor() {
    this.basePrice = 100;
  }

  async getRaydiumQuote(tokenIn, tokenOut, amount) {
    await sleep(200 + Math.random() * 200);
    const price = this.basePrice * (0.98 + Math.random() * 0.04);
    return { price, fee: 0.003, dex: 'raydium' };
  }

  async getMeteoraQuote(tokenIn, tokenOut, amount) {
    await sleep(200 + Math.random() * 200);
    const price = this.basePrice * (0.97 + Math.random() * 0.05);
    return { price, fee: 0.002, dex: 'meteora' };
  }

  async executeSwap(dex, order) {
    await sleep(2000 + Math.random() * 1000);
    const txHash = uuidv4();
    const executedPrice = this.basePrice * (dex === 'raydium' ? 1.0 : 0.995) * (1 + (Math.random() - 0.5) * 0.01);
    return { txHash, executedPrice };
  }
}

// ============ ORDER PROCESSOR ============
const wsClients = new Map();

async function processOrder(data, orderId) {
  const dex = new MockDexRouter();

  function emit(payload) {
    const sender = wsClients.get(orderId);
    if (sender) {
      try {
        sender(JSON.stringify(payload));
      } catch (e) {
        // ignore
      }
    }
  }

  try {
    emit({ status: 'pending' });

    emit({ status: 'routing' });
    const [r, m] = await Promise.all([
      dex.getRaydiumQuote(data.tokenIn, data.tokenOut, data.amountIn),
      dex.getMeteoraQuote(data.tokenIn, data.tokenOut, data.amountIn)
    ]);

    const chosen = r.price <= m.price ? r : m;
    emit({ status: 'routing', chosen: chosen.dex, price: chosen.price.toFixed(2) });

    emit({ status: 'building' });
    await sleep(200);

    emit({ status: 'submitted' });
    const exec = await dex.executeSwap(chosen.dex, data);

    emit({ status: 'confirmed', txHash: exec.txHash.slice(0, 16) + '...', executedPrice: exec.executedPrice.toFixed(2) });
    return { txHash: exec.txHash };
  } catch (err) {
    const reason = err?.message || String(err);
    emit({ status: 'failed', error: reason });
    throw err;
  }
}

// ============ HTTP SERVER ============
const PORT = parseInt(process.env.PORT || '3000', 10);
const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const query = parsedUrl.query;

  // POST /api/orders/execute - submit order
  if (pathname === '/api/orders/execute' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString('utf8');
      if (body.length > 1e6) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload too large' }));
      }
    });

    req.on('end', () => {
      try {
        const data = JSON.parse(body);

        // Validate
        if (!data || data.type !== 'market' || !data.tokenIn || !data.tokenOut || !data.amountIn) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid order. required: type=market, tokenIn, tokenOut, amountIn' }));
          return;
        }

        const orderId = uuidv4();
        const wsUrl = `ws://localhost:${PORT}/api/orders/execute?orderId=${orderId}`;

        // Start processing order asynchronously
        processOrder(data, orderId).catch((e) => {
          console.error(`[${orderId}] Error:`, e.message);
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ orderId, wsUrl }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // Fallback 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

// ============ WEBSOCKET HANDLER ============
server.on('upgrade', (req, socket, head) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const query = parsedUrl.query;

  if (pathname === '/api/orders/execute') {
    const orderId = query.orderId;
    if (!orderId) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    // Upgrade to WebSocket
    const key = req.headers['sec-websocket-key'];
    const hash = crypto
      .createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');

    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${hash}\r\n` +
      '\r\n'
    );

    const send = (msg) => {
      try {
        const buf = Buffer.from(msg);
        const frame = createWebSocketFrame(buf);
        socket.write(frame);
      } catch (e) {
        // ignore
      }
    };

    wsClients.set(orderId, send);

    socket.on('close', () => {
      wsClients.delete(orderId);
    });

    socket.on('error', () => {
      wsClients.delete(orderId);
    });
  } else {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
  }
});

// Helper: create WebSocket frame
function createWebSocketFrame(payload) {
  const len = payload.length;
  let frame;

  if (len < 126) {
    frame = Buffer.alloc(len + 2);
    frame[0] = 0x81; // FIN + text frame
    frame[1] = len;
    payload.copy(frame, 2);
  } else if (len < 65536) {
    frame = Buffer.alloc(len + 4);
    frame[0] = 0x81;
    frame[1] = 126;
    frame.writeUInt16BE(len, 2);
    payload.copy(frame, 4);
  } else {
    frame = Buffer.alloc(len + 10);
    frame[0] = 0x81;
    frame[1] = 127;
    frame.writeBigUInt64BE(BigInt(len), 2);
    payload.copy(frame, 10);
  }

  return frame;
}

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║         Order Execution Engine - Backend Server                ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');
  console.log(`✅ Server listening on http://localhost:${PORT}`);
  console.log(`📍 API: POST http://localhost:${PORT}/api/orders/execute`);
  console.log(`🔌 WebSocket: ws://localhost:${PORT}/api/orders/execute?orderId=<id>\n`);
});

server.on('error', (err) => {
  console.error('Server error:', err);
  process.exit(1);
});
