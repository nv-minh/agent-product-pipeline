---
description: Bắt đầu một BUGFIX từ bất kỳ nguồn nào (link Jira, URL, log lỗi, text) — init pipeline bugfix + nạp nguồn + nháp brief, rồi DỪNG chờ người duyệt brief
---

Nhiệm vụ: biến $ARGUMENTS thành một feature bugfix sẵn sàng chạy `/pp` — nhưng
**dừng trước cửa diagnosis**. Brief là tiếng nói của người: chữ ký
`pp approve <feature> 05-diagnosis` sau này đặt trên nền nó. Pipeline bugfix KHÁC pipeline
feature: không có PRD — thay bằng `05-diagnosis` (tái hiện + root cause, có
human gate) → `15-fixplan` → `40-regression`. Làm đúng thứ tự sau, không bỏ
bước, không chạy quá:

1. **Đọc $ARGUMENTS, nhận diện nguồn.** Như /pp-new: link `*.atlassian.net`
   (bug ticket Jira), URL công khai, file (`.xlsx`, `.csv`, `.md`, `.txt`),
   hoặc text dán thẳng. RIÊNG bugfix: **log lỗi / stack trace dán thẳng cũng là
   một nguồn hợp lệ** — chép NGUYÊN VĂN, đừng tóm tắt hay cắt dòng "không quan
   trọng"; chính dòng đó thường là root cause.

2. **Chốt tên feature.** Khớp `^[a-z0-9][a-z0-9-]*$` (luật của `pp` — xem
   `lib/commands/precond.js`). Gợi ý tiền tố `fix-` cho dễ nhận diện trong
   features/. Chưa có tên thì đề xuất rồi **hỏi người dùng xác nhận**.

3. Chạy `pp init <feature> --type bugfix`. In "đã tồn tại" (exit 1) thì dừng và
   hỏi người dùng.

4. **Nạp nguồn vào `features/<feature>/refs/source.md`** — ĐÚNG TÊN FILE NÀY.
   `pipeline.json` của bugfix khai input `refs/source.md?` (xem
   `templates/pipeline.bugfix.json`), nên stage `05-diagnosis` chỉ được lệnh
   đọc đúng file đó: một nguồn đặt tên khác — ví dụ refs/jira-abc.md — sẽ
   KHÔNG bao giờ tới tay diagnosis, và sửa nó cũng không làm stage hoá stale.
   Nhiều nguồn thì gộp vào một file đó, mỗi nguồn một mục `## <tên nguồn>`;
   dòng đầu mỗi mục ghi lấy từ đâu và lúc nào.
   Jira qua MCP Atlassian, Excel qua skill excel-to-md, còn lại chép nguyên văn.

5. **Nháp `00-brief.md`** theo đúng bốn mục mà scaffold đã dựng sẵn — chỉ từ
   nội dung trong `refs/`, không bịa:
   - Hiện tượng: hệ thống đang làm SAI gì (quan sát được, kèm log nếu có);
   - Mong đợi: đúng ra phải thế nào;
   - Unchanged behavior: hành vi phải GIỮ NGUYÊN sau fix. Chuỗi truy vết đi
     brief → `05-diagnosis.md` → `40-regression`: stage `40-regression` KHÔNG
     đọc `00-brief.md` (input của nó là `05-diagnosis.md` + `15-fixplan.md`),
     và rubric của nó chấm theo mục Unchanged behavior của **diagnosis**. Mục
     nào ở brief mà diagnosis không chép sang thì coi như mất — nên viết đủ ở
     đây, rồi ở bước duyệt diagnosis kiểm lại xem nó có chép đủ;
   - Cách tái hiện (nếu biết): các bước + môi trường. Nguồn không nói thì ghi
     câu hỏi, đừng tự trả lời hộ.

6. **DỪNG LẠI Ở ĐÂY.** In nguyên văn brief ra chat, nói rõ: đọc và sửa
   `features/<feature>/00-brief.md` cho đúng ý, xong chạy `/pp <feature>` để
   pipeline bắt đầu (stage đầu là diagnosis — tái hiện được và root cause có
   bằng chứng thì mới có đường đi tiếp). Tuyệt đối không tự chạy `/pp`, không
   viết `05-diagnosis.md`, không chạy `pp gate`.

Không bao giờ tự ghi `STATE.md`, `.evidence/`, `pipeline.json` — chỉ `pp` ghi.
`refs/` và `00-brief.md` là hai chỗ duy nhất lệnh này được ghi.
