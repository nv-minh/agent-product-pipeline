<!-- commands/pp.md — slash command /pp -->
---
description: Chạy conductor pipeline sản phẩm cho một feature
---

Chạy `pp advance <feature>` (hoặc lệnh người dùng đưa trong $ARGUMENTS), đọc output in ra, rồi xử
lý đúng theo loại output đó — `pp advance` in đúng một trong bốn dạng sau:

1. **`CHỈ THỊ CHO STAGE …`** (`run`/`retry`/`regate`, exit 0):
   1. Mở một subagent mới, đưa nguyên chỉ thị đó làm prompt.
      Subagent chỉ được đọc các file trong dòng `Đọc`, chỉ được ghi các file trong dòng `Ghi`.
   2. Khi subagent xong, chạy `pp gate <feature> <stage>`.
   3. Gate đỏ → đưa nguyên output gate cho subagent sửa, chạy lại gate. Tối đa 3 lần.
   4. Gate xanh và stage cần duyệt → dừng, báo người dùng chạy `pp approve`.

2. **`✓ <feature>: mọi stage đã xong`** (`complete`, exit 0): báo cho người dùng biết feature đã
   hoàn tất mọi stage đã bật (`enabled`). Không làm gì thêm — không có stage nào để chạy tiếp.

3. **`🚦 <stage>: …`** (`await-human`, exit 0): dừng lại ngay, không tự chạy tiếp sang stage kế
   tiếp. Báo người dùng chính xác lệnh `pp approve <feature> <stage>` cần chạy để duyệt stage đó.

4. **`⛔ <stage> blocked: …`** (`blocked`, exit 3): dừng lại, không được tự thử lại stage đó dưới
   bất kỳ hình thức nào. Hiển thị evidence log của stage cho người dùng xem
   (`features/<feature>/.evidence/<stage>.log`), rồi nêu hai lựa chọn duy nhất của họ:
   `pp unblock <feature> <stage> --reason "…"` hoặc `pp override <feature> <stage> --reason "…"`.

Không bao giờ tự ghi `STATE.md` hoặc `.evidence/` — cả hai chỉ do `pp` ghi.
