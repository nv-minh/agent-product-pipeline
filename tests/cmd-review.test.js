import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, cpSync, rmSync, appendFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { readState, writeState } from '../lib/state.js'
import { passT1Prd, PRD, QUESTIONS } from './helpers.js'

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
  passT1Prd(r0)
  const r = run(['review-prompt', 'demo', '10-prd', '--root', r0])
  assert.equal(r.code, 0)
  assert.match(r.out, /US-1/)
  assert.match(r.out, /Điều 1 — Đơn giản/)
  assert.match(r.out, /REJECT/)
})

test('verdict có finding high thì exit 1 và state = failed', () => {
  const r0 = root()
  run(['init', 'demo', '--size', 'S', '--root', r0])
  const f = join(r0, 'features/demo')
  passT1Prd(r0)
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
  passT1Prd(r0)
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
  passT1Prd(r0)

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
  passT1Prd(r0)
  const s = readState(f)
  s.stages = s.stages ?? {}
  s.stages['10-prd'] = { ...s.stages['10-prd'], human: 'approved' }
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
  passT1Prd(r0)
  const s = readState(f)
  s.stages = s.stages ?? {}
  s.stages['10-prd'] = { ...s.stages['10-prd'], human: 'approved' }
  writeState(f, s)

  const v = join(f, 'verdict.json')
  writeFileSync(v, JSON.stringify({ findings: [
    { criterion: 'x', verdict: 'fail', severity: 'high', evidence: 'e', fix: 'f' },
  ] }))
  run(['review-record', 'demo', '10-prd', '--verdict', v, '--root', r0])
  assert.equal(readState(f).stages['10-prd'].human, undefined)
})

// ─── FIX review cuối: thứ tự tier là LUẬT TRONG CODE, không phải văn xuôi ───

// Lỗ hổng gốc: `review-record` ghi `done` chỉ từ một file JSON do LLM viết,
// trên một feature CHƯA TỪNG chạy gate, không có PRD, không có questions.
test('review-record TRƯỚC khi T1 xanh thì từ chối, exit 1', () => {
  const r0 = root()
  run(['init', 'demo', '--size', 'S', '--root', r0])
  const f = join(r0, 'features/demo')
  writeFileSync(join(f, '10-prd.md'), 'PRD giả, chưa từng qua gate')
  const v = join(f, 'verdict.json')
  writeFileSync(v, JSON.stringify({ findings: [] }))

  const r = run(['review-record', 'demo', '10-prd', '--verdict', v, '--root', r0])
  assert.equal(r.code, 1)
  assert.match(r.out, /T1/)
  const st = readState(f).stages['10-prd']
  assert.notEqual(st?.status, 'done')
})

test('review-prompt TRƯỚC khi T1 xanh thì từ chối, exit 1 (không tốn token cho T2)', () => {
  const r0 = root()
  run(['init', 'demo', '--size', 'S', '--root', r0])
  writeFileSync(join(r0, 'features/demo/10-prd.md'), 'PRD giả')
  const r = run(['review-prompt', 'demo', '10-prd', '--root', r0])
  assert.equal(r.code, 1)
  assert.match(r.out, /T1/)
})

test('stage khai báo ["t1","t2"] KHÔNG thể done chỉ bằng T1', () => {
  const r0 = root()
  run(['init', 'demo', '--size', 'S', '--root', r0])
  passT1Prd(r0)
  const st = readState(join(r0, 'features/demo')).stages['10-prd']
  assert.equal(st.tiers.t1.result, 'pass')
  assert.notEqual(st.status, 'done')
  assert.deepEqual(st.outstanding, ['t2'])
})

test('T1 xanh rồi T2 xanh thì stage mới done', () => {
  const r0 = root()
  run(['init', 'demo', '--size', 'S', '--root', r0])
  passT1Prd(r0)
  const f = join(r0, 'features/demo')
  const v = join(f, 'verdict.json')
  writeFileSync(v, JSON.stringify({ findings: [] }))
  assert.equal(run(['review-record', 'demo', '10-prd', '--verdict', v, '--root', r0]).code, 0)
  const st = readState(f).stages['10-prd']
  assert.equal(st.status, 'done')
  assert.equal(st.gate, 'pass')
  assert.equal(st.tiers.t1.result, 'pass')
  assert.equal(st.tiers.t2.result, 'pass')
})

// Điều 2: `done` đến từ exit code ghi trong `.evidence/`, không từ cờ trong
// state. Bẻ log T1 (thêm một dòng `Exit status: 1`) thì lần đánh giá kế tiếp
// phải thấy stage KHÔNG còn xong, dù state vẫn ghi tiers.t1.result = pass.
test('bẻ log evidence T1 thì lần đánh giá kế tiếp coi stage là chưa xong', () => {
  const r0 = root()
  run(['init', 'demo', '--size', 'S', '--root', r0])
  passT1Prd(r0)
  const f = join(r0, 'features/demo')
  appendFileSync(join(f, '.evidence/10-prd.t1.log'), 'Exit status: 1\n')

  const v = join(f, 'verdict.json')
  writeFileSync(v, JSON.stringify({ findings: [] }))
  const r = run(['review-record', 'demo', '10-prd', '--verdict', v, '--root', r0])
  assert.equal(r.code, 1)
  assert.notEqual(readState(f).stages['10-prd'].status, 'done')
})

// ─── R3: một `gate: ["t2"]` viết tay không được biến phán quyết LLM thành ───
// tấm vé duy nhất tới `done`. §7.4: quét EVIDENCE, gặp bất kỳ `Exit status:`
// khác 0 → không thể done, kể cả của tier không nằm trong `gate`.
test('R3: gate ["t2"] + log t1 đỏ trên đĩa thì review-record KHÔNG thể đưa stage tới done', () => {
  const r0 = root()
  run(['init', 'demo', '--size', 'S', '--root', r0])
  const f = join(r0, 'features/demo')

  // T1 chạy thật và đỏ (thiếu 10-questions.md) — log ở lại trên đĩa
  writeFileSync(join(f, '10-prd.md'), PRD)
  assert.equal(run(['gate', 'demo', '10-prd', '--root', r0]).code, 1)
  assert.match(readFileSync(join(f, '.evidence/10-prd.t1.log'), 'utf8'), /Exit status: 1/)

  // pipeline.json bị viết tay: gate chỉ còn t2
  const pj = join(f, 'pipeline.json')
  const cfg = JSON.parse(readFileSync(pj, 'utf8'))
  cfg.stages['10-prd'].gate = ['t2']
  writeFileSync(pj, JSON.stringify(cfg, null, 2))

  const v = join(f, 'verdict.json')
  writeFileSync(v, JSON.stringify({ findings: [] }))
  const r = run(['review-record', 'demo', '10-prd', '--verdict', v, '--root', r0])
  assert.match(r.out, /CHƯA done/)
  assert.match(r.out, /t1/)
  assert.notEqual(readState(f).stages['10-prd'].status, 'done')

  // Sửa cho T1 xanh thật rồi review lại thì mới được done
  writeFileSync(join(f, '10-questions.md'), QUESTIONS)
  assert.equal(run(['gate', 'demo', '10-prd', '--root', r0]).code, 0)
  assert.equal(run(['review-record', 'demo', '10-prd', '--verdict', v, '--root', r0]).code, 0)
  assert.equal(readState(f).stages['10-prd'].status, 'done')
})
