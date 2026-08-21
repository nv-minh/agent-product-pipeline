---
description: Tạo feature mới từ bất kỳ nguồn nào (link Jira/Confluence, URL, text, file Excel) — init + nạp nguồn + nháp brief, rồi DỪNG chờ người duyệt brief
---

Nhiệm vụ: biến $ARGUMENTS thành một feature sẵn sàng chạy `/pp` — nhưng **dừng
trước cửa PRD**. Brief là tiếng nói của người: chữ ký `pp approve 10-prd` sau
này đặt trên nền brief, nên người dùng phải đọc và nhận nó trước khi pipeline
chạy. Làm đúng thứ tự sau, không bỏ bước, không chạy quá:

1. **Đọc $ARGUMENTS, nhận diện nguồn.** Có thể có nhiều nguồn cùng lúc, mỗi
   nguồn thuộc một trong: link `*.atlassian.net` (Jira issue / trang
   Confluence), URL công khai khác, đường dẫn file (`.xlsx`, `.csv`, `.md`,
   `.txt`), hoặc text mô tả dán thẳng. Nếu $ARGUMENTS có sẵn một tên dạng
   `chữ-thường-gạch-nối` đứng riêng, coi đó là tên feature người dùng muốn.

2. **Chốt tên feature.** Tên phải khớp `^[a-z0-9][a-z0-9-]*$` (luật của
   `pp` — xem `lib/commands/precond.js`; tên sai luật sẽ bị mọi lệnh từ chối
   exit 2). Chưa có tên thì đề xuất một tên ngắn gọn từ nội dung nguồn và
   **hỏi người dùng xác nhận** trước khi tạo — đừng tự quyết một cái tên họ
   sẽ phải sống cùng.

3. Chạy `pp init <feature>`. Lệnh này in "đã tồn tại" thì dừng và hỏi người
   dùng — đừng ghi đè việc đang dở của một feature khác.

4. **Nạp từng nguồn vào `features/<feature>/refs/`** — một nguồn một file:
   `features/<feature>/refs/source.md` (nguồn duy nhất) hoặc
   `features/<feature>/refs/source-01.md`, `source-02.md`…
   Dòng đầu mỗi file ghi rõ: lấy từ đâu (URL/tên file gốc) và lấy lúc nào.
   - Link `*.atlassian.net`: dùng tool MCP Atlassian (`getJiraIssue` cho
     issue, `getConfluencePage` cho trang). MCP chưa đăng nhập/không có →
     **DỪNG**, báo người dùng đăng nhập MCP Atlassian hoặc dán thẳng nội dung
     ticket vào chat. Đừng đoán nội dung ticket từ cái link.
   - URL công khai khác: WebFetch, giữ phần nội dung chính.
   - File `.xlsx`/`.csv`: **bắt buộc** convert bằng skill excel-to-md
     (`node skills/excel-to-md/xlsx2md.mjs <file> --out features/<feature>/refs/source-XX.md`)
     — không bao giờ tự đọc file Excel nhị phân. Output có ghi chú cắt thì
     giữ nguyên ghi chú đó trong refs.
   - File `.md`/`.txt` hoặc text dán thẳng: chép nguyên văn, không tóm tắt ở
     bước này — refs là NGUYÊN VĂN nguồn, bản chưng cất nằm ở brief.

5. **Nháp `00-brief.md`**: 3–10 dòng dạng DELTA (hôm nay hệ thống làm gì →
   sau thay đổi này nó khác đi ở đâu → vì sao cần), chỉ từ nội dung trong
   `refs/` — không bịa thêm phạm vi ngoài nguồn. Nguồn mâu thuẫn nhau hoặc
   thiếu thông tin cốt lõi thì ghi thẳng câu hỏi vào cuối brief thay vì tự
   trả lời hộ.

6. **DỪNG LẠI Ở ĐÂY.** In nguyên văn brief ra chat và nói rõ với người dùng:
   - đọc và sửa `features/<feature>/00-brief.md` cho tới khi nó đúng là ý họ —
     mọi user story sau này phải truy vết được về brief này, và chữ ký
     `pp approve 10-prd` đặt trên nền nó;
   - xong thì chạy `/pp <feature>` để pipeline bắt đầu.
   Tuyệt đối không tự chạy `/pp`, không viết `10-prd.md`, không chạy
   `pp gate` — đó là việc của vòng sau, trên một brief đã được người nhận.

Không bao giờ tự ghi `STATE.md`, `.evidence/`, `pipeline.json` — chỉ `pp` ghi.
`refs/` và `00-brief.md` là hai chỗ duy nhất lệnh này được ghi.
