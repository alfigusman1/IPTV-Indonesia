# CI/CD Pipeline Security Reference

## GitHub Actions — Production-Grade Pipeline

```yaml
# .github/workflows/deploy.yml
name: Build, Scan, and Deploy

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

# ✅ Minimal permissions di level workflow
permissions:
  contents: read

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  # ─────────────────────────────────────────
  # Job 1: Security checks sebelum build
  # ─────────────────────────────────────────
  security-check:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683  # v4.2.2
        with:
          fetch-depth: 0  # Full history untuk secret scanning

      # ✅ Secret scanning — cegah credential leak ke repo
      - name: Scan for secrets
        uses: trufflesecurity/trufflehog@main
        with:
          path: ./
          base: ${{ github.event.repository.default_branch }}
          head: HEAD
          extra_args: --only-verified

      # ✅ SAST — static analysis
      - name: Run Semgrep SAST
        uses: semgrep/semgrep-action@v1
        with:
          config: >-
            p/security-audit
            p/secrets
            p/owasp-top-ten
          auditOn: push

      # ✅ Dependency vulnerability scan
      - name: Run npm audit
        run: npm audit --audit-level=high

      - name: OWASP Dependency Check
        uses: dependency-check/Dependency-Check_Action@main
        with:
          project: 'myapp'
          path: '.'
          format: 'SARIF'
          failBuildOnCVSS: 7

  # ─────────────────────────────────────────
  # Job 2: Test
  # ─────────────────────────────────────────
  test:
    runs-on: ubuntu-latest
    needs: security-check
    permissions:
      contents: read
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_PASSWORD: testpass
          POSTGRES_DB: testdb
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - run: npm ci
      - run: npm run lint
      - run: npm test
        env:
          DATABASE_URL: postgresql://postgres:testpass@localhost:5432/testdb
          # ✅ Test secret dari GitHub Secrets — bukan hardcoded
          JWT_SECRET: ${{ secrets.TEST_JWT_SECRET }}

  # ─────────────────────────────────────────
  # Job 3: Build dan scan image
  # ─────────────────────────────────────────
  build:
    runs-on: ubuntu-latest
    needs: test
    permissions:
      contents: read
      packages: write
      id-token: write  # Untuk keyless signing dengan Cosign
      security-events: write
    outputs:
      image-digest: ${{ steps.build.outputs.digest }}
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=sha,format=long
            type=ref,event=branch

      - name: Build and push
        id: build
        uses: docker/build-push-action@v5
        with:
          push: ${{ github.ref == 'refs/heads/main' }}
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
          provenance: true   # ✅ SLSA provenance
          sbom: true         # ✅ Generate SBOM

      # ✅ Scan image setelah build
      - name: Scan image
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}@${{ steps.build.outputs.digest }}
          format: 'sarif'
          output: 'trivy-results.sarif'
          severity: 'CRITICAL,HIGH'
          exit-code: '1'

      - name: Upload scan results
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: 'trivy-results.sarif'

      # ✅ Sign image dengan Cosign (keyless)
      - name: Install Cosign
        uses: sigstore/cosign-installer@v3

      - name: Sign image
        run: |
          cosign sign --yes \
            ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}@${{ steps.build.outputs.digest }}

  # ─────────────────────────────────────────
  # Job 4: Deploy ke staging
  # ─────────────────────────────────────────
  deploy-staging:
    runs-on: ubuntu-latest
    needs: build
    environment: staging
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683

      # ✅ OIDC — tidak perlu long-lived AWS credentials
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789:role/github-actions-staging
          aws-region: ap-southeast-1

      - name: Deploy to EKS
        run: |
          aws eks update-kubeconfig --name staging-cluster
          kubectl set image deployment/myapp \
            myapp=${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}@${{ needs.build.outputs.image-digest }} \
            -n staging
          kubectl rollout status deployment/myapp -n staging --timeout=5m

  # ─────────────────────────────────────────
  # Job 5: Deploy ke production (manual approval)
  # ─────────────────────────────────────────
  deploy-production:
    runs-on: ubuntu-latest
    needs: deploy-staging
    environment: production  # ✅ Required reviewers di GitHub Environment
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789:role/github-actions-production
          aws-region: ap-southeast-1

      - name: Deploy to production
        run: |
          aws eks update-kubeconfig --name production-cluster
          kubectl set image deployment/myapp \
            myapp=${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}@${{ needs.build.outputs.image-digest }} \
            -n production
          kubectl rollout status deployment/myapp -n production --timeout=10m
```

---

## Supply Chain Security — SLSA

```
SLSA (Supply Chain Levels for Software Artifacts) Framework:

Level 1: Provenance ada (dokumentasi build process)
Level 2: Provenance ditandatangani, hosted build service
Level 3: Hardened build platform, non-falsifiable provenance
Level 4: Two-party review, hermetic builds

Target minimum: SLSA Level 2 untuk production

Checklist:
□ Build di CI/CD (bukan lokal developer)
□ Build logs tersimpan
□ Provenance di-generate dan di-sign
□ Source code + dependencies di-pin ke hash
□ SBOM di-generate setiap build
□ Image di-sign dengan Cosign
□ Artifact di-verify sebelum deploy
```

---

## GitLab CI — Pipeline Equivalent

```yaml
# .gitlab-ci.yml
stages:
  - security
  - test
  - build
  - deploy-staging
  - deploy-production

variables:
  DOCKER_TLS_CERTDIR: "/certs"
  IMAGE: $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA

# ✅ Security scan
sast:
  stage: security
  image: semgrep/semgrep:latest
  script:
    - semgrep --config=p/security-audit --config=p/secrets .
  only: [merge_requests, main]

secret-detection:
  stage: security
  image: trufflesecurity/trufflehog:latest
  script:
    - trufflehog git file://. --since-commit HEAD~1 --only-verified
  only: [merge_requests, main]

# ✅ Build dan scan
build-image:
  stage: build
  image: docker:24
  services:
    - docker:24-dind
  script:
    - docker login -u $CI_REGISTRY_USER -p $CI_REGISTRY_PASSWORD $CI_REGISTRY
    - docker build -t $IMAGE .
    - docker push $IMAGE
    - |
      # Scan setelah push
      docker run --rm \
        -v /var/run/docker.sock:/var/run/docker.sock \
        aquasec/trivy image \
        --exit-code 1 \
        --severity CRITICAL,HIGH \
        $IMAGE
  only: [main]
```

---

## Branch Protection & Code Review

```yaml
# GitHub Branch Protection Rules (via API atau UI)
# Settings → Branches → Add rule

required_status_checks:
  strict: true
  contexts:
    - "security-check"
    - "test"
    - "build"

enforce_admins: true                    # ✅ Admin pun perlu review
required_pull_request_reviews:
  required_approving_review_count: 2    # ✅ Minimal 2 approver
  dismiss_stale_reviews: true           # ✅ Dismiss jika ada push baru
  require_code_owner_reviews: true      # ✅ CODEOWNERS wajib approve
  require_last_push_approval: true      # ✅ Last pusher tidak bisa self-approve

restrictions:
  users: []
  teams: ["senior-engineers"]

allow_force_pushes: false               # ✅ No force push
allow_deletions: false                  # ✅ No branch deletion
```

---

## Rollback Strategy

```bash
# ✅ Kubernetes — rollback deployment
# Cek history
kubectl rollout history deployment/myapp -n production

# Rollback ke revision sebelumnya
kubectl rollout undo deployment/myapp -n production

# Rollback ke revision spesifik
kubectl rollout undo deployment/myapp -n production --to-revision=3

# Monitor rollback
kubectl rollout status deployment/myapp -n production

# ✅ Canary deployment dengan Argo Rollouts
# Progressive delivery: 10% → 25% → 50% → 100%
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: myapp
spec:
  strategy:
    canary:
      steps:
        - setWeight: 10
        - pause: {duration: 5m}   # Pause 5 menit, monitor metrics
        - setWeight: 25
        - pause: {duration: 10m}
        - setWeight: 50
        - pause: {duration: 10m}
        - setWeight: 100
      analysis:
        templates:
          - templateName: error-rate
        startingStep: 1
        args:
          - name: service-name
            value: myapp
```
