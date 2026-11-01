# Authentication & Authorization Reference

## JWT Best Practices

```javascript
const jwt = require('jsonwebtoken');

// ✅ Token generation
function generateTokens(userId, sessionId) {
  const accessToken = jwt.sign(
    {
      sub: userId,
      sid: sessionId,   // session ID for revocation
      type: 'access',
    },
    process.env.JWT_SECRET,
    {
      expiresIn: '15m',     // Short-lived
      issuer: 'api.myapp.com',
      audience: 'myapp.com',
    }
  );

  const refreshToken = jwt.sign(
    { sub: userId, sid: sessionId, type: 'refresh' },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: '30d' }
  );

  return { accessToken, refreshToken };
}

// ✅ Verification — always specify algorithms
function verifyAccessToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET, {
    algorithms: ['HS256'],     // Explicit, not from token header
    issuer: 'api.myapp.com',
    audience: 'myapp.com',
  });
}

// ✅ Token rotation
async function refreshTokens(refreshToken) {
  const payload = verifyRefreshToken(refreshToken);
  
  // Check session is still valid (revocation)
  const session = await db.sessions.findOne({
    where: { id: payload.sid, userId: payload.sub, revokedAt: null }
  });
  if (!session) throw new Error('Session revoked');
  
  // Rotate refresh token (old one becomes invalid)
  await db.sessions.update(
    { lastSeenAt: new Date() },
    { where: { id: payload.sid } }
  );
  
  return generateTokens(payload.sub, payload.sid);
}

// ✅ Storage: httpOnly cookie (not localStorage — XSS safe)
res.cookie('access_token', accessToken, {
  httpOnly: true,
  secure: true,         // HTTPS only
  sameSite: 'strict',   // CSRF protection
  maxAge: 15 * 60 * 1000,
});
```

---

## OAuth2 / OpenID Connect

```javascript
// Authorization Code Flow (for web apps with backend)
// 1. Redirect user to provider
const authUrl = `https://accounts.google.com/o/oauth2/auth?` +
  `client_id=${CLIENT_ID}` +
  `&redirect_uri=${REDIRECT_URI}` +
  `&scope=openid email profile` +
  `&response_type=code` +
  `&state=${generateState()}`; // CSRF protection

// 2. Handle callback
app.get('/auth/callback', async (req, res) => {
  const { code, state } = req.query;
  
  // ✅ Verify state to prevent CSRF
  if (!verifyState(state)) return res.status(400).send('Invalid state');
  
  // Exchange code for tokens
  const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
    code,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
  });
  
  // Get user info from ID token (don't trust userinfo endpoint alone)
  const idToken = tokenResponse.data.id_token;
  const userInfo = await verifyGoogleIdToken(idToken);
  
  // Find or create user
  const user = await db.users.findOrCreate({
    where: { email: userInfo.email },
    defaults: { name: userInfo.name, googleId: userInfo.sub },
  });
  
  // Create session
  const tokens = generateTokens(user.id, await createSession(user.id));
  res.redirect(`/app?token=${tokens.accessToken}`);
});
```

---

## RBAC (Role-Based Access Control)

```javascript
// ✅ Permission-based (more granular than role-based)
const PERMISSIONS = {
  // Format: resource:action
  'users:read':   'View users',
  'users:write':  'Create/edit users',
  'users:delete': 'Delete users',
  'orders:read':  'View orders',
  'orders:write': 'Create/edit orders',
  'reports:read': 'View reports',
};

const ROLES = {
  admin:   Object.keys(PERMISSIONS),  // all permissions
  manager: ['users:read', 'orders:read', 'orders:write', 'reports:read'],
  support: ['users:read', 'orders:read'],
  viewer:  ['orders:read', 'reports:read'],
};

// Middleware
function requirePermission(permission) {
  return (req, res, next) => {
    const userPermissions = getUserPermissions(req.user);
    if (!userPermissions.includes(permission)) {
      return res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'Insufficient permissions' }
      });
    }
    next();
  };
}

// Usage
app.delete('/api/users/:id', 
  authenticate,
  requirePermission('users:delete'),
  deleteUserHandler
);

// Resource-level authorization (ownership check)
async function getOrder(req, res) {
  const order = await Order.findByPk(req.params.id);
  if (!order) return res.status(404).json({ error: 'Not found' });
  
  // ✅ Check ownership — not just authentication
  if (order.userId !== req.user.id && !req.user.hasPermission('orders:read')) {
    return res.status(403).json({ error: { code: 'FORBIDDEN' } });
  }
  
  res.json({ data: order });
}
```

---

## API Key Authentication

```javascript
// ✅ API key generation and storage
async function createApiKey(userId, name) {
  const rawKey = `sk_live_${crypto.randomBytes(32).toString('base64url')}`;
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  
  // ✅ Store only the hash — never the raw key
  await db.apiKeys.create({
    userId,
    name,
    keyHash,
    prefix: rawKey.substring(0, 12),  // for identification
    lastUsedAt: null,
    expiresAt: null,
  });
  
  // ✅ Return raw key ONCE — user must copy it now
  return rawKey;
}

// Verify
async function verifyApiKey(rawKey) {
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const apiKey = await db.apiKeys.findOne({
    where: { keyHash, revokedAt: null },
    include: [{ model: User }],
  });
  if (!apiKey) return null;
  
  // Update last used (async, don't await in request path)
  db.apiKeys.update({ lastUsedAt: new Date() }, { where: { id: apiKey.id } }).catch(() => {});
  
  return apiKey.user;
}
```

---

## Common Security Vulnerabilities

### CORS Configuration
```javascript
// ✅ Explicit allowlist — never use wildcard in production
const corsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = [
      'https://app.mycompany.com',
      'https://admin.mycompany.com',
      process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : null,
    ].filter(Boolean);
    
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,        // Allow cookies
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};
app.use(cors(corsOptions));
```

### Security Headers
```javascript
const helmet = require('helmet');
app.use(helmet());  // Sets many headers automatically

// Key headers Helmet sets:
// X-Content-Type-Options: nosniff
// X-Frame-Options: DENY
// Strict-Transport-Security: max-age=31536000; includeSubDomains
// X-XSS-Protection: 0  (modern browsers don't need it, can cause issues)

// Content-Security-Policy (customize per app)
app.use(helmet.contentSecurityPolicy({
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "https://cdn.example.com"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:", "https:"],
    connectSrc: ["'self'", "https://api.example.com"],
    frameSrc: ["'none'"],
  },
}));
```

### SQL Injection Prevention
```javascript
// ✅ Parameterized queries — always
const user = await db.query(
  'SELECT * FROM users WHERE email = $1',
  [email]  // Never string concatenation
);

// ✅ ORM with proper escaping
const user = await User.findOne({ where: { email } });

// ❌ String concatenation = SQL injection
const user = await db.query(`SELECT * FROM users WHERE email = '${email}'`);
```

### Secrets Management
```bash
# ✅ Never hardcode secrets
# ✅ Never commit .env to git (.gitignore it)
# ✅ Use secret manager in production

# AWS Secrets Manager
aws secretsmanager get-secret-value --secret-id prod/myapp/db

# HashiCorp Vault
vault kv get secret/myapp/prod

# Rotate secrets without downtime:
# 1. Add new secret version
# 2. Deploy app that reads both old+new
# 3. Update infrastructure to use new secret
# 4. Remove old secret after confirmation
```
