# Demo TV1 và điểm tích hợp TV2/TV3

Chuẩn bị: Node 24, Docker đang chạy, `npm ci`, `npm run up`. Driver/Trip/Matching/Payment hiện là skeleton nên demo 2–9 sẽ FAIL/BLOCKED cho đến khi owner bàn giao. Không dùng mock nghiệp vụ để tính PASS.

| Demo theo §7.4 | Lệnh/thao tác | Điều kiện quan sát |
|---|---|---|
| 1. Start độc lập | `npm run demo -- 1`, `docker compose ps`; có thể restart riêng từng service | Container riêng, healthcheck |
| 2. Driver available | `npm run demo -- 2-5` hoặc UI tài xế → Trực tuyến | PUT location, PUT status AVAILABLE |
| 3. Passenger đặt xe | Cùng E01 hoặc UI hành khách | POST /trips có Idempotency-Key, hiện tripId/correlationId |
| 4. Matching chọn Driver | Cùng E01, xem logs-by-trip | DRIVER_ASSIGNED, reservation; TV3 cung cấp DB invariant evidence |
| 5. Driver nhận/hoàn thành | Cùng E01 hoặc UI tài xế | ACCEPTED → IN_PROGRESS → COMPLETED → PAID, thông báo hai vai trò |
| 6. Hai Passenger tranh Driver | `npm run demo -- 6` | Gọi test C01 TV3 tại tests/concurrency/c01.ts; chưa có thì BLOCKED |
| 7. Dừng service | `npm run demo -- 7-9` | E03 kill Payment sau IN_PROGRESS, kiểm tra container không còn running |
| 8. Queue/retry/compensation | Cùng E03; hoặc `npm run demo -- cancel` (E02) | CAPTURE_PENDING khi Payment dừng; hoặc CANCELLED + driver release + payment VOIDED |
| 9. Restart, tiếp tục | Cùng E03 | Khởi động Payment, đợi PAID, payment CAPTURED, notification không trùng |

Chạy E01/E02/E03 từ dữ liệu sạch, không chạy cùng lúc vì dùng cùng Driver và Passenger 1. Reset **xóa dữ liệu**: `powershell -ExecutionPolicy Bypass -File scripts/reset-demo.ps1`. Dừng UI đang chạy cùng tài khoản trong lúc E2E để tránh thao tác chen vào.

E03 chạy trên Compose local mặc định, tự khôi phục Payment trong finally nếu có lỗi. Mỗi case có JSON và container logs tại artifacts/. E03 kiểm tra kết quả qua API; TV2 vẫn phải cung cấp truy vấn DB chứng minh không capture lặp. E02 kiểm tra cleanup qua API, TV2/TV3 bổ sung evidence Saga/reservation.

Tài khoản seed: passenger1@demo.local, passenger2@demo.local, driver@demo.local; mật khẩu demo DemoPass123!. TV3 khởi tạo Driver profile theo userId trong JWT khi gọi API /drivers/me; seed TV1 không ghi DB của Driver.

Trình bày TV1: đăng ký/login, cấu trúc service, DB riêng, Gateway chặn internal/role sai, Notification inbox/ACK sau commit; chạy `npm run smoke`. Khi kiểm thử Notification độc lập dùng fixture trong integration TV1, nêu rõ đây là test message, chưa phải event từ Trip thật.
