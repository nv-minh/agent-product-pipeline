# pinnacle-product

Repo artifact của workspace Pinnacle (Layout A). Chứa **tài liệu sản phẩm và trạng thái pipeline**,
không chứa code. Code nằm ở hai repo anh em: `pinnacle-backend` (NestJS) và `pinnacle-web` (React).

Lý do tồn tại: một feature chạm cả hai repo code, nên artifact của nó không thuộc về repo nào.
Đặt riêng ở đây thì tài liệu có lịch sử git riêng, nhịp review riêng, và `STATE.md` kiểm toán được.

## Cấu trúc

```
constitution.md        Nguyên tắc bất di bất dịch — mọi artifact kế thừa
CHANGELOG.md           Mỗi feature ship xong ghi 10 dòng
bin/                   pp — conductor (shell, tất định)
schema/<stage>.yml     Heading bắt buộc + regex ID để gate T1 kiểm
rubric/<stage>.md      Tiêu chí đạt/trượt để gate T2 (reviewer đối kháng) chấm
lessons/<stage>.md     Bài học từ gate đỏ; inject vào prompt stage đó lần sau
features/<name>/       Blackboard của một feature
features/_archive/     Feature đã ship
docs/specs/            Design spec
```

## Luật vàng

**Không thực thể LLM nào được ghi `STATE.md` hay `.evidence/`.** Chỉ `bin/pp` ghi.
Hoàn thành là dữ kiện đọc từ exit code, không phải lời khai của agent.

Thiết kế đầy đủ: [docs/specs/2026-08-18-agent-product-pipeline-design.md](docs/specs/2026-08-18-agent-product-pipeline-design.md)
