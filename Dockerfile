FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY tsconfig.base.json ./
COPY shared shared
COPY server server
COPY client client
RUN npm run build -w client

FROM node:24-slim
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/casino.db \
    STATIC_DIR=/app/client/dist
EXPOSE 3000
CMD ["node_modules/.bin/tsx", "server/src/main.ts"]
