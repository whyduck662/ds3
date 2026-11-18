# driver-service

Owner: TV3. Đã có profile/status/location/heartbeat, atomic reserve, confirm/release với reservation identity, TTL/offline jobs và MQ consumers. Xem docs/report.md và docs/TV1.md ở gốc repository cho kết quả chạy thật.

- Mã nguồn: `src/`
- Migration: SQL versioned trong `migrations/`, chạy tự động khi startup.
- Chạy riêng: `npm.cmd run dev --workspace driver-service` (cần JWT_SECRET, INTERNAL_TOKEN, DATABASE_URL và RABBITMQ_URL cho messaging).
- Không truy cập DB của service khác.
