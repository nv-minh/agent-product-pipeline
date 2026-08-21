// FINDING (adversarial review 8c825c9..44c1ecb):
//
// (1) `config.type` và `config.from` có 1 writer, 0 reader — grep `config.type|
//     config.from` toàn lib/+bin/ ra rỗng. Comment config.js:56 tuyên bố "cho
//     status/report/audit" và spec §3.1 hứa "pp status/report/audit nhờ đó phân
//     loại được loại việc"; chỉ audit làm được. Đúng mẫu mà advance.js:31-36
//     (D6) đã lấy làm bài học: sổ chỉ-ghi thì vòng không đóng.
//     Chính lỗ hiển thị này làm hai lỗi khác không thể bị phát hiện: sau
//     `pp init --type=bugfix` (nay đã vá) hay khi feature gốc bị xoá, KHÔNG có
//     lệnh nào cho người dùng thấy pipeline họ đang chạy là loại gì và neo vào đâu.
//
// (2) `--from` chết sau init thì im lặng: xoá feature gốc TRƯỚC lần gate đầu →
//     gate exit 0, status/report không một dấu ⚠, `from` trỏ vào hư không mãi mãi.
//
// (3) Danh sách ứng viên khi `--from` sai in `_archive/old-widget`, nhưng gõ lại
//     y nguyên chuỗi đó → exit 2 "không hợp lệ" (44c1ecb ép qua FEATURE_NAME mà
//     không sửa thông báo của a3c194a). pp dặn một lệnh không chạy được, đúng
//     bài học plan.js:10-15.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeRoot, run } from './helpers.js'

function vớiFeatureCũ(rel = '_archive/old-widget') {
  const r0 = makeRoot()
  const d = join(r0, 'features', rel)
  mkdirSync(d, { recursive: true })
  writeFileSync(join(d, '10-prd.md'), '# PRD cũ\n')
  return { r0, oldDir: d }
}

test('status in loại pipeline (type) — không chỉ stage kế tiếp', () => {
  const r0 = makeRoot()
  assert.equal(run(['init', 'fix-500', '--type', 'bugfix', '--root', r0]).code, 0)
  const r = run(['status', 'fix-500', '--root', r0])
  assert.equal(r.code, 0)
  assert.match(r.out, /bugfix/)
})

test('status in feature gốc khi có --from', () => {
  const { r0 } = vớiFeatureCũ()
  assert.equal(run(['init', 'doi-widget', '--type', 'change', '--from', 'old-widget', '--root', r0]).code, 0)
  const r = run(['status', 'doi-widget', '--root', r0])
  assert.match(r.out, /old-widget/)
})

test('status CẢNH BÁO khi feature gốc đã biến mất', () => {
  const { r0, oldDir } = vớiFeatureCũ()
  assert.equal(run(['init', 'doi-widget', '--type', 'change', '--from', 'old-widget', '--root', r0]).code, 0)
  rmSync(oldDir, { recursive: true })
  const r = run(['status', 'doi-widget', '--root', r0])
  assert.match(r.out, /⚠|KHÔNG còn|biến mất|thiếu/i)
  assert.match(r.out, /old-widget/)
})

test('status KHÔNG cảnh báo khi feature gốc còn nguyên', () => {
  const { r0 } = vớiFeatureCũ()
  assert.equal(run(['init', 'doi-widget', '--type', 'change', '--from', 'old-widget', '--root', r0]).code, 0)
  const r = run(['status', 'doi-widget', '--root', r0])
  assert.doesNotMatch(r.out, /⚠/)
})

test('pipeline feature thường: status không in dòng feature gốc nào', () => {
  const r0 = makeRoot()
  assert.equal(run(['init', 'demo', '--size', 'S', '--root', r0]).code, 0)
  const r = run(['status', 'demo', '--root', r0])
  assert.doesNotMatch(r.out, /feature gốc/)
  assert.match(r.out, /feature/)
})

test('init ghi from_path đã resolve, không chỉ slug trần', () => {
  // `from: "old-widget"` một mình không phân biệt được features/ với _archive/
  // — mà spec §9 nói truy vết đi qua chính field đó.
  const { r0 } = vớiFeatureCũ()
  assert.equal(run(['init', 'doi-widget', '--type', 'change', '--from', 'old-widget', '--root', r0]).code, 0)
  const cfg = JSON.parse(readFileSync(join(r0, 'features/doi-widget/pipeline.json'), 'utf8'))
  assert.equal(cfg.from, 'old-widget')
  assert.equal(cfg.from_path, '../_archive/old-widget')
})

test('danh sách ứng viên chỉ in giá trị --from GÕ LẠI ĐƯỢC (không tiền tố _archive/)', () => {
  const { r0 } = vớiFeatureCũ()
  const r = run(['init', 'doi-x', '--type', 'change', '--from', 'khong-co', '--root', r0])
  assert.equal(r.code, 2)
  assert.match(r.out, /old-widget/)
  assert.doesNotMatch(r.out, /_archive\/old-widget/,
    'gõ lại "_archive/old-widget" sẽ bị FEATURE_NAME từ chối — không được gợi ý một lệnh không chạy được')
  // và giá trị được gợi ý phải chạy thật
  assert.equal(run(['init', 'doi-y', '--type', 'change', '--from', 'old-widget', '--root', r0]).code, 0)
})

test('ứng viên trong features/ và trong _archive/ đều được liệt kê', () => {
  const { r0 } = vớiFeatureCũ()
  mkdirSync(join(r0, 'features/dang-song'), { recursive: true })
  const r = run(['init', 'doi-z', '--type', 'change', '--from', 'khong-co', '--root', r0])
  assert.match(r.out, /dang-song/)
  assert.match(r.out, /old-widget/)
})
