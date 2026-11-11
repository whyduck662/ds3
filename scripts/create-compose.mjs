// Chạy khi muốn tạo lại compose; không chứa nghiệp vụ.
import { writeFileSync } from 'node:fs';
const services = { identity: 8081, driver: 8082, trip: 8083, matching: 8084, payment: 8085, notification: 8086 };
let yaml = `name: ds03
x-app: &app
  build:
    context: .
    dockerfile: deploy/Dockerfile
  restart: unless-stopped
  networks: [backend]
  mem_limit: 256m
  healthcheck:
    test: [CMD, node, -e, "fetch('http://localhost:'+process.env.PORT+'/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
    interval: 10s
    timeout: 4s
    retries: 10
    start_period: 20s
services:
  rabbitmq:
    image: rabbitmq:4.1.4-management-alpine
    user: rabbitmq
    environment:
      RABBITMQ_DEFAULT_USER: ride
      RABBITMQ_DEFAULT_PASS: \${RABBITMQ_PASSWORD:?Run scripts/init-env.ps1}
    ports: ["127.0.0.1:15672:15672"]
    volumes: ["rabbit-data:/var/lib/rabbitmq"]
    networks: [backend]
    mem_limit: 512m
    healthcheck:
      test: [CMD, rabbitmq-diagnostics, -q, ping]
      interval: 10s
      timeout: 5s
      retries: 10
`;
for (const [name, port] of Object.entries(services)) {
  const key = `${name.toUpperCase()}_DB_PASSWORD`;
  yaml += `  ${name}-db:
    image: postgres:16.13-alpine
    environment:
      POSTGRES_DB: ${name}
      POSTGRES_USER: ${name}
      POSTGRES_PASSWORD: \${${key}:?Run scripts/init-env.ps1}
    volumes: ["${name}-data:/var/lib/postgresql/data"]
    networks: [backend]
    mem_limit: 192m
    healthcheck:
      test: [CMD-SHELL, "pg_isready -U ${name} -d ${name}"]
      interval: 5s
      timeout: 3s
      retries: 20
  ${name}-service:
    <<: *app
    environment:
      SERVICE_NAME: ${name}-service
      PORT: ${port}
      JWT_SECRET: \${JWT_SECRET:?Run scripts/init-env.ps1}
      DATABASE_URL: postgres://${name}:\${${key}}@${name}-db:5432/${name}
      RABBITMQ_URL: amqp://ride:\${RABBITMQ_PASSWORD}@rabbitmq:5672
    depends_on:
      ${name}-db: {condition: service_healthy}
      rabbitmq: {condition: service_healthy}
`;
}
yaml += `  matching-service-2:
    <<: *app
    environment:
      SERVICE_NAME: matching-service
      INSTANCE_ID: matching-service-2
      PORT: 8084
      JWT_SECRET: \${JWT_SECRET}
      DATABASE_URL: postgres://matching:\${MATCHING_DB_PASSWORD}@matching-db:5432/matching
      RABBITMQ_URL: amqp://ride:\${RABBITMQ_PASSWORD}@rabbitmq:5672
    depends_on:
      matching-db: {condition: service_healthy}
      rabbitmq: {condition: service_healthy}
  api-gateway:
    <<: *app
    environment:
      SERVICE_NAME: api-gateway
      PORT: 8080
      JWT_SECRET: \${JWT_SECRET}
      UI_ORIGIN: http://localhost:3000
    ports: ["127.0.0.1:8080:8080"]
    depends_on:
      identity-service: {condition: service_healthy}
      notification-service: {condition: service_healthy}
  web-ui:
    build:
      context: .
      dockerfile: deploy/Dockerfile.web
    ports: ["127.0.0.1:3000:80"]
    networks: [backend]
networks:
  backend: {}
volumes:
  rabbit-data: {}
`;
for (const name of Object.keys(services)) yaml += `  ${name}-data: {}\n`;
writeFileSync('compose.yaml', yaml);
