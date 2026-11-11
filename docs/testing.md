# Báo cáo kiểm thử và bằng chứng TV1

Cập nhật tổng hợp: **11/11/2026**. Đây là file theo dõi kiểm thử duy nhất: hướng dẫn chạy, phạm vi test, kết quả backend và kết quả trình duyệt. Các bằng chứng JSON/ảnh vẫn lưu riêng và được liên kết bên dưới.

| Đợt xác minh | Kết quả | Phạm vi |
|---|---|---|
| Backend/platform — 10/11/2026 | Typecheck/build, 9 unit, 8 integration, startup/seed và smoke PASS theo biên bản bàn giao | TV1, PostgreSQL/RabbitMQ thật; chưa phải E2E toàn nhóm |
| UI — 11/11/2026 | 9/9 kiểm tra Edge PASS | Đăng ký/login, phân quyền, thông báo và xử lý lỗi |
| Kiểm tra lại sau sửa UI — 11/11/2026 | Typecheck và 9/9 unit PASS | Sửa thông báo sai mật khẩu |
| E01–E03, concurrency/Saga/performance toàn nhóm | Chưa nghiệm thu | Chờ nghiệp vụ TV2/TV3 |

Các kết quả ngày 10/11 là lịch sử bàn giao, không có nghĩa toàn bộ đã chạy lại ngày 11/11. Mã security trong bảng phạm vi dưới đây dùng mã của plan; tên test cũ trong source có thể còn nhãn khác. Bằng chứng UI đã chọn nằm tại `docs/evidence/ui/`; không suy ra PASS từ số lượng assertion, fixture MQ hoặc healthcheck.

## Hướng dẫn chạy và phạm vi kiểm thử

### Chạy nhanh

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
| S02 (plan) | token thiếu/sai/hết hạn | unit.json |
| S03/S05 (phạm vi Notification; plan) | sai role, ownership Notification, không tự cấp ADMIN | unit.json + integration.json |
| S01/S04 (plan) | schema/field thừa, password UTF-8, body limit, rate limit | unit.json |
| S03 (plan) | chặn internal/payment command, bỏ header giả danh | unit.json |
| Notification recovery | rollback khi DB không xử lý được, retry rồi phục hồi; consumer dừng và nhận message sau restart | integration.json |
| X06 (TV1) | restart RabbitMQ test, consumer tự reconnect và xử lý tiếp event | integration.json |
| Notification DLQ | schema sai vào DLQ, không commit inbox | integration.json |
| Gateway transport | giữ correlation/idempotency, 503 khi upstream down | unit.json |
| E01/E02/E03 | luồng thật toàn hệ thống | E01/E02/E03.json + container logs, chờ TV2/TV3 |

Fixture `tv1-test-fixture` chỉ tạo trip envelope cho Notification, không thay thế producer Trip thật. Test DB lỗi tạm thời đổi tên bảng notifications trong DB test, khôi phục ở finally để kiểm tra rollback và retry bằng broker thật.

X06 gọi Docker CLI để restart **chỉ RabbitMQ trong Compose test**. Chạy integration bằng lệnh trong hướng dẫn, cần quyền Docker. TEST_RABBITMQ_URL tùy chỉnh không được dùng cho X06 để tránh restart nhầm broker. Phần phục hồi outbox nghiệp vụ khi broker down vẫn do TV2/TV3 kiểm thử.

Các test TV2/TV3 về CAS, Saga, payment tombstone, concurrency và performance do owner triển khai. TV1 không tuyên bố bộ kiểm thử toàn nhóm đã đủ §9 chỉ dựa vào số lượng unit test. TV3 bàn giao `tests/concurrency/c01.ts` để demo runner gọi; TV2 cung cấp DB invariant checker cho capture/compensation.

Artifacts không commit mặc định. Khi ghi report, đính kèm artifacts chạy thật, command, môi trường, thời gian và seed. Không ghi PASS chỉ vì có script hoặc Docker healthcheck.

## Kiểm tra bàn giao TV1 — 10/11/2026

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
- UI đã được kiểm tra bổ sung bằng Edge headless ngày 11/11/2026: xem phần kiểm tra UI bên dưới. Chức năng Trip/Driver/Payment vẫn phụ thuộc backend của owner tương ứng.
- Không thay đổi source Driver, Matching, Trip, Payment. Test fixture event chỉ nằm trong bộ kiểm thử integration và script kiểm tra UI, không nằm trong business service.
- CI đã cấu hình nhưng chưa được push/chạy trên GitHub trong lần bàn giao này.
- Report cuối, benchmark và Git contribution evidence của cả nhóm cần ghép sau khi các owner hoàn tất.

## Kiểm tra UI TV1 — 11/11/2026

Kết quả: **9/9 kiểm tra PASS** trên Microsoft Edge headless, viewport 1280 × 900. `npm run typecheck` PASS sau thay đổi. Bộ kiểm tra điều khiển trình duyệt thật bằng Playwright, dùng UI Vite, Identity/Gateway/Notification thật và PostgreSQL/RabbitMQ riêng của `deploy/compose.test.yaml`.

| Kiểm tra | Kết quả |
|---|---|
| Đăng ký Passenger qua form | PASS |
| Sai mật khẩu: thông báo đúng lỗi, giữ màn hình login | PASS |
| Login Passenger, địa điểm Hà Nội, chặn điểm đón trùng điểm đến, ẩn thao tác Driver | PASS |
| Gọi từ trình duyệt bằng token Passenger vào Driver/internal API bị 403 | PASS |
| Event RabbitMQ gửi hai lần, UI hiển thị một thông báo | PASS |
| Upstream chưa chạy: hiện lỗi, nút đặt xe được mở lại | PASS |
| Phản hồi 401 khi polling: logout và yêu cầu đăng nhập lại | PASS |
| Đăng ký/login Driver, ẩn nút đặt xe, hiện chọn vị trí tài xế | PASS |
| Không có JavaScript pageerror chưa xử lý | PASS |

Đã sửa lỗi trong `App.tsx`: trước đây mọi lỗi 401, kể cả sai mật khẩu lúc đăng nhập, đều hiện “Phiên đã hết hạn”. Nay thông báo hết phiên chỉ áp dụng khi có session; lỗi đăng nhập giữ thông báo từ Identity.

### Chạy lại

Yêu cầu: Docker, dependencies đã cài bằng `npm ci`, Microsoft Edge, cổng 3000/8080 còn trống. Script dùng cố định DB test tên `identity_test`/`notification_test` và broker test trên cổng 5673, không dùng DB triển khai.

```powershell
docker compose -f deploy/compose.test.yaml up -d --wait
npm.cmd run test:ui
docker compose -f deploy/compose.test.yaml stop
```

Script tự đóng trình duyệt, UI server, backend và các kết nối sau khi chạy. Ảnh từng bước và JSON mới nằm ở `artifacts/ui/`. Bản kết quả được chọn để bàn giao: [JSON](evidence/ui/results.json), [ảnh Passenger và thông báo](evidence/ui/passenger-notification.png), [ảnh Driver](evidence/ui/driver.png).

### Phạm vi xác minh

- Thông báo được tạo bằng **MQ fixture của test**, không phải producer Trip thật; xác minh đường MQ → Notification DB/API → polling UI.
- Trường hợp hết phiên dùng Playwright trả 401 có kiểm soát cho Notification API; kiểm tra phản ứng UI, không chờ JWT hết hạn 15 phút. Xác minh chữ ký/expiry JWT thật nằm ở suite security riêng.
- Trip/Driver/Payment upstream trong test được trỏ tới port đóng để xác minh UI xử lý service không sẵn sàng; không tuyên bố đặt chuyến, matching, heartbeat hay payment thật đã PASS.
- Chưa kiểm tra định vị thiết bị, mobile hoặc luồng chuyến đi toàn hệ thống. Đây là kết quả riêng TV1.
