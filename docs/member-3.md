# Bàn giao thành viên 3 (TV3)

**Học phần:** Distributed Systems (DS03)  
**Phạm vi sở hữu:** `driver-service`, `matching-service` (2 instances), `common/messaging`, RabbitMQ topology, simulator/k6, concurrency scripts C01/C02.

---

## 1. Các thành phần đã triển khai hoàn chỉnh

### 1.1 Hạ tầng Messaging dùng chung (`@ds03/common`)
- **`src/common/src/rabbit.ts`:**
  - Kết nối RabbitMQ qua `amqp-connection-manager` có publisher confirms.
  - Khai báo đầy đủ Topology:
    - Exchanges: `ride.commands` (direct), `ride.events` (topic), `ride.retry` (direct), `ride.dlq` (direct).
    - Queues chính: `payment.commands`, `matching.commands`, `driver.commands`, `trip.replies`, `trip.driver-events`, `driver.trip-events`, `notification.events`.
    - Queues retry 3 cấp độ: `<queue>.retry.1s`, `<queue>.retry.5s`, `<queue>.retry.15s` có `x-message-ttl` tự dead-letter về main queue.
    - Queue DLQ: `<queue>.dlq`.
- **`src/common/src/consumer.ts`:**
  - Pipeline xử lý tin cậy: Parse Zod -> Inbox deduplication (`processed_messages`) -> DB Transaction (`markProcessed` + handler) -> DB COMMIT -> Manual ACK.
  - Phân loại lỗi: Lỗi vĩnh viễn (schema/JSON) vào thẳng DLQ; lỗi tạm thời (network/transient) retry tối đa 3 lần với delay tăng dần; vượt quá 3 lần vào DLQ.
  - Cam kết: **Không bao giờ ACK trước khi DB commit hoặc trước khi hoàn tất publish retry/DLQ.**
- **`src/common/src/outbox.ts`:**
  - Poller outbox dùng `FOR UPDATE SKIP LOCKED`, publish với publisher confirms, cập nhật `SENT` hoặc tăng backoff khi lỗi mạng.

---

### 1.2 Dịch vụ Quản lý Tài xế (`driver-service` - Port 8082)
- **Cơ sở dữ liệu (`driver-db`):**
  - Schema `drivers` với các trường: `status` ('AVAILABLE', 'RESERVED', 'ON_TRIP', 'OFFLINE'), `current_trip_id`, `reservation_id`, `reservation_version`, `reserved_until`, `last_seen_at`, `version`.
  - Bảng `outbox` và `processed_messages` cho giao dịch phân tán.
- **API bên ngoài (JWT xác thực role DRIVER):**
  - `GET /drivers/me`: Tự động khởi tạo profile tài xế idempotent từ JWT userId.
  - `PUT /drivers/me/status`: Chuyển đổi an toàn `AVAILABLE <-> OFFLINE`. Từ chối `409 INVALID_STATE_TRANSITION` nếu đang ở `RESERVED` hoặc `ON_TRIP`.
  - `PUT /drivers/me/location`: Heartbeat GPS mỗi 5s, cập nhật tọa độ và `last_seen_at` mà không làm thay đổi trạng thái cuốc xe.
- **API nội bộ (Internal Token):**
  - `GET /internal/drivers/available`: Tìm tài xế AVAILABLE còn heartbeat trong 60s, tính khoảng cách Euclid và sắp xếp gần nhất.
  - `POST /internal/drivers/:id/reserve`: **Atomic conditional update** `WHERE id = $id AND status = 'AVAILABLE'`. Đảm bảo bất biến I01: tối đa 1 reservation hợp lệ tại một thời điểm. Xử lý idempotent nếu cùng reservation, trả `409 DRIVER_NOT_AVAILABLE` nếu có xung đột.
  - `POST /internal/drivers/:id/confirm`: Chuyển sang `ON_TRIP` có **fencing token** (`reservationVersion`, `reservationId`, `reserved_until > now()`).
  - `POST /internal/drivers/:id/release`: Giải phóng tài xế về `AVAILABLE`, phát hiện và trả về `STALE_RELEASE` nếu tài xế đã được cấp reservation mới hơn, ghi outbox `driver.released`.
  - `GET /internal/drivers/:id/reservation/:reservationId`: Hỗ trợ reconciliation.
- **Background Jobs:**
  - Reservation TTL Job (quét mỗi 2s): Thu hồi các reservation quá hạn (`reserved_until < now()`), đưa về `AVAILABLE`, phát event `driver.reservation_expired` qua outbox.
  - Heartbeat Offline Job (quét mỗi 10s): Đưa các tài xế `AVAILABLE` không có heartbeat quá 30s về `OFFLINE` (không chạm vào tài xế đang `RESERVED` hoặc `ON_TRIP`).
- **Consumers:**
  - Nhận `driver.release` từ `driver.commands` -> Giải phóng và trả reply `driver.released`.
  - Nhận `trip.completed`, `trip.cancelled` từ `driver.trip-events` -> Giải phóng tài xế.

---

### 1.3 Dịch vụ Ghép xe (`matching-service` - 2 instances, Port 8084)
- **Kiến trúc:** Competing consumers trên queue `matching.commands` dùng chung DB `matching-db`.
- **Cơ sở dữ liệu:**
  - Bảng `match_attempts` với khóa chính `(trip_id, attempt)`, các trạng thái: `PENDING`, `RUNNING`, `RESERVING`, `RESERVED`, `CANCEL_REQUESTED`, `CANCELLED`, `FAILED`.
  - Cột lease: `claim_token`, `claimed_until`, `claimed_by`.
- **Luồng `matching.find_driver`:**
  - Kiểm tra tombstone: Nếu đã có tombstone `CANCEL_REQUESTED`, hủy ngay lập tức và reply `matching.attempt_cancelled`.
  - Tranh chấp xử lý (lease claim CAS): Dùng `claim_token` để đảm bảo chỉ 1 instance xử lý attempt tại một thời điểm.
  - Lấy danh sách tài xế từ `driver-service`, lọc `excluded_drivers`, thử từng ứng viên.
  - **Lưu ý quy chuẩn:** Lưu `candidate_driver_id` và `reservation_id` vào DB **trước khi** gọi REST sang `driver-service`.
  - Nếu reserve thành công -> Ghi nhận `RESERVED` và phát `matching.driver_reserved` qua outbox đến `trip.replies`.
  - Nếu gặp xung đột (409) -> Thử ứng viên tiếp theo hoặc báo `matching.no_driver`.
- **Luồng `matching.cancel_attempt`:**
  - Nếu attempt chưa có: Tạo tombstone `CANCEL_REQUESTED` để chặn `find_driver` đến sau.
  - Nếu đang giữ reservation: Gọi REST giải phóng tài xế tại `driver-service` trước khi xác nhận `matching.attempt_cancelled`.
- **Lease Recovery Job (quét mỗi 5s):**
  - Phục hồi các attempt bị treo do instance crash (`claimed_until < now()`).

---

## 2. Kiểm thử và Bằng chứng bàn giao

1. **Unit tests (`tests/driver.test.ts`, `tests/matching.test.ts`):**
   - 14 test cases kiểm tra độc lập toàn bộ các API, bảo mật role, atomic reserve, idempotency, fencing check, TTL, stale release. Chạy `npm test` pass 100%.
2. **Kịch bản Concurrency C01 (`tests/concurrency/c01.ts`):**
   - 2 Passengers đặt cùng lúc 1 Driver.
   - Kiểm chứng đúng 1 chuyến thắng, chuyến còn lại fail/cancel sạch sẽ; driver không bị gán kép.
   - Sẵn sàng cho `npm run demo -- 6` của TV1.
3. **Kịch bản Concurrency C02 (`tests/concurrency/c02.ts`):**
   - Tải tương tranh nhiều yêu cầu lên nhóm tài xế.
4. **Simulator (`scripts/simulator.ts`):**
   - Mô phỏng N tài xế tự động online, gửi heartbeat GPS và duy trì trạng thái phục vụ demo và load testing.
5. **Benchmark k6 (`scripts/load/p01_benchmark.js`):**
   - Kịch bản k6 kiểm tra hiệu năng P01 cho các mức 10/50/100 VU.

