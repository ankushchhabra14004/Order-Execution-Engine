import WebSocket from 'ws';

const BASE_URL = process.env.API_URL || 'http://localhost:3000';
const WS_BASE = BASE_URL.replace('http', 'ws');
const NUM_ORDERS = parseInt(process.env.NUM_ORDERS || '3', 10);

async function submitOrder(index: number): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/orders/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'market',
      tokenIn: 'SOL',
      tokenOut: 'USDC',
      amountIn: 100 + Math.random() * 50
    })
  });
  const data = (await res.json()) as any;
  console.log(`[Order ${index}] ID: ${data.orderId}`);
  return data.orderId;
}

function listenWebSocket(orderId: string, index: number): Promise<void> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${WS_BASE}/api/orders/execute?orderId=${orderId}`);

    ws.on('open', () => {
      console.log(`[Order ${index}] WebSocket connected`);
    });

    ws.on('message', (data: string) => {
      try {
        const msg = JSON.parse(data);
        console.log(`[Order ${index}] ${msg.status || '?'} ${msg.chosen ? `(${msg.chosen})` : ''} ${msg.txHash ? `tx: ${msg.txHash.slice(0, 8)}...` : ''} ${msg.error ? `err: ${msg.error}` : ''}`);
        if (msg.status === 'confirmed' || msg.status === 'failed') {
          ws.close();
          resolve();
        }
      } catch (e) {
        // ignore parse errors
      }
    });

    ws.on('error', (err: any) => {
      console.error(`[Order ${index}] WS error:`, err?.message || String(err));
      resolve();
    });

    ws.on('close', () => {
      console.log(`[Order ${index}] WebSocket closed`);
      resolve();
    });

    // timeout after 30s
    setTimeout(() => {
      ws.close();
      resolve();
    }, 30000);
  });
}

async function main() {
  console.log(`\n🚀 Submitting ${NUM_ORDERS} orders...\n`);

  // submit all orders concurrently
  const orderIds = await Promise.all(
    Array.from({ length: NUM_ORDERS }, (_, i) => submitOrder(i + 1))
  );

  console.log(`\n📡 Listening to WebSocket updates...\n`);

  // listen to all WS streams concurrently
  await Promise.all(
    orderIds.map((id, i) => listenWebSocket(id, i + 1))
  );

  console.log(`\n✅ Demo complete\n`);
}

main().catch((err) => {
  console.error('Demo error:', err);
  process.exit(1);
});
