// tests/audit.test.js — sổ kiểm toán audit.jsonl: mọi lệnh ghi state phải để lại
// đúng MỘT dòng JSON mỗi lần chạy, ts ISO đầy đủ (lessons chỉ có ngày), và lỗi
// ghi audit KHÔNG được đổi exit code của lệnh (exit code là dữ kiện).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run, runSplit, makeRoot, passT1Prd, verdictFile } from './helpers.js'
import { writeState } from '../lib/state.js'
import { readAudit } from '../lib/audit.js'

function auditLines(root, feature = 'demo') {
  return readAudit(join(root, 'features', feature))
}

test('init ghi đúng MỘT dòng audit đầu: ts ISO có giờ, actor human, key order cố định', () => {
  const root = makeRoot()
  const r = run(['init', 'demo', '--size', 'S', '--root', root])
  assert.equal(r.code, 0)
  const lines = auditLines(root)
  assert.equal(lines.length, 1, `phải có đúng 1 dòng, có ${lines.length}`)
  const [e] = lines
  // Full ISO có giờ phút giây — khác lessons/ chỉ có YYYY-MM-DD
  assert.match(e.ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  assert.equal(e.v, 1)
  assert.equal(e.actor, 'human')
  assert.equal(e.event, 'init')
  assert.equal(e.feature, 'demo')
  assert.equal(e.details.size, 'S')
  assert.deepEqual(Object.keys(e), ['ts', 'v', 'actor', 'event', 'feature', 'details'])
})

test('gate ĐỎ rồi gate XANH: mỗi lần chạy đúng một event gate với ok tương ứng', () => {
  const root = makeRoot()
  run(['init', 'demo', '--size', 'S', '--root', root])
  // Đỏ: chưa có artifact nào
  const red = run(['gate', 'demo', '10-prd', '--root', root])
  assert.equal(red.code, 1)
  let gates = auditLines(root).filter((e) => e.event === 'gate')
  assert.equal(gates.length, 1)
  assert.equal(gates[0].actor, 'pp')
  assert.equal(gates[0].stage, '10-prd')
  assert.equal(gates[0].ok, false)
  assert.equal(gates[0].details.tier, 't1')
  assert.match(gates[0].details.evidence, /\.evidence\/10-prd\.t1\.log$/)
  // Xanh: artifact sạch
  passT1Prd(root)
  gates = auditLines(root).filter((e) => e.event === 'gate')
  assert.equal(gates.length, 2)
  assert.equal(gates[1].ok, true)
  // key order cho event có stage/ok
  assert.deepEqual(Object.keys(gates[1]), ['ts', 'v', 'actor', 'event', 'feature', 'stage', 'ok', 'details'])
})

test('override: ghi event có reason VÀ vẫn ghi lessons/ (audit mirror, không thay thế)', () => {
  const root = makeRoot()
  run(['init', 'demo', '--size', 'S', '--root', root])
  const r = run(['override', 'demo', '10-prd', '--reason', 'gate 10-prd sai luật demo', '--root', root])
  assert.equal(r.code, 0)
  const [e] = auditLines(root).filter((x) => x.event === 'override')
  assert.equal(e.actor, 'human')
  assert.equal(e.stage, '10-prd')
  assert.equal(e.reason, 'gate 10-prd sai luật demo')
  assert.equal(e.details.count, 1)
  const lesson = readFileSync(join(root, 'lessons', '10-prd.md'), 'utf8')
  assert.match(lesson, /override \(demo\): gate 10-prd sai luật demo/)
})

test('unblock ghi event có reason; approve ghi event actor human', () => {
  const root = makeRoot()
  run(['init', 'demo', '--size', 'S', '--root', root])
  run(['override', 'demo', '10-prd', '--reason', 'thử', '--root', root])
  const un = run(['unblock', 'demo', '10-prd', '--reason', 'đã sửa xong luật', '--root', root])
  assert.equal(un.code, 0)
  const [ue] = auditLines(root).filter((x) => x.event === 'unblock')
  assert.equal(ue.actor, 'human')
  assert.equal(ue.reason, 'đã sửa xong luật')
  // approve trên stage overridden thuần (chưa từng gate) vẫn được — stageDone miễn trừ overridden
  run(['override', 'demo', '10-prd', '--reason', 'duyệt tay', '--root', root])
  const ap = run(['approve', 'demo', '10-prd', '--root', root])
  assert.equal(ap.code, 0)
  const [ae] = auditLines(root).filter((x) => x.event === 'approve')
  assert.equal(ae.actor, 'human')
  assert.equal(ae.stage, '10-prd')
})

test('advance: mọi outcome đều có event dispatch — run / blocked / complete', () => {
  const root = makeRoot()
  run(['init', 'demo', '--size', 'S', '--root', root])
  // outcome run: stage đầu còn pending
  assert.equal(run(['advance', 'demo', '--root', root]).code, 0)
  let [d] = auditLines(root).filter((e) => e.event === 'dispatch')
  assert.equal(d.actor, 'pp')
  assert.equal(d.details.action, 'run')
  assert.equal(typeof d.stage, 'string')
  // outcome blocked: attempts chạm trần
  writeState(join(root, 'features/demo'), {
    feature: 'demo', current: '10-prd',
    stages: { '10-prd': { status: 'failed', attempts: 3 } },
  })
  const bl = runSplit(['advance', 'demo', '--root', root])
  assert.equal(bl.code, 3)
  ;[d] = auditLines(root).filter((e) => e.event === 'dispatch').slice(-1)
  assert.equal(d.details.action, 'blocked')
  // outcome complete: bịa state "done" tay sẽ bị stageDone đọc lại evidence
  // trên đĩa và trả regate — dùng đường THẬT tới complete là override (cửa
  // thoát hiểm) cho cả hai stage.
  run(['override', 'demo', '10-prd', '--reason', 'test complete', '--root', root])
  run(['override', 'demo', '40-testplan', '--reason', 'test complete', '--root', root])
  // 10-prd có human: true — override xong vẫn phải qua `pp approve` (human
  // gate không bị vô hiệu hoá bởi override), advance mới trả complete.
  run(['approve', 'demo', '10-prd', '--root', root])
  assert.equal(runSplit(['advance', 'demo', '--root', root]).code, 0)
  ;[d] = auditLines(root).filter((e) => e.event === 'dispatch').slice(-1)
  assert.equal(d.details.action, 'complete')
  assert.equal('stage' in d, false)
})

test('review-prompt và review-record: mỗi vòng review để lại 2 event, review có findings', () => {
  const root = makeRoot()
  run(['init', 'demo', '--size', 'S', '--root', root])
  passT1Prd(root)
  const rp = run(['review-prompt', 'demo', '10-prd', '--root', root])
  assert.equal(rp.code, 0)
  const [rpe] = auditLines(root).filter((e) => e.event === 'review-prompt')
  assert.equal(rpe.actor, 'pp')
  assert.equal(rpe.stage, '10-prd')

  const vf = verdictFile(root, 'demo', '10-prd', [
    { criterion: 'AC đo được', verdict: 'fail', severity: 'high', evidence: 'AC-1 mơ hồ', fix: 'viết lại EARS' },
    { criterion: 'Out of scope', verdict: 'pass', severity: 'low', evidence: '', fix: '' },
  ])
  const rr = run(['review-record', 'demo', '10-prd', '--verdict', vf, '--root', root])
  assert.equal(rr.code, 1) // có finding high → đỏ
  const [re] = auditLines(root).filter((e) => e.event === 'review')
  assert.equal(re.actor, 'pp')
  assert.equal(re.stage, '10-prd')
  assert.equal(re.ok, false)
  assert.equal(re.details.tier, 't2')
  assert.equal(re.details.findings_total, 2)
  assert.equal(re.details.findings_high, 1)
})

test('audit là BEST-EFFORT: audit.jsonl thành thư mục (ghi fail) → advance vẫn exit 0 + stderr cảnh báo', () => {
  const root = makeRoot()
  run(['init', 'demo', '--size', 'S', '--root', root])
  // Chiếm chỗ tên file bằng một thư mục: appendFileSync sẽ EISDIR. init đã
  // ghi audit.jsonl thành file (event init) nên phải dọn trước khi chiếm chỗ.
  rmSync(join(root, 'features/demo/audit.jsonl'))
  mkdirSync(join(root, 'features/demo/audit.jsonl'))
  const r = runSplit(['advance', 'demo', '--root', root])
  assert.equal(r.code, 0, 'lỗi ghi audit không được đổi exit code')
  assert.match(r.stderr, /audit\.jsonl/)
  assert.equal(r.stdout.includes('audit.jsonl'), false, 'stdout của lệnh không bị nhiễu')
})

test('readAudit: bỏ dòng hỏng, trả mảng event đã parse (trắng hộp)', () => {
  const d = mkdtempSync(join(tmpdir(), 'pp-audit-lib-'))
  writeFileSync(join(d, 'audit.jsonl'), 'not json {{{\n{"v":1,"event":"init"}\n\n')
  const events = readAudit(d)
  assert.equal(events.length, 1)
  assert.equal(events[0].event, 'init')
})
