# Monitoring & SRE Reference

## SLO / SLI / SLA — Definisi

```
SLI (Service Level Indicator)
  → Metrik yang diukur: request success rate, latency P99, error rate

SLO (Service Level Objective)
  → Target internal: "99.9% request berhasil dalam 500ms"
  → Lebih ketat dari SLA — buffer untuk tidak langsung breach SLA

SLA (Service Level Agreement)
  → Kontrak dengan customer: "99.5% uptime per bulan"
  → Breach = penalty finansial atau reputasi

Error Budget
  → Sisa "jatah down" sebelum breach SLO
  → 99.9% SLO = 0.1% error budget = 43.8 menit/bulan boleh error
  → Kalau error budget habis → freeze fitur, fokus reliability

Contoh SLO yang baik:
  Availability:   99.9% of requests return 2xx/3xx over 30 days
  Latency:        95% of requests complete in < 200ms
                  99% of requests complete in < 500ms
  Error rate:     < 0.1% of requests return 5xx
```

---

## Prometheus — Metrics Collection

### Konfigurasi Dasar
```yaml
# prometheus.yml
global:
  scrape_interval:     15s
  evaluation_interval: 15s
  external_labels:
    cluster: 'production'
    region:  'ap-southeast-1'

# Alerting
alerting:
  alertmanagers:
    - static_configs:
        - targets: ['alertmanager:9093']

# Rules
rule_files:
  - '/etc/prometheus/rules/*.yml'

# Scrape targets
scrape_configs:
  # Kubernetes pods dengan annotation
  - job_name: 'kubernetes-pods'
    kubernetes_sd_configs:
      - role: pod
    relabel_configs:
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
        action: keep
        regex: true
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_path]
        action: replace
        target_label: __metrics_path__
        regex: (.+)
      - source_labels: [__address__, __meta_kubernetes_pod_annotation_prometheus_io_port]
        action: replace
        regex: ([^:]+)(?::\d+)?;(\d+)
        replacement: $1:$2
        target_label: __address__

  # Node exporter
  - job_name: 'node-exporter'
    kubernetes_sd_configs:
      - role: node
    relabel_configs:
      - action: labelmap
        regex: __meta_kubernetes_node_label_(.+)
```

### Instrumentasi Aplikasi
```javascript
// Node.js — prom-client
const prometheus = require('prom-client');

// ✅ Default metrics (CPU, memory, event loop, GC)
prometheus.collectDefaultMetrics({ prefix: 'myapp_' });

// ✅ HTTP request metrics
const httpRequestDuration = new prometheus.Histogram({
  name: 'myapp_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

const httpRequestTotal = new prometheus.Counter({
  name: 'myapp_http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
});

// ✅ Business metrics
const ordersCreated = new prometheus.Counter({
  name: 'myapp_orders_created_total',
  help: 'Total orders created',
  labelNames: ['payment_method', 'status'],
});

const activeUsers = new prometheus.Gauge({
  name: 'myapp_active_users',
  help: 'Current active users',
});

// Middleware
app.use((req, res, next) => {
  const end = httpRequestDuration.startTimer();
  res.on('finish', () => {
    const labels = {
      method: req.method,
      route: req.route?.path || 'unknown',
      status_code: res.statusCode,
    };
    end(labels);
    httpRequestTotal.inc(labels);
  });
  next();
});

// Metrics endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', prometheus.register.contentType);
  res.send(await prometheus.register.metrics());
});
```

---

## Grafana — Dashboards

### Dashboard as Code (Grafonnet / JSON)
```json
// Dashboard JSON structure — simpan di git!
{
  "title": "MyApp Production",
  "uid": "myapp-production",
  "tags": ["production", "myapp"],
  "time": { "from": "now-1h", "to": "now" },
  "refresh": "30s",
  "panels": [
    {
      "title": "Request Rate",
      "type": "graph",
      "targets": [
        {
          "expr": "sum(rate(myapp_http_requests_total{status_code=~'2..'}[5m])) by (route)",
          "legendFormat": "{{route}}"
        }
      ]
    },
    {
      "title": "P95 Latency",
      "type": "graph",
      "targets": [
        {
          "expr": "histogram_quantile(0.95, sum(rate(myapp_http_request_duration_seconds_bucket[5m])) by (le, route))",
          "legendFormat": "P95 {{route}}"
        }
      ]
    },
    {
      "title": "Error Rate",
      "type": "stat",
      "targets": [
        {
          "expr": "sum(rate(myapp_http_requests_total{status_code=~'5..'}[5m])) / sum(rate(myapp_http_requests_total[5m])) * 100",
          "legendFormat": "Error %"
        }
      ],
      "thresholds": {
        "steps": [
          { "value": 0, "color": "green" },
          { "value": 0.1, "color": "yellow" },
          { "value": 1, "color": "red" }
        ]
      }
    }
  ]
}
```

---

## Alerting Rules

```yaml
# /etc/prometheus/rules/myapp.yml
groups:
  - name: myapp.critical
    interval: 30s
    rules:
      # ✅ High error rate
      - alert: HighErrorRate
        expr: |
          sum(rate(myapp_http_requests_total{status_code=~"5.."}[5m]))
          /
          sum(rate(myapp_http_requests_total[5m])) > 0.05
        for: 2m
        labels:
          severity: critical
          team: backend
        annotations:
          summary: "High error rate on {{ $labels.instance }}"
          description: "Error rate is {{ $value | humanizePercentage }} for 2 minutes"
          runbook: "https://wiki.internal/runbooks/high-error-rate"

      # ✅ High latency
      - alert: HighP95Latency
        expr: |
          histogram_quantile(0.95,
            sum(rate(myapp_http_request_duration_seconds_bucket[5m])) by (le)
          ) > 0.5
        for: 5m
        labels:
          severity: warning
          team: backend
        annotations:
          summary: "P95 latency above 500ms"
          description: "P95 latency is {{ $value | humanizeDuration }}"

      # ✅ Pod restart loop
      - alert: PodCrashLooping
        expr: |
          rate(kube_pod_container_status_restarts_total[15m]) * 60 > 5
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Pod {{ $labels.namespace }}/{{ $labels.pod }} crash looping"

      # ✅ Disk space
      - alert: DiskSpaceLow
        expr: |
          (node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"}) < 0.15
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Disk space low on {{ $labels.instance }}"
          description: "Only {{ $value | humanizePercentage }} disk space remaining"

      # ✅ SLO alert — error budget burn
      - alert: ErrorBudgetBurnRateFast
        expr: |
          (
            sum(rate(myapp_http_requests_total{status_code=~"5.."}[1h]))
            /
            sum(rate(myapp_http_requests_total[1h]))
          ) > (14.4 * 0.001)  # 14.4x burn rate untuk 1h window (SLO 99.9%)
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Fast error budget burn rate"
          description: "Burning error budget at 14.4x rate. SLO at risk."
```

---

## Alertmanager — Routing & Silencing

```yaml
# alertmanager.yml
global:
  resolve_timeout: 5m
  slack_api_url: 'https://hooks.slack.com/services/xxx'

route:
  group_by: ['alertname', 'cluster', 'service']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  receiver: 'default'

  routes:
    # Critical → PagerDuty (P0/P1)
    - match:
        severity: critical
      receiver: pagerduty-critical
      continue: true  # Juga kirim ke Slack

    # Warning → Slack saja
    - match:
        severity: warning
      receiver: slack-warning

    # Security alerts → security channel
    - match:
        team: security
      receiver: slack-security

receivers:
  - name: 'default'
    slack_configs:
      - channel: '#alerts-production'
        title: '{{ template "slack.default.title" . }}'
        text: '{{ template "slack.default.text" . }}'

  - name: 'pagerduty-critical'
    pagerduty_configs:
      - service_key: $PAGERDUTY_KEY
        description: '{{ template "pagerduty.default.description" . }}'

  - name: 'slack-security'
    slack_configs:
      - channel: '#security-alerts'
        send_resolved: true

inhibit_rules:
  # Jangan alert warning kalau sudah critical
  - source_match:
      severity: 'critical'
    target_match:
      severity: 'warning'
    equal: ['alertname', 'cluster', 'service']
```

---

## Incident Response Runbook Template

```markdown
# Runbook: High Error Rate

## Severity: P1
## Owner: Backend Team
## Last Updated: 2026-01-15

## Symptoms
- Alert: HighErrorRate fired
- Error rate > 5% for 2+ minutes
- Users reporting errors / 500 responses

## Investigation Steps

### Step 1: Assess blast radius (2 minutes)
```bash
# Error rate per endpoint
kubectl top pods -n production
kubectl logs -n production deployment/myapp --tail=100 | grep "ERROR"

# Recent deployments?
kubectl rollout history deployment/myapp -n production
```

### Step 2: Check recent changes (3 minutes)
- Recent deployments di ArgoCD dashboard
- Recent DB migrations
- External dependencies status (check status page)

### Step 3: Identify root cause
```bash
# DB connection issues?
kubectl exec -it deployment/myapp -n production -- \
  node -e "require('./dist/db').pool.query('SELECT 1').then(() => console.log('DB OK'))"

# Check error logs dengan context
kubectl logs -n production -l app=myapp --since=10m | jq 'select(.level == "error")'
```

## Remediation

### Option A: Rollback (jika baru deploy)
```bash
kubectl rollout undo deployment/myapp -n production
kubectl rollout status deployment/myapp -n production
```

### Option B: Scale up (jika overload)
```bash
kubectl scale deployment/myapp --replicas=10 -n production
```

### Option C: Circuit break external dependency
```bash
kubectl set env deployment/myapp FEATURE_EXTERNAL_API=false -n production
```

## Post-Incident
- [ ] Write post-mortem dalam 24 jam
- [ ] 5 whys analysis
- [ ] Action items dengan due date dan owner
- [ ] Update runbook ini kalau ada yang kurang
```

---

## Logging Stack — ELK / Loki

```yaml
# Promtail — collect logs dari Kubernetes ke Loki
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: promtail
  namespace: monitoring
spec:
  template:
    spec:
      containers:
        - name: promtail
          image: grafana/promtail:2.9.0
          args:
            - -config.file=/etc/promtail/config.yml
          volumeMounts:
            - name: config
              mountPath: /etc/promtail
            - name: varlog
              mountPath: /var/log
              readOnly: true
            - name: varlibdockercontainers
              mountPath: /var/lib/docker/containers
              readOnly: true
      volumes:
        - name: varlog
          hostPath:
            path: /var/log
        - name: varlibdockercontainers
          hostPath:
            path: /var/lib/docker/containers

---
# Promtail config
scrape_configs:
  - job_name: kubernetes-pods
    kubernetes_sd_configs:
      - role: pod
    pipeline_stages:
      - json:
          expressions:
            level: level
            msg: message
            request_id: request_id
      - labels:
          level:
          request_id:
    relabel_configs:
      - source_labels: [__meta_kubernetes_namespace]
        target_label: namespace
      - source_labels: [__meta_kubernetes_pod_name]
        target_label: pod
      - source_labels: [__meta_kubernetes_container_name]
        target_label: container
```

```
# LogQL queries di Grafana
# Semua error dari myapp
{namespace="production", app="myapp"} |= "ERROR"

# Parse JSON dan filter
{namespace="production", app="myapp"} | json | level="error"

# Rate of errors per minute
rate({namespace="production", app="myapp"} |= "ERROR" [1m])

# Slow requests (> 1 detik)
{namespace="production", app="myapp"} | json | response_time > 1000
```
