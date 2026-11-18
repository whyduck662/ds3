# Tổng hợp các lần kiểm tra

Các lần kiểm tra được đánh số theo thứ tự thực hiện, không hiển thị ngày giờ. PASS: đã đạt; FAIL: đã phát hiện lỗi; BLOCKED: chưa thực hiện hoặc chưa đủ điều kiện kiểm chứng.

Mỗi lần chỉ xác nhận phạm vi đã chạy. Kết quả cũ không thay thế việc chạy lại sau khi sửa mã. Log, JSON và ảnh gốc được giữ trong `docs/evidence/` để đối chiếu.

## Lần kiểm tra 1

Kiểm tra giao diện TV1 ban đầu bằng Microsoft Edge headless.

| Hạng mục | Kết quả |
|---|---|
| Đăng ký Passenger trên UI | PASS |
| Sai mật khẩu: hiển thị lỗi, vẫn ở màn hình login | PASS |
| Login Passenger, chọn địa điểm Hà Nội và phân quyền UI | PASS |
| Phân quyền Gateway khi gọi từ trình duyệt | PASS |
| Thông báo qua MQ thật và chống trùng hiển thị UI | PASS |
| Upstream chưa chạy: UI hiện lỗi và còn thao tác được | PASS |
| Phiên hết hạn: logout và yêu cầu đăng nhập lại | PASS |
| Đăng ký/login Driver và phân quyền UI | PASS |
| Không có lỗi JavaScript chưa xử lý | PASS |

Phạm vi: giao diện và fixture TV1; chưa xác nhận toàn bộ nghiệp vụ tích hợp.

## Lần kiểm tra 2

Chế độ: local. Kết quả tổng: **BLOCKED**.

| Hạng mục | Kết quả |
|---|---|
| TYPECHECK | PASS. exit=0; PASS |
| BUILD | PASS. exit=0; PASS |
| UNIT | PASS. exit=0; PASS |
| DOCKER | BLOCKED. exit=1; BLOCKED |
| INTEGRATION-TV1 | BLOCKED. Docker Engine unavailable |
| SMOKE | BLOCKED. Docker Engine unavailable |
| E01 | BLOCKED. Docker Engine unavailable |
| E02 | BLOCKED. Docker Engine unavailable |
| E03 | BLOCKED. Docker Engine unavailable |
| UI-BUSINESS | BLOCKED. Docker Engine unavailable |
| REDEPLOY | BLOCKED. Docker Engine unavailable |

## Lần kiểm tra 3

Chế độ: local. Kết quả tổng: **BLOCKED**.

| Hạng mục | Kết quả |
|---|---|
| TYPECHECK | PASS. exit=0; PASS |
| BUILD | PASS. exit=0; PASS |
| UNIT | PASS; 37/37 tests PASS. exit=0; PASS |
| DOCKER | BLOCKED. exit=1; BLOCKED |
| INTEGRATION-TV1 | BLOCKED. Docker Engine unavailable |
| SMOKE | BLOCKED. Docker Engine unavailable |
| E01 | BLOCKED. Docker Engine unavailable |
| E02 | BLOCKED. Docker Engine unavailable |
| E03 | BLOCKED. Docker Engine unavailable |
| UI-BUSINESS | BLOCKED. Docker Engine unavailable |
| REDEPLOY | BLOCKED. Docker Engine unavailable |

## Lần kiểm tra 4

Chế độ: full. Kết quả tổng: **BLOCKED**.

| Hạng mục | Kết quả |
|---|---|
| TYPECHECK | PASS. exit=0; PASS |
| BUILD | PASS. exit=0; PASS |
| UNIT | PASS; 37/37 tests PASS. exit=0; PASS |
| DOCKER | BLOCKED. exit=1; BLOCKED |
| INTEGRATION-TV1 | BLOCKED. Docker Engine unavailable |
| SMOKE | BLOCKED. Docker Engine unavailable |
| E01 | BLOCKED. Docker Engine unavailable |
| E02 | BLOCKED. Docker Engine unavailable |
| E03 | BLOCKED. Docker Engine unavailable |
| UI-BUSINESS | BLOCKED. Docker Engine unavailable |
| REDEPLOY | BLOCKED. Docker Engine unavailable |

## Lần kiểm tra 5

Chế độ: full. Kết quả tổng: **FAIL**.

| Hạng mục | Kết quả |
|---|---|
| TYPECHECK | PASS. exit=0; PASS |
| BUILD | PASS. exit=0; PASS |
| UNIT | PASS; 37/37 tests PASS. exit=0; PASS |
| DOCKER | PASS. exit=0; PASS |
| TEST-INFRA | PASS. exit=0; PASS |
| INTEGRATION-TV1 | FAIL; 0/8 tests PASS. exit=1; FAIL |
| STARTUP | FAIL. exit=1; FAIL |
| SMOKE | BLOCKED. Requires browser business-flow verification, clean-machine verification, or preceding runtime check to pass |
| E01 | BLOCKED. Requires browser business-flow verification, clean-machine verification, or preceding runtime check to pass |
| E02 | BLOCKED. Requires browser business-flow verification, clean-machine verification, or preceding runtime check to pass |
| E03 | BLOCKED. Requires browser business-flow verification, clean-machine verification, or preceding runtime check to pass |
| UI-BUSINESS | BLOCKED. Requires browser business-flow verification, clean-machine verification, or preceding runtime check to pass |
| REDEPLOY | BLOCKED. Requires browser business-flow verification, clean-machine verification, or preceding runtime check to pass |

## Lần kiểm tra 6

Chế độ: full. Kết quả tổng: **FAIL**.

| Hạng mục | Kết quả |
|---|---|
| TYPECHECK | PASS. exit=0; PASS |
| BUILD | PASS. exit=0; PASS |
| UNIT | PASS; 39/39 tests PASS. exit=0; PASS |
| DOCKER | PASS. exit=0; PASS |
| TEST-INFRA | PASS. exit=0; PASS |
| INTEGRATION-TV1 | PASS; 8/8 tests PASS. exit=0; PASS |
| UI-TV1 | PASS; 9/9 checks PASS. exit=0; PASS |
| STARTUP | FAIL. exit=1; FAIL |
| SMOKE | BLOCKED. Requires browser business-flow verification, clean-machine verification, or preceding runtime check to pass |
| E01 | BLOCKED. Requires browser business-flow verification, clean-machine verification, or preceding runtime check to pass |
| E02 | BLOCKED. Requires browser business-flow verification, clean-machine verification, or preceding runtime check to pass |
| E03 | BLOCKED. Requires browser business-flow verification, clean-machine verification, or preceding runtime check to pass |
| UI-BUSINESS | BLOCKED. Requires browser business-flow verification, clean-machine verification, or preceding runtime check to pass |
| REDEPLOY | BLOCKED. Requires browser business-flow verification, clean-machine verification, or preceding runtime check to pass |

## Lần kiểm tra 7

Chế độ: deployment-only. Kết quả tổng: **FAIL**.

| Hạng mục | Kết quả |
|---|---|
| DOCKER | PASS. exit=0; PASS |
| STARTUP | PASS. exit=0; PASS |
| SMOKE | PASS. exit=0; PASS |
| E01 | FAIL. exit=1; FAIL |
| E02 | BLOCKED. Requires browser business-flow verification, clean-machine verification, or preceding runtime check to pass |
| E03 | BLOCKED. Requires browser business-flow verification, clean-machine verification, or preceding runtime check to pass |
| UI-BUSINESS | BLOCKED. Requires browser business-flow verification, clean-machine verification, or preceding runtime check to pass |
| REDEPLOY | BLOCKED. Requires browser business-flow verification, clean-machine verification, or preceding runtime check to pass |

## Lần kiểm tra 8

Chế độ: deployment-only. Kết quả tổng: **FAIL**.

| Hạng mục | Kết quả |
|---|---|
| DOCKER | PASS. exit=0; PASS |
| STARTUP | PASS. exit=0; PASS |
| SMOKE | PASS. exit=0; PASS |
| E01 | PASS. exit=0; PASS |
| E02 | PASS. exit=0; PASS |
| E03 | PASS. exit=0; PASS |
| UI-BUSINESS | FAIL. exit=1; FAIL |
| REDEPLOY | BLOCKED. Requires browser business-flow verification, clean-machine verification, or preceding runtime check to pass |

## Lần kiểm tra 9

Chế độ: full. Kết quả tổng: **BLOCKED**.

| Hạng mục | Kết quả |
|---|---|
| TYPECHECK | PASS. exit=0; PASS |
| BUILD | PASS. exit=0; PASS |
| UNIT | PASS; 43/43 tests PASS. exit=0; PASS |
| DOCKER | PASS. exit=0; PASS |
| TEST-INFRA | PASS. exit=0; PASS |
| INTEGRATION-TV1 | PASS; 8/8 tests PASS. exit=0; PASS |
| UI-TV1 | PASS; 9/9 checks PASS. exit=0; PASS |
| STARTUP | PASS. exit=0; PASS |
| SMOKE | PASS. exit=0; PASS |
| E01 | PASS. exit=0; PASS |
| E02 | PASS. exit=0; PASS |
| E03 | PASS. exit=0; PASS |
| UI-BUSINESS | PASS. exit=0; PASS |
| REDEPLOY | BLOCKED. Requires browser business-flow verification, clean-machine verification, or preceding runtime check to pass |

## Lần kiểm tra 10

Chế độ: full. Kết quả tổng: **BLOCKED**.

| Hạng mục | Kết quả |
|---|---|
| TYPECHECK | PASS. exit=0; PASS |
| BUILD | PASS. exit=0; PASS |
| UNIT | PASS; 44/44 tests PASS. exit=0; PASS |
| DOCKER | PASS. exit=0; PASS |
| TEST-INFRA | PASS. exit=0; PASS |
| INTEGRATION-TV1 | PASS; 17/17 tests PASS. exit=0; PASS |
| UI-TV1 | PASS; 9/9 checks PASS. exit=0; PASS |
| STARTUP | PASS. exit=0; PASS |
| SMOKE | PASS. exit=0; PASS |
| E01 | PASS. exit=0; PASS |
| E02 | PASS. exit=0; PASS |
| E03 | PASS. exit=0; PASS |
| E04 | PASS. exit=0; PASS |
| UI-BUSINESS | PASS. exit=0; PASS |
| CONCURRENCY | PASS; C01: PASS; C02 PASS: 1 thành công, 9 HTTP 409/10 yêu cầu. exit=0; PASS |
| P01 | PASS. exit=0; PASS |
| REDEPLOY | BLOCKED. Requires browser business-flow verification, clean-machine verification, or preceding runtime check to pass |

## Lần kiểm tra 11

Tái hiện lỗi cạnh tranh giữa cập nhật trạng thái Driver và reserve.

| Hạng mục | Kết quả |
|---|---|
| Reserve A | HTTP 200 |
| Cập nhật status | HTTP 200 |
| Reserve B | HTTP 200 |
| Kết luận | FAIL: hai yêu cầu reserve có thể cùng thành công. |

## Lần kiểm tra 12

Kiểm chứng bản sửa tính nguyên tử của trạng thái Driver.

| Hạng mục | Kết quả |
|---|---|
| typecheck | PASS |
| unit | 44/44 PASS |
| integration | 21/21 PASS including four real-PostgreSQL interleaving regressions |
| buildDriver | PASS |
| driverDeployment | Updated and healthy |
| C01 | PASS |
| C02 | PASS |
| originalSchedule | {"reserveA":200,"statusUpdate":409,"reserveB":409} |
| code | src/services/driver-service/src/app.ts |

## Lần kiểm tra 13

Kiểm tra lại sau bản sửa Driver; không chạy lại E01–E04 và UI nghiệp vụ trong lần này.

| Hạng mục | Kết quả |
|---|---|
| typecheck | PASS |
| unit | 44/44 PASS |
| integration | 21/21 PASS, including four deterministic status/reserve/confirm races on PostgreSQL |
| smoke | PASS |
| C01 | PASS |
| C02 | PASS |
| deployment | All backend services healthy |
| reportValidation | DOCX XML/ZIP valid, six chapters, PDF 34 pages |

## Lần kiểm tra 14

Chế độ: full. Kết quả tổng: **BLOCKED**.

| Hạng mục | Kết quả |
|---|---|
| TYPECHECK | PASS. exit=0; PASS |
| BUILD | PASS. exit=0; PASS |
| UNIT | PASS; 44/44 tests PASS. exit=0; PASS |
| DOCKER | BLOCKED. exit=1; BLOCKED |
| INTEGRATION-TV1 | BLOCKED. Docker Engine unavailable |
| UI-TV1 | BLOCKED. Docker Engine unavailable |
| SMOKE | BLOCKED. Docker Engine unavailable |
| E01 | BLOCKED. Docker Engine unavailable |
| E02 | BLOCKED. Docker Engine unavailable |
| E03 | BLOCKED. Docker Engine unavailable |
| E04 | BLOCKED. Docker Engine unavailable |
| UI-BUSINESS | BLOCKED. Docker Engine unavailable |
| CONCURRENCY | BLOCKED. Docker Engine unavailable |
| P01 | BLOCKED. Docker Engine unavailable |
| REDEPLOY | BLOCKED. Docker Engine unavailable |

## Lần kiểm tra 15

Chế độ: full. Kết quả tổng: **BLOCKED**.

| Hạng mục | Kết quả |
|---|---|
| TYPECHECK | PASS. exit=0; PASS |
| BUILD | PASS. exit=0; PASS |
| UNIT | PASS; 44/44 tests PASS. exit=0; PASS |
| DOCKER | PASS. exit=0; PASS |
| TEST-INFRA | PASS. exit=0; PASS |
| INTEGRATION-TV1 | PASS; 21/21 tests PASS. exit=0; PASS |
| UI-TV1 | PASS; 9/9 checks PASS. exit=0; PASS |
| STARTUP | PASS. exit=0; PASS |
| SMOKE | PASS. exit=0; PASS |
| E01 | PASS. exit=0; PASS |
| E02 | PASS. exit=0; PASS |
| E03 | PASS. exit=0; PASS |
| E04 | PASS. exit=0; PASS |
| UI-BUSINESS | PASS. exit=0; PASS |
| CONCURRENCY | PASS; C01: PASS; C02 PASS: 1 thành công, 9 HTTP 409/10 yêu cầu. exit=0; PASS |
| P01 | PASS. exit=0; PASS |
| REDEPLOY | BLOCKED. Requires browser business-flow verification, clean-machine verification, or preceding runtime check to pass |

## Các phần chưa hoàn tất

- Chưa kiểm chứng triển khai trên máy sạch.
- Đối chiếu các hàng E01–E04 và UI-BUSINESS ở lần kiểm tra mới nhất; PASS của lần cũ không xác nhận lần mới.
- Thông tin hành chính của báo cáo để trống theo yêu cầu.
- Chưa xác nhận commit/push toàn bộ thay đổi, tag/release cuối và quyền truy cập của giảng viên.
