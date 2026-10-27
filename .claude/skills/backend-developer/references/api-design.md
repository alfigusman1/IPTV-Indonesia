# API Design Reference

## RESTful Design Principles

### Resource Naming
```
✅ Nouns, not verbs
GET    /users              # list users
POST   /users              # create user
GET    /users/:id          # get user
PUT    /users/:id          # replace user (full update)
PATCH  /users/:id          # partial update
DELETE /users/:id          # delete user

✅ Nested resources (max 2 levels deep)
GET /users/:id/posts       # user's posts
GET /posts/:id/comments    # post's comments
❌ /users/:id/posts/:id/comments/:id/replies  # too deep — flatten it

✅ Use plural nouns
/users not /user
/orders not /order

✅ Actions as sub-resources when needed
POST /users/:id/activate
POST /payments/:id/refund
POST /sessions            # login
DELETE /sessions/:id      # logout
```

### Versioning Strategies
```
1. URL path (most common, most explicit)
   /api/v1/users
   /api/v2/users

2. Header versioning
   Accept: application/vnd.myapp.v2+json

3. Query param (not recommended for production)
   /users?version=2

Recommendation: URL versioning for public APIs.
Keep v1 alive for at least 12 months after v2 launch.
Sunset header: Sunset: Sat, 01 Jan 2027 00:00:00 GMT
```

### OpenAPI / Swagger Spec
```yaml
# Always document your API — use OpenAPI 3.0
openapi: 3.0.0
info:
  title: My API
  version: 1.0.0

paths:
  /users:
    post:
      summary: Create a user
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateUserRequest'
      responses:
        '201':
          description: User created
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/User'
        '400':
          $ref: '#/components/responses/ValidationError'
        '409':
          $ref: '#/components/responses/ConflictError'

components:
  schemas:
    CreateUserRequest:
      type: object
      required: [email, password]
      properties:
        email:
          type: string
          format: email
        password:
          type: string
          minLength: 8
```

---

## GraphQL Design

### Schema First
```graphql
# Define the schema first, implement second
type Query {
  user(id: ID!): User
  users(filter: UserFilter, pagination: PaginationInput): UserConnection!
}

type Mutation {
  createUser(input: CreateUserInput!): CreateUserPayload!
  updateUser(id: ID!, input: UpdateUserInput!): UpdateUserPayload!
}

type User {
  id: ID!
  email: String!
  name: String!
  posts(limit: Int = 10): [Post!]!
  createdAt: DateTime!
}

# Use payload types for mutations (allows adding fields later)
type CreateUserPayload {
  user: User
  errors: [UserError!]!
}

type UserError {
  field: String
  message: String!
}

# Relay-style pagination
type UserConnection {
  edges: [UserEdge!]!
  pageInfo: PageInfo!
  totalCount: Int!
}
```

### DataLoader for N+1 Prevention
```javascript
// ❌ Without DataLoader: N+1 queries
const posts = await Post.findAll();
for (const post of posts) {
  post.author = await User.findById(post.userId); // 1 query per post!
}

// ✅ With DataLoader: batches queries
const DataLoader = require('dataloader');

const userLoader = new DataLoader(async (userIds) => {
  const users = await User.findAll({ where: { id: userIds } });
  // Return in same order as userIds
  return userIds.map(id => users.find(u => u.id === id));
});

// In resolver
const Post = {
  author: (post, _, { loaders }) => loaders.user.load(post.userId)
  // DataLoader batches all these into ONE SELECT WHERE id IN (...)
};
```

---

## Webhook Design

```javascript
// Sending webhooks — production checklist
class WebhookSender {
  async send(endpoint, event) {
    const payload = JSON.stringify(event);
    const timestamp = Date.now();
    
    // ✅ HMAC signature so receiver can verify authenticity
    const signature = crypto
      .createHmac('sha256', this.signingSecret)
      .update(`${timestamp}.${payload}`)
      .digest('hex');

    const response = await axios.post(endpoint, payload, {
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `t=${timestamp},v1=${signature}`,
        'X-Webhook-Event': event.type,
        'X-Webhook-ID': event.id,         // for idempotency
        'X-Webhook-Timestamp': timestamp,
      },
      timeout: 10000,   // ✅ Always set timeout
    });

    return response;
  }
}

// Receiving webhooks — verify before processing
function verifyWebhook(payload, signatureHeader, secret) {
  const [timestampPart, sigPart] = signatureHeader.split(',');
  const timestamp = timestampPart.split('=')[1];
  const receivedSig = sigPart.split('=')[1];

  // ✅ Replay attack prevention (reject if > 5 minutes old)
  if (Math.abs(Date.now() - parseInt(timestamp)) > 300000) {
    throw new Error('Webhook timestamp too old');
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`)
    .digest('hex');

  // ✅ Constant-time comparison
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(receivedSig))) {
    throw new Error('Invalid webhook signature');
  }
}
```

---

## File Upload Patterns

```javascript
// ✅ Presigned URLs (preferred for large files — bypasses your server)
// Client → Your API (get presigned URL) → Client → S3 directly

// Step 1: Generate presigned URL
app.post('/api/uploads/presigned', authenticate, async (req, res) => {
  const { filename, contentType, size } = req.body;

  // Validate
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  if (!allowedTypes.includes(contentType)) {
    return res.status(400).json({ error: { code: 'INVALID_FILE_TYPE' } });
  }
  if (size > 10 * 1024 * 1024) { // 10MB max
    return res.status(400).json({ error: { code: 'FILE_TOO_LARGE' } });
  }

  const key = `uploads/${req.user.id}/${Date.now()}-${sanitize(filename)}`;
  const url = await s3.getSignedUrlPromise('putObject', {
    Bucket: process.env.S3_BUCKET,
    Key: key,
    ContentType: contentType,
    Expires: 300, // URL expires in 5 minutes
    Conditions: [['content-length-range', 0, size]],
  });

  res.json({ upload_url: url, key });
});

// Step 2: After upload, client confirms
app.post('/api/uploads/confirm', authenticate, async (req, res) => {
  const { key } = req.body;
  // Verify object exists in S3, store metadata in DB
  await db.media.create({ key, userId: req.user.id, uploadedAt: new Date() });
  res.json({ url: `https://cdn.example.com/${key}` });
});
```

---

## API Rate Limiting

```javascript
// ✅ Multi-tier rate limiting
// Per IP: prevent abuse from unknown clients
// Per user: enforce fair use after auth
// Per endpoint: protect expensive operations

const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');

// Global IP limit
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500,
  store: new RedisStore({ client: redis }),
  standardHeaders: true,      // Return rate limit headers
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests' }
    });
  }
});

// Strict limit for auth endpoints (prevent brute force)
const authLimiter = rateLimit({
  windowMs: 60 * 1000,       // 1 minute
  max: 5,                    // 5 attempts per minute
  skipSuccessfulRequests: true,
});

app.use('/api/', globalLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);

// Response headers (always include):
// X-RateLimit-Limit: 500
// X-RateLimit-Remaining: 243
// X-RateLimit-Reset: 1705316400
// Retry-After: 60 (when 429)
```

---

## Idempotency Keys

```javascript
// ✅ Critical for payment/financial mutations
// Client generates a UUID, sends as header
// Server stores result; if same key seen again, return cached result

app.post('/api/payments', authenticate, async (req, res) => {
  const idempotencyKey = req.headers['idempotency-key'];
  
  if (!idempotencyKey) {
    return res.status(400).json({ error: { code: 'IDEMPOTENCY_KEY_REQUIRED' } });
  }

  // Check if we've already processed this key
  const existing = await redis.get(`idempotency:${req.user.id}:${idempotencyKey}`);
  if (existing) {
    return res.status(200).json(JSON.parse(existing)); // Return cached result
  }

  // Process payment
  const result = await paymentService.charge(req.body);
  
  // Cache for 24 hours
  await redis.setex(
    `idempotency:${req.user.id}:${idempotencyKey}`,
    86400,
    JSON.stringify(result)
  );

  res.status(201).json(result);
});
```
