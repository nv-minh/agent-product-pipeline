<!-- commands/pp.md — slash command /pp -->
---
description: Chạy conductor pipeline sản phẩm cho một feature
---

Chạy `pp advance <feature>` (hoặc lệnh người dùng đưa trong $ARGUMENTS), đọc output in ra, rồi xử
lý đúng theo loại output đó — `pp advance` in đúng một trong bốn dạng sau:

1. **`CHỈ THỊ CHO STAGE …`** (`run`/`retry`/`regate`, exit 0):
   1. Mở một subagent mới, đưa nguyên chỉ thị đó làm prompt.
      Subagent chỉ được đọc các file trong dòng `Đọc`, chỉ được ghi các file trong dòng `Ghi`.
      Dòng `Tier bắt buộc` của chỉ thị liệt kê đúng những tier stage này cần — **đừng tự suy ra
      từ `pipeline.json`**, và cũng đừng tự kết luận stage đã xong.
   2. Khi subagent xong, chạy `pp gate <feature> <stage>` (đây là T1).
   3. Gate đỏ → đưa nguyên output gate cho subagent sửa, chạy lại gate. Tối đa 3 lần.
   2b. T1 xanh mà output còn in `⏳ … CHƯA done — còn thiếu tier: t2`: chạy `pp review-prompt
       <feature> <stage>`, mở một subagent MỚI dùng agent `pp-reviewer` (agents/pp-reviewer.md)
       với nguyên prompt đó làm input — subagent chỉ đọc, không ghi file nào. Lưu đúng nguyên văn
       JSON subagent trả về vào `features/<feature>/.review-<stage>.json` (file này ở GỐC feature là
       inbox — agent được ghi), rồi chạy `pp
       review-record <feature> <stage> --verdict features/<feature>/.review-<stage>.json` (pp tự lưu
       mỗi verdict vào `.review/<stage>.<seq>.json` trong dir `.review/` — không ghi đè lịch sử).
       Verdict
       có finding `severity: high` (exit 1) → đưa evidence T2 cho subagent viết-artifact sửa, quay
       lại bước 2 (gate T1 lại). Tính vào cùng giới hạn tối đa 3 lần của bước 3.
       `pp review-prompt`/`review-record` **tự từ chối (exit 1)** nếu T1 chưa xanh — thứ tự tier
       là luật trong code, không phải lời dặn ở đây.
   4. Chỉ khi `pp gate`/`pp review-record` in `✓ <stage>: done` (mọi tier bắt buộc đã xanh) thì
      stage mới xong; stage cần duyệt → dừng, báo người dùng chạy `pp approve`.

2. **`✓ <feature>: mọi stage đã xong`** (`complete`, exit 0): báo cho người dùng biết feature đã
   hoàn tất mọi stage đã bật (`enabled`). Không làm gì thêm — không có stage nào để chạy tiếp.

3. **`🚦 <stage>: …`** (`await-human`, exit 0): dừng lại ngay, không tự chạy tiếp sang stage kế
   tiếp. Báo người dùng chính xác lệnh `pp approve <feature> <stage>` cần chạy để duyệt stage đó.

4. **`⛔ <stage> blocked: …`** (`blocked`, exit 3): dừng lại, không được tự thử lại stage đó dưới
   bất kỳ hình thức nào. Hiển thị evidence log của stage cho người dùng xem
   (`features/<feature>/.evidence/<stage>.t1.log`, và `.t2.log` nếu có T2), rồi nêu hai lựa chọn duy nhất của họ:
   `pp unblock <feature> <stage> --reason "…"` hoặc `pp override <feature> <stage> --reason "…"`.

Không bao giờ tự ghi `STATE.md` hoặc `.evidence/` — cả hai chỉ do `pp` ghi.
