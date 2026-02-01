# Use Node with Chrome pre-installed
FROM ghcr.io/puppeteer/puppeteer:24.15.0

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY package-lock.json ./

# Install dependencies
RUN npm ci --omit=dev

# Copy source code
COPY . .

# Expose port
EXPOSE 3000

# Set environment variables
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Start server
CMD ["node", "server.js"]
