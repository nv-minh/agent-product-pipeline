// FINDING (adversarial review 8c825c9..44c1ecb): `40-regression` dùng id RIÊNG
// (spec §4.3 — bộ check testplan gắn cứng traceability theo AC mà bugfix không
// có), nhưng vì thế nó không match nhánh nào trong registry và mất TRỌN bộ check
// của một test plan:
//
//   40-testplan    frontmatter, placeholders, headings, cited-paths,
//                  traceability, tc-schema, type-ratio, edge-cases
//   40-regression  frontmatter, placeholders, headings, cited-paths
//
// Nên test plan của một bugfix chỉ bị 4 check chung soi, và luật quan trọng
// nhất của nó — spec §4.3(3): "MỖI mục Unchanged trong 05-diagnosis.md có ít
// nhất 1 test truy vết về nó" — chỉ nằm trong rubric T2. Spec cũng nói thẳng
// "check đếm/truy vết dạng JS thêm sau nếu rubric T2 tỏ ra không đủ"; một
// artifact bỏ hẳn một mục Unchanged mà T1 vẫn xanh là bằng chứng nó không đủ.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { checksFor } from '../lib/registry.js'
import { makeRoot, run, frontmatter, verdictFile } from './helpers.js'

const REPO = new URL('../', import.meta.url).pathname

const DIAGNOSIS = frontmatter('05-diagnosis', '00-brief.md', 'fix-500') + `# Diagnosis — fix-500

## Tái hiện

1. Gửi multipart nội dung 2001 ký tự.
2. Quan sát: 500 thay vì 400.

Bằng chứng: log in "TypeError".

## Root cause

Validator độ dài chỉ gắn cho nhánh JSON.

## Giả thuyết đã loại

- Lỗi DB: loại — exception ném trước INSERT.

## Unchanged behavior

- Gửi feedback JSON hợp lệ tối đa 2000 ký tự vẫn trả 201 và lưu bản ghi.
- Nội dung rỗng vẫn trả 400 kèm tên trường còn thiếu.
`

const FIXPLAN = frontmatter('15-fixplan', '05-diagnosis.md', 'fix-500') + `# Fix plan — fix-500

## Phạm vi sửa

Module validate feedback, một file.

## Hướng sửa

Đưa validate lên trước mọi nhánh parse.

## Rollback

Revert một commit.
`

const REG = (phầnUnchanged) => frontmatter('40-regression', '05-diagnosis.md', 'fix-500') + `# Regression — fix-500

## Test tái hiện bug

- RT-1: gửi multipart 2001 ký tự, kỳ vọng 400 — trước fix phải ĐỎ.

## Test xác nhận fix

- RT-2: sau fix RT-1 xanh; thêm case thiếu field nội dung, kỳ vọng 400.

## Test bảo vệ unchanged

${phầnUnchanged}
`

function bugfixTới40(reg) {
  const r0 = makeRoot()
  assert.equal(run(['init', 'fix-500', '--type', 'bugfix', '--root', r0]).code, 0)
  const dir = join(r0, 'features/fix-500')
  writeFileSync(join(dir, '05-diagnosis.md'), DIAGNOSIS)
  assert.equal(run(['gate', 'fix-500', '05-diagnosis', '--root', r0]).code, 0)
  const v = verdictFile(r0, 'fix-500', '05-diagnosis', [])
  assert.equal(run(['review-record', 'fix-500', '05-diagnosis', '--verdict', v, '--root', r0]).code, 0)
  assert.equal(run(['approve', 'fix-500', '05-diagnosis', '--root', r0]).code, 0)
  writeFileSync(join(dir, '15-fixplan.md'), FIXPLAN)
  assert.equal(run(['gate', 'fix-500', '15-fixplan', '--root', r0]).code, 0)
  writeFileSync(join(dir, '40-regression.md'), reg)
  return { r0, dir }
}

test('40-regression có check truy vết Unchanged (không chỉ 4 check chung)', () => {
  const names = checksFor('40-regression', '/tmp', REPO).map((c) => c.name)
  assert.ok(names.includes('unchanged-traceability'),
    `bộ check hiện tại: ${names.join(', ')}`)
})

test('gate ĐỎ khi một mục Unchanged của diagnosis không có test nào phủ', () => {
  // Chỉ phủ mục thứ nhất; mục "Nội dung rỗng vẫn trả 400" bị bỏ.
  const { r0 } = bugfixTới40(REG('- RT-3 (Unchanged: JSON hợp lệ tối đa 2000 ký tự): vẫn trả 201 và lưu bản ghi.'))
  const g = run(['gate', 'fix-500', '40-regression', '--root', r0])
  assert.equal(g.code, 1, `output:\n${g.out}`)
  assert.match(g.out, /rỗng|không có test|không được test nào phủ/i)
})

test('gate XANH khi mọi mục Unchanged đều có test nhắc tới', () => {
  const { r0 } = bugfixTới40(REG(
    '- RT-3 (Unchanged: JSON hợp lệ tối đa 2000 ký tự): vẫn trả 201 và lưu bản ghi.\n' +
    '- RT-4 (Unchanged: nội dung rỗng vẫn trả 400 kèm tên trường còn thiếu): giữ nguyên.'))
  const g = run(['gate', 'fix-500', '40-regression', '--root', r0])
  assert.equal(g.code, 0, `output:\n${g.out}`)
})

test('diagnosis không đọc được thì check nói rõ, không xanh im lặng', () => {
  const r0 = makeRoot()
  assert.equal(run(['init', 'fix-x', '--type', 'bugfix', '--root', r0]).code, 0)
  const dir = join(r0, 'features/fix-x')
  // 40-regression tồn tại nhưng 05-diagnosis.md thì không (gõ thẳng gate).
  writeFileSync(join(dir, '40-regression.md'), REG('- RT-3: gì đó.').replace('fix-500', 'fix-x'))
  const check = checksFor('40-regression', dir, REPO).find((c) => c.name === 'unchanged-traceability')
  const r = check.run(REG('- RT-3: gì đó.'), { featureDir: dir })
  assert.equal(r.ok, false)
  assert.match(r.messages.join('\n'), /05-diagnosis/)
})

test('40-testplan (pipeline feature) KHÔNG bị thêm check này', () => {
  const names = checksFor('40-testplan', '/tmp', REPO).map((c) => c.name)
  assert.ok(!names.includes('unchanged-traceability'))
  // và vẫn giữ nguyên bộ check testplan cũ
  assert.ok(names.includes('traceability'))
})
