/**
 * Redis Active Orders Cache
 * Tracks orders currently being processed
 */

const redis = require('./redis-client');

const ACTIVE_ORDERS_KEY = 'active_orders';
const ORDER_PREFIX = 'order:';
const CACHE_TTL = 3600; // 1 hour

/**
 * Set active order in Redis cache
 */
async function setActiveOrder(orderId, orderData) {
  try {
    const key = `${ORDER_PREFIX}${orderId}`;
    await redis.setex(
      key,
      CACHE_TTL,
      JSON.stringify({
        ...orderData,
        timestamp: Date.now(),
      })
    );
    // Add to active orders set
    await redis.sadd(ACTIVE_ORDERS_KEY, orderId);
    return { success: true };
  } catch (err) {
    console.error(`❌ Error setting active order ${orderId}:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Get active order from Redis cache
 */
async function getActiveOrder(orderId) {
  try {
    const key = `${ORDER_PREFIX}${orderId}`;
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    console.error(`❌ Error getting active order ${orderId}:`, err.message);
    return null;
  }
}

/**
 * Update active order status in cache
 */
async function updateActiveOrderStatus(orderId, status, details = {}) {
  try {
    const key = `${ORDER_PREFIX}${orderId}`;
    const order = await getActiveOrder(orderId);
    if (!order) return { success: false, error: 'Order not found' };

    const updated = {
      ...order,
      status,
      ...details,
      lastUpdate: Date.now(),
    };

    await redis.setex(key, CACHE_TTL, JSON.stringify(updated));
    return { success: true };
  } catch (err) {
    console.error(`❌ Error updating active order ${orderId}:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Remove order from active cache
 */
async function removeActiveOrder(orderId) {
  try {
    const key = `${ORDER_PREFIX}${orderId}`;
    await redis.del(key);
    await redis.srem(ACTIVE_ORDERS_KEY, orderId);
    return { success: true };
  } catch (err) {
    console.error(`❌ Error removing active order ${orderId}:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Get all active order IDs
 */
async function getAllActiveOrderIds() {
  try {
    return await redis.smembers(ACTIVE_ORDERS_KEY);
  } catch (err) {
    console.error(`❌ Error fetching active orders:`, err.message);
    return [];
  }
}

/**
 * Get count of active orders
 */
async function getActiveOrderCount() {
  try {
    return await redis.scard(ACTIVE_ORDERS_KEY);
  } catch (err) {
    console.error(`❌ Error getting active order count:`, err.message);
    return 0;
  }
}

module.exports = {
  setActiveOrder,
  getActiveOrder,
  updateActiveOrderStatus,
  removeActiveOrder,
  getAllActiveOrderIds,
  getActiveOrderCount,
};
