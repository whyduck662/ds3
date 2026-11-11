# Bàn giao thành viên 1

Mục tiêu: ít lớp, đọc theo thứ tự `main.ts → app.ts → migration.sql`; consumer riêng chỉ khi có MQ.

Đã triển khai đúng phạm vi TV1:

- Identity: migration versioned, register/login/me, bcrypt, JWT/roles, validation, log an toàn.
- Gateway: allowlist/RBAC, bỏ header giả danh, chặn internal, rate limit auth/booking, CORS, body limit, timeout/503, correlation/idempotency headers.
- Notification: migration riêng, event validation, transaction inbox + notifications, ACK sau commit, retry confirm/DLQ, reconnect, API ownership; không outbox vì không phát event.
- UI: đăng ký/login, Passenger booking/cancel, Driver status/location + heartbeat, offer/actions/current-trip polling, giá/thanh toán/correlationId, thông báo; UI không quyết định state machine.
- Platform: workspaces src/services, Compose/network/volumes/healthchecks, migration helper, random env, một lệnh startup/seed, reset/kill/logs, CI và OpenAPI TV1.
- Integration/demo: smoke, E01/E02/E03, demo runner 1–9 có điểm gọi C01 TV3; test TV1 riêng với 2 PostgreSQL và RabbitMQ thật.

E03 đã có kill/restart Payment thật, xác nhận service dừng, CAPTURE_PENDING và PAID sau khôi phục; finally khôi phục service nếu lỗi. E02 kiểm tra Driver release + Payment VOIDED. Các script này chỉ được chạy PASS khi backend TV2/TV3 đã bàn giao.

Chưa được coi là hoàn thành toàn hệ thống: nghiệp vụ TV2/TV3, publish event từ Trip thật, tích hợp Saga/concurrency/recovery của nhóm, benchmark và PDF cuối có bằng chứng. Không suy ra PASS từ source code hoặc healthcheck. Driver/Matching/Trip/Payment được giữ nguyên skeleton; TV1 không viết thay owner.

Tài liệu bàn giao: contracts.md, openapi/tv1.yaml, testing.md, demo.md và report/tv1.md. C01 CLI thuộc TV3, DB invariant checks thuộc TV2/TV3. Test fixture MQ chỉ dùng trong integration Notification, không được đưa vào business service.

Đã xác minh tại máy: 9 unit tests, 8 integration tests với DB/MQ thật, typecheck/build, startup/seed và smoke qua Gateway container đều PASS. Xem testing.md để biết command, môi trường và giới hạn; chưa chạy E01–E03 khi service nghiệp vụ chưa có.

Các phần báo cáo TV1 cần tổng hợp sau khi có kết quả thật: 1–3, 12, 13 (Platform/Identity/UI/Notification), 18–19 theo mục 11 plan. Tham chiếu plan_DS03_v5.md cho ma trận phân công đầy đủ.
