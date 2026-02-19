FROM node:20-slim

WORKDIR /app

# Install dependencies first for caching
COPY package*.json ./
RUN npm ci

# Copy the rest of the repo
COPY . .

# Pre-compile Solidity so artifacts are baked into the image (fixes HH700)
RUN npx hardhat compile

# Default command (Cloud Run Job will execute this)
CMD ["npx","hardhat","run","--no-compile","scripts/worker-launch-events-to-chain.js","--network","baseSepolia"]
