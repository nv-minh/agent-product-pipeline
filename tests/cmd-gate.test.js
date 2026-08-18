import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, cpSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

import { makeRoot, passT1Prd } from './helpers.js'

const PP = new URL('../bin/pp', import.meta.url).pathname
const REPO = new URL('../', import.meta.url).pathname

function run(args) {
  try { return { code: 0, out: execFileSync('node', [PP, ...args], { encoding: 'utf8' }) } }
  catch (e) { return { code: e.status, out: (e.stdout || '') + (e.stderr || '') } }
}

function root() {
  const d = mkdtempSync(join(tmpdir(), 'pp-g-'))
  writeFileSync(join(d, 'constitution.md'), '# c\n')
  mkdirSync(join(d, 'schema'), { recursive: true })
  cpSync(join(REPO, 'schema'), join(d, 'schema'), { recursive: true })
  cpSync(join(REPO, 'templates'), join(d, 'templates'), { recursive: true })
  return d
}

test('gate đỏ in đúng AC còn thiếu và exit 1', () => {
  const r0 = root()
  run(['init', 'demo', '--size', 'S', '--root', r0])
  const f = join(r0, 'features/demo')
  writeFileSync(join(f, '10-prd.md'), '<ac id="AC-1-1" story="US-1">WHEN a THE SYSTEM SHALL b</ac>\n')
  writeFileSync(join(f, '40-testplan.md'), '## Test cases\n')
  const r = run(['gate', 'demo', '40-testplan', '--root', r0])
  assert.equal(r.code, 1)
  assert.match(r.out, /AC-1-1/)
})

test('advance in chỉ thị gồm inputs, skills và outputs', () => {
  const r0 = root()
  run(['init', 'demo', '--size', 'S', '--root', r0])
  const r = run(['advance', 'demo', '--root', r0])
  assert.equal(r.code, 0)
  assert.match(r.out, /10-prd/)
  assert.match(r.out, /00-brief\.md/)
  assert.match(r.out, /prd-epic/)
  assert.match(r.out, /10-prd\.md/)
})

// CORRECTION: brief's gateCmd/advanceCmd snippets used
// args.filter(a => !a.startsWith('--')) / args.indexOf('--tier'), which silently
// picks the wrong token when a flag precedes a positional arg (see lib/args.js
// header comment for the `pp init --size S demo` regression this caused). gate
// and advance must use the shared parseArgs instead, so a flag placed before the
// positional args still resolves feature/stage correctly.
test('flag đứng trước positional: pp gate --root DIR demo 40-testplan vẫn nhận đúng feature/stage', () => {
  const r0 = root()
  run(['init', 'demo', '--size', 'S', '--root', r0])
  const f = join(r0, 'features/demo')
  writeFileSync(join(f, '10-prd.md'), '<ac id="AC-1-1" story="US-1">WHEN a THE SYSTEM SHALL b</ac>\n')
  writeFileSync(join(f, '40-testplan.md'), '## Test cases\n')
  const r = run(['gate', '--root', r0, 'demo', '40-testplan'])
  assert.equal(r.code, 1)
  assert.match(r.out, /AC-1-1/)
})

// FINDING 1 (task-11 review): unknown stage id must not leak an internal
// TypeError from runT1's unguarded config.stages[stageId].outputs access.
// gateCmd must catch it before calling runT1, name the bad id, list the real
// ones, and exit 2 (bad argument) — not 1 (which means "the gate ran and
// failed").
test('gate với stage lạ báo rõ tên stage sai và liệt kê stage thật, exit 2', () => {
  const r0 = root()
  run(['init', 'demo', '--size', 'S', '--root', r0])
  const r = run(['gate', 'demo', '99-nope', '--root', r0])
  assert.equal(r.code, 2)
  assert.match(r.out, /99-nope/)
  assert.match(r.out, /10-prd/)
})

// ─── FIX review cuối (4e/4f): gate và advance phải NÓI SỰ THẬT về tier ───

test('pp gate: T1 xanh trên stage có t2 thì nói rõ stage CHƯA done và nêu tier còn thiếu', () => {
  const r0 = makeRoot()
  run(['init', 'demo', '--size', 'S', '--root', r0])
  const r = passT1Prd(r0)
  assert.match(r.out, /RESULT: PASS \(t1\)/)
  assert.match(r.out, /CHƯA done/)
  assert.match(r.out, /t2/)
  assert.match(r.out, /review-prompt/)
})

test('pp gate: stage chỉ khai báo t1 thì T1 xanh là done, in xác nhận', () => {
  const r0 = makeRoot()
  run(['init', 'demo', '--size', 'S', '--root', r0])
  // Hạ 10-prd xuống chỉ còn tier t1 để kiểm nhánh done ngay sau T1.
  const pj = join(r0, 'features/demo/pipeline.json')
  const cfg = JSON.parse(readFileSync(pj, 'utf8'))
  cfg.stages['10-prd'].gate = ['t1']
  writeFileSync(pj, JSON.stringify(cfg, null, 2))
  const r = passT1Prd(r0)
  assert.match(r.out, /done/)
  assert.doesNotMatch(r.out, /CHƯA done/)
})

test('pp advance nêu đích danh các tier bắt buộc của stage kế tiếp', () => {
  const r0 = makeRoot()
  run(['init', 'demo', '--size', 'S', '--root', r0])
  const r = run(['advance', 'demo', '--root', r0])
  assert.equal(r.code, 0)
  assert.match(r.out, /Tier bắt buộc\s*:\s*t1, t2/)
  assert.match(r.out, /pp review-record demo 10-prd/)
})
