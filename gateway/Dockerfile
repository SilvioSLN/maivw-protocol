FROM node:22-alpine

RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY prisma/ prisma/
RUN npx prisma generate
COPY src/ src/

ENV NODE_ENV=production
EXPOSE 3001

# Use tsx to run TypeScript directly and ensure DB schema is synced
CMD ["sh", "-c", "npx prisma db push --skip-generate && npx tsx src/index.ts"]
