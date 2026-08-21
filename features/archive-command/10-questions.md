# Câu hỏi — archive-command

Q1: `pp archive` được phép chạy trên feature còn stage chưa `done` không?
A: Không. Archive một feature đang dở là làm mất dấu vết công việc chưa xong.
Phải từ chối, exit 1, và nói rõ stage nào chưa xong. Muốn archive vẫn thì dùng
`pp override` cho stage đó trước — cửa thoát hiểm đã có ghi sổ, không cần cửa
thứ hai.

Q2: Feature đã archive rồi mà archive lại thì sao?
A: Đích `features/_archive/<feature>/` đã tồn tại thì từ chối, exit 1, không ghi
đè. Ghi đè là xoá vĩnh viễn audit.jsonl và .review/ của bản cũ.

Q3: Mục CHANGELOG chèn ở đâu, theo thứ tự nào?
A: Ngay dưới dòng mốc `<!-- pp archive chèn mục mới ngay dưới dòng này -->` đã
có trong `CHANGELOG.md`. Chèn ngay dưới mốc nghĩa là mục mới nhất luôn ở trên,
không cần đọc ngày của các mục cũ.

Q4: Mục CHANGELOG gồm những gì?
A: Tên feature, ngày archive (YYYY-MM-DD), danh sách stage kèm status cuối, số
lần override nếu > 0, và tổng token nếu `.usage/entries.jsonl` có dữ liệu. Toàn
bộ đọc từ STATE.md và audit.jsonl — không có trường nào do người gõ tay.

Q5: Không có dòng mốc trong CHANGELOG.md thì sao?
A: Từ chối, exit 1, nói rõ thiếu dòng mốc. Không tự đoán chỗ chèn, và không
append vào cuối file — chèn sai chỗ trong một file người đọc là sửa tay tài liệu
của họ.

Q6: Có di chuyển file bằng `git mv` không?
A: Không. `pp` không bao giờ gọi `git` (spec §8). Dùng `renameSync`; nếu đích ở
volume khác thì fallback copy-rồi-xoá.

Q7: Có xoá `.evidence/`, `audit.jsonl`, `.review/`, `.usage/` khi archive không?
A: Không. Chúng là sổ sách của feature, di chuyển nguyên vẹn cùng thư mục. Mục
đích của archive là dọn `features/` cho gọn, không phải xoá bằng chứng.

Q8: `pp report` và `pp status` có còn thấy feature đã archive không?
A: Không thấy trong danh sách feature sống — `lib/commands/report.js` đã bỏ qua
`_archive`, và `lib/commands/guard.js` cũng vậy, nên không cần sửa hai file đó.

Q9: Ai được chạy `pp archive` — người hay agent?
A: Người. Nó là quyết định "feature này xong rồi", cùng loại với `pp approve`.
Ghi audit với `actor: 'human'` theo đúng quy ước lớp lệnh đang dùng ở
`lib/commands/human.js`, kèm ghi chú rằng `pp` không xác minh được danh tính.

Q10: Tên feature có cần validate không?
A: Có, cùng allowlist với mọi lệnh khác. `pp archive ../../x` không được phép
di chuyển thư mục ngoài `features/`.
