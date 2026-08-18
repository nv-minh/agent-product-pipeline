// tests/evidence.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { newEvidence, hasFailure, evidencePath } from '../lib/evidence.js'

test('ghi lệnh, output và exit status theo đúng định dạng', () => {
  const d = mkdtempSync(join(tmpdir(), 'pp-ev-'))
  const ev = newEvidence(d, '40-testplan', 't1', 1)
  ev.record('pp-check placeholders 40-testplan.md', '', 0)
  ev.record('pp-check traceability', 'missing: AC-3-2', 1)
  const rel = ev.finish('FAIL')
  assert.equal(rel, '.evidence/40-testplan.t1.log')
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
  assert.equal(hasFailure(d, '10-prd', 't1'), false)

  const ev2 = newEvidence(d, '10-prd', 't1', 2)
  ev2.record('b', 'hỏng', 1)
  ev2.finish('FAIL')
  assert.equal(hasFailure(d, '10-prd', 't1'), true)
})

test('không có evidence file thì coi như thất bại', () => {
  const d = mkdtempSync(join(tmpdir(), 'pp-ev-'))
  assert.equal(hasFailure(d, '10-prd', 't1'), true)
})

test('output chứa chuỗi "Exit status: 1" (indented) không được coi là status khác 0', () => {
  const d = mkdtempSync(join(tmpdir(), 'pp-ev-'))
  const ev = newEvidence(d, '20-check', 't1', 1)
  ev.record('test cmd', 'Exit status: 1', 0)
  ev.finish('PASS')
  assert.equal(hasFailure(d, '20-check', 't1'), false)
})

test('status line "Exit status: -1" được coi là thất bại', () => {
  const d = mkdtempSync(join(tmpdir(), 'pp-ev-'))
  const ev = newEvidence(d, '30-build', 't1', 1)
  ev.record('build', '', -1)
  ev.finish('FAIL')
  assert.equal(hasFailure(d, '30-build', 't1'), true)
})

test('status line với trailing whitespace "Exit status: 1   " được coi là thất bại', () => {
  const d = mkdtempSync(join(tmpdir(), 'pp-ev-'))
  mkdirSync(join(d, '.evidence'), { recursive: true })
  const path = join(d, '.evidence', '50-test.t1.log')
  writeFileSync(path, `[2026-01-01T00:00:00.000Z]  pp gate 50-test --tier t1
$ test
Exit status: 1
RESULT: FAIL (t1) — attempt 1/3
`)
  assert.equal(hasFailure(d, '50-test', 't1'), true)
})

// FIX review cuối (finding 2): T1 và T2 KHÔNG được dùng chung một file — nếu
// dùng chung, writeFileSync của T2 truncate mất mọi `Exit status:` của T1 và
// §7.4 sụp: một stage đỏ ở T1 vẫn trông sạch sau khi T2 xanh.
test('evidence T2 không ghi đè evidence T1 — mỗi tier một file', () => {
  const d = mkdtempSync(join(tmpdir(), 'pp-ev-'))
  const t1 = newEvidence(d, '10-prd', 't1', 1)
  t1.record('pp-check ears', 'AC-1-1 không EARS', 1)
  const p1 = t1.finish('FAIL')

  const t2 = newEvidence(d, '10-prd', 't2', 1)
  t2.record('pp-review độ sâu', '', 0)
  const p2 = t2.finish('PASS')

  assert.notEqual(p1, p2)
  assert.equal(p1, '.evidence/10-prd.t1.log')
  assert.equal(p2, '.evidence/10-prd.t2.log')
  // Log T1 còn nguyên exit code đỏ sau khi T2 chạy
  assert.match(readFileSync(join(d, p1), 'utf8'), /Exit status: 1/)
  assert.equal(hasFailure(d, '10-prd', 't1'), true)
  assert.equal(hasFailure(d, '10-prd', 't2'), false)
})

test('evidencePath bắt buộc có tier — không cho quay lại path dùng chung', () => {
  assert.throws(() => evidencePath('10-prd'), /tier/)
})
