# Production image: build TS, then run migrations + API on a slim runtime.
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
EXPOSE 4000
# Migrations are idempotent (schema_migrations table) and additive-only,
# so running them on every boot is safe.
CMD ["sh", "-c", "node dist/migrate.js && node dist/index.js"]
