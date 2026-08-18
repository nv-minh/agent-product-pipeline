# Rubric — 40-testplan

Với MỖI tiêu chí, trả verdict kèm **trích dẫn nguyên văn** từ artifact. Không trích dẫn được = fail.

## 1. Phủ edge case thực chất
- Đạt: test case bao trùm biên thật của input/state (rỗng, giới hạn, đồng thời, lỗi hạ tầng) liên
  quan trực tiếp tới feature này.
- Trượt: chỉ có happy path, hoặc "edge case" liệt kê chung chung không gắn với input/state cụ thể.
- Severity khi trượt: **high**

## 2. Negative case kiểm đúng thứ đáng kiểm
- Đạt: mỗi negative case nêu rõ input/hành động sai và kết quả từ chối/lỗi cụ thể được quan sát.
- Trượt: negative case chỉ nói "báo lỗi" mà không nói lỗi gì, hoặc kiểm tra một điều kiện không ai
  vi phạm trong thực tế.
- Severity: **high**

## 3. Precondition đủ để chạy lại được
- Đạt: mỗi test case nêu đủ trạng thái/dữ liệu khởi tạo để người khác chạy lại đúng kết quả.
- Trượt: precondition thiếu, hoặc phụ thuộc trạng thái ẩn để lại từ test case khác.
- Severity: **medium**

## 4. Phép thử đột biến
- Đạt: với mỗi test case quan trọng, trả lời được "nếu implement sai theo cách X thì test nào bắt
  được?" bằng tên/số hiệu test case cụ thể.
- Trượt: không chỉ ra được test nào bắt lỗi khi implement sai theo cách hợp lý.
- Severity khi trượt: **high**
