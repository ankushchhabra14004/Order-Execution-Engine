# Order Execution Engine

**Mock order execution engine for Solana DEX with BullMQ queue, PostgreSQL persistence, Redis caching, and real-time WebSocket updates.**

## Architecture Overview

```
┌─────────────┐     ┌──────────┐     ┌──────────┐
│  Frontend   │────▶│ HTTP/WS  │────▶│ BullMQ   │
│ (WebSocket) │     │  Server  │     │  Queue   │
└─────────────┘     └──────────┘     └──────────┘
                          │                 │
                          ▼                 ▼
                    ┌──────────┐     ┌────────────┐
                    │ Redis    │     │  Worker    │
                    │ (cache)  │     │ Processor  │
                    └──────────┘     └────────────┘
                          ▲                 │
                          │                 ▼
                    ┌──────────────────────────┐
                    │  PostgreSQL              │
                    │  (Order History)         │
                    └──────────────────────────┘
```

## Features

✅ **Market Orders** - Immediate execution with DEX routing
✅ **DEX Routing** - Smart selection between Raydium & Meteora based on price
✅ **BullMQ Queue** - Redis-backed order queue with concurrency control
✅ **PostgreSQL** - Full order history and persistence
✅ **Redis Cache** - Active orders tracking and caching
✅ **WebSocket** - Real-time order status streaming
✅ **Concurrent Processing** - 10 concurrent workers by default
✅ **Retries & Backoff** - Exponential backoff with 3 retry attempts

## Quick Start

### Prerequisites

- Node.js 18+
- Redis (local or cloud)
- PostgreSQL (local or cloud)

### 1. Install Dependencies

```bash
npm install
```

### 2. Setup Environment Variables

```bash
cp .env.example .env
# Edit .env with your Redis and PostgreSQL connection strings
```

### 3. Start Services

**Terminal 1: Backend Server**
```bash
npm run server
```

**Terminal 2: Worker Process**
```bash
npm run worker
```

Or together:
```bash
npm run dev
```

## Order Submission

- User submits order via **POST /api/orders/execute**
- API validates order and returns `orderId` + `wsUrl`
- Same HTTP connection upgrades to **WebSocket for live updates**
- Worker processes through pipeline: pending → routing → building → submitted → confirmed
- Order history persisted to PostgreSQL
- Active orders cached in Redis

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/orders/execute` | Submit market order |
| GET | `/api/orders?status=pending` | List orders |
| GET | `/api/orders/:id` | Get order details |
| GET | `/api/stats` | System statistics |

## Order Lifecycle

```
pending → routing → building → submitted → confirmed
```

Each stage updates WebSocket subscribers in real-time.

## Why Market Orders?

Market orders were chosen because they exercise immediate routing and execution logic (price comparison + slippage handling), demonstrating the full lifecycle quickly.

**Extending to Limit/Sniper:**
- **Limit Orders:** Add a scheduler that watches prices and enqueues market execution when target price is reached
- **Sniper Orders:** Subscribe to launch events and enqueue aggressive market executions when conditions are detected

## Testing

### Run Test Suite (12 comprehensive tests)

```bash
npm test
```

Covers: DEX routing, queue behavior, concurrency, WebSocket lifecycle, error handling

### Run Demo (5 Concurrent Orders)

```bash
npm run demo
```

Shows real-time DEX routing decisions and concurrent processing

## BullMQ Configuration

```javascript
// Queue settings (server.js)
attempts: 3,              // 3 retries
backoff: {
  type: 'exponential',
  delay: 500              // 500ms initial delay
},
concurrency: 10           // 10 concurrent workers
```

## Database Schema

```sql
CREATE TABLE orders (
  id VARCHAR(255) PRIMARY KEY,
  payload JSONB,
  status VARCHAR(50),
  dex_chosen VARCHAR(50),
  quote_price NUMERIC,
  executed_price NUMERIC,
  tx_hash VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_error TEXT
);
```

## File Structure

```
├── server.js                # HTTP/WebSocket server + BullMQ
├── worker.js                # Order processor
├── lib/
│   ├── redis-client.js      # Redis connection
│   ├── db-client.js         # PostgreSQL persistence
│   └── active-orders.js     # Redis cache
├── tests/integration.test.js # 12 tests
├── demo.js                   # Demo (5 concurrent orders)
├── postman_collection.json   # API collection
└── .env.example             # Configuration template
```

## Postman Collection

Import `postman_collection.json` for pre-built API requests covering all endpoints and error cases.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Redis refused | `redis-cli ping` and check REDIS_URL |
| PostgreSQL failed | Verify connection string in PG_CONN |
| Tests failing | Ensure Redis + PostgreSQL running |
| WebSocket offline | Check wsUrl and worker process |

## Production Scaling

- **Workers:** Run multiple `worker.js` on different machines
- **Database:** Use cloud PostgreSQL (AWS RDS, DigitalOcean, etc.)
- **Redis:** Use Redis Cloud or managed services
- **Load Balancing:** Multiple `server.js` behind load balancer

## License

MIT
