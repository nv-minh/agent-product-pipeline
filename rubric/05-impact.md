# Rubric — 05-impact

Với MỖI tiêu chí, trả verdict kèm **trích dẫn nguyên văn** từ artifact. Không trích dẫn được = fail.

## 1. Hiện trạng có nguồn
- Đạt: mục Hiện trạng nói rõ đọc từ đâu (artifact feature cũ, hay code hiện trạng) và trỏ được vào nguồn đó.
- Trượt: mô tả hiện trạng không nguồn — không phân biệt được ghi nhận với bịa.
- Severity khi trượt: **high**

## 2. Danh sách ảnh hưởng không sót
- Đạt: liệt kê thành phần bị chạm (module/endpoint/contract) đủ để một reviewer không tìm ra chỗ code đang phụ thuộc mà bị bỏ qua.
- Trượt: chỉ nêu chỗ sẽ sửa, bỏ qua chỗ đang GỌI TỚI phần bị sửa.
- Severity: **high**

## 3. Backward compatibility đo được
- Đạt: nói rõ hành vi nào giữ nguyên, ai đang phụ thuộc, và vì sao thay đổi không phá họ.
- Trượt: "tương thích ngược" nói suông không có căn cứ.
- Severity: **high**

## 4. Lối đi được chọn có lý do
- Đạt: chọn một trong chỉnh trực tiếp / rollback / re-scope, kèm lý do gắn với chính thay đổi này.
- Trượt: không chọn, hoặc lý do dùng cho thay đổi nào cũng được.
- Severity: **medium**
