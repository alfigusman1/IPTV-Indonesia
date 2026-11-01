# Async Processing & Message Queues Reference

## When to Use Async Processing

```
Synchronous (inline):           Async (queued):
- Simple reads                  - Sending emails/SMS
- Lightweight writes            - Image/video processing
- Auth checks                   - PDF generation
- Response < 500ms              - External API calls (slow)
- User needs result NOW         - Webhooks delivery
                                - Bulk operations
                                - Scheduled reports
                                - Anything > 1 second
```

---

## Job Queue Patterns

### BullMQ (Node.js — Redis-backed)
```javascript
const { Queue, Worker, QueueEvents } = require('bullmq');
const redis = { host: 'localhost', port: 6379 };

// Producer — add jobs to queue
const emailQueue = new Queue('emails', { connection: redis });

async function sendWelcomeEmail(userId) {
  await emailQueue.add(
    'welcome',
    { userId },
    {
      attempts: 3,                    // Retry up to 3 times
      backoff: { type: 'exponential', delay: 5000 },  // 5s, 25s, 125s
      removeOnComplete: { count: 100 },  // Keep last 100 completed
      removeOnFail: { count: 500 },      // Keep last 500 failed
    }
  );
}

// Consumer — process jobs
const worker = new Worker('emails', async (job) => {
  const { userId } = job.data;
  
  if (job.name === 'welcome') {
    const user = await db.users.findByPk(userId);
    await mailer.send({
      to: user.email,
      template: 'welcome',
      data: { name: user.name },
    });
  }
}, { connection: redis, concurrency: 5 });

// Error handling
worker.on('failed', (job, error) => {
  logger.error({ jobId: job.id, error: error.message }, 'Job failed');
});

// Scheduled jobs (cron)
await emailQueue.add('daily-digest', {}, {
  repeat: { pattern: '0 8 * * *' },  // 8am every day
});
```

### Celery (Python)
```python
from celery import Celery
from celery.utils.log import get_task_logger

app = Celery('myapp', broker='redis://localhost:6379/0')
logger = get_task_logger(__name__)

# Task definition
@app.task(
    bind=True,
    max_retries=3,
    default_retry_delay=60,  # seconds
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_jitter=True,
)
def process_payment(self, payment_id: str):
    try:
        payment = Payment.objects.get(id=payment_id)
        result = stripe.charge(payment.amount, payment.token)
        payment.mark_complete(result.id)
    except stripe.RateLimitError as e:
        raise self.retry(exc=e, countdown=60)
    except Exception as e:
        logger.error(f"Payment {payment_id} failed: {e}")
        raise

# Call async
process_payment.delay(payment_id='pay_123')

# Call with options
process_payment.apply_async(
    args=[payment_id],
    countdown=30,           # delay 30s
    eta=datetime(2026, 1, 1, 12, 0),  # run at specific time
    queue='priority',       # specific queue
)
```

---

## Message Queues (Kafka / RabbitMQ / SQS)

### Apache Kafka — Event Streaming
```javascript
const { Kafka } = require('kafkajs');

const kafka = new Kafka({
  clientId: 'payment-service',
  brokers: ['kafka1:9092', 'kafka2:9092'],
});

// Producer
const producer = kafka.producer({
  transactionalId: 'payment-producer',  // Exactly-once semantics
});

await producer.connect();
await producer.send({
  topic: 'order.created',
  messages: [{
    key: order.id,           // Key for partition assignment (same key → same partition → ordered)
    value: JSON.stringify({
      eventId: crypto.randomUUID(),
      eventType: 'order.created',
      timestamp: new Date().toISOString(),
      data: { orderId: order.id, userId: order.userId, total: order.total },
    }),
    headers: { source: 'order-service', version: '1' },
  }],
});

// Consumer
const consumer = kafka.consumer({ groupId: 'inventory-service' });
await consumer.connect();
await consumer.subscribe({ topic: 'order.created', fromBeginning: false });

await consumer.run({
  eachMessage: async ({ topic, partition, message }) => {
    const event = JSON.parse(message.value.toString());
    
    // ✅ Idempotent processing — check if already processed
    const processed = await redis.get(`event:${event.eventId}`);
    if (processed) return;  // Skip duplicates
    
    await inventoryService.reserve(event.data.orderId);
    
    // Mark as processed
    await redis.setex(`event:${event.eventId}`, 86400, '1');
  },
});
```

### AWS SQS + Lambda Pattern
```javascript
// SQS message → Lambda function (serverless workers)
exports.handler = async (event) => {
  const results = await Promise.allSettled(
    event.Records.map(async (record) => {
      const body = JSON.parse(record.body);
      
      try {
        await processRecord(body);
        // Success: SQS auto-deletes after successful Lambda return
      } catch (error) {
        logger.error({ messageId: record.messageId, error }, 'Processing failed');
        // Throw to tell SQS this record failed (goes to DLQ after max attempts)
        throw error;
      }
    })
  );

  // ✅ Partial batch failure — only fail the failed records
  const failures = results
    .map((r, i) => ({ result: r, id: event.Records[i].messageId }))
    .filter(({ result }) => result.status === 'rejected')
    .map(({ id }) => ({ itemIdentifier: id }));

  return { batchItemFailures: failures };
};
```

---

## Outbox Pattern (Guaranteed Delivery)

```javascript
// Problem: After DB write, message queue publish can fail
// Solution: Outbox table — write event to DB in same transaction

// 1. Write business data + outbox event atomically
async function createOrder(data) {
  await db.transaction(async (trx) => {
    const order = await Order.create(data, { transaction: trx });
    
    // ✅ Same transaction — either both succeed or both fail
    await OutboxEvent.create({
      id: crypto.randomUUID(),
      aggregateId: order.id,
      aggregateType: 'Order',
      eventType: 'order.created',
      payload: JSON.stringify(order),
      status: 'pending',
    }, { transaction: trx });
    
    return order;
  });
}

// 2. Background poller publishes outbox events
async function publishOutboxEvents() {
  const events = await OutboxEvent.findAll({
    where: { status: 'pending' },
    limit: 100,
    order: [['createdAt', 'ASC']],
  });

  for (const event of events) {
    try {
      await kafka.producer().send({
        topic: event.eventType,
        messages: [{ key: event.aggregateId, value: event.payload }],
      });
      await event.update({ status: 'published', publishedAt: new Date() });
    } catch (error) {
      await event.increment('failCount');
    }
  }
}

// Run poller every 5 seconds
setInterval(publishOutboxEvents, 5000);
```

---

## Dead Letter Queue & Retry Strategy

```javascript
// ✅ Exponential backoff with jitter
function retryDelay(attempt, baseDelay = 1000, maxDelay = 60000) {
  const exponential = baseDelay * Math.pow(2, attempt);
  const jitter = Math.random() * exponential * 0.25;
  return Math.min(exponential + jitter, maxDelay);
}
// attempt 0: ~1s, attempt 1: ~2s, attempt 2: ~4s, attempt 3: ~8s

// ✅ DLQ monitoring alert
const dlqDepth = await sqs.getQueueAttributes({
  QueueUrl: DLQ_URL,
  AttributeNames: ['ApproximateNumberOfMessages'],
});

if (parseInt(dlqDepth.Attributes.ApproximateNumberOfMessages) > 100) {
  await alerting.critical('DLQ depth exceeded 100 messages — manual review required');
}
```

---

## WebSockets & Real-Time

```javascript
// Socket.io with Redis adapter (multi-server support)
const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');

const io = new Server(server, {
  cors: { origin: 'https://app.example.com', credentials: true },
  pingTimeout: 20000,
  pingInterval: 10000,
});

// Redis pub/sub for scaling across multiple servers
io.adapter(createAdapter(pubClient, subClient));

io.use(async (socket, next) => {
  // ✅ Authenticate WebSocket connections
  const token = socket.handshake.auth.token;
  try {
    socket.user = verifyAccessToken(token);
    next();
  } catch {
    next(new Error('Unauthorized'));
  }
});

io.on('connection', (socket) => {
  // Join user-specific room
  socket.join(`user:${socket.user.id}`);

  socket.on('subscribe:order', async (orderId) => {
    // Verify user owns this order
    const order = await Order.findOne({ where: { id: orderId, userId: socket.user.id } });
    if (order) socket.join(`order:${orderId}`);
  });

  socket.on('disconnect', () => {
    logger.info({ userId: socket.user.id }, 'Client disconnected');
  });
});

// Emit from anywhere (other services)
io.to(`user:${userId}`).emit('notification', { type: 'order_update', orderId });
io.to(`order:${orderId}`).emit('status_changed', { status: 'shipped' });
```

---

## Scheduled Jobs (Cron)

```javascript
const cron = require('node-cron');

// ✅ Always use distributed lock for cron jobs running on multiple instances
cron.schedule('0 2 * * *', async () => {
  const lockAcquired = await redis.set('cron:cleanup', 1, 'NX', 'EX', 3600);
  if (!lockAcquired) return;  // Another instance is running this

  try {
    await cleanupExpiredSessions();
    await sendDailyDigestEmails();
    logger.info('Daily cron jobs completed');
  } catch (error) {
    logger.error({ error }, 'Cron job failed');
  }
});
```
