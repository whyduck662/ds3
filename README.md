# DS03 — Mô phỏng đặt xe

Phần TV1: Identity, Gateway, Notification, Web UI, cấu hình chạy và script tích hợp.
Driver/Trip/Matching/Payment đã có code nghiệp vụ và migrations của TV2/TV3. Các lỗi routing/consumer chặn chạy thử đã được sửa; E01/E02/E03 đã chạy PASS. Xem [tài liệu và kết quả TV1](docs/member-1-identity-gateway-notification-web-ui.md).

Tài liệu TV1 được hợp nhất tại [docs/member-1-identity-gateway-notification-web-ui.md](docs/member-1-identity-gateway-notification-web-ui.md). Báo cáo chỉnh sửa bằng Word: [docs/report.docx](docs/report.docx). Kết quả kiểm thử mới nhất và giới hạn nghiệm thu có trong tài liệu TV1/evidence.

## Cấu trúc

```text
src/
  services/
    identity-service/     # TV1: đăng ký, đăng nhập, JWT
    api-gateway/          # TV1: định tuyến, JWT, RBAC
    notification-service/ # TV1: consumer, inbox, thông báo
    trip-service/         # TV2: booking, lifecycle, pricing, Saga
    payment-service/      # TV2: simulated payment
    driver-service/       # TV3: location, reserve, heartbeat
    matching-service/     # TV3: matching, lease recovery
  web-ui/                 # TV1: giao diện React
  common/                 # tiện ích nền tảng dùng chung, không có nghiệp vụ
deploy/                   # Dockerfiles
scripts/                  # start/reset/kill/logs, tạo Compose
  demo/                   # tài khoản mẫu và seed qua HTTP
tests/
  e2e/                    # kiểm tra qua Gateway, lưu artifacts
docs/                     # hướng dẫn và hợp đồng bàn giao
compose.yaml              # cấu hình toàn hệ thống
```

Mỗi backend có `package.json`, `tsconfig.json`, `src/main.ts` riêng. Service có dữ liệu đã triển khai thì có `migrations/`. Đọc `src/services/<service>/README.md` để biết trách nhiệm và cách chạy. Không dùng entrypoint chung chọn service bằng if/else.

## Chạy

Cần Node.js 24, npm, Docker Desktop chạy Linux containers. Trên PowerShell dùng `npm.cmd` nếu máy chặn `npm.ps1`.

```powershell
npm.cmd ci
npm.cmd run up
```

Mở UI tại http://localhost:3000, Gateway tại http://localhost:8080. RabbitMQ Management tại http://localhost:15672 (user `ride`, mật khẩu lấy từ `.env`). `npm run up` tạo `.env` ngẫu nhiên nếu chưa có, bổ sung các biến còn thiếu mà giữ nguyên credentials đã có, build/start/wait containers rồi seed. `INTERNAL_TOKEN` được truyền đồng nhất cho backend và hai Matching instances. Biến đã khai báo nhưng rỗng cần điền trước khi chạy. `.env` không đưa lên Git. Chỉ Gateway/UI/Management được bind vào localhost; DB và backend không public port. PowerShell vẫn hỗ trợ `scripts/start.ps1`. Khả năng redeploy máy sạch cần kiểm chứng theo checklist.

Seed tạo `passenger1@demo.local`, `passenger2@demo.local`, `driver@demo.local`, mật khẩu demo `DemoPass123!`. Không dùng các tài khoản này cho triển khai public.

```powershell
npm.cmd run dev --workspace identity-service
npm.cmd run dev --workspace api-gateway
npm.cmd run dev --workspace notification-service
npm.cmd run dev --workspace web-ui
```

Khi chạy backend ngoài Docker, đặt `JWT_SECRET` giống nhau, `DATABASE_URL` của **chính service đó** và `RABBITMQ_URL` cho Notification. Gateway hỗ trợ `IDENTITY_URL`, `DRIVER_URL`, `TRIP_URL`, `PAYMENT_URL`, `NOTIFICATION_URL`. DB mặc định chỉ nằm trong Docker network; chạy độc lập cần DB riêng có thể kết nối, không dùng URL Docker DNS từ host.

Đặt `INTERNAL_TOKEN` giống nhau ở Driver/Trip/Matching khi chạy ngoài Docker. Compose truyền token không thay thế việc owner bảo vệ endpoint nội bộ của từng service.

```powershell
npm.cmd run typecheck
npm.cmd run build
npm.cmd test
powershell -ExecutionPolicy Bypass -File scripts/test-tv1.ps1
npm.cmd run smoke
npm.cmd run e2e -- E01
```

Smoke cần Compose và seed. Integration TV1 có DB/MQ test riêng, không phụ thuộc TV2/TV3. E01–E03 chạy services thật theo [hợp đồng](docs/contracts.md); lỗi được ghi FAIL, không giả lập PASS. Kết quả chạy được lưu vào `artifacts/` và evidence được chọn. CI chạy build/typecheck/unit/integration và upload evidence. Xem [kiểm thử và demo TV1](docs/member-1-identity-gateway-notification-web-ui.md).

Backend chạy TypeScript qua `tsx` với entrypoint riêng của workspace; `build` kiểm tra biên dịch và build UI. Identity/Notification chạy migration theo tên file có version trong transaction/advisory lock, lưu schema_migrations. Khi đổi schema thêm file SQL đánh số mới, không sửa migration đã áp dụng.

```powershell
powershell -ExecutionPolicy Bypass -File scripts/kill-service.ps1 payment-service
docker compose up -d payment-service
powershell -ExecutionPolicy Bypass -File scripts/logs-by-trip.ps1 <trip-uuid>
```

`reset-demo.ps1` **xóa toàn bộ volume dữ liệu của Compose project ds03**, rồi khởi động và seed lại. Chỉ chạy khi muốn làm mới dữ liệu demo.

Theo dõi tình trạng hiện thực trong [tài liệu TV1](docs/member-1-identity-gateway-notification-web-ui.md). Bản plan là thiết kế, không phải bằng chứng kiểm thử.

## Nghiệm thu và báo cáo

Kết quả các lần kiểm tra được gộp tại [docs/tong-hop-ket-qua-kiem-thu-ds03.md](docs/tong-hop-ket-qua-kiem-thu-ds03.md), đánh số từng lần và không hiển thị ngày giờ. Chạy `npm run check:summary` để tổng hợp lại evidence hiện có.

`npm run verify:tv1` chạy typecheck/build/unit, kiểm tra Docker và tự cập nhật file tổng hợp; bằng chứng gốc đã che secrets được giữ trong `docs/evidence/kiem-thu-du-an-ds03/`. Lệnh trả mã khác 0 khi có FAIL hoặc BLOCKED. `npm run verify:tv1 -- --full` bổ sung test infrastructure, integration, UI fixture, startup/seed, smoke, E01–E04 tuần tự, UI nghiệp vụ, C01/C02 và P01; dừng chuỗi E2E khi một case lỗi. Lệnh full có thể tạo tài khoản/chuyến thử và kill/restart Payment trong E03; không chạy đồng thời với demo/UI cùng tài khoản. Không tự xóa dữ liệu để làm test PASS.

Ch?nh s?a b?o c?o tr?c ti?p trong [report.docx](docs/report.docx).

Khi chỉ cần chạy lại deployment sau một lỗi build/network, dùng `npm run verify:tv1 -- --deployment-only`. Chế độ này không chạy lại typecheck/build/unit/integration/UI fixture; kết quả ghi rõ phạm vi và liên kết lượt evidence trước, không tự công nhận các bài chưa chạy.

Mỗi lượt `verify:tv1` mới tạo một thư mục `lan-chay-NN` với cùng danh sách tên file ở cả ba chế độ. Trong `results.json`, `evidenceFiles` liệt kê minh chứng thật và `missingEvidenceFiles` liệt kê file giữ chỗ. Ảnh giữ chỗ là PNG trong suốt 1×1, còn file JSON và log giữ chỗ ghi lý do thiếu. `SKIPPED` đánh dấu các mục ngoài phạm vi chế độ đã chọn. Các lệnh kiểm thử chạy riêng vẫn lưu kết quả theo đường dẫn cũ trong `artifacts/`.
