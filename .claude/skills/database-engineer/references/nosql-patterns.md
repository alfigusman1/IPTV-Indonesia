# NoSQL Patterns Reference

## Kapan Pilih NoSQL vs PostgreSQL

```
Pertanyaan dulu sebelum NoSQL:
- Apakah PostgreSQL dengan JSONB sudah cukup?
- Apakah masalahnya schema fleksibilitas, atau performance, atau scale?
- Apakah tim siap handle eventual consistency?

Pilih NoSQL ketika:
✅ Redis:     Cache, session, rate limiting, pub/sub, leaderboard
✅ MongoDB:   Dokumen dengan schema sangat variatif, rapid prototyping
✅ Cassandra: Write-heavy, massive scale, multi-region, time-series
✅ DynamoDB:  Serverless, AWS-native, single-digit ms latency at any scale
✅ Elasticsearch: Full-text search, log analytics, faceted search

Jangan pilih NoSQL karena:
❌ "SQL susah" — pelajari SQL dengan benar
❌ "NoSQL lebih cepat" — PostgreSQL yang di-tune bisa sangat cepat
❌ "Schema bisa berubah" — PostgreSQL JSONB menyelesaikan ini
❌ "Dengarnya scalable" — scale masalah apa dulu?
```

---

## Redis Patterns

### Key Naming Convention
```
Format: type:id:field atau type:id
Contoh:
  user:123:profile        → hash user profile
  user:123:session        → string session data
  session:abc123          → string session (jika session ID sebagai key)
  cache:products:list     → string JSON cache
  lock:job:456            → string distributed lock
  queue:emails            → list job queue
  leaderboard:weekly      → sorted set
  rate:api:user:123       → string counter untuk rate limiting
```

### Caching Patterns
```javascript
// Cache-aside (lazy loading)
async function getProduct(id) {
  const key = `cache:product:${id}`;
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached);

  const product = await db.products.findByPk(id);
  if (product) {
    await redis.setex(key, 3600, JSON.stringify(product));  // TTL 1 jam
  }
  return product;
}

// Cache invalidation on write
async function updateProduct(id, data) {
  await db.products.update(data, { where: { id } });
  await redis.del(`cache:product:${id}`);
  await redis.del('cache:products:list');  // Invalidate list cache juga
}

// Pipeline — batch multiple commands (1 round trip)
const pipeline = redis.pipeline();
pipeline.get('key1');
pipeline.get('key2');
pipeline.incr('counter');
const results = await pipeline.exec();
```

### Rate Limiting dengan Redis
```javascript
// Sliding window rate limit
async function checkRateLimit(userId, limit = 100, windowSeconds = 60) {
  const key = `rate:api:${userId}`;
  const now = Date.now();
  const windowStart = now - (windowSeconds * 1000);

  const pipeline = redis.pipeline();
  // Hapus entries yang sudah expired
  pipeline.zremrangebyscore(key, 0, windowStart);
  // Tambah request baru
  pipeline.zadd(key, now, `${now}-${Math.random()}`);
  // Hitung total dalam window
  pipeline.zcard(key);
  // Set expiry
  pipeline.expire(key, windowSeconds + 1);

  const results = await pipeline.exec();
  const requestCount = results[2][1];

  return {
    allowed: requestCount <= limit,
    remaining: Math.max(0, limit - requestCount),
    resetAt: new Date(now + windowSeconds * 1000),
  };
}
```

### Distributed Lock
```javascript
const lockTTL = 30; // seconds

async function withLock(lockKey, fn) {
  const lockValue = crypto.randomUUID();

  // Acquire: SET NX EX (atomic)
  const acquired = await redis.set(lockKey, lockValue, 'NX', 'EX', lockTTL);
  if (!acquired) throw new Error(`Lock ${lockKey} already held`);

  try {
    return await fn();
  } finally {
    // Release: hanya hapus jika kita yang pegang (Lua = atomic)
    await redis.eval(`
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      end
      return 0
    `, 1, lockKey, lockValue);
  }
}

// Usage
await withLock('lock:process-payment:order-123', async () => {
  await processPayment(orderId);
});
```

### Sorted Set untuk Leaderboard
```javascript
// Tambah/update score
await redis.zadd('leaderboard:weekly', score, userId);

// Top 10
const top10 = await redis.zrevrange('leaderboard:weekly', 0, 9, 'WITHSCORES');

// Rank user tertentu (0-indexed)
const rank = await redis.zrevrank('leaderboard:weekly', userId);

// Score user
const score = await redis.zscore('leaderboard:weekly', userId);

// Range by score
const topPlayers = await redis.zrevrangebyscore(
  'leaderboard:weekly', '+inf', '1000', 'WITHSCORES', 'LIMIT', 0, 10
);
```

---

## MongoDB Patterns

### Data Modeling — Embed vs Reference
```javascript
// ✅ EMBED ketika:
// - Data selalu diakses bersama
// - One-to-few relationship (bukan one-to-many dengan jumlah tak terbatas)
// - Data child tidak di-query secara mandiri

// Embed: order dengan items
{
  _id: ObjectId("..."),
  userId: ObjectId("..."),
  status: "confirmed",
  total: 150000,
  items: [  // ← embedded
    { productId: ObjectId("..."), name: "Laptop", qty: 1, price: 150000 }
  ],
  createdAt: ISODate("...")
}

// ✅ REFERENCE ketika:
// - Data child banyak (unbounded array)
// - Data di-query secara mandiri
// - Data di-share antar dokumen

// Reference: user punya banyak orders
// users collection:
{ _id: ObjectId("..."), name: "John", email: "john@example.com" }

// orders collection (reference ke user):
{ _id: ObjectId("..."), userId: ObjectId("..."), total: 150000, ... }
```

### Indexes di MongoDB
```javascript
// Single field
db.orders.createIndex({ userId: 1 });
db.orders.createIndex({ createdAt: -1 });

// Compound — urutan penting, sama seperti PostgreSQL
db.orders.createIndex({ userId: 1, status: 1, createdAt: -1 });

// Partial index
db.orders.createIndex(
  { createdAt: 1 },
  { partialFilterExpression: { status: 'pending' } }
);

// Text index untuk full-text search
db.products.createIndex({ name: 'text', description: 'text' });
db.products.find({ $text: { $search: 'gaming laptop' } });

// TTL index — auto-delete dokumen yang expired
db.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// MongoDB akan hapus dokumen saat expiresAt sudah lewat

// Explain query
db.orders.find({ userId: ObjectId("...") }).explain("executionStats");
```

### Aggregation Pipeline
```javascript
// Analytics: revenue per hari dalam 30 hari terakhir
db.orders.aggregate([
  // Stage 1: Filter
  {
    $match: {
      status: 'delivered',
      createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
    }
  },
  // Stage 2: Group per hari
  {
    $group: {
      _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
      revenue: { $sum: '$total' },
      orderCount: { $sum: 1 },
      avgOrderValue: { $avg: '$total' }
    }
  },
  // Stage 3: Sort
  { $sort: { _id: 1 } },
  // Stage 4: Format output
  {
    $project: {
      date: '$_id',
      revenue: 1,
      orderCount: 1,
      avgOrderValue: { $round: ['$avgOrderValue', 2] },
      _id: 0
    }
  }
]);

// Lookup (JOIN equivalent)
db.orders.aggregate([
  { $match: { status: 'pending' } },
  {
    $lookup: {
      from: 'users',
      localField: 'userId',
      foreignField: '_id',
      as: 'user',
      pipeline: [  // ✅ Filter kolom yang diambil
        { $project: { name: 1, email: 1 } }
      ]
    }
  },
  { $unwind: '$user' }
]);
```

---

## DynamoDB Patterns

### Single Table Design
```javascript
// ✅ DynamoDB: satu tabel untuk semua entity
// Key design: PK (partition key) + SK (sort key)

// Access patterns yang perlu didukung dulu, baru tentukan key structure!

// Entity: User
{ PK: 'USER#123',    SK: 'PROFILE',         name: 'John', email: '...' }
// Entity: Order milik User
{ PK: 'USER#123',    SK: 'ORDER#2026-01-15#abc', total: 150000, status: 'pending' }
// Entity: Order (akses langsung by order ID)
{ PK: 'ORDER#abc',   SK: 'METADATA',        userId: 'USER#123', total: 150000 }
// Entity: Product
{ PK: 'PRODUCT#456', SK: 'METADATA',        name: 'Laptop', price: 15000000 }

// GSI (Global Secondary Index) untuk access pattern tambahan:
// "Semua orders dengan status pending" → GSI1PK: 'STATUS#pending', GSI1SK: created_at
{ PK: 'ORDER#abc', SK: 'METADATA', GSI1PK: 'STATUS#pending', GSI1SK: '2026-01-15T...' }
```

### DynamoDB Query Patterns
```javascript
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Get semua orders milik user
const userOrders = await client.send(new QueryCommand({
  TableName: 'MyTable',
  KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk_prefix)',
  ExpressionAttributeValues: {
    ':pk': 'USER#123',
    ':sk_prefix': 'ORDER#'
  }
}));

// Conditional write (optimistic locking)
await client.send(new PutCommand({
  TableName: 'MyTable',
  Item: { PK: 'ORDER#abc', SK: 'METADATA', status: 'confirmed', version: 2 },
  ConditionExpression: '#version = :expected_version',
  ExpressionAttributeNames: { '#version': 'version' },
  ExpressionAttributeValues: { ':expected_version': 1 }
}));
// Throws ConditionalCheckFailedException jika version sudah berubah
```

---

## Cassandra / ScyllaDB Patterns

### Data Modeling — Query First
```sql
-- Cassandra: model data berdasarkan query yang akan dijalankan
-- Tidak ada JOIN, denormalisasi adalah cara yang benar

-- Access pattern: "Ambil semua events untuk user tertentu, sorted by time"
CREATE TABLE events_by_user (
  user_id    UUID,
  created_at TIMESTAMP,
  event_id   UUID,
  event_type TEXT,
  payload    TEXT,
  PRIMARY KEY (user_id, created_at, event_id)  -- (partition key, clustering keys)
) WITH CLUSTERING ORDER BY (created_at DESC);

-- Query efisien (sesuai partition key)
SELECT * FROM events_by_user
WHERE user_id = ?
  AND created_at > ?
LIMIT 20;

-- Access pattern yang BERBEDA butuh tabel BERBEDA
-- "Ambil semua events dengan type tertentu" → tabel terpisah
CREATE TABLE events_by_type (
  event_type TEXT,
  created_at TIMESTAMP,
  event_id   UUID,
  user_id    UUID,
  payload    TEXT,
  PRIMARY KEY (event_type, created_at, event_id)
) WITH CLUSTERING ORDER BY (created_at DESC);
```

### Cassandra Anti-Patterns
```
❌ ALLOW FILTERING    → Full cluster scan, hindari di production
❌ Partition terlalu besar (> 100MB) → Hotspot, degradasi performance
❌ Terlalu banyak partisi kecil → Overhead metadata
❌ IN clause dengan banyak nilai → Multiple partition reads
❌ Secondary index tanpa cardinality tinggi → Full cluster scan
❌ UPDATE/DELETE sering → Tombstone accumulation, read performance turun
```
