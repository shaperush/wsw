# Use the official Node.js Alpine image as the base image
FROM node:20-alpine

# Set the working directory
WORKDIR /app

RUN apt-get update && apt-get install -y \
    chromium \
    libgbm-dev \
    && rm -rf /var/lib/apt/lists/*
        
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Copy package.json and package-lock.json to the working directory
COPY package*.json ./

# Install the dependencies
RUN npm ci --only=production --ignore-scripts

# Copy the rest of the source code to the working directory
COPY . .

# Expose the port the API will run on
EXPOSE 3000

# Start the API
CMD ["npm", "start"]