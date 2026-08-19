// tests/report-token.test.js — pp report in thêm token (từ .usage/entries.jsonl
// do usage-sync sinh) và khoảng thời gian (first→last ts trong audit.jsonl) —
// đúng lời hứa spec §9.4 đang treo. Dòng additive: không đụng bảng cũ.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { run, makeRoot } from './helpers.js'

function seedAudit(root, feature, events) {
  appendFileSync(join(root, 'features', feature, 'audit.jsonl'),
    events.map((e) => JSON.stringify(e)).join('\n') + '\n')
}

function seedUsage(root, feature, entries) {
  mkdirSync(join(root, 'features', feature, '.usage'), { recursive: true })
  writeFileSync(join(root, 'features', feature, '.usage', 'entries.jsonl'),
    entries.map((e) => JSON.stringify(e)).join('\n') + '\n')
}

const E = (over) => ({
  v: 1, id: `x:${over.ts}`, ts: over.ts, session: over.session ?? 's1',
  model: 'claude-opus-5', sidechain: false, attrib: 'window',
  stage: over.stage ?? null, input_tokens: over.i, output_tokens: over.o,
  cache_read_input_tokens: over.cr ?? 0, cache_creation_input_tokens: over.cc ?? 0,
})

test('report in dòng token (tổng hợp mọi entry) và khoảng thời gian (first→last ts audit)', () => {
  const root = makeRoot()
  run(['init', 'demo', '--size', 'S', '--root', root])
  seedAudit(root, 'demo', [
    { ts: '2026-08-18T09:12:03Z', v: 1, actor: 'human', event: 'init', feature: 'demo', details: { size: 'S' } },
    { ts: '2026-08-18T10:00:00Z', v: 1, actor: 'pp', event: 'dispatch', feature: 'demo', stage: '10-prd', details: {} },
    { ts: '2026-08-19T17:40:11Z', v: 1, actor: 'pp', event: 'gate', feature: 'demo', stage: '10-prd', ok: true, details: {} },
  ])
  seedUsage(root, 'demo', [
    E({ ts: '2026-08-18T10:05:00Z', stage: '10-prd', i: 100, o: 50, cr: 10, cc: 5, session: 's1' }),
    E({ ts: '2026-08-19T11:30:00Z', stage: null, i: 7, o: 3, session: 's2' }),
  ])
  const r = run(['report', 'demo', '--root', root])
  assert.equal(r.code, 0)
  assert.match(r.out, /→ token: input 107 · output 53 · cache 15 \(2 lượt, 2 session\) — cập nhật bằng `pp usage-sync demo`/)
  assert.match(r.out, /→ thời gian: 2026-08-18T09:12:03Z → 2026-08-19T17:40:11Z/)
})

test('chưa có dữ liệu usage: dòng gợi ý chạy usage-sync, không in dòng thời gian, exit 0', () => {
  const root = makeRoot()
  run(['init', 'demo', '--size', 'S', '--root', root])
  // Feature "cũ" tạo trước thay đổi audit: xoá sổ init mà lệnh vừa ghi —
  // mô phỏng đúng trạng thái không-có-audit (không phải không-chạy-lệnh).
  rmSync(join(root, 'features/demo/audit.jsonl'))
  const r = run(['report', 'demo', '--root', root])
  assert.equal(r.code, 0)
  assert.match(r.out, /→ token: \(chưa có dữ liệu — chạy pp usage-sync demo\)/)
  assert.doesNotMatch(r.out, /→ thời gian:/)
})

test('feature chưa từng chạy lệnh nào (không audit): vẫn có dòng gợi ý token, vẫn exit 0', () => {
  const root = makeRoot()
  run(['init', 'demo', '--size', 'S', '--root', root])
  const r = run(['report', 'demo', '--root', root])
  assert.equal(r.code, 0)
  assert.match(r.out, /→ token: \(chưa có dữ liệu/)
})
