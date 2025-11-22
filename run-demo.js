#!/usr/bin/env node

/**
 * Order Execution Engine - Standalone Runner
 * Simulates order submission and execution with real-time status updates
 * No external dependencies required
 */

// ============ UTILITIES ============
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uuidv4() {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
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
async function processOrder(data, orderId, emitFn) {
  const dex = new MockDexRouter();
  try {
    emitFn(orderId, { status: 'pending' });

    emitFn(orderId, { status: 'routing' });
    const [r, m] = await Promise.all([
      dex.getRaydiumQuote(data.tokenIn, data.tokenOut, data.amountIn),
      dex.getMeteoraQuote(data.tokenIn, data.tokenOut, data.amountIn)
    ]);

    const chosen = r.price <= m.price ? r : m;
    emitFn(orderId, { status: 'routing', chosen: chosen.dex, price: chosen.price.toFixed(2) });

    emitFn(orderId, { status: 'building' });
    await new Promise((s) => setTimeout(s, 200));

    emitFn(orderId, { status: 'submitted' });
    const exec = await dex.executeSwap(chosen.dex, data);

    emitFn(orderId, { status: 'confirmed', txHash: exec.txHash.slice(0, 16) + '...', executedPrice: exec.executedPrice.toFixed(2) });
    return { txHash: exec.txHash };
  } catch (err) {
    const reason = err?.message || String(err);
    emitFn(orderId, { status: 'failed', error: reason });
    throw err;
  }
}

// ============ DEMO ============
async function runDemo() {
  const NUM_ORDERS = parseInt(process.env.NUM_ORDERS || '3', 10);

  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║         Order Execution Engine - Live Demo                     ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  console.log(`📊 Submitting ${NUM_ORDERS} market orders concurrently...\n`);

  // Create orders with unique IDs
  const orders = Array.from({ length: NUM_ORDERS }, (_, i) => ({
    id: uuidv4(),
    data: {
      type: 'market',
      tokenIn: 'SOL',
      tokenOut: 'USDC',
      amountIn: 100 + Math.random() * 50
    },
    index: i + 1
  }));

  // Track updates per order
  const updates = {};
  orders.forEach((o) => {
    updates[o.id] = [];
  });

  // Emit function - logs updates
  const emitFn = (orderId, payload) => {
    if (!updates[orderId]) updates[orderId] = [];
    updates[orderId].push(payload);
    const order = orders.find((o) => o.id === orderId);
    if (order) {
      const status = payload.status || '?';
      let msg = `[Order ${order.index}] ${status}`;
      if (payload.chosen) msg += ` → ${payload.chosen}`;
      if (payload.price) msg += ` @ ${payload.price}`;
      if (payload.txHash) msg += ` | tx: ${payload.txHash}`;
      if (payload.executedPrice) msg += ` | final: ${payload.executedPrice}`;
      if (payload.error) msg += ` | ❌ ${payload.error}`;
      console.log(msg);
    }
  };

  console.log('🚀 Processing orders...\n');

  // Process all orders concurrently
  const startTime = Date.now();
  try {
    await Promise.all(
      orders.map((order) => processOrder(order.data, order.id, emitFn))
    );
  } catch (err) {
    // errors are already logged via emitFn
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  // Summary
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                    Execution Summary                           ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  let confirmed = 0;
  let failed = 0;

  orders.forEach((order) => {
    const orderUpdates = updates[order.id];
    const final = orderUpdates[orderUpdates.length - 1];
    const status = final?.status || '?';
    if (status === 'confirmed') confirmed++;
    if (status === 'failed') failed++;

    const routingUpdate = orderUpdates.find((u) => u.status === 'routing' && u.chosen);
    const dex = routingUpdate?.chosen || '?';

    console.log(`Order ${order.index}: ${status.toUpperCase()} | DEX: ${dex} | ${order.data.amountIn.toFixed(2)} SOL`);
  });

  console.log(`\n⏱️  Total Time: ${duration}s`);
  console.log(`✅ Confirmed: ${confirmed}/${NUM_ORDERS}`);
  console.log(`❌ Failed: ${failed}/${NUM_ORDERS}`);
  console.log('\n');
}

// Run the demo
runDemo().catch((err) => {
  console.error('Demo error:', err);
  process.exit(1);
});
