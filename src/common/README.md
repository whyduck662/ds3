# Common

Chỉ chứa tiện ích nền tảng dùng chung:

- `src/platform.ts`: HTTP app, JWT claims, lỗi, connection pool.
- `src/serve.ts`: listen và graceful shutdown.
- `src/migrate.ts`: migration SQL có version, transaction/advisory lock; chỉ dùng pool của service gọi.

Không chứa entrypoint hoặc DB dùng chung. `common/messaging` theo plan thuộc TV3 và chưa được triển khai; adapter Notification đang ở chính Notification.
