import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { readState, writeState } from '../lib/state.js'

const PP = new URL('../bin/pp', import.meta.url).pathname
const REPO = new URL('../', import.meta.url).pathname
function run(args) {
  try { return { code: 0, out: execFileSync('node', [PP, ...args], { encoding: 'utf8' }) } }
  catch (e) { return { code: e.status, out: (e.stdout || '') + (e.stderr || '') } }
}
function root() {
  const d = mkdtempSync(join(tmpdir(), 'pp-r-'))
  writeFileSync(join(d, 'constitution.md'), '# Constitution\nĐiều 1 — Đơn giản\n')
  for (const sub of ['schema', 'templates', 'rubric']) {
    mkdirSync(join(d, sub), { recursive: true })
    cpSync(join(REPO, sub), join(d, sub), { recursive: true })
  }
  return d
}

test('review-prompt chứa artifact, rubric và constitution', () => {
  const r0 = root()
  run(['init', 'demo', '--size', 'S', '--root', r0])
  writeFileSync(join(r0, 'features/demo/10-prd.md'), 'NỘI DUNG PRD')
  const r = run(['review-prompt', 'demo', '10-prd', '--root', r0])
  assert.equal(r.code, 0)
  assert.match(r.out, /NỘI DUNG PRD/)
  assert.match(r.out, /Điều 1 — Đơn giản/)
  assert.match(r.out, /REJECT/)
})

test('verdict có finding high thì exit 1 và state = failed', () => {
  const r0 = root()
  run(['init', 'demo', '--size', 'S', '--root', r0])
  const f = join(r0, 'features/demo')
  writeFileSync(join(f, '10-prd.md'), 'x')
  const v = join(f, 'verdict.json')
  writeFileSync(v, JSON.stringify({ findings: [
    { criterion: 'AC đo được', verdict: 'fail', severity: 'high', evidence: 'AC-1-1 mơ hồ', fix: 'viết lại EARS' },
  ] }))
  const r = run(['review-record', 'demo', '10-prd', '--verdict', v, '--root', r0])
  assert.equal(r.code, 1)
  assert.match(r.out, /AC-1-1 mơ hồ/)
})

test('chỉ có finding medium thì exit 0', () => {
  const r0 = root()
  run(['init', 'demo', '--size', 'S', '--root', r0])
  const f = join(r0, 'features/demo')
  writeFileSync(join(f, '10-prd.md'), 'x')
  const v = join(f, 'verdict.json')
  writeFileSync(v, JSON.stringify({ findings: [
    { criterion: 'x', verdict: 'fail', severity: 'medium', evidence: 'e', fix: 'f' },
  ] }))
  assert.equal(run(['review-record', 'demo', '10-prd', '--verdict', v, '--root', r0]).code, 0)
})

test('review-prompt: stage lạ báo rõ tên stage và liệt kê stage thật, exit 2', () => {
  const r0 = root()
  run(['init', 'demo', '--size', 'S', '--root', r0])
  const r = run(['review-prompt', 'demo', '99-nope', '--root', r0])
  assert.equal(r.code, 2)
  assert.match(r.out, /"99-nope"/)
  assert.match(r.out, /10-prd/)
  assert.match(r.out, /40-testplan/)
})

test('review-record: stage lạ báo rõ tên stage và liệt kê stage thật, exit 2', () => {
  const r0 = root()
  run(['init', 'demo', '--size', 'S', '--root', r0])
  const v = join(r0, 'features/demo/v.json')
  writeFileSync(v, JSON.stringify({ findings: [] }))
  const r = run(['review-record', 'demo', '99-nope', '--verdict', v, '--root', r0])
  assert.equal(r.code, 2)
  assert.match(r.out, /"99-nope"/)
  assert.match(r.out, /10-prd/)
})

test('review-prompt: thiếu rubric/<stage>.md thì exit 2, không throw', () => {
  const r0 = root()
  run(['init', 'demo', '--size', 'S', '--root', r0])
  writeFileSync(join(r0, 'features/demo/10-prd.md'), 'x')
  rmSync(join(r0, 'rubric/10-prd.md'))
  const r = run(['review-prompt', 'demo', '10-prd', '--root', r0])
  assert.equal(r.code, 2)
  assert.match(r.out, /rubric\/10-prd\.md/)
})

test('review-prompt: thiếu artifact (output cuối của stage) thì exit 2, không throw', () => {
  const r0 = root()
  run(['init', 'demo', '--size', 'S', '--root', r0])
  const r = run(['review-prompt', 'demo', '10-prd', '--root', r0])
  assert.equal(r.code, 2)
  assert.match(r.out, /10-prd\.md/)
})

test('review-record: verdict file không tồn tại thì exit 2, không throw', () => {
  const r0 = root()
  run(['init', 'demo', '--size', 'S', '--root', r0])
  writeFileSync(join(r0, 'features/demo/10-prd.md'), 'x')
  const r = run(['review-record', 'demo', '10-prd', '--verdict', join(r0, 'features/demo/khong-co.json'), '--root', r0])
  assert.equal(r.code, 2)
})

test('review-record: verdict file JSON méo thì exit 2, không throw parse error thô', () => {
  const r0 = root()
  run(['init', 'demo', '--size', 'S', '--root', r0])
  writeFileSync(join(r0, 'features/demo/10-prd.md'), 'x')
  const v = join(r0, 'features/demo/bad.json')
  writeFileSync(v, 'không phải json{{{')
  const r = run(['review-record', 'demo', '10-prd', '--verdict', v, '--root', r0])
  assert.equal(r.code, 2)
})

test('review-record: findings rỗng hoặc vắng mặt thì coi là PASS, exit 0', () => {
  const r0 = root()
  run(['init', 'demo', '--size', 'S', '--root', r0])
  const f = join(r0, 'features/demo')
  writeFileSync(join(f, '10-prd.md'), 'x')

  const v1 = join(f, 'empty.json')
  writeFileSync(v1, JSON.stringify({ findings: [] }))
  assert.equal(run(['review-record', 'demo', '10-prd', '--verdict', v1, '--root', r0]).code, 0)

  const v2 = join(f, 'none.json')
  writeFileSync(v2, JSON.stringify({}))
  assert.equal(run(['review-record', 'demo', '10-prd', '--verdict', v2, '--root', r0]).code, 0)
})

test('review-record: human bị xoá trên nhánh PASS — re-review revoke approval cũ', () => {
  const r0 = root()
  run(['init', 'demo', '--size', 'S', '--root', r0])
  const f = join(r0, 'features/demo')
  writeFileSync(join(f, '10-prd.md'), 'x')
  const s = readState(f)
  s.stages = s.stages ?? {}
  s.stages['10-prd'] = { ...s.stages['10-prd'], status: 'done', human: 'approved' }
  writeState(f, s)

  const v = join(f, 'verdict.json')
  writeFileSync(v, JSON.stringify({ findings: [] }))
  run(['review-record', 'demo', '10-prd', '--verdict', v, '--root', r0])
  assert.equal(readState(f).stages['10-prd'].human, undefined)
})

test('review-record: human bị xoá trên nhánh FAIL', () => {
  const r0 = root()
  run(['init', 'demo', '--size', 'S', '--root', r0])
  const f = join(r0, 'features/demo')
  writeFileSync(join(f, '10-prd.md'), 'x')
  const s = readState(f)
  s.stages = s.stages ?? {}
  s.stages['10-prd'] = { ...s.stages['10-prd'], status: 'done', human: 'approved' }
  writeState(f, s)

  const v = join(f, 'verdict.json')
  writeFileSync(v, JSON.stringify({ findings: [
    { criterion: 'x', verdict: 'fail', severity: 'high', evidence: 'e', fix: 'f' },
  ] }))
  run(['review-record', 'demo', '10-prd', '--verdict', v, '--root', r0])
  assert.equal(readState(f).stages['10-prd'].human, undefined)
})
