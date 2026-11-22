FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json ./
RUN npm install --legacy-peer-deps --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data

LABEL org.opencontainers.image.title="immich-autoalbums"
LABEL org.opencontainers.image.description="Smart Event & CIELAB Color-Tone Album Organizer sidecar for Immich"
LABEL org.opencontainers.image.source="https://github.com/NishantJh/immich_autoalbums"
LABEL org.opencontainers.image.url="https://github.com/NishantJh/immich_autoalbums"
LABEL org.opencontainers.image.licenses="MIT"
LABEL net.unraid.docker.icon="https://raw.githubusercontent.com/NishantJh/immich_autoalbums/main/public/icon.png"
LABEL net.unraid.docker.webui="http://[IP]:[PORT:3000]"

RUN apk add --no-cache python3 make g++
COPY package.json ./
RUN npm install --omit=dev --legacy-peer-deps --no-audit --no-fund && npm install --no-save --legacy-peer-deps tsx
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/src/server ./src/server
COPY --from=builder /app/src/shared ./src/shared
COPY --from=builder /app/public ./public
COPY --from=builder /app/LICENSE ./LICENSE
RUN mkdir -p /app/data
VOLUME ["/app/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "server.ts"]
