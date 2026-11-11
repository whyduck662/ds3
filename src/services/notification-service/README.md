# Notification — TV1

- `src/main.ts`: khởi tạo DB, HTTP server và MQ consumer.
- `src/app.ts`: schema event, transaction inbox + notification, API đọc.
- `src/consumer.ts`: kết nối RabbitMQ, ACK sau commit, retry và DLQ.
- `migrations/001_init.sql`: schema riêng Notification.
- Startup áp dụng migration có version; inbox/notification cùng transaction.

Chạy từ root: `npm.cmd run dev --workspace notification-service`.
Env: `JWT_SECRET`, `DATABASE_URL`, `RABBITMQ_URL`, tùy chọn `PORT` (8086).
GET `/notifications/me?since=<ISO timestamp>` chỉ đọc userId trong JWT.
MQ: exchange `ride.events`, queue `notification.events`, binding `trip.*`.
Inbox không có outbox vì service không phát event.
