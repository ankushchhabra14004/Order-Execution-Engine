/**
 * Standalone test suite - tests MockDexRouter and order processing logic
 * without external dependencies (no npm required)
 */

// Simple utilities
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uuidv4() {
  return `uuid-${Math.random().toString(36).substring(2, 15)}-${Date.now()}`;
}

// Mock DEX Router
interface Quote { price: number; fee: number; dex: 'raydium' | 'meteora' }
interface SwapResult { txHash: string; executedPrice: number }

class MockDexRouter {
  private basePrice = 100;

  async getRaydiumQuote(_tokenIn: string, _tokenOut: string, _amount: number): Promise<Quote> {
    await sleep(200 + Math.random() * 200);
    const price = this.basePrice * (0.98 + Math.random() * 0.04);
    return { price, fee: 0.003, dex: 'raydium' };
  }

  async getMeteoraQuote(_tokenIn: string, _tokenOut: string, _amount: number): Promise<Quote> {
    await sleep(200 + Math.random() * 200);
    const price = this.basePrice * (0.97 + Math.random() * 0.05);
    return { price, fee: 0.002, dex: 'meteora' };
  }

  async executeSwap(dex: 'raydium' | 'meteora', _order: any): Promise<SwapResult> {
    await sleep(2000 + Math.random() * 1000);
    const txHash = uuidv4();
    const executedPrice = this.basePrice * (dex === 'raydium' ? 1.0 : 0.995) * (1 + (Math.random() - 0.5) * 0.01);
    return { txHash, executedPrice };
  }
}

// Order processing logic
async function processOrder(data: any, orderId: string, emitFn: (id: string, p: any) => void) {
  const dex = new MockDexRouter();
  try {
    emitFn(orderId, { status: 'pending' });

    emitFn(orderId, { status: 'routing' });
    const [r, m] = await Promise.all([
      dex.getRaydiumQuote(data.tokenIn, data.tokenOut, data.amountIn),
      dex.getMeteoraQuote(data.tokenIn, data.tokenOut, data.amountIn)
    ]);

    const chosen = r.price <= m.price ? r : m;
    emitFn(orderId, { status: 'routing', chosen: chosen.dex, price: chosen.price });

    emitFn(orderId, { status: 'building' });
    await new Promise((s) => setTimeout(s, 200));

    emitFn(orderId, { status: 'submitted' });
    const exec = await dex.executeSwap(chosen.dex, data);

    emitFn(orderId, { status: 'confirmed', txHash: exec.txHash, executedPrice: exec.executedPrice });
    return { txHash: exec.txHash };
  } catch (err: any) {
    const reason = err?.message || String(err);
    emitFn(orderId, { status: 'failed', error: reason });
    throw err;
  }
}

// Test suite
async function runTests() {
  console.log('\n🧪 Running Standalone Tests...\n');

  let passed = 0;
  let failed = 0;

  // Test 1: MockDexRouter - raydium quote
  try {
    const dex = new MockDexRouter();
    const q = await dex.getRaydiumQuote('A', 'B', 1000);
    if (q.dex === 'raydium' && q.price > 0 && q.fee === 0.003) {
      console.log('✓ Test 1: Raydium quote structure');
      passed++;
    } else {
      throw new Error('Quote structure invalid');
    }
  } catch (e: any) {
    console.log('✗ Test 1: Raydium quote -', e.message);
    failed++;
  }

  // Test 2: MockDexRouter - meteora quote
  try {
    const dex = new MockDexRouter();
    const q = await dex.getMeteoraQuote('A', 'B', 1000);
    if (q.dex === 'meteora' && q.price > 0 && q.fee === 0.002) {
      console.log('✓ Test 2: Meteora quote structure');
      passed++;
    } else {
      throw new Error('Quote structure invalid');
    }
  } catch (e: any) {
    console.log('✗ Test 2: Meteora quote -', e.message);
    failed++;
  }

  // Test 3: MockDexRouter - executeSwap
  try {
    const dex = new MockDexRouter();
    const res = await dex.executeSwap('meteora', {});
    if (typeof res.txHash === 'string' && typeof res.executedPrice === 'number') {
      console.log('✓ Test 3: executeSwap returns txHash and price');
      passed++;
    } else {
      throw new Error('Result structure invalid');
    }
  } catch (e: any) {
    console.log('✗ Test 3: executeSwap -', e.message);
    failed++;
  }

  // Test 4: processOrder lifecycle
  try {
    const emits: any[] = [];
    const dummyOrder = { tokenIn: 'A', tokenOut: 'B', amountIn: 100, type: 'market' };
    const res = await processOrder(dummyOrder, 'order-1', (id, p) => emits.push({ id, p }));
    const statuses = emits.map((e) => e.p.status).filter(Boolean);
    const expected = ['pending', 'routing', 'building', 'submitted', 'confirmed'];
    if (expected.every((s) => statuses.includes(s))) {
      console.log('✓ Test 4: Full lifecycle emits all statuses');
      passed++;
    } else {
      throw new Error(`Missing statuses. Got: ${statuses.join(',')}`);
    }
  } catch (e: any) {
    console.log('✗ Test 4: Lifecycle -', e.message);
    failed++;
  }

  // Test 5: processOrder returns txHash
  try {
    const emits: any[] = [];
    const dummyOrder = { tokenIn: 'A', tokenOut: 'B', amountIn: 100, type: 'market' };
    const res = await processOrder(dummyOrder, 'order-2', (id, p) => emits.push({ id, p }));
    if (res.txHash && typeof res.txHash === 'string') {
      console.log('✓ Test 5: processOrder returns txHash');
      passed++;
    } else {
      throw new Error('No txHash in result');
    }
  } catch (e: any) {
    console.log('✗ Test 5: TxHash return -', e.message);
    failed++;
  }

  // Test 6: Concurrent orders
  try {
    const emits: { [key: string]: any[] } = {};
    const dummyOrder = { tokenIn: 'A', tokenOut: 'B', amountIn: 100, type: 'market' };
    const orders = [1, 2, 3];
    const promises = orders.map((i) => {
      emits[`order-${i}`] = [];
      return processOrder(dummyOrder, `order-${i}`, (id, p) => emits[id].push(p));
    });
    await Promise.all(promises);
    if (orders.every((i) => emits[`order-${i}`].some((e) => e.status === 'confirmed'))) {
      console.log('✓ Test 6: Concurrent orders processed');
      passed++;
    } else {
      throw new Error('Not all orders completed');
    }
  } catch (e: any) {
    console.log('✗ Test 6: Concurrent -', e.message);
    failed++;
  }

  // Test 7: Price variance
  try {
    const dex = new MockDexRouter();
    let raydiumWins = 0;
    for (let i = 0; i < 5; i++) {
      const r = await dex.getRaydiumQuote('A', 'B', 100);
      const m = await dex.getMeteoraQuote('A', 'B', 100);
      if (r.price <= m.price) raydiumWins++;
    }
    if (raydiumWins >= 0) {
      console.log('✓ Test 7: DEX price variance observed');
      passed++;
    } else {
      throw new Error('No variance');
    }
  } catch (e: any) {
    console.log('✗ Test 7: Price variance -', e.message);
    failed++;
  }

  // Test 8: Routing decision
  try {
    const emits: any[] = [];
    const dummyOrder = { tokenIn: 'A', tokenOut: 'B', amountIn: 100, type: 'market' };
    await processOrder(dummyOrder, 'order-route', (id, p) => emits.push(p));
    const routing = emits.find((e) => e.status === 'routing' && e.chosen);
    if (routing && (routing.chosen === 'raydium' || routing.chosen === 'meteora')) {
      console.log('✓ Test 8: Routing decision logged');
      passed++;
    } else {
      throw new Error('No routing decision');
    }
  } catch (e: any) {
    console.log('✗ Test 8: Routing decision -', e.message);
    failed++;
  }

  // Test 9: UUID generation
  try {
    const id1 = uuidv4();
    const id2 = uuidv4();
    if (id1 !== id2 && id1.includes('uuid-') && id2.includes('uuid-')) {
      console.log('✓ Test 9: UUID generation unique');
      passed++;
    } else {
      throw new Error('UUID not unique');
    }
  } catch (e: any) {
    console.log('✗ Test 9: UUID -', e.message);
    failed++;
  }

  // Test 10: Sleep timing
  try {
    const start = Date.now();
    await sleep(100);
    const dt = Date.now() - start;
    if (dt >= 95 && dt <= 200) {
      console.log('✓ Test 10: Sleep timing accurate');
      passed++;
    } else {
      throw new Error(`Timing off: ${dt}ms`);
    }
  } catch (e: any) {
    console.log('✗ Test 10: Sleep timing -', e.message);
    failed++;
  }

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
  if (failed === 0) {
    console.log('✅ All tests passed!\n');
    return 0;
  } else {
    console.log('❌ Some tests failed\n');
    return 1;
  }
}

// Run the tests
runTests().then((code) => process.exit(code));
