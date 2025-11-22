import { sleep } from '../utils/sleep';
import { v4 as uuidv4 } from 'uuid';

export interface Quote { price: number; fee: number; dex: 'raydium' | 'meteora' }
export interface SwapResult { txHash: string; executedPrice: number }

export class MockDexRouter {
  // Simulate basePrice per token pair - in a real app this is from on-chain or market data.
  private basePrice = 100; // arbitrary

  async getRaydiumQuote(_tokenIn: string, _tokenOut: string, _amount: number): Promise<Quote> {
    await sleep(200 + Math.random() * 200);
    const price = this.basePrice * (0.98 + Math.random() * 0.04); // ±2%
    return { price, fee: 0.003, dex: 'raydium' };
  }

  async getMeteoraQuote(_tokenIn: string, _tokenOut: string, _amount: number): Promise<Quote> {
    await sleep(200 + Math.random() * 200);
    const price = this.basePrice * (0.97 + Math.random() * 0.05); // ±3-5%
    return { price, fee: 0.002, dex: 'meteora' };
  }

  async executeSwap(dex: 'raydium' | 'meteora', _order: any): Promise<SwapResult> {
    // Simulate execution delay (2-3s)
    await sleep(2000 + Math.random() * 1000);
    const txHash = uuidv4();
    // Simulate final price slightly adjusted for slippage
    const executedPrice = this.basePrice * (dex === 'raydium' ? 1.0 : 0.995) * (1 + (Math.random() - 0.5) * 0.01);
    return { txHash, executedPrice };
  }
}
