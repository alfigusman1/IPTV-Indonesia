# Security Compliance & Governance Reference

## Framework Comparison

| Framework | Focus | Industry | Audit? |
|-----------|-------|----------|--------|
| ISO 27001 | ISMS — comprehensive security management | Any | Yes (cert) |
| NIST CSF | Risk-based framework: Identify/Protect/Detect/Respond/Recover | US Gov/Critical Infra | No |
| SOC 2 Type II | Trust Service Criteria (availability, security, confidentiality) | SaaS/Cloud | Yes (3rd party) |
| PCI-DSS v4 | Cardholder data protection | Payment processing | Yes (QSA) |
| HIPAA | Protected Health Information (PHI) | Healthcare (US) | No (self-assess) |
| CIS Controls v8 | Prioritized 18 controls for practical defense | Any | No |

---

## ISO 27001:2022 — Key Domains

```
Annex A Controls (93 total, 4 themes):
├── Organizational (37) — policies, roles, supplier security, threat intelligence
├── People (8) — screening, training, disciplinary process
├── Physical (14) — secure areas, equipment security, clear desk
└── Technological (34) — access control, cryptography, network security, SIEM

Mandatory Clauses (4-10):
4. Context of the organization
5. Leadership
6. Planning (risk assessment, risk treatment plan, Statement of Applicability)
7. Support
8. Operation
9. Performance evaluation (internal audit, management review)
10. Improvement (nonconformities, corrective action)

Key Documents Required:
□ Information Security Policy
□ Risk Assessment Methodology
□ Risk Register + Risk Treatment Plan
□ Statement of Applicability (SoA)
□ Asset Inventory
□ Access Control Policy
□ Incident Response Procedure
□ Business Continuity Plan
□ Internal Audit Reports
□ Management Review Minutes
```

---

## NIST Cybersecurity Framework 2.0

```
GOVERN (NEW in CSF 2.0)
└── Establish cybersecurity strategy, policies, roles, risk tolerance

IDENTIFY
└── Asset management, risk assessment, supply chain risk

PROTECT  
└── Access control, awareness training, data security, platform security

DETECT
└── Continuous monitoring, anomaly detection, event analysis

RESPOND
└── Incident management, communication, analysis, mitigation

RECOVER
└── Recovery planning, improvements, communications

Maturity Tiers (1-4):
1 = Partial (reactive, ad-hoc)
2 = Risk Informed (policies exist but not org-wide)
3 = Repeatable (org-wide, formally approved)
4 = Adaptive (continuous improvement, threat intel integration)
```

---

## PCI-DSS v4.0 — 12 Requirements

```
Requirements:
1. Install and maintain network security controls (firewalls)
2. Apply secure configurations (no defaults)
3. Protect stored account data (encryption, truncation)
4. Protect cardholder data in transit (TLS 1.2+)
5. Protect against malware (AV, EDR)
6. Develop/maintain secure systems (patching, SAST/DAST)
7. Restrict access by business need-to-know
8. Identify users, authenticate access (MFA required for v4!)
9. Restrict physical access
10. Log and monitor all access to cardholder data
11. Test security regularly (pentest, ASV scans, file integrity)
12. Support information security with organizational policies

Scope reduction:
- Network segmentation to isolate CDE (Cardholder Data Environment)
- Tokenization to remove PANs from systems
- Point-to-Point Encryption (P2PE) — reduces scope significantly

Key v4 changes:
- MFA required for ALL CDE access (not just remote)
- Targeted risk analysis for many controls
- Customized approach available for mature programs
- Phased timeline: 31 March 2025 for all requirements
```

---

## SOC 2 Type II

```
Trust Service Criteria:
CC — Common Criteria (Security) — REQUIRED
A  — Availability — optional
C  — Confidentiality — optional
PI — Processing Integrity — optional
P  — Privacy — optional

Key Controls for CC (Security):
CC6 — Logical & Physical Access Controls
  └── MFA, least privilege, access reviews, offboarding
CC7 — System Operations
  └── Vulnerability management, monitoring, incident response
CC8 — Change Management
  └── SDLC, code review, change approval process
CC9 — Risk Mitigation
  └── Vendor risk management, business continuity

Evidence to collect for audit:
□ MFA screenshots (all users)
□ Access review records (quarterly)
□ Penetration test report (annual)
□ Vulnerability scan results
□ Security training completion records
□ Incident response runbooks + any IR tickets
□ Encryption configs (in-transit + at-rest)
□ Vendor security assessments
```

---

## Risk Assessment Methodology

```
RISK = Likelihood × Impact

Qualitative scale:
Likelihood: Rare(1) / Unlikely(2) / Possible(3) / Likely(4) / Almost Certain(5)
Impact: Negligible(1) / Minor(2) / Moderate(3) / Major(4) / Critical(5)

Risk score:
1-4   = Low — Monitor
5-9   = Medium — Treat within 90 days
10-16 = High — Treat within 30 days
17-25 = Critical — Treat immediately

Risk treatment options:
1. MITIGATE — Implement controls to reduce likelihood/impact
2. TRANSFER — Insurance, outsourcing
3. ACCEPT — Residual risk within tolerance (document + sign-off)
4. AVOID — Stop the activity that creates the risk

CVSS for vuln-specific risk:
Base Score (0-10) — inherent severity
Temporal Score — exploit availability, patch status
Environmental Score — your specific context (network exposure, data sensitivity)
```

---

## Security Metrics (KPIs/KRIs)

```
Vulnerability Management:
- Mean Time to Patch Critical vulns (target: <7 days)
- % of critical vulns patched within SLA
- Attack surface coverage (% assets scanned)

Incident Response:
- Mean Time to Detect (MTTD)
- Mean Time to Respond (MTTR)
- Mean Time to Contain
- # of recurring incidents (same root cause)

Access Management:
- % accounts with MFA enabled (target: 100%)
- # orphaned accounts (left by departed employees)
- Privileged account ratio (minimize)
- Time to revoke access on offboarding (target: <4 hours)

Security Awareness:
- Phishing simulation click rate (target: <5%)
- Training completion rate (target: >95%)
- # reported phishing attempts (higher = better awareness)
```
