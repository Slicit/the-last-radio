# Build context: repository root (npm workspaces share one lockfile).
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @lastradio/server --include-workspace-root=false
COPY apps/server apps/server
RUN npm run build --workspace @lastradio/server \
 && npm prune --omit=dev --workspace @lastradio/server --include-workspace-root=false

FROM node:22-bookworm-slim
# ffmpeg decodes/encodes audio; yt-dlp (a Python zipapp) fetches tracks and
# uses node as its JavaScript runtime for YouTube.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3 ca-certificates curl \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
 && chmod +x /usr/local/bin/yt-dlp
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server/package.json ./package.json
COPY --from=build /app/apps/server/dist ./dist
COPY apps/server/drizzle ./drizzle
EXPOSE 3000
