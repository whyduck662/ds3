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
powershell -ExecutionPolicy Bypass -File scripts/start.ps1
```

Mở UI tại http://localhost:3000, Gateway tại http://localhost:8080. RabbitMQ Management tại http://localhost:15672 (user `ride`, mật khẩu lấy từ `.env`). Mật khẩu DB/broker/JWT được tạo ngẫu nhiên bởi `init-env.ps1`; `.env` không đưa lên Git. Chỉ Gateway/UI/Management được bind vào localhost; DB và backend không public port.

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
npm.cmd run smoke
npm.cmd run e2e -- E01
```

Smoke cần Compose và seed. E01–E03 cần TV2/TV3 hoàn tất nghiệp vụ và thống nhất payload trong [hợp đồng](docs/contracts.md); lỗi 501 được ghi FAIL, không giả lập PASS. Kết quả chạy được lưu vào `artifacts/`.

Backend chạy TypeScript qua `tsx` với entrypoint riêng của workspace; `build` kiểm tra biên dịch và build UI. SQL khởi tạo idempotent chạy khi Identity/Notification start, đủ cho schema đầu tiên. Khi đổi schema cần migration phiên bản mới.

```powershell
powershell -ExecutionPolicy Bypass -File scripts/kill-service.ps1 payment-service
docker compose up -d payment-service
powershell -ExecutionPolicy Bypass -File scripts/logs-by-trip.ps1 <trip-uuid>
```

`reset-demo.ps1` **xóa toàn bộ volume dữ liệu của Compose project ds03**, rồi khởi động và seed lại. Chỉ chạy khi muốn làm mới dữ liệu demo.

Theo dõi tình trạng hiện thực trong [phần bàn giao TV1](docs/member-1.md). Bản plan là thiết kế, không phải bằng chứng kiểm thử.
