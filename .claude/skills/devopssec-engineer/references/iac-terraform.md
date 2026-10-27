# Infrastructure as Code — Terraform Reference

## Project Structure

```
infrastructure/
├── environments/
│   ├── staging/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   ├── outputs.tf
│   │   └── terraform.tfvars
│   └── production/
│       ├── main.tf
│       ├── variables.tf
│       ├── outputs.tf
│       └── terraform.tfvars
├── modules/
│   ├── eks/
│   ├── rds/
│   ├── vpc/
│   └── security-group/
└── shared/
    ├── backend.tf
    └── providers.tf
```

## Remote State — Wajib untuk Production

```hcl
# backend.tf
terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"  # ✅ Pin major version
    }
  }

  # ✅ Remote state dengan enkripsi dan locking
  backend "s3" {
    bucket         = "mycompany-tf-state-production"
    key            = "production/eks/terraform.tfstate"
    region         = "ap-southeast-1"
    encrypt        = true                    # ✅ Enkripsi at rest
    kms_key_id     = "alias/terraform-state" # ✅ KMS key eksplisit
    dynamodb_table = "terraform-state-lock"  # ✅ State locking
    
    # ✅ Versioning di S3 bucket — bisa rollback state
    # Aktifkan via: aws s3api put-bucket-versioning ...
  }
}
```

---

## IAM — Least Privilege

```hcl
# ✅ IAM role dengan policy minimal
resource "aws_iam_role" "app_role" {
  name = "${var.app_name}-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Federated = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/${var.oidc_provider}"
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "${var.oidc_provider}:sub" = "system:serviceaccount:${var.namespace}:${var.service_account}"
            "${var.oidc_provider}:aud" = "sts.amazonaws.com"
          }
        }
      }
    ]
  })

  tags = local.common_tags
}

# ✅ Policy hanya untuk resource yang dibutuhkan
resource "aws_iam_role_policy" "app_policy" {
  name = "${var.app_name}-policy"
  role = aws_iam_role.app_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject"
        ]
        Resource = [
          "arn:aws:s3:::${var.bucket_name}/${var.app_name}/*"
          # ❌ JANGAN: Resource: "*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = [
          "arn:aws:secretsmanager:${var.region}:${data.aws_caller_identity.current.account_id}:secret:${var.environment}/${var.app_name}/*"
        ]
      }
    ]
  })
}
```

---

## VPC — Network Architecture

```hcl
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"

  name = "${var.project}-${var.environment}"
  cidr = var.vpc_cidr  # e.g. "10.0.0.0/16"

  azs              = data.aws_availability_zones.available.names
  private_subnets  = var.private_subnets   # e.g. ["10.0.1.0/24", "10.0.2.0/24"]
  public_subnets   = var.public_subnets    # e.g. ["10.0.101.0/24", "10.0.102.0/24"]
  database_subnets = var.database_subnets  # e.g. ["10.0.201.0/24", "10.0.202.0/24"]

  # ✅ NAT Gateway untuk private subnet outbound
  enable_nat_gateway     = true
  single_nat_gateway     = var.environment != "production"  # Multi-AZ di prod
  one_nat_gateway_per_az = var.environment == "production"

  # ✅ DNS untuk service discovery
  enable_dns_hostnames = true
  enable_dns_support   = true

  # ✅ VPC Flow Logs — audit network traffic
  enable_flow_log                      = true
  create_flow_log_cloudwatch_log_group = true
  create_flow_log_cloudwatch_iam_role  = true
  flow_log_max_aggregation_interval    = 60

  # ✅ Tags untuk EKS subnet discovery
  public_subnet_tags = {
    "kubernetes.io/role/elb"                    = 1
    "kubernetes.io/cluster/${local.cluster_name}" = "shared"
  }

  private_subnet_tags = {
    "kubernetes.io/role/internal-elb"           = 1
    "kubernetes.io/cluster/${local.cluster_name}" = "shared"
  }

  tags = local.common_tags
}
```

---

## Security Groups — Principle of Least Access

```hcl
# ✅ Security group untuk aplikasi
resource "aws_security_group" "app" {
  name_prefix = "${var.app_name}-app-"
  description = "Security group for ${var.app_name} application"
  vpc_id      = module.vpc.vpc_id

  # ✅ Ingress hanya dari load balancer
  ingress {
    description     = "HTTP from ALB"
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
    # ❌ JANGAN: cidr_blocks = ["0.0.0.0/0"]
  }

  # ✅ Egress ke DB saja
  egress {
    description     = "PostgreSQL to RDS"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.rds.id]
  }

  egress {
    description = "HTTPS to internet (dependencies, external APIs)"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # ❌ JANGAN: egress all
  # egress { from_port = 0; to_port = 0; protocol = "-1"; cidr_blocks = ["0.0.0.0/0"] }

  lifecycle {
    create_before_destroy = true
  }

  tags = merge(local.common_tags, { Name = "${var.app_name}-app" })
}
```

---

## IaC Security Scanning

```bash
# tfsec — static analysis untuk Terraform
brew install tfsec
tfsec .
tfsec --minimum-severity HIGH .
tfsec --format sarif --out tfsec-results.sarif .

# Checkov — multi-framework IaC scanner
pip install checkov
checkov -d . --framework terraform
checkov -d . --check CKV_AWS_18,CKV_AWS_19  # Specific checks

# Terrascan
terrascan scan -t aws

# Integrasi di CI
- name: Run tfsec
  uses: aquasecurity/tfsec-action@v1.0.0
  with:
    severity: HIGH
    soft_fail: false

# Terima false positive dengan komentar (tfsec)
resource "aws_s3_bucket" "public_assets" {
  bucket = "myapp-public-assets"

  # tfsec:ignore:aws-s3-no-public-buckets
  # tfsec:ignore:aws-s3-block-public-policy
  # Reason: This bucket serves public static assets (CDN origin)
}
```

---

## Terraform Best Practices

```hcl
# ✅ Variables dengan validasi
variable "environment" {
  type        = string
  description = "Deployment environment"

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "Environment must be staging or production."
  }
}

variable "instance_type" {
  type        = string
  default     = "t3.medium"

  validation {
    condition     = can(regex("^(t3|m5|c5)\\.(small|medium|large|xlarge)$", var.instance_type))
    error_message = "Instance type must be t3, m5, or c5 family."
  }
}

# ✅ Locals untuk nilai yang di-derived
locals {
  common_tags = {
    Environment = var.environment
    Project     = var.project_name
    ManagedBy   = "terraform"
    Owner       = var.team
    CostCenter  = var.cost_center
  }

  cluster_name = "${var.project_name}-${var.environment}"
}

# ✅ Data sources untuk referensi resource existing
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
data "aws_availability_zones" "available" {
  state = "available"
}

# ✅ Output yang berguna
output "eks_cluster_endpoint" {
  description = "EKS cluster endpoint"
  value       = module.eks.cluster_endpoint
  sensitive   = false
}

output "rds_connection_string" {
  description = "RDS connection string (without password)"
  value       = "postgresql://${var.db_username}@${aws_db_instance.main.endpoint}/${var.db_name}"
  sensitive   = false  # Password di secrets manager, bukan di output
}
```

---

## Drift Detection & Compliance

```bash
# ✅ Deteksi drift — perubahan manual di luar Terraform
terraform plan -detailed-exitcode
# Exit code 0: No diff
# Exit code 1: Error
# Exit code 2: Diff found (drift!)

# Jadwalkan drift detection di CI (setiap hari)
# .github/workflows/drift-detection.yml
name: Drift Detection
on:
  schedule:
    - cron: '0 8 * * *'  # Setiap hari jam 8 pagi

jobs:
  detect-drift:
    steps:
      - name: Terraform Plan
        run: terraform plan -detailed-exitcode
        continue-on-error: true

      - name: Alert if drift detected
        if: steps.plan.outcome == 'failure'
        run: |
          curl -X POST ${{ secrets.SLACK_WEBHOOK }} \
            -d '{"text": "⚠️ Infrastructure drift detected in production!"}'

# ✅ Terrascan policy as code
cat > .terrascan/policies/require-tags.rego << 'EOF'
package accurics

required_tags := ["Environment", "ManagedBy", "Owner"]

deny[msg] {
  resource := input.resources[_]
  resource.type == "aws_instance"
  missing_tag := required_tags[_]
  not resource.config.tags[missing_tag]
  msg := sprintf("Resource %s missing required tag: %s", [resource.id, missing_tag])
}
EOF
```
