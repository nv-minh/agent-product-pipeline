---
name: excel-to-md
description: Convert file .xlsx/.csv sang bảng Markdown bằng script tất định — dùng khi cần đọc nội dung Excel (ticket, định nghĩa item, bảng yêu cầu) thay vì đọc binary
---

# excel-to-md

Gặp file `.xlsx` hoặc `.csv` cần đọc nội dung: **đừng đọc file trực tiếp** —
`.xlsx` là ZIP nhị phân, đọc thẳng chỉ ra rác hoặc bịa. Chạy script convert
rồi đọc bản Markdown:

```
node skills/excel-to-md/xlsx2md.mjs <file.xlsx> [--out <file.md>] [--max-rows N] [--max-cols N]
```

- Không `--out`: markdown in ra stdout (lỗi đi vào stderr — stdout luôn là data sạch).
- Mỗi sheet thành một mục `## Sheet: <tên>` + bảng Markdown, hàng đầu làm header.
- Mặc định cắt 300 hàng / 40 cột mỗi sheet — **có ghi chú cắt trong output**,
  không cắt im lặng. File lớn hơn thì tăng `--max-rows`/`--max-cols`.
- `.csv` được hỗ trợ cùng lệnh (BOM + quoted field chuẩn).

Dùng trong flow `/pp-new`: convert ra `features/<feature>/refs/source-XX.md`
(kèm dòng đầu ghi nguồn gốc file + thời điểm convert) rồi nháp brief từ đó.

## Giới hạn — biết trước, đừng suy diễn quá

- **Formula chỉ lấy giá trị cached** trong file, không tính lại. File chưa từng
  mở bằng Excel sau khi sửa công thức có thể mang giá trị cũ.
- **Merged cell**: chỉ ô góc trên-trái có giá trị, các ô còn lại ra trống —
  đúng dữ liệu vật lý, khác hình ảnh nhìn thấy trong Excel.
- **Ngày giờ**: chỉ nhận diện numFmt built-in (id 14–22, 45–47) → ISO. Ngày
  định dạng bằng numFmt custom hiện ra dưới dạng **số serial** (vd `45123`) —
  thấy cột toàn số 5 chữ số quanh 40000–50000 thì khả năng cao là ngày.
- **`.xls` đời cũ (Excel 97–2003)**: từ chối với exit 2 — mở file rồi Save As
  `.xlsx` trước.
- Exit code: `0` = ok, `2` = input sai/không hỗ trợ (thông điệp ở stderr).
