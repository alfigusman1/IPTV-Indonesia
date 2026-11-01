# Caching & Performance Reference

## Caching Strategies

### Cache-Aside (Lazy Loading) — Most Common
```javascript
async function getUser(userId) {
  const cacheKey = `user:${userId}`;
  
  // 1. Check cache
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);
  
  // 2. Cache miss — fetch from DB
  const user = await db.users.findByPk(userId);
  if (!user) return null;
  
  // 3. Store in cache (TTL based on how often data changes)
  await redis.setex(cacheKey, 3600, JSON.stringify(user)); // 1 hour
  
  return user;
}

// Invalidation on update
async function updateUser(userId, data) {
  await db.users.update(data, { where: { id: userId } });
  await redis.del(`user:${userId}`);  // Bust cache
}
```

### Cache-Through (Write-Through)
```javascript
// Write to cache AND DB simultaneously
// Better read performance, but higher write latency
async function updateUserCacheThrough(userId, data) {
  const user = await db.users.update(data, { where: { id: userId } });
  await redis.setex(`user:${userId}`, 3600, JSON.stringify(user));
  return user;
}
```

### Cache TTL Strategy
```
Rarely changes (config, feature flags):  24h - 7d
User profile / settings:                  1h - 24h
Product listings / catalog:              15min - 1h
User feed / timeline:                    1min - 5min
Real-time data (stock, scores):          0 - 10s (or no cache)
Session data:                            Sliding window (extend on access)
```

---

## Redis Patterns

### Distributed Lock (prevent race conditions)
```javascript
const lockKey = `lock:process:${jobId}`;
const lockValue = crypto.randomUUID();
const lockTTL = 30; // seconds

// Acquire lock — SET NX EX (atomic)
const acquired = await redis.set(lockKey, lockValue, 'NX', 'EX', lockTTL);
if (!acquired) {
  throw new Error('Job already running');
}

try {
  await processJob(jobId);
} finally {
  // ✅ Release only if we own it (Lua script = atomic check-and-delete)
  await redis.eval(`
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    end
    return 0
  `, 1, lockKey, lockValue);
}
```

### Token Bucket Rate Limiting
```lua
-- Lua script for atomic rate limiting
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local requested = tonumber(ARGV[4])

local bucket = redis.call('HMGET', key, 'tokens', 'last_refill')
local tokens = tonumber(bucket[1]) or capacity
local last_refill = tonumber(bucket[2]) or now

-- Refill tokens based on elapsed time
local elapsed = now - last_refill
tokens = math.min(capacity, tokens + elapsed * refill_rate)

if tokens >= requested then
  tokens = tokens - requested
  redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
  redis.call('EXPIRE', key, 3600)
  return 1  -- allowed
else
  redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
  redis.call('EXPIRE', key, 3600)
  return 0  -- rejected
end
```

### Cache Stampede Prevention
```javascript
// Problem: 1000 requests hit at cache expiry, all query DB simultaneously

// ✅ Solution 1: Probabilistic early expiration (PER algorithm)
async function getWithPER(key, fetchFn, ttl, beta = 1.0) {
  const data = await redis.get(key);
  if (data) {
    const { value, expiry, delta } = JSON.parse(data);
    const now = Date.now() / 1000;
    // Probabilistically refresh before expiry
    if (now - delta * beta * Math.log(Math.random()) < expiry) {
      return value;
    }
  }
  // Fetch, store with metadata
  const start = Date.now();
  const value = await fetchFn();
  const delta = (Date.now() - start) / 1000;
  const expiry = Date.now() / 1000 + ttl;
  await redis.setex(key, ttl + 10, JSON.stringify({ value, expiry, delta }));
  return value;
}

// ✅ Solution 2: Mutex — only one process refreshes
async function getWithMutex(key, fetchFn, ttl) {
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached);

  const lockAcquired = await redis.set(`lock:${key}`, 1, 'NX', 'EX', 10);
  if (!lockAcquired) {
    // Wait and retry
    await sleep(100);
    return getWithMutex(key, fetchFn, ttl);
  }

  const value = await fetchFn();
  await redis.setex(key, ttl, JSON.stringify(value));
  await redis.del(`lock:${key}`);
  return value;
}
```

---

## Performance Profiling

### Node.js
```javascript
// Built-in profiler
node --prof app.js
node --prof-process isolate-*.log > processed.txt

// clinic.js (excellent for production diagnosis)
npm i -g clinic
clinic doctor -- node app.js   # CPU, memory, event loop
clinic flame -- node app.js    # Flame graph
clinic bubbleprof -- node app.js  # Async bottlenecks

// Manual timing for specific operations
const { performance } = require('perf_hooks');
const start = performance.now();
await heavyOperation();
console.log(`Operation took ${performance.now() - start}ms`);
```

### Python
```python
# cProfile
python -m cProfile -o profile.stats app.py
python -m pstats profile.stats  # interactive viewer

# line_profiler (per-line timing)
# @profile decorator on function, then: kernprof -l -v script.py

# Memory profiler
pip install memory-profiler
# @memory_profiler.profile on function
# python -m memory_profiler script.py

# py-spy (low overhead sampling profiler — works in production!)
pip install py-spy
py-spy top --pid 12345          # live top-like view
py-spy record -o profile.svg --pid 12345  # flame graph
```

### Database Query Profiling
```sql
-- PostgreSQL: EXPLAIN ANALYZE
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT u.id, u.email, COUNT(o.id) as order_count
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
WHERE u.created_at > NOW() - INTERVAL '30 days'
GROUP BY u.id
ORDER BY order_count DESC;

-- Look for:
-- Seq Scan on large tables (should be Index Scan)
-- Hash Join vs Nested Loop (nested loop on large result sets = slow)
-- Buffers: hit (memory) vs read (disk)
-- Actual Rows vs Plan Rows (big difference = stale stats)

-- Update statistics if estimates are wrong
ANALYZE users;
ANALYZE orders;

-- MySQL slow query log
SET GLOBAL slow_query_log = 'ON';
SET GLOBAL long_query_time = 0.5;  -- Log queries > 500ms
```

---

## HTTP Performance

### Compression
```javascript
// ✅ Gzip/Brotli compress responses > ~1KB
const compression = require('compression');
app.use(compression({
  level: 6,           // compression level (1-9, 6 is good balance)
  threshold: 1024,    // don't compress < 1KB
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  }
}));
```

### Connection Keep-Alive & HTTP/2
```nginx
# nginx config
http {
  keepalive_timeout 65;
  keepalive_requests 1000;

  # HTTP/2 (multiplexing — multiple requests per connection)
  listen 443 ssl http2;

  # Gzip
  gzip on;
  gzip_min_length 1024;
  gzip_types text/plain application/json application/javascript text/css;

  # Cache static assets
  location /static/ {
    expires 1y;
    add_header Cache-Control "public, immutable";
  }
}
```

### Response Time Budget
```
Target for web APIs (P95):
< 50ms   — Simple reads from cache or indexed DB
< 200ms  — Standard reads from DB
< 500ms  — Complex queries, multiple DB calls
< 1000ms — External API calls, heavy computation
> 1s     — Should be async (queue it, return 202)
> 5s     — Always async, never synchronous
```

---

## Async Patterns for Performance

```javascript
// ✅ Parallel independent operations
const [user, products, settings] = await Promise.all([
  userService.getById(userId),
  productService.getTopProducts(),
  settingsService.getForUser(userId),
]);
// Takes max(t1, t2, t3) instead of t1+t2+t3

// ✅ Batch DB writes (buffer and flush)
class WriteBatcher {
  constructor(flushInterval = 500, batchSize = 100) {
    this.buffer = [];
    this.timer = setInterval(() => this.flush(), flushInterval);
  }

  async write(record) {
    this.buffer.push(record);
    if (this.buffer.length >= this.batchSize) await this.flush();
  }

  async flush() {
    if (!this.buffer.length) return;
    const batch = this.buffer.splice(0, this.batchSize);
    await db.events.bulkCreate(batch);
  }
}

// ✅ Streaming large datasets (don't load all in memory)
const stream = db.query('SELECT * FROM large_table').stream();
const csvStream = fs.createWriteStream('export.csv');
stream.pipe(csvTransform).pipe(csvStream);
```
