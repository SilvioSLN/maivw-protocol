FROM node:22-alpine AS base

RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY prisma/ prisma/
RUN npx prisma generate
COPY src/ src/

ENV NODE_ENV=production

# Target para execução exclusiva e isolada de migrations (one-shot job)
FROM base AS migrator
CMD ["sh", "-c", "npx prisma migrate deploy"]

# Target para o runtime dos serviços do Gateway (API, workers, indexadores)
FROM base AS runner
EXPOSE 3001
CMD ["sh", "-c", "npx tsx src/runtime.ts \"${MAIVW_RUNTIME_ROLE:-all-in-one}\""]

FROM runner AS default
