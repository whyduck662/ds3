# Web UI — TV1

- `src/main.tsx`: entrypoint React.
- `src/App.tsx`: đăng nhập/đăng ký, Passenger/Driver, polling và heartbeat.
- `src/api.ts`: HTTP timeout/error; `src/types.ts`: response contract.
- `src/style.css`: giao diện.
- `index.html`: trang vào ứng dụng.

Chạy: `npm.cmd run dev --workspace web-ui` từ root.
`VITE_API_URL` mặc định `http://localhost:8080`.
JWT chỉ giữ trong bộ nhớ. Reload trang cần đăng nhập lại.
Điểm đón, điểm đến và vị trí tài xế chọn bằng tên địa điểm mô phỏng tại Hà Nội; không cần nhập tọa độ. Danh sách ở `src/locations.ts`. Nút “Dùng vị trí hiện tại” lấy vị trí thiết bị sau khi người dùng cấp quyền (cần HTTPS hoặc localhost); khi không định vị được vẫn chọn được địa điểm có sẵn. Điểm đến phải khác điểm đón. API vẫn nhận `{lat, lng}` theo contract hiện có.
Polling 2 giây; heartbeat location 5 giây khi Driver online, không tự đổi status. Theo dõi chuyến đã nhận, hiển thị giá/thanh toán và xử lý hết phiên. Chức năng Trip/Driver chờ API thật của TV2/TV3 theo docs/contracts.md.
