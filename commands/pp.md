---
description: Chạy conductor pipeline sản phẩm cho một feature
---

Chạy `pp advance <feature>` (hoặc lệnh người dùng đưa trong $ARGUMENTS), đọc output in ra, rồi xử
lý đúng theo loại output đó. Feature CHƯA TỒN TẠI (advance lỗi "không đọc được …/pipeline.json")
thì đừng tự `pp init` — chỉ người dùng sang lệnh khởi tạo đúng LOẠI VIỆC: `/pp-new <nguồn>` cho
feature mới, `/pp-bugfix <nguồn>` cho bug (pipeline không có PRD: diagnosis → fixplan →
regression), `/pp-change <nguồn>` cho thay đổi hành vi đã có (impact → PRD delta → testplan).
Cả ba init + nạp nguồn + nháp brief rồi dừng cho họ duyệt, vì brief phải là tiếng nói của người
trước khi pipeline chạy. Đừng tự chọn loại thay họ: ép một bug đi qua pipeline feature là ép nó
viết PRD cho một thứ chỉ cần root cause.
`pp advance` in đúng một trong bốn dạng sau:

1. **`CHỈ THỊ CHO STAGE …`** (`run`/`retry`/`regate`, exit 0):
   1. Mở một subagent mới, đưa nguyên chỉ thị đó làm prompt.
      Subagent chỉ được đọc các file trong dòng `Đọc` (cộng dòng `Được đọc thêm` nếu chỉ thị có
      in nó — stage diagnosis/impact cần soi code thật), và chỉ được ghi các file trong dòng
      `Ghi`. Nới ĐỌC không bao giờ nới GHI: kể cả khi được đọc cả code repo, subagent vẫn không
      ghi/xoá/sửa gì ngoài dòng `Ghi`.
      Dòng `Tier bắt buộc` của chỉ thị liệt kê đúng những tier stage này cần — **đừng tự suy ra
      từ `pipeline.json`**, và cũng đừng tự kết luận stage đã xong.
   2. Khi subagent xong, chạy `pp gate <feature> <stage>` (đây là T1).
   3. Gate đỏ → đưa nguyên output gate cho subagent sửa, chạy lại gate. Tối đa 3 lần.
   2b. T1 xanh mà output còn in `⏳ … CHƯA done — còn thiếu tier: t2`: chạy `pp review-prompt
       <feature> <stage>`, mở một subagent MỚI dùng agent `pp-reviewer` (agents/pp-reviewer.md)
       với **nguyên prompt đó** làm input — subagent chỉ đọc, không ghi file nào. Prompt kết thúc
       bằng một mục `=== NONCE ===`: đưa nguyên cả mục đó cho reviewer, và **đừng cắt bỏ nó** —
       reviewer phải chép chuỗi nonce vào field `"nonce"` của JSON, nếu không `pp review-record`
       từ chối toàn bộ verdict. Lưu đúng nguyên văn JSON subagent trả về vào
       `features/<feature>/.review-<stage>.json` (file này ở GỐC feature là inbox — agent được ghi),
       rồi chạy `pp review-record <feature> <stage> --verdict
       features/<feature>/.review-<stage>.json` (pp tự lưu mỗi verdict vào
       `.review/<stage>.<seq>.json` — không ghi đè lịch sử).
       Verdict
       có finding `severity: high` (exit 1) → đưa evidence T2 cho subagent viết-artifact sửa, quay
       lại bước 2 (gate T1 lại). Tính vào cùng giới hạn tối đa 3 lần của bước 3.
       `pp review-prompt`/`review-record` **tự từ chối (exit 1)** nếu T1 chưa xanh — thứ tự tier
       là luật trong code, không phải lời dặn ở đây.
       Nonce dùng **một lần**: mỗi vòng review phải chạy lại `pp review-prompt` để lấy phiếu mới.
       Nộp lại verdict cũ, hoặc chấm sau khi artifact/rubric đã đổi, đều bị từ chối.
   4. Chỉ khi `pp gate`/`pp review-record` in `✓ <stage>: done` (mọi tier bắt buộc đã xanh) thì
      stage mới xong; stage cần duyệt → dừng, báo người dùng chạy `pp approve`.
   5. Chỉ chạy đúng stage mà `pp advance` vừa nêu. `pp gate`/`pp review-*` **tự từ chối (exit 1)**
      với thông báo `chưa tới lượt <stage>` nếu stage thượng nguồn chưa `done` **và** chưa được
      người duyệt — thứ tự stage là luật trong code, không phải lời dặn ở đây. Gặp thông báo đó thì
      chạy lại `pp advance` để biết stage thật sự đang tới lượt, đừng tìm cách đi vòng.

2. **`✓ <feature>: mọi stage đã xong`** (`complete`, exit 0): báo cho người dùng biết feature đã
   hoàn tất mọi stage đã bật (`enabled`). Không làm gì thêm — không có stage nào để chạy tiếp.

3. **`🚦 <stage>: …`** (`await-human`, exit 0): dừng lại ngay, không tự chạy tiếp sang stage kế
   tiếp. Báo người dùng chính xác lệnh `pp approve <feature> <stage>` cần chạy để duyệt stage đó.

4. **`⛔ <stage> blocked: …`** (`blocked`, exit 3): dừng lại, không được tự thử lại stage đó dưới
   bất kỳ hình thức nào. Hiển thị evidence log của stage cho người dùng xem
   (`features/<feature>/.evidence/<stage>.t1.log`, và `.t2.log` nếu có T2), rồi nêu hai lựa chọn duy nhất của họ:
   `pp unblock <feature> <stage> --reason "…"` hoặc `pp override <feature> <stage> --reason "…"`.

Không bao giờ tự ghi `STATE.md` hoặc `.evidence/` — cả hai chỉ do `pp` ghi.
