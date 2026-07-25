FROM node:22-alpine

WORKDIR /app

# Install production dependencies first for better build caching.
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

# Copy the frontend assets and server source.
COPY --chown=node:node . .

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

USER node

CMD ["node", "server/server.js"]