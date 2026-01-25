# NexusRTC - Dockerfile
FROM node:20-alpine

WORKDIR /app

# Install deps
COPY package*.json ./
RUN npm install --legacy-peer-deps

# Copy source and config
COPY . .

# Build Next.js
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server.js"]
