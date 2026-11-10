# Bàn giao thành viên 1

Mục tiêu: ít lớp, đọc theo thứ tự `main.ts → app.ts → migration.sql`; consumer riêng chỉ khi có MQ.

Đã viết: cấu trúc workspace theo service, Identity/Gateway/Notification, UI tối thiểu, Compose 6 DB riêng, 2 Matching skeleton, start/seed/reset/kill/logs, smoke và kịch bản E01–E03.

Chưa được coi là hoàn thành toàn hệ thống: nghiệp vụ TV2/TV3, publish event thật, tích hợp Saga, concurrency, recovery, benchmark và báo cáo PDF có bằng chứng. E03 hiện là script hỗ trợ quan sát, chưa tự động điều khiển crash/restart. Không suy ra PASS từ source code hoặc healthcheck.

Các phần báo cáo TV1 cần tổng hợp sau khi có kết quả thật: 1–3, 12, 13 (Platform/Identity/UI/Notification), 18–19 theo mục 11 plan. Tham chiếu plan_DS03_v5.md cho ma trận phân công đầy đủ.
