/**
 * Redis Client Initialization
 * Used for: BullMQ queue backend, active orders cache
 */

const redis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

console.log(`📍 Connecting to Redis: ${REDIS_URL}`);
const redisClient = new redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

redisClient.on('error', (err) => {
  console.error('❌ Redis connection error:', err.message);
});

redisClient.on('connect', () => {
  console.log('✅ Redis connected');
});

module.exports = redisClient;
