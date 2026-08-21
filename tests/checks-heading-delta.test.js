// FINDING (adversarial review 8c825c9..44c1ecb):
//
// (1) `checkHeadings` dùng `text.includes(h)` — không neo dòng, không strip code
//     fence, không phân biệt cấp heading. Nên `### Delta` (h3) đi qua vì
//     "### Delta".includes("## Delta"), một `## Delta` trong khối ``` đi qua, và
//     cả câu văn xuôi "phần ## Delta sẽ viết sau" cũng đi qua. Cùng lỗ cho MỌI
//     heading bắt buộc của mọi stage, không riêng Delta.
//
// (2) `## Delta` là heading duy nhất trong 10-prd.change.json không có gì đứng
//     sau nó: `## Rủi ro` có checkRiskChecklist + rubric #4, `## Out of scope`
//     có rubric #2, còn Delta thì T1 chỉ kiểm chuỗi có mặt và rubric/10-prd.md
//     không có một chữ nào về nó (grep "Delta|ADDED" → 0). Spec §5.2 đòi mỗi
//     thay đổi đánh dấu ADDED/MODIFIED/REMOVED — không tier nào kiểm điều đó,
//     nên một PRD viết lại toàn bộ với `## Delta` rỗng qua cả T1 lẫn T2.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkHeadings } from '../lib/checks/common.js'
import { makeRoot, run, frontmatter, forFeature, verdictFile, PRD, QUESTIONS } from './helpers.js'

test('heading h3 KHÔNG được tính là h2 bắt buộc', () => {
  const r = checkHeadings('### Delta\nnội dung\n', ['## Delta'], 'x.md')
  assert.equal(r.ok, false, '"### Delta".includes("## Delta") là true — phải neo theo dòng')
})

test('heading trong khối code KHÔNG được tính', () => {
  const r = checkHeadings('```\n## Delta\n```\n', ['## Delta'], 'x.md')
  assert.equal(r.ok, false)
})

test('heading nhắc trong văn xuôi KHÔNG được tính', () => {
  const r = checkHeadings('phần ## Delta sẽ viết sau\n', ['## Delta'], 'x.md')
  assert.equal(r.ok, false)
})

test('heading thật (đầu dòng, đúng cấp) vẫn được tính — kể cả có khoảng trắng cuối', () => {
  assert.equal(checkHeadings('## Delta\nnội dung\n', ['## Delta'], 'x.md').ok, true)
  assert.equal(checkHeadings('## Delta   \nnội dung\n', ['## Delta'], 'x.md').ok, true)
})

test('heading sâu hơn nhưng ĐÚNG tiền tố vẫn phải là chính nó, không phải h2 khác', () => {
  // "## Rủi ro & lối đi" không thoả yêu cầu "## Rủi ro" — hai heading khác nhau.
  const r = checkHeadings('## Rủi ro & lối đi\n', ['## Rủi ro'], 'x.md')
  assert.equal(r.ok, false)
})

// ── Delta phải được kiểm thực chất ở T1 ──────────────────────────────────────
const IMPACT = (f) => frontmatter('05-impact', '00-brief.md', f) + `# Impact — ${f}

## Hiện trạng

Nguồn: đọc từ code hiện trạng.

## Thành phần bị ảnh hưởng

- Endpoint tạo feedback.

## Backward compatibility

Client cũ vẫn hợp lệ vì field mới là tuỳ chọn.

## Rủi ro & lối đi

Chọn chỉnh trực tiếp: thay đổi nhỏ.
`

function changeTới10Prd(feature = 'doi-form') {
  const r0 = makeRoot()
  assert.equal(run(['init', feature, '--type', 'change', '--root', r0]).code, 0)
  const dir = join(r0, 'features', feature)
  writeFileSync(join(dir, '05-impact.md'), IMPACT(feature))
  assert.equal(run(['gate', feature, '05-impact', '--root', r0]).code, 0)
  const v = verdictFile(r0, feature, '05-impact', [])
  assert.equal(run(['review-record', feature, '05-impact', '--verdict', v, '--root', r0]).code, 0)
  writeFileSync(join(dir, '10-questions.md'), QUESTIONS)
  return { r0, dir, feature }
}

const withDelta = (feature, deltaBody) =>
  forFeature(PRD, feature).replace('## Out of scope', `## Delta\n\n${deltaBody}\n\n## Out of scope`)

test('gate ĐỎ khi ## Delta rỗng (không có ADDED/MODIFIED/REMOVED nào)', () => {
  const { r0, dir, feature } = changeTới10Prd()
  writeFileSync(join(dir, '10-prd.md'), withDelta(feature, '(chưa có gì)'))
  const g = run(['gate', feature, '10-prd', '--root', r0])
  assert.equal(g.code, 1, `output:\n${g.out}`)
  assert.match(g.out, /ADDED/)
})

test('gate ĐỎ khi thiếu một trong ba marker (chỉ có ADDED)', () => {
  const { r0, dir, feature } = changeTới10Prd()
  writeFileSync(join(dir, '10-prd.md'), withDelta(feature, '- ADDED: cho phép đính kèm ảnh.'))
  const g = run(['gate', feature, '10-prd', '--root', r0])
  assert.equal(g.code, 1)
  assert.match(g.out, /MODIFIED|REMOVED/)
})

test('gate XANH khi cả ba marker có kết luận (kể cả "không có")', () => {
  const { r0, dir, feature } = changeTới10Prd()
  writeFileSync(join(dir, '10-prd.md'), withDelta(feature,
    '- ADDED: cho phép đính kèm một ảnh khi gửi feedback (mở rộng US-1).\n' +
    '- MODIFIED: form thêm nút chọn ảnh — luồng văn bản không đổi.\n' +
    '- REMOVED: không có.'))
  const g = run(['gate', feature, '10-prd', '--root', r0])
  assert.equal(g.code, 0, `output:\n${g.out}`)
})

test('marker bỏ trống (ADDED:) bị bắt như mục rủi ro bỏ trống', () => {
  const { r0, dir, feature } = changeTới10Prd()
  writeFileSync(join(dir, '10-prd.md'), withDelta(feature,
    '- ADDED:\n- MODIFIED: form thêm nút.\n- REMOVED: không có.'))
  const g = run(['gate', feature, '10-prd', '--root', r0])
  assert.equal(g.code, 1)
  assert.match(g.out, /ADDED.*bỏ trống/)
})

test('pipeline feature thường KHÔNG bị đòi marker delta', () => {
  const r0 = makeRoot()
  assert.equal(run(['init', 'demo', '--size', 'S', '--root', r0]).code, 0)
  const d = join(r0, 'features/demo')
  writeFileSync(join(d, '10-questions.md'), QUESTIONS)
  writeFileSync(join(d, '10-prd.md'), PRD)
  assert.equal(run(['gate', 'demo', '10-prd', '--root', r0]).code, 0)
})

test('rubric 10-prd có tiêu chí chấm Delta (T2 không mù về nó)', () => {
  const rubric = readFileSync(new URL('../rubric/10-prd.md', import.meta.url), 'utf8')
  assert.match(rubric, /Delta/)
  assert.match(rubric, /ADDED|MODIFIED|REMOVED/)
})
