# Use the official Node.js Alpine image as the base image
FROM node:latest

# Set the working directory
WORKDIR /app


# Install Puppeteer dependencies
RUN apt-get update && apt-get install -y \
    wget \
    gconf-service \
    libgbm-dev \
    libasound2 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgcc1 \
    libgconf-2-4 \
    libgdk-pixbuf2.0-0 \
    libglib2.0-0 \
    libgtk-3-0 \
     libnspr4 \
     libpango-1.0-0 \
     libpangocairo-1.0-0 \
      libstdc++6 \
      libx11-6 \
       libx11-xcb1 \
       libxcb1 \
        libxcomposite1 \
        libxcursor1 \
        libxdamage1 \
         libxext6 \
         libxfixes3 \
         libxi6 \
         libxrandr2 \
         libxrender1 \
          libxss1 \
          libxtst6 \
          ca-certificates\
           fonts-liberation \
           libappindicator1 \
           libnss3 \
           lsb-release\
            xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Install Google Chrome Stable
RUN wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y google-chrome-stable \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Prevent Puppeteer from downloading its own bundled version of Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
    

# RUN curl -LO https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
# RUN apt-get install -y ./google-chrome-stable_current_amd64.deb
# RUN rm google-chrome-stable_current_amd64.deb 

# Copy package.json and package-lock.json to the working directory
COPY package.json ./
COPY package-lock.json ./

# Install the dependencies
RUN npm ci --only=production --ignore-scripts
RUN npm install
# RUN npm init
# Copy the rest of the source code to the working directory
COPY . .

# Expose the port the API will run on
EXPOSE 3000

# Start the API
CMD ["npm", "start"]