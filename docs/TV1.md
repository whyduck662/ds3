# TV1 — Triển khai, kiểm thử và bàn giao

Đây là tài liệu theo dõi chính cho thành viên 1, hợp nhất hướng dẫn chạy, demo, kiểm thử, kết quả, đối chiếu yêu cầu và checklist bàn giao. Cập nhật 17/11/2026. Các tài liệu TV2/TV3 và hợp đồng dùng chung không được gộp hoặc đổi quyền sở hữu.

## 1. Đọc và chỉnh sửa tài liệu

- Tài liệu TV1: **file này**.
- Báo cáo chỉnh sửa bằng Microsoft Word/LibreOffice: [report.docx](report.docx). Báo cáo đã viết đủ sáu chương cho DS03 theo mẫu Markdown, có sơ đồ/ảnh thật và số liệu; thông tin hành chính để trống theo yêu cầu, hồ sơ giao nộp vẫn cần xác nhận.
- Nguồn báo cáo có thể tái tạo: [report.md](report.md). Chạy `npm run report:word` để xuất lại Word (cần Python 3, không cần thư viện bổ sung). Lệnh xuất lại sẽ ghi đè report.docx, vì vậy giữ riêng bản Word đã chỉnh trực tiếp.
- PDF dùng để xem/nộp sau nghiệm thu: `npm run report:pdf` → [report.pdf](report.pdf).
- Hợp đồng API/event dùng chung: [contracts.md](contracts.md); REST TV1: [openapi/tv1.yaml](openapi/tv1.yaml).
- Kết quả các lần kiểm tra: [Tổng hợp kiểm thử](kiem-thu.md). Log, JSON và ảnh gốc được giữ trong `docs/evidence/` để đối chiếu.
- Nội dung nguyên bản của 9 tài liệu TV1 trước hợp nhất: [hồ sơ lịch sử](evidence/tv1/document-history-before-consolidation.json). Chỉ dùng để tra lịch sử, không làm trạng thái nghiệm thu hiện tại.

## 2. Phạm vi và trách nhiệm

| Thành phần | TV1 chịu trách nhiệm |
|---|---|
| Identity | Schema/migration, register/login/me, bcrypt, JWT/role, validation |
| Gateway | Routing, JWT/RBAC, CORS, rate limit, body limit, timeout/503, correlation/idempotency, chặn internal/header giả danh |
| Notification | DB riêng, consumer trip.*, transaction inbox/notifications, dedup, ACK sau COMMIT, retry/DLQ/reconnect, API ownership |
| Web UI | Passenger booking/current/cancel; Driver location/status/heartbeat/offers/accept/reject/start/complete; fare/payment/correlation và notification polling |
| Platform | Monorepo/lockfile/Compose/CI, env generator, migration helper, startup/seed/reset/kill/logs |
| Tích hợp | Smoke/E01–E03, demo runner 1–9, UI test, evidence, README và tổng hợp báo cáo |

TV2 tiếp tục sở hữu Trip/Saga/Payment/Pricing và checker nghiệp vụ. TV3 tiếp tục sở hữu Driver/Matching/Messaging, C01/C02 và benchmark P01. Theo yêu cầu chạy thử ngày 17/11, đã sửa trực tiếp các lỗi tích hợp ở các module này; điều đó không thay phân công owner hoặc công nhận tất cả test của họ đã hoàn tất.

## 3. Chạy hệ thống

Yêu cầu: Node.js 24, npm, Docker Desktop Linux containers đang chạy. Microsoft Edge dùng cho bài UI/PDF; Python 3 dùng để tạo Word. PowerShell có thể dùng npm.cmd nếu npm.ps1 bị chặn.

```powershell
npm.cmd ci
npm.cmd run up
```

Startup tạo .env nếu chưa có và bổ sung biến thiếu mà giữ credentials cũ. JWT_SECRET, INTERNAL_TOKEN, RabbitMQ và DB passwords được tạo ngẫu nhiên; biến đã khai báo nhưng rỗng cần điền trước. Không đưa .env vào evidence hoặc Git. Compose truyền INTERNAL_TOKEN đồng nhất cho backend/hai Matching instances. Bảo vệ từng endpoint vẫn là trách nhiệm service.

| Địa chỉ | Chức năng |
|---|---|
| http://localhost:3000 | UI |
| http://localhost:8080 | Gateway |
| http://localhost:15672 | RabbitMQ Management, user ride; mật khẩu đọc tại .env |

Tài khoản seed: passenger1@demo.local, passenger2@demo.local, driver@demo.local; mật khẩu demo DemoPass123!. Seed tạo tài khoản qua HTTP; không ghi chéo DB. Các tài khoản này chỉ dành cho demo local.

Khi chạy service ngoài Docker, đặt JWT_SECRET/INTERNAL_TOKEN đồng nhất, DATABASE_URL đúng DB của service, RABBITMQ_URL phù hợp. Gateway hỗ trợ IDENTITY_URL/DRIVER_URL/TRIP_URL/PAYMENT_URL/NOTIFICATION_URL. Không dùng hostname Docker DNS từ host nếu chưa có cấu hình kết nối tương ứng.

## 4. Kiểm tra và cách lưu evidence

```powershell
npm.cmd run verify:tv1
npm.cmd run verify:tv1 -- --full
npm.cmd run verify:tv1 -- --deployment-only
```

- Local: typecheck/build/unit và kiểm tra Docker; không công nhận runtime đã chạy.
- Full: thêm test infrastructure, integration TV1, UI fixture, startup/seed, smoke, E01/E02/E03 tuần tự và UI nghiệp vụ thật.
- E04 bổ sung kiểm tra reject/rematch với một Driver: tài xế từ chối phải được release, không nhận lại cùng chuyến; không còn ứng viên thì CANCELLED/VOIDED.
- Deployment-only: startup/seed/smoke/E01–E03/UI thật; liên kết lượt evidence trước, không chạy lại hoặc công nhận lại integration/unit.
- Lệnh trả mã khác 0 nếu có FAIL/BLOCKED. REDEPLOY là kiểm tra máy sạch riêng, không tự đạt chỉ vì startup trên máy hiện tại thành công.
- Full tạo chuyến thử; E03 kill/restart Payment thật. Không thao tác đồng thời UI/demo với cùng tài khoản. Không tự xóa dữ liệu hoặc sửa trạng thái DB để làm test PASS.

Kết quả đọc tại [Tổng hợp kiểm thử](kiem-thu.md), được trình bày theo từng lần kiểm tra, không hiển thị ngày giờ. Evidence gốc giữ thông tin môi trường, command, expected/actual và log đã che secrets.

```powershell
docker compose -f deploy/compose.test.yaml up -d --wait
npm.cmd run test:integration
npm.cmd run test:ui
```

Integration/UI fixture dùng PostgreSQL identity_test/notification_test trên 55431/55436 và RabbitMQ test trên 5673. Không dùng DB triển khai; không tự SKIP khi thiếu hạ tầng. UI fixture dùng cổng riêng 3001/8088; chạy tuần tự với integration do dùng chung test DB/MQ. Kết thúc có thể stop Compose test, không cần xóa volumes.

`npm run test:ui:business` dùng hai browser contexts trên deployment thật 3000/8080: bảy heartbeat thành công (>30 giây), booking/accept/start/complete, CAPTURED và một thông báo thanh toán cho mỗi người. Không intercept network/publish fixture; ảnh và JSON ở artifacts/ui-business/. UI fixture kiểm tra riêng auth/role/notification/lỗi; không thay thế bài nghiệp vụ thật.

## 5. Kết quả và lịch sử chạy thử

Toàn bộ các lần kiểm tra được gộp tại [Tổng hợp kiểm thử](kiem-thu.md), đánh số lần kiểm tra và không hiển thị ngày giờ. Đây là nơi theo dõi kết quả, lỗi đã phát hiện và các phần chưa kiểm chứng.

Kết quả lần kiểm tra 15 (full): typecheck/build PASS, 44/44 unit tests PASS, 21/21 integration tests PASS, 9/9 UI fixture checks PASS; startup, smoke, E01–E04, UI nghiệp vụ thật, C01/C02 và P01 đều PASS. Bản sửa Driver đã được kiểm chứng bằng bốn regression tests với PostgreSQL thật và bộ nghiệp vụ đã được chạy lại sau bản sửa. Tổng trạng thái vẫn BLOCKED vì triển khai trên máy sạch chưa được kiểm chứng.

Chạy `npm run check:summary` để cập nhật file tổng hợp từ evidence hiện có. `npm run verify:tv1` cũng tự cập nhật file này sau khi hoàn tất.

## 6. Demo theo Course Project §7.4

| Tình huống | Lệnh/thao tác | Quan sát |
|---|---|---|
| 1. Start độc lập | npm run demo -- 1; docker compose ps | Process/container và DB riêng, healthchecks |
| 2–5. Available → booking → matching → hoàn thành | npm run demo -- 2-5 hoặc UI hai phiên | TripId/correlation, DRIVER_ASSIGNED → ACCEPTED → IN_PROGRESS → PAID, thông báo hai bên |
| 6. Hai Passenger tranh Driver | npm run demo -- 6 | CLI C01 của TV3; cần kiểm tra invariant từ owner |
| 7–9. Kill → pending → restart | npm run demo -- 7-9 | Payment dừng thật, CAPTURE_PENDING, restart → CAPTURED/PAID |
| Hủy/bù trừ | npm run demo -- cancel | CANCELLED, Driver được giải phóng, Payment VOIDED, thông báo hai bên |
| Reject/rematch | npm run e2e -- E04 | Một Driver từ chối → không được gán lại → CANCELLED, Driver release, Payment VOIDED |

Chạy E01/E02/E03 tuần tự. TV1 trình bày chính demo 1–3 và hỗ trợ UI/reset; TV3 demo 4–6; TV2 demo 7–9. Logs: scripts/logs-by-trip.ps1 <trip-uuid>. scripts/reset-demo.ps1 xóa toàn bộ volumes của project ds03, chỉ dùng khi dữ liệu demo có thể bỏ.

## 7. Redeploy máy sạch

1. Clone vào thư mục/máy mới; checkout commit nghiệm thu. Không chép .env/node_modules/volumes từ máy cũ.
2. Cài prerequisites, chạy npm ci và npm run up.
3. Kiểm tra UI/Gateway/docker compose ps. Không đính kèm docker compose config vì có thể lộ secrets.
4. Chạy verify:tv1 -- --full và lưu evidence. Nếu lỗi, giữ trạng thái để điều tra.
5. Trình duyệt hai phiên: online/heartbeat >30 giây, tạo chuyến, accept/start/complete, fare/CAPTURED, thông báo hai bên; kiểm tra cancel/reject riêng và lỗi API không giữ busy vô hạn.
6. Ghi commit/môi trường/lệnh/expected/actual/screenshot. Chỉ tick REDEPLOY khi đã thực hiện trên môi trường sạch.

## 8. Đối chiếu kiểm thử bắt buộc (§9)

Lượt full ngày 17/11/2026 đáp ứng ngưỡng **8 functional, 2 concurrency, 2 fault/recovery, 2 security/invalid và 1 performance**. Mỗi dòng dưới đây là một ca hoặc một thí nghiệm đã chạy. Ca có nhiều bước hoặc nhiều assertion chỉ được tính một lần. [Kết quả lượt full](evidence/tv1/2026-11-17T13-45-47-283Z/results.json).

| Nhóm | Ca thực tế | Kết quả và minh chứng |
|---|---|---|
| Functional 1 | Đăng ký, đăng nhập và đọc hồ sơ qua Gateway | PASS, role đúng và mật khẩu được hash. [Integration](evidence/tv1/2026-11-17T13-45-47-283Z/INTEGRATION-TV1-integration.json) |
| Functional 2 | Driver chuyển trạng thái OFFLINE ↔ AVAILABLE | PASS. [Unit](evidence/tv1/2026-11-17T13-45-47-283Z/UNIT-unit.json) |
| Functional 3 | Driver cập nhật GPS và heartbeat | PASS. [Unit](evidence/tv1/2026-11-17T13-45-47-283Z/UNIT-unit.json) |
| Functional 4 | Gửi lại booking với cùng `Idempotency-Key` | PASS, cùng nội dung trả kết quả cũ, đổi nội dung trả 422. [Unit](evidence/tv1/2026-11-17T13-45-47-283Z/UNIT-unit.json) |
| Functional 5 | E01 — đặt xe, ghép tài xế, nhận và hoàn tất chuyến, thu tiền | PASS, `CAPTURED` đúng cước 23.000 đồng. [E01](evidence/tv1/2026-11-17T13-45-47-283Z/E01-E01.json) |
| Functional 6 | E02 — hủy chuyến đã ghép | PASS, tài xế được giải phóng và thanh toán chuyển `VOIDED`. [E02](evidence/tv1/2026-11-17T13-45-47-283Z/E02-E02.json) |
| Functional 7 | E04 — Driver từ chối, ghép lại với tập ứng viên chỉ có Driver đã từ chối | PASS, chuyến hủy, tài xế được giải phóng và thanh toán chuyển `VOIDED`. [E04](evidence/tv1/2026-11-17T13-45-47-283Z/E04-E04.json) |
| Functional 8 | Event RabbitMQ gửi lặp, lưu thông báo cho hai phía | PASS, mỗi người nhận có một bản ghi cho event. [Integration](evidence/tv1/2026-11-17T13-45-47-283Z/INTEGRATION-TV1-integration.json) |
| Concurrency 1 | C01 — hai hành khách đặt đồng thời khi chỉ có một tài xế | PASS, một chuyến `DRIVER_ASSIGNED`, một chuyến `CANCELLED`. [C01](evidence/tv1/2026-11-17T13-45-47-283Z/CONCURRENCY-c01.json) |
| Concurrency 2 | C02 — một hành khách gửi 10 booking song song | PASS, một thành công và chín HTTP 409. [C02](evidence/tv1/2026-11-17T13-45-47-283Z/CONCURRENCY-c02.json) |
| Fault/recovery 1 | E03 — dừng Payment khi chuyến đang xử lý, khởi động lại | PASS, capture chờ khi Payment dừng và hoàn tất sau restart. [E03](evidence/tv1/2026-11-17T13-45-47-283Z/E03-E03.json) |
| Fault/recovery 2 | X06 — khởi động lại RabbitMQ test | PASS, consumer tự kết nối lại và xử lý event. [Integration](evidence/tv1/2026-11-17T13-45-47-283Z/INTEGRATION-TV1-integration.json) |
| Security/invalid 1 | Passenger gọi `GET /drivers/me` | PASS, HTTP 403. [Smoke](evidence/tv1/2026-11-17T13-45-47-283Z/SMOKE-smoke.json) |
| Security/invalid 2 | Gửi `since=wrong` tới `GET /notifications/me` | PASS, HTTP 400. [Smoke](evidence/tv1/2026-11-17T13-45-47-283Z/SMOKE-smoke.json) |
| Performance 1 | P01 — `GET /notifications/me`, 100 request mỗi mức đồng thời 1/5/10 | 0/300 lỗi, p95 lần lượt 12,44 / 45,41 / 79,98 ms, throughput 113,61 / 201,13 / 197,35 request/s. Phạm vi là API đọc. [P01](evidence/tv1/2026-11-17T13-45-47-283Z/P01-p01.json) |

## 9. Checklist còn lại trước giao nộp

- [ ] Điền tên nhóm, họ tên/MSSV/GitHub; xác nhận đăng ký đúng với giảng viên.
- [x] Đủ các ca đã chạy theo Course Project §9. Xem bảng minh chứng ở mục 8.
- [ ] TV2 cung cấp DB invariant/recovery/Saga evidence và phần báo cáo kỹ thuật.
- [x] C01/C02 hợp lệ, recovery Driver/Matching và P01 đường đọc có số liệu; giới hạn từng bài được ghi trong báo cáo.
- [x] TV1 nghiệm thu UI nghiệp vụ thật; evidence phía trên.
- [ ] TV1 redeploy máy sạch; ghi rõ giới hạn chưa kiểm tra.
- [ ] Ghép report.docx, cập nhật PDF cuối, references và bảng đóng góp thực tế.
- [ ] Kiểm tra commit/PR từng người, quyền giảng viên nếu private, final tag/release sau nghiệm thu.
- [ ] Cả ba thành viên tham gia demo và hiểu kiến trúc/phần được giao.

Slides tùy chọn. Không suy ra đáp ứng toàn bộ Course Project từ sự tồn tại script, PDF/Word hoặc container healthy. TLS, tracing, dashboard và scaling nâng cao không thay thế yêu cầu cơ bản chưa kiểm chứng.
