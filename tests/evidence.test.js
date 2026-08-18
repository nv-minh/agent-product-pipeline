// tests/evidence.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { newEvidence, hasFailure } from '../lib/evidence.js'

test('ghi lệnh, output và exit status theo đúng định dạng', () => {
  const d = mkdtempSync(join(tmpdir(), 'pp-ev-'))
  const ev = newEvidence(d, '40-testplan', 't1', 1)
  ev.record('pp-check placeholders 40-testplan.md', '', 0)
  ev.record('pp-check traceability', 'missing: AC-3-2', 1)
  const rel = ev.finish('FAIL')
  assert.equal(rel, '.evidence/40-testplan.log')
  const txt = readFileSync(join(d, rel), 'utf8')
  assert.match(txt, /\$ pp-check placeholders/)
  assert.match(txt, /Exit status: 0/)
  assert.match(txt, /missing: AC-3-2/)
  assert.match(txt, /Exit status: 1/)
  assert.match(txt, /RESULT: FAIL \(t1\) — attempt 1\/3/)
})

test('failed = true ngay khi có một exit khác 0', () => {
  const d = mkdtempSync(join(tmpdir(), 'pp-ev-'))
  const ev = newEvidence(d, '10-prd', 't1', 1)
  ev.record('a', '', 0)
  assert.equal(ev.failed, false)
  ev.record('b', '', 2)
  assert.equal(ev.failed, true)
})

test('hasFailure đọc lại từ đĩa, không tin bộ nhớ', () => {
  const d = mkdtempSync(join(tmpdir(), 'pp-ev-'))
  const ev = newEvidence(d, '10-prd', 't1', 1)
  ev.record('a', '', 0)
  ev.finish('PASS')
  assert.equal(hasFailure(d, '10-prd'), false)

  const ev2 = newEvidence(d, '10-prd', 't1', 2)
  ev2.record('b', 'hỏng', 1)
  ev2.finish('FAIL')
  assert.equal(hasFailure(d, '10-prd'), true)
})

test('không có evidence file thì coi như thất bại', () => {
  const d = mkdtempSync(join(tmpdir(), 'pp-ev-'))
  assert.equal(hasFailure(d, '10-prd'), true)
})
