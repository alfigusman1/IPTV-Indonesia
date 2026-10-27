# DevOps & Infrastructure Reference

## Docker Best Practices

```dockerfile
# ✅ Multi-stage build — smaller production image
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci                     # ci not install (reproducible, faster in CI)
COPY . .
RUN npm run build

FROM node:20-alpine AS production
WORKDIR /app

# ✅ Don't run as root
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

# ✅ Copy only what's needed
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --chown=nodejs:nodejs package.json .

USER nodejs
EXPOSE 3000

# ✅ Use SIGTERM for graceful shutdown
STOPSIGNAL SIGTERM

# ✅ Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/server.js"]
```

```bash
# .dockerignore — critical for build speed and security
node_modules
.git
.env
.env.*
*.md
coverage/
dist/
.nyc_output/
```

---

## Docker Compose (Development)

```yaml
# docker-compose.yml
version: '3.9'
services:
  app:
    build:
      context: .
      target: development        # Target specific stage
    ports: ['3000:3000']
    volumes:
      - .:/app                   # Hot reload
      - /app/node_modules        # Preserve container's node_modules
    environment:
      NODE_ENV: development
      DATABASE_URL: postgresql://user:pass@postgres:5432/mydb
      REDIS_URL: redis://redis:6379
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
      POSTGRES_DB: mydb
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U user -d mydb']
      interval: 5s
      timeout: 5s
      retries: 5
    ports: ['5432:5432']

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data
    ports: ['6379:6379']

volumes:
  postgres_data:
  redis_data:
```

---

## CI/CD Pipeline

### GitHub Actions
```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: testpass
          POSTGRES_DB: testdb
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - run: npm ci
      
      - run: npm run lint
      
      - run: npm test
        env:
          DATABASE_URL: postgresql://postgres:testpass@localhost:5432/testdb
          NODE_ENV: test
      
      - name: Upload coverage
        uses: codecov/codecov-action@v4

  build-and-push:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      
      - uses: docker/setup-buildx-action@v3
      
      - uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      
      - id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=sha,prefix=,suffix=,format=short
            type=raw,value=latest
      
      - uses: docker/build-push-action@v5
        with:
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  deploy:
    needs: build-and-push
    runs-on: ubuntu-latest
    environment: production
    steps:
      - name: Deploy to production
        run: |
          # Trigger deployment (ECS, k8s, etc.)
          aws ecs update-service \
            --cluster production \
            --service myapp \
            --force-new-deployment
```

---

## Health Check Endpoint

```javascript
// ✅ Comprehensive health check
app.get('/health', async (req, res) => {
  const checks = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.APP_VERSION || 'unknown',
    checks: {}
  };

  // Database check
  try {
    await db.query('SELECT 1');
    checks.checks.database = { status: 'healthy' };
  } catch (error) {
    checks.checks.database = { status: 'unhealthy', error: error.message };
    checks.status = 'unhealthy';
  }

  // Redis check
  try {
    await redis.ping();
    checks.checks.redis = { status: 'healthy' };
  } catch (error) {
    checks.checks.redis = { status: 'unhealthy', error: error.message };
    checks.status = 'degraded';  // App still works, but slower
  }

  const statusCode = checks.status === 'unhealthy' ? 503 : 200;
  res.status(statusCode).json(checks);
});

// ✅ Separate readiness vs liveness (for k8s)
app.get('/health/live', (req, res) => {
  // Is the process alive? (for k8s liveness probe — restart if fails)
  res.json({ status: 'alive' });
});

app.get('/health/ready', async (req, res) => {
  // Is the app ready to serve traffic? (for k8s readiness — remove from LB if fails)
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ready' });
  } catch {
    res.status(503).json({ status: 'not ready' });
  }
});
```

---

## Structured Logging

```javascript
// ✅ Use pino (Node.js) — fastest JSON logger
const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: ['req.headers.authorization', 'body.password', 'body.token'],  // Never log secrets
  transport: process.env.NODE_ENV !== 'production' ? {
    target: 'pino-pretty',  // Human-readable in dev
  } : undefined,
});

// Express middleware — log every request
app.use((req, res, next) => {
  const requestId = req.headers['x-request-id'] || crypto.randomUUID();
  req.log = logger.child({ requestId, userId: req.user?.id });
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  
  const start = Date.now();
  res.on('finish', () => {
    req.log.info({
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      responseTime: Date.now() - start,
    }, 'Request completed');
  });
  
  next();
});

// In handlers — use child logger with context
async function createOrder(req, res) {
  req.log.info({ body: req.body }, 'Creating order');
  try {
    const order = await orderService.create(req.body, req.user.id);
    req.log.info({ orderId: order.id }, 'Order created successfully');
    res.status(201).json({ data: order });
  } catch (error) {
    req.log.error({ error: error.message }, 'Failed to create order');
    throw error;
  }
}
```

---

## Environment Configuration Pattern

```javascript
// config/index.js — centralized, validated config
const schema = {
  NODE_ENV: { required: true, enum: ['development', 'test', 'production'] },
  PORT: { required: false, default: '3000', parse: parseInt },
  DATABASE_URL: { required: true },
  REDIS_URL: { required: true },
  JWT_SECRET: { required: true, minLength: 32 },
  LOG_LEVEL: { required: false, default: 'info', enum: ['debug', 'info', 'warn', 'error'] },
  CORS_ORIGIN: { required: true },
};

function loadConfig() {
  const config = {};
  const errors = [];

  for (const [key, rules] of Object.entries(schema)) {
    let value = process.env[key] ?? rules.default;
    
    if (rules.required && !value) {
      errors.push(`Missing required env var: ${key}`);
      continue;
    }
    
    if (value && rules.enum && !rules.enum.includes(value)) {
      errors.push(`Invalid value for ${key}: must be one of ${rules.enum.join(', ')}`);
    }
    
    if (value && rules.minLength && value.length < rules.minLength) {
      errors.push(`${key} must be at least ${rules.minLength} characters`);
    }
    
    config[key] = rules.parse ? rules.parse(value) : value;
  }

  if (errors.length > 0) {
    console.error('Configuration errors:\n' + errors.join('\n'));
    process.exit(1);  // ✅ Fail fast on startup
  }

  return Object.freeze(config);  // Prevent accidental mutation
}

module.exports = loadConfig();
```
