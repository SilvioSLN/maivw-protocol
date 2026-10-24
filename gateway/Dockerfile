FROM node:22-alpine AS base

RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY prisma/ prisma/
RUN npx prisma generate
COPY src/ src/

# Prepare runtime directories and set ownership for non-root node user
RUN mkdir -p /app/data/attachments /app/data/certs && \
    chown -R node:node /app/data

ENV NODE_ENV=production

# Target para execução exclusiva e isolada de migrations (one-shot job)
FROM base AS migrator
USER node
CMD ["sh", "-c", "exec npx prisma migrate deploy"]

# Target para o runtime dos serviços do Gateway (API, workers, indexadores)
FROM base AS runner
EXPOSE 3001 8443
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/health/live || exit 1
CMD ["sh", "-c", "exec npx tsx src/runtime.ts \"${MAIVW_RUNTIME_ROLE:-all-in-one}\""]

FROM runner AS default
