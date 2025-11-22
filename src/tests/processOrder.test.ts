import { processOrder, wsClients } from '../workers/orderWorker';
import * as db from '../db';
import { MockDexRouter } from '../dex/mockDexRouter';

jest.mock('../db', () => ({
  updateOrderStatus: jest.fn().mockResolvedValue(undefined),
  saveOrder: jest.fn().mockResolvedValue(undefined),
  initDb: jest.fn().mockResolvedValue(undefined)
}));

describe('processOrder lifecycle', () => {
  const dummyOrder = { tokenIn: 'A', tokenOut: 'B', amountIn: 100, type: 'market' };

  test('emits full lifecycle and returns txHash', async () => {
    const emits: any[] = [];
    const emitFn = (id: string, p: any) => emits.push({ id, p });

    const res = await processOrder(dummyOrder, 'order-1', emitFn);
    expect(res.txHash).toBeDefined();

    const statuses = emits.map((e) => e.p.status).filter(Boolean);
    expect(statuses).toEqual(expect.arrayContaining(['pending', 'routing', 'building', 'submitted', 'confirmed']));
  });

  test('chooses between dex correctly (meteora cheaper)', async () => {
    // monkey-patch internal MockDexRouter methods used in worker
    const workerModule = await import('../workers/orderWorker');
    // force getRaydiumQuote to be expensive, meteora cheap
    const dexPath = '../dex/mockDexRouter';
    const mocked = await import(dexPath);
    jest.spyOn(mocked.MockDexRouter.prototype, 'getRaydiumQuote').mockImplementation(async () => ({ price: 120, fee: 0.003, dex: 'raydium' } as any));
    jest.spyOn(mocked.MockDexRouter.prototype, 'getMeteoraQuote').mockImplementation(async () => ({ price: 100, fee: 0.002, dex: 'meteora' } as any));

    const emits: any[] = [];
    const emitFn = (id: string, p: any) => emits.push(p);

    const res = await workerModule.processOrder(dummyOrder, 'order-2', emitFn);
    expect(res.txHash).toBeDefined();
    const routingEvent = emits.find((e) => e.status === 'routing' && e.chosen);
    expect(routingEvent.chosen).toBe('meteora');
  });

  test('handles execution failure and emits failed', async () => {
    const mocked = await import('../dex/mockDexRouter');
    jest.spyOn(mocked.MockDexRouter.prototype, 'getRaydiumQuote').mockImplementation(async () => ({ price: 100, fee: 0.003, dex: 'raydium' } as any));
    jest.spyOn(mocked.MockDexRouter.prototype, 'getMeteoraQuote').mockImplementation(async () => ({ price: 101, fee: 0.002, dex: 'meteora' } as any));
    jest.spyOn(mocked.MockDexRouter.prototype, 'executeSwap').mockImplementation(async () => { throw new Error('swap failed'); });

    const emits: any[] = [];
    const emitFn = (id: string, p: any) => emits.push(p);

    await expect(processOrder(dummyOrder, 'order-3', emitFn)).rejects.toThrow('swap failed');
    const failed = emits.find((e) => e.status === 'failed');
    expect(failed).toBeDefined();
    expect(failed.error).toMatch(/swap failed/);
  });

  test('defaultEmit writes to wsClients map', async () => {
    const messages: any[] = [];
    wsClients.set('order-test', (p) => messages.push(p));

    // use real router for this one
    await processOrder(dummyOrder, 'order-test');
    expect(messages.some((m) => m.status === 'confirmed')).toBe(true);
    wsClients.delete('order-test');
  });
});
