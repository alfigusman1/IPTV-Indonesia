# Secrets Management Reference

## Prinsip Zero-Trust Secrets

```
Aturan yang tidak boleh dilanggar:
1. Tidak ada hardcoded secret di kode atau konfigurasi
2. Tidak ada secret di environment variable container image
3. Setiap service punya credentials sendiri — tidak sharing
4. Rotasi otomatis untuk semua credentials
5. Audit log untuk setiap akses secret
6. Least privilege: service hanya bisa baca secret miliknya
7. Secret di-encrypt at rest DAN in transit
```

---

## AWS Secrets Manager

### Store dan Retrieve Secrets
```bash
# Simpan secret baru
aws secretsmanager create-secret \
  --name "production/myapp/database" \
  --description "Production database credentials" \
  --secret-string '{
    "username": "myapp_user",
    "password": "generated-strong-password",
    "host": "mydb.cluster.ap-southeast-1.rds.amazonaws.com",
    "port": 5432,
    "dbname": "myapp"
  }' \
  --kms-key-id "alias/myapp-secrets"  # ✅ Customer-managed KMS key

# Update secret value (buat versi baru)
aws secretsmanager put-secret-value \
  --secret-id "production/myapp/database" \
  --secret-string '{"password": "new-rotated-password", ...}'

# Retrieve secret
aws secretsmanager get-secret-value \
  --secret-id "production/myapp/database" \
  --query SecretString \
  --output text | jq .

# Ambil field tertentu
DB_PASSWORD=$(aws secretsmanager get-secret-value \
  --secret-id "production/myapp/database" \
  --query SecretString --output text | jq -r .password)
```

### Auto-Rotation untuk RDS
```python
# Lambda function untuk rotasi RDS credentials
import boto3
import json

def lambda_handler(event, context):
    arn = event['SecretId']
    token = event['ClientRequestToken']
    step = event['Step']

    sm = boto3.client('secretsmanager')
    rds = boto3.client('rds')

    if step == 'createSecret':
        # Generate password baru
        new_password = generate_strong_password()
        sm.put_secret_value(
            SecretId=arn,
            ClientRequestToken=token,
            SecretString=json.dumps({
                **get_current_secret(sm, arn),
                'password': new_password
            }),
            VersionStages=['AWSPENDING']
        )

    elif step == 'setSecret':
        # Update password di RDS
        pending = get_pending_secret(sm, arn, token)
        update_rds_password(rds, pending)

    elif step == 'testSecret':
        # Test koneksi dengan credentials baru
        test_connection(get_pending_secret(sm, arn, token))

    elif step == 'finishSecret':
        # Tandai versi baru sebagai current
        sm.update_secret_version_stage(
            SecretId=arn,
            VersionStage='AWSCURRENT',
            MoveToVersionId=token
        )
```

```hcl
# Terraform: konfigurasi auto-rotation
resource "aws_secretsmanager_secret_rotation" "db_rotation" {
  secret_id           = aws_secretsmanager_secret.db.id
  rotation_lambda_arn = aws_lambda_function.rotate_db.arn

  rotation_rules {
    automatically_after_days = 30  # ✅ Rotasi otomatis setiap 30 hari
  }
}
```

---

## HashiCorp Vault

### Setup dan Basic Operations
```bash
# Install Vault
brew install vault

# Development mode (jangan di production)
vault server -dev

# Production setup
vault server -config=/etc/vault/config.hcl

# config.hcl
storage "consul" {
  address = "127.0.0.1:8500"
  path    = "vault/"
}

listener "tcp" {
  address     = "0.0.0.0:8200"
  tls_cert_file = "/etc/vault/tls/vault.crt"
  tls_key_file  = "/etc/vault/tls/vault.key"
}

seal "awskms" {
  region     = "ap-southeast-1"
  kms_key_id = "alias/vault-unseal"  # ✅ Auto-unseal dengan KMS
}

api_addr = "https://vault.internal:8200"
cluster_addr = "https://vault.internal:8201"
ui = true

# Inisialisasi
vault operator init -key-shares=5 -key-threshold=3
# Simpan 5 unseal keys dan root token di tempat yang BERBEDA dan AMAN
```

### KV Secrets Engine
```bash
# Enable KV v2
vault secrets enable -path=secret kv-v2

# Simpan secret
vault kv put secret/myapp/database \
  username=myapp_user \
  password=strongpassword \
  host=mydb.internal

# Baca secret
vault kv get secret/myapp/database
vault kv get -field=password secret/myapp/database

# Versi secret
vault kv get -version=2 secret/myapp/database
vault kv metadata get secret/myapp/database

# Soft delete (bisa di-recover)
vault kv delete secret/myapp/database

# Undelete
vault kv undelete -versions=2 secret/myapp/database

# Hard delete (permanent)
vault kv destroy -versions=2 secret/myapp/database
```

### Dynamic Credentials — Database
```bash
# ✅ Vault generate temporary DB credentials — tidak ada static password!
vault secrets enable database

vault write database/config/mypostgres \
  plugin_name=postgresql-database-plugin \
  allowed_roles="myapp-role" \
  connection_url="postgresql://{{username}}:{{password}}@mydb.internal:5432/myapp" \
  username="vault_admin" \
  password="vault_admin_password"

vault write database/roles/myapp-role \
  db_name=mypostgres \
  creation_statements="CREATE ROLE \"{{name}}\" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}'; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO \"{{name}}\";" \
  default_ttl="1h" \
  max_ttl="24h"

# Aplikasi minta credentials
vault read database/creds/myapp-role
# Key             Value
# lease_id        database/creds/myapp-role/abc123
# username        v-token-abc123
# password        A1a-randompassword
# Setelah 1 jam, credentials otomatis expire!
```

### Vault Agent — Inject ke Aplikasi
```yaml
# Kubernetes: Vault Agent Injector
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  template:
    metadata:
      annotations:
        # ✅ Vault agent inject secret ke file
        vault.hashicorp.com/agent-inject: "true"
        vault.hashicorp.com/role: "myapp"
        vault.hashicorp.com/agent-inject-secret-db-creds: "secret/data/myapp/database"
        vault.hashicorp.com/agent-inject-template-db-creds: |
          {{- with secret "secret/data/myapp/database" -}}
          export DB_USERNAME="{{ .Data.data.username }}"
          export DB_PASSWORD="{{ .Data.data.password }}"
          {{- end }}
    spec:
      containers:
        - name: myapp
          command: ["/bin/sh", "-c"]
          args:
            - source /vault/secrets/db-creds && node server.js
```

---

## External Secrets Operator (Kubernetes)

```yaml
# ✅ Sync secret dari AWS Secrets Manager ke K8s Secret
apiVersion: external-secrets.io/v1beta1
kind: SecretStore
metadata:
  name: aws-secretsmanager
  namespace: production
spec:
  provider:
    aws:
      service: SecretsManager
      region: ap-southeast-1
      auth:
        jwt:
          serviceAccountRef:
            name: external-secrets-sa  # IRSA

---
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: myapp-db-credentials
  namespace: production
spec:
  refreshInterval: 1h    # ✅ Auto-sync setiap 1 jam
  secretStoreRef:
    name: aws-secretsmanager
    kind: SecretStore
  target:
    name: myapp-db-credentials  # Nama K8s Secret yang dibuat
    creationPolicy: Owner
  data:
    - secretKey: db-password     # Key di K8s Secret
      remoteRef:
        key: production/myapp/database   # Secret di AWS SM
        property: password               # Field di JSON
    - secretKey: db-username
      remoteRef:
        key: production/myapp/database
        property: username
```

---

## Secret Scanning — Cegah Commit

```bash
# ✅ Pre-commit hook dengan gitleaks
# Install
brew install gitleaks

# Scan repo
gitleaks detect --source . --verbose

# Scan sebelum commit (pre-commit hook)
cat .pre-commit-config.yaml
repos:
  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.18.0
    hooks:
      - id: gitleaks

# ✅ Detect-secrets (alternative)
pip install detect-secrets
detect-secrets scan > .secrets.baseline
detect-secrets audit .secrets.baseline

# Pre-commit hook
repos:
  - repo: https://github.com/Yelp/detect-secrets
    rev: v1.4.0
    hooks:
      - id: detect-secrets
        args: ['--baseline', '.secrets.baseline']
```

---

## Audit & Compliance

```bash
# AWS CloudTrail — audit siapa akses secret kapan
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventName,AttributeValue=GetSecretValue \
  --start-time 2026-01-01 \
  --end-time 2026-01-02

# Vault audit log
vault audit enable file file_path=/var/log/vault/audit.log

# Query audit log
cat /var/log/vault/audit.log | jq 'select(.type == "request") | {
  time: .time,
  path: .request.path,
  operation: .request.operation,
  client_token: .auth.display_name,
  remote_addr: .request.remote_address
}'

# Alert untuk akses secret yang mencurigakan
# (Contoh: akses dari IP luar, di luar jam kerja)
```
