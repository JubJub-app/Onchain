FROM node:20-slim

WORKDIR /app

# Install dependencies first for caching
COPY package*.json ./
RUN npm ci

# Copy the rest of the repo
COPY . .

# Default command (Cloud Run Job will execute this)
CMD ["npx","hardhat","run","--no-compile","scripts/worker-launch-events-to-chain.js","--network","baseSepolia"]

