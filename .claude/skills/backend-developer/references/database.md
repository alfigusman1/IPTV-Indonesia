# Database Design & SQL Reference

## Schema Design Principles

```sql
-- ✅ Use UUIDs or ULIDs for public-facing IDs (not sequential integers)
-- Sequential IDs leak record counts, enable enumeration attacks
CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       VARCHAR(255) NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ✅ TIMESTAMPTZ not TIMESTAMP (timezone-aware)
-- ✅ NOT NULL where possible (nulls complicate queries)
-- ✅ created_at / updated_at on every table
-- ✅ Soft delete: deleted_at TIMESTAMPTZ (not DELETE FROM)

-- Soft delete pattern
ALTER TABLE users ADD COLUMN deleted_at TIMESTAMPTZ;
-- Query active users
SELECT * FROM users WHERE deleted_at IS NULL;
-- Partial index for performance
CREATE INDEX idx_users_active ON users (email) WHERE deleted_at IS NULL;
```

### Normalization Rules
```
1NF — Atomic values, no repeating groups
2NF — No partial dependencies (non-key attributes depend on FULL key)
3NF — No transitive dependencies
BCNF — Every determinant is a candidate key

Denormalize only when:
- Profile proves it's a bottleneck
- Read performance is critical and writes are rare
- Reporting/analytics workload (star schema, wide tables)
```

---

## Indexing Strategy

```sql
-- Index types and when to use:

-- B-tree (default) — equality, range, ORDER BY, <, >, BETWEEN
CREATE INDEX idx_orders_user_id ON orders (user_id);
CREATE INDEX idx_orders_created_at ON orders (created_at DESC);

-- Composite index — order matters! Put equality first, range last
-- Covers WHERE status = 'active' AND created_at > '2024-01-01'
CREATE INDEX idx_orders_status_created ON orders (status, created_at DESC);

-- Partial index — only index rows matching a condition
CREATE INDEX idx_active_subscriptions ON subscriptions (user_id)
  WHERE status = 'active';           -- Much smaller, faster for common query

-- Covering index — include extra columns to avoid table lookup
CREATE INDEX idx_users_email_covering ON users (email)
  INCLUDE (id, name, status);        -- Query can be served from index alone

-- GIN index — for full-text search, JSONB, arrays
CREATE INDEX idx_products_search ON products USING GIN(to_tsvector('english', name || ' ' || description));
CREATE INDEX idx_metadata ON records USING GIN(metadata);  -- JSONB

-- When NOT to index:
-- Low-cardinality columns (boolean, status with 2-3 values) — consider partial instead
-- Tables < 1000 rows (seq scan is faster)
-- Columns never in WHERE/JOIN/ORDER BY
-- Write-heavy tables (indexes slow down INSERT/UPDATE/DELETE)

-- Find unused indexes
SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read
FROM pg_stat_user_indexes
WHERE idx_scan = 0
ORDER BY pg_relation_size(indexrelid) DESC;
```

---

## Query Patterns

### N+1 Prevention
```javascript
// ❌ N+1 — 1 query for orders + N queries for each user
const orders = await Order.findAll({ limit: 100 });
for (const order of orders) {
  order.user = await User.findByPk(order.userId); // 100 extra queries!
}

// ✅ Eager loading (Sequelize)
const orders = await Order.findAll({
  limit: 100,
  include: [{ model: User, attributes: ['id', 'name', 'email'] }]
});

// ✅ Manual batching
const orders = await Order.findAll({ limit: 100 });
const userIds = [...new Set(orders.map(o => o.userId))];
const users = await User.findAll({ where: { id: userIds } });
const userMap = Object.fromEntries(users.map(u => [u.id, u]));
orders.forEach(o => { o.user = userMap[o.userId]; });
```

### Pagination
```sql
-- ✅ Keyset / Cursor pagination (fast at any offset)
-- No OFFSET — OFFSET N requires scanning N rows every time
SELECT id, title, created_at
FROM posts
WHERE created_at < :cursor      -- cursor = last seen created_at
  AND deleted_at IS NULL
ORDER BY created_at DESC
LIMIT 20;

-- ❌ Offset pagination (slow for large offsets)
SELECT * FROM posts ORDER BY created_at DESC LIMIT 20 OFFSET 10000;
-- PostgreSQL must scan and discard 10,000 rows!

-- ✅ When offset pagination is needed, use a keyset workaround
-- Store the physical row ID instead: WHERE id < :last_id
```

### Transactions & Locking
```sql
-- Optimistic locking (version column — no DB lock held)
ALTER TABLE products ADD COLUMN version INTEGER NOT NULL DEFAULT 0;

-- On update, check version matches
UPDATE products
SET stock = stock - 1, version = version + 1
WHERE id = :id AND version = :expected_version;
-- If 0 rows updated → conflict, retry

-- Pessimistic locking (SELECT FOR UPDATE)
BEGIN;
SELECT * FROM accounts WHERE id = :id FOR UPDATE; -- holds row lock
-- ... business logic ...
UPDATE accounts SET balance = balance - :amount WHERE id = :id;
COMMIT;

-- Advisory locks for distributed coordination
SELECT pg_advisory_xact_lock(hashtext('job:' || :job_id));
-- Lock released automatically at end of transaction
```

---

## Migrations Best Practices

```sql
-- ✅ Non-blocking migrations for large tables (PostgreSQL)

-- Adding a column: safe if nullable or has default
ALTER TABLE users ADD COLUMN last_login_at TIMESTAMPTZ;  -- instant

-- Adding NOT NULL column to large table: UNSAFE (rewrites table)
-- ❌ ALTER TABLE users ADD COLUMN score INTEGER NOT NULL DEFAULT 0;

-- ✅ Safe approach (3 steps):
-- Step 1: Add as nullable
ALTER TABLE users ADD COLUMN score INTEGER;
-- Step 2: Backfill in batches
UPDATE users SET score = 0 WHERE score IS NULL AND id BETWEEN 1 AND 10000;
-- ... repeat in batches ...
-- Step 3: Add NOT NULL constraint (fast — data is already filled)
ALTER TABLE users ALTER COLUMN score SET NOT NULL;
ALTER TABLE users ALTER COLUMN score SET DEFAULT 0;

-- Creating index without locking
CREATE INDEX CONCURRENTLY idx_users_score ON users (score);
-- Takes longer but doesn't block reads/writes

-- Dropping a column: mark as unused first, drop later
-- Some ORMs cache column lists; dropping immediately can break running instances
ALTER TABLE users RENAME COLUMN old_col TO _old_col_deprecated;
-- Deploy and verify → then drop in next release
ALTER TABLE users DROP COLUMN _old_col_deprecated;
```

---

## ORM Patterns

### Sequelize (Node.js)
```javascript
// Model definition
const User = sequelize.define('User', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  email: { type: DataTypes.STRING, allowNull: false, unique: true, validate: { isEmail: true } },
  deletedAt: { type: DataTypes.DATE, allowNull: true },
}, {
  paranoid: true,      // soft delete
  underscored: true,   // snake_case columns
  timestamps: true,
});

// Scopes
User.addScope('active', { where: { deletedAt: null } });
User.scope('active').findAll();

// Avoid: findAll without limit on large tables
// Always add .limit() and appropriate .where()
```

### SQLAlchemy (Python)
```python
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload

# ✅ Async SQLAlchemy with eager loading
stmt = (
    select(Order)
    .where(Order.status == 'pending')
    .options(selectinload(Order.items).selectinload(OrderItem.product))
    .order_by(Order.created_at.desc())
    .limit(100)
)
result = await session.execute(stmt)
orders = result.scalars().all()

# ✅ Bulk insert (much faster than individual inserts)
await session.execute(
    insert(Product),
    [{"name": p["name"], "price": p["price"]} for p in products_data]
)
await session.commit()
```

---

## Connection Pooling

```javascript
// ✅ Always configure pool size explicitly
// Default pool sizes are usually too small for production

// PostgreSQL with pg (Node.js)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,              // max connections
  min: 5,               // keep alive minimum
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Rule of thumb: max_connections = (num_workers * 2) + num_read_replicas
// PostgreSQL default max_connections = 100 — easy to exhaust!
// Use PgBouncer for connection pooling in front of PostgreSQL

// Python SQLAlchemy
engine = create_async_engine(
    DATABASE_URL,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,   # test connection before use
    pool_recycle=3600,    # recycle connections every hour
)
```

---

## NoSQL Patterns

### Redis
```javascript
// Key naming convention: type:id:field
// user:123:profile, session:abc123, cache:products:list

// ✅ Atomic operations for counters
await redis.incr('stats:page_views');
await redis.incrby('user:123:credits', 10);

// ✅ SET with expiry
await redis.setex('session:abc123', 3600, JSON.stringify(sessionData));

// ✅ Hash for objects (better memory than JSON string)
await redis.hset('user:123', { name: 'Alice', email: 'alice@example.com' });
await redis.hget('user:123', 'name');

// ✅ Pipeline for multiple operations
const pipeline = redis.pipeline();
pipeline.setex('key1', 3600, 'val1');
pipeline.setex('key2', 3600, 'val2');
pipeline.incr('counter');
await pipeline.exec();  // 1 round trip instead of 3
```

### MongoDB
```javascript
// ✅ Indexes are equally critical in MongoDB
db.orders.createIndex({ userId: 1, createdAt: -1 });
db.orders.createIndex({ status: 1 }, { partialFilterExpression: { status: 'pending' } });

// ✅ Projection — only fetch needed fields
db.users.find({ status: 'active' }, { email: 1, name: 1, _id: 1 });

// ✅ Aggregation pipeline for analytics
db.orders.aggregate([
  { $match: { createdAt: { $gte: startDate } } },
  { $group: { _id: '$userId', total: { $sum: '$amount' }, count: { $sum: 1 } } },
  { $sort: { total: -1 } },
  { $limit: 100 }
]);
```
