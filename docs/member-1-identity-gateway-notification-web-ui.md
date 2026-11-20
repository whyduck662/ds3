# Bàn giao thành viên 1 (TV1)

**Học phần:** Distributed Systems (DS03)  
**Phạm vi sở hữu:** Identity, API Gateway, Notification, Web UI, Docker Compose và tích hợp demo.

---

## 1. Các thành phần đã triển khai

### 1.1 Identity — đăng ký, đăng nhập và JWT

- [identity-service/src/app.ts](../src/services/identity-service/src/app.ts) triển khai `POST /auth/register`, `POST /auth/login` và `GET /users/me`. Mở `identityApp` để trình bày kiểm tra dữ liệu, băm mật khẩu bcrypt, cấp JWT theo vai trò Passenger/Driver và đọc hồ sơ từ danh tính trong token.
- [Migration Identity](../src/services/identity-service/migrations/001_init.sql) khai báo bảng người dùng, email duy nhất và cột `password_hash` trong PostgreSQL của Identity.

### 1.2 API Gateway — định tuyến và phân quyền

- [api-gateway/src/app.ts](../src/services/api-gateway/src/app.ts). Mở `allowed` để trình bày phân quyền theo vai trò, rồi mở `gatewayApp` để trình bày xác thực JWT, rate limit, timeout/503, định tuyến đến service nội bộ và chuyển tiếp correlation ID.
- [OpenAPI Identity, Gateway và Notification](openapi/identity-gateway-notification.yaml) mô tả endpoint và dữ liệu trao đổi. [Hợp đồng API/event dùng chung](contracts.md) mô tả các luồng liên service.

### 1.3 Notification — xử lý event và chống trùng

- [notification-service/src/consumer.ts](../src/services/notification-service/src/consumer.ts). Mở `consumeNotifications` để trình bày binding `trip.*`, ACK sau khi lưu thành công, retry 1/5/15 giây, DLQ và kết nối lại RabbitMQ.
- [notification-service/src/app.ts](../src/services/notification-service/src/app.ts). Mở `saveNotification` để trình bày transaction ghi inbox và thông báo, rồi xem `GET /notifications/me` để thấy cách truy vấn theo người dùng trong JWT.
- [Migration Notification](../src/services/notification-service/migrations/001_init.sql) khai báo inbox và bảng lưu thông báo.

### 1.4 Web UI — giao diện hành khách và tài xế

- [web-ui/src/App.tsx](../src/web-ui/src/App.tsx) chứa luồng đặt/hủy chuyến, nhận/từ chối chuyến, bắt đầu/hoàn tất chuyến, cập nhật vị trí và polling thông báo. Khi trình bày heartbeat, tìm hàm `heartbeat` trong `App`.
- [web-ui/src/api.ts](../src/web-ui/src/api.ts) tập trung các request HTTP từ trình duyệt đến Gateway.

### 1.5 Triển khai và demo

- [compose.yaml](../compose.yaml) khai báo các service, mạng nội bộ, DB riêng và healthcheck.
- [scripts/start.mjs](../scripts/start.mjs) khởi động Docker Compose rồi seed tài khoản qua HTTP. [scripts/env.mjs](../scripts/env.mjs) tạo hoặc bổ sung biến môi trường.
- [scripts/demo/run.ts](../scripts/demo/run.ts) là điểm vào khi trình diễn các ca demo từ terminal.

---

## 2. Kiểm thử và bằng chứng bàn giao

| Muốn trình bày | Mở code | Minh chứng |
|---|---|---|
| Đăng ký, phân quyền, dedup, retry và DLQ | [Integration TV1](../tests/integration/tv1.test.ts), [smoke test](../tests/e2e/smoke.ts) | [21 integration tests đạt](evidence/kiem-thu-du-an-ds03/lan-chay-11/evidence/INTEGRATION-TV1.txt), [kết quả smoke](evidence/kiem-thu-du-an-ds03/lan-chay-11/evidence/SMOKE-smoke.json) |
| Passenger đặt xe, Driver hoàn tất, cả hai nhận thông báo | [Kiểm thử UI nghiệp vụ](../scripts/test-ui-business.ts) | [Kết quả trên trình duyệt](evidence/kiem-thu-du-an-ds03/lan-chay-11/evidence/UI-BUSINESS-results.json) |
| Payment dừng, khoản thu chờ, Payment khởi động lại | [Kịch bản E03](../tests/e2e/scenarios.ts) | [Log kết quả E03](evidence/kiem-thu-du-an-ds03/lan-chay-11/evidence/E03-E03.json) |

Xem [tổng hợp kết quả kiểm thử DS03](tong-hop-ket-qua-kiem-thu-ds03.md), [minh chứng theo lượt chạy](evidence/kiem-thu-du-an-ds03/) và [báo cáo Word](report.docx). Lượt 12 tiếp tục từ E03 sau khi lệnh kiểm thử tổng bị gián đoạn.

## 3. Trình tự demo

1. Chạy `npm.cmd run up` và `docker compose ps` để cho thấy các service khởi động riêng.
2. Mở hai phiên trình duyệt tại `http://localhost:3000`. Driver bật sẵn sàng, Passenger đặt xe, Driver nhận và hoàn tất. Kiểm tra `PAID` và thông báo hai bên.
3. Chạy `npm.cmd run demo -- 6` để trình bày hai hành khách tranh một tài xế.
4. Chạy `npm.cmd run e2e -- E03` để trình bày Payment dừng rồi phục hồi. Có thể truy log theo mã chuyến bằng [scripts/logs-by-trip.ps1](../scripts/logs-by-trip.ps1).

Khi cần kiểm chứng triển khai sạch, checkout commit nghiệm thu ở môi trường mới, tạo cấu hình và volumes mới, chạy `npm ci`, `npm run up` và `npm run verify:tv1 -- --full`. Lưu commit, môi trường, log và ảnh xác nhận luồng nghiệp vụ.
