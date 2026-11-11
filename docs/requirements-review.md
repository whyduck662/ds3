# Đối chiếu General Requirements và DS03

Nguồn: `General_Requirements_and_DS03_English.md`, các mục 4, 7, 9–13.
Đây là ghi nhận trước khi hoàn thiện TV1. Hiện trạng bàn giao mới nhất và các phần đã sửa nằm ở `member-1.md`, `testing.md`. Phần TV2/TV3 vẫn chưa được triển khai; không dùng bảng lịch sử dưới đây để suy ra PASS toàn hệ thống.

## Kết luận

Kiến trúc dự kiến đủ chỗ cho các chức năng bắt buộc. Code hiện tại chưa đáp ứng đầy đủ: Driver, Matching, Trip và Payment mới có healthcheck, API nghiệp vụ trả 501. Gateway không được tính vào tối thiểu 4 business services; thư mục và container skeleton chưa chứng minh service nghiệp vụ hoạt động.

## DS03 §7.3

| Yêu cầu | Hiện trạng | Việc còn lại |
|---|---|---|
| Đăng ký/login/role | Có code Identity, bcrypt/JWT | Integration với PostgreSQL, test login thành công/thất bại và token hết hạn |
| Driver status/location | Chỉ UI, route và skeleton | Driver schema, API, ownership, online/offline |
| Tạo ride request | Chỉ UI/script, Trip trả 501 | Booking API, lưu trip, idempotency |
| Chọn tài xế phù hợp | Matching trả 501 | Đọc candidate qua API, chọn và reserve |
| Accept/reject | UI có nút, backend chưa có | API và kiểm tra driver được gán |
| Không gán driver cho 2 trip | Chưa có cơ chế | Atomic reserve và test hai hành khách tranh cùng tài xế |
| Trip lifecycle | Chưa triển khai | Transition hợp lệ, start/complete/cancel, kiểm tra chủ thể |
| Fare/payment | Payment trả 501, chưa pricing | Giá cước đơn giản, thanh toán giả lập idempotent |
| Thông báo hai vai trò | Có consumer, inbox, DB/API | Producer event thật và integration cho passenger/driver |

REST đã có code Gateway → Identity/Notification. MQ chỉ có Notification consumer, chưa có business producer. Event IDs, retry, dedup, DLQ mới nằm ở Notification. Correlation ID có ở HTTP và envelope, chưa được kiểm chứng toàn luồng. Saga/compensation chưa có.

## General Requirements §4

- §4.1: Compose cấu hình process riêng, network, DB riêng; có service/instance ID và JSON logs. Chưa chạy xác minh triển khai và concurrency. Không thấy code truy cập chéo DB.
- §4.2: Có Docker DNS, JWT/envelope contract, healthcheck, Notification ACK/retry. Chưa có state nghiệp vụ phân tán, phát hiện Driver offline, xử lý event sai thứ tự của Trip/Payment và phân tích hiệu năng bằng số liệu.
- §4.3: Chưa có concurrency-control nghiệp vụ hoặc test chứng minh invariant.
- §4.4: Có kill/restart script và Notification reconnect/retry. Chưa chứng minh 2 failure/recovery scenarios; E03 không điều khiển hoặc xác nhận crash nên không đủ làm bằng chứng.
- §4.5: Có JWT/RBAC, hash mật khẩu, Zod, giới hạn HTTP/message, env secrets và redaction. Ownership tại Driver/Trip/Payment còn thiếu vì chưa có nghiệp vụ. Chưa kiểm thử bảo mật tích hợp đầy đủ.

## Phần TV1 cần hoàn thiện

1. Integration Identity/Notification với PostgreSQL và RabbitMQ thật, gồm event trùng, DB lỗi, retry và DLQ. Unit test hiện dùng DB giả, không chứng minh transaction/dedup trên DB thật.
2. UI Driver cần cơ chế heartbeat theo contract TV3. Hiện UI chỉ gửi status/location khi bấm nút; nếu áp timeout 30 giây của plan thì Driver có thể bị offline khi đang chờ chuyến.
3. UI Driver đang poll offers, chưa poll chuyến đã nhận. Cần cập nhật active trip sau khi offer biến mất và trạng thái thay đổi.
4. UI chưa hiển thị giá cước/kết quả thanh toán; cần bổ sung để quan sát luồng cơ bản khi backend sẵn sàng.
5. E2E heartbeat hiện gửi status AVAILABLE mỗi 5 giây. Cần tách heartbeat khỏi thay đổi availability để tránh yêu cầu đưa Driver RESERVED/ON_TRIP trở lại AVAILABLE.
6. E03 cần điều khiển hoặc có điểm dừng rõ ràng để kill/restart Payment, xác nhận đã có pending work và chỉ một payment sau recovery. Hiện in hướng dẫn rồi complete ngay; cùng script có thể PASS khi không có failure.
7. Chốt response hợp đồng: active trip dùng `{trip:null}` chưa được UI xử lý rõ (toán tử `??` giữ lại wrapper). Cần thống nhất với TV2 trước integration.
8. Bổ sung test ownership, token hết hạn, giới hạn kích thước và rate limit; E01–E03 cần bằng chứng kết quả thật. Script cancel chỉ kiểm tra CANCELLED và notification, chưa kiểm tra driver/payment cleanup.

## Demo, test, giao nộp

- §7.4: Có cấu hình/script hỗ trợ start/kill/restart. Chưa chứng minh đủ 9 demo; chưa có script concurrency hai passenger.
- §9: Chạy lại 4 unit tests đều PASS; typecheck PASS. Chưa có bằng chứng đủ 8 functional, 2 concurrency, 2 fault/recovery, 2 security/invalid và 1 performance experiment. Nhiều assertion trong một test không thay thế bộ kịch bản có kết quả đầy đủ.
- §10–13: Có thư mục bắt buộc và README/env sample. Chưa có report.pdf, evidence đầy đủ hoặc xác minh redeploy máy sạch. Đóng góp từng thành viên, final tag và quyền giảng viên cần kiểm tra khi giao nộp.

## Thứ tự hoàn thiện đơn giản

1. TV3: Driver status/location + atomic reserve; Matching chọn candidate, retry qua MQ.
2. TV2: Trip booking/lifecycle + pricing đơn giản + simulated payment.
3. TV2/TV3: Saga hoặc compensation thật, idempotency, retry/dedup/DLQ cho luồng nghiệp vụ.
4. TV1: nối UI/Notification, sửa heartbeat và automation, kiểm thử integration.
5. Cả nhóm: concurrency, ít nhất 2 failure/recovery, performance, đủ 9 demo và report.

Các mục §7.5 như outbox, nhiều Matching instance, tracing và giao diện dashboard là nâng cao. Có thể giữ thiết kế hiện tại, nhưng ưu tiên luồng cơ bản và cơ chế bắt buộc trước khi mở rộng. Đề không bắt buộc đủ 6 business services hoặc thuật toán matching địa lý phức tạp; vẫn phải thực hiện mọi chức năng §7.3 dù chọn cách gộp service khác.
