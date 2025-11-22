import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const connection = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');

export const orderQueue = new Queue(process.env.QUEUE_NAME || 'orders', { connection });

export function addOrder(jobId: string, payload: any) {
  return orderQueue.add(jobId, payload, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 500 },
    removeOnComplete: true,
    removeOnFail: false
  });
}
