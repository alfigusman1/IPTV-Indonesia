FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

# deps (layer cache)
COPY package*.json ./
RUN npm ci --omit=dev

# kode + frontend + data
COPY . .

EXPOSE 4300

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:4300/health || exit 1

# migrate + seed idempotent saat start, lalu jalankan server
# (scheduler otomatis import + health-check ~30s setelah start).
CMD ["sh", "-c", "node scripts/migrate.js && node scripts/seed-sources.js && node src/server.js"]
