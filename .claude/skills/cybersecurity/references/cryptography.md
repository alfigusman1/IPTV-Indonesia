# Cryptography for Security Professionals

## Common Crypto Vulnerabilities

### Symmetric Encryption Failures

```python
# FAIL: ECB mode — identical plaintext blocks = identical ciphertext (pattern leakage)
from Crypto.Cipher import AES
cipher = AES.new(key, AES.MODE_ECB)  # ❌ Never use ECB

# FAIL: Static IV — if IV never changes, same plaintext = same ciphertext
iv = b'\x00' * 16  # ❌ Hardcoded IV

# FAIL: Reused nonce in CTR/GCM — destroys confidentiality
# Two ciphertexts with same key+nonce: C1 XOR C2 = P1 XOR P2

# CORRECT: Use AES-GCM with random nonce
import os
from Crypto.Cipher import AES
key = os.urandom(32)        # 256-bit key
nonce = os.urandom(12)      # 96-bit random nonce (GCM standard)
cipher = AES.new(key, AES.MODE_GCM, nonce=nonce)
ciphertext, tag = cipher.encrypt_and_digest(plaintext)
# tag = authentication tag (prevents tampering)
```

### Padding Oracle Attack
```
Vulnerable: CBC mode without MAC (encrypt-then-MAC is correct)

Attack flow:
1. Intercept ciphertext: C1 || C2 (two blocks)
2. Modify C1 byte by byte, observe if server returns "padding error"
3. When no padding error: deduced plaintext byte
4. Repeat for full block → full decryption without key

Detection: Server returns different errors for "padding invalid" vs "wrong data"
Fix: Constant-time comparison, return same error for all failures
```

### RSA Vulnerabilities
```python
# FAIL: Textbook RSA (no padding) — deterministic, malleable
# FAIL: PKCS#1 v1.5 padding — vulnerable to Bleichenbacher attack (timing oracle)
# CORRECT: OAEP for encryption, PSS for signatures

from Crypto.PublicKey import RSA
from Crypto.Cipher import PKCS1_OAEP
from Crypto.Signature import pss
from Crypto.Hash import SHA256

# Encryption
key = RSA.generate(2048)  # minimum 2048, prefer 4096
cipher = PKCS1_OAEP.new(key.publickey())
ciphertext = cipher.encrypt(message)

# Signing
h = SHA256.new(message)
signature = pss.new(key).sign(h)

# FAIL: Small public exponent e=3 with no padding
# If m^3 < n, can take cube root without modular reduction → trivial decryption
```

---

## JWT Security

```python
# JWT structure: base64url(header).base64url(payload).base64url(signature)

# ATTACK 1: Algorithm confusion — alg:none
# Change header to {"alg":"none","typ":"JWT"}, remove signature
# Fix: Explicitly whitelist allowed algorithms server-side

# ATTACK 2: RS256 → HS256 confusion
# Server uses RS256 with public key K_pub
# Attacker changes alg to HS256, signs with K_pub as HMAC secret
# Fix: Never accept algorithm from token header — enforce server-side

# ATTACK 3: Weak HS256 secret
# Crack with: hashcat -a 0 -m 16500 <JWT> wordlist.txt
# Fix: Use at least 256-bit random secret

# ATTACK 4: JWT injection in claims
# {"username":"admin","role":"user <!-- ignored? --> ","admin":true}

# CORRECT JWT validation
import jwt
# Specify algorithm, verify expiration, validate claims
payload = jwt.decode(
    token,
    secret_key,
    algorithms=["HS256"],   # explicit, not from token
    options={"require": ["exp", "iat", "sub"]}
)
```

---

## TLS/SSL Vulnerabilities

```bash
# Test TLS config
testssl.sh --full https://target.com
sslyze --regular target.com:443

# Vulnerabilities to check:
# BEAST (CBC in TLS 1.0) - CVE-2011-3389
# CRIME (compression) - CVE-2012-4929
# BREACH (HTTP compression) - CVE-2013-3587
# POODLE (SSLv3 CBC) - CVE-2014-3566
# HEARTBLEED (OpenSSL) - CVE-2014-0160
# FREAK (export ciphers) - CVE-2015-0204
# DROWN (SSLv2) - CVE-2016-0800
# ROBOT (RSA PKCS#1 v1.5) - CVE-2017-13099

# Minimum secure TLS config:
# Protocol: TLS 1.2+ (TLS 1.3 preferred)
# Key exchange: ECDHE (forward secrecy)
# Ciphers: AES-GCM, ChaCha20-Poly1305
# Avoid: RC4, DES, 3DES, MD5, SHA1, NULL ciphers
```

---

## Password Storage

```python
# FAIL: Plaintext, MD5, SHA1, unsalted SHA256
# These are trivially crackable with rainbow tables / GPU

# FAIL: Fast hashes (even salted) — bcrypt design goal: slow
# MD5: ~10 billion hashes/sec on modern GPU
# SHA256: ~3 billion hashes/sec

# CORRECT: Use slow, memory-hard algorithms
import bcrypt
import argon2  # pip install argon2-cffi

# bcrypt
hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12))
bcrypt.checkpw(password.encode(), hashed)  # verify

# Argon2id (OWASP recommended, 2023)
ph = argon2.PasswordHasher(
    time_cost=3,        # iterations
    memory_cost=65536,  # 64 MB
    parallelism=4,
    hash_len=32,
    salt_len=16
)
hash = ph.hash(password)
ph.verify(hash, password)  # verify

# PBKDF2 (if bcrypt/argon2 unavailable)
# iterations: 600,000+ for SHA-256 (OWASP 2023)
import hashlib, os
salt = os.urandom(16)
key = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 600000)
```

---

## Hash Cracking Reference

```bash
# Identify hash type
hashid hash.txt
hash-identifier

# Hashcat modes
-m 0     MD5
-m 100   SHA1
-m 1400  SHA256
-m 1800  sha512crypt (Linux $6$)
-m 500   md5crypt (Linux $1$)
-m 3200  bcrypt
-m 13100 Kerberos 5 TGS-REP (Kerberoast)
-m 18200 Kerberos 5 AS-REP (AS-REP Roast)
-m 5600  NetNTLMv2 (responder capture)
-m 1000  NTLM

# Attack modes
-a 0  Dictionary
-a 1  Combination (two wordlists)
-a 3  Brute force / mask
-a 6  Wordlist + mask

# Useful commands
hashcat -a 0 -m 1000 hashes.txt rockyou.txt
hashcat -a 0 -m 1000 hashes.txt rockyou.txt -r OneRuleToRuleThemAll.rule
hashcat -a 3 -m 1000 hashes.txt ?u?l?l?l?d?d?d?d  # mask: Abcd1234

# John the Ripper
john --format=bcrypt hashes.txt --wordlist=rockyou.txt
john --show hashes.txt
```
