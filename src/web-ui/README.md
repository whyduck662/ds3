# Web UI — TV1

- `src/main.tsx`: form đăng nhập/đăng ký và giao diện Passenger/Driver tối thiểu.
- `src/style.css`: giao diện.
- `index.html`: trang vào ứng dụng.

Chạy: `npm.cmd run dev --workspace web-ui` từ root.
`VITE_API_URL` mặc định `http://localhost:8080`.
JWT chỉ giữ trong bộ nhớ. Reload trang cần đăng nhập lại.
Polling 2 giây; chức năng Trip/Driver chờ API thật của TV2/TV3.
