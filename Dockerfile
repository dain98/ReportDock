FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/server/package.json apps/server/package.json
COPY packages/client/package.json packages/client/package.json
RUN npm ci

FROM node:24-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-slim
ENV NODE_ENV=production
ENV REPORTDOCK_DATA_DIR=/data
ENV PORT=3000
WORKDIR /app
COPY package.json ./
COPY apps/server/package.json apps/server/package.json
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/server/dist ./apps/server/dist
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["npm", "run", "start", "-w", "@reportdock/server"]
