# NexusRTC - Dockerfile
FROM node:20-alpine

WORKDIR /app

# Install FFmpeg for recording compression (libx264)
RUN apk add --no-cache ffmpeg curl

# Install deps
COPY package*.json ./
RUN npm ci --legacy-peer-deps

# Copy source and config
COPY . .

# Build Next.js
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
