<!-- commands/pp.md — slash command /pp -->
---
description: Chạy conductor pipeline sản phẩm cho một feature
---

Chạy `pp advance <feature>` (hoặc lệnh người dùng đưa trong $ARGUMENTS), đọc chỉ thị in ra, rồi:

1. Nếu là `CHỈ THỊ CHO STAGE …` — mở một subagent mới, đưa nguyên chỉ thị đó làm prompt.
   Subagent chỉ được đọc các file trong dòng `Đọc`, chỉ được ghi các file trong dòng `Ghi`.
2. Khi subagent xong, chạy `pp gate <feature> <stage>`.
3. Gate đỏ → đưa nguyên output gate cho subagent sửa, chạy lại gate. Tối đa 3 lần.
4. Gate xanh và stage cần duyệt → dừng, báo người dùng chạy `pp approve`.
5. Không bao giờ tự ghi `STATE.md` hoặc `.evidence/`.
