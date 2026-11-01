# Schema Design Reference

## Prinsip Dasar

```sql
-- ✅ Gunakan UUID untuk public-facing ID
-- Sequential integer ID membocorkan jumlah record dan rentan enumeration attack
CREATE TABLE users (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ  -- soft delete
);

-- ✅ TIMESTAMPTZ (timezone-aware), bukan TIMESTAMP
-- ✅ NOT NULL sebisa mungkin — null memperumit query dan logika
-- ✅ created_at + updated_at di setiap tabel
-- ✅ Soft delete: deleted_at (tidak langsung DELETE)
```

---

## Normalization

### 1NF — Atomic Values
```sql
-- ❌ Melanggar 1NF: menyimpan multiple values dalam satu kolom
CREATE TABLE orders (
  id       UUID PRIMARY KEY,
  items    TEXT  -- "product_1,product_2,product_3"  ← SALAH
);

-- ✅ Pecah jadi tabel terpisah
CREATE TABLE order_items (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   UUID NOT NULL REFERENCES orders(id),
  product_id UUID NOT NULL REFERENCES products(id),
  quantity   INTEGER NOT NULL CHECK (quantity > 0),
  price      NUMERIC(12,2) NOT NULL
);
```

### 2NF — No Partial Dependencies
```sql
-- ❌ Melanggar 2NF: product_name bergantung hanya pada product_id, bukan full key
CREATE TABLE order_items (
  order_id     UUID,
  product_id   UUID,
  product_name TEXT,  -- ← partial dependency
  quantity     INTEGER,
  PRIMARY KEY (order_id, product_id)
);

-- ✅ Pisahkan product_name ke tabel products
```

### 3NF — No Transitive Dependencies
```sql
-- ❌ Melanggar 3NF: city bergantung pada zip_code, bukan pada id
CREATE TABLE users (
  id       UUID PRIMARY KEY,
  zip_code VARCHAR(10),
  city     TEXT  -- ← bergantung pada zip_code
);

-- ✅ Pisahkan atau accept denormalization dengan sadar
```

### Kapan Denormalisasi Boleh
```
Denormalize HANYA ketika:
- Query JOIN terlalu sering dan jadi bottleneck (profil dulu!)
- Data read-heavy, write jarang
- Reporting / analytics workload (OLAP, star schema)
- Data yang di-denormalize jarang berubah

Contoh denormalisasi yang valid:
- Simpan user_name di orders (jika nama bisa berubah tapi history perlu konsisten)
- Simpan total di orders (agar tidak harus SUM(items) setiap query)
- Materialized view untuk query analytics yang berat
```

---

## Relationship Patterns

### One-to-Many
```sql
-- User memiliki banyak orders
CREATE TABLE orders (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- ON DELETE CASCADE: hapus orders jika user dihapus
  -- ON DELETE RESTRICT: tolak hapus user jika masih punya orders (default)
  -- ON DELETE SET NULL: set user_id = NULL jika user dihapus
  status  VARCHAR(50) NOT NULL DEFAULT 'pending'
);

CREATE INDEX idx_orders_user_id ON orders (user_id);  -- WAJIB
```

### Many-to-Many
```sql
-- User bisa punya banyak roles, role bisa dimiliki banyak user
CREATE TABLE roles (
  id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE user_roles (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id    UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_by UUID REFERENCES users(id),
  PRIMARY KEY (user_id, role_id)  -- composite PK mencegah duplikat
);

CREATE INDEX idx_user_roles_role_id ON user_roles (role_id);
```

### Self-Referential (Hierarchical)
```sql
-- Kategori dengan sub-kategori
CREATE TABLE categories (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID REFERENCES categories(id),  -- null = root
  name      VARCHAR(255) NOT NULL,
  path      TEXT,  -- materialized path: '1.2.5' untuk query hierarchy efisien
  depth     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_categories_parent_id ON categories (parent_id);
CREATE INDEX idx_categories_path ON categories (path);

-- Query semua descendants
SELECT * FROM categories WHERE path LIKE '1.2.%';

-- Alternatif: PostgreSQL ltree extension (lebih powerful)
CREATE EXTENSION IF NOT EXISTS ltree;
ALTER TABLE categories ADD COLUMN ltree_path ltree;
CREATE INDEX idx_categories_ltree ON categories USING GIST (ltree_path);
SELECT * FROM categories WHERE ltree_path <@ '1.2';
```

---

## Constraints — Validasi di Level Database

```sql
-- CHECK constraint — validasi nilai
ALTER TABLE products ADD CONSTRAINT check_price_positive
  CHECK (price > 0);

ALTER TABLE users ADD CONSTRAINT check_email_format
  CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');

ALTER TABLE orders ADD CONSTRAINT check_valid_status
  CHECK (status IN ('pending', 'confirmed', 'shipped', 'delivered', 'cancelled'));

-- UNIQUE constraint
ALTER TABLE users ADD CONSTRAINT uq_users_email UNIQUE (email);

-- Composite unique
ALTER TABLE user_roles ADD CONSTRAINT uq_user_role
  UNIQUE (user_id, role_id);  -- atau gunakan sebagai PRIMARY KEY

-- EXCLUSION constraint (PostgreSQL) — mencegah overlap
CREATE TABLE reservations (
  room_id  UUID NOT NULL,
  period   TSTZRANGE NOT NULL,
  EXCLUDE USING GIST (room_id WITH =, period WITH &&)
  -- mencegah booking yang overlap untuk room yang sama
);
```

---

## JSONB — Kapan dan Bagaimana

```sql
-- ✅ Gunakan JSONB untuk:
-- - Atribut yang variasinya tinggi antar record (product attributes)
-- - Data semi-struktural yang tidak perlu di-query dalam
-- - Metadata dan audit trail

CREATE TABLE products (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(255) NOT NULL,
  price      NUMERIC(12,2) NOT NULL,
  attributes JSONB  -- {"color": "red", "size": "XL", "material": "cotton"}
);

-- Index JSONB
CREATE INDEX idx_products_attributes ON products USING GIN (attributes);

-- Query JSONB
SELECT * FROM products WHERE attributes @> '{"color": "red"}';
SELECT * FROM products WHERE attributes->>'color' = 'red';
SELECT * FROM products WHERE (attributes->>'price')::numeric > 100;

-- ❌ Jangan pakai JSONB untuk:
-- Data yang sering di-JOIN
-- Kolom yang perlu FK
-- Data yang perlu aggregate / sort
-- Field yang nilainya penting dan structured
```

---

## Audit Trail Pattern

```sql
-- Opsi 1: Kolom audit di tabel utama (simple)
ALTER TABLE orders ADD COLUMN created_by UUID REFERENCES users(id);
ALTER TABLE orders ADD COLUMN updated_by UUID REFERENCES users(id);

-- Opsi 2: Tabel audit terpisah (lengkap, bisa replay)
CREATE TABLE audit_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name   VARCHAR(100) NOT NULL,
  record_id    UUID NOT NULL,
  operation    VARCHAR(10) NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  old_values   JSONB,
  new_values   JSONB,
  changed_by   UUID REFERENCES users(id),
  changed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address   INET
);

CREATE INDEX idx_audit_logs_record ON audit_logs (table_name, record_id);
CREATE INDEX idx_audit_logs_changed_at ON audit_logs (changed_at DESC);

-- Trigger otomatis untuk audit
CREATE OR REPLACE FUNCTION audit_trigger_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_logs (table_name, record_id, operation, new_values)
    VALUES (TG_TABLE_NAME, NEW.id, 'INSERT', to_jsonb(NEW));
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_logs (table_name, record_id, operation, old_values, new_values)
    VALUES (TG_TABLE_NAME, NEW.id, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW));
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_logs (table_name, record_id, operation, old_values)
    VALUES (TG_TABLE_NAME, OLD.id, 'DELETE', to_jsonb(OLD));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER orders_audit
AFTER INSERT OR UPDATE OR DELETE ON orders
FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
```

---

## Multi-Tenancy Patterns

```sql
-- Opsi 1: Shared schema — tenant_id di setiap tabel
-- Paling umum, mudah di-deploy, perlu Row Level Security

ALTER TABLE orders ADD COLUMN tenant_id UUID NOT NULL REFERENCES tenants(id);
CREATE INDEX idx_orders_tenant_id ON orders (tenant_id);

-- Row Level Security (PostgreSQL) — enforce di level DB
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY orders_tenant_isolation ON orders
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- Set di awal connection/session
SET app.tenant_id = 'tenant-uuid-here';

-- Opsi 2: Separate schema per tenant
-- Lebih isolasi, tapi sulit di-maintain untuk banyak tenant
CREATE SCHEMA tenant_abc;
CREATE TABLE tenant_abc.orders (...);

-- Opsi 3: Separate database per tenant
-- Isolasi penuh, biaya infrastruktur tinggi
-- Cocok untuk enterprise dengan compliance requirement
```

---

## Enum vs Lookup Table vs CHECK

```sql
-- Opsi 1: PostgreSQL ENUM type
-- Pro: type-safe, compact storage
-- Con: ALTER TYPE untuk tambah value butuh lock (PostgreSQL < 12)
CREATE TYPE order_status AS ENUM ('pending', 'confirmed', 'shipped', 'delivered', 'cancelled');
ALTER TABLE orders ADD COLUMN status order_status NOT NULL DEFAULT 'pending';

-- Opsi 2: CHECK constraint dengan VARCHAR
-- Pro: mudah tambah value (ALTER TABLE ringan)
-- Con: tidak ada type safety di luar DB
ALTER TABLE orders ADD COLUMN status VARCHAR(50) NOT NULL DEFAULT 'pending'
  CHECK (status IN ('pending', 'confirmed', 'shipped', 'delivered', 'cancelled'));

-- Opsi 3: Lookup table
-- Pro: bisa tambah metadata (label, urutan, warna)
-- Con: butuh JOIN, lebih kompleks
CREATE TABLE order_statuses (
  code        VARCHAR(50) PRIMARY KEY,
  label       VARCHAR(100) NOT NULL,
  sort_order  INTEGER NOT NULL,
  is_terminal BOOLEAN NOT NULL DEFAULT false
);

-- Rekomendasi: CHECK constraint untuk status sederhana,
-- lookup table kalau butuh metadata atau UI perlu list nilai yang valid
```
