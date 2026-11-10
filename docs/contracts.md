# Hợp đồng bàn giao TV1

JWT: HS256, issuer `ds03`, audience `ride`, thời hạn 15 phút, claims `{ userId: UUID, role: PASSENGER | DRIVER | ADMIN }`. Tất cả service verify JWT và ownership; không tin các header `x-user-*`.

HTTP: lỗi `{code,message,correlationId}`; truyền `X-Correlation-ID`. API ngoài theo mục 6.1 plan. Chặn internal ở Gateway. Các payload Trip/Driver dưới đây là đề xuất để TV2/TV3 thống nhất trước tích hợp:

| API | Payload / response |
|---|---|
| POST /trips | `{pickup:{lat,lng},dropoff:{lat,lng}}`, header Idempotency-Key |
| Trip response | `{id,status,correlationId,...}` |
| GET /trips/me/active | `{trip: object hoặc null}` |
| GET /trips/offers | `{items: [...]}` |
| PUT /drivers/me/location | `{lat,lng}` |
| PUT /drivers/me/status | `{status:"AVAILABLE" hoặc "OFFLINE"}` |
| GET /notifications/me | `{items:[{id,type,tripId,eventId,aggregateVersion,correlationId,createdAt}]}` |

Notification nhận envelope mục 5.2 plan, `schemaVersion:1`; các trường `causationId` (UUID hoặc null), `matchAttempt` và `aggregateVersion` bắt buộc. Payload `{tripId,passengerId,driverId?}`; aggregateId bằng tripId. `driverId` có thể null. Mỗi recipient nhận một thông báo; event đến trùng không tạo thêm. Version cũ vẫn là lịch sử, không dùng notification để cập nhật state Trip.

Consumer TV1 hiện tự tạo topology **chỉ cho notification.events**, gồm retry 1s/5s/15s và DLQ. TV3 cần dùng chính xác các tên/arguments này hoặc đổi đồng bộ adapter khi tích hợp common/messaging. Publish confirm trước ACK khi chuyển retry/DLQ; DB commit trước ACK khi xử lý thành công.

Nguồn kỹ thuật: [Fastify hooks](https://fastify.dev/docs/latest/Reference/Hooks/), [RabbitMQ acknowledgements và confirms](https://www.rabbitmq.com/docs/confirms).
