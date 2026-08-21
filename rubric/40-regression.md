# Rubric — 40-regression

Với MỖI tiêu chí, trả verdict kèm **trích dẫn nguyên văn** từ artifact. Không trích dẫn được = fail.

## 1. Test tái hiện đúng bug
- Đạt: mô tả test tái hiện đúng hiện tượng trong diagnosis, và nói rõ nó phải ĐỎ trước khi fix.
- Trượt: test chung chung không gắn với hiện tượng; không có tuyên bố đỏ-trước-fix.
- Severity khi trượt: **high**

## 2. Mỗi mục Unchanged behavior có test truy vết
- Đạt: MỌI mục trong "Unchanged behavior" của diagnosis có ít nhất một test nhắc đích danh mục đó.
- Trượt: có mục Unchanged không test nào phủ.
- Severity: **high**

## 3. Test chạy lại được
- Đạt: mỗi test có tiền điều kiện, bước, kỳ vọng — người khác chạy lại được.
- Trượt: "kiểm tra kỹ các trường hợp" — không có bước nào.
- Severity: **medium**
