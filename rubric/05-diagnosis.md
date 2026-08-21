# Rubric — 05-diagnosis

Với MỖI tiêu chí, trả verdict kèm **trích dẫn nguyên văn** từ artifact. Không trích dẫn được = fail.

## 1. Tái hiện được thật
- Đạt: các bước cụ thể một người khác làm theo được, kèm bằng chứng quan sát (log/output/response).
- Trượt: "thỉnh thoảng bị", "khó tái hiện" mà không có bước nào; bằng chứng là lời kể không có output.
- Severity khi trượt: **high**

## 2. Root cause là nguyên nhân, không phải triệu chứng
- Đạt: giải thích CƠ CHẾ gây lỗi (vì sao code hiện tại sinh ra hiện tượng), trỏ vào vị trí code thật.
- Trượt: mô tả lại hiện tượng bằng lời khác; "do backend trả 500" (đó là triệu chứng); không trỏ được vào code.
- Severity: **high**

## 3. Giả thuyết đã loại có căn cứ
- Đạt: mỗi giả thuyết bị loại kèm bằng chứng vì sao loại — chứng tỏ đã điều tra chứ không đoán trúng ngay.
- Trượt: mục rỗng, hoặc "đã kiểm tra các hướng khác" không nói hướng nào.
- Severity: **medium**

## 4. Unchanged behavior cụ thể và đo được
- Đạt: liệt kê hành vi phải giữ nguyên sau fix, mỗi mục quan sát/kiểm được — 40-regression sẽ truy vết về đây.
- Trượt: "mọi thứ khác giữ nguyên"; mục không kiểm được.
- Severity: **high**
