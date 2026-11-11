# Hợp đồng bàn giao TV1

JWT: HS256, issuer `ds03`, audience `ride`, thời hạn 15 phút, claims `{ userId: UUID, role: PASSENGER | DRIVER | ADMIN }`. Tất cả service verify JWT và ownership; không tin các header `x-user-*`.

HTTP: lỗi `{code,message,correlationId}`; truyền `X-Correlation-ID` UUID. API ngoài theo mục 6.1 plan. Chặn internal ở Gateway. Bảng dưới là contract mà UI/E2E TV1 sử dụng để TV2/TV3 triển khai; nếu cần đổi, cập nhật producer và consumer cùng PR. TV1 không triển khai nghiệp vụ các API này.

| API | Payload / response |
|---|---|
| POST /trips | `{pickup:{lat,lng},dropoff:{lat,lng}}`, header Idempotency-Key |
| Trip response | `{id,status,correlationId,quotedFare,paymentStatus?}`; quotedFare integer VND |
| GET /trips/me/active | `{trip: object hoặc null}` |
| GET /trips/offers | `{items: [...]}` |
| GET /drivers/me | `{id,status,currentTripId}`; currentTripId null nếu không có chuyến |
| PUT /drivers/me/location | `{lat,lng}` |
| PUT /drivers/me/status | request `{status:"AVAILABLE" hoặc "OFFLINE"}`; response profile như GET /drivers/me |
| GET /payments/{tripId} | `{tripId,status,amount}`; status AUTHORIZED/VOIDED/CAPTURED; amount integer VND |
| GET /notifications/me | `{items:[{id,type,tripId,eventId,aggregateVersion,correlationId,createdAt}]}` |

Notification nhận envelope mục 5.2 plan, `schemaVersion:1`; các trường `causationId` (UUID hoặc null), `matchAttempt` và `aggregateVersion` bắt buộc. Payload `{tripId,passengerId,driverId?}`; aggregateId bằng tripId. `driverId` có thể null. Mỗi recipient nhận một thông báo; event đến trùng không tạo thêm. Version cũ vẫn là lịch sử, không dùng notification để cập nhật state Trip.

Notification API trả tối đa 200 thông báo mới nhất, sắp xếp createdAt giảm dần; since lọc theo thời điểm nhận/lưu, không theo occurredAt. Đây là danh sách gần đây cho demo, không phải API xuất toàn bộ lịch sử.

Driver: PUT location phải cập nhật last_seen_at ở mọi trạng thái mà không làm đổi status/reservation/currentTripId; UI/E2E gọi mỗi 5 giây khi online. Status AVAILABLE chỉ gửi khi chủ động online; Driver từ RESERVED/ON_TRIP không được tự chuyển AVAILABLE qua API status. TV3 đảm bảo các ràng buộc này. Profile được tạo idempotent từ userId JWT khi Driver gọi API của mình; không cần Identity ghi chéo DB.

Trip: GET active trả đúng `{trip:null}` khi không có. Các action accept/reject/start/complete/cancel nhận `{}` và service tự lấy chủ thể từ JWT. UI poll GET /trips/{id}, kể cả khi offer đã biến mất. Sau complete, trả `COMPLETED` với `paymentStatus:CAPTURE_PENDING` đến khi capture xong; GET payment của chuyến hủy đã cleanup trả VOIDED. TV2 giữ correlationId của Trip từ request booking để dùng trong mọi event.

Gateway không retry POST; timeout upstream 2 giây. Client retry booking giữ nguyên Idempotency-Key/body; UI thay key khi sửa điểm đón/đến hoặc đặt thành công. Rate limit theo IP và nhóm route: auth 10/phút, POST trips 30/phút, API khác 120/phút. Verify ownership vẫn là trách nhiệm service, Gateway không thay thế phần này.

Consumer TV1 hiện tự tạo topology **chỉ cho notification.events**, gồm retry 1s/5s/15s và DLQ. TV3 cần dùng chính xác các tên/arguments này hoặc đổi đồng bộ adapter khi tích hợp common/messaging. Publish confirm trước ACK khi chuyển retry/DLQ; DB commit trước ACK khi xử lý thành công.

TV3 bàn giao test concurrency có CLI `node --import tsx tests/concurrency/c01.ts`: exit 0 chỉ khi invariant đúng, exit khác 0 nếu fail; lưu artifacts riêng. Demo runner TV1 chỉ gọi entrypoint này. TV2 bàn giao truy vấn/script evidence để kiểm tra capture không lặp và compensation đúng; E2E TV1 kiểm tra API, không trực tiếp đọc DB nghiệp vụ của TV2/TV3.

Nguồn kỹ thuật: [Fastify hooks](https://fastify.dev/docs/latest/Reference/Hooks/), [RabbitMQ acknowledgements và confirms](https://www.rabbitmq.com/docs/confirms).
