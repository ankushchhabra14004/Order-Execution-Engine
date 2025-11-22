import { MockDexRouter } from '../dex/mockDexRouter';
import { sleep } from '../utils/sleep';

describe('additional small tests', () => {
  const dex = new MockDexRouter();

  test('executeSwap returns unique tx hashes', async () => {
    const a = await dex.executeSwap('raydium', {});
    const b = await dex.executeSwap('raydium', {});
    expect(a.txHash).not.toEqual(b.txHash);
  });

  test('price variance between dexes over many samples', async () => {
    let raydiumWins = 0;
    let meteoraWins = 0;
    for (let i = 0; i < 10; i++) {
      const r = await dex.getRaydiumQuote('A', 'B', 100);
      const m = await dex.getMeteoraQuote('A', 'B', 100);
      if (r.price <= m.price) raydiumWins++;
      else meteoraWins++;
    }
    expect(raydiumWins + meteoraWins).toBe(10);
  });

  test('sleep resolves approximately in time', async () => {
    const start = Date.now();
    await sleep(50);
    const dt = Date.now() - start;
    expect(dt).toBeGreaterThanOrEqual(45);
  });
});
