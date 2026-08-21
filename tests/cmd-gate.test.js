import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, cpSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

import { readState, writeState } from '../lib/state.js'
import { makeRoot, passT1Prd, completePrd, verdictFile, PRD_REWRITTEN, PRD, QUESTIONS_CLEAR } from './helpers.js'

const PP = new URL('../bin/pp', import.meta.url).pathname
const REPO = new URL('../', import.meta.url).pathname

function run(args) {
  try { return { code: 0, out: execFileSync('node', [PP, ...args], { encoding: 'utf8' }) } }
  catch (e) { return { code: e.status, out: (e.stdout || '') + (e.stderr || '') } }
}

function root() {
  const d = mkdtempSync(join(tmpdir(), 'pp-g-'))
  writeFileSync(join(d, 'constitution.md'), '# c\n')
  writeFileSync(join(d, '.pp-root'), 'marker (C4 — pp init đòi file này)\n')
  mkdirSync(join(d, 'schema'), { recursive: true })
  cpSync(join(REPO, 'schema'), join(d, 'schema'), { recursive: true })
  cpSync(join(REPO, 'templates'), join(d, 'templates'), { recursive: true })
  return d
}

// B5: hai test dưới đây TỪNG gate `40-testplan` trên một feature vừa init, với
// một PRD chỉ có đúng một dòng AC. Nay không chạy được nữa — không phải vì test
// sai mà vì hành vi đổi có chủ ý: `40-testplan` phải chờ `10-prd` xong và được
// duyệt. Dùng PRD thật (AC-1-1, AC-1-2) qua `completePrd`, rồi vẫn đưa vào một
// test plan rỗng heading để giữ nguyên ĐIỀU ĐANG ĐƯỢC KIỂM: traceability đỏ và
// gọi tên đúng AC chưa có test case.
test('gate đỏ in đúng AC còn thiếu và exit 1', () => {
  const r0 = makeRoot()
  run(['init', 'demo', '--size', 'S', '--root', r0])
  completePrd(r0)
  writeFileSync(join(r0, 'features/demo/40-testplan.md'), '## Test cases\n')
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
  const r0 = makeRoot()
  run(['init', 'demo', '--size', 'S', '--root', r0])
  completePrd(r0)
  writeFileSync(join(r0, 'features/demo/40-testplan.md'), '## Test cases\n')
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

// ─── Bản 2026-08-21 (trụ cột 2, đường b): gate và advance cùng biết nhánh
// "brief + refs đủ rõ → khai khối tự đánh giá thay vì hỏi 8 câu" ───

test('gate 10-prd xanh với khối tự đánh giá + 1 câu verify (không cần 8 câu)', () => {
  const r0 = makeRoot()
  run(['init', 'demo', '--size', 'S', '--root', r0])
  const dir = join(r0, 'features/demo')
  writeFileSync(join(dir, '10-questions.md'), QUESTIONS_CLEAR)
  writeFileSync(join(dir, '10-prd.md'), PRD)
  const r = run(['gate', 'demo', '10-prd', '--root', r0])
  assert.equal(r.code, 0, r.out)
})

test('pp advance nêu trước luật câu hỏi của 10-prd — cả hai đường hợp lệ', () => {
  const r0 = root()
  run(['init', 'demo', '--size', 'S', '--root', r0])
  const r = run(['advance', 'demo', '--root', r0])
  assert.equal(r.code, 0)
  assert.match(r.out, /Câu hỏi\s*:/)
  assert.match(r.out, /8 câu hỏi phân biệt/)
  assert.match(r.out, /Tự đánh giá độ rõ/)
})

// FIX review cuối (finding 9c): đột biến `return 3` -> `return 0` ở
// lib/commands/advance.js qua sạch 173 test cũ, dù commands/pp.md khoá chỉ
// thị an toàn quan trọng nhất của nó vào đúng exit code 3 ("dừng, KHÔNG được
// tự thử lại stage đó dưới bất kỳ hình thức nào").
test('pp advance với stage blocked thì exit 3 và in hai lối ra cho người', () => {
  const r0 = makeRoot()
  run(['init', 'demo', '--size', 'S', '--root', r0])
  writeState(join(r0, 'features/demo'), {
    feature: 'demo',
    stages: { '10-prd': { status: 'blocked', attempts: 3, gate: 'fail' } },
  })
  const r = run(['advance', 'demo', '--root', r0])
  assert.equal(r.code, 3)
  assert.match(r.out, /⛔/)
  assert.match(r.out, /blocked/)
  assert.match(r.out, /pp unblock/)
})

test('pp status với stage blocked cũng exit 3', () => {
  const r0 = makeRoot()
  run(['init', 'demo', '--size', 'S', '--root', r0])
  writeState(join(r0, 'features/demo'), {
    feature: 'demo',
    stages: { '10-prd': { status: 'blocked', attempts: 3, gate: 'fail' } },
  })
  assert.equal(run(['status', 'demo', '--root', r0]).code, 3)
})

// deferred từ review Task 4: stage blocked không có `attempts` (STATE.md bị
// sửa tay) từng in "đã thử undefined/3 lần".
test('stage blocked thiếu attempts thì in 0/3, không phải undefined/3', () => {
  const r0 = makeRoot()
  run(['init', 'demo', '--size', 'S', '--root', r0])
  writeState(join(r0, 'features/demo'), { feature: 'demo', stages: { '10-prd': { status: 'blocked' } } })
  const r = run(['advance', 'demo', '--root', r0])
  assert.equal(r.code, 3)
  assert.doesNotMatch(r.out, /undefined/)
  assert.match(r.out, /0\/3/)
})

// ─── R1: `pp gate` một mình KHÔNG được tái tuyên bố done sau khi artifact đổi ─
// Quan sát trong review: stage đi tới done hợp lệ, artifact bị viết lại thành
// "bỏ hoàn toàn kiểm tra phân quyền …" kèm một AC cho phép xoá không cần đăng
// nhập, rồi chỉ chạy `pp gate` — nó in "✓ <stage>: done — mọi tier bắt buộc đã
// xanh". T2 chưa từng thấy bản mới; phán quyết của nó ghi cho bản trước.
test('R1: viết lại artifact sau khi stage done thì pp gate một mình không tuyên bố done nữa', () => {
  const r0 = makeRoot()
  run(['init', 'demo', '--size', 'S', '--root', r0])
  const dir = join(r0, 'features/demo')

  passT1Prd(r0)
  const v = verdictFile(r0, 'demo', '10-prd', [])
  assert.equal(run(['review-record', 'demo', '10-prd', '--verdict', v, '--root', r0]).code, 0)
  assert.equal(readState(dir).stages['10-prd'].status, 'done')

  writeFileSync(join(dir, '10-prd.md'), PRD_REWRITTEN)
  const g = run(['gate', 'demo', '10-prd', '--root', r0])
  assert.equal(g.code, 0, g.out) // T1 vẫn xanh trên bản viết lại — đó là điểm mấu chốt
  assert.doesNotMatch(g.out, /✓ 10-prd: done/)
  assert.match(g.out, /CHƯA done — còn thiếu tier: t2/)
  assert.match(g.out, /10-prd\.md đã bị SỬA SAU KHI t2 chạy/)
  assert.notEqual(readState(dir).stages['10-prd'].status, 'done')
})

// ─── N10 (lab 2026-08-21): `gate --dry-run` — thử gate KHÔNG đốt lượt ───────
// §9.1 đếm MỌI lần chạy gate vào attempts. Lab quan sát nhu cầu thật: biết
// "artifact của tôi có qua không" TRƯỚC khi tiêu một lượt (kể cả lần gõ nhầm
// pipe `| head`). dry-run chạy đúng tập check nhưng không ghi BẤT CỨ thứ gì —
// không .evidence/, không attempts, không STATE, không audit.
test('N10: gate --dry-run ĐỎ — exit 1, không .evidence, không attempts, không đổi STATE', () => {
  const r0 = makeRoot()
  run(['init', 'demo', '--size', 'S', '--root', r0])
  const dir = join(r0, 'features/demo')
  const r = run(['gate', 'demo', '10-prd', '--dry-run', '--root', r0]) // artifact chưa tồn tại
  assert.equal(r.code, 1)
  assert.match(r.out, /\(dry-run\) 10-prd: ĐỎ/)
  assert.match(r.out, /không ghi sổ/)
  assert.match(r.out, /Chạy thật: pp gate demo 10-prd/)
  assert.ok(!existsSync(join(dir, '.evidence')), 'dry-run không được để lại .evidence/')
  const st = readState(dir).stages['10-prd']
  assert.equal(st, undefined, 'dry-run không được ghi gì vào state (stage chưa có bản ghi)')
})

test('N10: dry-run XANH cũng không ghi sổ; gate thật sau đó đếm từ attempt 1', () => {
  const r0 = makeRoot()
  run(['init', 'demo', '--size', 'S', '--root', r0])
  const dir = join(r0, 'features/demo')
  writeFileSync(join(dir, '10-questions.md'), QUESTIONS_CLEAR)
  writeFileSync(join(dir, '10-prd.md'), PRD)
  const d = run(['gate', 'demo', '10-prd', '--dry-run', '--root', r0])
  assert.equal(d.code, 0, d.out)
  assert.match(d.out, /\(dry-run\) 10-prd: XANH/)
  assert.match(d.out, /attempt 1\/3 sẽ được dùng khi chạy thật/)
  assert.ok(!existsSync(join(dir, '.evidence')), 'dry-run xanh cũng không được ghi evidence')

  const g = run(['gate', 'demo', '10-prd', '--root', r0])
  assert.equal(g.code, 0, g.out)
  assert.match(g.out, /attempt 1\/3/, 'dry-run không đốt lượt — lần chạy thật đầu tiên vẫn là 1/3')
})
