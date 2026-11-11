# Kiểm tra bàn giao TV1 — 10/11/2026

Môi trường: Windows/PowerShell, Node.js 24.15.0, Docker Desktop engine 29.1.3, PostgreSQL 16.13, RabbitMQ 4.1.4. Các kết quả dưới đây được chạy tại workspace, không phải số liệu giả lập.

| Kiểm tra | Kết quả |
|---|---|
| npm run typecheck | PASS, gồm backend, UI, scripts và tests |
| npm run build | PASS, TypeScript + Vite |
| npm test | PASS, 9 unit/HTTP transport tests |
| npm run test:integration | PASS, 8 tests với 2 PostgreSQL DB và RabbitMQ thật |
| node scripts/start.mjs | PASS, build/start/wait Compose và seed 3 tài khoản |
| npm run smoke | PASS, login/me/notification API và các case 401/403/400 qua Gateway container |
| GET http://localhost:3000 | HTTP 200, HTML DS03 |

Integration có kiểm tra publish song song cùng eventId, hai người nhận và ownership; event sai schema vào DLQ; DB xử lý lỗi rollback rồi retry; consumer restart; retry budget; event version cũ; broker restart rồi consumer tự reconnect. Riêng X06 restart **RabbitMQ test**, không dừng broker triển khai.

RabbitMQ Compose chạy dưới user rabbitmq để healthcheck và server dùng cùng quyền đọc cookie. Docker đã build thành công các image; service skeleton có healthcheck nhưng không đồng nghĩa đã có nghiệp vụ.

Bằng chứng máy đọc được: artifacts/unit.json, integration.json, smoke.json. Thư mục artifacts bị gitignore; có thể sao chép vào hồ sơ báo cáo hoặc lấy từ CI artifact.

Giới hạn xác minh:

- Chưa chạy E01–E03 toàn hệ thống vì TV2/TV3 chưa triển khai nghiệp vụ. Các script đã sẵn sàng theo contracts.md, không đánh dấu PASS.
- Chưa xác minh UI bằng trình duyệt tự động; đã build và kiểm tra HTTP. Chức năng Trip/Driver/Payment phụ thuộc backend của owner tương ứng.
- Không thay đổi source Driver, Matching, Trip, Payment. Test fixture event chỉ nằm trong tests/integration.
- CI đã cấu hình nhưng chưa được push/chạy trên GitHub trong lần bàn giao này.
- Report cuối, benchmark và Git contribution evidence của cả nhóm cần ghép sau khi các owner hoàn tất.
