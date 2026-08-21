// Task 2 (pp-bugfix/pp-change): stage có field "schema" trong pipeline.json
// phải được gate VÀ advance đọc schema/<override>.json — cùng một nguồn, nếu
// không chỉ thị và gate sẽ nói khác nhau (đúng cái bẫy comment đầu advance.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checksFor } from '../lib/registry.js'

const REPO = new URL('../', import.meta.url).pathname
const tmp = () => mkdtempSync(join(tmpdir(), 'pp-reg-ov-'))

test('checksFor không truyền schemaName → hành vi cũ (schema/10-prd.json, không có Delta)', () => {
  const headings = checksFor('10-prd', tmp(), REPO).find((c) => c.name === 'headings')
  const r = headings.run('')
  assert.equal(r.ok, false)
  assert.match(r.messages.join('\n'), /## User stories/)
  assert.doesNotMatch(r.messages.join('\n'), /## Delta/)
})

test('checksFor với schemaName "10-prd.change" nạp schema override và VẪN giữ bộ check PRD', () => {
  const checks = checksFor('10-prd', tmp(), REPO, undefined, '10-prd.change')
  // Giữ nguyên bộ check theo STAGE ID: ears/ids/risk-checklist/questions không
  // mất. `delta-checklist` là check RIÊNG của pipeline change — nó chỉ xuất
  // hiện khi schema khai `deltaChecklist` (spec §5.2: marker ADDED/MODIFIED/
  // REMOVED phải được thi hành, không chỉ có mặt cái heading).
  assert.deepEqual(checks.map((c) => c.name),
    ['frontmatter', 'placeholders', 'headings', 'cited-paths', 'ears', 'ids', 'risk-checklist', 'questions', 'delta-checklist'])
  const r = checks.find((c) => c.name === 'headings').run('')
  assert.match(r.messages.join('\n'), /## Delta/)
})

// Chống trôi dạt hai file: schema change phải là SUPERSET của schema gốc
// (spec §5.2 — thêm Delta, không bớt gì).
test('10-prd.change.json là superset heading + giữ nguyên riskChecklist/minQuestions/clearQuestionsMax của 10-prd.json', () => {
  const base = JSON.parse(readFileSync(join(REPO, 'schema/10-prd.json'), 'utf8'))
  const change = JSON.parse(readFileSync(join(REPO, 'schema/10-prd.change.json'), 'utf8'))
  for (const h of base.requiredHeadings) {
    assert.ok(change.requiredHeadings.includes(h), `10-prd.change.json thiếu heading gốc "${h}"`)
  }
  assert.deepEqual(change.riskChecklist, base.riskChecklist)
  assert.equal(change.minQuestions, base.minQuestions)
  assert.equal(change.clearQuestionsMax, base.clearQuestionsMax)
})
