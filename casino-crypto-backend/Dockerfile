FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
COPY tsconfig*.json ./
COPY src ./src

RUN npm run prisma:generate
RUN npm run build

FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/node_modules/.prisma /app/node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma /app/node_modules/@prisma
COPY prisma ./prisma
COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["sh", "-c", "npm run prisma:deploy && npm run start"]
