import { MockDexRouter } from '../dex/mockDexRouter';

describe('MockDexRouter', () => {
  const dex = new MockDexRouter();

  test('raydium quote structure and range', async () => {
    const q = await dex.getRaydiumQuote('A', 'B', 1000);
    expect(q.dex).toBe('raydium');
    expect(q.price).toBeGreaterThan(0);
    expect(q.fee).toBe(0.003);
  });

  test('meteora quote structure and range', async () => {
    const q = await dex.getMeteoraQuote('A', 'B', 1000);
    expect(q.dex).toBe('meteora');
    expect(q.price).toBeGreaterThan(0);
    expect(q.fee).toBe(0.002);
  });

  test('executeSwap returns txHash and price', async () => {
    const res = await dex.executeSwap('meteora', { });
    expect(typeof res.txHash).toBe('string');
    expect(typeof res.executedPrice).toBe('number');
  });
});
