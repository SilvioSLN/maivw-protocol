FROM node:22-alpine

RUN apk add --no-cache openssl libc6-compat
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json ./

# Install deps with ignore-scripts to prevent pnpm 10+ build script errors
RUN pnpm config set ignore-scripts true && pnpm install

COPY tsconfig.json ./
COPY prisma/ prisma/
RUN npx prisma generate
COPY src/ src/

ENV NODE_ENV=production
EXPOSE 3001

# Use tsx to run TypeScript directly and ensure DB schema is synced
CMD ["sh", "-c", "npx prisma db push --skip-generate && npx tsx src/index.ts"]

