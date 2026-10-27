# Cloud Security Reference

## AWS Security Hardening

### Account-Level Baseline
```bash
# ✅ Aktifkan semua security services
# AWS SecurityHub — aggregasi temuan
aws securityhub enable-security-hub \
  --enable-default-standards \
  --region ap-southeast-1

# AWS GuardDuty — threat detection
aws guardduty create-detector \
  --enable \
  --finding-publishing-frequency FIFTEEN_MINUTES

# AWS Config — compliance monitoring
aws configservice put-configuration-recorder \
  --configuration-recorder name=default,roleARN=arn:aws:iam::123:role/AWSConfigRole \
  --recording-group allSupported=true,includeGlobalResourceTypes=true

# AWS CloudTrail — audit log
aws cloudtrail create-trail \
  --name production-trail \
  --s3-bucket-name mycompany-cloudtrail-logs \
  --include-global-service-events \
  --is-multi-region-trail \
  --enable-log-file-validation  # ✅ Validate log integrity

# ✅ MFA Delete di S3 (untuk state bucket)
aws s3api put-bucket-versioning \
  --bucket my-tf-state \
  --versioning-configuration Status=Enabled,MFADelete=Enabled \
  --mfa "arn:aws:iam::123:mfa/my-device 123456"
```

### IAM Hardening
```hcl
# ✅ Password policy yang kuat
resource "aws_iam_account_password_policy" "strict" {
  minimum_password_length        = 16
  require_uppercase_characters   = true
  require_lowercase_characters   = true
  require_numbers                = true
  require_symbols                = true
  allow_users_to_change_password = true
  max_password_age               = 90
  password_reuse_prevention      = 12
  hard_expiry                    = false
}

# ✅ SCP — Service Control Policy (prevent privilege escalation)
resource "aws_organizations_policy" "deny_root_usage" {
  name        = "DenyRootAccountUsage"
  type        = "SERVICE_CONTROL_POLICY"
  description = "Deny all root account activity"

  content = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Deny"
        Action    = "*"
        Resource  = "*"
        Condition = {
          StringLike = {
            "aws:PrincipalArn" = "arn:aws:iam::*:root"
          }
        }
      }
    ]
  })
}

# ✅ SCP — Deny leaving organization
resource "aws_organizations_policy" "deny_leave_org" {
  name    = "DenyLeaveOrganization"
  type    = "SERVICE_CONTROL_POLICY"
  content = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Deny"
      Action   = "organizations:LeaveOrganization"
      Resource = "*"
    }]
  })
}

# ✅ SCP — Enforce region restriction
resource "aws_organizations_policy" "restrict_regions" {
  name    = "RestrictRegions"
  type    = "SERVICE_CONTROL_POLICY"
  content = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Deny"
      NotAction = [
        "iam:*",
        "organizations:*",
        "support:*",
        "cloudfront:*"  # Global service
      ]
      Resource = "*"
      Condition = {
        StringNotEquals = {
          "aws:RequestedRegion" = ["ap-southeast-1", "ap-southeast-3"]
        }
      }
    }]
  })
}
```

### S3 Security
```hcl
# ✅ S3 bucket yang aman
resource "aws_s3_bucket" "app_data" {
  bucket = "${var.project}-${var.environment}-data"
  tags   = local.common_tags
}

# ✅ Block semua public access
resource "aws_s3_bucket_public_access_block" "app_data" {
  bucket = aws_s3_bucket.app_data.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ✅ Enkripsi dengan KMS
resource "aws_s3_bucket_server_side_encryption_configuration" "app_data" {
  bucket = aws_s3_bucket.app_data.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.s3.arn
    }
    bucket_key_enabled = true  # Kurangi KMS API calls
  }
}

# ✅ Versioning
resource "aws_s3_bucket_versioning" "app_data" {
  bucket = aws_s3_bucket.app_data.id
  versioning_configuration { status = "Enabled" }
}

# ✅ Lifecycle policy
resource "aws_s3_bucket_lifecycle_configuration" "app_data" {
  bucket = aws_s3_bucket.app_data.id

  rule {
    id     = "transition-and-expire"
    status = "Enabled"

    transition {
      days          = 30
      storage_class = "STANDARD_IA"
    }
    transition {
      days          = 90
      storage_class = "GLACIER"
    }
    expiration {
      days = 365
    }
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

# ✅ Access logging
resource "aws_s3_bucket_logging" "app_data" {
  bucket        = aws_s3_bucket.app_data.id
  target_bucket = aws_s3_bucket.access_logs.id
  target_prefix = "s3-access-logs/${aws_s3_bucket.app_data.id}/"
}
```

---

## WAF — Web Application Firewall

```hcl
resource "aws_wafv2_web_acl" "main" {
  name  = "${var.project}-${var.environment}"
  scope = "REGIONAL"  # atau CLOUDFRONT

  default_action {
    allow {}
  }

  # ✅ AWS Managed Rules — core ruleset
  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 1
    override_action { none {} }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
        # Override specific rules jika false positive
        rule_action_override {
          action_to_use { count {} }
          name = "SizeRestrictions_BODY"
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "AWSManagedRulesCommonRuleSet"
      sampled_requests_enabled   = true
    }
  }

  # ✅ Known bad inputs
  rule {
    name     = "AWSManagedRulesKnownBadInputsRuleSet"
    priority = 2
    override_action { none {} }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "KnownBadInputs"
      sampled_requests_enabled   = true
    }
  }

  # ✅ Rate limiting per IP
  rule {
    name     = "RateLimitRule"
    priority = 10
    action { block {} }
    statement {
      rate_based_statement {
        limit              = 2000  # requests per 5 menit
        aggregate_key_type = "IP"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "RateLimit"
      sampled_requests_enabled   = true
    }
  }

  # ✅ IP whitelist untuk admin endpoint
  rule {
    name     = "AdminIPWhitelist"
    priority = 5
    action { allow {} }
    statement {
      and_statement {
        statement {
          byte_match_statement {
            search_string = "/admin"
            field_to_match { uri_path {} }
            text_transformation { priority = 0; type = "LOWERCASE" }
            positional_constraint = "STARTS_WITH"
          }
        }
        statement {
          ip_set_reference_statement {
            arn = aws_wafv2_ip_set.office_ips.arn
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "AdminAccess"
      sampled_requests_enabled   = true
    }
  }

  tags = local.common_tags
}
```

---

## SSL/TLS — Certificate Management

```hcl
# ✅ ACM certificate dengan auto-renewal
resource "aws_acm_certificate" "main" {
  domain_name               = var.domain_name
  subject_alternative_names = ["*.${var.domain_name}"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = local.common_tags
}

# Auto-validate via Route53
resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.main.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }
  zone_id = data.aws_route53_zone.main.zone_id
  name    = each.value.name
  type    = each.value.type
  records = [each.value.record]
  ttl     = 60
}
```

```nginx
# ✅ Nginx TLS hardening
server {
  listen 443 ssl http2;
  server_name myapp.com;

  ssl_certificate     /etc/ssl/myapp.crt;
  ssl_certificate_key /etc/ssl/myapp.key;

  # ✅ TLS 1.2 minimum, prefer 1.3
  ssl_protocols TLSv1.2 TLSv1.3;

  # ✅ Strong cipher suites
  ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
  ssl_prefer_server_ciphers off;

  # ✅ HSTS — force HTTPS
  add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;

  # ✅ OCSP Stapling
  ssl_stapling on;
  ssl_stapling_verify on;
  ssl_trusted_certificate /etc/ssl/chain.crt;

  # ✅ Security headers
  add_header X-Frame-Options DENY always;
  add_header X-Content-Type-Options nosniff always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;
  add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;
  add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'nonce-{NONCE}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:;" always;
}

# ✅ Redirect HTTP ke HTTPS
server {
  listen 80;
  server_name myapp.com;
  return 301 https://$host$request_uri;
}
```

---

## Cloud Security Posture — AWS Config Rules

```hcl
# ✅ AWS Config Rules untuk compliance
resource "aws_config_config_rule" "mfa_enabled" {
  name = "mfa-enabled-for-iam-console-access"
  source {
    owner             = "AWS"
    source_identifier = "MFA_ENABLED_FOR_IAM_CONSOLE_ACCESS"
  }
}

resource "aws_config_config_rule" "s3_public_access" {
  name = "s3-bucket-public-access-prohibited"
  source {
    owner             = "AWS"
    source_identifier = "S3_BUCKET_PUBLIC_ACCESS_PROHIBITED"
  }
}

resource "aws_config_config_rule" "encrypted_volumes" {
  name = "encrypted-volumes"
  source {
    owner             = "AWS"
    source_identifier = "ENCRYPTED_VOLUMES"
  }
}

resource "aws_config_config_rule" "rds_encryption" {
  name = "rds-storage-encrypted"
  source {
    owner             = "AWS"
    source_identifier = "RDS_STORAGE_ENCRYPTED"
  }
}

resource "aws_config_config_rule" "no_unrestricted_ssh" {
  name = "restricted-ssh"
  source {
    owner             = "AWS"
    source_identifier = "INCOMING_SSH_DISABLED"
  }
}
```
