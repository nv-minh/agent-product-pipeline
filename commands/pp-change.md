---
description: Bắt đầu một CHANGE REQUEST trên hành vi đã có (feature đã ship hoặc code brownfield) — tìm feature gốc, init pipeline change + nạp nguồn + nháp brief, rồi DỪNG chờ người duyệt brief
---

Nhiệm vụ: biến $ARGUMENTS thành một feature change sẵn sàng chạy `/pp` — nhưng
**dừng trước cửa impact analysis**. Pipeline change KHÁC pipeline feature:
mở đầu bằng `05-impact` (hiện trạng + thành phần bị ảnh hưởng), rồi `10-prd`
dạng DELTA (đánh dấu ADDED/MODIFIED/REMOVED, có human gate), rồi `40-testplan`.
Đổi ý GIỮA CHỪNG một feature đang chạy thì KHÔNG dùng lệnh này — sửa thẳng
artifact và để cơ chế stale re-gate (spec nền §9.3). Làm đúng thứ tự sau:

1. **Đọc $ARGUMENTS, nhận diện nguồn.** Đúng luật /pp-new: link
   `*.atlassian.net`, URL công khai, file (`.xlsx`, `.csv`, `.md`, `.txt`),
   hoặc text dán thẳng.

2. **Tìm feature gốc.** Quét tên thư mục trong `features/` và
   `features/_archive/`, và grep nội dung brief/PRD của chúng theo từ khóa
   trong nguồn. Kết quả:
   - Có ứng viên → **hỏi người dùng xác nhận** đúng feature đó rồi dùng
     `--from` ở bước 4. Không bao giờ tự đoán im lặng.
   - Không có → nói rõ với người dùng: "không tìm thấy artifact cũ — stage
     05-impact sẽ đọc code hiện trạng trong workspace thay" (dự án brownfield,
     đây là đường bình thường, không phải lỗi).

3. **Chốt tên feature mới.** Khớp `^[a-z0-9][a-z0-9-]*$` (xem
   `lib/commands/precond.js`); tên mô tả THAY ĐỔI, không trùng tên feature gốc.
   Hỏi người dùng xác nhận.

4. Chạy `pp init <feature> --type change --from <feature-gốc>` (bỏ `--from`
   nếu bước 2 không tìm thấy). `--from` nhận TÊN feature, không nhận đường dẫn
   — init tự tìm ở cả `features/` và `features/_archive/`. Lệnh nối ĐÚNG BA
   artifact cũ vào inputs của 05-impact: `00-brief.md`, `10-prd.md`,
   `40-testplan.md`. Feature gốc là một bugfix hoặc change trước đó thì
   `05-diagnosis.md` / `15-fixplan.md` / `05-impact.md` của nó KHÔNG được nối —
   cần thì chép tay phần liên quan vào `features/<feature>/refs/source.md` ở
   bước 5. Feature gốc KHÔNG bị ghi gì — nó là lịch sử đóng băng.

5. **Nạp nguồn vào `features/<feature>/refs/source.md`** — ĐÚNG TÊN FILE NÀY.
   `pipeline.json` khai input `refs/source.md?` (xem
   `templates/pipeline.change.json`), nên stage `05-impact` chỉ được lệnh đọc
   đúng file đó; tên khác thì nguồn không tới tay nó và sửa nguồn cũng không
   làm stage hoá stale. Nhiều nguồn thì gộp, mỗi nguồn một mục
   `## <tên nguồn>` với dòng đầu ghi lấy từ đâu và lúc nào (luật /pp-new).

6. **Nháp `00-brief.md`** dạng DELTA trên hành vi ĐÃ CÓ, chỉ từ `refs/`:
   hôm nay hệ thống làm gì (hành vi nào, ở đâu) → sau thay đổi này khác đi ở
   đâu → vì sao cần. Có feature gốc thì nêu tên trong brief. Nguồn mâu thuẫn
   hay thiếu thì ghi câu hỏi vào cuối brief.

7. **DỪNG LẠI Ở ĐÂY.** In nguyên văn brief, nói rõ: đọc và sửa
   `features/<feature>/00-brief.md`, xong chạy `/pp <feature>`. Tuyệt đối
   không tự chạy `/pp`, không viết `05-impact.md`, không chạy `pp gate`.

Không bao giờ tự ghi `STATE.md`, `.evidence/`, `pipeline.json` — chỉ `pp` ghi.
`refs/` và `00-brief.md` là hai chỗ duy nhất lệnh này được ghi.
