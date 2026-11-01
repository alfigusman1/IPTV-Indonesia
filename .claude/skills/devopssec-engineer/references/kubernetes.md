# Kubernetes Security & Operations Reference

## Pod Security — Manifest yang Hardened

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
  namespace: production
  labels:
    app: myapp
    version: "1.0.0"
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
      annotations:
        # ✅ Container security policy annotation (untuk Kyverno/OPA)
        seccomp.security.alpha.kubernetes.io/pod: runtime/default
    spec:
      # ✅ Jangan pakai default service account
      serviceAccountName: myapp-sa
      automountServiceAccountToken: false  # ✅ Tidak semua pod perlu ini

      # ✅ Pod-level security context
      securityContext:
        runAsNonRoot: true
        runAsUser: 1001
        runAsGroup: 1001
        fsGroup: 1001
        seccompProfile:
          type: RuntimeDefault
        sysctls: []

      containers:
        - name: myapp
          image: ghcr.io/myorg/myapp@sha256:abc123...  # ✅ Pin ke digest
          imagePullPolicy: Always

          ports:
            - containerPort: 3000
              protocol: TCP

          # ✅ Resource limits — WAJIB untuk mencegah noisy neighbor
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
            limits:
              cpu: "500m"
              memory: "512Mi"

          # ✅ Container-level security context
          securityContext:
            allowPrivilegeEscalation: false  # ✅ Cegah privilege escalation
            readOnlyRootFilesystem: true     # ✅ Read-only filesystem
            runAsNonRoot: true
            runAsUser: 1001
            capabilities:
              drop:
                - ALL                         # ✅ Drop semua capabilities
              add: []                         # Tambah hanya kalau perlu

          # ✅ Volume untuk direktori yang butuh write
          volumeMounts:
            - name: tmp
              mountPath: /tmp
            - name: cache
              mountPath: /app/cache

          # ✅ Health checks
          livenessProbe:
            httpGet:
              path: /health/live
              port: 3000
            initialDelaySeconds: 15
            periodSeconds: 20
            failureThreshold: 3

          readinessProbe:
            httpGet:
              path: /health/ready
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 10
            failureThreshold: 3

          startupProbe:
            httpGet:
              path: /health/live
              port: 3000
            failureThreshold: 30
            periodSeconds: 10

          # ✅ Env dari ConfigMap dan Secret — bukan hardcoded
          env:
            - name: NODE_ENV
              value: "production"
            - name: DB_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: myapp-secrets
                  key: db-password

          envFrom:
            - configMapRef:
                name: myapp-config

      volumes:
        - name: tmp
          emptyDir: {}
        - name: cache
          emptyDir:
            medium: Memory  # tmpfs — tidak persist ke disk
            sizeLimit: 100Mi

      # ✅ Pod disruption budget / topology spread
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: DoNotSchedule
          labelSelector:
            matchLabels:
              app: myapp
```

---

## RBAC — Least Privilege

```yaml
# ✅ Service Account per aplikasi
apiVersion: v1
kind: ServiceAccount
metadata:
  name: myapp-sa
  namespace: production
  annotations:
    # AWS IRSA — SA dapat assume IAM role tanpa long-lived credentials
    eks.amazonaws.com/role-arn: arn:aws:iam::123456789:role/myapp-production
automountServiceAccountToken: false

---
# ✅ Role dengan permission minimal
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: myapp-role
  namespace: production
rules:
  # Hanya baca ConfigMap dan Secret yang relevan
  - apiGroups: [""]
    resources: ["configmaps"]
    resourceNames: ["myapp-config"]
    verbs: ["get"]
  - apiGroups: [""]
    resources: ["secrets"]
    resourceNames: ["myapp-secrets"]
    verbs: ["get"]

---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: myapp-rolebinding
  namespace: production
subjects:
  - kind: ServiceAccount
    name: myapp-sa
    namespace: production
roleRef:
  kind: Role
  apiGroup: rbac.authorization.k8s.io
  name: myapp-role

---
# ✅ Audit RBAC — siapa punya akses apa
# kubectl auth can-i --list --as=system:serviceaccount:production:myapp-sa
# kubectl auth can-i get pods --as=system:serviceaccount:production:myapp-sa
```

---

## Network Policy — Default Deny

```yaml
# ✅ Default deny ALL traffic di namespace
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: production
spec:
  podSelector: {}  # Berlaku untuk semua pod
  policyTypes:
    - Ingress
    - Egress

---
# ✅ Izinkan traffic spesifik ke myapp
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-myapp-ingress
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: myapp
  policyTypes:
    - Ingress
    - Egress
  ingress:
    # Izinkan dari ingress controller saja
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: ingress-nginx
          podSelector:
            matchLabels:
              app.kubernetes.io/name: ingress-nginx
      ports:
        - protocol: TCP
          port: 3000
  egress:
    # Izinkan ke database di namespace database
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: database
          podSelector:
            matchLabels:
              app: postgres
      ports:
        - protocol: TCP
          port: 5432
    # Izinkan DNS resolution
    - to: []
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
```

---

## Pod Disruption Budget & HPA

```yaml
# ✅ PDB — jamin availability saat rolling update / node drain
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: myapp-pdb
  namespace: production
spec:
  minAvailable: 2  # Selalu minimal 2 pod running
  # Atau: maxUnavailable: 1
  selector:
    matchLabels:
      app: myapp

---
# ✅ HPA — auto-scale berdasarkan CPU/memory
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: myapp-hpa
  namespace: production
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: myapp
  minReplicas: 3
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300  # Tunggu 5 menit sebelum scale down
      policies:
        - type: Percent
          value: 25
          periodSeconds: 60
    scaleUp:
      stabilizationWindowSeconds: 30
      policies:
        - type: Percent
          value: 100
          periodSeconds: 30
```

---

## Secrets Encryption di etcd

```yaml
# ✅ Enkripsi Kubernetes Secrets at rest
# /etc/kubernetes/encryption-config.yaml

apiVersion: apiserver.config.k8s.io/v1
kind: EncryptionConfiguration
resources:
  - resources:
      - secrets
      - configmaps
    providers:
      - aescbc:
          keys:
            - name: key1
              secret: <base64-encoded-32-byte-key>
      - identity: {}  # Fallback: tidak terenkripsi (untuk existing secrets)

# Apply ke kube-apiserver:
# --encryption-provider-config=/etc/kubernetes/encryption-config.yaml

# Rotasi key:
# 1. Tambah key baru di posisi pertama
# 2. Restart apiserver
# 3. Re-encrypt semua secrets: kubectl get secrets --all-namespaces -o json | kubectl apply -f -
# 4. Hapus key lama
```

---

## Admission Controllers — Policy Enforcement

### Kyverno Policies
```yaml
# ✅ Enforce non-root container
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: require-non-root
spec:
  validationFailureAction: Enforce
  rules:
    - name: check-runAsNonRoot
      match:
        any:
          - resources:
              kinds: [Pod]
      validate:
        message: "Containers must not run as root"
        pattern:
          spec:
            =(securityContext):
              =(runAsNonRoot): true
            containers:
              - =(securityContext):
                  runAsNonRoot: true
                  runAsUser: ">0"

---
# ✅ Require resource limits
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: require-resource-limits
spec:
  validationFailureAction: Enforce
  rules:
    - name: check-limits
      match:
        any:
          - resources:
              kinds: [Pod]
      validate:
        message: "Resource limits are required"
        pattern:
          spec:
            containers:
              - resources:
                  limits:
                    memory: "?*"
                    cpu: "?*"

---
# ✅ Require image digest (bukan tag)
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: require-image-digest
spec:
  validationFailureAction: Enforce
  rules:
    - name: check-digest
      match:
        any:
          - resources:
              kinds: [Pod]
              namespaces: [production, staging]
      validate:
        message: "Images must be pinned to a digest"
        pattern:
          spec:
            containers:
              - image: "*@sha256:*"
```

---

## GitOps dengan ArgoCD

```yaml
# ✅ ArgoCD Application — declarative deployment
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: myapp-production
  namespace: argocd
spec:
  project: production
  source:
    repoURL: https://github.com/myorg/k8s-manifests
    targetRevision: main
    path: apps/myapp/production
  destination:
    server: https://kubernetes.default.svc
    namespace: production
  syncPolicy:
    automated:
      prune: true      # Hapus resource yang tidak ada di git
      selfHeal: true   # Restore jika ada manual change
    syncOptions:
      - CreateNamespace=true
      - PrunePropagationPolicy=foreground
    retry:
      limit: 3
      backoff:
        duration: 30s
        factor: 2
        maxDuration: 3m

---
# ✅ AppProject — isolasi per team/environment
apiVersion: argoproj.io/v1alpha1
kind: AppProject
metadata:
  name: production
  namespace: argocd
spec:
  sourceRepos:
    - "https://github.com/myorg/*"
  destinations:
    - namespace: production
      server: https://kubernetes.default.svc
  clusterResourceWhitelist:
    - group: ""
      kind: Namespace
  namespaceResourceBlacklist:
    - group: ""
      kind: ResourceQuota  # Tim tidak bisa ubah quota
```

---

## Useful kubectl Commands

```bash
# Audit security context semua pod
kubectl get pods -A -o json | jq -r '
  .items[] |
  "\(.metadata.namespace)/\(.metadata.name): " +
  "runAsRoot=\(.spec.securityContext.runAsNonRoot // false | not) " +
  "hostNetwork=\(.spec.hostNetwork // false)"'

# Cek siapa punya ClusterRole admin
kubectl get clusterrolebindings -o json | jq -r '
  .items[] |
  select(.roleRef.name == "cluster-admin") |
  "\(.metadata.name): \(.subjects[]?.name)"'

# Cek resource limits
kubectl get pods -A -o json | jq -r '
  .items[] |
  select(.spec.containers[].resources.limits == null) |
  "\(.metadata.namespace)/\(.metadata.name): NO RESOURCE LIMITS"'

# Port-forward untuk debugging (jangan di production!)
kubectl port-forward -n production pod/myapp-abc123 3000:3000

# Exec ke container (audit log akan tercatat)
kubectl exec -it -n production deployment/myapp -- /bin/sh

# Top pods dan nodes
kubectl top pods -A --sort-by=memory
kubectl top nodes
```
