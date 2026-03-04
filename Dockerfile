FROM node:22-slim

# Install build dependencies for better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy application source
COPY src/ ./src/

# Create data directory for SQLite
RUN mkdir -p data

# Set default environment
ENV NODE_ENV=production
ENV LOG_LEVEL=info

# Run as non-root user with predictable UID (matches typical host user)
RUN groupadd -g 1000 botuser && useradd -u 1000 -g botuser botuser
RUN chown -R botuser:botuser /app
USER botuser

CMD ["node", "src/index.js"]
