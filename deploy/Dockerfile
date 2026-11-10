FROM node:24.15.0-bookworm-slim
WORKDIR /app
COPY package*.json ./
COPY src/web-ui/package.json src/web-ui/package.json
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc
USER node
CMD ["node", "dist/main.js"]
