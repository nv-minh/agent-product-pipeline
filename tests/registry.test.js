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

test('10-prd nhận đúng bộ check chung + bộ check PRD', () => {
  assert.deepEqual(names('10-prd'), [
    'placeholders', 'headings', 'cited-paths', 'ears', 'ids', 'risk-checklist', 'questions',
  ])
})

test('40-testplan nhận đúng bộ check chung + bộ check testplan', () => {
  assert.deepEqual(names('40-testplan'), [
    'placeholders', 'headings', 'cited-paths', 'traceability', 'tc-schema', 'type-ratio',
  ])
})

test('stage không có schema/bộ check riêng chỉ nhận bộ check chung', () => {
  assert.deepEqual(names('70-ops'), ['placeholders', 'headings', 'cited-paths'])
  assert.deepEqual(names('stage-la-hoac-go-sai'), ['placeholders', 'headings', 'cited-paths'])
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
  assert.match(r.messages.join('\n'), /rollback/)
  assert.match(r.messages.join('\n'), /i18n và timezone/)
})

test('stage không có schema thì headings không đòi gì (không throw)', () => {
  const headings = checksFor('70-ops', mkdtempSync(join(tmpdir(), 'pp-reg-')), REPO).find((c) => c.name === 'headings')
  assert.equal(headings.run('').ok, true)
})
