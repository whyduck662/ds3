# Identity — TV1

- `src/main.ts`: kết nối DB, khởi tạo schema, chạy server cổng 8081.
- `src/app.ts`: đăng ký, đăng nhập, lấy tài khoản hiện tại.
- `migrations/001_init.sql`: bảng users của riêng Identity.
- Startup áp dụng migration theo schema_migrations; khi đổi schema thêm file số mới.
- `package.json`: lệnh chạy và dependency riêng.

Chạy từ root: `npm.cmd run dev --workspace identity-service`.
Env: `JWT_SECRET`, `DATABASE_URL`, tùy chọn `PORT`.
API: POST `/auth/register`, POST `/auth/login`, GET `/users/me`.
Đăng ký chỉ được PASSENGER/DRIVER; ADMIN không tạo qua public API.
