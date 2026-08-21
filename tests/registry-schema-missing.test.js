// FINDING (adversarial review 8c825c9..44c1ecb): `loadSchema` trả `{}` khi file
// không tồn tại. Đúng khi tên schema SUY RA từ stage id (một stage chưa có
// schema thì hợp lý là không có luật thêm). SAI khi stage KHAI TƯỜNG MINH
// `"schema": "..."`: một typo (`10-prd.chnage`), viết tên file thay tên
// (`10-prd.change.json` → nối thành `.json.json`), hay product-repo scaffold
// bằng bản pp cũ chưa có file schema mới — tất cả cho gate chạy với schema rỗng:
// requiredHeadings `[]` (mọi heading bốc hơi, kể cả `## Delta` là lý do override
// tồn tại) và riskChecklist undefined → checkSectionChecklist với items=[] trả
// ok:true (8 mục rủi ro bốc hơi). Gate in XANH, không một dòng cảnh báo.
//
// Trái thẳng Điều 2 và triết lý "không fallback" mà init.js:47-49 áp cho --type.
// Luật mới: override tường minh không resolve được → gate ĐỎ đích danh.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checksFor } from '../lib/registry.js'
import { makeRoot, run, frontmatter, verdictFile, QUESTIONS } from './helpers.js'

const REPO = new URL('../', import.meta.url).pathname
const tmp = () => mkdtempSync(join(tmpdir(), 'pp-schema-miss-'))

test('schema NGẦM ĐỊNH (theo stage id) thiếu file → vẫn nhận bộ check chung, không throw', () => {
  // Hành vi cũ phải giữ: stage lạ không có schema/<id>.json vẫn gate được.
  const checks = checksFor('stage-la-khong-co-schema', tmp(), REPO)
  assert.ok(checks.length > 0)
  assert.equal(checks.find((c) => c.name === 'headings').run('bất kỳ').ok, true)
})

test('schema TƯỜNG MINH thiếu file → check đỏ đích danh, nêu tên schema và stage', () => {
  const checks = checksFor('10-prd', tmp(), REPO, undefined, '10-prd.chnage')
  const bad = checks.find((c) => c.name === 'schema-ref')
  assert.ok(bad, `phải có check "schema-ref"; có: ${checks.map((c) => c.name).join(', ')}`)
  const r = bad.run('nội dung gì cũng vậy')
  assert.equal(r.ok, false)
  const msg = r.messages.join('\n')
  assert.match(msg, /10-prd\.chnage/)
  assert.match(msg, /không tồn tại|thiếu/i)
})

test('schema TƯỜNG MINH có file → không có check schema-ref nào (không nhiễu đường xanh)', () => {
  const checks = checksFor('10-prd', tmp(), REPO, undefined, '10-prd.change')
  assert.equal(checks.find((c) => c.name === 'schema-ref'), undefined)
  assert.match(checks.find((c) => c.name === 'headings').run('').messages.join('\n'), /## Delta/)
})

test('gate đỏ (không XANH) khi pipeline.json khai schema không tồn tại', () => {
  const r0 = makeRoot()
  assert.equal(run(['init', 'doi-form', '--type', 'change', '--root', r0]).code, 0)
  const dir = join(r0, 'features/doi-form')
  // hoàn thành 05-impact để tới được 10-prd
  const IMPACT = frontmatter('05-impact', '00-brief.md', 'doi-form') + `# Impact — doi-form

## Hiện trạng

Nguồn: đọc từ code hiện trạng.

## Thành phần bị ảnh hưởng

- Endpoint tạo feedback.

## Backward compatibility

Client cũ vẫn hợp lệ vì field mới là tuỳ chọn.

## Rủi ro & lối đi

Chọn chỉnh trực tiếp: thay đổi nhỏ.
`
  writeFileSync(join(dir, '05-impact.md'), IMPACT)
  assert.equal(run(['gate', 'doi-form', '05-impact', '--root', r0]).code, 0)
  const v = verdictFile(r0, 'doi-form', '05-impact', [])
  assert.equal(run(['review-record', 'doi-form', '05-impact', '--verdict', v, '--root', r0]).code, 0)

  // Đổi schema override thành tên không tồn tại (người dùng được phép sửa
  // pipeline.json — guard chỉ chặn agent).
  const p = join(dir, 'pipeline.json')
  const cfg = JSON.parse(readFileSync(p, 'utf8'))
  cfg.stages['10-prd'].schema = 'khong-ton-tai'
  writeFileSync(p, JSON.stringify(cfg, null, 2))

  // PRD trống rỗng nhất có thể: trước bản vá, gate trả exit 0 với artifact này.
  writeFileSync(join(dir, '10-questions.md'), QUESTIONS)
  writeFileSync(join(dir, '10-prd.md'), frontmatter('10-prd', '00-brief.md', 'doi-form') + '# PRD\n')
  const g = run(['gate', 'doi-form', '10-prd', '--root', r0])
  assert.equal(g.code, 1, `gate phải ĐỎ khi schema override không tồn tại, output:\n${g.out}`)
  assert.match(g.out, /khong-ton-tai/)
})

test('schema override JSON HỎNG → gate exit 2 (lỗi cấu hình), không phải exit 1 (gate đỏ)', () => {
  // exit 1 là mã "artifact sai" — conductor sẽ bắt agent viết lại artifact
  // trong khi lỗi nằm ở bản cài. Phân biệt hai thứ đó là cả điểm của B4.
  const r0 = makeRoot()
  assert.equal(run(['init', 'doi-x', '--type', 'change', '--root', r0]).code, 0)
  writeFileSync(join(r0, 'schema/05-impact.json'), '{ hỏng json')
  const dir = join(r0, 'features/doi-x')
  writeFileSync(join(dir, '05-impact.md'), frontmatter('05-impact', '00-brief.md', 'doi-x') + '# Impact\n')
  const g = run(['gate', 'doi-x', '05-impact', '--root', r0])
  assert.equal(g.code, 2, `output:\n${g.out}`)
  assert.match(g.out, /05-impact\.json/)
  assert.match(g.out, /JSON/)
  assert.ok(!existsSync(join(dir, '.evidence')), 'gate lỗi cấu hình thì chưa hề chạy: không được để lại evidence')
})

test('advance CẢNH BÁO khi schema không đọc được, thay vì im lặng bỏ dòng Heading', () => {
  const r0 = makeRoot()
  assert.equal(run(['init', 'doi-y', '--type', 'change', '--root', r0]).code, 0)
  writeFileSync(join(r0, 'schema/05-impact.json'), '{ hỏng json')
  const a = run(['advance', 'doi-y', '--root', r0])
  assert.match(a.out, /schema.*05-impact\.json.*(không đọc được|hỏng)/i)
})
