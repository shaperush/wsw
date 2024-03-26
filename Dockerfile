# Use the official Node.js Alpine image as the base image
FROM node:20-alpine

# Set the working directory
WORKDIR /app


RUN set -x \
    && apk update \
    && apk upgrade \
    && apk add --no-cache \
    chromium 
    

# RUN curl -LO https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
# RUN apt-get install -y ./google-chrome-stable_current_amd64.deb
# RUN rm google-chrome-stable_current_amd64.deb 

# Copy package.json and package-lock.json to the working directory
COPY package*.json ./

# Install the dependencies
RUN npm ci --only=production --ignore-scripts
# RUN npm init
# Copy the rest of the source code to the working directory
COPY . .

# Expose the port the API will run on
EXPOSE 3000

# Start the API
CMD ["npm", "start"]