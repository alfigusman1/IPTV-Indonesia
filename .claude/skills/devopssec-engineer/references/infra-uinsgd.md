# Infrastruktur & Operasi UINSGD — Runbook Ringkas

> Kredensial (SSH, Docker Hub, DB) TIDAK ditulis di sini — ada di memory proyek / password manager.
> Jangan menyalin kredensial ke file yang di-commit.

## 1. Tiga lingkungan

| Lingkungan | Platform | API | Frontend |
|---|---|---|---|
| Lokal | Docker Desktop, compose `deploy/local/` | `http://localhost:500x/<modul>` | `http://localhost:301x` |
| Development | Docker di `192.168.18.141` (`/opt/uinsgd-apps`, watchtower) | `https://api.alfi-gusman.web.id/<modul>` | `https://<app>.alfi-gusman.web.id` |
| Produksi | Kubernetes on-prem (3 master, 6 worker; master1 192.168.18.145) | `https://api.uinsgd.ac.id/<modul>` | `https://<app>.uinsgd.ac.id` |

Port backend lokal: master 5000, damba 5001, bank 5002, ppid 5003, sarpras 5005, beasiswa 5006, cbt 5007,
lms 5008, sipukt 5009. Frontend: superapp 3010, sarpras 3011, beasiswa 3012, … lms 3016.

## 2. Stack lokal (wajib untuk uji sebelum push)

```bash
# backend
cd api/<x> && docker build --target production -t uinsgd/backend-<x>:local .
cd deploy/local && bash prepare-env.sh                     # env bersih dari api/<x>/.env
docker compose -f docker-compose.backend.yml up -d --force-recreate backend-<x>
curl -s localhost:<port>/health && docker exec backend-<x> grep -c "<penanda kode baru>" <file>
docker inspect backend-<x> --format '{{index .Config.Labels "com.docker.compose.project"}}'   # harus backend
```
- Compose TIDAK punya `build:` → `docker compose build` = no-op. Selalu `docker build` langsung; cek image ID berubah.
- `docker restart` tidak memuat image baru. `docker run` manual = container orphan (dilarang).
- Nama image/container: `uinsgd/backend-*`, `uinsgd/frontend-*`, label `uinsgd.group` + `uinsgd.app`.
- Frontend superapps: build-arg modul server-side-proxy = DNS container (`http://backend-sarpras:5005/sarpras`),
  master/damba = `localhost` (dipakai di browser). Lihat `deploy/local/README.md`.
- Git-Bash mengubah argumen ber-`/` → `MSYS_NO_PATHCONV=1` untuk `docker build --build-arg X=/...`.

## 3. CI/CD (CircleCI per repo)

- Branch `master` → image `:dev` + `sha-*` (dev-server). Branch `production` → `:latest` + `sha-*` → job deploy
  `kubectl set image ... sha-*` lewat SSH tunnel bastion → `rollout status` → `rollout undo` bila gagal.
- Gate yang dipakai (contoh `api/sarpras`, `api/lms`): `lint-and-test` (eslint, jest, `npm audit --omit=dev
  --audit-level=high`) → build multi-arch → **Trivy** (`--severity CRITICAL --ignore-unfixed --exit-code 1`).
- **Produksi hanya lewat PR `master` → `production` oleh user.** Agen tidak `kubectl set image` langsung dan
  tidak menjalankan migrasi DB produksi tanpa izin eksplisit.
- Kegagalan deploy yang sering: node k8s gagal pull `registry-1.docker.io` (jaringan kampus) → `ImagePullBackOff`;
  tunnel SSH rapuh. Cek `kubectl get events -A` di master (`sudo kubectl --kubeconfig=/etc/kubernetes/admin.conf`).

## 4. Kubernetes manifest (`api/<x>/k8s/`)

`00-namespace`, `01-configmap` (non-rahasia), `02-secret.yaml` (**gitignored**; contoh `.example`), `03-pvc`,
`04-deployment` (non-root, probes, resources), `05-service` (NodePort tetap), `06-hpa`, `07-ingress`.
- ConfigMap/Secret di repo bisa drift dari cluster → baca live (`get cm/secret -o yaml`) sebelum mengubah.
- Sarpras & PPID produksi memakai DB `dev_*` (lihat `02-secret.yaml`).

## 5. Jaringan & LB

- LB nginx: `192.168.18.19` (master/superapp, beasiswa, sarpras, cbt, lms, sipukt + vhost dev `*.alfi-gusman.web.id`),
  `192.168.18.14` (damba), `192.168.18.109` (`api.uinsgd.ac.id`, sites-available per modul). Upstream = 6 IP worker +
  NodePort. Selalu `nslookup <domain>` dulu — beberapa domain lewat Cloudflare.
- IP whitelist admin backend: `ALLOWED_ADMIN_IPS` + `ADMIN_IP_MODE`. Mode `server` di belakang ingress = IP pod
  (praktis lolos semua); pembatasan nyata → `ADMIN_IP_MODE=proxy` + `TRUST_PROXY` (CIDR pod/ingress + IP LB).
- `trust proxy = true` membuat `req.ip`/rate-limit key bisa dipalsukan via `X-Forwarded-For`.

## 6. Data & penyimpanan

- MySQL 8.0.46 @ 192.168.18.181 (bersama dev & sebagian prod). Redis & MinIO eksternal.
- Backup sebelum migrasi: `mysqldump --single-transaction` (lihat skill database-engineer `references/mysql8-uinsgd.md`).
- MinIO: objek publik hanya untuk gambar yang memang dipajang; dokumen resmi/impor = privat, diunduh via API.

## 7. Checklist rilis backend

```
□ git pull di branch master            □ bump versi package.json
□ npx eslint . && npm test            □ npm audit --omit=dev (high = 0)
□ docker build --target production    □ recreate via compose + health 200 + endpoint baru diuji
□ migrasi DB (bila ada) sudah dijalankan di target SEBELUM image baru live
□ push master → user membuat PR ke production
```
