# payment-service

Owner: TV2. Đã có authorize/capture/void giả lập, inbox/outbox, tombstone và API ownership/internal authentication. Capture sai state/amount trả rejection, không phát success giả. Xem docs/report.md và docs/TV1.md ở gốc repository.

- Mã nguồn: `src/`
- Migration: SQL versioned trong `migrations/`, chạy tự động khi startup.
- Chạy riêng: `npm.cmd run dev --workspace payment-service` (cần JWT_SECRET, INTERNAL_TOKEN, DATABASE_URL và RABBITMQ_URL).
- Không truy cập DB của service khác.
