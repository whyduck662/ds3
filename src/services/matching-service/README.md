# matching-service

Owner: TV3. Consumer lưu durable work/tombstone cùng inbox; worker claim lease và commit candidate/reservation trước REST. Worker replay cùng reservationId sau lỗi, phát reply qua outbox và chỉ xác nhận cancel sau release. Hai instances dùng cùng logical-service DB. Xem docs/report.docx và docs/member-1-identity-gateway-notification-web-ui.md ở gốc repository.

- Mã nguồn: `src/`
- Migration: SQL versioned trong `migrations/`, chạy tự động khi startup.
- Chạy riêng: `npm.cmd run dev --workspace matching-service` (cần JWT_SECRET, INTERNAL_TOKEN, DATABASE_URL, RABBITMQ_URL và DRIVER_SERVICE_URL phù hợp).
- Không truy cập DB của service khác.
