import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { MockDexRouter } from '../dex/mockDexRouter';
import { updateOrderStatus } from '../db';

const connection = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');

const concurrency = parseInt(process.env.CONCURRENT_WORKERS || '10', 10);

const dex = new MockDexRouter();

// In-memory map of websockets per orderId (populated in server)
export const wsClients: Map<string, (msg: any) => void> = new Map();

function defaultEmit(orderId: string, payload: any) {
  const sender = wsClients.get(orderId);
  if (sender) sender(payload);
}

export async function processOrder(data: any, orderId: string, emitFn: (id: string, p: any) => void = defaultEmit) {
  try {
    emitFn(orderId, { status: 'pending' });
    await updateOrderStatus(orderId, 'pending');

    emitFn(orderId, { status: 'routing' });
    const [r, m] = await Promise.all([
      dex.getRaydiumQuote(data.tokenIn, data.tokenOut, data.amountIn),
      dex.getMeteoraQuote(data.tokenIn, data.tokenOut, data.amountIn)
    ]);

    // Simple price comparator: choose lower price (better for buyer)
    const chosen = r.price <= m.price ? r : m;
    emitFn(orderId, { status: 'routing', chosen: chosen.dex, price: chosen.price });
    await updateOrderStatus(orderId, 'routing');

    emitFn(orderId, { status: 'building' });
    // simulate building
    await new Promise((s) => setTimeout(s, 200));
    await updateOrderStatus(orderId, 'building');

    emitFn(orderId, { status: 'submitted' });
    const exec = await dex.executeSwap(chosen.dex, data);
    await updateOrderStatus(orderId, 'submitted');

    emitFn(orderId, { status: 'confirmed', txHash: exec.txHash, executedPrice: exec.executedPrice });
    await updateOrderStatus(orderId, 'confirmed');

    return { txHash: exec.txHash };
  } catch (err: any) {
    const reason = err?.message || String(err);
    emitFn(orderId, { status: 'failed', error: reason });
    await updateOrderStatus(orderId, 'failed', reason);
    throw err;
  }
}

export const worker = (process.env.NODE_ENV === 'test')
  ? null
  : new Worker(
      process.env.QUEUE_NAME || 'orders',
      async (job: Job) => processOrder(job.data, job.id as string),
      { connection, concurrency }
    );
