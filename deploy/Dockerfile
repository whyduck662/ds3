FROM node:24.15.0-bookworm-slim
WORKDIR /app
COPY package*.json ./
COPY src ./src
RUN npm ci
COPY tsconfig.json ./
RUN npx tsc
USER node
CMD ["sh", "-c", "exec npm run start --workspace \"$SERVICE_NAME\""]
