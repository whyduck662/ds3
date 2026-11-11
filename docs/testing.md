# Kiểm thử và bằng chứng TV1

## Chạy nhanh

```powershell
npm.cmd ci
npm.cmd run typecheck
npm.cmd run build
npm.cmd test
powershell -ExecutionPolicy Bypass -File scripts/test-tv1.ps1
```

Integration dùng 2 PostgreSQL và RabbitMQ **riêng cho test**, không khởi động service TV2/TV3. Có thể chạy trên Linux/macOS:

```sh
docker compose -f deploy/compose.test.yaml up -d --wait
npm run test:integration
docker compose -f deploy/compose.test.yaml down --volumes
```

Unit/transport tests không cần Docker. Integration không tự SKIP khi thiếu DB/MQ; lệnh sẽ FAIL và lưu kết quả. Integration chỉ chấp nhận tên DB `_test`. Không chạy test này vào DB triển khai. CI chạy typecheck/build/unit/integration và lưu artifacts.

| ID/phạm vi | Kiểm tra | Bằng chứng |
|---|---|---|
| F01/F02 Identity | register/login/me qua Gateway, hash password, email trùng, sai mật khẩu | integration.json |
| F07/F10 Notification | publish envelope thật qua MQ, thông báo hai recipients, không lặp khi publish song song | integration.json |
| S01 | token thiếu/sai/hết hạn | unit.json |
| S02 | sai role, ownership Notification, không tự cấp ADMIN | unit.json + integration.json |
| S03/S04 | schema/field thừa, password UTF-8, body limit, rate limit | unit.json |
| S05 | chặn internal/payment command, bỏ header giả danh | unit.json |
| Notification recovery | rollback khi DB không xử lý được, retry rồi phục hồi; consumer dừng và nhận message sau restart | integration.json |
| X06 (TV1) | restart RabbitMQ test, consumer tự reconnect và xử lý tiếp event | integration.json |
| Notification DLQ | schema sai vào DLQ, không commit inbox | integration.json |
| Gateway transport | giữ correlation/idempotency, 503 khi upstream down | unit.json |
| E01/E02/E03 | luồng thật toàn hệ thống | E01/E02/E03.json + container logs, chờ TV2/TV3 |

Fixture `tv1-test-fixture` chỉ tạo trip envelope cho Notification, không thay thế producer Trip thật. Test DB lỗi tạm thời đổi tên bảng notifications trong DB test, khôi phục ở finally để kiểm tra rollback và retry bằng broker thật.

X06 gọi Docker CLI để restart **chỉ RabbitMQ trong Compose test**. Chạy integration bằng lệnh trong hướng dẫn, cần quyền Docker. TEST_RABBITMQ_URL tùy chỉnh không được dùng cho X06 để tránh restart nhầm broker. Phần phục hồi outbox nghiệp vụ khi broker down vẫn do TV2/TV3 kiểm thử.

Các test TV2/TV3 về CAS, Saga, payment tombstone, concurrency và performance do owner triển khai. TV1 không tuyên bố bộ kiểm thử toàn nhóm đã đủ §9 chỉ dựa vào số lượng unit test. TV3 bàn giao `tests/concurrency/c01.ts` để demo runner gọi; TV2 cung cấp DB invariant checker cho capture/compensation.

Artifacts không commit mặc định. Khi ghi report, đính kèm artifacts chạy thật, command, môi trường, thời gian và seed. Không ghi PASS chỉ vì có script hoặc Docker healthcheck.
