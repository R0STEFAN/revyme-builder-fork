FROM node:24-slim AS builder

WORKDIR /app

# Install build dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy source
COPY . .

# Build all bundles (main builder, canvas sandbox, preview sandbox)
RUN npm run build:all

EXPOSE 3333 5174 5175

ENV NODE_ENV=production
ENV REVYME_DATA_DIR=/app/data

VOLUME ["/app/data"]

CMD ["npm", "run", "preview"]
