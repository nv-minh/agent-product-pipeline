# Brief — archive-command

Hôm nay `pp` có 14 lệnh và KHÔNG có `pp archive`. Nhưng ba nơi đã nói như thể
lệnh đó tồn tại: `CHANGELOG.md` ("Mỗi feature ship xong ghi một mục ~10 dòng khi
chạy `pp archive`"), `README.md` dòng 19 (`features/_archive/` — "Feature đã
ship"), và spec §4 stage map (stage `90-archive`, `enabled: true`). Kết quả:
`features/_archive/` rỗng vĩnh viễn, `CHANGELOG.md` không bao giờ có mục nào, và
`features/` chỉ phình ra — đúng triệu chứng spec §10.3 đặt ngưỡng khai tử cho
(">15 thư mục sống" với cách chữa là "`pp archive`", một lệnh không có thật).

Sau thay đổi này: `pp archive <feature>` chuyển `features/<feature>/` sang
`features/_archive/<feature>/`, chèn một mục vào `CHANGELOG.md` đúng chỗ dấu mốc
`<!-- pp archive chèn mục mới ngay dưới dòng này -->`, và từ chối archive một
feature chưa hoàn tất (còn stage chưa `done`) — vì archive một feature đang dở
là làm mất dấu vết công việc chưa xong.

Cần, vì tài liệu đang mô tả một năng lực không tồn tại: đó là chính lỗi
"hoàn thành là lời khai, không phải dữ kiện" mà `constitution.md` Điều 2 cấm,
chỉ là ở tầng tài liệu thay vì tầng gate.
