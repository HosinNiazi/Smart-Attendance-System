FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY migrations ./migrations
COPY src ./src
USER node
EXPOSE 8080
CMD ["sh", "-c", "node src/migrate.js && node src/server.js"]
