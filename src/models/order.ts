export type OrderType = 'market';

export interface OrderRequest {
  type: OrderType;
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  slippage?: number; // fraction e.g., 0.01
}

export interface StoredOrder {
  id: string;
  status: string;
  created_at: string;
  updated_at?: string;
  last_error?: string | null;
}
