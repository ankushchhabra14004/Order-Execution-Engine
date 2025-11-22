import Fastify from 'fastify';
import websocketPlugin from '@fastify/websocket';
import { v4 as uuidv4 } from 'uuid';
import { addOrder } from './queue/orderQueue';
import { initDb, saveOrder } from './db';
import { wsClients } from './workers/orderWorker';
import { OrderRequest } from './models/order';

const PORT = parseInt(process.env.PORT || '3000', 10);

const fastify = Fastify({ logger: true });
fastify.register(websocketPlugin);

// Initialize DB (best-effort)
initDb().catch((e) => fastify.log.warn('DB init failed', e.message));

// Websocket route (same path serves POST and WS - client may connect ws:// to this path)
fastify.get(
  '/api/orders/execute',
  { websocket: true },
  (connection: any /* SocketStream */, req: any) => {
    // Expect clients to connect with query ?orderId=...
    const orderId = req.query.orderId as string | undefined;
    if (!orderId) {
      connection.socket.send(JSON.stringify({ error: 'orderId is required as query param' }));
      connection.socket.close();
      return;
    }

    // Register a simple sender function per orderId
    const send = (payload: any) => {
      try {
        connection.socket.send(JSON.stringify(payload));
      } catch (e) {
        // ignore
      }
    };
    wsClients.set(orderId, send);

    connection.socket.on('close', () => {
      wsClients.delete(orderId);
    });
  }
);

// POST handler that accepts order and returns orderId and ws URL
fastify.post('/api/orders/execute', async (request, reply) => {
  const body = request.body as Partial<OrderRequest>;
  // Validate minimal fields for a market order
  if (!body || body.type !== 'market' || !body.tokenIn || !body.tokenOut || !body.amountIn) {
    return reply.status(400).send({ error: 'invalid order. required: type=market, tokenIn, tokenOut, amountIn' });
  }

  const orderId = uuidv4();
  // persist order
  await saveOrder(orderId, body, 'queued');
  // push to queue
  await addOrder(orderId, body);

  // Return orderId and websocket URL to watch status. Note: client should open ws to same path using ?orderId=...
  const wsUrl = `ws://localhost:${PORT}/api/orders/execute?orderId=${orderId}`;
  return reply.send({ orderId, wsUrl });
});

const start = async () => {
  try {
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    fastify.log.info(`Server listening on ${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
