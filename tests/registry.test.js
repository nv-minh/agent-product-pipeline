// tests/registry.test.js
//
// FIX review cuối (finding 9a): lib/registry.js KHÔNG có test file nào. Đổi
// `if (stageId === '10-prd')` thành `'10-prdX'` — tức tước sạch EARS, ID,
// checklist rủi ro và kiểm questions khỏi cái gate quan trọng nhất hệ thống —
// vẫn qua toàn bộ 173 test cũ. Bộ test dưới đây khẳng định ĐÚNG TẬP tên check
// của từng stage, nên mọi thay đổi im lặng ở registry đều làm đỏ suite.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checksFor } from '../lib/registry.js'

const REPO = new URL('../', import.meta.url).pathname
const names = (stageId) => checksFor(stageId, mkdtempSync(join(tmpdir(), 'pp-reg-')), REPO).map((c) => c.name)

// B2/B3 thêm hai check vào danh sách này: `frontmatter` (luật chung §5.1, trước
// đây không có dòng code nào kiểm) và `edge-cases` (nối `edgeCaseChecklist` —
// 11 mục schema từng không ai đọc — vào một check thật).
const COMMON = ['frontmatter', 'placeholders', 'headings', 'cited-paths']

test('10-prd nhận đúng bộ check chung + bộ check PRD', () => {
  assert.deepEqual(names('10-prd'), [...COMMON, 'ears', 'ids', 'risk-checklist', 'questions'])
})

test('40-testplan nhận đúng bộ check chung + bộ check testplan', () => {
  assert.deepEqual(names('40-testplan'), [...COMMON, 'traceability', 'tc-schema', 'type-ratio', 'edge-cases'])
})

test('stage không có schema/bộ check riêng chỉ nhận bộ check chung', () => {
  assert.deepEqual(names('70-ops'), COMMON)
  assert.deepEqual(names('stage-la-hoac-go-sai'), COMMON)
})

// schema/<stage>.json phải THỰC SỰ được nạp vào check, không chỉ được đọc rồi bỏ.
test('check headings của 10-prd dùng requiredHeadings trong schema/10-prd.json', () => {
  const headings = checksFor('10-prd', mkdtempSync(join(tmpdir(), 'pp-reg-')), REPO).find((c) => c.name === 'headings')
  const r = headings.run('')
  assert.equal(r.ok, false)
  assert.match(r.messages.join('\n'), /## User stories/)
  assert.match(r.messages.join('\n'), /## Out of scope/)
  assert.match(r.messages.join('\n'), /## Rủi ro/)
})

test('check risk-checklist của 10-prd dùng riskChecklist trong schema/10-prd.json', () => {
  const risk = checksFor('10-prd', mkdtempSync(join(tmpdir(), 'pp-reg-')), REPO).find((c) => c.name === 'risk-checklist')
  const r = risk.run('# PRD rỗng')
  assert.equal(r.ok, false)
  // Heading chưa có → một dòng gộp nêu đúng SỐ mục trong schema (8), chứng tỏ
  // checklist đi từ schema vào check; từng mục chỉ được nêu tên khi heading đã có.
  assert.match(r.messages.join('\n'), /không tìm thấy heading "## Rủi ro"/)
  assert.match(r.messages.join('\n'), /8 mục rủi ro chưa kiểm được/)
})

// B3: `edgeCaseChecklist` phải thực sự đi từ schema vào check — đây chính là
// điều nó KHÔNG làm trước bản vá (11 mục nằm trong schema, 0 chỗ đọc).
test('check edge-cases của 40-testplan dùng edgeCaseChecklist trong schema/40-testplan.json', () => {
  const edge = checksFor('40-testplan', mkdtempSync(join(tmpdir(), 'pp-reg-')), REPO).find((c) => c.name === 'edge-cases')
  const r = edge.run('## Test cases\n')
  assert.equal(r.ok, false)
  assert.match(r.messages.join('\n'), /không tìm thấy heading "## Edge cases"/)
  assert.match(r.messages.join('\n'), /11 mục edge case chưa kiểm được/)
})

// B2: hai giá trị đối chiếu phải lấy từ dữ kiện `pp` biết chắc — tên thư mục
// feature và id stage đang gate — chứ không phải từ chính artifact.
test('check frontmatter đối chiếu feature theo TÊN THƯ MỤC và stage theo stage đang gate', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'pp-reg-')), 'features', 'thanh-toan')
  const fm = checksFor('10-prd', dir, REPO).find((c) => c.name === 'frontmatter')

  const ok = fm.run('---\nfeature: thanh-toan\nstage: 10-prd\nupdated: 2026-08-20\nsource: 00-brief.md\n---\n')
  assert.equal(ok.ok, true, ok.messages.join('\n'))

  const wrong = fm.run('---\nfeature: demo\nstage: 20-ux\nupdated: hôm qua\nsource: 00-brief.md\n---\n')
  assert.equal(wrong.ok, false)
  assert.match(wrong.messages.join('\n'), /feature: "demo" không khớp "thanh-toan"/)
  assert.match(wrong.messages.join('\n'), /stage: "20-ux" không khớp "10-prd"/)
  assert.match(wrong.messages.join('\n'), /updated: "hôm qua" không phải ngày/)
})

test('stage không có schema thì headings không đòi gì (không throw)', () => {
  const headings = checksFor('70-ops', mkdtempSync(join(tmpdir(), 'pp-reg-')), REPO).find((c) => c.name === 'headings')
  assert.equal(headings.run('').ok, true)
})
