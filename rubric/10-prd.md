# Rubric — 10-prd

Với MỖI tiêu chí, trả verdict kèm **trích dẫn nguyên văn** từ artifact. Không trích dẫn được = fail.

## 1. AC đo được
- Đạt: mỗi AC nêu điều kiện kích hoạt và kết quả quan sát được, một hành vi duy nhất.
- Trượt: "hệ thống hoạt động tốt", "xử lý phù hợp", hai hành vi trong một AC.
- Severity khi trượt: **high**

## 2. Ranh giới phạm vi rõ
- Đạt: `## Out of scope` liệt kê thứ cụ thể đã cân nhắc rồi loại.
- Trượt: mục rỗng, hoặc chỉ ghi "những gì không nêu ở trên".
- Severity: **high**

## 3. Neo vào code thật
- Đạt: nhắc tới file/endpoint có thật, đường dẫn tồn tại.
- Trượt: mô tả hệ thống chung chung không tham chiếu code hiện có.
- Severity: **high**

## 4. Rủi ro được trả lời thực chất
- Đạt: mỗi mục checklist có kết luận riêng cho feature này.
- Trượt: "không áp dụng" không kèm lý do; câu trả lời chung chung dùng cho feature nào cũng được.
- Severity: **medium**

## 5. Không phình phạm vi
- Đạt: mọi story truy được về brief.
- Trượt: có story agent tự nghĩ ra mà brief không yêu cầu (vi phạm Điều 1).
- Severity: **medium**

## 6. Delta trung thực (CHỈ pipeline change — bỏ qua nếu artifact không có `## Delta`)
- Đạt: mỗi mục `ADDED` / `MODIFIED` / `REMOVED` nói đúng một thay đổi so với hiện trạng đã chốt ở
  `05-impact.md`, và truy được về nó; `REMOVED: không có.` là kết luận hợp lệ.
- Trượt: PRD viết lại toàn bộ hành vi rồi dán một mục Delta chung chung (spec đòi PRD **delta**,
  không phải PRD viết lại); mục Delta nhắc thay đổi mà `05-impact.md` không hề nói tới;
  `MODIFIED` mô tả một hành vi chưa từng tồn tại (đó là `ADDED`).
- Severity: **high**

<!-- Bổ sung tiêu chí 7+ khi lessons/10-prd.md tích luỹ đủ mẫu gate đỏ lặp lại
     (D7: cite cũ trỏ tests/fixtures/real/NOTES.md — file đó chưa từng tồn tại
     trong repo; rubric không được cite thứ nó không thể mở). -->
