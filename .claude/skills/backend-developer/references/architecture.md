# Backend Architecture Reference

## Monolith vs Microservices Decision

```
Start with a monolith. Migrate when you have:
✅ Clear domain boundaries (bounded contexts)
✅ Different scaling needs per service
✅ Multiple teams needing independent deployments
✅ Different tech stacks needed per domain
✅ > ~50 engineers

Stay monolith if:
- Small team (< 10 engineers)
- Early stage / undefined domain
- Performance-critical (network hops add latency)
- Simple deployment needs

Distributed monolith (worst of both worlds):
❌ Microservices that share a database
❌ Services that are always deployed together
❌ Synchronous chains: A → B → C → D (distributed monolith latency)
```

---

## Layered Architecture (Clean / Hexagonal)

```
Controller / Handler (HTTP layer)
  └── Validates input (schema validation)
  └── Calls service, returns HTTP response
  └── Handles HTTP concerns ONLY

Service Layer (Business Logic)
  └── Orchestrates business operations
  └── Calls repository/external services
  └── Framework-agnostic (no req/res objects)
  └── Unit testable without HTTP or DB

Repository / Data Layer
  └── All DB access goes here
  └── Returns domain objects, not raw DB rows
  └── Can swap DB without changing service layer

Domain Models
  └── Core business entities and rules
  └── No dependencies on external frameworks

Example structure:
src/
├── http/
│   └── users.controller.js    # route handlers
├── services/
│   └── users.service.js       # business logic
├── repositories/
│   └── users.repository.js    # data access
├── domain/
│   └── user.js                # entity + validation
└── infrastructure/
    ├── database/
    ├── cache/
    └── mailer/
```

---

## Domain-Driven Design (DDD) Concepts

```javascript
// Aggregate — cluster of entities with one root
// All changes go through the aggregate root

class Order {  // Aggregate Root
  constructor(id, userId) {
    this.id = id;
    this.userId = userId;
    this.items = [];       // Child entities — never accessed directly
    this.status = 'draft';
    this.events = [];      // Domain events
  }

  addItem(productId, quantity, price) {
    if (this.status !== 'draft') throw new Error('Cannot modify confirmed order');
    
    const existing = this.items.find(i => i.productId === productId);
    if (existing) {
      existing.quantity += quantity;
    } else {
      this.items.push(new OrderItem(productId, quantity, price));
    }
  }

  confirm() {
    if (this.items.length === 0) throw new Error('Cannot confirm empty order');
    this.status = 'confirmed';
    // ✅ Record domain event
    this.events.push(new OrderConfirmedEvent(this.id, this.total()));
  }

  total() {
    return this.items.reduce((sum, item) => sum + item.subtotal(), 0);
  }
}

// Repository — persist/retrieve aggregates
class OrderRepository {
  async save(order) {
    await db.transaction(async (trx) => {
      await db.orders.upsert(order, { transaction: trx });
      // Publish collected domain events
      for (const event of order.events) {
        await outbox.record(event, { transaction: trx });
      }
    });
  }
}
```

---

## CQRS (Command Query Responsibility Segregation)

```javascript
// Commands — write operations (return void or minimal data)
class PlaceOrderCommand {
  constructor(userId, items) {
    this.userId = userId;
    this.items = items;
  }
}

class PlaceOrderHandler {
  async handle(command) {
    const order = Order.create(command.userId, command.items);
    await this.orderRepository.save(order);
    // ✅ No return value — fire and forget or return ID only
    return order.id;
  }
}

// Queries — read operations (optimized, can use different DB/model)
class GetOrderDetailsQuery {
  constructor(orderId, userId) {
    this.orderId = orderId;
    this.userId = userId;
  }
}

class GetOrderDetailsHandler {
  async handle(query) {
    // ✅ Read model — can be denormalized, from read replica, from cache
    return await this.readDb.query(`
      SELECT o.*, 
             json_agg(oi.* ORDER BY oi.created_at) as items,
             u.name as user_name
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      JOIN users u ON u.id = o.user_id
      WHERE o.id = $1 AND o.user_id = $2
      GROUP BY o.id, u.name
    `, [query.orderId, query.userId]);
  }
}
```

---

## Service Communication Patterns

### Synchronous (REST/gRPC)
```
Use when: Caller needs immediate response
Pros: Simple, easy to trace, natural request/response
Cons: Tight coupling, cascading failures, latency addition

Circuit Breaker pattern (prevent cascading failure):
CLOSED → OPEN → HALF-OPEN

Implementation with opossum (Node.js):
const CircuitBreaker = require('opossum');

const breaker = new CircuitBreaker(paymentService.charge, {
  timeout: 3000,          // Mark as failed if > 3s
  errorThresholdPercentage: 50,  // Open if 50% fail
  resetTimeout: 30000,    // Try again after 30s
});

breaker.fallback(() => ({ status: 'pending', message: 'Payment processing delayed' }));
breaker.on('open', () => logger.warn('Payment circuit breaker opened'));
```

### Asynchronous (Events/Messages)
```
Use when: Caller doesn't need immediate response
Pros: Loose coupling, resilience, natural scaling
Cons: Complexity, eventual consistency, harder to trace

Event-driven patterns:
1. Event Notification — "something happened" (order.created)
2. Event-Carried State Transfer — event contains full data
3. Event Sourcing — events ARE the source of truth (rebuild state by replaying)

Choreography vs Orchestration:
- Choreography: Each service reacts to events independently
  Order created → Inventory service listens → Shipping service listens
  Pros: Loose coupling
  Cons: Hard to see overall flow

- Orchestration: Central coordinator calls each step
  Order Saga: OrderService calls InventoryService, then ShippingService
  Pros: Clear flow, easier to debug
  Cons: Central service knows too much
```

---

## API Gateway Pattern

```nginx
# nginx as API gateway
# Single entry point → routes to internal services

upstream user-service {
  server user-service:3001;
  server user-service-2:3001;
  keepalive 32;
}

upstream order-service {
  server order-service:3002;
  keepalive 32;
}

server {
  # Route based on path prefix
  location /api/v1/users {
    proxy_pass http://user-service;
    proxy_set_header X-Request-ID $request_id;
    proxy_read_timeout 10s;
  }

  location /api/v1/orders {
    proxy_pass http://order-service;
    proxy_read_timeout 30s;  # Orders take longer
  }

  # Rate limiting at gateway level
  limit_req_zone $binary_remote_addr zone=api:10m rate=100r/m;
  limit_req zone=api burst=20 nodelay;
}
```

---

## 12-Factor App Principles (Production Checklist)

```
1. Codebase      — One codebase, many deploys (git)
2. Dependencies  — Explicitly declare (package.json, requirements.txt)
3. Config        — Store in environment (not code)
4. Backing services — Treat as attached resources (DB, Redis = env var URLs)
5. Build/release/run — Strict separation
6. Processes     — Stateless, share-nothing (sessions in Redis, not memory)
7. Port binding  — Self-contained, export via port
8. Concurrency   — Scale via process model
9. Disposability — Fast startup, graceful shutdown
10. Dev/prod parity — Keep environments as similar as possible
11. Logs         — Treat as event streams (stdout, not files)
12. Admin processes — Run as one-off processes
```

---

## Graceful Shutdown

```javascript
// ✅ Critical for zero-downtime deploys
const server = app.listen(PORT);

async function shutdown(signal) {
  logger.info({ signal }, 'Received shutdown signal');
  
  // 1. Stop accepting new connections
  server.close();
  
  // 2. Let in-flight requests complete (with timeout)
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      logger.warn('Forcing shutdown after timeout');
      resolve();
    }, 30000);
    
    server.on('close', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
  
  // 3. Close background workers
  await worker.close();
  
  // 4. Close DB connections
  await sequelize.close();
  await redis.quit();
  
  logger.info('Graceful shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```
