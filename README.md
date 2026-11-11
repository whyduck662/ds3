# DS03 — Mô phỏng đặt xe

Phần TV1: Identity, Gateway, Notification, Web UI, cấu hình chạy và script tích hợp.
Driver/Trip/Matching/Payment hiện là **khung healthcheck trả 501 cho nghiệp vụ**, bàn giao TV2/TV3.

## Cấu trúc

```text
src/
  services/
    identity-service/     # TV1: đăng ký, đăng nhập, JWT
    api-gateway/          # TV1: định tuyến, JWT, RBAC
    notification-service/ # TV1: consumer, inbox, thông báo
    trip-service/         # TV2: khung bàn giao
    payment-service/      # TV2: khung bàn giao
    driver-service/       # TV3: khung bàn giao
    matching-service/     # TV3: khung bàn giao
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

Mở UI tại http://localhost:3000, Gateway tại http://localhost:8080. RabbitMQ Management tại http://localhost:15672 (user `ride`, mật khẩu lấy từ `.env`). `npm run up` chạy được trên Windows/Linux/macOS, tạo `.env` ngẫu nhiên nếu chưa có, build/start/wait containers rồi seed. `.env` không đưa lên Git. Chỉ Gateway/UI/Management được bind vào localhost; DB và backend không public port. PowerShell vẫn hỗ trợ `scripts/start.ps1`.

Seed tạo `passenger1@demo.local`, `passenger2@demo.local`, `driver@demo.local`, mật khẩu demo `DemoPass123!`. Không dùng các tài khoản này cho triển khai public.

```powershell
npm.cmd run dev --workspace identity-service
npm.cmd run dev --workspace api-gateway
npm.cmd run dev --workspace notification-service
npm.cmd run dev --workspace web-ui
```

Khi chạy backend ngoài Docker, đặt `JWT_SECRET` giống nhau, `DATABASE_URL` của **chính service đó** và `RABBITMQ_URL` cho Notification. Gateway hỗ trợ `IDENTITY_URL`, `DRIVER_URL`, `TRIP_URL`, `PAYMENT_URL`, `NOTIFICATION_URL`. DB mặc định chỉ nằm trong Docker network; chạy độc lập cần DB riêng có thể kết nối, không dùng URL Docker DNS từ host.

```powershell
npm.cmd run typecheck
npm.cmd run build
npm.cmd test
powershell -ExecutionPolicy Bypass -File scripts/test-tv1.ps1
npm.cmd run smoke
npm.cmd run e2e -- E01
```

Smoke cần Compose và seed. Integration TV1 có DB/MQ test riêng, không phụ thuộc TV2/TV3. E01–E03 cần TV2/TV3 hoàn tất nghiệp vụ theo [hợp đồng](docs/contracts.md); lỗi 501 được ghi FAIL, không giả lập PASS. Kết quả chạy được lưu vào `artifacts/`. CI chạy build/typecheck/unit/integration và upload evidence. Xem [kiểm thử](docs/testing.md) và [9 demo](docs/demo.md).

Backend chạy TypeScript qua `tsx` với entrypoint riêng của workspace; `build` kiểm tra biên dịch và build UI. Identity/Notification chạy migration theo tên file có version trong transaction/advisory lock, lưu schema_migrations. Khi đổi schema thêm file SQL đánh số mới, không sửa migration đã áp dụng.

```powershell
powershell -ExecutionPolicy Bypass -File scripts/kill-service.ps1 payment-service
docker compose up -d payment-service
powershell -ExecutionPolicy Bypass -File scripts/logs-by-trip.ps1 <trip-uuid>
```

`reset-demo.ps1` **xóa toàn bộ volume dữ liệu của Compose project ds03**, rồi khởi động và seed lại. Chỉ chạy khi muốn làm mới dữ liệu demo.

Theo dõi tình trạng hiện thực trong [phần bàn giao TV1](docs/member-1.md). Bản plan là thiết kế, không phải bằng chứng kiểm thử.
