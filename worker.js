#!/usr/bin/env node

require('dotenv').config();

/**
 * Order Processing Worker
 * Consumes from BullMQ queue and processes orders with full lifecycle
 * Handles DEX routing, execution, and persistence
 */

const { Worker } = require('bullmq');
const redis = require('./lib/redis-client');
const db = require('./lib/db-client');
const activeOrders = require('./lib/active-orders');

// DEX Router (reuse from server)
const http = require('http');
const crypto = require('crypto');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
    const txHash = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const executedPrice = this.basePrice * (dex === 'raydium' ? 1.0 : 0.995) * (1 + (Math.random() - 0.5) * 0.01);
    return { txHash, executedPrice };
  }
}

/**
 * Emit status update (send via HTTP to server)
 */
async function emitStatus(orderId, status, details = {}) {
  // Update active orders cache (Redis)
  try {
    await activeOrders.updateActiveOrderStatus(orderId, status, details);
  } catch (err) {
    console.warn(`  ⚠️  Redis cache error: ${err.message}`);
  }
  
  // Update database (PostgreSQL) - gracefully handle failures
  try {
    await db.updateOrderStatus(orderId, status, details);
  } catch (err) {
    console.warn(`  ⚠️  Database save skipped (unreachable): ${err.message}`);
    // Don't fail the order processing if DB is unreachable
  }
  
  console.log(`  📡 [${orderId.substring(0, 12)}] Status: ${status.toUpperCase()}`);
  if (details.dex) console.log(`     └─ DEX: ${details.dex}`);
  if (details.price) console.log(`     └─ Quote: $${details.price}`);
  if (details.executedPrice) console.log(`     └─ Executed: $${details.executedPrice}`);
}

/**
 * Process a single order job
 */
async function processOrder(job) {
  const { data } = job;
  const orderId = job.id;
  const shortId = orderId.substring(0, 12);

  console.log(`\n${'═'.repeat(80)}`);
  console.log(`📋 PROCESSING ORDER [${shortId}]`);
  console.log(`${'═'.repeat(80)}`);
  console.log(`  💱 ${data.amountIn} ${data.tokenIn} → ${data.tokenOut}`);

  const dex = new MockDexRouter();

  try {
    // Stage 1: Pending
    await emitStatus(orderId, 'pending');
    await job.updateProgress(20);

    // Stage 2: Routing
    console.log(`\n🔀 ROUTING (fetching quotes...)`);
    const [r, m] = await Promise.all([
      (async () => {
        console.log(`  └─ Querying Raydium...`);
        return dex.getRaydiumQuote(data.tokenIn, data.tokenOut, data.amountIn);
      })(),
      (async () => {
        console.log(`  └─ Querying Meteora...`);
        return dex.getMeteoraQuote(data.tokenIn, data.tokenOut, data.amountIn);
      })(),
    ]);

    console.log(`     ✓ Raydium: $${r.price.toFixed(2)}`);
    console.log(`     ✓ Meteora: $${m.price.toFixed(2)}`);

    const chosen = r.price <= m.price ? r : m;
    const other = r.price <= m.price ? m : r;
    console.log(`\n📊 DECISION: Selected ${chosen.dex.toUpperCase()} @ $${chosen.price.toFixed(2)}`);
    console.log(`   (vs ${other.dex.toUpperCase()} @ $${other.price.toFixed(2)})`);

    await emitStatus(orderId, 'routing', {
      dex: chosen.dex,
      price: chosen.price.toFixed(2),
    });
    await job.updateProgress(40);

    // Stage 3: Building
    console.log(`\n🔨 BUILDING transaction...`);
    await sleep(200);
    await emitStatus(orderId, 'building');
    await job.updateProgress(60);

    // Stage 4: Submitted
    console.log(`\n🚀 SUBMITTED to ${chosen.dex}...`);
    const exec = await dex.executeSwap(chosen.dex, data);
    await emitStatus(orderId, 'submitted', {
      txHash: exec.txHash.substring(0, 24) + '...',
    });
    await job.updateProgress(80);

    // Stage 5: Confirmed
    console.log(`\n✅ CONFIRMED`);
    console.log(`   TX: ${exec.txHash.substring(0, 24)}...`);
    console.log(`   Executed: $${exec.executedPrice.toFixed(2)}`);

    await emitStatus(orderId, 'confirmed', {
      txHash: exec.txHash,
      executedPrice: exec.executedPrice.toFixed(2),
    });
    
    // Remove from active orders
    await activeOrders.removeActiveOrder(orderId);
    await job.updateProgress(100);

    console.log(`\n${'═'.repeat(80)}\n`);
    return { success: true, txHash: exec.txHash };
  } catch (err) {
    console.log(`\n❌ FAILED: ${err.message}`);
    console.log(`${'═'.repeat(80)}\n`);

    await emitStatus(orderId, 'failed', {
      error: err.message,
    });
    try {
      await db.recordOrderError(orderId, err.message);
    } catch (dbErr) {
      console.warn(`  ⚠️  Could not record error to DB: ${dbErr.message}`);
    }
    
    try {
      await activeOrders.removeActiveOrder(orderId);
    } catch (redisErr) {
      console.warn(`  ⚠️  Could not remove from cache: ${redisErr.message}`);
    }

    throw err; // Re-throw for BullMQ retry logic
  }
}

/**
 * Start the worker
 */
async function startWorker() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║      🛠️  Order Processing Worker Started                       ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  // Initialize database
  await db.initDb();

  // Create worker with concurrency=10
  const worker = new Worker('order-queue', processOrder, {
    connection: redis,
    concurrency: 10,
  });

  worker.on('completed', (job) => {
    console.log(`✅ Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`❌ Job ${job.id} failed after retries: ${err.message}`);
  });

  worker.on('error', (err) => {
    console.error(`❌ Worker error: ${err.message}`);
  });

  console.log('📊 Configuration:');
  console.log('   ✓ Queue: order-queue');
  console.log('   ✓ Concurrency: 10');
  console.log('   ✓ Retries: 3 attempts');
  console.log('   ✓ Backoff: exponential (500ms)');
  console.log('   ✓ Database: PostgreSQL');
  console.log('   ✓ Cache: Redis (active orders)\n');
  console.log('🎯 Ready to process orders!\n');
}

startWorker().catch((err) => {
  console.error('❌ Worker startup failed:', err.message);
  process.exit(1);
});
