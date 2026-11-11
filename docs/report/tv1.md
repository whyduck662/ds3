# Bản thảo phần báo cáo TV1

Đây là nguồn để ghép báo cáo chung, không phải report.pdf cuối và không thay kết quả chạy thật. Điền tên nhóm/MSSV/tên thành viên trước khi nộp.

## 1–3. Bìa, phân công, tóm tắt

- Học phần: Distributed Systems; đề tài DS03, mô phỏng đặt xe.
- TV1: Platform, Identity, Gateway, UI, Notification, integration/demo automation.
- TV2: Trip, Saga, Payment, Pricing; TV3: Driver, Matching, Messaging, concurrency/performance.

Hệ thống thiết kế theo microservices với DB riêng. REST phục vụ yêu cầu đồng bộ; RabbitMQ phục vụ event bất đồng bộ. Phần TV1 cung cấp đăng ký/login, kiểm tra JWT và phân quyền ở Gateway, giao diện Passenger/Driver, nhận/lưu thông báo chống trùng và công cụ triển khai/kiểm thử. Luồng hoàn chỉnh cần các service nghiệp vụ của TV2/TV3; chỉ mô tả kết quả thành công khi có artifacts tích hợp thật.

## 12. Bảo mật

Identity dùng bcrypt cost 12, giới hạn password 8–72 ký tự và không quá 72 byte UTF-8. Public register chỉ cho Passenger/Driver. JWT HS256 có userId/role, issuer ds03, audience ride, thời hạn 15 phút; frontend giữ trong bộ nhớ. Các service đọc xác minh JWT và lấy ownership theo userId trong token.

Gateway giới hạn auth 10 request/phút/IP, booking 30, API khác 120; HTTP body tối đa 10 KB. Chặn internal, bỏ header giả danh và internal-token từ client. Zod validate đầu vào; thông báo MQ giới hạn 64 KB. Secrets lấy từ env được tạo ngẫu nhiên, không commit; log che Authorization/cookie/internal token. DB và backend không mở port ra host trong Compose triển khai. HTTPS chưa cấu hình cho demo local; không coi cấu hình này là triển khai public.

## 13. Hiện thực TV1

- Mỗi backend là workspace, entrypoint riêng trong src/services; common chỉ chứa tiện ích, không giữ DB chung.
- Identity lưu users, hash password, trả JWT và tài khoản; không tạo Driver row trong DB service khác.
- Gateway proxy có timeout 2 giây, không tự retry POST, giữ correlation/idempotency header. RBAC Gateway là lớp biên; service nghiệp vụ vẫn phải tự kiểm tra ownership.
- Notification consume queue notification.events bind trip.*. Trong một transaction: insert eventId inbox, lưu một notification mỗi user, commit rồi ACK. Duplicate inbox không tạo notification mới. Retry dùng 1s/5s/15s, tăng retryCount trong ứng dụng, publisher confirm trước ACK khi chuyển queue; schema lỗi vào DLQ. Không có outbox vì không publish event nghiệp vụ.
- UI poll 2 giây, heartbeat location 5 giây, không tự sửa trạng thái Driver đang reserve/on-trip; hiển thị trạng thái, giá, thanh toán, correlationId, thông báo. State machine thuộc backend.
- Migrations của TV1 có bảng version và transaction/advisory lock để startup lặp an toàn. Startup/seed chỉ gọi API; reset xóa volume của project ds03 có chủ đích.

## Bằng chứng phải ghép sau khi chạy

Đính kèm artifacts/unit.json, integration.json, E01–E03 JSON/logs, ảnh UI/Gateway/MQ cùng môi trường và command. Integration dùng envelope fixture là kiểm thử riêng Notification, không được gọi đó là Trip producer thật. Test concurrency, payment exactly-once business effects và compensation phải có evidence do TV2/TV3 xác minh.

## 18. Tài liệu tham khảo

- General_Requirements_and_DS03_English.md; plan_DS03_v5.md.
- Fastify hooks: https://fastify.dev/docs/latest/Reference/Hooks/
- RabbitMQ acknowledgements/confirms: https://www.rabbitmq.com/docs/confirms
- API dependencies và phiên bản: package-lock.json.
- Có sử dụng trợ giúp AI trong viết mã/tài liệu; nhóm phải review, kiểm thử và hiểu phần đóng góp trước khi nộp.

## 19. Phụ lục

- docs/contracts.md: JWT, route/payload và giao diện bàn giao.
- docs/openapi/tv1.yaml: REST API thuộc TV1.
- docs/demo.md: 9 tình huống và lệnh automation.
- docs/testing.md: test IDs, điều kiện chạy, artifacts.
- Git history: bổ sung commit/PR thật của từng thành viên, không tự tạo lịch sử đóng góp.
