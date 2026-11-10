# API Gateway — TV1

- `src/main.ts`: chạy cổng 8080.
- `src/app.ts`: route allowlist, JWT, RBAC, giới hạn request, CORS, proxy.
- Không có DB hoặc migration vì Gateway không giữ dữ liệu nghiệp vụ.

Chạy từ root: `npm.cmd run dev --workspace api-gateway`.
Env: `JWT_SECRET`, `UI_ORIGIN`, các biến `<SERVICE>_URL` (xem README root).
Ownership vẫn phải được kiểm tra trong từng business service.
