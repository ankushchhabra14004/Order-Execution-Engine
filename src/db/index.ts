import { Pool } from 'pg';

const conn = process.env.PG_CONN || 'postgresql://user:password@localhost:5432/orders';

export const pool = new Pool({ connectionString: conn });

export async function initDb() {
  // Simple table for orders
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      payload JSONB,
      status TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP,
      last_error TEXT
    );
  `);
}

export async function saveOrder(id: string, payload: any, status = 'pending') {
  await pool.query(
    `INSERT INTO orders(id, payload, status, created_at) VALUES($1,$2,$3,NOW()) ON CONFLICT (id) DO UPDATE SET payload = $2, status = $3, updated_at = NOW()`,
    [id, payload, status]
  );
}

export async function updateOrderStatus(id: string, status: string, lastError?: string) {
  await pool.query(
    `UPDATE orders SET status=$2, updated_at=NOW(), last_error=$3 WHERE id=$1`,
    [id, status, lastError || null]
  );
}
