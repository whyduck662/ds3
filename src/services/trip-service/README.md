# trip-service

Owner: TV2. Đã có booking/idempotency, lifecycle, pricing, Saga và compensation/reconciler. Confirm không chắc chắn giữ reservation để bù trừ; PAID yêu cầu payment status/amount hợp lệ. Xem docs/report.docx và docs/member-1-identity-gateway-notification-web-ui.md ở gốc repository.

- Mã nguồn: `src/`
- Migration: SQL versioned trong `migrations/`, chạy tự động khi startup.
- Chạy riêng: `npm.cmd run dev --workspace trip-service` (cần JWT_SECRET, INTERNAL_TOKEN, DATABASE_URL, RABBITMQ_URL và DRIVER_URL phù hợp).
- Không truy cập DB của service khác.
