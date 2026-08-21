# Changelog sản phẩm

Mỗi feature ship xong ghi một mục ~10 dòng. (Lệnh `pp archive` CHƯA tồn tại —
mục hiện được ghi tay; test plan cho lệnh này đã viết xong ở
features/archive-command/40-testplan.md, code chưa implement.)

<!-- pp archive (khi có) chèn mục mới ngay dưới dòng này -->

## 2026-08-21 — Vòng vá sau adversarial review pp-bugfix/pp-change

Review đối kháng range `8c825c9..44c1ecb` tìm ra 14 nhóm lỗi tái hiện được; vá
hết trong 10 commit, mỗi commit một test đỏ trước. 470 → 542 test.

Nặng nhất, và không nằm trong code mới: `parseArgs` không hiểu cú pháp `--k=v`,
nên mọi flag có default im lặng bị đoán thay. `--type=bugfix` chạy pipeline
feature, `--tier=t2` chạy T1 rồi báo thành công, `--root=/khác` ghi vào repo
khác repo được chỉ định (vô hiệu hoá `badExplicitRoot`). Nay parser tách `=` và
CLI từ chối flag lạ.

Bốn lỗ gate: schema override trỏ file không tồn tại cho gate chạy với schema
rỗng rồi in xanh; `## Delta` chỉ bị kiểm bằng `includes` nên h3/code-fence/văn
xuôi đều lọt, và marker ADDED/MODIFIED/REMOVED không tier nào kiểm; `pp approve`
đóng được chữ ký người lên stage không có human gate; `40-regression` mất trọn
bộ check nên bỏ một mục Unchanged vẫn xanh.

Một lỗ guard: symlink thư mục trong `features/` làm realpath ra ngoài, nên ghi
được trạng thái/pipeline của feature đó qua đường symlink.

Ba chỗ doc dặn sai: nguồn phải tên `features/<feature>/refs/source.md` (tên khác
thì stage đầu không được lệnh đọc nó), `40-regression` truy vết về diagnosis chứ
không về brief, `--from` chỉ nối ba artifact cố định.

Chi tiết từng finding: xem commit message của range `44c1ecb..HEAD`.
