/**
 * PostgreSQL Client & Order Persistence
 * Stores order history, status updates, and execution details
 */

const postgres = require('pg');

const PG_CONN = process.env.PG_CONN || 'postgresql://user:password@localhost:5432/orders_db';

console.log(`📍 Connecting to PostgreSQL...`);
const pool = new postgres.Pool({
  connectionString: PG_CONN,
  ssl: {
    rejectUnauthorized: false,
  },
});

pool.on('error', (err) => {
  console.error('❌ PostgreSQL error:', err.message);
});

pool.on('connect', () => {
  console.log('✅ PostgreSQL connected');
});

/**
 * Initialize database schema
 * Creates orders table if it doesn't exist
 */
async function initDb() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id VARCHAR(255) PRIMARY KEY,
        payload JSONB NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        dex_chosen VARCHAR(50),
        quote_price NUMERIC,
        executed_price NUMERIC,
        tx_hash VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        last_error TEXT
      );
      
      CREATE INDEX IF NOT EXISTS idx_status ON orders(status);
      CREATE INDEX IF NOT EXISTS idx_created_at ON orders(created_at);
    `);
    console.log('✅ Database schema initialized');
  } catch (err) {
    console.warn('⚠️  Database init skipped (will retry on production):', err.message);
    // Not fatal - database might not be reachable from this network
  }
}

/**
 * Save order to database
 */
async function saveOrder(orderId, payload) {
  try {
    await pool.query(
      `INSERT INTO orders (id, payload, status) VALUES ($1, $2, $3)`,
      [orderId, JSON.stringify(payload), 'pending']
    );
    return { success: true };
  } catch (err) {
    console.error(`❌ Error saving order ${orderId}:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Update order status and details
 */
async function updateOrderStatus(orderId, status, details = {}) {
  try {
    await pool.query(
      `UPDATE orders SET status = $1, dex_chosen = $2, quote_price = $3, 
       executed_price = $4, tx_hash = $5, updated_at = NOW() WHERE id = $6`,
      [
        status,
        details.dex,
        details.price,
        details.executedPrice,
        details.txHash,
        orderId,
      ]
    );
    return { success: true };
  } catch (err) {
    console.error(`❌ Error updating order ${orderId}:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Record order error
 */
async function recordOrderError(orderId, error) {
  try {
    await pool.query(
      `UPDATE orders SET status = $1, last_error = $2, updated_at = NOW() WHERE id = $3`,
      ['failed', error, orderId]
    );
  } catch (err) {
    console.error(`❌ Error recording failure for ${orderId}:`, err.message);
  }
}

/**
 * Get order by ID
 */
async function getOrder(orderId) {
  try {
    const result = await pool.query(
      `SELECT * FROM orders WHERE id = $1`,
      [orderId]
    );
    return result.rows[0] || null;
  } catch (err) {
    console.error(`❌ Error fetching order ${orderId}:`, err.message);
    return null;
  }
}

/**
 * Get all orders with status filter
 */
async function getOrdersByStatus(status, limit = 100) {
  try {
    const result = await pool.query(
      `SELECT * FROM orders WHERE status = $1 ORDER BY created_at DESC LIMIT $2`,
      [status, limit]
    );
    return result.rows;
  } catch (err) {
    console.error(`❌ Error fetching orders by status:`, err.message);
    return [];
  }
}

module.exports = {
  pool,
  initDb,
  saveOrder,
  updateOrderStatus,
  recordOrderError,
  getOrder,
  getOrdersByStatus,
};
