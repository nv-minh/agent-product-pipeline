# product-repo

Repo artifact của workspace Product (Layout A). Chứa **tài liệu sản phẩm và trạng thái pipeline**,
không chứa code. Code nằm ở hai repo anh em: `backend-repo` (NestJS) và `web-repo` (React).

Lý do tồn tại: một feature chạm cả hai repo code, nên artifact của nó không thuộc về repo nào.
Đặt riêng ở đây thì tài liệu có lịch sử git riêng, nhịp review riêng, và `STATE.md` kiểm toán được.

## Cấu trúc

```
constitution.md        Nguyên tắc bất di bất dịch — mọi artifact kế thừa
CHANGELOG.md           Mỗi feature ship xong ghi 10 dòng
bin/                   pp — conductor (shell, tất định)
schema/<stage>.json    Heading bắt buộc + regex ID để gate T1 kiểm
rubric/<stage>.md      Tiêu chí đạt/trượt để gate T2 (reviewer đối kháng) chấm
lessons/<stage>.md     Bài học từ gate đỏ; inject vào prompt stage đó lần sau
skills/                Skill cho agent (excel-to-md: convert .xlsx/.csv → Markdown)
features/<name>/       Blackboard của một feature (refs/ = nguyên văn nguồn ticket)
features/_archive/     Feature đã ship
docs/specs/            Design spec
```

## Bắt đầu một feature từ bất kỳ nguồn nào

`/pp-new <link Jira/Confluence | URL | file .xlsx/.csv | text>` — agent init
feature, nạp nguyên văn nguồn vào `features/<name>/refs/`, nháp `00-brief.md`
rồi **dừng chờ bạn duyệt brief**. Đọc/sửa brief xong chạy `/pp <name>` để
pipeline bắt đầu. Brief là tiếng nói của người: chữ ký `pp approve 10-prd`
đặt trên nền nó.

## Bug và change request

`/pp-bugfix <nguồn>` — pipeline KHÔNG có PRD: `05-diagnosis` (tái hiện + root
cause, người duyệt) → `15-fixplan` → `40-regression` (test tái hiện bug, test
xác nhận fix, test bảo vệ hành vi không đổi).

`/pp-change <nguồn>` — thay đổi hành vi ĐÃ CÓ: `05-impact` (đọc artifact cũ
qua `--from`, hoặc đọc code hiện trạng khi dự án brownfield chưa có artifact)
→ `10-prd` dạng delta ADDED/MODIFIED/REMOVED (người duyệt) → `40-testplan`.
Đổi ý giữa chừng một feature đang chạy thì không cần lệnh này — sửa artifact,
cơ chế stale tự re-gate.

Thiết kế: [docs/specs/2026-08-20-pp-bugfix-pp-change-design.md](docs/specs/2026-08-20-pp-bugfix-pp-change-design.md)

## Luật vàng

**Không thực thể LLM nào được ghi `STATE.md` hay `.evidence/`.** Chỉ `bin/pp` ghi.
Hoàn thành là dữ kiện đọc từ exit code, không phải lời khai của agent.

Thiết kế đầy đủ: [docs/specs/2026-08-18-agent-product-pipeline-design.md](docs/specs/2026-08-18-agent-product-pipeline-design.md)
