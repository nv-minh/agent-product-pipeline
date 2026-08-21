---
feature: archive-command
stage: 40-testplan
updated: 2026-08-20
source: 10-prd.md
---

# Test plan — archive-command

Test chạy bằng `node --test` như phần còn lại của repo, dùng `makeRoot` và `run`
đã có trong `tests/helpers.js`; không thêm dependency nào.

Ghi chú về nhãn `type` (sửa theo review T2 vòng 1): bốn AC `AC-1-2`, `AC-1-3`,
`AC-2-2`, `AC-2-3` có hành vi CHÍNH LÀ từ chối, nên "case thuận" của chúng đã là
một lần từ chối. Negative case của chúng phải là một dạng SAI KHÁC — trạng thái
đầu vào méo, thiếu file, hoặc kiểu dữ liệu sai — chứ không phải lặp lại chính
lần từ chối đó dưới nhãn khác.

## Test cases

<tc id="TC-001" ac_ref="AC-1-1" type="positive" priority="high">
precondition: feature demo có mọi stage enabled ở status done và đã approved
steps: chạy pp archive demo
expected: exit 0, features/demo/ không còn, features/_archive/demo/ tồn tại
</tc>

<tc id="TC-002" ac_ref="AC-1-1" type="positive" priority="high">
precondition: feature demo đã done, có .evidence/, audit.jsonl, .review/, .usage/
steps: chạy pp archive demo rồi so sánh nội dung từng file trước và sau
expected: cả bốn đường dẫn nằm nguyên trong features/_archive/demo/, nội dung byte-for-byte không đổi
</tc>

<tc id="TC-003" ac_ref="AC-1-1" type="negative" priority="high">
precondition: không có feature nào tên khong-ton-tai
steps: chạy pp archive khong-ton-tai
expected: exit khác 0, thông báo nêu feature không tồn tại, không tạo features/_archive/khong-ton-tai/
</tc>

<tc id="TC-018" ac_ref="AC-1-1" type="permission" priority="high">
precondition: feature demo vừa được archive thành công sang features/_archive/demo/
steps: chạy pp guard-write --path features/_archive/demo/STATE.md và --path features/_archive/demo/audit.jsonl
expected: cả hai đều exit 2 kèm lý do ra stderr — archive không được đưa sổ sách ra ngoài vùng guard bảo vệ
</tc>

<tc id="TC-004" ac_ref="AC-1-2" type="positive" priority="high">
precondition: feature demo có 10-prd done nhưng 40-testplan còn pending
steps: chạy pp archive demo
expected: exit 1, output nêu tên 40-testplan kèm status pending, features/demo/ vẫn nguyên chỗ cũ
</tc>

<tc id="TC-005" ac_ref="AC-1-2" type="positive" priority="high">
precondition: feature demo có 40-testplan ở status skipped vì bị disabled trong pipeline.json
steps: chạy pp archive demo
expected: exit 0 — stage disabled không phải stage chưa done, không được chặn archive
</tc>

<tc id="TC-019" ac_ref="AC-1-2" type="negative" priority="high">
precondition: STATE.md của demo bị sửa tay để stage 40-testplan là object rỗng, không có trường status
steps: chạy pp archive demo
expected: exit 1, nêu 40-testplan chưa done — trạng thái thiếu phải bị coi là CHƯA done, không được mặc định thành done
</tc>

<tc id="TC-006" ac_ref="AC-1-3" type="positive" priority="high">
precondition: đã tồn tại features/_archive/demo/ chứa một file mốc noi-dung-cu.md
steps: chạy pp archive demo lần nữa với một features/demo/ mới
expected: exit 1, noi-dung-cu.md không đổi, features/demo/ vẫn nguyên chỗ cũ
</tc>

<tc id="TC-007" ac_ref="AC-1-3" type="positive" priority="medium">
precondition: features/_archive/ chỉ có .gitkeep, chưa có thư mục demo nào
steps: chạy pp archive demo
expected: exit 0 — _archive/ rỗng không được tính là đích đã tồn tại
</tc>

<tc id="TC-020" ac_ref="AC-1-3" type="negative" priority="high">
precondition: tồn tại một FILE tên features/_archive/demo (không phải thư mục), và có features/demo/ đã done
steps: chạy pp archive demo
expected: exit 1, file features/_archive/demo không bị xoá hay ghi đè, features/demo/ vẫn nguyên chỗ cũ
</tc>

<tc id="TC-023" ac_ref="AC-1-3" type="boundary" priority="high">
precondition: hai mươi feature dựng sẵn race-01 tới race-20, mỗi feature có mọi stage enabled đã done và chưa có bản nào trong features/_archive/
steps: với từng feature, spawn hai tiến trình pp archive race-NN rồi mới chờ cả hai kết thúc
expected: mỗi lần đúng MỘT tiến trình exit 0 và một exit 1 với thông báo đích đã tồn tại; không lần nào cả hai exit 0; sau mỗi lần features/_archive/demo/ có đủ file của bản gốc và features/demo/ không còn — tuyệt đối không có trạng thái mất cả hai
</tc>

<tc id="TC-008" ac_ref="AC-2-1" type="positive" priority="high">
precondition: CHANGELOG.md có dòng mốc, feature demo đã done với hai stage
steps: chạy pp archive demo rồi đọc CHANGELOG.md
expected: mục mới nằm ngay dưới dòng mốc, chứa chữ demo, ngày dạng YYYY-MM-DD, và tên cả hai stage kèm status
</tc>

<tc id="TC-009" ac_ref="AC-2-1" type="positive" priority="medium">
precondition: CHANGELOG.md đã có một mục cũ nằm dưới dòng mốc
steps: archive một feature thứ hai rồi đọc CHANGELOG.md
expected: mục mới đứng TRÊN mục cũ, mục cũ không bị sửa
</tc>

<tc id="TC-010" ac_ref="AC-2-1" type="negative" priority="high">
precondition: feature demo còn stage pending nên archive sẽ bị từ chối
steps: chạy pp archive demo rồi đọc CHANGELOG.md
expected: CHANGELOG.md không có mục nào được thêm — archive thất bại không được để lại nửa kết quả
</tc>

<tc id="TC-011" ac_ref="AC-2-2" type="positive" priority="high">
precondition: CHANGELOG.md đã bị xoá dòng mốc, feature demo đã done
steps: chạy pp archive demo
expected: exit 1, output nêu thiếu dòng mốc, features/demo/ vẫn nguyên chỗ cũ
</tc>

<tc id="TC-012" ac_ref="AC-2-2" type="positive" priority="medium">
precondition: CHANGELOG.md có dòng mốc nằm ở cuối file, không có dòng nào sau nó
steps: chạy pp archive demo
expected: exit 0, mục mới được chèn ngay sau dòng mốc ở cuối file
</tc>

<tc id="TC-021" ac_ref="AC-2-2" type="negative" priority="high">
precondition: CHANGELOG.md không tồn tại ở gốc repo, feature demo đã done
steps: chạy pp archive demo
expected: exit 1, nêu thiếu CHANGELOG.md, và KHÔNG tự tạo file mới — pp không dựng hộ tài liệu người viết
</tc>

<tc id="TC-013" ac_ref="AC-2-3" type="positive" priority="medium">
precondition: feature demo có stage 10-prd với override_count bằng 2
steps: chạy pp archive demo rồi đọc CHANGELOG.md
expected: mục CHANGELOG chứa số 2 gắn với 10-prd
</tc>

<tc id="TC-014" ac_ref="AC-2-3" type="positive" priority="medium">
precondition: feature demo không có stage nào từng bị override
steps: chạy pp archive demo rồi đọc CHANGELOG.md
expected: mục CHANGELOG không có dòng override nào
</tc>

<tc id="TC-022" ac_ref="AC-2-3" type="negative" priority="medium">
precondition: STATE.md của demo bị sửa tay để override_count của 10-prd là chuỗi "hai" thay vì số
steps: chạy pp archive demo rồi đọc CHANGELOG.md
expected: lệnh không crash; mục CHANGELOG không in ra chuỗi "hai" như một số lần override
</tc>

<tc id="TC-015" ac_ref="AC-3-1" type="positive" priority="high">
precondition: repo sạch, có feature demo đã done
steps: chạy pp archive demo
expected: exit 0 — tên hợp lệ theo regex phải được nhận
</tc>

<tc id="TC-016" ac_ref="AC-3-1" type="negative" priority="high">
precondition: repo sạch
steps: chạy pp archive ../../thoat-ra-ngoai
expected: exit 2, không có thư mục nào được tạo hay di chuyển ngoài features/
</tc>

<tc id="TC-017" ac_ref="AC-3-1" type="boundary" priority="medium">
precondition: repo sạch
steps: chạy pp archive với các tên biên: một ký tự a, tên có dấu gạch ngang giua-ten, tên bắt đầu bằng gạch ngang -dau, tên có chữ hoa Demo, tên rỗng
expected: a và giua-ten được nhận; -dau, Demo và tên rỗng bị từ chối exit 2
</tc>

## Edge cases

Danh sách này là `edgeCaseChecklist` trong `schema/40-testplan.json` — mỗi mục
phải có kết luận, kể cả kết luận "không áp dụng". `pp archive <feature>` nhận
đúng một tham số dạng chuỗi và đọc trạng thái từ file, nên phần lớn mục về kiểu
số không áp dụng; ghi ra để chứng minh đã xét, không để lấp chỗ trống.

- null: không áp dụng — không có tham số nào nhận null; thiếu tham số là tên rỗng, đã phủ ở TC-017.
- chuỗi rỗng: `pp archive ""` bị từ chối exit 2, phủ ở TC-017.
- vượt max length: không áp dụng — tên feature không có giới hạn độ dài riêng; giới hạn thật là của filesystem, và một tên vượt nó sẽ lỗi ở tầng `mkdirSync` với exit khác 0, không phải im lặng.
- unicode hoặc emoji: tên có ký tự ngoài `[a-z0-9-]` bị từ chối exit 2, cùng nhánh với TC-017 (chữ hoa `Demo`).
- số âm: không áp dụng — lệnh không nhận tham số số.
- giá trị 0: không áp dụng — lệnh không nhận tham số số.
- số rất lớn: không áp dụng — lệnh không nhận tham số số.
- sai định dạng: `STATE.md` hỏng (thiếu khối `<!-- pp:state`) phải làm archive từ chối exit 1 kèm tên file, không được coi là "không có stage nào chưa done" rồi archive luôn — phủ ở TC-019.
- trùng lặp: `features/_archive/<feature>/` đã tồn tại thì từ chối exit 1, không ghi đè — AC-1-3, phủ ở TC-006, TC-007, TC-020.
- gọi đồng thời: hai `pp archive` cùng feature chạy song song — phủ ở TC-023, và test đó cố tình lặp 20 lần vì một race chỉ hiện ra theo xác suất. Bản đầu của mục này viết "chưa có test case, sẽ thêm cùng lúc với lockfile"; T2 đánh trượt tiêu chí 1 vì rubric nêu thẳng "đồng thời" là một biên phải phủ. Đúng: `pp` chưa có lockfile (C1) không phải lý do để không VIẾT RA kỳ vọng — kỳ vọng viết trước chính là thứ lockfile phải thoả.
- sai quyền: thư mục `features/_archive/` không có quyền ghi thì lệnh phải báo lỗi và không xoá thư mục nguồn — phủ ở TC-018.
