// Task 6 (pp-bugfix/pp-change): pipeline bugfix chạy trọn trên bộ máy sẵn có —
// gate/human/state không sửa dòng nào, chỉ template + schema + rubric mới.
// Fixture tự thoả T1 (frontmatter đúng, không placeholder, không cite path chết).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeRoot, run, frontmatter, verdictFile } from './helpers.js'

const DIAGNOSIS = frontmatter('05-diagnosis', '00-brief.md', 'fix-500') + `# Diagnosis — fix-500

## Tái hiện

1. Đăng nhập bằng tài khoản nhân viên, mở form feedback.
2. Gửi request multipart với nội dung dài 2001 ký tự.
3. Quan sát: server trả 500 thay vì 400.

Bằng chứng: response body chứa "Internal Server Error"; log server in
"TypeError: Cannot read properties of undefined (reading 'length')".

## Root cause

Handler tạo feedback không kiểm null trước khi đọc độ dài nội dung: validator
độ dài chỉ được gắn cho nhánh JSON, không gắn cho nhánh multipart, nên ở nhánh
multipart biến content là undefined và lời gọi đọc length ném TypeError.

## Giả thuyết đã loại

- Lỗi tầng DB (constraint): loại — log cho thấy exception ném TRƯỚC câu INSERT.
- Client gửi sai content-type: loại — tái hiện được bằng curl với request hợp lệ.

## Unchanged behavior

- Gửi feedback JSON hợp lệ tối đa 2000 ký tự vẫn trả 201 và lưu bản ghi.
- Nội dung rỗng vẫn trả 400 kèm tên trường còn thiếu.
`

const FIXPLAN = frontmatter('15-fixplan', '05-diagnosis.md', 'fix-500') + `# Fix plan — fix-500

## Phạm vi sửa

Module validate feedback phía backend — gắn validator cho nhánh multipart,
một file, ước chừng 15 dòng thay đổi.

## Hướng sửa

Một root cause, một fix: đưa bước validate nội dung (null + độ dài) lên trước
mọi nhánh parse, để JSON lẫn multipart đi qua cùng một kiểm tra.

## Rollback

Revert một commit; không có migration dữ liệu, không đổi contract API.
`

const REGRESSION = frontmatter('40-regression', '05-diagnosis.md', 'fix-500') + `# Regression — fix-500

## Test tái hiện bug

- RT-1: gửi multipart nội dung 2001 ký tự, kỳ vọng 400 — trước fix test này
  phải ĐỎ (hệ đang trả 500), đó là bằng chứng bug tồn tại.

## Test xác nhận fix

- RT-2: sau fix, RT-1 chạy lại phải xanh; thêm case multipart không có field
  nội dung, kỳ vọng 400 kèm tên trường còn thiếu.

## Test bảo vệ unchanged

- RT-3 (Unchanged: JSON hợp lệ tối đa 2000 ký tự): vẫn trả 201 và lưu bản ghi.
- RT-4 (Unchanged: nội dung rỗng): vẫn trả 400 kèm tên trường còn thiếu.
`

function initBugfix() {
  const r0 = makeRoot()
  assert.equal(run(['init', 'fix-500', '--type', 'bugfix', '--root', r0]).code, 0)
  return { r0, dir: join(r0, 'features/fix-500') }
}

test('advance sau init trỏ 05-diagnosis, nêu heading từ schema + ranh giới workspace', () => {
  const { r0 } = initBugfix()
  const r = run(['advance', 'fix-500', '--root', r0])
  assert.equal(r.code, 0)
  assert.match(r.out, /CHỈ THỊ CHO STAGE 05-diagnosis/)
  assert.match(r.out, /## Tái hiện · ## Root cause · ## Giả thuyết đã loại · ## Unchanged behavior/)
  assert.match(r.out, /Được đọc thêm : \S+ \(code repo — CHỈ ĐỌC/)
})

test('gate 05-diagnosis đỏ khi thiếu heading Tái hiện, xanh khi đủ', () => {
  const { r0, dir } = initBugfix()
  writeFileSync(join(dir, '05-diagnosis.md'), DIAGNOSIS.replace('## Tái hiện', '## Tai hien sai'))
  const bad = run(['gate', 'fix-500', '05-diagnosis', '--root', r0])
  assert.equal(bad.code, 1)
  assert.match(bad.out, /thiếu heading bắt buộc "## Tái hiện"/)
  writeFileSync(join(dir, '05-diagnosis.md'), DIAGNOSIS)
  const good = run(['gate', 'fix-500', '05-diagnosis', '--root', r0])
  assert.equal(good.code, 0, good.out)
  assert.match(good.out, /còn thiếu tier: t2/)
})

test('e2e đường xanh: diagnosis → human gate → fixplan (t1-only done ngay) → regression → complete', () => {
  const { r0, dir } = initBugfix()
  // 05-diagnosis: T1 + T2 + chữ ký người
  writeFileSync(join(dir, '05-diagnosis.md'), DIAGNOSIS)
  assert.equal(run(['gate', 'fix-500', '05-diagnosis', '--root', r0]).code, 0)
  const v = verdictFile(r0, 'fix-500', '05-diagnosis', [])
  assert.equal(run(['review-record', 'fix-500', '05-diagnosis', '--verdict', v, '--root', r0]).code, 0)
  // human: true → advance phải DỪNG chờ người, không nhảy sang 15-fixplan
  const wait = run(['advance', 'fix-500', '--root', r0])
  assert.match(wait.out, /🚦 05-diagnosis/)
  // gõ thẳng gate 15-fixplan để đi vòng → bị từ chối (thứ tự là luật trong code)
  writeFileSync(join(dir, '15-fixplan.md'), FIXPLAN)
  assert.equal(run(['gate', 'fix-500', '15-fixplan', '--root', r0]).code, 1)
  assert.equal(run(['approve', 'fix-500', '05-diagnosis', '--root', r0]).code, 0)
  // 15-fixplan: gate ["t1"] → T1 xanh là done luôn, không đòi T2
  const fp = run(['gate', 'fix-500', '15-fixplan', '--root', r0])
  assert.equal(fp.code, 0, fp.out)
  assert.match(fp.out, /✓ 15-fixplan: done/)
  // 40-regression: T1 + T2
  writeFileSync(join(dir, '40-regression.md'), REGRESSION)
  assert.equal(run(['gate', 'fix-500', '40-regression', '--root', r0]).code, 0)
  const v2 = verdictFile(r0, 'fix-500', '40-regression', [])
  const rr = run(['review-record', 'fix-500', '40-regression', '--verdict', v2, '--root', r0])
  assert.equal(rr.code, 0, rr.out)
  assert.match(rr.out, /✓ 40-regression: done/)
  const done = run(['advance', 'fix-500', '--root', r0])
  assert.match(done.out, /✓ fix-500: mọi stage đã xong/)
})
