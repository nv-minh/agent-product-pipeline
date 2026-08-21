// Task 7 (pp-bugfix/pp-change): pipeline change — impact 2 chế độ (đối chiếu
// artifact cũ qua --from / brownfield đọc code), PRD delta qua schema override,
// 40-testplan dùng lại nguyên trạng (0 dòng code mới cho stage đó).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeRoot, run, frontmatter, forFeature, verdictFile, PRD, QUESTIONS, TESTPLAN } from './helpers.js'

const IMPACT = (feature) => frontmatter('05-impact', '00-brief.md', feature) + `# Impact — ${feature}

## Hiện trạng

Nguồn: đọc từ code hiện trạng (không có feature gốc trong features/).
Form feedback hiện chỉ nhận nội dung văn bản tối đa 2000 ký tự, mỗi lần gửi
lưu một bản ghi, danh sách chỉ admin xem được.

## Thành phần bị ảnh hưởng

- Endpoint tạo feedback: thêm field ảnh đính kèm tuỳ chọn.
- Form phía client: thêm nút chọn ảnh.
- Bảng dữ liệu: thêm một cột nullable, không đổi cột hiện có.

## Backward compatibility

Client cũ không gửi field mới vẫn hợp lệ — field là tuỳ chọn, server mặc định
null. Chưa có consumer nào đọc field này trước khi client mới phát hành.

## Rủi ro & lối đi

Chọn chỉnh trực tiếp (không rollback, không re-scope): thay đổi nhỏ, một cột
nullable là đủ; đường lùi là gỡ nút khỏi form, dữ liệu đã lưu không cản gì.
`

// PRD delta = fixture PRD sạch (đã qua mọi check PRD) + section Delta mà
// schema/10-prd.change.json đòi. Chèn TRƯỚC Out of scope.
const DELTA_SECTION = `## Delta

- ADDED: cho phép đính kèm một ảnh khi gửi feedback (mở rộng US-1; hành vi khi không có ảnh giữ nguyên AC-1-1).
- MODIFIED: form gửi feedback thêm nút chọn ảnh — luồng nội dung văn bản không đổi.
- REMOVED: không có.

`
const PRD_DELTA = (feature) => forFeature(PRD, feature).replace('## Out of scope', `${DELTA_SECTION}## Out of scope`)

function completeImpact(r0, feature) {
  const dir = join(r0, 'features', feature)
  writeFileSync(join(dir, '05-impact.md'), IMPACT(feature))
  assert.equal(run(['gate', feature, '05-impact', '--root', r0]).code, 0)
  const v = verdictFile(r0, feature, '05-impact', [])
  assert.equal(run(['review-record', feature, '05-impact', '--verdict', v, '--root', r0]).code, 0)
}

test('advance sau init trỏ 05-impact với heading schema + ranh giới workspace', () => {
  const r0 = makeRoot()
  assert.equal(run(['init', 'doi-form', '--type', 'change', '--root', r0]).code, 0)
  const r = run(['advance', 'doi-form', '--root', r0])
  assert.match(r.out, /CHỈ THỊ CHO STAGE 05-impact/)
  assert.match(r.out, /## Hiện trạng · ## Thành phần bị ảnh hưởng · ## Backward compatibility · ## Rủi ro & lối đi/)
  assert.match(r.out, /Được đọc thêm : \S+ \(code repo — CHỈ ĐỌC/)
})

test('10-prd của change ĐÒI ## Delta (schema override), pipeline feature thường thì KHÔNG', () => {
  const r0 = makeRoot()
  // change: thiếu Delta → đỏ đích danh
  assert.equal(run(['init', 'doi-form', '--type', 'change', '--root', r0]).code, 0)
  const dir = join(r0, 'features/doi-form')
  completeImpact(r0, 'doi-form')
  writeFileSync(join(dir, '10-questions.md'), QUESTIONS)
  writeFileSync(join(dir, '10-prd.md'), forFeature(PRD, 'doi-form'))
  const bad = run(['gate', 'doi-form', '10-prd', '--root', r0])
  assert.equal(bad.code, 1)
  assert.match(bad.out, /thiếu heading bắt buộc "## Delta"/)
  // chỉ thị advance cũng phải NÓI TRƯỚC luật đó (cùng nguồn schema với gate)
  const adv = run(['advance', 'doi-form', '--root', r0])
  assert.match(adv.out, /## Delta/)
  // có Delta → xanh
  writeFileSync(join(dir, '10-prd.md'), PRD_DELTA('doi-form'))
  const good = run(['gate', 'doi-form', '10-prd', '--root', r0])
  assert.equal(good.code, 0, good.out)
  // feature thường: KHÔNG đòi Delta (schema gốc còn nguyên)
  const r1 = makeRoot()
  assert.equal(run(['init', 'demo', '--size', 'S', '--root', r1]).code, 0)
  const d1 = join(r1, 'features/demo')
  writeFileSync(join(d1, '10-questions.md'), QUESTIONS)
  writeFileSync(join(d1, '10-prd.md'), PRD)
  assert.equal(run(['gate', 'demo', '10-prd', '--root', r1]).code, 0)
})

test('e2e change brownfield (không --from): impact → prd delta → human → testplan → complete', () => {
  const r0 = makeRoot()
  assert.equal(run(['init', 'doi-form', '--type', 'change', '--root', r0]).code, 0)
  const dir = join(r0, 'features/doi-form')
  completeImpact(r0, 'doi-form')
  writeFileSync(join(dir, '10-questions.md'), QUESTIONS)
  writeFileSync(join(dir, '10-prd.md'), PRD_DELTA('doi-form'))
  assert.equal(run(['gate', 'doi-form', '10-prd', '--root', r0]).code, 0)
  const v = verdictFile(r0, 'doi-form', '10-prd', [])
  assert.equal(run(['review-record', 'doi-form', '10-prd', '--verdict', v, '--root', r0]).code, 0)
  assert.match(run(['advance', 'doi-form', '--root', r0]).out, /🚦 10-prd/)
  assert.equal(run(['approve', 'doi-form', '10-prd', '--root', r0]).code, 0)
  // 40-testplan dùng lại nguyên trạng — fixture TESTPLAN cũ khớp luôn vì PRD
  // delta giữ nguyên AC-1-1/AC-1-2
  writeFileSync(join(dir, '40-testplan.md'), forFeature(TESTPLAN, 'doi-form'))
  assert.equal(run(['gate', 'doi-form', '40-testplan', '--root', r0]).code, 0)
  const v2 = verdictFile(r0, 'doi-form', '40-testplan', [])
  assert.equal(run(['review-record', 'doi-form', '40-testplan', '--verdict', v2, '--root', r0]).code, 0)
  assert.match(run(['advance', 'doi-form', '--root', r0]).out, /✓ doi-form: mọi stage đã xong/)
})

test('chế độ --from: sửa artifact cũ trong _archive làm 05-impact stale — bằng chứng nó nằm trong inputs_hash', () => {
  const r0 = makeRoot()
  const oldDir = join(r0, 'features/_archive/old-widget')
  mkdirSync(oldDir, { recursive: true })
  writeFileSync(join(oldDir, '10-prd.md'), '# PRD cũ của old-widget\n')
  assert.equal(run(['init', 'doi-widget', '--type', 'change', '--from', 'old-widget', '--root', r0]).code, 0)
  const dir = join(r0, 'features/doi-widget')
  writeFileSync(join(dir, '05-impact.md'),
    IMPACT('doi-widget').replace('Nguồn: đọc từ code hiện trạng (không có feature gốc trong features/).',
      'Nguồn: PRD của feature gốc old-widget (init --from), đối chiếu thêm code hiện trạng.'))
  assert.equal(run(['gate', 'doi-widget', '05-impact', '--root', r0]).code, 0)
  const v = verdictFile(r0, 'doi-widget', '05-impact', [])
  assert.equal(run(['review-record', 'doi-widget', '05-impact', '--verdict', v, '--root', r0]).code, 0)
  // negative control: 05-impact vừa done + còn tươi → advance đã trỏ sang stage
  // kế (10-prd), KHÔNG đòi regate 05-impact.
  const before = run(['advance', 'doi-widget', '--root', r0])
  assert.match(before.out, /CHỈ THỊ CHO STAGE 10-prd/)
  // Sửa CHÍNH artifact cũ trong _archive — input được --from tiêm vào (hậu tố
  // `?` optional trong pipeline.json, nhưng file này CÓ tồn tại nên không bị
  // hashInputs bỏ qua). Nếu nó thật sự nằm trong inputs_hash của 05-impact,
  // stage phải hoá stale và advance phải quay lại đòi regate đúng stage đó.
  appendFileSync(join(oldDir, '10-prd.md'), '\nBản cũ vừa bị sửa sau khi đã archive.\n')
  const after = run(['advance', 'doi-widget', '--root', r0])
  assert.match(after.out, /CHỈ THỊ CHO STAGE 05-impact/)
  assert.match(after.out, /regate/)
  assert.match(after.out, /input thượng nguồn đã đổi/)
})
