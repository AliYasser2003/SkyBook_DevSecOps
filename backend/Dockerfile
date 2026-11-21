FROM node:22-alpine

WORKDIR /app

# Update npm to a version containing patched dependencies
RUN npm install -g npm@12.2.3

# Install production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source
COPY --chown=node:node src ./src

# Run the application as a non-root user
USER node

EXPOSE 5000

CMD ["npm", "start"]
