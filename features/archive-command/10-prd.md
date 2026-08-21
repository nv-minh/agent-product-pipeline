---
feature: archive-command
stage: 10-prd
updated: 2026-08-20
source: 00-brief.md
---

# PRD — archive-command

`pp archive <feature>` đóng sổ một feature đã hoàn tất: chuyển thư mục sang
`features/_archive/`, và chèn một mục vào `CHANGELOG.md`. Lệnh đọc trạng thái từ
STATE.md qua `lib/state.js` và sổ kiểm toán `audit.jsonl` qua `lib/audit.js`;
không có trường nào do người gõ tay.

## User stories

<us id="US-1">Là người vận hành pipeline, tôi muốn đóng sổ một feature đã xong để `features/` chỉ còn feature đang sống.</us>

<ac id="AC-1-1" story="US-1">
WHEN người vận hành chạy `pp archive` trên một feature mà mọi stage enabled đều done THE SYSTEM SHALL chuyển thư mục feature sang `features/_archive/<feature>/` nguyên vẹn cả `.evidence/`, `audit.jsonl`, `.review/` và `.usage/`
</ac>

<ac id="AC-1-2" story="US-1">
IF một stage enabled của feature chưa ở trạng thái done THE SYSTEM SHALL từ chối archive, trả exit 1 và in ra tên từng stage chưa done kèm status hiện tại
</ac>

<ac id="AC-1-3" story="US-1">
IF thư mục `features/_archive/<feature>/` đã tồn tại THE SYSTEM SHALL từ chối archive và trả exit 1 mà không ghi đè bất kỳ file nào của bản đã lưu
</ac>

<us id="US-2">Là người vận hành pipeline, tôi muốn mỗi feature ship xong để lại một mục CHANGELOG sinh từ sổ sách, để không phải tự viết lại lịch sử.</us>

<ac id="AC-2-1" story="US-2">
WHEN archive thành công THE SYSTEM SHALL chèn vào `CHANGELOG.md` một mục ngay dưới dòng mốc `<!-- pp archive chèn mục mới ngay dưới dòng này -->` gồm tên feature, ngày archive, và status cuối của từng stage
</ac>

<ac id="AC-2-2" story="US-2">
IF `CHANGELOG.md` không chứa dòng mốc THE SYSTEM SHALL từ chối archive, trả exit 1 và không di chuyển thư mục feature
</ac>

<ac id="AC-2-3" story="US-2">
WHEN một stage của feature có `override_count` lớn hơn 0 THE SYSTEM SHALL ghi số lần override đó vào mục CHANGELOG của feature
</ac>

<us id="US-3">Là người vận hành pipeline, tôi muốn `pp archive` không bao giờ ghi ra ngoài `features/`, để một tên feature gõ sai không di chuyển thư mục khác.</us>

<ac id="AC-3-1" story="US-3">
IF tên feature không khớp `^[a-z0-9][a-z0-9-]*$` THE SYSTEM SHALL từ chối lệnh với exit 2 và không tạo hay di chuyển thư mục nào
</ac>

## Out of scope

Đã cân nhắc rồi loại khỏi phạm vi này:

- **Un-archive / restore.** Đưa một feature từ `_archive/` trở lại là thao tác
  `mv` một dòng khi cần; thêm lệnh cho nó là phình phạm vi (Điều 1).
- **Nén thư mục archive thành tar/zip.** `features/_archive/` chỉ chứa markdown
  và jsonl; nén nó không giải quyết vấn đề nào đang có.
- **Gọi `git commit` hay `git mv`.** Spec §8 chốt `pp` không bao giờ chạy git.
- **Tự động archive theo tuổi feature.** Đóng sổ là quyết định của người, giống
  `pp approve`; hẹn giờ tự chạy sẽ archive mất thứ người ta còn đang xem.
- **Sửa `pp report` / `pp status` để ẩn feature đã archive.** Không cần:
  `lib/commands/report.js` và `lib/commands/guard.js` đã bỏ qua `_archive`.
- **Stage `90-archive` trong `pipeline.json`.** Lệnh này là thao tác ngoài
  pipeline, không phải một stage có gate; template S/M không đổi.

## Rủi ro

- migrate dữ liệu cũ: không áp dụng vì `features/_archive/` hiện rỗng (chỉ có
  `.gitkeep`), nên không có bản ghi định dạng cũ nào phải đọc lại.
- ai không được phép: không áp dụng ở tầng `pp` — không có xác thực nào trong
  CLI này. Ghi `actor: 'human'` theo lớp lệnh như `lib/commands/human.js` đang
  làm, và giữ nguyên ghi chú của `lib/audit.js` rằng danh tính không xác minh
  được. Đây là giới hạn đã biết, không phải điều lệnh này giải quyết.
- thao tác đồng thời: hai `pp archive` cùng feature chạy song song thì lệnh thứ
  hai thấy thư mục nguồn đã biến mất và thoát vì "feature không tồn tại"; lệnh
  archive song song với `pp gate` cùng feature vẫn có thể mất bản ghi vì `pp`
  chưa có lock ở đâu cả. Ghi nhận là rủi ro còn mở, không tự khắc phục ở đây.
- mạng lỗi hoặc offline: không áp dụng, lệnh chỉ đọc/ghi đĩa cục bộ, không có
  lời gọi mạng nào.
- giới hạn kích thước và phân trang: mục CHANGELOG cố định ~10 dòng bất kể
  feature có bao nhiêu stage; không phân trang vì `CHANGELOG.md` là file người
  đọc tuần tự.
- i18n và timezone: ngày archive ghi dạng `YYYY-MM-DD` theo UTC, cùng cách
  `lib/commands/human.js` đang cắt `toISOString().slice(0, 10)` cho `lessons/`.
- hiệu năng khi dữ liệu lớn: thao tác là một `renameSync` trên thư mục, không
  phụ thuộc số file bên trong; đọc `audit.jsonl` một lượt để lấy mốc thời gian.
- rollback: đảo lại bằng cách `mv` thư mục về `features/` và xoá mục vừa chèn
  trong `CHANGELOG.md`. Không có migration dữ liệu nên không cần script rollback.
