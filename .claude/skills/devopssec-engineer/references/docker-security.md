# Docker & Container Security Reference

## Dockerfile Hardening

### Multi-Stage Build yang Aman
```dockerfile
# ✅ Production-grade Dockerfile
# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app

# Install dependencies dulu (cache layer)
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

COPY . .
RUN npm run build

# Stage 2: Production — minimal image
FROM node:20-alpine AS production

# ✅ Update packages dan install security patches
RUN apk update && apk upgrade --no-cache && \
    apk add --no-cache dumb-init && \
    rm -rf /var/cache/apk/*

# ✅ Non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs

WORKDIR /app

# ✅ Copy hanya yang perlu dari builder
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --chown=nodejs:nodejs package.json .

# ✅ Drop ke non-root
USER nodejs

EXPOSE 3000

# ✅ dumb-init untuk signal handling yang proper
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/server.js"]

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1
```

### .dockerignore yang Benar
```
# ✅ Selalu ada .dockerignore
.git
.gitignore
.env
.env.*
*.md
node_modules
dist
coverage
.nyc_output
.DS_Store
*.log
docker-compose*.yml
Makefile
.github
tests
docs
```

### Common Dockerfile Anti-Patterns
```dockerfile
# ❌ JANGAN: Jalankan sebagai root
FROM ubuntu:latest
# ... tidak ada USER instruction
CMD ["node", "server.js"]  # jalan sebagai root!

# ❌ JANGAN: Secret di image layer
ARG API_KEY
ENV API_KEY=${API_KEY}  # masuk ke image history!
# Atau lebih buruk:
RUN echo "password=secret" > /app/config.env

# ❌ JANGAN: Tag latest di production
FROM node:latest  # version tidak terprediksi

# ❌ JANGAN: Install unnecessary tools di production
RUN apt-get install -y curl wget git vim  # attack surface lebih besar

# ❌ JANGAN: COPY semua tanpa filter
COPY . .  # tanpa .dockerignore yang tepat

# ❌ JANGAN: chmod 777
RUN chmod -R 777 /app  # world-writable = vulnerability
```

---

## Image Scanning

### Trivy — Scan Vulnerability
```bash
# Install
brew install aquasecurity/trivy/trivy  # macOS
# atau
curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh

# Scan image
trivy image myapp:latest

# Scan hanya severity HIGH dan CRITICAL
trivy image --severity HIGH,CRITICAL myapp:latest

# Scan dan output JSON untuk pipeline
trivy image --format json --output trivy-report.json myapp:latest

# Fail CI kalau ada critical vulnerability
trivy image --exit-code 1 --severity CRITICAL myapp:latest

# Scan Dockerfile (sebelum build)
trivy config --severity HIGH,CRITICAL Dockerfile

# Scan filesystem / repo
trivy fs --security-checks vuln,secret,config .

# Scan dengan .trivyignore untuk false positive
cat .trivyignore
# CVE-2021-XXXXX  # False positive, tidak applicable
```

### Grype — Alternatif Trivy
```bash
# Scan image
grype myapp:latest

# Scan dengan threshold
grype myapp:latest --fail-on high

# Output SARIF untuk GitHub Code Scanning
grype myapp:latest -o sarif > grype-results.sarif
```

### Integrasi di CI/CD
```yaml
# GitHub Actions — scan sebelum push
- name: Scan image for vulnerabilities
  uses: aquasecurity/trivy-action@master
  with:
    image-ref: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}
    format: 'sarif'
    output: 'trivy-results.sarif'
    severity: 'CRITICAL,HIGH'
    exit-code: '1'  # Fail jika ada critical/high

- name: Upload scan results to GitHub Security
  uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: 'trivy-results.sarif'
```

---

## Container Runtime Security

### Docker Compose — Production-Safe
```yaml
version: '3.9'
services:
  app:
    image: myapp:${IMAGE_TAG}
    user: "1001:1001"           # ✅ Non-root
    read_only: true             # ✅ Read-only filesystem
    tmpfs:
      - /tmp                    # ✅ Izinkan write hanya di /tmp
      - /var/run
    security_opt:
      - no-new-privileges:true  # ✅ Cegah privilege escalation
    cap_drop:
      - ALL                     # ✅ Drop semua capabilities
    cap_add:
      - NET_BIND_SERVICE        # ✅ Tambah hanya yang perlu
    environment:
      NODE_ENV: production
      # ❌ Jangan taruh secret di sini
    env_file:
      - .env.production         # Atau inject dari secrets manager
    ports:
      - "127.0.0.1:3000:3000"  # ✅ Bind ke localhost saja, bukan 0.0.0.0
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/health"]
      interval: 30s
      timeout: 5s
      retries: 3
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "5"
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 512M
        reservations:
          cpus: '0.25'
          memory: 128M
```

### Linux Capabilities — Least Privilege
```bash
# Lihat capabilities yang dibutuhkan binary
getcap /usr/bin/node
capsh --print

# Capabilities yang sering dibutuhkan (drop sisanya):
# NET_BIND_SERVICE  → Bind ke port < 1024
# SYS_PTRACE        → Debugging (jangan di production)
# CHOWN             → Ubah file ownership

# Cek proses berjalan dengan capability apa
cat /proc/1/status | grep Cap
capsh --decode=00000000a80425fb

# Rekomendasi: jalankan semua port di atas 1024
# Sehingga tidak perlu NET_BIND_SERVICE sama sekali
# Gunakan reverse proxy (nginx/traefik) untuk forward dari 80/443
```

---

## Image Signing dengan Cosign

```bash
# Install cosign
brew install sigstore/tap/cosign

# Generate key pair
cosign generate-key-pair
# Hasilkan: cosign.key (private) dan cosign.pub (public)

# Sign image setelah push
cosign sign --key cosign.key \
  ghcr.io/myorg/myapp@sha256:abc123...

# Verify sebelum deploy
cosign verify --key cosign.pub \
  ghcr.io/myorg/myapp@sha256:abc123...

# Keyless signing (menggunakan OIDC — tidak perlu manage key)
COSIGN_EXPERIMENTAL=1 cosign sign \
  ghcr.io/myorg/myapp@sha256:abc123...

# Policy enforcement di Kubernetes (dengan Sigstore Policy Controller)
apiVersion: policy.sigstore.dev/v1beta1
kind: ClusterImagePolicy
metadata:
  name: require-signed-images
spec:
  images:
    - glob: "ghcr.io/myorg/**"
  authorities:
    - keyless:
        url: https://fulcio.sigstore.dev
        identities:
          - issuer: https://token.actions.githubusercontent.com
            subject: "https://github.com/myorg/myapp/.github/workflows/deploy.yml@refs/heads/main"
```

---

## SBOM — Software Bill of Materials

```bash
# Generate SBOM dengan Syft
syft myapp:latest -o spdx-json > sbom.spdx.json
syft myapp:latest -o cyclonedx-json > sbom.cyclonedx.json

# Attach SBOM ke image (oci artifact)
cosign attach sbom --sbom sbom.spdx.json myapp:latest

# Scan SBOM untuk vulnerabilities
grype sbom:sbom.spdx.json

# Di CI/CD — generate dan attach SBOM setiap build
- name: Generate SBOM
  run: |
    syft ${{ env.IMAGE }} -o spdx-json > sbom.spdx.json

- name: Attach SBOM to image
  run: |
    cosign attach sbom --sbom sbom.spdx.json ${{ env.IMAGE }}
```

---

## Container Registry Security

```bash
# ✅ Scan semua image di registry secara periodik
# AWS ECR — enable Enhanced Scanning
aws ecr put-registry-scanning-configuration \
  --scan-type ENHANCED \
  --rules '[{"repositoryFilters": [{"filter": "*", "filterType": "WILDCARD"}], "scanFrequency": "CONTINUOUS_SCAN"}]'

# ✅ Lifecycle policy — hapus image lama
aws ecr put-lifecycle-policy \
  --repository-name myapp \
  --lifecycle-policy-text '{
    "rules": [
      {
        "rulePriority": 1,
        "description": "Keep last 10 production images",
        "selection": {
          "tagStatus": "tagged",
          "tagPrefixList": ["prod-"],
          "countType": "imageCountMoreThan",
          "countNumber": 10
        },
        "action": { "type": "expire" }
      },
      {
        "rulePriority": 2,
        "description": "Delete untagged images after 7 days",
        "selection": {
          "tagStatus": "untagged",
          "countType": "sinceImagePushed",
          "countUnit": "days",
          "countNumber": 7
        },
        "action": { "type": "expire" }
      }
    ]
  }'

# ✅ Immutable tags di ECR — cegah tag overwrite
aws ecr put-image-tag-mutability \
  --repository-name myapp \
  --image-tag-mutability IMMUTABLE
```
