#!/usr/bin/env node

require('dotenv').config();

/**
 * Order Execution Engine - Backend Server
 * HTTP + WebSocket + BullMQ Queue + PostgreSQL + Redis
 * 
 * Architecture:
 * 1. HTTP POST → validate → enqueue to BullMQ
 * 2. Worker processes from queue (separate process)
 * 3. WebSocket receives real-time status updates
 * 4. PostgreSQL stores order history
 * 5. Redis caches active orders
 */

const http = require('http');
const url = require('url');
const crypto = require('crypto');
const { Queue } = require('bullmq');
const redis = require('./lib/redis-client');
const db = require('./lib/db-client');
const activeOrders = require('./lib/active-orders');

// ============ UTILITIES ============

function uuidv4() {
  return `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

// ============ BULLMQ QUEUE ============

const orderQueue = new Queue('order-queue', { connection: redis });

orderQueue.on('error', (err) => {
  console.error('❌ Queue error:', err.message);
});

// ============ WEBSOCKET CLIENTS ============

const wsClients = new Map();

// ============ HTTP SERVER ============

const PORT = parseInt(process.env.PORT || '3000', 10);

const server = http.createServer((req, res) => {
  // Enable CORS
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

  // ===== GET /api/orders - List orders =====
  if (pathname === '/api/orders' && req.method === 'GET') {
    const status = parsedUrl.query.status || 'pending';
    db.getOrdersByStatus(status, 50).then((orders) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ orders, count: orders.length }));
    });
    return;
  }

  // ===== GET /api/orders/:id - Get order details =====
  if (pathname.startsWith('/api/orders/') && pathname !== '/api/orders/execute' && req.method === 'GET') {
    const orderId = pathname.split('/')[3];
    db.getOrder(orderId).then((order) => {
      if (!order) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Order not found' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(order));
    });
    return;
  }

  // ===== GET /api/stats - System stats =====
  if (pathname === '/api/stats' && req.method === 'GET') {
    Promise.all([
      activeOrders.getActiveOrderCount(),
      orderQueue.getJobCounts('active'),
      orderQueue.getJobCounts('completed'),
      orderQueue.getJobCounts('failed'),
    ]).then(([activeCount, jobCounts, completed, failed]) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        activeOrders: activeCount,
        queuedJobs: jobCounts.active,
        completedJobs: completed.completed || 0,
        failedJobs: failed.failed || 0,
      }));
    });
    return;
  }

  // ===== POST /api/orders/execute - Submit order =====
  if (pathname === '/api/orders/execute' && req.method === 'POST') {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk.toString('utf8');
      if (body.length > 1e6) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload too large' }));
      }
    });

    req.on('end', async () => {
      try {
        const data = JSON.parse(body);

        if (!data || data.type !== 'market' || !data.tokenIn || !data.tokenOut || !data.amountIn) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid order. required: type=market, tokenIn, tokenOut, amountIn' }));
          return;
        }

        const orderId = uuidv4();
        const wsUrl = `ws://localhost:${PORT}/api/orders/execute?orderId=${orderId}`;
        const shortId = orderId.substring(0, 12);

        console.log(`\n📥 NEW ORDER [${shortId}]`);
        console.log(`   ${data.amountIn} ${data.tokenIn} → ${data.tokenOut}`);

        // Save to database
        await db.saveOrder(orderId, data);

        // Set in active orders cache
        await activeOrders.setActiveOrder(orderId, {
          type: data.type,
          tokenIn: data.tokenIn,
          tokenOut: data.tokenOut,
          amountIn: data.amountIn,
        });

        // Enqueue to BullMQ
        await orderQueue.add('order', data, {
          jobId: orderId,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 500,
          },
          removeOnComplete: true,
        });

        console.log(`   ✅ Enqueued to queue`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ orderId, wsUrl }));
      } catch (err) {
        console.error('❌ Order submission error:', err.message);
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

    const shortId = orderId.substring(0, 12);
    console.log(`🔌 WEBSOCKET CONNECTED [${shortId}]`);
    wsClients.set(orderId, send);

    socket.on('close', () => {
      console.log(`🔌 WEBSOCKET DISCONNECTED [${shortId}]`);
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

// ============ WEBSOCKET FRAME BUILDER ============

function createWebSocketFrame(payload) {
  const len = payload.length;
  let frame;

  if (len < 126) {
    frame = Buffer.alloc(len + 2);
    frame[0] = 0x81;
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

// ============ INITIALIZE & START ============

async function start() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║      🚀 Order Execution Engine - Backend Server 🚀            ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  // Initialize database
  await db.initDb();

  server.listen(PORT, '0.0.0.0', () => {
    console.log('📊 System Configuration:');
    console.log(`   ✓ HTTP Server: http://localhost:${PORT}`);
    console.log(`   ✓ WebSocket: ws://localhost:${PORT}`);
    console.log(`   ✓ Queue: BullMQ (Redis-backed)`);
    console.log(`   ✓ Database: PostgreSQL`);
    console.log(`   ✓ Cache: Redis (active orders)\n`);

    console.log('📋 API Endpoints:');
    console.log(`   POST   /api/orders/execute      - Submit market order`);
    console.log(`   GET    /api/orders              - List orders (status query param)`);
    console.log(`   GET    /api/orders/:id          - Get order details`);
    console.log(`   GET    /api/stats               - System statistics\n`);

    console.log('🔄 Order Lifecycle:');
    console.log('   1. pending → 2. routing → 3. building → 4. submitted → 5. confirmed\n');

    console.log('🎯 Ready to process orders!\n');
  });
}

start().catch((err) => {
  console.error('❌ Server startup failed:', err.message);
  process.exit(1);
});
