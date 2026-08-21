// Task 4 (pp-bugfix/pp-change): pp init --type chọn template theo LOẠI VIỆC.
// Type lạ exit 2 KHÔNG fallback — size là gợi ý (fallback M), type là ngữ
// nghĩa của cả pipeline, đoán sai là chạy sai pipeline (spec §3.1).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { makeRoot, run } from './helpers.js'

test('--type bugfix: pipeline.json đúng type + 3 stage, status trỏ 05-diagnosis', () => {
  const r0 = makeRoot()
  const r = run(['init', 'fix-loi-500', '--type', 'bugfix', '--root', r0])
  assert.equal(r.code, 0)
  assert.match(r.out, /type bugfix/)
  const cfg = JSON.parse(readFileSync(join(r0, 'features/fix-loi-500/pipeline.json'), 'utf8'))
  assert.equal(cfg.type, 'bugfix')
  assert.deepEqual(Object.keys(cfg.stages), ['05-diagnosis', '15-fixplan', '40-regression'])
  assert.equal(cfg.stages['05-diagnosis'].human, true)
  const st = run(['status', 'fix-loi-500', '--root', r0])
  assert.match(st.out, /05-diagnosis/)
})

test('--type change: pipeline.json đúng type + 3 stage, 10-prd có schema override', () => {
  const r0 = makeRoot()
  assert.equal(run(['init', 'doi-form', '--type', 'change', '--root', r0]).code, 0)
  const cfg = JSON.parse(readFileSync(join(r0, 'features/doi-form/pipeline.json'), 'utf8'))
  assert.equal(cfg.type, 'change')
  assert.deepEqual(Object.keys(cfg.stages), ['05-impact', '10-prd', '40-testplan'])
  assert.equal(cfg.stages['10-prd'].schema, '10-prd.change')
  assert.equal(cfg.stages['10-prd'].human, true)
})

test('brief scaffold theo type: bugfix có khung Hiện tượng/Mong đợi/Unchanged/tái hiện', () => {
  const r0 = makeRoot()
  run(['init', 'fix-x', '--type', 'bugfix', '--root', r0])
  const brief = readFileSync(join(r0, 'features/fix-x/00-brief.md'), 'utf8')
  for (const khung of ['Hiện tượng', 'Mong đợi', 'Unchanged behavior', 'tái hiện']) {
    assert.match(brief, new RegExp(khung))
  }
})

test('brief scaffold change nói về DELTA trên hành vi đã có', () => {
  const r0 = makeRoot()
  run(['init', 'doi-y', '--type', 'change', '--root', r0])
  const brief = readFileSync(join(r0, 'features/doi-y/00-brief.md'), 'utf8')
  assert.match(brief, /DELTA/)
  assert.match(brief, /05-impact/)
})

test('type lạ → exit 2, KHÔNG tạo thư mục, KHÔNG fallback', () => {
  const r0 = makeRoot()
  const r = run(['init', 'demo', '--type', 'hotfix', '--root', r0])
  assert.equal(r.code, 2)
  assert.match(r.out, /"hotfix" không hợp lệ/)
  assert.match(r.out, /feature, bugfix, change/)
  assert.ok(!existsSync(join(r0, 'features/demo')))
})

test('không --type → hành vi cũ y nguyên (type feature, size theo --size)', () => {
  const r0 = makeRoot()
  assert.equal(run(['init', 'demo', '--size', 'S', '--root', r0]).code, 0)
  const cfg = JSON.parse(readFileSync(join(r0, 'features/demo/pipeline.json'), 'utf8'))
  assert.equal(cfg.type, 'feature')
  assert.equal(cfg.size, 'S')
  assert.deepEqual(Object.keys(cfg.stages), ['10-prd', '40-testplan'])
})
